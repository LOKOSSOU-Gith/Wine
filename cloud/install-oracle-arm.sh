#!/usr/bin/env bash
# ============================================================
# Winlator PC Edition — installation native sur Oracle Cloud
# Always Free (Ubuntu 22.04/24.04 ARM64, shape Ampere A1).
#
# Installe : Node.js, Xvfb, x11vnc, Box64 (x86→ARM, la couche
# de Winlator) et Wine x86_64 (build Kron4ek), puis configure
# un service systemd. À la fin, l'interface écoute sur :8799.
#
# Usage (root ou sudo) :
#   bash install-oracle-arm.sh
# ============================================================
set -euo pipefail

if [ "$(id -u)" != "0" ]; then echo "Lance en root ou sudo."; exit 1; fi
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then echo "Ce script cible ARM64 (aarch64), archi détectée : $ARCH"; exit 1; fi

echo "==> [1/6] Paquets de base"
apt-get update -qq
apt-get install -y --no-install-recommends \
  curl ca-certificates xz-utils git \
  xvfb x11-utils xauth x11vnc xdotool \
  libasound2 libc6 libgcc-s1 libx11-6 fonts-wine

echo "==> [2/6] Node.js 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> [3/6] Box64 v0.4.4 (la couche x86→ARM de Winlator)"
if [ ! -x /usr/local/bin/box64 ]; then
  git clone --depth 1 --branch v0.4.4 https://github.com/ptitSeb/box64 /tmp/box64
  cd /tmp/box64
  # Prééréglage adapté aux petits serveurs (Oracle free : 2 vCPU)
  cmake -B build -DARM_DYNAREC=ON -DCMAKE_BUILD_TYPE=RelWithDebInfo
  cmake --build build -j2
  cmake --install build
  # Enregistre box64 dans binfmt_misc : les binaires x86_64 (ex : wineserver
  # lancé en interne par Wine) s'exécutent alors de façon transparente.
  if [ -f systemd/box64.conf ]; then
    mkdir -p /etc/binfmt.d
    cp systemd/box64.conf /etc/binfmt.d/box64.conf
    systemctl restart systemd-binfmt 2>/dev/null || true
  fi
  rm -rf /tmp/box64
  cd /
fi
box64 --version | head -1 || true

echo "==> [4/6] Wine x86_64 11.18 (build Kron4ek)"
WINE_DIR=/opt/wine-11.18
if [ ! -x "$WINE_DIR/bin/wine" ]; then
  curl -fL -o /tmp/wine.tar.xz \
    https://github.com/Kron4ek/Wine-Builds/releases/download/11.18/wine-11.18-amd64.tar.xz
  mkdir -p "$WINE_DIR"
  tar -xJf /tmp/wine.tar.xz -C "$WINE_DIR" --strip-components=1
  rm /tmp/wine.tar.xz
fi
"$WINE_DIR/bin/wine" --version

# Wrappers : passe systématiquement par box64 (sécurité même sans binfmt_misc).
for w in wine wineboot wineserver winecfg regsvr32 msiexec; do
  printf '#!/bin/sh\nexec box64 %s/bin/%s "$@"\n' "$WINE_DIR" "$w" > /usr/local/bin/$w
  chmod +x /usr/local/bin/$w
done

echo "==> [5/6] Déploiement de l'application"
APP_DIR=/opt/winlator-pc
mkdir -p "$APP_DIR"
# Le script peut être lancé depuis le dépôt cloné :
if [ -f "$(dirname "$0")/../server.js" ]; then
  cp -r "$(dirname "$0")"/../*.js "$APP_DIR/" 2>/dev/null || true
  cp -r "$(dirname "$0")"/../lib "$APP_DIR/"
  cp -r "$(dirname "$0")"/../www "$APP_DIR/"
  cp -r "$(dirname "$0")"/../assets "$APP_DIR/" 2>/dev/null || true
else
  echo "  (suppose que le dépôt est déjà copié dans $APP_DIR)"
fi
mkdir -p "$APP_DIR/data"
git clone --depth 1 https://github.com/novnc/noVNC.git "$APP_DIR/tools/noVNC" 2>/dev/null || true

cat > "$APP_DIR/.env" <<'ENVEOF'
VNC_ENABLED=1
VNC_DISPLAY=:99
VNC_GEOMETRY=1280x720x24
WINLATOR_PC_PORT=8799
WINLATOR_HOST=0.0.0.0
BOX64_LOG=0
WINEDEBUG=-all
# Génère un token si absent :
WINLATOR_TOKEN=__À_DÉFINIR__
ENVEOF
# Token auto si l'utilisateur ne l'a pas rempli
if grep -q "__À_DÉFINIR__" "$APP_DIR/.env"; then
  TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)
  sed -i "s/__À_DÉFINIR__/$TOKEN/" "$APP_DIR/.env"
  echo "  Token généré : $TOKEN"
fi

echo "==> [6/6] Service systemd"
cat > /etc/systemd/system/winlator-pc.service <<'UNIT'
[Unit]
Description=Winlator PC Edition (Wine + Box64 + noVNC)
After=network.target

[Service]
WorkingDirectory=/opt/winlator-pc
EnvironmentFile=/opt/winlator-pc/.env
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x720x24 -nolisten tcp
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/winlator-pc-node.service <<'UNIT2'
[Unit]
Description=Winlator PC Edition — serveur Node
After=winlator-pc.service
Requires=winlator-pc.service

[Service]
WorkingDirectory=/opt/winlator-pc
EnvironmentFile=/opt/winlator-pc/.env
Environment=DISPLAY=:99
ExecStart=/usr/bin/node /opt/winlator-pc/server.js
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT2

systemctl daemon-reload
systemctl enable --now winlator-pc winlator-pc-node

echo ""
echo "✅ Installation terminée."
echo "   Interface : http://$(curl -s ifconfig.me):8799"
echo "   Token     : voir /opt/winlator-pc/.env"
echo "   ⚠ Ouvre le port 8799 dans la console Oracle (VCN → Security Lists → Ingress)."
