/* ═══════════════════════════════════════
   Core Go game types
   ═══════════════════════════════════════ */

/** Stone colors */
export type StoneColor = 'black' | 'white';

/** A single intersection on the board */
export type Intersection = {
  row: number; // 0-18
  col: number; // 0-18
  stone: StoneColor | null;
};

/** The full board state — 19×19 grid, row-major (row 0 = top) */
export type BoardState = (StoneColor | null)[][];

/** A placed stone with coordinates */
export type Move = {
  row: number;
  col: number;
  color: StoneColor;
};

/** Star point (hoshi) positions */
export const STAR_POINTS: ReadonlyArray<[number, number]> = [
  // Corners
  [3, 3],   [3, 9],   [3, 15],
  [9, 3],   [9, 9],   [9, 15],
  [15, 3],  [15, 9],  [15, 15],
];

/** Check if a position is a star point */
export function isStarPoint(row: number, col: number): boolean {
  return STAR_POINTS.some(([r, c]) => r === row && c === col);
}

/** Create an empty 19×19 board */
export function createEmptyBoard(): BoardState {
  return Array.from({ length: 19 }, () => Array(19).fill(null));
}
