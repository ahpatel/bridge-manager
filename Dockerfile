# syntax=docker/dockerfile:1

# Stage 1: Build everything (Go binaries)
FROM golang:1.25-bookworm AS builder

# Build bbctl
WORKDIR /build-bbctl
RUN apt-get update && apt-get install -y git bash
RUN git clone https://github.com/beeper/bridge-manager.git .
RUN CGO_ENABLED=0 ./build.sh

# Build our custom API server
WORKDIR /build-api
COPY container_src/go.mod ./
# (Optional: COPY container_src/go.sum ./ if it exists)
RUN go mod download || true
COPY container_src/*.go ./
RUN CGO_ENABLED=0 go build -o /server

# Stage 2: Final Runtime Image
FROM debian:bookworm-slim

# Install system dependencies for bridges
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    jq \
    git \
    ffmpeg \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    gcc \
    musl-dev \
    libffi-dev \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binaries from builder
COPY --from=builder /build-bbctl/bbctl /usr/local/bin/bbctl
COPY --from=builder /server /server

# Ensure binaries are executable
RUN chmod +x /usr/local/bin/bbctl /server

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
