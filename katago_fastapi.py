"""
katago_fastapi.py — Cloud GPU KataGo analysis server

Deploy this on RunPod (or any GPU instance) alongside:
  - katago          (the KataGo binary)
  - model.bin.gz    (KataGo neural-network weights)
  - katago_fastapi.py (this file)

Start:  uvicorn katago_fastapi:app --host 0.0.0.0 --port 8000

Endpoint:  POST /move
  Body:  { "board": [[".","X","O",...], ...],  // 19x19
           "current_player": "black"|"white",
           "max_visits": 100 }                 // optional

  Response: { "move": "Q16", "row": 3, "col": 15,
              "winrate": 0.52, "score_lead": 2.5 }
"""

import os
import re
import json
import shutil
import asyncio
import subprocess
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Config (override via env vars) ──
KATAGO_BIN = os.getenv("KATAGO_BIN", "./katago")
KATAGO_MODEL = os.getenv("KATAGO_MODEL", "./model.bin.gz")
KATAGO_CFG = os.getenv("KATAGO_CFG", "./analysis.cfg")
MAX_VISITS_DEFAULT = int(os.getenv("MAX_VISITS_DEFAULT", "100"))
BOARD_SIZE = 19

# ── GTP helpers ──
COL_LETTERS = "ABCDEFGHJKLMNOPQRST"  # I is skipped in Go coordinates

def to_gtp(row: int, col: int) -> str:
    """0-indexed (row,col) → GTP coordinate like 'Q16'"""
    return f"{COL_LETTERS[col]}{BOARD_SIZE - row}"

def from_gtp(move: str) -> tuple[int, int] | None:
    """GTP coordinate → (row, col) 0-indexed, or None for pass"""
    m = re.match(r"^([A-HJ-T])(\d{1,2})$", move.upper())
    if not m:
        return None
    col = COL_LETTERS.index(m.group(1))
    row = BOARD_SIZE - int(m.group(2))
    return (row, col)

