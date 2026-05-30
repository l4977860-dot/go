# 弈手围棋

Online Go (Weiqi) game — 19×19 board with full rules enforcement, territory scoring, and real-time two-player matchmaking.

## Quick Start

```bash
npm install
npm run dev:all     # starts Vite + WebSocket server
```

Open `http://localhost:5173` — create a room, share the code, and play.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server (frontend only) |
| `npm run dev:server` | WebSocket server (port 3001) |
| `npm run dev:all` | Both servers concurrently |
| `npm run build` | Type-check + production build → `dist/` |
| `npm start` | Production server (Express + WebSocket) |
| `npm run preview` | Preview production build locally |

## Project Structure

```
src/
├── components/
│   ├── Board/          # 19×19 SVG board + stones
│   └── Lobby/          # Room creation & joining UI
├── logic/
│   ├── goEngine.ts     # Pure rules engine (liberties, capture, ko, territory)
│   ├── useGameState.ts # Game state reducer
│   └── useOnlineGame.ts# WebSocket hook for online play
├── utils/
│   └── sound.ts        # Web Audio API stone sounds
├── App.tsx             # View machine: lobby / local / online
└── main.tsx            # Entry point

server/
└── index.js            # Express + WebSocket server (single port)
```

## Deployment

### Render (recommended)

1. Push this repo to GitHub
2. In [Render](https://render.com), create a new **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. Deploy — Render provides a `*.onrender.com` URL
6. Attach your custom domain in Render dashboard → Settings → Custom Domain

### Zeabur / any Node.js platform

Same build/start commands. The server runs on `$PORT` (default 3001).

## Features

- Full Go rules: liberties, capture, suicide prevention, ko (打劫)
- Territory scoring (点目) with 6.5 komi
- Real-time online multiplayer via WebSocket room codes
- Synthesized stone-placement and capture sounds
- Undo with opponent confirmation
