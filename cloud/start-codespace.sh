#!/usr/bin/env bash
# Winlator PC Edition — démarrage dans un GitHub Codespace.
# Usage :  bash cloud/start-codespace.sh
# Puis ouvre le port 8799 dans l'onglet « Ports » de VS Code.
set -euo pipefail
cd "$(dirname "$0")/.."

# Token par défaut du codespace (change-le si tu rends le port public).
export WINLATOR_TOKEN="${WINLATOR_TOKEN:-codespace}"
export WINLATOR_HOST="0.0.0.0"
export WINLATOR_PC_PORT="${WINLATOR_PC_PORT:-8799}"
export VNC_ENABLED="${VNC_ENABLED:-1}"
export VNC_DISPLAY=":99"
export WINEPREFIX="${WINEPREFIX:-$PWD/data/wineprefix}"
export WINEDEBUG="-all"
export DISPLAY=":99"

# Xvfb s'il ne tourne pas déjà
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "==> Démarrage de Xvfb (:99)"
  Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
  sleep 1
fi

mkdir -p "$WINEPREFIX"
echo "==> Serveur sur le port $WINLATOR_PC_PORT (token: $WINLATOR_TOKEN)"
node server.js
