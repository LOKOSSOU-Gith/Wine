#!/usr/bin/env bash
# Winlator PC Edition — démarrage du conteneur cloud (Render, etc.)
set -euo pipefail

echo "[cloud] Conteneur Winlator PC Edition"
echo "[cloud]   PORT=${PORT:-8799}  VNC=${VNC_ENABLED:-0}  token=${WINLATOR_TOKEN:+configuré}"

# Render fournit $PORT ; on le répercute sur la config du serveur.
export WINLATOR_PC_PORT="${PORT:-${WINLATOR_PC_PORT:-8799}}"

# Serveur X virtuel pour l'affichage des applications Wine.
XVFB_ARGS="-screen 0 ${VNC_GEOMETRY:-1280x720x24} -nolisten tcp"
if [ "${VNC_ENABLED:-0}" = "1" ]; then
  echo "[cloud] Démarrage de Xvfb sur :${VNC_DISPLAY_NUM:-99}"
  Xvfb ":${VNC_DISPLAY_NUM:-99}" $XVFB_ARGS >/tmp/xvfb.log 2>&1 &
  export VNC_DISPLAY=":${VNC_DISPLAY_NUM:-99}"
  export DISPLAY="$VNC_DISPLAY"
fi

# Attendre que Xvfb soit prêt.
for i in $(seq 1 50); do
  if xdpyinfo -display "${DISPLAY:-:99}" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

# Préchauffage optionnel du préfixe Wine au démarrage (évite le délai au 1er lancement).
if [ "${WINE_BOOT_ON_START:-0}" = "1" ]; then
  echo "[cloud] Initialisation du préfixe Wine (wineboot)…"
  export WINEPREFIX="${WINEPREFIX:-/app/data/containers/default}"
  mkdir -p "$WINEPREFIX"
  wineboot -i >/tmp/wineboot.log 2>&1 || echo "[cloud] wineboot a échoué (voir /tmp/wineboot.log)"
fi

echo "[cloud] Lancement du serveur Node sur 0.0.0.0:${WINLATOR_PC_PORT}"
exec node /app/server.js
