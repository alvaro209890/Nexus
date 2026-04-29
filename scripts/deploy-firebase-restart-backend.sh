#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/media/server/HD Backup/Servidores_NAO_MEXA/Nexus"
BACKEND_SERVICE="nexus-backend.service"
BACKEND_PORT="${NEXUS_BACKEND_PORT:-18000}"
FIREBASE_PROJECT="${FIREBASE_PROJECT:-nexus-98e32}"
LOG_DIR="$PROJECT_DIR/.run-logs"
LOG_FILE="$LOG_DIR/deploy-firebase-restart-backend-$(date +%Y%m%d-%H%M%S).log"
MAIN_BRANCH="main"
REMOTE_NAME="origin"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  echo
  echo "Falha na atualizacao do Nexus. Codigo: $exit_code"
  echo "Log: $LOG_FILE"
  echo
  read -r -p "Pressione Enter para fechar..." _
  exit "$exit_code"
}
trap on_error ERR

echo "Nexus - deploy Firebase + restart backend + GitHub"
echo "Projeto: $PROJECT_DIR"
echo "Log: $LOG_FILE"
echo

cd "$PROJECT_DIR"

require_command() {
  local command_name="$1"
  local install_hint="${2:-}"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name nao encontrado no PATH."
    if [ -n "$install_hint" ]; then
      echo "$install_hint"
    fi
    exit 1
  fi
}

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || true
fi

require_command python3
require_command npm
require_command firebase "Instale com: npm install -g firebase-tools"
require_command git

echo "[1/7] Garantindo branch principal '$MAIN_BRANCH'..."
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Este diretorio nao e um repositorio Git."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]; then
  echo "Branch atual: ${CURRENT_BRANCH:-detached}. Alternando para '$MAIN_BRANCH'..."
  git switch "$MAIN_BRANCH"
fi

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo "Sincronizando com $REMOTE_NAME/$MAIN_BRANCH..."
  git pull --rebase --autostash "$REMOTE_NAME" "$MAIN_BRANCH"
else
  echo "Remote '$REMOTE_NAME' nao configurado."
  exit 1
fi

echo
echo "[2/7] Validando backend..."
python3 -m py_compile backend/main.py

echo
echo "[3/7] Gerando build estatico do frontend..."
npm --prefix frontend run build

echo
echo "[4/7] Publicando frontend no Firebase Hosting..."
firebase deploy --only hosting --project "$FIREBASE_PROJECT"

echo
echo "[5/7] Reiniciando backend local..."
if systemctl --user list-unit-files --type=service 2>/dev/null | grep -q "^${BACKEND_SERVICE}"; then
  systemctl --user restart "$BACKEND_SERVICE"
  systemctl --user --no-pager --full status "$BACKEND_SERVICE" || true
else
  echo "Servico $BACKEND_SERVICE nao encontrado. Reiniciando uvicorn local na porta $BACKEND_PORT..."
  if pgrep -f "uvicorn main:app.*${BACKEND_PORT}" >/dev/null 2>&1; then
    pkill -f "uvicorn main:app.*${BACKEND_PORT}" || true
    sleep 2
  fi
  if [ ! -x backend/.venv/bin/uvicorn ]; then
    echo "backend/.venv/bin/uvicorn nao encontrado."
    echo "Instale o backend ou rode: deploy/local/install-local-services.sh"
    exit 1
  fi
  (cd backend && nohup .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" > /tmp/nexus-backend.log 2>&1 &)
  sleep 2
  pgrep -af "uvicorn main:app.*${BACKEND_PORT}" || true
fi

echo
echo "[6/7] Commit automatico..."
git add backend frontend firebase.json scripts "Atualizar_Nexus_Firebase_Backend.desktop"
git reset -- backend/.env frontend/.env.local >/dev/null 2>&1 || true

if git diff --cached --quiet; then
  echo "Nenhuma alteracao para commitar."
else
  COMMIT_MESSAGE="Atualizacao automatica Nexus $(date +%Y-%m-%d\ %H:%M:%S)"
  git commit -m "$COMMIT_MESSAGE"
fi

echo
echo "[7/7] Push para $REMOTE_NAME/$MAIN_BRANCH..."
git push "$REMOTE_NAME" "$MAIN_BRANCH"

echo
echo "Concluido com sucesso."
echo "Frontend publicado no Firebase Hosting."
echo "Projeto enviado para $REMOTE_NAME/$MAIN_BRANCH."
echo "Backend reiniciado."
echo "Log: $LOG_FILE"
echo
read -r -p "Pressione Enter para fechar..." _
