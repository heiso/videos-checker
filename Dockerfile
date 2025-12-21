# Video Checker Docker Image
# Lightweight Alpine-based image with ffmpeg and ffprobe

FROM alpine:3.19

# Install ffmpeg (includes ffprobe) and bash
RUN apk add --no-cache \
  ffmpeg \
  bash

# Create a directory for videos to be mounted
RUN mkdir -p /videos

# Copy the check script
COPY check_videos.sh /usr/local/bin/check_videos.sh

# Make sure it's executable
RUN chmod +x /usr/local/bin/check_videos.sh

# Set working directory
WORKDIR /videos

ENTRYPOINT [ "/usr/local/bin/check_videos.sh" ]
CMD [ "--help" ]