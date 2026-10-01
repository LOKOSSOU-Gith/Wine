'use strict';
// Test fumée du serveur complet : santé, auth, upload, création d'app.
// Sans dépendance : utilise fetch (Node 18+) et spawn pour lancer server.js.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8877;
const BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = 'secret-smoke-123';

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) failures++;
}

async function waitHealthy(ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE + '/healthz');
      if (r.ok) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  const root = path.join(__dirname, '..');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: Object.assign({}, process.env, {
      WINLATOR_TOKEN: TOKEN,
      WINLATOR_PC_PORT: String(PORT),
      WINLATOR_HOST: '127.0.0.1',
      VNC_ENABLED: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {}); // n'encombre pas la sortie de test

  try {
    check('serveur démarré (/healthz sans auth)', await waitHealthy());

    const noAuth = await fetch(BASE + '/api/state');
    check('API protégée sans token → 401', noAuth.status === 401);

    const badLogin = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'mauvais' }),
    });
    check('login avec mauvais token → 401', badLogin.status === 401);

    const login = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    const setCookie = login.headers.get('set-cookie') || '';
    check('login avec bon token → 200 + cookie', login.ok && setCookie.includes('wl_token='));
    const cookie = (setCookie.match(/wl_token=[^;]+/) || [''])[0];

    const st1 = await fetch(BASE + '/api/state', { headers: { Cookie: cookie } });
    const state = await st1.json();
    check('API accessible avec cookie', st1.ok && state.ok === true);

    // Upload d'un faux .exe
    const fake = Buffer.from('MZ' + 'contenu-de-test-fake-exe');
    const up = await (await fetch(BASE + '/api/upload', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, { Cookie: cookie }),
      body: JSON.stringify({ name: 'mon-jeu.exe', data: fake.toString('base64') }),
    })).json();
    check('upload .exe accepté', up.ok === true && up.path && fs.existsSync(up.path));
    check('contenu uploadé identique', up.ok && fs.readFileSync(up.path).equals(fake));

    // Refus d'une extension interdite
    const badUp = await (await fetch(BASE + '/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'virus.sh', data: Buffer.from('#!/bin/sh').toString('base64') }),
    })).json();
    check('upload .sh refusé', badUp.ok === false);

    // Création d'application pointant vers le fichier uploadé
    const app = await (await fetch(BASE + '/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Mon jeu (test)', exePath: up.path }),
    })).json();
    check('application créée', app.ok === true && app.app && app.app.id);

    const st2 = await (await fetch(BASE + '/api/state', {
      headers: { Cookie: cookie },
    })).json();
    check('application visible dans /api/state', st2.apps.some(a => a.id === app.app.id));

    // Pas de lancement réel ici (pas d'écran) : on vérifie juste le refus propre d'un chemin absent
    const ghost = await (await fetch(BASE + '/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Fantôme', exePath: 'C:/nimporte/ou.exe' }),
    })).json();
    check('chemin inexistant refusé', ghost.ok === false);
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(path.join(root, 'data'), { recursive: true, force: true }); } catch (_) {}
  }

  console.log(failures === 0 ? '\nSmoke test : tout passe ✓' : '\nSmoke test : ' + failures + ' échec(s) ✗');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Erreur de test :', e); process.exit(1); });
