#!/bin/bash

# Videos Checker - Simple ffprobe-based video validation

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <directory> -o <output_dir> [-f]"
    echo ""
    echo "Options:"
    echo "  -o, --output DIR    Output directory (required)"
    echo "  -f, --full          Full check: decode entire file with ffmpeg (slower but thorough)"
    echo "  -h, --help          Show this help"
    exit 1
}

# Get current CPU usage percentage (0-100) by sampling over 1 second
get_cpu_usage() {
    if [[ -f /proc/stat ]]; then
        # Linux: sample /proc/stat twice to get actual usage
        read -r _ USER1 NICE1 SYSTEM1 IDLE1 _ < /proc/stat
        sleep 1
        read -r _ USER2 NICE2 SYSTEM2 IDLE2 _ < /proc/stat

        local IDLE_DELTA=$((IDLE2 - IDLE1))
        local TOTAL_DELTA=$(( (USER2 + NICE2 + SYSTEM2 + IDLE2) - (USER1 + NICE1 + SYSTEM1 + IDLE1) ))

        if [[ $TOTAL_DELTA -gt 0 ]]; then
            echo $(( (TOTAL_DELTA - IDLE_DELTA) * 100 / TOTAL_DELTA ))
        else
            echo 0
        fi
    else
        # macOS: get from top (already gives current usage)
        top -l 1 -s 0 2>/dev/null | awk '/CPU usage/ {print int($3)}' || echo 0
    fi
}

# Check if ffprobe is installed
if ! command -v ffprobe &> /dev/null; then
    echo -e "${RED}Error: ffprobe is not installed${NC}" >&2
    exit 1
fi

# Check if ffmpeg is installed (needed for full check)
if ! command -v ffmpeg &> /dev/null; then
    echo -e "${RED}Error: ffmpeg is not installed${NC}" >&2
    exit 1
fi

# Parse arguments
DIRECTORY=""
OUTPUT_DIR=""
FULL_CHECK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--full)
            FULL_CHECK=true
            shift
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            if [[ -z "$DIRECTORY" ]]; then
                DIRECTORY="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$DIRECTORY" ]]; then
    usage
fi

if [[ ! -d "$DIRECTORY" ]]; then
    echo -e "${RED}Error: '$DIRECTORY' is not a directory${NC}" >&2
    exit 1
fi