# ── KataGo subprocess manager ──
class KataGoEngine:
    """Manages a persistent KataGo GTP subprocess with a mutex."""

    def __init__(self):
        self.proc: subprocess.Popen | None = None
        self.lock = threading.Lock()

    def start(self):
        """Launch KataGo in GTP mode."""
        if not shutil.which(KATAGO_BIN) and not os.path.isfile(KATAGO_BIN):
            raise RuntimeError(f"KataGo binary not found at {KATAGO_BIN}")

        cfg_exists = os.path.isfile(KATAGO_CFG)
        args = [KATAGO_BIN, "gtp"]
        if cfg_exists:
            args += ["-config", KATAGO_CFG]
        else:
            args += ["-model", KATAGO_MODEL]

        self.proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        # Drain the initial KataGo banner
        self._read_until()

    def stop(self):
        if self.proc:
            try:
                self.proc.stdin.write("quit\n")
                self.proc.stdin.flush()
            except Exception:
                pass
            self.proc.terminate()
            self.proc = None

    def _cmd(self, command: str) -> str:
        """Send a GTP command and return the response (strips status line)."""
        with self.lock:
            if not self.proc or self.proc.poll() is not None:
                self.start()
            self.proc.stdin.write(command + "\n")
            self.proc.stdin.flush()
            return self._read_until()

    def _read_until(self) -> str:
        """Read GTP output until we see a blank line or final status."""
        lines = []
        while True:
            line = self.proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                break
            # Stop at status line (starts with = or ?)
            if line.startswith("=") or line.startswith("?"):
                lines.append(line)
                break
            lines.append(line)
        return "\n".join(lines)

    def query_move(self, board_2d: list[list[str]], color: str, max_visits: int) -> dict:
        """
        Set up the board position and query the best move.
        board_2d: 19x19 list of lists — '.' empty, 'X' black, 'O' white
        color: 'black' → 'B', 'white' → 'W'
        """
        cmds = []
        cmds.append(f"boardsize {BOARD_SIZE}")
        cmds.append("clear_board")

        # Play all stones already on the board
        for r in range(BOARD_SIZE):
            for c in range(BOARD_SIZE):
                stone = board_2d[r][c]
                if stone == "X":
                    cmds.append(f"play B {to_gtp(r, c)}")
                elif stone == "O":
                    cmds.append(f"play W {to_gtp(r, c)}")

        gtp_color = "B" if color == "black" else "W"

        # Set visit limit
        cmds.append(f"kata-set-param analysis maxVisits {max_visits}")

        # Query — use kata-analyze for richer output
        cmds.append(f"kata-analyze {gtp_color} {max_visits}")

        for cmd in cmds:
            resp = self._cmd(cmd)
            # Check for GTP errors
            if resp.startswith("?"):
                raise RuntimeError(f"GTP error for '{cmd}': {resp}")

        # Parse the last response (from kata-analyze)
        # Format: = info move Q16 winrate 0.5234 scoreLead 2.5 ...
        last = self._cmd(f"kata-analyze {gtp_color} {max_visits}")
        return self._parse_analyze_response(last, gtp_color)

    def _parse_analyze_response(self, raw: str, color: str) -> dict:
        """Parse the kata-analyze response into a structured dict."""
        # Look for lines like: info move Q16 winrate 0.52 scoreLead 1.5 ...
        best_move = None
        best_winrate = 0.5
        best_score_lead = 0.0

        for line in raw.split("\n"):
            line = line.strip()
            if not line.startswith("info"):
                continue

            # Extract move
            move_match = re.search(r"move\s+(\S+)", line)
            if not move_match:
                continue
            gtp_move = move_match.group(1)
            if gtp_move.upper() == "PASS":
                return {"move": "pass", "row": -1, "col": -1, "winrate": 0.5, "score_lead": 0.0}

            wr_match = re.search(r"winrate\s+([\d.]+)", line)
            sl_match = re.search(r"scoreLead\s+([-\d.]+)", line)

            winrate = float(wr_match.group(1)) if wr_match else 0.5
            score_lead = float(sl_match.group(1)) if sl_match else 0.0
            coord = from_gtp(gtp_move)

            # The first info line is the best move
            if best_move is None:
                best_move = coord
                best_winrate = winrate
                best_score_lead = score_lead

        if best_move is None:
            return {"move": "pass", "row": -1, "col": -1, "winrate": 0.5, "score_lead": 0.0}

        return {
            "move": to_gtp(best_move[0], best_move[1]),
            "row": best_move[0],
            "col": best_move[1],
            "winrate": round(best_winrate, 4),
            "score_lead": round(best_score_lead, 2),
        }


# ── Global engine instance ──
engine = KataGoEngine()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start KataGo on boot, shut down on exit."""
    try:
        engine.start()
        print("KataGo engine started")
    except Exception as e:
        print(f"WARNING: Could not start KataGo: {e}")
    yield
    engine.stop()
    print("KataGo engine stopped")


# ── FastAPI app ──
app = FastAPI(title="KataGo Analysis API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class MoveRequest(BaseModel):
    board: list[list[str]]  # 19x19: '.' empty, 'X' black, 'O' white
    current_player: str     # "black" | "white"
    max_visits: int = MAX_VISITS_DEFAULT


@app.get("/health")
def health():
    return {"status": "ok", "katago_alive": engine.proc is not None and engine.proc.poll() is None}


@app.post("/move")
def get_move(req: MoveRequest):
    """Return the best move for the given board position."""
    if len(req.board) != BOARD_SIZE or any(len(row) != BOARD_SIZE for row in req.board):
        raise HTTPException(400, f"Board must be {BOARD_SIZE}x{BOARD_SIZE}")
    if req.current_player not in ("black", "white"):
        raise HTTPException(400, "current_player must be 'black' or 'white'")

    if engine.proc is None or engine.proc.poll() is not None:
        raise HTTPException(503, "KataGo engine is not running")

    try:
        result = engine.query_move(req.board, req.current_player, req.max_visits)
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
