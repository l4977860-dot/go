/* ═══════════════════════════════════════════════════════════
   Production server — Express + WebSocket on a single port

   - Serves the Vite-built static frontend from ../dist/
   - Handles WebSocket upgrades on the same HTTP server
   - Works locally (dev) and in production (Render, Zeabur, etc.)

   Dev:  npm run dev:all        (Vite :5173 + server :3001 separately)
   Prod: npm run build && npm start  (single server on $PORT)
   ═══════════════════════════════════════════════════════════ */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DIST = path.join(__dirname, '..', 'dist');

/* ── Express (static files + SPA fallback) ── */
const app = express();
app.use(express.static(DIST));
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'), (err) => {
    if (err) res.status(200).send('弈手围棋 — Server running');
  });
});

/* ── HTTP server (shared by Express + WebSocket) ── */
const server = http.createServer(app);

/* ── WebSocket (room relay — zero game logic) ── */
const wss = new WebSocketServer({ server });

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const CLEANUP_DELAY = 30_000;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/** @type {Map<string, {code:string, creator:{ws,color:'black'}, joiner:{ws,color:'white'}|null, cleanupTimer:NodeJS.Timeout|null}>} */
const rooms = new Map();

function getRoomFor(ws) {
  for (const room of rooms.values()) {
    if (room.creator.ws === ws) return room;
    if (room.joiner && room.joiner.ws === ws) return room;
  }
  return null;
}

function getOtherPlayer(room, ws) {
  if (room.creator.ws === ws) return room.joiner;
  return room.creator;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {

      case 'create_room': {
        let code;
        do { code = generateCode(); } while (rooms.has(code));
        rooms.set(code, { code, creator: { ws, color: 'black' }, joiner: null, cleanupTimer: null });
        send(ws, { type: 'room_created', code, color: 'black' });
        break;
      }

      case 'join_room': {
        const room = rooms.get(msg.code?.toUpperCase?.() ?? '');
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); break; }
        if (room.joiner) { send(ws, { type: 'error', message: '房间已满' }); break; }
        if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
        room.joiner = { ws, color: 'white' };
        send(ws, { type: 'room_joined', code: room.code, color: 'white' });
        send(room.creator.ws, { type: 'player_joined' });
        send(room.creator.ws, { type: 'game_start' });
        send(ws, { type: 'game_start' });
        break;
      }

      case 'place_stone': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'move', row: msg.row, col: msg.col });
        break;
      }

      case 'pass': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'pass' });
        break;
      }

      case 'undo_request': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'undo_request' });
        break;
      }

      case 'undo_accept': {
        const room = getRoomFor(ws);
        if (!room) break;
        send(room.creator.ws, { type: 'undo_accepted' });
        if (room.joiner) send(room.joiner.ws, { type: 'undo_accepted' });
        break;
      }

      case 'undo_reject': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'undo_rejected' });
        break;
      }

      case 'reset_request': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'reset_request' });
        break;
      }

      case 'reset_accept': {
        const room = getRoomFor(ws);
        if (!room) break;
        send(room.creator.ws, { type: 'reset_accepted' });
        if (room.joiner) send(room.joiner.ws, { type: 'reset_accepted' });
        break;
      }

      case 'reset_reject': {
        const room = getRoomFor(ws);
        if (!room) break;
        const other = getOtherPlayer(room, ws);
        if (other) send(other.ws, { type: 'reset_rejected' });
        break;
      }

      case 'leave_room': {
        const room = getRoomFor(ws);
        if (room) handleDisconnect(room, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = getRoomFor(ws);
    if (room) handleDisconnect(room, ws);
  });
});

function handleDisconnect(room, ws) {
  const other = getOtherPlayer(room, ws);
  if (other) send(other.ws, { type: 'opponent_disconnected' });

  const creatorGone = room.creator.ws === ws;
  if (creatorGone && !room.joiner) {
    rooms.delete(room.code);
    return;
  }
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => { rooms.delete(room.code); }, CLEANUP_DELAY);
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  HTTP:  http://localhost:${PORT}`);
  console.log(`  WS:    ws://localhost:${PORT}`);
});
