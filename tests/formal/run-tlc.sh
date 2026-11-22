#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC_DIR="$ROOT/tests/formal"
TLA_VERSION="v1.8.0"
TLA_SHA256="fdffef247f563ef6edbfd44958d2a82db79e7564e07cb673262d896353fa6713"
CACHE_DIR="${TLA_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/tasktracker-tla}"
JAR_PATH="$CACHE_DIR/tla2tools-${TLA_VERSION}.jar"
CFG="${1:-BoardSync.cfg}"

mkdir -p "$CACHE_DIR"
if [ ! -f "$JAR_PATH" ]; then
  curl -fsSL -o "$JAR_PATH.tmp" "https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar"
  mv "$JAR_PATH.tmp" "$JAR_PATH"
fi

ACTUAL_SHA="$(sha256sum "$JAR_PATH" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$TLA_SHA256" ]; then
  echo "tla2tools.jar checksum mismatch: expected $TLA_SHA256, got $ACTUAL_SHA" >&2
  exit 1
fi

if command -v java >/dev/null 2>&1; then
  exec java -XX:+UseParallelGC -cp "$JAR_PATH" tlc2.TLC -workers auto -cleanup -config "$SPEC_DIR/$CFG" "$SPEC_DIR/BoardSync.tla"
elif command -v docker >/dev/null 2>&1; then
  exec docker run --rm \
    -v "$CACHE_DIR:/tools:ro" \
    -v "$SPEC_DIR:/work" \
    -w /work \
    eclipse-temurin:21-jre-alpine \
    java -XX:+UseParallelGC -cp "/tools/$(basename "$JAR_PATH")" tlc2.TLC -workers auto -cleanup -config "$CFG" BoardSync.tla
else
  echo "Neither java nor docker is installed. Install Java 21+ or Docker to run TLC." >&2
  exit 127
fi
