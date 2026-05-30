import { useCallback, useMemo } from 'react';
import type { BoardState, StoneColor, Move } from '../../types';
import { STAR_POINTS } from '../../types';
import { playStoneSound } from '../../utils/sound';
import styles from './Board.module.css';

/* ═══════════════════════════════════════════════════
   Board Props
   ═══════════════════════════════════════════════════ */
export interface BoardProps {
  board: BoardState;
  currentPlayer: StoneColor;
  lastMove: Move | null;
  onIntersectionClick: (row: number, col: number) => void;
  disabled?: boolean;
}

/* ═══════════════════════════════════════════════════
   Coordinate helpers (SVG viewBox = 0 0 100 100)

   margin = 5%, spacing = 90%/18 = 5%
   line i is at 5 + i * 5  →  5, 10, 15, ..., 95
   ═══════════════════════════════════════════════════ */
const MARGIN = 5;
const SPACING = 90 / 18; // = 5 (%)

function yPos(row: number): number {
  return MARGIN + row * SPACING;
}

function xPos(col: number): number {
  return MARGIN + col * SPACING;
}

/* ═══════════════════════════════════════════════════
   Board Component
   ═══════════════════════════════════════════════════ */
export default function Board({
  board,
  currentPlayer,
  lastMove,
  onIntersectionClick,
  disabled = false,
}: BoardProps) {
  const handleClick = useCallback(
    (row: number, col: number) => {
      if (disabled) return;
      if (board[row][col] !== null) return;
      playStoneSound();
      onIntersectionClick(row, col);
    },
    [board, disabled, onIntersectionClick],
  );

  /* Build SVG grid lines + star points (never change) */
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const lineColor = '#5c4a32';
    const lw = 0.28;

    for (let i = 0; i < 19; i++) {
      const pos = MARGIN + i * SPACING;
      lines.push(
        <line
          key={`h-${i}`}
          x1={MARGIN} y1={pos}
          x2={100 - MARGIN} y2={pos}
          stroke={lineColor} strokeWidth={lw} strokeLinecap="square"
        />,
        <line
          key={`v-${i}`}
          x1={pos} y1={MARGIN}
          x2={pos} y2={100 - MARGIN}
          stroke={lineColor} strokeWidth={lw} strokeLinecap="square"
        />,
      );
    }

    for (const [r, c] of STAR_POINTS) {
      lines.push(
        <circle
          key={`star-${r}-${c}`}
          cx={xPos(c)} cy={yPos(r)}
          r={0.8} fill={lineColor}
        />,
      );
    }

    return lines;
  }, []);

  /* Build coordinate labels (never change) */
  const coordLabels = useMemo(() => {
    const left: React.ReactNode[] = [];
    const bottom: React.ReactNode[] = [];

    for (let i = 0; i < 19; i++) {
      const label = String(i + 1);
      const py = yPos(i);
      const px = xPos(i);

      // Left-side: row numbers 1–19 aligned with horizontal grid lines
      left.push(
        <span
          key={`ly-${i}`}
          className={styles.leftLabel}
          style={{ top: `${py}%` }}
        >
          {label}
        </span>,
      );

      // Bottom: column numbers 1–19 aligned with vertical grid lines
      bottom.push(
        <span
          key={`bx-${i}`}
          className={styles.bottomLabel}
          style={{ left: `${px}%` }}
        >
          {label}
        </span>,
      );
    }

    return { left, bottom };
  }, []);

  return (
    <div className={styles.boardWrapper}>
      {/* ── Left coordinate labels (1–19) ── */}
      <div className={styles.leftLabels}>{coordLabels.left}</div>

      {/* ── Board ── */}
      <div className={styles.board}>
        {/* Grid lines via SVG */}
        <svg
          className={styles.gridSvg}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
        >
          {gridLines}
        </svg>

        {/* Intersection click-targets */}
        {board.map((row, rowIdx) =>
          row.map((stone, colIdx) => {
            const isLast =
              lastMove !== null &&
              lastMove.row === rowIdx &&
              lastMove.col === colIdx;

            return (
              <div
                key={`${rowIdx}-${colIdx}`}
                className={styles.intersection}
                style={{
                  left: `${xPos(colIdx)}%`,
                  top: `${yPos(rowIdx)}%`,
                }}
                onClick={() => handleClick(rowIdx, colIdx)}
              >
                {/* Hover ghost */}
                {stone === null && !disabled && (
                  <div
                    className={`${styles.hoverGhost} ${
                      currentPlayer === 'black'
                        ? styles.hoverGhostBlack
                        : styles.hoverGhostWhite
                    }`}
                  />
                )}

                {/* Placed stone */}
                {stone !== null && (
                  <div
                    className={`${styles.stone} ${
                      stone === 'black'
                        ? styles.blackStone
                        : styles.whiteStone
                    }${isLast ? ` ${styles.lastMove}` : ''}`}
                  />
                )}
              </div>
            );
          }),
        )}
      </div>

      {/* ── Bottom coordinate labels (1–19) ── */}
      <div className={styles.bottomLabels}>{coordLabels.bottom}</div>
    </div>
  );
}
