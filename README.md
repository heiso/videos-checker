# Videos Checker

A simple bash script to scan directories for video files and validate them using ffprobe.

> Code mainly written by an LLM - use at your own risk

```bash
# Quick check (parallel ffprobe - fast)
docker run -it -v /path/to/videos:/data:ro -v $(pwd):/output heiso/videos-checker /data -o /output

# Full check (CPU-throttled ffmpeg decode - thorough)
docker run -it -v /path/to/videos:/data:ro -v $(pwd):/output heiso/videos-checker /data -o /output -f
```

## Options

| Option | Description |
|--------|-------------|
| `-o, --output DIR` | Output directory (required) |
| `-f, --full` | Full check: decode entire file with ffmpeg (CPU-throttled, slower but thorough) |
| `-h, --help` | Show help |

## Modes

- **Quick mode** (default): Runs 3/4 of CPU cores as parallel ffprobe jobs. Fast, checks file structure.
- **Full mode** (`-f`): CPU-throttled ffmpeg decode. Detects corrupt frames.

## Output Files

The script creates one file per mode:
- `report-quick.jsonl` - Quick mode results
- `report-full.jsonl` - Full mode results

Each line is a valid JSON object:

```json
{"path": "/path/to/video.mp4", "duration": 120.5, "errors": "", "command": "ffprobe ..."}
```

## Useful Commands

```bash
# List all files with errors
jq -r 'select(.errors != "") | .path' report-quick.jsonl

# Show errors with file paths
jq -r 'select(.errors != "") | "\(.path): \(.errors)"' report-quick.jsonl

# Count errors
jq -r 'select(.errors != "")' report-quick.jsonl | wc -l

# Count OK files
jq -r 'select(.errors == "")' report-quick.jsonl | wc -l

# Get unique error messages
jq -r 'select(.errors != "") | .errors' report-quick.jsonl | sort -u

# Export errors to CSV
jq -r 'select(.errors != "") | [.path, .errors] | @csv' report-quick.jsonl > errors.csv
```