# Find video files (macOS compatible)
echo "Scanning for video files..." >&2
FILES=$(find "$DIRECTORY" -type f \( \
    -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" \
    -o -iname "*.webm" -o -iname "*.wmv" -o -iname "*.flv" -o -iname "*.m4v" \
    -o -iname "*.mpg" -o -iname "*.mpeg" -o -iname "*.3gp" -o -iname "*.3g2" \
    -o -iname "*.mts" -o -iname "*.m2ts" -o -iname "*.ts" -o -iname "*.vob" \
    -o -iname "*.ogv" -o -iname "*.mxf" -o -iname "*.rm" -o -iname "*.rmvb" \
    -o -iname "*.asf" -o -iname "*.divx" -o -iname "*.f4v" \
    \) 2>/dev/null | sort)

if [[ -z "$FILES" ]]; then
    TOTAL=0
else
    TOTAL=$(printf '%s' "$FILES" | grep -c . || echo 0)
fi

if [[ $TOTAL -eq 0 ]] || [[ -z "$FILES" ]]; then
    echo "No video files found." >&2
    exit 0
fi

# Validate output directory
if [[ -z "$OUTPUT_DIR" ]]; then
    echo -e "${RED}Error: Output directory (-o) is required${NC}" >&2
    exit 1
fi

if [[ ! -d "$OUTPUT_DIR" ]]; then
    echo -e "${RED}Error: '$OUTPUT_DIR' is not a directory${NC}" >&2
    exit 1
fi

# Set output file and temp directory
if [[ "$FULL_CHECK" == true ]]; then
    OUTPUT="$OUTPUT_DIR/report-full.jsonl"
else
    OUTPUT="$OUTPUT_DIR/report-quick.jsonl"
fi
TEMP_DIR="$OUTPUT_DIR/.videos-checker-$$"
mkdir -p "$TEMP_DIR"

# Load already-checked files from existing report
CHECKED_FILES=""

# Function to validate and clean a report file
clean_report() {
    local FILE="$1"
    if [[ ! -f "$FILE" ]]; then
        return
    fi

    local VALID_LINES=""
    local INVALID_COUNT=0
    while IFS= read -r LINE; do
        if [[ -z "$LINE" ]]; then
            continue
        fi
        if echo "$LINE" | grep -q '"path":.*}$'; then
            VALID_LINES="$VALID_LINES$LINE"$'\n'
        else
            INVALID_COUNT=$((INVALID_COUNT + 1))
        fi
    done < "$FILE"

    if [[ $INVALID_COUNT -gt 0 ]]; then
        echo "Removed $INVALID_COUNT broken lines from $(basename "$FILE")" >&2
        echo -n "$VALID_LINES" > "$FILE"
    fi
}

# Clean report file
clean_report "$OUTPUT"

# Collect checked files from existing report
if [[ -f "$OUTPUT" ]]; then
    CHECKED_FILES=$(grep -o '"path": "[^"]*"' "$OUTPUT" 2>/dev/null | cut -d'"' -f4 || true)
fi

if [[ -z "$CHECKED_FILES" ]]; then
    CHECKED_COUNT=0
else
    CHECKED_COUNT=$(printf '%s' "$CHECKED_FILES" | grep -c . 2>/dev/null || echo 0)
fi
if [[ "$CHECKED_COUNT" -gt 0 ]]; then
    echo "Found $CHECKED_COUNT files already checked" >&2
fi

# Filter out already-checked files
if [[ -n "$CHECKED_FILES" ]]; then
    FILTERED_FILES=""
    while IFS= read -r FILE; do
        if [[ -z "$FILE" ]]; then
            continue
        fi
        if ! echo "$CHECKED_FILES" | grep -Fxq "$FILE"; then
            FILTERED_FILES="$FILTERED_FILES$FILE"$'\n'
        fi
    done <<< "$FILES"
    FILES="$FILTERED_FILES"
fi

# Recount after filtering
if [[ -z "$FILES" ]]; then
    TOTAL=0
else
    TOTAL=$(printf '%s' "$FILES" | grep -c . 2>/dev/null || echo 0)
fi

if [[ -z "$TOTAL" ]] || [[ "$TOTAL" -eq 0 ]]; then
    echo "All files already checked!" >&2
    exit 0
fi

echo "$TOTAL files remaining to check" >&2
echo "Report: $(basename "$OUTPUT")" >&2
echo "" >&2

# Export variables for parallel jobs
export TEMP_DIR FULL_CHECK TOTAL

# Counter file for progress tracking
COUNTER_FILE="$TEMP_DIR/counter"
echo "0" > "$COUNTER_FILE"
export COUNTER_FILE

# Lock file for synchronized file writes
LOCK_FILE="$TEMP_DIR/lock"
export LOCK_FILE

# Check if we can write to the output location
if [[ ! -w "$OUTPUT_DIR" ]]; then
    echo -e "${RED}Error: Cannot write to '$OUTPUT_DIR' (read-only or permission denied)${NC}" >&2
    echo "Tip: In Docker, mount a writable volume: -v \$(pwd):/output" >&2
    exit 1
fi
# Touch file to ensure it exists (append mode, don't truncate)
touch "$OUTPUT"
export OUTPUT

# Cleanup trap
cleanup() {
    # Kill any background jobs
    jobs -p | xargs -r kill 2>/dev/null || true
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

interrupted() {
    echo -e "\n\nInterrupted!" >&2
    exit 130
}
trap interrupted INT TERM

# Function to check one file (used by both sequential and parallel modes)
check_one_file() {
    local FILE="$1"
    local FULL_CHECK="$2"
    local TEMP_DIR="$3"

    # Create unique temp file based on file path hash
    local HASH=$(echo "$FILE" | md5sum | cut -c1-16 2>/dev/null || echo "$FILE" | md5 | cut -c1-16)
    local RESULT_FILE="$TEMP_DIR/result-$HASH.json"

    # Get duration with ffprobe
    local PROBE_RESULT=$(ffprobe -v error -show_entries format=duration -of json "$FILE" 2>&1) || true
    local DURATION=$(echo "$PROBE_RESULT" | grep -o '"duration": "[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")

    # Check for errors
    local ERROR=""
    local CMD=""
    if [[ "$FULL_CHECK" == "true" ]]; then
        CMD="ffmpeg -nostdin -threads 0 -thread_type frame -v error -i \"$FILE\" -f null -"
        local FFMPEG_RESULT=$(ffmpeg -nostdin -threads 0 -thread_type frame -v error -i "$FILE" -f null - 2>&1) || true
        if [[ -n "$FFMPEG_RESULT" ]]; then
            ERROR=$(echo "$FFMPEG_RESULT" | tr '\n' ' ' | head -c 500)
        fi
    else
        CMD="ffprobe -v error -show_entries format=duration -of json"
        if echo "$PROBE_RESULT" | grep -qi "error\|invalid\|corrupt"; then
            ERROR=$(echo "$PROBE_RESULT" | tr '\n' ' ')
        elif [[ -z "$DURATION" ]]; then
            ERROR="No duration found"
        fi
    fi

    # Escape for JSON
    local ERROR_ESC=$(echo "$ERROR" | sed 's/"/\\"/g' | sed "s/'/\\'/g")
    local FILE_ESC=$(echo "$FILE" | sed 's/"/\\"/g')
    local CMD_ESC=$(echo "$CMD" | sed 's/"/\\"/g')

    # Build JSON result
    local JSON_RESULT
    if [[ -n "$DURATION" ]]; then
        JSON_RESULT=$(printf '{"path": "%s", "duration": %s, "errors": "%s", "command": "%s"}' \
            "$FILE_ESC" "$DURATION" "$ERROR_ESC" "$CMD_ESC")
    else
        JSON_RESULT=$(printf '{"path": "%s", "duration": null, "errors": "%s", "command": "%s"}' \
            "$FILE_ESC" "$ERROR_ESC" "$CMD_ESC")
    fi

    # Write to temp file (for final aggregation/summary)
    echo "$JSON_RESULT" > "$RESULT_FILE"

    # Append to output file (with lock for parallel safety)
    (
        flock -x 200 2>/dev/null || true  # flock may not exist on all systems
        echo "$JSON_RESULT" >> "$OUTPUT"
    ) 200>"$LOCK_FILE"

    # Update counter atomically and print progress
    local CURRENT
    if [[ -f "$COUNTER_FILE" ]]; then
        # Use flock for atomic increment (macOS/Linux compatible approach)
        CURRENT=$(( $(cat "$COUNTER_FILE") + 1 ))
        echo "$CURRENT" > "$COUNTER_FILE"
    else
        CURRENT="?"
    fi

    local FILENAME=$(basename "$FILE")
    if [[ -n "$ERROR" ]]; then
        printf "\r\033[K[%s/%s] ✗ %s\n" "$CURRENT" "$TOTAL" "$FILENAME" >&2
    else
        printf "\r\033[K[%s/%s] ✓ %s\n" "$CURRENT" "$TOTAL" "$FILENAME" >&2
    fi
}

# Export function for xargs
export -f check_one_file

# Track start time for rate calculation
START_TIME=$(date +%s)

# Run checks
if [[ "$FULL_CHECK" == true ]]; then
    # Full mode: CPU-based throttling with max cap
    MAX_CPU=85
    if [[ -f /proc/cpuinfo ]]; then
        CPU_CORES=$(grep -c ^processor /proc/cpuinfo)
    elif command -v sysctl &> /dev/null; then
        CPU_CORES=$(sysctl -n hw.ncpu)
    else
        CPU_CORES=4
    fi
    MAX_JOBS=$((CPU_CORES * 3 / 4))
    [[ $MAX_JOBS -lt 1 ]] && MAX_JOBS=1

    echo "Full check mode: CPU-throttled (< ${MAX_CPU}%, max $MAX_JOBS jobs)" >&2
    echo "" >&2

    # Build file array
    FILE_ARRAY=()
    while IFS= read -r F; do
        [[ -n "$F" ]] && FILE_ARRAY+=("$F")
    done <<< "$FILES"

    FILE_INDEX=0
    COMPLETED=0
    declare -a PIDS=()
    LOW_CPU_COUNT=0
    REQUIRED_LOW_COUNT=2

    while [[ $FILE_INDEX -lt ${#FILE_ARRAY[@]} ]] || [[ ${#PIDS[@]} -gt 0 ]]; do
        # Clean up finished jobs and count completions
        NEW_PIDS=()
        for PID in "${PIDS[@]}"; do
            if kill -0 "$PID" 2>/dev/null; then
                NEW_PIDS+=("$PID")
            else
                COMPLETED=$((COMPLETED + 1))
            fi
        done
        PIDS=("${NEW_PIDS[@]}")
        RUNNING=${#PIDS[@]}

        # Calculate jobs/minute
        ELAPSED=$(( $(date +%s) - START_TIME ))
        if [[ $ELAPSED -gt 0 ]] && [[ $COMPLETED -gt 0 ]]; then
            RATE=$(( COMPLETED * 60 / ELAPSED ))
        else
            RATE=0
        fi

        # Try to spawn a new job if we have files left
        if [[ $FILE_INDEX -lt ${#FILE_ARRAY[@]} ]]; then
            CPU_USAGE=$(get_cpu_usage)

            # Check CPU threshold AND max jobs cap
            if [[ $CPU_USAGE -lt $MAX_CPU ]] && [[ $RUNNING -lt $MAX_JOBS ]]; then
                LOW_CPU_COUNT=$((LOW_CPU_COUNT + 1))

                if [[ $RUNNING -eq 0 ]] || [[ $LOW_CPU_COUNT -ge $REQUIRED_LOW_COUNT ]]; then
                    FILE="${FILE_ARRAY[$FILE_INDEX]}"
                    printf "\r\033[K[CPU: %d%% | Jobs: %d/%d | %d/min] Starting new job..." "$CPU_USAGE" "$RUNNING" "$MAX_JOBS" "$RATE" >&2
                    check_one_file "$FILE" "$FULL_CHECK" "$TEMP_DIR" &
                    PIDS+=($!)
                    FILE_INDEX=$((FILE_INDEX + 1))
                    LOW_CPU_COUNT=0
                else
                    printf "\r\033[K[CPU: %d%% | Jobs: %d/%d | %d/min] Low for %ds/%ds..." "$CPU_USAGE" "$RUNNING" "$MAX_JOBS" "$RATE" "$LOW_CPU_COUNT" "$REQUIRED_LOW_COUNT" >&2
                fi
            else
                LOW_CPU_COUNT=0
                if [[ $RUNNING -ge $MAX_JOBS ]]; then
                    printf "\r\033[K[CPU: %d%% | Jobs: %d/%d | %d/min] Max jobs reached..." "$CPU_USAGE" "$RUNNING" "$MAX_JOBS" "$RATE" >&2
                else
                    printf "\r\033[K[CPU: %d%% | Jobs: %d/%d | %d/min] Waiting (CPU >= %d%%)..." "$CPU_USAGE" "$RUNNING" "$MAX_JOBS" "$RATE" "$MAX_CPU" >&2
                fi
            fi
        else
            printf "\r\033[K[Jobs: %d | %d/min] Waiting for remaining jobs..." "$RUNNING" "$RATE" >&2
        fi

        sleep 1
    done

    wait
    echo "" >&2
else
    # Quick mode: run concurrent jobs (3/4 of cores)
    if [[ -f /proc/cpuinfo ]]; then
        CPU_CORES=$(grep -c ^processor /proc/cpuinfo)
    elif command -v sysctl &> /dev/null; then
        CPU_CORES=$(sysctl -n hw.ncpu)
    else
        CPU_CORES=4
    fi
    PARALLEL_JOBS=$((CPU_CORES * 3 / 4))
    [[ $PARALLEL_JOBS -lt 1 ]] && PARALLEL_JOBS=1
    echo "Quick check mode: $PARALLEL_JOBS parallel jobs" >&2
    echo "" >&2
    echo "$FILES" | xargs -P "$PARALLEL_JOBS" -I {} bash -c 'check_one_file "$@"' _ {} "$FULL_CHECK" "$TEMP_DIR"
fi

# Count errors from temp files for summary
ERROR_COUNT=0
ERROR_FILES=""
PROCESSED=0

for RESULT_FILE in "$TEMP_DIR"/result-*.json; do
    if [[ -f "$RESULT_FILE" ]]; then
        CONTENT=$(cat "$RESULT_FILE")
        PROCESSED=$((PROCESSED + 1))

        # Check for errors in this result
        if echo "$CONTENT" | grep -q '"errors": "[^"]'; then
            ERROR_COUNT=$((ERROR_COUNT + 1))
            FILE_PATH=$(echo "$CONTENT" | grep -o '"path": "[^"]*"' | cut -d'"' -f4)
            ERROR_MSG=$(echo "$CONTENT" | grep -o '"errors": "[^"]*"' | cut -d'"' -f4)
            ERROR_FILES="$ERROR_FILES$FILE_PATH: $ERROR_MSG"$'\n'
        fi
    fi
done

# Summary
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
if [[ $ELAPSED -gt 0 ]] && [[ $PROCESSED -gt 0 ]]; then
    FINAL_RATE=$((PROCESSED * 60 / ELAPSED))
else
    FINAL_RATE=0
fi

echo "" >&2
echo "=== Summary ===" >&2
echo "Processed: $PROCESSED / $TOTAL" >&2
echo -e "OK: ${GREEN}$((PROCESSED - ERROR_COUNT))${NC}" >&2
echo -e "Errors: ${RED}${ERROR_COUNT}${NC}" >&2
echo "Time: ${ELAPSED}s (~${FINAL_RATE} jobs/min)" >&2

if [[ $ERROR_COUNT -gt 0 ]]; then
    echo "" >&2
    echo "=== Files with errors ===" >&2
    echo -e "${RED}${ERROR_FILES}${NC}" >&2
fi

echo "" >&2
echo "Report: $OUTPUT" >&2
