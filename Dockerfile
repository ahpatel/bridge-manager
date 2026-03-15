# syntax=docker/dockerfile:1

# Stage 1: Build everything (Go binaries)
FROM golang:1.25-alpine AS builder

# Build bbctl
WORKDIR /build-bbctl
RUN apk add --no-cache git bash
RUN git clone https://github.com/beeper/bridge-manager.git .
RUN ./build.sh

# Build our custom API server
WORKDIR /build-api
COPY container_src/go.mod ./
# (Optional: COPY container_src/go.sum ./ if it exists)
RUN go mod download || true
COPY container_src/*.go ./
RUN CGO_ENABLED=0 go build -o /server

# Stage 2: Final Runtime Image
FROM alpine:3.21

# Install system dependencies for bridges
RUN apk add --no-cache \
    bash \
    curl \
    jq \
    git \
    ffmpeg \
    python3 \
    py3-pip \
    py3-setuptools \
    py3-wheel \
    py3-aiohttp \
    py3-pillow \
    py3-ruamel.yaml \
    py3-magic \
    # Build dependencies for some python packages if needed
    gcc \
    musl-dev \
    python3-dev \
    libffi-dev \
    openssl-dev \
    ca-certificates

# Copy binaries from builder
COPY --from=builder /build-bbctl/bbctl /usr/local/bin/bbctl
COPY --from=builder /server /server

# Set up data directory for persistence
RUN mkdir -p /data
ENV HOME=/data
ENV XDG_CONFIG_HOME=/data/.config
ENV XDG_DATA_HOME=/data/.local/share
ENV XDG_CACHE_HOME=/data/.cache

WORKDIR /data

# Expose the API server port
EXPOSE 8080

# Run our custom API server which will manage bbctl
CMD ["/server"]
