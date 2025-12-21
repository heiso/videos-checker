#!/bin/bash

# Video File Error Checker
# Uses ffprobe and ffmpeg to detect corrupted or problematic video files

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
DIRECTORY="."
VERBOSE=false
QUICK_MODE=false
JSON_MODE=false
PARALLEL_JOBS=1

# Track parent PID for shared temp files
PARENT_PID=$$
TEMP_PREFIX="/tmp/video_checker_${PARENT_PID}"
LOCK_FILE="${TEMP_PREFIX}_lock"
COUNTER_FILE="${TEMP_PREFIX}_counters"
TMP_FAILED_FILE="${TEMP_PREFIX}_failed"
TMP_PASSED_FILE="${TEMP_PREFIX}_passed"

# Arrays to store results
declare -a failed_files=()
declare -a json_results=()

# Lock file for thread-safe counter updates
# Cleanup function (only parent should remove shared files)
cleanup() {
    rm -f "$LOCK_FILE" "$COUNTER_FILE" "$TMP_FAILED_FILE" "$TMP_PASSED_FILE"
}

cleanup_handler() {
    [[ $$ -eq $PARENT_PID ]] && cleanup
}
trap cleanup_handler EXIT

# Usage function
usage() {
    echo "Usage: $0 [OPTIONS] [DIRECTORY]"
    echo ""
    echo "Options:"
    echo "  -j, --json         Output results in JSON format"
    echo "  -p, --parallel N   Process N files in parallel (default: 1)"
    echo "  -q, --quick        Skip full decode test (faster but less thorough)"
    echo "  -v, --verbose      Show detailed ffmpeg/ffprobe output"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 /path/to/videos"
    echo "  $0 -p 4 /path/to/videos   # Process 4 files in parallel"
    echo "  $0 -q /path/to/videos     # Quick mode"
    echo "  $0 -j /path/to/videos     # JSON output"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -j|--json)
            JSON_MODE=true
            shift
            ;;
        -p|--parallel)
            if [[ -z "$2" ]]; then
                echo "Error: --parallel requires a numeric argument"
                exit 1
            fi
            if ! [[ "$2" =~ ^[0-9]+$ ]] || [[ "$2" -lt 1 ]]; then
                echo "Error: --parallel value must be a positive integer"
                exit 1
            fi
            PARALLEL_JOBS="$2"
            shift 2
            ;;
        -q|--quick)
            QUICK_MODE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            DIRECTORY="$1"
            shift
            ;;
    esac
done

# Check if ffprobe and ffmpeg are installed
if ! command -v ffprobe &> /dev/null; then
    echo -e "${RED}Error: ffprobe is not installed${NC}"
    exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed${NC}"
    exit 1
fi

# Check if directory exists
if [[ ! -d "$DIRECTORY" ]]; then
    echo -e "${RED}Error: Directory '$DIRECTORY' does not exist${NC}"
    exit 1
fi

# Initialize counters
total=0
passed=0
failed=0

