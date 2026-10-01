FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    WINLATOR_PC_PORT=8799 \
    WINLATOR_HOST=0.0.0.0 \
    VNC_ENABLED=1 \
    VNC_DISPLAY=:99 \
    VNC_PORT=5900

# Wine 64 bits + serveur X virtuel + VNC + petit outillage
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates gnupg wget \
      nodejs npm \
      wine wine64 wine32 \
      xvfb x11-utils xauth \
      x11vnc xdotool \
      procps tini \
      fonts-wine \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Code applicatif (le contexte de build est le dossier pc-edition)
COPY . /app/

# Client noVNC servi sous /vnc/ depuis le même serveur HTTP
RUN git clone --depth 1 https://github.com/novnc/noVNC.git /app/tools/noVNC \
    && chmod +x /app/cloud/start-cloud.sh

EXPOSE 8799

# tini permet d'arborer proprement Xvfb / Wine / x11vnc et d'accepter les signaux.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/cloud/start-cloud.sh"]
