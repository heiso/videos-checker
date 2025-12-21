# Video Checker

A Docker-based tool to check video files for errors using ffprobe and ffmpeg.

> 🤖 This project was mainly built with the help of AI.

## Build the Docker Image

```bash
docker build -t video-checker .
```

## Usage

### Check videos in a directory

```bash
# Mount your videos directory and check all videos (recursive by default)
docker run --rm -v /path/to/your/videos:/videos video-checker /videos

# With verbose output
docker run --rm -v /path/to/your/videos:/videos video-checker -v /videos
```

Only files that exhibit errors are listed; all others are summarized at the end.

### Show help

```bash
docker run --rm video-checker --help
```

## Options

| Option | Description |
|--------|-------------|
| `-p, --parallel N` | Process N files in parallel (default: 1) |
| `-q, --quick` | Skip full decode test (faster but less thorough) |
| `-j, --json` | Output results in JSON format |
| `-v, --verbose` | Show detailed output |
| `-h, --help` | Show help message |

## Performance Tips

- Use `-p 4` (or higher) to process multiple files simultaneously on multi-core systems
- Use `-q` (quick mode) to skip the full decode test - faster but may miss some errors
- Combine both: `-p 4 -q` for maximum speed

## Supported Formats

mp4, mkv, avi, mov, wmv, flv, webm, m4v, mpeg, mpg, 3gp, ts, mts, m2ts, ogv, ogg, vob, divx, xvid, asf, rm, rmvb, f4v, swf, dv, qt, yuv, amv, m2v, mpv, svi, 3g2, mxf, roq, nsv