# Check a single video file
check_video() {
    local file="$1"
    local file_index="$2"
    local has_error=false
    local errors=()
    
    # Determine number of tests
    local num_tests=2
    if $QUICK_MODE; then
        num_tests=1
    fi
    
    if ! $JSON_MODE; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "[$file_index] Checking: $file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    
    # Test 1: ffprobe - Check metadata AND container errors in a single call
    if ! $JSON_MODE; then
        echo -n "[1/$num_tests] Probing file... "
    fi
    
    # Single ffprobe call that checks both metadata and container errors
    local probe_output probe_exit
    if $VERBOSE; then
        probe_output=$(ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,codec_type,width,height "$file" 2>&1)
    else
        probe_output=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$file" 2>&1)
    fi
    probe_exit=$?
    
    # Check for errors in output (ffprobe outputs errors to the same stream with -v error)
    local probe_errors=""
    local duration=""
    
    if [[ $probe_exit -ne 0 ]]; then
        has_error=true
        errors+=("ffprobe: failed to read file (exit code $probe_exit)")
        probe_errors="$probe_output"
    else
        # Separate duration from potential error messages
        while IFS= read -r line; do
            if [[ "$line" =~ ^[0-9]+\.?[0-9]*$ ]]; then
                duration="$line"
            elif [[ -n "$line" ]]; then
                probe_errors+="$line"$'\n'
                has_error=true
                errors+=("container: $line")
            fi
        done <<< "$probe_output"
        
        # Check if we got a valid duration
        if [[ -z "$duration" ]] && ! $VERBOSE; then
            has_error=true
            errors+=("ffprobe: no duration found (possibly corrupt)")
        fi
    fi
    
    if $has_error && ! $JSON_MODE; then
        echo -e "${RED}✗ Errors detected${NC}"
        if [[ -n "$probe_errors" ]]; then
            while IFS= read -r line; do
                [[ -n "$line" ]] && echo "    $line"
            done <<< "$probe_errors"
        fi
    elif ! $JSON_MODE; then
        echo -e "${GREEN}✓${NC}"
        if $VERBOSE && [[ -n "$probe_output" ]]; then
            while IFS= read -r line; do
                echo "    $line"
            done <<< "$probe_output"
        fi
    fi
    
    # Test 2: ffmpeg - Decode the entire file (null output)
    if ! $QUICK_MODE; then
        if ! $JSON_MODE; then
            echo -n "[2/$num_tests] Decode test... "
        fi
        
        # Use hardware acceleration if available, with fallback
        local decode_output decode_exit
        decode_output=$(ffmpeg -nostdin -threads 0 -v error -i "$file" -f null - 2>&1)
        decode_exit=$?
        
        local decode_has_error=false
        if [[ $decode_exit -ne 0 ]]; then
            decode_has_error=true
        elif [[ -n "$decode_output" ]] && [[ "$decode_output" == *[Ee]rror* ]]; then
            decode_has_error=true
        fi

        if $decode_has_error; then
            has_error=true
            if [[ -n "$decode_output" ]]; then
                # Use bash string operations instead of external commands where possible
                local line_count=0
                while IFS= read -r line; do
                    ((line_count++))
                    [[ $line_count -le 20 ]] && errors+=("decode: $line")
                done <<< "$decode_output"
            else
                errors+=("decode: exited with status $decode_exit")
            fi
            if ! $JSON_MODE; then
                echo -e "${RED}✗ Decode errors${NC}"
                if [[ -n "$decode_output" ]]; then
                    local count=0
                    while IFS= read -r line; do
                        ((count++))
                        [[ $count -le 20 ]] && echo "    $line"
                    done <<< "$decode_output"
                    [[ $count -gt 20 ]] && echo "    ... (truncated, $count total lines)"
                else
                    echo "    Decoder exited with status $decode_exit"
                fi
            fi
        else
            if ! $JSON_MODE; then
                echo -e "${GREEN}✓${NC}"
                if [[ -n "$decode_output" ]] && $VERBOSE; then
                    echo "  Decoder notes:"
                    local count=0
                    while IFS= read -r line; do
                        ((count++))
                        [[ $count -le 20 ]] && echo "    $line"
                    done <<< "$decode_output"
                    [[ $count -gt 20 ]] && echo "    ... (truncated, $count total lines)"
                fi
            fi
        fi
    fi
    
    # Build JSON object for this file using bash string replacement
    local status="passed"
    $has_error && status="failed"
    
    local errors_json="[]"
    if [[ ${#errors[@]} -gt 0 ]]; then
        errors_json="["
        local first=true
        for err in "${errors[@]}"; do
            # Escape using bash parameter expansion (faster than sed)
            err="${err//\\/\\\\}"
            err="${err//\"/\\\"}"
            $first && first=false || errors_json+=","
            errors_json+="\"$err\""
        done
        errors_json+="]"
    fi
    
    # Escape file path using bash parameter expansion
    local escaped_file="${file//\\/\\\\}"
    escaped_file="${escaped_file//\"/\\\"}"
    
    # Output result
    if $has_error; then
        if ! $JSON_MODE; then
            echo -e "Result: ${RED}FAILED${NC}"
        fi
        echo "{\"path\":\"$escaped_file\",\"status\":\"$status\",\"errors\":$errors_json}" >> "$TMP_FAILED_FILE"
    else
        if ! $JSON_MODE; then
            echo -e "Result: ${GREEN}PASSED${NC}"
        fi
        echo "{\"path\":\"$escaped_file\",\"status\":\"$status\",\"errors\":$errors_json}" >> "$TMP_PASSED_FILE"
    fi
}

# Find video files using regex pattern (faster than multiple -iname)
VIDEO_EXTENSIONS_REGEX=".*\.\(mp4\|mkv\|avi\|mov\|wmv\|flv\|webm\|m4v\|mpeg\|mpg\|3gp\|ts\|mts\|m2ts\|ogv\|ogg\|vob\|divx\|xvid\|asf\|rm\|rmvb\|f4v\|swf\|dv\|qt\|yuv\|amv\|m2v\|mpv\|svi\|3g2\|mxf\|roq\|nsv\)$"

if ! $JSON_MODE; then
    echo "Video File Error Checker"
    echo "========================"
    echo "Directory: $DIRECTORY"
    if $QUICK_MODE; then
        echo "Mode: Quick (skipping full decode test)"
    fi
    if [[ $PARALLEL_JOBS -gt 1 ]]; then
        echo "Parallel jobs: $PARALLEL_JOBS"
    fi
    echo "Started: $(date)"
fi

# Initialize temp files
: > "$TMP_FAILED_FILE"
: > "$TMP_PASSED_FILE"

# Build file list first (enables counting and parallel processing)
files=()
if declare -F mapfile >/dev/null 2>&1; then
    mapfile -d '' files < <(find "$DIRECTORY" -type f -iregex "$VIDEO_EXTENSIONS_REGEX" -print0 2>/dev/null)
else
    while IFS= read -r -d '' file; do
        files+=("$file")
    done < <(find "$DIRECTORY" -type f -iregex "$VIDEO_EXTENSIONS_REGEX" -print0 2>/dev/null)
fi
total_files=${#files[@]}

if ! $JSON_MODE; then
    echo "Found $total_files video file(s) to check"
fi

# Process files with optional parallelism using background jobs
running_jobs=0
file_index=0
declare -a job_pids=()

for file in "${files[@]}"; do
    ((file_index++))
    
    if [[ $PARALLEL_JOBS -gt 1 ]]; then
        # Run in background for parallel processing
        check_video "$file" "$file_index" &
        job_pids+=($!)
        ((running_jobs++))
        
        # Wait if we've reached max parallel jobs
        if [[ $running_jobs -ge $PARALLEL_JOBS ]]; then
            wait "${job_pids[0]}"
            job_pids=("${job_pids[@]:1}")
            ((running_jobs--))
        fi
    else
        # Sequential processing
        check_video "$file" "$file_index"
    fi
done

# Wait for all background jobs to complete
if [[ $PARALLEL_JOBS -gt 1 ]]; then
    for pid in "${job_pids[@]}"; do
        wait "$pid"
    done
else
    wait
fi

# Collect results from temp files
passed=0
failed=0
[[ -s "$TMP_PASSED_FILE" ]] && passed=$(wc -l < "$TMP_PASSED_FILE" | tr -d ' ')
[[ -s "$TMP_FAILED_FILE" ]] && failed=$(wc -l < "$TMP_FAILED_FILE" | tr -d ' ')
total=$((passed + failed))

# Output results
if $JSON_MODE; then
    # Output JSON array
    echo "["
    first=true
    while IFS= read -r result; do
        [[ -z "$result" ]] && continue
        $first && first=false || echo ","
        echo -n "  $result"
    done < <(cat "$TMP_PASSED_FILE" "$TMP_FAILED_FILE" 2>/dev/null)
    echo ""
    echo "]"
else
    # Final summary
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "                      FINAL SUMMARY"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Total files checked: $total"
    echo -e "${GREEN}Passed: $passed${NC}"
    echo -e "${RED}Failed: $failed${NC}"

    # Print list of failed files
    if [[ -s "$TMP_FAILED_FILE" ]]; then
        echo ""
        echo "Files with errors:"
        while IFS= read -r line; do
            # Extract path from JSON using bash
            path="${line#*\"path\":\"}"
            path="${path%%\"*}"
            echo -e "  ${RED}✗${NC} $path"
        done < "$TMP_FAILED_FILE"
    fi

    echo ""
    echo "Completed: $(date)"
fi

# Exit with error code if any files failed
[[ $failed -gt 0 ]] && exit 1
exit 0
