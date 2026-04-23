#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
VENV_DIR="$BACKEND_DIR/.venv"
PYTORCH_CPU_INDEX_URL="https://download.pytorch.org/whl/cpu"

CONFIG_DIR="$HOME/.config/nexus"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
BIN_DIR="$CONFIG_DIR/bin"
STATE_DIR="$HOME/.local/state/nexus"
DOCUMENTS_DIR="${NEXUS_DOCUMENTS_DIR:-/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/BD_NEXUS}"
CHROMA_DATA_DIR="${NEXUS_CHROMA_DATA_DIR:-$STATE_DIR/chromadb}"
BACKEND_ENV_FILE="$CONFIG_DIR/backend.env"
RUNTIME_ENV_FILE="$CONFIG_DIR/runtime.env"
BACKEND_PORT="${NEXUS_BACKEND_PORT:-18000}"
CHROMA_PORT="${NEXUS_CHROMA_PORT:-18001}"

mkdir -p "$BIN_DIR" "$SYSTEMD_USER_DIR" "$STATE_DIR" "$DOCUMENTS_DIR" "$CHROMA_DATA_DIR"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install --upgrade pip
"$VENV_DIR/bin/pip" install --index-url "$PYTORCH_CPU_INDEX_URL" torch torchvision
"$VENV_DIR/bin/pip" install --extra-index-url "$PYTORCH_CPU_INDEX_URL" -r "$BACKEND_DIR/requirements.txt"

cat >"$RUNTIME_ENV_FILE" <<EOF
NEXUS_REPO_DIR=$REPO_DIR
NEXUS_BACKEND_DIR=$BACKEND_DIR
NEXUS_VENV_DIR=$VENV_DIR
NEXUS_DOCUMENTS_DIR=$DOCUMENTS_DIR
NEXUS_CHROMA_DATA_DIR=$CHROMA_DATA_DIR
NEXUS_BACKEND_PORT=$BACKEND_PORT
NEXUS_CHROMA_PORT=$CHROMA_PORT
NEXUS_TUNNEL_CONFIG=$CONFIG_DIR/cloudflared-nexus.yml
NEXUS_TUNNEL_NAME=nexus-local-api
NEXUS_TUNNEL_HOSTNAME=nexus-api.cursar.space
EOF

if [ ! -f "$BACKEND_ENV_FILE" ]; then
  cat >"$BACKEND_ENV_FILE" <<EOF
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
DOCUMENTS_DIR=$DOCUMENTS_DIR
CHROMA_HOST=127.0.0.1
CHROMA_PORT=$CHROMA_PORT
CHROMA_COLLECTION=nexus_documents
EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
CHAT_MEMORY_TURNS=20
NEXUS_CORS_ORIGINS=http://localhost:3000,https://nexus-98e32.web.app,https://nexus-98e32.firebaseapp.com,https://nexus.cursar.space
EOF
fi

install -m 0755 "$SCRIPT_DIR/run-backend.sh" "$BIN_DIR/run-backend.sh"
install -m 0755 "$SCRIPT_DIR/run-chromadb.sh" "$BIN_DIR/run-chromadb.sh"

cat >"$SYSTEMD_USER_DIR/nexus-chromadb.service" <<EOF
[Unit]
Description=Nexus ChromaDB
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=%h/.config/nexus/runtime.env
WorkingDirectory=$REPO_DIR
ExecStart=%h/.config/nexus/bin/run-chromadb.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat >"$SYSTEMD_USER_DIR/nexus-backend.service" <<EOF
[Unit]
Description=Nexus Backend
After=network-online.target nexus-chromadb.service
Wants=network-online.target nexus-chromadb.service
Requires=nexus-chromadb.service

[Service]
Type=simple
EnvironmentFile=%h/.config/nexus/runtime.env
EnvironmentFile=%h/.config/nexus/backend.env
WorkingDirectory=$BACKEND_DIR
ExecStart=%h/.config/nexus/bin/run-backend.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat >"$SYSTEMD_USER_DIR/nexus-cloudflared.service" <<EOF
[Unit]
Description=Nexus Cloudflare Tunnel
After=network-online.target nexus-backend.service
Wants=network-online.target
Requires=nexus-backend.service
PartOf=nexus-backend.service

[Service]
Type=simple
EnvironmentFile=%h/.config/nexus/runtime.env
ExecStart=/usr/bin/cloudflared --config %h/.config/nexus/cloudflared-nexus.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

if [ ! -f "$CONFIG_DIR/cloudflared-nexus.yml" ]; then
  cat >"$CONFIG_DIR/cloudflared-nexus.yml" <<EOF
# Configure este arquivo com deploy/local/setup-tunnel.sh.
# Este arquivo dedicado do Nexus nao altera o ~/.cloudflared/config.yml global.
tunnel: REPLACE_WITH_TUNNEL_ID
credentials-file: $HOME/.cloudflared/REPLACE_WITH_TUNNEL_ID.json

ingress:
  - hostname: nexus-api.cursar.space
    service: http://127.0.0.1:$BACKEND_PORT
  - service: http_status:404
EOF
fi

systemctl --user daemon-reload
systemctl --user enable --now nexus-chromadb.service nexus-backend.service

echo "Nexus backend and ChromaDB services installed."
echo "Edit $BACKEND_ENV_FILE to set GROQ_API_KEY if needed."
echo "Run deploy/local/setup-tunnel.sh to create the dedicated Cloudflare tunnel."
