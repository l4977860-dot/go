/* ═══════════════════════════════════════════════════════════════
   goEngine.ts — Pure-function Go rules engine

   Covers:
     • Connected-group detection (flood-fill)
     • Liberty counting per group
     • Capture resolution
     • Suicide-move prevention
     • Ko (打劫) rule — simple ko via board-history comparison
   ═══════════════════════════════════════════════════════════════ */

import type { BoardState, StoneColor } from '../types';

/* ─── Constants ─── */

const BOARD_SIZE = 19;

/** Orthogonal directions: up, down, left, right */
const DIRS: ReadonlyArray<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/* ─── Helpers ─── */

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function opponentOf(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black';
}

/** Deep-clone a 19×19 board */
export function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

/** Compare two boards for equality */
export function boardsEqual(a: BoardState, b: BoardState): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (a[r][c] !== b[r][c]) return false;
    }
  }
  return true;
}

/* ─── Flood-fill: find all stones in a connected group ─── */

/**
 * Returns all [row, col] positions belonging to the same connected
 * group as the stone at (startRow, startCol).
 * Orthogonal adjacency only.  Returns empty array if the cell is empty.
 */
export function getGroup(
  board: BoardState,
  startRow: number,
  startCol: number,
): [number, number][] {
  const color = board[startRow][startCol];
  if (color === null) return [];

  const visited = new Set<number>();
  const group: [number, number][] = [];
  const stack: [number, number][] = [[startRow, startCol]];

  const key = (r: number, c: number) => r * BOARD_SIZE + c;

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const k = key(r, c);
    if (visited.has(k)) continue;
    visited.add(k);
    group.push([r, c]);

    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === color && !visited.has(key(nr, nc))) {
        stack.push([nr, nc]);
      }
    }
  }

  return group;
}

/* ─── Liberty counting ─── */

/**
 * Count the number of unique empty intersections adjacent to a group.
 * Pass the result of getGroup() as `groupCells`.
 */
export function countLiberties(
  board: BoardState,
  groupCells: ReadonlyArray<[number, number]>,
): number {
  const liberties = new Set<number>();

  for (const [r, c] of groupCells) {
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === null) {
        liberties.add(nr * BOARD_SIZE + nc);
      }
    }
  }

  return liberties.size;
}

/* ─── Result types ─── */

export interface PlaceResult {
  success: boolean;
  /** New board state (cloned) — only meaningful if success is true */
  board: BoardState;
  /** Stones removed by this move */
  captured: [number, number][];
  /** Human-readable error message when success is false */
  error?: string;
}

/* ─── Stone placement with full rules ─── */

/**
 * Attempt to place a stone at (row, col) for the given color.
 *
 * `previousBoard` is the board snapshot from **two moves ago**
 * (used for simple-ko detection).  Pass null if fewer than 2
 * moves have been played.
 *
 * Rules enforced:
 *   1. Intersection must be empty
 *   2. Adjacent opponent groups with 0 liberties are captured
 *   3. The placed stone's own group must have ≥1 liberty (no suicide)
 *   4. The resulting board must not equal previousBoard (ko)
 */
export function placeStone(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  previousBoard: BoardState | null,
): PlaceResult {
  // Rule 1 — must be empty
  if (board[row][col] !== null) {
    return {
      success: false,
      board,
      captured: [],
      error: 'Intersection is already occupied.',
    };
  }

  // Work on a clone
  const newBoard = cloneBoard(board);
  newBoard[row][col] = color;
  const opponent = opponentOf(color);
  const allCaptured: [number, number][] = [];

  // Rule 2 — capture adjacent opponent groups with 0 liberties
  for (const [dr, dc] of DIRS) {
    const nr = row + dr;
    const nc = col + dc;
    if (inBounds(nr, nc) && newBoard[nr][nc] === opponent) {
      const group = getGroup(newBoard, nr, nc);
      if (countLiberties(newBoard, group) === 0) {
        // Remove the captured group from the board
        for (const [gr, gc] of group) {
          newBoard[gr][gc] = null;
          allCaptured.push([gr, gc]);
        }
      }
    }
  }

  // Rule 3 — suicide check (after captures, since captures may
  //          open liberties for the placed stone)
  const myGroup = getGroup(newBoard, row, col);
  if (countLiberties(newBoard, myGroup) === 0) {
    return {
      success: false,
      board,
      captured: [],
      error: 'Suicide move — your group would have no liberties.',
    };
  }

  // Rule 4 — simple ko (打劫)
  // If this move captured exactly 1 stone, check that the resulting
  // board doesn't repeat the position from two moves ago.
  if (previousBoard !== null && allCaptured.length === 1) {
    if (boardsEqual(newBoard, previousBoard)) {
      return {
        success: false,
        board,
        captured: [],
        error: 'Ko (打劫) — this move would repeat the previous board position.',
      };
    }
  }

  return { success: true, board: newBoard, captured: allCaptured };
}

