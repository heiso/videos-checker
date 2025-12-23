# Videos Checker

A simple bash script to scan directories for video files and validate them using ffprobe.

> 🤖 Code mainly written by an LLM - use at your own risk

```bash
# Run
docker run -it -v /path/to/videos:/data heiso/videos-checker /data

# With JSON output
docker run -it -v /path/to/videos:/data heiso/videos-checker /data -j

# Save report
docker run -it -v /path/to/videos:/data -v $(pwd):/output heiso/videos-checker /data -o /output/report.json

# Full check (decode entire file - slower but thorough)
docker run -it -v /path/to/videos:/data heiso/videos-checker /data -f
```

## Options

| Option | Description |
|--------|-------------|
| `-f, --full` | Full check: decode entire file with ffmpeg (slower but detects corrupt frames) |
| `-o, --output FILE` | Save JSON report to file |
| `-j, --json` | Output JSON to stdout (for piping) |
| `-h, --help` | Show help |

## JSON Output Format

```json
{
  "files": [
    {
      "path": "/path/to/video.mp4",
      "duration": 120.5,
      "errors": "",
      "command": "ffprobe -v error -show_entries format=duration -of json \"/path/to/video.mp4\""
    }
  ]
}
```
