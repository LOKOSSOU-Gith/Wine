#!/usr/bin/env bash
# Winlator PC Edition — préparation d'un GitHub Codespace (Ubuntu 24.04, x86_64).
# Installe Wine + Xvfb + x11vnc + noVNC. Un seul passage nécessaire (~3-5 min).
set -euo pipefail

echo "==> [1/4] Paquets Wine + écran virtuel"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  xvfb x11-utils xauth x11vnc xdotool \
  wine wine64 fonts-wine ca-certificates curl

echo "==> [2/4] Wine 32 bits (jeux anciens) — tolérant aux échecs"
sudo dpkg --add-architecture i386 2>/dev/null || true
sudo apt-get update -qq || true
sudo apt-get install -y --no-install-recommends wine32 2>/dev/null \
  || echo "  (wine32 indisponible — les apps 32 bits ne tourneront pas)"

echo "==> [3/4] Client noVNC"
if [ ! -d tools/noVNC ]; then
  git clone --depth 1 https://github.com/novnc/noVNC.git tools/noVNC
fi

echo "==> [4/4] Préchauffage du préfixe Wine (~30 s)"
export WINEPREFIX="$PWD/data/wineprefix"
export WINEDEBUG=-all
mkdir -p "$WINEPREFIX"
wineboot -i >/dev/null 2>&1 || echo "  (wineboot a eu un souci, non bloquant)"

echo ""
echo "✅ Codespace prêt. Démarre ensuite avec : bash cloud/start-codespace.sh"
