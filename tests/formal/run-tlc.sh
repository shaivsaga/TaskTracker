#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC_DIR="$ROOT/tests/formal"
# Pin the latest finalized stable release (v1.7.4, tag commit 5a47802b5c391f59ecdd44117981f4ff8c0656ba).
# The previous v1.8.0 pin targeted a mutable prerelease whose tla2tools.jar asset was re-uploaded
# on 2026-11-26, breaking checksum verification on clean CI runners.
# Upstream v1.7.4 release-notes SHA-1: bee4a54f3ee3d4afc347c3240ec2d9e93b075104.
TLA_VERSION="v1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
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
