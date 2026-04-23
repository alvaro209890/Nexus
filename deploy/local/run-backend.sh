#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$NEXUS_DOCUMENTS_DIR"
cd "$NEXUS_BACKEND_DIR"

exec "$NEXUS_VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port "${NEXUS_BACKEND_PORT:-18000}"
