'use strict';
// Winlator PC Edition - vncproxy.js : gère le serveur VNC local (x11vnc) et
// relie chaque WebSocket noVNC du navigateur à ce serveur via TCP local.
// Tout transite par le port HTTP unique → compatible Render / PaaS.
const { spawn } = require('child_process');
const net = require('net');
const wsproxy = require('./wsproxy');

const VNC_HOST = '127.0.0.1';
const VNC_PORT = Number(process.env.VNC_PORT || 5900);
const DISPLAY = process.env.VNC_DISPLAY || ':99';

let vncProc = null;

function enabled() {
  return process.env.VNC_ENABLED === '1';
}

// Démarre x11vnc une seule fois, lié à localhost (jamais exposé directement).
function ensureVnc(logger) {
  if (!enabled() || vncProc) return;
  const args = [
    '-display', DISPLAY,
    '-rfbport', String(VNC_PORT),
    '-localhost',   // écoute uniquement sur 127.0.0.1
    '-shared',      // plusieurs clients simultanés autorisés
    '-forever',     // ne pas quitter après la déconnexion d'un client
    '-nopw',        // pas de mot de passe VNC : l'auth est faite côté HTTP (token)
    '-noxdamage',
    '-quiet',
  ];
  try {
    vncProc = spawn('x11vnc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (logger) logger('[vncproxy] Échec du lancement de x11vnc : ' + e.message);
    vncProc = null;
    return;
  }
  const log = (tag) => (d) => { if (logger) logger('[x11vnc' + tag + '] ' + d.toString().trim()); };
  vncProc.stdout.on('data', log('.out'));
  vncProc.stderr.on('data', log('.err'));
  // ENOENT, etc. : ne jamais laisser tuer le serveur (utile hors Linux).
  vncProc.on('error', (e) => {
    if (logger) logger('[vncproxy] x11vnc indisponible : ' + e.message);
    vncProc = null;
  });
  vncProc.on('exit', (code, signal) => {
    if (logger) logger('[vncproxy] x11vnc terminé (code=' + code + (signal ? ', signal=' + signal : '') + ')');
    vncProc = null;
  });
  if (logger) logger('[vncproxy] x11vnc démarré sur ' + VNC_HOST + ':' + VNC_PORT + ' (display ' + DISPLAY + ')');
}

function stopVnc() {
  if (vncProc) { try { vncProc.kill(); } catch (_) {} vncProc = null; }
}

// Vérifie le token : query ?token=…, en-tête x-vnc-token, ou cookie wl_token.
function checkAuth(req) {
  const expected = process.env.WINLATOR_TOKEN;
  if (!expected) return false; // pas de token configuré → VNC désactivé
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.searchParams.get('token') === expected) return true;
  } catch (_) {}
  if (req.headers['x-vnc-token'] === expected) return true;
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/(?:^|;\s*)wl_token=([^;]+)/);
  return !!(m && m[1] === expected);
}

// Branche un WebSocket (client noVNC) sur le serveur VNC local.
function bridge(ws) {
  const upstream = net.connect(VNC_PORT, VNC_HOST);
  upstream.on('connect', () => {
    // Le flux VNC (RFB) est binaire dans les deux sens.
    // Serveur VNC -> navigateur : trames WebSocket binaires.
    upstream.on('data', (buf) => ws.send(buf));
  });
  // Navigateur -> serveur VNC : charges utiles déjà décodées par wsproxy.
  ws.onMessage = (buf) => { try { upstream.write(buf); } catch (_) {} };
  const cleanup = () => {
    try { upstream.destroy(); } catch (_) {}
    try { ws.close(); } catch (_) {}
  };
  upstream.on('error', cleanup);
  upstream.on('close', cleanup);
}

// Appelé par server.js sur l'événement 'upgrade' du serveur HTTP.
function handleUpgrade(req, socket, head, logger) {
  if (!enabled()) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (!checkAuth(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    if (logger) logger('[vncproxy] Upgrade refusé (token invalide) depuis ' + (req.socket.remoteAddress || '?'));
    return;
  }
  ensureVnc(logger);
  const ws = wsproxy.attach(req, socket, head, {
    onOpen: (w) => bridge(w),
    onClose: () => {},
    onMessage: (w, payload) => { if (w.onMessage) w.onMessage(payload); },
  });
  if (!ws) socket.destroy();
}

module.exports = { enabled, ensureVnc, stopVnc, handleUpgrade, checkAuth };
