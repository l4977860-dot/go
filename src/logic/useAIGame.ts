/* ═══════════════════════════════════════════════════════════
   useAIGame.ts — wraps useGameState, auto-calls /api/ai-move
   when it's the AI's turn. Falls back to client-side random
   move if the server is unreachable.
   ═══════════════════════════════════════════════════════════ */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BoardState, StoneColor } from '../types';
import { useGameState } from './useGameState';
import { playStoneSound } from '../utils/sound';

export type AIDifficulty = 'easy' | 'medium' | 'hard';

const MAX_VISITS: Record<AIDifficulty, number> = {
  easy: 10,
  medium: 100,
  hard: 500,
};

const BOARD_SIZE = 19;
const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const HUMAN_COLOR: StoneColor = 'black';
const AI_COLOR: StoneColor = 'white';

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/** Pick a random empty intersection that has at least one adjacent liberty.
 *  Returns null if the board is completely full (should pass). */
function randomMockMove(board: BoardState): { row: number; col: number } | null {
  const empty: [number, number][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) empty.push([r, c]);
    }
  }
  // Fisher-Yates shuffle
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [empty[i], empty[j]] = [empty[j], empty[i]];
  }
  // Return first empty spot with at least one adjacent liberty
  for (const [r, c] of empty) {
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === null) {
        return { row: r, col: c };
      }
    }
  }
  return empty.length > 0 ? { row: empty[0][0], col: empty[0][1] } : null;
}

function apiUrl(path: string): string {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  return `${base}${path}`;
}

export function useAIGame(difficulty: AIDifficulty) {
  const game = useGameState();
  const [aiThinking, setAiThinking] = useState(false);
  const moveRequested = useRef(false);

  const isAiTurn =
    game.state.currentPlayer === AI_COLOR && !game.state.gameOver;
  const isHumanTurn =
    game.state.currentPlayer === HUMAN_COLOR && !game.state.gameOver;

  // ── Auto-trigger AI move ──
  useEffect(() => {
    if (!isAiTurn || moveRequested.current) return;
    moveRequested.current = true;
    setAiThinking(true);

    const controller = new AbortController();
    let done = false;

    const applyMove = (row: number, col: number) => {
      if (done) return;
      done = true;
      if (row >= 0 && col >= 0) {
        game.handlePlaceStone(row, col);
      } else {
        game.handlePass();
      }
      playStoneSound();
      setAiThinking(false);
    };

    fetch(apiUrl('/api/ai-move'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: game.state.board,
        currentPlayer: AI_COLOR,
        maxVisits: MAX_VISITS[difficulty],
      }),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        applyMove(data.row ?? -1, data.col ?? -1);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Server unreachable — use client-side mock move
        const mock = randomMockMove(game.state.board);
        if (mock) {
          applyMove(mock.row, mock.col);
        } else {
          applyMove(-1, -1); // pass
        }
      });

    return () => {
      controller.abort();
      if (!done) {
        setAiThinking(false);
      }
    };
    // Only re-trigger when it becomes AI's turn (game.state.currentPlayer flipping to AI)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAiTurn]);

  // Reset move-requested flag when turn switches to human
  useEffect(() => {
    if (isHumanTurn) {
      moveRequested.current = false;
    }
  }, [isHumanTurn]);

  // ── Human actions ──

  const handlePlaceStone = useCallback(
    (row: number, col: number) => {
      if (!isHumanTurn || aiThinking) return;
      game.handlePlaceStone(row, col);
    },
    [isHumanTurn, aiThinking, game],
  );

  const handlePass = useCallback(() => {
    if (!isHumanTurn || aiThinking) return;
    game.handlePass();
  }, [isHumanTurn, aiThinking, game]);

  // Undo two moves (AI + human) to return to human's turn
  const handleUndo = useCallback(() => {
    if (!isHumanTurn || aiThinking) return;
    if (game.state.moveHistory.length < 2) return;
    game.handleUndo();
    setTimeout(() => game.handleUndo(), 0);
  }, [isHumanTurn, aiThinking, game]);

  const handleReset = useCallback(() => {
    moveRequested.current = false;
    game.handleReset();
  }, [game]);

  return {
    state: game.state,
    score: game.score,
    handlePlaceStone,
    handlePass,
    handleUndo,
    handleReset,
    aiThinking,
    humanColor: HUMAN_COLOR,
    aiColor: AI_COLOR,
    difficulty,
  };
}
