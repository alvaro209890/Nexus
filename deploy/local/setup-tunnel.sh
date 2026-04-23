#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/nexus"
RUNTIME_ENV_FILE="$CONFIG_DIR/runtime.env"

if [ ! -f "$RUNTIME_ENV_FILE" ]; then
  echo "Missing $RUNTIME_ENV_FILE. Run deploy/local/install-local-services.sh first." >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$RUNTIME_ENV_FILE" | head -n 1
}

TUNNEL_NAME="${1:-$(read_env_value NEXUS_TUNNEL_NAME)}"
HOSTNAME="${2:-$(read_env_value NEXUS_TUNNEL_HOSTNAME)}"
CONFIG_FILE="$CONFIG_DIR/cloudflared-nexus.yml"
BACKEND_PORT="$(read_env_value NEXUS_BACKEND_PORT)"

if [ -z "$BACKEND_PORT" ]; then
  BACKEND_PORT="18000"
fi

if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
  cloudflared tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID="$(cloudflared tunnel list | awk '$2=="'"$TUNNEL_NAME"'" {print $1; exit}')"
if [ -z "$TUNNEL_ID" ]; then
  echo "Could not resolve tunnel id for $TUNNEL_NAME." >&2
  exit 1
fi

CREDENTIALS_FILE="$HOME/.cloudflared/$TUNNEL_ID.json"
if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Missing tunnel credentials file: $CREDENTIALS_FILE" >&2
  exit 1
fi

cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME"

cat >"$CONFIG_FILE" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CREDENTIALS_FILE

ingress:
  - hostname: $HOSTNAME
    service: http://127.0.0.1:$BACKEND_PORT
  - service: http_status:404
EOF

systemctl --user daemon-reload
systemctl --user enable --now nexus-cloudflared.service

echo "Nexus tunnel configured for $HOSTNAME."
