'use strict';
// Winlator PC Edition - server.js : serveur HTTP + API REST, sans dépendance.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const store = require('./lib/store');
const runner = require('./lib/runner');
const vncproxy = require('./lib/vncproxy');

const WWW = path.join(__dirname, 'www');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

function send(res, code, data, type = 'application/json; charset=utf-8') {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { resolve({ _raw: raw }); }
    });
    req.on('error', () => resolve({}));
  });
}

function tail(file, maxLines = 200) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const lines = txt.split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch (_) { return ''; }
}

const routes = {
  'GET /api/state': () => ({
    ok: true,
    containers: store.listContainers(),
    apps: store.listApps(),
    runs: store.listRuns().slice(-20).reverse(),
    active: runner.listActive(),
    settings: store.getSettings(),
  }),

  'POST /api/containers': (q, body) => {
    const c = store.createContainer(body);
    return { ok: true, container: c };
  },
  'PATCH /api/containers/:id': (q, body) => {
    const c = store.updateContainer(q.id, body);
    return c ? { ok: true, container: c } : { ok: false, error: 'Conteneur introuvable.' };
  },
  'DELETE /api/containers/:id': (q) => store.deleteContainer(q.id),

  'POST /api/apps': (q, body) => {
    if (body.exePath && !fs.existsSync(body.exePath)) {
      return { ok: false, error: 'Exécutable introuvable : ' + body.exePath };
    }
    return store.createApp(body);
  },
  'PATCH /api/apps/:id': (q, body) => {
    const a = store.updateApp(q.id, body);
    return a ? { ok: true, app: a } : { ok: false, error: 'Application introuvable.' };
  },
  'DELETE /api/apps/:id': (q) => store.deleteApp(q.id),

  'POST /api/apps/:id/run': (q) => runner.startRun(q.id),
  'POST /api/apps/:id/run-wine': (q) => runner.startRun(q.id, { force: 'wine' }),
  'POST /api/runs/:id/stop': (q) => runner.stopRun(q.id),
  'GET /api/runs/:id/log': (q) => ({ ok: true, log: tail(store.logPath(q.id)) }),

  'GET /api/vnc-info': () => ({
    ok: true,
    enabled: vncproxy.enabled(),
    url: vncproxy.enabled()
      ? '/vnc/vnc.html?autoconnect=1&reconnect=1&resize=scale'
      : null,
  }),

  'POST /api/upload': (q, body) => {
    if (!body || !body.name || !body.data) return { ok: false, error: 'Fichier manquant (name, data base64).' };
    const safeName = path.basename(String(body.name)).replace(/[^\w .()\[\]-]/g, '_');
    if (!/\.(exe|msi|bat|cmd|zip|7z|rar)$/i.test(safeName)) {
      return { ok: false, error: 'Type non autorisé (.exe, .msi, .bat, .cmd, .zip, .7z, .rar).' };
    }
    const appsDir = path.join(store.DATA_DIR, 'apps');
    fs.mkdirSync(appsDir, { recursive: true });
    const dest = path.join(appsDir, safeName);
    try { fs.writeFileSync(dest, Buffer.from(body.data, 'base64')); }
    catch (e) { return { ok: false, error: 'Écriture impossible : ' + e.message }; }
    return { ok: true, path: dest, name: safeName };
  },
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);

  // --- Connexion par token (pose le cookie wl_token pour le navigateur) ---
  if (pathname === '/api/login') {
    const body = await readBody(req);
    if (!process.env.WINLATOR_TOKEN) return send(res, 400, { ok: false, error: 'Aucun token configuré (WINLATOR_TOKEN).' });
    if (body && body.token === process.env.WINLATOR_TOKEN) {
      res.setHeader('Set-Cookie', 'wl_token=' + encodeURIComponent(process.env.WINLATOR_TOKEN) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400');
      return send(res, 200, { ok: true });
    }
    return send(res, 401, { ok: false, error: 'Token invalide.' });
  }

  // --- Sonde de santé pour la plateforme (Render healthCheckPath) ---
  if (pathname === '/healthz') return send(res, 200, { ok: true, uptime: process.uptime() });

  // --- Auth cloud : tout est protégé sauf login, fichiers noVNC et santé ---
  const token = process.env.WINLATOR_TOKEN;
  const isPublic = pathname.startsWith('/vnc/') || pathname === '/healthz';
  if (token && !isPublic) {
    const cookie = (req.headers.cookie || '').match(/(?:^|;\s*)wl_token=([^;]+)/);
    const ok = req.headers['x-winlator-token'] === token
      || u.searchParams.get('token') === token
      || (cookie && cookie[1] === token);
    if (!ok) return send(res, 401, { ok: false, error: 'Token requis (x-winlator-token, ?token= ou cookie wl_token).' });
  }

  // API
  if (pathname.startsWith('/api/')) {
    const key = req.method + ' ' + pathname.replace(/\/api\//, '/api/');
    // normalisation : /api/apps/xyz/run -> motif avec :id
    const norm = req.method + ' /api/' + pathname.slice(5).split('/').map(s =>
      /^[0-9a-f-]{6,}$/i.test(s) || /^run-/.test(s) || /^ctr-/.test(s) || /^app-/.test(s) ? ':id' : s
    ).join('/');
    const handler = routes[norm] || routes[key];
    if (!handler) return send(res, 404, { ok: false, error: 'Route inconnue : ' + norm });

    const q = {};
    u.searchParams.forEach((v, k) => { q[k] = v; });
    const body = (req.method === 'POST' || req.method === 'PATCH') ? await readBody(req) : {};
    // injecte l'id depuis le chemin
    const parts = pathname.slice(5).split('/');
    if (parts.length >= 2) q.id = parts[1];

    try {
      const result = handler(q, body);
      return send(res, result && result.ok === false ? 400 : 200, result);
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message });
    }
  }

  // Fichiers statiques — noVNC est monté sous /vnc/
  let rootDir = WWW;
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file.startsWith('/vnc/')) {
    rootDir = path.join(__dirname, 'tools', 'noVNC');
    file = file.slice(4); // retire '/vnc' → '/vnc.html', '/core/rfb.js', …
  }
  file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
  const full = path.join(rootDir, file);
  if (!full.startsWith(rootDir)) return send(res, 403, { ok: false, error: 'Interdit' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Introuvable : ' + file, 'text/plain; charset=utf-8');
    const ext = path.extname(full).toLowerCase();
    send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

const settings = store.getSettings();
const PORT = Number(process.env.WINLATOR_PC_PORT || settings.port || 8799);
// Sur un PaaS (Render…), écouter sur 0.0.0.0 : le port est exposé par la plateforme.
const HOST = process.env.WINLATOR_HOST || '127.0.0.1';

// Si le VNC est activé, x11vnc démarre avec le serveur (pas à la 1re connexion).
if (vncproxy.enabled()) vncproxy.ensureVnc((l) => console.log(l));

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   🍷 Winlator PC Edition — serveur démarré   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('  Interface : http://localhost:' + PORT);
  console.log('  Données   : ' + store.DATA_DIR);
  console.log('  Sécurité  : ' + (process.env.WINLATOR_TOKEN ? 'token configuré ✓' : '⚠ WINLATOR_TOKEN non défini — API ouverte !'));
  console.log('  VNC       : ' + (vncproxy.enabled() ? 'activé → /vnc/vnc.html' : 'désactivé'));
  console.log('');
  console.log('  Astuce : lancez start.bat pour ouvrir la fenêtre app.');
  console.log('');
});

// Pont WebSocket noVNC : upgrade sur le même serveur HTTP (un seul port public).
server.on('upgrade', (req, socket, head) => {
  vncproxy.handleUpgrade(req, socket, head, (line) => console.log(line));
});

// Garde la session X/VNC bien vivante (utile sur PaaS avec proxy inactif).
if (vncproxy.enabled()) {
  const { execFile } = require('child_process');
  setInterval(() => { execFile('xdotool', ['getactivewindow'], () => {}); }, 45000).unref();
}

process.on('SIGINT', () => { console.log('\nArrêt du serveur.'); vncproxy.stopVnc(); process.exit(0); });
process.on('SIGTERM', () => { console.log('\nArrêt du serveur (SIGTERM).'); vncproxy.stopVnc(); process.exit(0); });
