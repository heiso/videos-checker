#!/bin/bash

# Videos Checker - Simple ffprobe-based video validation

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <directory> [-o report.json] [-j] [-f]"
    echo ""
    echo "Options:"
    echo "  -f, --full          Full check: decode entire file with ffmpeg (slower but thorough)"
    echo "  -o, --output FILE   Output JSON report to file"
    echo "  -j, --json          Output JSON to stdout (for piping)"
    echo "  -h, --help          Show this help"
    exit 1
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
OUTPUT=""
JSON_STDOUT=false
FULL_CHECK=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--full)
            FULL_CHECK=true
            shift
            ;;
        -o|--output)
            OUTPUT="$2"
            shift 2
            ;;
        -j|--json)
            JSON_STDOUT=true
            shift
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

TOTAL=$(echo "$FILES" | grep -c . || echo 0)

if [[ $TOTAL -eq 0 ]] || [[ -z "$FILES" ]]; then
    echo "No video files found." >&2
    if [[ "$JSON_STDOUT" == true ]]; then
        echo '{"files": []}'
    fi
    exit 0
fi

echo "Found $TOTAL video files:" >&2
echo "" >&2
echo "$FILES" >&2
echo "" >&2

# Wait for user confirmation (skip if JSON stdout mode)
if [[ "$JSON_STDOUT" != true ]]; then
    read -p "Press Enter to start checking, or Ctrl+C to cancel..."
    echo ""
fi

# Temp files for results
TEMP_JSON="/tmp/videos-checker-json.$$"
TEMP_ERRORS="/tmp/videos-checker-errors.$$"
rm -f "$TEMP_JSON" "$TEMP_ERRORS"

# Check each file
COUNT=0
while IFS= read -r FILE <&3; do
    if [[ -z "$FILE" ]]; then
        continue
    fi

    COUNT=$((COUNT + 1))
    FILENAME=$(basename "$FILE")
    printf "\r\033[K[%d/%d] Checking: %s" "$COUNT" "$TOTAL" "$FILENAME" >&2

    # Get duration with ffprobe
    PROBE_CMD="ffprobe -v error -show_entries format=duration -of json"
    PROBE_RESULT=$(ffprobe -v error -show_entries format=duration -of json "$FILE" 2>&1) || true
    DURATION=$(echo "$PROBE_RESULT" | grep -o '"duration": "[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")

    # Check for errors
    ERROR=""
    if [[ "$FULL_CHECK" == true ]]; then
        # Full check: decode entire file with ffmpeg
        # -nostdin prevents interactive prompts, -threads 0 uses all CPU cores
        CMD="ffmpeg -nostdin -threads 0 -v error -i \"$FILE\" -f null -"
        FFMPEG_RESULT=$(ffmpeg -nostdin -threads 0 -v error -i "$FILE" -f null - 2>&1) || true
        if [[ -n "$FFMPEG_RESULT" ]]; then
            ERROR=$(echo "$FFMPEG_RESULT" | tr '\n' ' ' | head -c 500)
        fi
    else
        # Quick check: just use ffprobe result
        CMD="$PROBE_CMD"
        if echo "$PROBE_RESULT" | grep -qi "error\|invalid\|corrupt"; then
            ERROR=$(echo "$PROBE_RESULT" | tr '\n' ' ')
        elif [[ -z "$DURATION" ]]; then
            ERROR="No duration found"
        fi
    fi

    # Build JSON entry
    ERROR_ESC=$(echo "$ERROR" | sed 's/"/\\"/g')
    if [[ -n "$DURATION" ]]; then
        printf '{"path": "%s", "duration": %s, "errors": "%s", "command": "%s \\"%s\\""}' \
            "$FILE" "$DURATION" "$ERROR_ESC" "$CMD" "$FILE" >> "$TEMP_JSON"
    else
        printf '{"path": "%s", "duration": null, "errors": "%s", "command": "%s \\"%s\\""}' \
            "$FILE" "$ERROR_ESC" "$CMD" "$FILE" >> "$TEMP_JSON"
    fi
    echo "" >> "$TEMP_JSON"

    # Track errors
    if [[ -n "$ERROR" ]]; then
        echo "$FILE: $ERROR" >> "$TEMP_ERRORS"
    fi
done 3<<< "$FILES"

# Clear progress line
printf "\r\033[K" >&2

# Build final JSON
JSON_OUTPUT='{"files": ['
FIRST=true
if [[ -f "$TEMP_JSON" ]]; then
    while IFS= read -r line; do
        if [[ -n "$line" ]]; then
            if [[ "$FIRST" == true ]]; then
                FIRST=false
                JSON_OUTPUT="$JSON_OUTPUT"$'\n'"  $line"
            else
                JSON_OUTPUT="$JSON_OUTPUT,"$'\n'"  $line"
            fi
        fi
    done < "$TEMP_JSON"
fi
JSON_OUTPUT="$JSON_OUTPUT"$'\n'"]}"

# Output JSON
if [[ "$JSON_STDOUT" == true ]]; then
    echo "$JSON_OUTPUT"
fi

if [[ -n "$OUTPUT" ]]; then
    echo "$JSON_OUTPUT" > "$OUTPUT"
fi

# Read errors from temp file
if [[ -f "$TEMP_ERRORS" ]]; then
    ERROR_COUNT=$(wc -l < "$TEMP_ERRORS" | tr -d ' ')
    ERROR_FILES=$(cat "$TEMP_ERRORS")
else
    ERROR_COUNT=0
fi

# Cleanup temp files
rm -f "$TEMP_JSON" "$TEMP_ERRORS"

# Summary (to stderr so it doesn't interfere with JSON piping)
echo "" >&2
echo "=== Summary ===" >&2
echo "Total files: $TOTAL" >&2
echo -e "OK: ${GREEN}$((TOTAL - ERROR_COUNT))${NC}" >&2
echo -e "Errors: ${RED}${ERROR_COUNT}${NC}" >&2

if [[ $ERROR_COUNT -gt 0 ]]; then
    echo "" >&2
    echo "=== Files with errors ===" >&2
    echo -e "${RED}${ERROR_FILES}${NC}" >&2
fi

if [[ -n "$OUTPUT" ]]; then
    echo "" >&2
    echo "Report written to: $OUTPUT" >&2
fi
