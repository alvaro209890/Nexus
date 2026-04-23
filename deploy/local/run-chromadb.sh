#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$NEXUS_CHROMA_DATA_DIR"

exec "$NEXUS_VENV_DIR/bin/chroma" run --host 127.0.0.1 --port "${NEXUS_CHROMA_PORT:-8001}" --path "$NEXUS_CHROMA_DATA_DIR"
