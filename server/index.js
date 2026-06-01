/* ═══════════════════════════════════════════════════════════
   Production server — Express + WebSocket on a single port

   - Serves the Vite-built static frontend from ../dist/
   - Handles WebSocket upgrades on the same HTTP server
   - Persistent rooms with userId-based reconnection
   ═══════════════════════════════════════════════════════════ */

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const DIST = path.join(__dirname, '..', 'dist');

/* ── Express ── */
const app = express();
app.use(express.json());
app.use(express.static(DIST));

// AI move endpoint (unchanged)
const KATAGO_API_URL = process.env.KATAGO_API_URL || null;
const BOARD_SIZE = 19;
const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
function inBounds(r,c){ return r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE; }
function toKatagoBoard(board){ return board.map(r=>r.map(c=>c==='black'?'X':c==='white'?'O':'.')); }
function randomValidMove(board,color){
  const empty=[]; const opp=color==='black'?'white':'black';
  for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) if(board[r][c]===null) empty.push([r,c]);
  for(let i=empty.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [empty[i],empty[j]]=[empty[j],empty[i]]; }
  for(const [r,c] of empty){ for(const [dr,dc] of DIRS){ if(inBounds(r+dr,c+dc)&&board[r+dr][c+dc]===null) return {row:r,col:c}; } }
  return empty.length>0?{row:empty[0][0],col:empty[0][1]}:null;
}
app.post('/api/ai-move',async(req,res)=>{
  const {board,currentPlayer,maxVisits}=req.body;
  if(!board||!currentPlayer) return res.status(400).json({error:'Missing board or currentPlayer'});
  if(board.length!==BOARD_SIZE||board.some(r=>r.length!==BOARD_SIZE)) return res.status(400).json({error:`Board must be ${BOARD_SIZE}x${BOARD_SIZE}`});
  if(KATAGO_API_URL){
    try{
      const kb=toKatagoBoard(board);
      const r=await fetch(`${KATAGO_API_URL}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:kb,current_player:currentPlayer,max_visits:maxVisits||100})});
      if(!r.ok){ const e=await r.text(); return res.status(502).json({error:'KataGo API error: '+e}); }
      return res.json(await r.json());
    }catch(e){ return res.status(502).json({error:'KataGo API unreachable'}); }
  }
  const move=randomValidMove(board,currentPlayer);
  if(move) return res.json({row:move.row,col:move.col,move:'random'});
  return res.json({row:-1,col:-1,move:'pass'});
});
/* ── CORS (allow frontend dev server) ── */
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ── Match history endpoint ── */
app.get('/api/history/:userId', (req, res) => {
  const { userId } = req.params;
  const records = gameHistory
    .filter(r => r.blackUserId === userId || r.whiteUserId === userId)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(records);
});

app.get('/{*path}',(_req,res)=>{ res.sendFile(path.join(DIST,'index.html'),err=>{ if(err) res.status(200).send('弈手围棋 — Server running'); }); });

/* ── HTTP server ── */
const server = http.createServer(app);

/* ── WebSocket ── */
const wss = new WebSocketServer({ server });
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const CLEANUP_DELAY = 5 * 60_000; // 5 minutes for room persistence
const DISCONNECT_LOSS_SECS = 30; // auto-loss after 30s disconnected

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

/**
 * Room structure:
 * {
 *   code: string,
 *   blackUserId: string,
 *   whiteUserId: string,
 *   blackSocket: WebSocket | null,
 *   whiteSocket: WebSocket | null,
 *   moveHistory: {row,col,color}[],
 *   cleanupTimer: NodeJS.Timeout | null,
 * }
 *
 * Key design: sockets come and go, but the room persists keyed by userIds.
 * On reconnect, the new socket replaces the old one and game_sync is sent.
 */
/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {{ws, timer:NodeJS.Timeout|null}[]} */
const waitingQueue = [];

/** @type {{gameId:string, date:string, blackUserId:string, whiteUserId:string, winner:'black'|'white', winReason:string}[]} */
const gameHistory = [];

function saveGameRecord(room, winner, reason) {
  gameHistory.push({
    gameId: room.code,
    date: new Date().toISOString(),
    blackUserId: room.blackUserId,
    whiteUserId: room.whiteUserId,
    winner,
    winReason: reason,
  });
}

/** Per-connection userId (set by identify message) */
const socketUsers = new WeakMap();

function getRoomFor(ws) {
  const userId = socketUsers.get(ws);
  if (!userId) return null;
  for (const room of rooms.values()) {
    if (room.blackUserId === userId || room.whiteUserId === userId) return room;
  }
  return null;
}

function getOtherSocket(room, ws) {
  const userId = socketUsers.get(ws);
  if (!userId) return null;
  if (userId === room.blackUserId) return room.whiteSocket;
  if (userId === room.whiteUserId) return room.blackSocket;
  return null;
}

function getMyColor(room, ws) {
  const userId = socketUsers.get(ws);
  if (userId === room.blackUserId) return 'black';
  if (userId === room.whiteUserId) return 'white';
  return null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function clearRoomTimer(room) {
  if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
}

function scheduleRoomCleanup(room) {
  clearRoomTimer(room);
  room.cleanupTimer = setTimeout(() => { rooms.delete(room.code); }, CLEANUP_DELAY);
}

function clearLossTimer(room) {
  if (room.lossTimer) { clearTimeout(room.lossTimer); room.lossTimer = null; }
}

function scheduleLossTimer(room) {
  clearLossTimer(room);
  room.lossTimer = setTimeout(() => {
    const loserColor = room.blackSocket === null ? 'black' : 'white';
    const loserId = loserColor === 'black' ? room.blackUserId : room.whiteUserId;
    const winner = loserColor === 'black' ? 'white' : 'black';
    if (!room.recorded) {
      room.recorded = true;
      saveGameRecord(room, winner, 'timeout');
    }
    send(room.blackSocket, { type: 'disconnect_loss', loser: loserId });
    send(room.whiteSocket, { type: 'disconnect_loss', loser: loserId });
    rooms.delete(room.code);
  }, DISCONNECT_LOSS_SECS * 1000);
}

wss.on('connection', (ws) => {
  let identified = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── identify (must be first message) ──
    if (msg.type === 'identify') {
      const userId = msg.userId;
      if (!userId) return;
      socketUsers.set(ws, userId);
      identified = true;

      // Check if this user is in an active game
      const room = getRoomFor(ws);
      if (!room) return; // not in a game — normal lobby flow

      // Reconnection! Update socket reference
      const color = getMyColor(room, ws);
      if (color === 'black') room.blackSocket = ws;
      else if (color === 'white') room.whiteSocket = ws;
      clearRoomTimer(room);
      clearLossTimer(room);

      // Send full game state for reconstruction
      send(ws, {
        type: 'game_sync',
        code: room.code,
        color,
        moveHistory: room.moveHistory,
      });

      // Notify opponent that we're back
      const other = getOtherSocket(room, ws);
      if (other) send(other, { type: 'opponent_reconnected' });
      return;
    }

    if (!identified) return; // ignore messages before identify

    // ── find existing room for this socket (if any) ──
    const room = getRoomFor(ws);
    const other = room ? getOtherSocket(room, ws) : null;
    const myColor = room ? getMyColor(room, ws) : null;

    switch (msg.type) {

      case 'create_room': {
        const userId = socketUsers.get(ws);
        // Leave any existing room first
        const existing = getRoomFor(ws);
        if (existing) {
          const c = getMyColor(existing, ws);
          if (c === 'black') existing.blackSocket = null;
          else existing.whiteSocket = null;
          scheduleRoomCleanup(existing);
        }
        let code;
        do { code = generateCode(); } while (rooms.has(code));
        rooms.set(code, {
          code,
          blackUserId: userId,
          whiteUserId: null,
          blackSocket: ws,
          whiteSocket: null,
          moveHistory: [],
          cleanupTimer: null,
        });
        send(ws, { type: 'room_created', code, color: 'black' });
        break;
      }

      case 'join_room': {
        const userId = socketUsers.get(ws);
        const room = rooms.get(msg.code?.toUpperCase?.() ?? '');
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); break; }
        if (room.whiteUserId) { send(ws, { type: 'error', message: '房间已满' }); break; }
        // Leave any existing room
        const existing = getRoomFor(ws);
        if (existing) {
          const c = getMyColor(existing, ws);
          if (c === 'black') existing.blackSocket = null;
          else existing.whiteSocket = null;
          scheduleRoomCleanup(existing);
        }
        room.whiteUserId = userId;
        room.whiteSocket = ws;
        clearRoomTimer(room);
        send(ws, { type: 'room_joined', code: room.code, color: 'white' });
        send(room.blackSocket, { type: 'player_joined' });
        send(room.blackSocket, { type: 'game_start' });
        send(ws, { type: 'game_start' });
        break;
      }

      case 'find_match': {
        const userId = socketUsers.get(ws);
        // Leave existing room
        const existing = getRoomFor(ws);
        if (existing) {
          const c = getMyColor(existing, ws);
          if (c === 'black') existing.blackSocket = null;
          else existing.whiteSocket = null;
          scheduleRoomCleanup(existing);
        }
        if (waitingQueue.some(w => w.ws === ws)) break;

        if (waitingQueue.length > 0) {
          const opponent = waitingQueue.shift();
          if (opponent.timer) clearTimeout(opponent.timer);
          const oppUserId = socketUsers.get(opponent.ws);
          if (!oppUserId) { send(ws, { type: 'error', message: '匹配失败' }); break; }

          let code;
          do { code = generateCode(); } while (rooms.has(code));

          const playerIsBlack = Math.random() < 0.5;
          const room = {
            code,
            blackUserId: playerIsBlack ? userId : oppUserId,
            whiteUserId: playerIsBlack ? oppUserId : userId,
            blackSocket: playerIsBlack ? ws : opponent.ws,
            whiteSocket: playerIsBlack ? opponent.ws : ws,
            moveHistory: [],
            cleanupTimer: null,
          };
          rooms.set(code, room);

          const pColor = playerIsBlack ? 'black' : 'white';
          const oColor = playerIsBlack ? 'white' : 'black';
          send(ws, { type: 'match_found', code, color: pColor });
          send(opponent.ws, { type: 'match_found', code, color: oColor });
          send(ws, { type: 'game_start' });
          send(opponent.ws, { type: 'game_start' });
        } else {
          waitingQueue.push({ ws, timer: null });
          send(ws, { type: 'searching' });
        }
        break;
      }

      case 'cancel_search': {
        const idx = waitingQueue.findIndex(w => w.ws === ws);
        if (idx !== -1) {
          if (waitingQueue[idx].timer) clearTimeout(waitingQueue[idx].timer);
          waitingQueue.splice(idx, 1);
        }
        send(ws, { type: 'search_cancelled' });
        break;
      }

      /* ── Game actions ── */
      case 'place_stone': {
        if (!room || !myColor) break;
        // Record move
        room.moveHistory.push({ row: msg.row, col: msg.col, color: myColor });
        // Relay to opponent
        if (other) send(other, { type: 'move', row: msg.row, col: msg.col });
        break;
      }

      case 'pass': {
        if (!room || !myColor) break;
        room.moveHistory.push({ row: -1, col: -1, color: myColor });
        if (other) send(other, { type: 'pass' });
        break;
      }

      case 'undo_request':
        if (other) send(other, { type: 'undo_request' });
        break;

      case 'undo_accept': {
        if (!room) break;
        // Remove last two entries from moveHistory (opponent's move + your move)
        if (room.moveHistory.length >= 2) room.moveHistory.splice(room.moveHistory.length - 2, 2);
        else if (room.moveHistory.length >= 1) room.moveHistory.pop();
        send(room.blackSocket, { type: 'undo_accepted' });
        send(room.whiteSocket, { type: 'undo_accepted' });
        break;
      }

      case 'undo_reject':
        if (other) send(other, { type: 'undo_rejected' });
        break;

      case 'reset_request':
        if (other) send(other, { type: 'reset_request' });
        break;

      case 'reset_accept': {
        if (!room) break;
        room.moveHistory = [];
        send(room.blackSocket, { type: 'reset_accepted' });
        send(room.whiteSocket, { type: 'reset_accepted' });
        break;
      }

      case 'reset_reject':
        if (other) send(other, { type: 'reset_rejected' });
        break;

      case 'game_over': {
        if (!room || !myColor) break;
        // Only record once per game
        if (!room.recorded) {
          room.recorded = true;
          const winner = msg.winner; // 'black' | 'white'
          const reason = msg.reason || 'territory';
          saveGameRecord(room, winner, reason);
        }
        break;
      }

      case 'leave_room': {
        if (!room) break;
        const userId = socketUsers.get(ws);
        const leaverColor = userId === room.blackUserId ? 'black' : 'white';
        // Save record: the OTHER player wins by resign
        if (!room.recorded) {
          room.recorded = true;
          saveGameRecord(room, leaverColor === 'black' ? 'white' : 'black', 'resign');
        }
        // Clear userId so reconnection doesn't pull them back into this room
        if (userId === room.blackUserId) { room.blackUserId = ''; room.blackSocket = null; }
        else if (userId === room.whiteUserId) { room.whiteUserId = ''; room.whiteSocket = null; }
        if (other) send(other, { type: 'opponent_resigned' });
        socketUsers.delete(ws);
        scheduleRoomCleanup(room);
        break;
      }
    }
  });

  ws.on('close', () => {
    // Remove from waiting queue
    const qIdx = waitingQueue.findIndex(w => w.ws === ws);
    if (qIdx !== -1) {
      if (waitingQueue[qIdx].timer) clearTimeout(waitingQueue[qIdx].timer);
      waitingQueue.splice(qIdx, 1);
    }
    // Clear socket from room (room persists)
    const room = getRoomFor(ws);
    if (room) {
      const userId = socketUsers.get(ws);
      if (userId === room.blackUserId) room.blackSocket = null;
      else if (userId === room.whiteUserId) room.whiteSocket = null;
      const other = getOtherSocket(room, ws);
      if (other) send(other, { type: 'opponent_disconnected' });
      // Start 30s loss countdown + 5min cleanup
      scheduleLossTimer(room);
      scheduleRoomCleanup(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  HTTP:  http://localhost:${PORT}`);
  console.log(`  WS:    ws://localhost:${PORT}`);
});
