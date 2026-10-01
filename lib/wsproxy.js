'use strict';
// Winlator PC Edition - wsproxy.js : WebSocket minimaliste RFC 6455, sans dépendance.
// Sert de pont entre un client noVNC (navigateur) et un serveur VNC local,
// afin que tout passe par le seul port HTTP exposé par la plateforme cloud.
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// --- Décodage des trames côté client (masquées) ---
// Renvoie { complete, opcode, payload, rest } pour le premier paquet de `buf`.
function decodeFrame(buf) {
  if (buf.length < 2) return { complete: false, rest: buf };
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return { complete: false, rest: buf };
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return { complete: false, rest: buf };
    const big = buf.readBigUInt64BE(2);
    if (big > 32n * 1024n * 1024n) return { error: 'Trame trop grande', rest: Buffer.alloc(0) };
    len = Number(big); off = 10;
  }
  if (len > 32 * 1024 * 1024) return { error: 'Trame trop grande', rest: Buffer.alloc(0) };
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return { complete: false, rest: buf };
  let payload = buf.slice(off + maskLen, off + maskLen + len);
  if (masked) {
    const mask = buf.slice(off, off + 4);
    const out = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
    payload = out;
  }
  return { complete: true, fin, opcode, payload, rest: buf.slice(off + maskLen + len) };
}

// --- Encodage d'une trame serveur (non masquée) ---
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

// --- Handshake HTTP Upgrade ---
function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

// Installe un WebSocket sur une socket déjà « upgraded ».
// opts : { onOpen(ws), onMessage(ws, payload, isBinary), onClose(ws) }
function attach(req, socket, head, opts) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + acceptKey(key),
  ];
  // noVNC demande le sous-protocole « binary » : on l'accepte s'il est proposé.
  const protos = (req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
  if (protos.includes('binary')) headers.push('Sec-WebSocket-Protocol: binary');
  socket.write(headers.join('\r\n') + '\r\n\r\n');

  const ws = {
    socket,
    open: true,
    send(buf) {
      if (!ws.open) return;
      try { socket.write(encodeFrame(0x2, Buffer.isBuffer(buf) ? buf : Buffer.from(buf))); }
      catch (_) { ws.close(); }
    },
    sendText(str) {
      if (!ws.open) return;
      try { socket.write(encodeFrame(0x1, Buffer.from(str))); }
      catch (_) { ws.close(); }
    },
    close() {
      if (!ws.open) return;
      ws.open = false;
      try { socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (_) {}
      try { socket.end(); } catch (_) {}
      if (opts.onClose) opts.onClose(ws);
    },
  };

  let pending = Buffer.from(head || []);
  socket.on('data', (chunk) => {
    if (!ws.open) return;
    pending = Buffer.concat([pending, chunk]);
    // Consomme toutes les trames complètes disponibles.
    for (;;) {
      const f = decodeFrame(pending);
      if (f.error) { ws.close(); return; }
      if (!f.complete) { pending = f.rest; return; }
      pending = f.rest;
      if (f.opcode === 0x8) { ws.close(); return; }            // close
      if (f.opcode === 0x9) { try { socket.write(encodeFrame(0xA, f.payload)); } catch (_) {} continue; } // ping -> pong
      if (f.opcode === 0xA) continue;                           // pong
      if (f.opcode === 0x1 || f.opcode === 0x2) {
        if (opts.onMessage) opts.onMessage(ws, f.payload, f.opcode === 0x2);
      }
      // Trames fragmentées (opcode 0) non supportées : noVNC n'en émet pas en pratique.
    }
  });
  const die = () => { if (ws.open) { ws.open = false; if (opts.onClose) opts.onClose(ws); } };
  socket.on('close', die);
  socket.on('error', die);

  if (opts.onOpen) opts.onOpen(ws);
  return ws;
}

module.exports = { attach, acceptKey, decodeFrame, encodeFrame };
