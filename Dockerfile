FROM alpine:3.19

RUN apk add --no-cache \
  bash \
  ffmpeg \
  tini \
  coreutils

COPY videos-checker.sh /usr/local/bin/videos-checker
RUN chmod +x /usr/local/bin/videos-checker

WORKDIR /data

ENTRYPOINT ["/sbin/tini", "--", "videos-checker"]
CMD ["--help"]
