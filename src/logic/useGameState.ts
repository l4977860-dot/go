/* ═══════════════════════════════════════════════════════════════
   useGameState.ts — React hook wrapping useReducer for Go state
   ═══════════════════════════════════════════════════════════════ */

import { useReducer, useCallback, useMemo } from 'react';
import type { BoardState, StoneColor, Move } from '../types';
import { createEmptyBoard } from '../types';
import { placeStone, cloneBoard, calculateTerritory } from './goEngine';
import type { ScoreResult, ReplayResult } from './goEngine';

/* ─── State shape ─── */

export interface GameState {
  /** 19×19 board grid */
  board: BoardState;
  /** Whose turn to play */
  currentPlayer: StoneColor;
  /** Most recently placed move (for last-move marker) */
  lastMove: Move | null;
  /** Number of opponent stones captured BY black */
  capturedByBlack: number;
  /** Number of opponent stones captured BY white */
  capturedByWhite: number;
  /** Board snapshots — one per move, stored AFTER the move */
  boardHistory: BoardState[];
  /** Ordered list of moves played */
  moveHistory: Move[];
  /** Consecutive passes (resets on stone placement) */
  passes: number;
  /** True when game is over (2 consecutive passes) */
  gameOver: boolean;
  /** Number of stones captured in the most recent move (0 = none) */
  lastCaptureCount: number;
}

/* ─── Actions ─── */

type GameAction =
  | { type: 'PLACE_STONE'; row: number; col: number }
  | { type: 'PASS' }
  | { type: 'UNDO' }
  | { type: 'RESET' }
  | { type: 'SYNC_STATE'; payload: ReplayResult };

/* ─── Initial state ─── */

export function createInitialState(): GameState {
  return {
    board: createEmptyBoard(),
    currentPlayer: 'black',
    lastMove: null,
    capturedByBlack: 0,
    capturedByWhite: 0,
    boardHistory: [],
    moveHistory: [],
    passes: 0,
    gameOver: false,
    lastCaptureCount: 0,
  };
}

/* ─── Reducer ─── */

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    /* ── Place a stone ── */
    case 'PLACE_STONE': {
      const { row, col } = action;

      // Silently ignore moves after game over
      if (state.gameOver) return state;

      const prevBoard =
        state.boardHistory.length >= 2
          ? state.boardHistory[state.boardHistory.length - 2]
          : null;

      const result = placeStone(
        state.board,
        row,
        col,
        state.currentPlayer,
        prevBoard,
      );

      // Silently reject illegal moves
      if (!result.success) return state;

      const opponent = state.currentPlayer === 'black' ? 'white' : 'black';
      const capturedCount = result.captured.length;
      const newCapturedByBlack =
        state.capturedByBlack +
        (state.currentPlayer === 'black' ? capturedCount : 0);
      const newCapturedByWhite =
        state.capturedByWhite +
        (state.currentPlayer === 'white' ? capturedCount : 0);

      const newMove: Move = { row, col, color: state.currentPlayer };

      return {
        ...state,
        board: result.board,
        currentPlayer: opponent,
        lastMove: newMove,
        capturedByBlack: newCapturedByBlack,
        capturedByWhite: newCapturedByWhite,
        lastCaptureCount: capturedCount,
        boardHistory: [...state.boardHistory, cloneBoard(result.board)],
        moveHistory: [...state.moveHistory, newMove],
        passes: 0,
      };
    }

    /* ── Pass ── */
    case 'PASS': {
      if (state.gameOver) return state;

      const newPasses = state.passes + 1;
      const opponent =
        state.currentPlayer === 'black' ? 'white' : 'black';
      const isGameOver = newPasses >= 2;

      return {
        ...state,
        currentPlayer: opponent,
        passes: newPasses,
        gameOver: isGameOver,
        lastMove: null,
        lastCaptureCount: 0,
      };
    }

    /* ── Undo last move ── */
    case 'UNDO': {
      if (state.moveHistory.length === 0) return state;

      // Remove last board snapshot
      const newHistory = state.boardHistory.slice(0, -1);
      const newMoves = state.moveHistory.slice(0, -1);

      // Restore the previous board (or empty if no moves left)
      const restoredBoard =
        newHistory.length > 0
          ? cloneBoard(newHistory[newHistory.length - 1])
          : createEmptyBoard();

      const lastUndoneMove =
        state.moveHistory[state.moveHistory.length - 1];

      // Recalculate captures by replaying remaining moves
      // (simplest approach: replay from scratch — fast for 19×19)
      let replayCapturedByBlack = 0;
      let replayCapturedByWhite = 0;
      const replayBoard = createEmptyBoard();

      for (const move of newMoves) {
        // No ko check needed during replay since the original moves
        // were already validated
        const r = placeStone(replayBoard, move.row, move.col, move.color, null);
        if (r.success) {
          replayCapturedByBlack += move.color === 'black' ? r.captured.length : 0;
          replayCapturedByWhite += move.color === 'white' ? r.captured.length : 0;
          // Copy result back
          for (let ri = 0; ri < 19; ri++) {
            for (let ci = 0; ci < 19; ci++) {
              replayBoard[ri][ci] = r.board[ri][ci];
            }
          }
        }
      }

      return {
        ...state,
        board: restoredBoard,
        currentPlayer: lastUndoneMove.color,
        lastMove: newMoves.length > 0 ? newMoves[newMoves.length - 1] : null,
        capturedByBlack: replayCapturedByBlack,
        capturedByWhite: replayCapturedByWhite,
        boardHistory: newHistory,
        moveHistory: newMoves,
        passes: 0,
        gameOver: false,
        lastCaptureCount: 0,
      };
    }

    /* ── Reset game ── */
    case 'RESET':
      return createInitialState();

    /* ── Sync full state (reconnection) ── */
    case 'SYNC_STATE': {
      const p = action.payload;
      return {
        ...state,
        board: p.board,
        currentPlayer: p.currentPlayer,
        lastMove: p.lastMove,
        capturedByBlack: p.capturedByBlack,
        capturedByWhite: p.capturedByWhite,
        boardHistory: p.boardHistory,
        moveHistory: p.moveHistory,
        passes: 0,
        gameOver: false,
        lastCaptureCount: 0,
      };
    }

    default:
      return state;
  }
}

/* ─── Hook ─── */

export function useGameState() {
  const [state, dispatch] = useReducer(gameReducer, null, createInitialState);

  const handlePlaceStone = useCallback(
    (row: number, col: number) => {
      dispatch({ type: 'PLACE_STONE', row, col });
    },
    [],
  );

  const handlePass = useCallback(() => {
    dispatch({ type: 'PASS' });
  }, []);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const handleSyncState = useCallback((payload: ReplayResult) => {
    dispatch({ type: 'SYNC_STATE', payload });
  }, []);

  /* Territory score — computed only when game is over */
  const score: ScoreResult | null = useMemo(() => {
    if (!state.gameOver) return null;
    return calculateTerritory(
      state.board,
      state.capturedByBlack,
      state.capturedByWhite,
    );
  }, [state.gameOver, state.board, state.capturedByBlack, state.capturedByWhite]);

  return {
    state,
    score,
    handlePlaceStone,
    handlePass,
    handleUndo,
    handleReset,
    handleSyncState,
  };
}
