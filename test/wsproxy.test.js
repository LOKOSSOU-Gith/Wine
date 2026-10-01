'use strict';
// Test du pont WebSocket → VNC (sans framework, sans dépendance).
// Scénario : faux serveur VNC, upgrade authentifié (les octets RFB doivent
// circuler dans les deux sens) et upgrade sans token (refusé en 401).
const http = require('http');
const net = require('net');
const crypto = require('crypto');

process.env.VNC_ENABLED = '1';
process.env.VNC_PORT = '15901';
process.env.VNC_DISPLAY = ':99';
process.env.WINLATOR_TOKEN = 'jeton-de-test';

const vncproxy = require('../lib/vncproxy');
const wsproxy = require('../lib/wsproxy');

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) failures++;
}

async function main() {
// --- Faux serveur VNC : bannière RFB puis écho ---
const fakeVnc = net.createServer((sock) => {
  sock.write('RFB 003.008\n');
  sock.on('data', (d) => sock.write(Buffer.concat([Buffer.from('ECHO:'), d])));
});
await new Promise(r => fakeVnc.listen(15901, '127.0.0.1', r));

// --- Serveur HTTP qui délègue les upgrades au vncproxy ---
const server = http.createServer(() => {});
server.on('upgrade', (req, socket, head) => {
  vncproxy.handleUpgrade(req, socket, head, () => {});
});
await new Promise(r => server.listen(15902, '127.0.0.1', r));

// --- Mini client WebSocket (trames masquées côté client) ---
function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(15902, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    let status = 0;
    sock.on('connect', () => {
      sock.write(
        'GET /websockify?token=' + encodeURIComponent(token) + ' HTTP/1.1\r\n' +
        'Host: localhost\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        'Sec-WebSocket-Protocol: binary\r\n\r\n');
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshakeDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        status = Number(buf.toString('utf8', 9, 12)); // "HTTP/1.1 101 …"
        if (status !== 101) { resolve({ status, sock, frames: [] }); return; }
        buf = buf.slice(idx + 4);
        handshakeDone = true;
        resolve({
          status, sock,
          frames: [],
          send(payload) { sock.write(wsproxy.encodeFrame(0x2, payload)); },
          waitFrames(n, ms = 2000) {
            return new Promise((res, rej) => {
              const got = [];
              const t0 = Date.now();
              const timer = setInterval(() => {
                for (;;) {
                  const f = wsproxy.decodeFrame(buf);
                  if (!f.complete || f.error) break;
                  buf = f.rest;
                  got.push(f);
                }
                if (got.length >= n) { clearInterval(timer); res(got); }
                else if (Date.now() - t0 > ms) { clearInterval(timer); rej(new Error('timeout frames')); }
              }, 10);
            });
          },
        });
      }
    });
    sock.on('error', reject);
  });
}

console.log('Test du pont WebSocket → VNC');

// 1) Refus sans token
const bad = await wsConnect('mauvais-token');
check('upgrade sans token → 401', bad.status === 401);
bad.sock.destroy();

// 2) Connexion authentifiée : la bannière RFB du faux VNC doit arriver via WS
const good = await wsConnect('jeton-de-test');
check('upgrade avec token → 101', good.status === 101);
const first = await good.waitFrames(1);
check('bannière RFB reçue via WebSocket', first[0].payload.toString().startsWith('RFB '));

// 3) Sens navigateur → VNC : écho attendu
good.send(Buffer.from('ping-ws'));
const latest = await good.waitFrames(1);
const echo = latest.find(f => f.payload.toString().includes('ECHO:ping-ws'));
check('données client transmises au VNC (écho)', !!echo);

good.sock.destroy();
fakeVnc.close();
server.close();

console.log(failures === 0 ? '\nTous les tests passent ✓' : '\n' + failures + ' test(s) en échec ✗');
process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('Erreur de test :', e); process.exit(1); });
