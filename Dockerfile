FROM alpine:3.19

RUN apk add --no-cache \
    bash \
    ffmpeg

COPY videos-checker.sh /usr/local/bin/videos-checker
RUN chmod +x /usr/local/bin/videos-checker

WORKDIR /data

ENTRYPOINT ["videos-checker"]
CMD ["--help"]