/* ─── Territory scoring (点目) ─── */

/** Result of territory + captures scoring */
export interface ScoreResult {
  /** Empty intersections surrounded by black */
  blackTerritory: number;
  /** Empty intersections surrounded by white */
  whiteTerritory: number;
  /** Stones captured BY black (white prisoners) */
  blackCaptures: number;
  /** Stones captured BY white (black prisoners) */
  whiteCaptures: number;
  /** Komi (compensation for white) — default 6.5 */
  komi: number;
  /** Black total = territory + captures */
  blackTotal: number;
  /** White total = territory + captures + komi */
  whiteTotal: number;
  /** Who won? */
  winner: StoneColor | 'tie';
  /** Margin of victory */
  margin: number;
}

export interface RegionResult {
  cells: [number, number][];
  borders: Set<StoneColor>;
}

/**
 * Flood-fill from an empty cell to find a contiguous empty region
 * and the stone colors that border it.
 */
export function getEmptyRegion(
  board: BoardState,
  startRow: number,
  startCol: number,
): RegionResult {
  const cells: [number, number][] = [];
  const borders = new Set<StoneColor>();
  const visited = new Set<number>();
  const stack: [number, number][] = [[startRow, startCol]];
  const key = (r: number, c: number) => r * BOARD_SIZE + c;

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const k = key(r, c);
    if (visited.has(k)) continue;
    visited.add(k);

    if (board[r][c] === null) {
      cells.push([r, c]);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(nr, nc) && !visited.has(key(nr, nc))) {
          if (board[nr][nc] === null) {
            stack.push([nr, nc]);
          } else {
            borders.add(board[nr][nc]!);
          }
        }
      }
    }
  }

  return { cells, borders };
}

/**
 * Calculate territory (目) for both players using flood-fill.
 *
 * An empty region belongs to a player if it is completely surrounded
 * by that player's stones.  Regions touching both colors (or neither)
 * are neutral (dame / 公气).
 *
 * Final score = territory + captured prisoners + komi for white.
 *
 * Japanese-style territory scoring with 6.5 komi.
 */
export function calculateTerritory(
  board: BoardState,
  capturedByBlack: number,
  capturedByWhite: number,
  komi: number = 6.5,
): ScoreResult {
  let blackTerritory = 0;
  let whiteTerritory = 0;
  const visited = new Set<number>();
  const key = (r: number, c: number) => r * BOARD_SIZE + c;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      // Only flood from empty cells not yet visited
      if (board[r][c] !== null || visited.has(key(r, c))) continue;

      const region = getEmptyRegion(board, r, c);

      // Mark all cells in this region as visited
      for (const [cr, cc] of region.cells) {
        visited.add(key(cr, cc));
      }

      // Determine ownership
      const hasBlack = region.borders.has('black');
      const hasWhite = region.borders.has('white');

      if (hasBlack && !hasWhite) {
        blackTerritory += region.cells.length;
      } else if (hasWhite && !hasBlack) {
        whiteTerritory += region.cells.length;
      }
      // else: neutral (both or neither) — contributes to neither
    }
  }

  const blackTotal = blackTerritory + capturedByBlack;
  const whiteTotal = whiteTerritory + capturedByWhite + komi;

  let winner: StoneColor | 'tie';
  let margin: number;

  if (blackTotal > whiteTotal) {
    winner = 'black';
    margin = blackTotal - whiteTotal;
  } else if (whiteTotal > blackTotal) {
    winner = 'white';
    margin = whiteTotal - blackTotal;
  } else {
    winner = 'tie';
    margin = 0;
  }

  return {
    blackTerritory,
    whiteTerritory,
    blackCaptures: capturedByBlack,
    whiteCaptures: capturedByWhite,
    komi,
    blackTotal,
    whiteTotal,
    winner,
    margin,
  };
}
