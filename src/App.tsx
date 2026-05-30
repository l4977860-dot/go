import { useEffect, useRef, useState } from 'react';
import Board from './components/Board/Board';
import Lobby from './components/Lobby/Lobby';
import { useGameState } from './logic/useGameState';
import { useOnlineGame } from './logic/useOnlineGame';
import { playCaptureSound } from './utils/sound';
import type { ScoreResult } from './logic/goEngine';
import styles from './App.module.css';

/* ═══════════════════════════════════════════════════
   App — 弈手围棋
   Views: lobby → local game / online game
   ═══════════════════════════════════════════════════ */

type AppView = 'lobby' | 'local' | 'online';

export default function App() {
  const [view, setView] = useState<AppView>('lobby');

  // ── Local game ──
  const localGame = useGameState();

  // ── Online game ──
  const onlineGame = useOnlineGame();

  // ── Transition: lobby → online when opponent joins ──
  const prevOpponentConnected = useRef(false);
  useEffect(() => {
    if (
      view === 'lobby' &&
      onlineGame.opponentConnected &&
      !prevOpponentConnected.current
    ) {
      setView('online');
    }
    prevOpponentConnected.current = onlineGame.opponentConnected;
  }, [view, onlineGame.opponentConnected]);

  // ── Active game (based on current view) ──
  const game = view === 'online' ? onlineGame : localGame;
  const isOnline = view === 'online';
  const isOnlineTurn =
    !isOnline ||
    (onlineGame.myColor !== null &&
      game.state.currentPlayer === onlineGame.myColor &&
      game.state.gameOver === false &&
      onlineGame.opponentConnected);

  // ── Capture sound (works for both local and online) ──
  const prevCaptureCount = useRef(0);
  useEffect(() => {
    if (
      game.state.lastCaptureCount > 0 &&
      game.state.lastCaptureCount !== prevCaptureCount.current
    ) {
      playCaptureSound();
    }
    prevCaptureCount.current = game.state.lastCaptureCount;
  }, [game.state.lastCaptureCount]);

  // ── Auto-connect online when entering lobby ──
  useEffect(() => {
    if (view === 'lobby' && onlineGame.connectionStatus === 'disconnected') {
      onlineGame.connect();
    }
  }, [view, onlineGame.connectionStatus, onlineGame.connect]);

  /* ══════════════════════════════════════════════
     Lobby view
     ══════════════════════════════════════════════ */
  if (view === 'lobby') {
    return (
      <Lobby
        connectionStatus={onlineGame.connectionStatus}
        roomCode={onlineGame.roomCode}
        opponentConnected={onlineGame.opponentConnected}
        error={onlineGame.error}
        onCreateRoom={onlineGame.createRoom}
        onJoinRoom={onlineGame.joinRoom}
        onLeaveRoom={onlineGame.leaveRoom}
        onStartLocalGame={() => {
          localGame.handleReset();
          setView('local');
        }}
        onClearError={onlineGame.clearError}
      />
    );
  }

  /* ══════════════════════════════════════════════
     Game view (shared between local & online)
     ══════════════════════════════════════════════ */
  const turnLabel =
    game.state.currentPlayer === 'black' ? 'Black' : 'White';

  return (
    <div className={styles.app}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <h1 className={styles.title}>弈手围棋</h1>
      </header>

      {/* ── Online indicator ── */}
      {isOnline && (
        <div className={styles.onlineBar}>
          <span
            className={`${styles.onlineDot} ${
              onlineGame.opponentConnected
                ? styles.onlineDotConnected
                : styles.onlineDotDisconnected
            }`}
          />
          你执{' '}
          {onlineGame.myColor === 'black' ? '⚫ 黑棋' : '⚪ 白棋'}
          <span className={styles.roomLabel}>
            · 房间 {onlineGame.roomCode}
          </span>
        </div>
      )}

      {/* ── Info bar ── */}
      <div className={styles.infoBar}>
        <div className={styles.turnIndicator}>
          <span
            className={`${styles.turnStone} ${
              game.state.currentPlayer === 'black'
                ? styles.turnBlack
                : styles.turnWhite
            }`}
          />
          {game.state.gameOver
            ? '终局'
            : isOnline
              ? isOnlineTurn
                ? '轮到你'
                : '等待对手'
              : `${turnLabel} 执棋`}
        </div>

        <div className={styles.captureCount}>
          <span className={`${styles.captureStone} ${styles.captureBlack}`} />
          {game.state.capturedByBlack}
          <span style={{ margin: '0 5px', opacity: 0.25 }}>·</span>
          <span className={`${styles.captureStone} ${styles.captureWhite}`} />
          {game.state.capturedByWhite}
        </div>

        <span className={styles.moveCount}>
          第 {game.state.moveHistory.length + 1} 手
        </span>
      </div>

      {/* ── Board ── */}
      <Board
        board={game.state.board}
        currentPlayer={game.state.currentPlayer}
        lastMove={game.state.lastMove}
        onIntersectionClick={game.handlePlaceStone}
        disabled={game.state.gameOver || !isOnlineTurn}
      />

      {/* ── Controls ── */}
      <div className={styles.controls}>
        <button
          className={`${styles.btn} ${styles.btnPass}`}
          onClick={game.handlePass}
          disabled={game.state.gameOver || !isOnlineTurn}
        >
          虚手
        </button>
        <button
          className={styles.btn}
          onClick={game.handleUndo}
          disabled={
            game.state.moveHistory.length === 0 ||
            game.state.gameOver
          }
        >
          悔棋
        </button>
        <button
          className={`${styles.btn} ${styles.btnNew}`}
          onClick={game.handleReset}
          disabled={
            isOnline &&
            !onlineGame.opponentConnected
          }
        >
          新局
        </button>
        {isOnline && (
          <button
            className={`${styles.btn} ${styles.btnLeave}`}
            onClick={() => {
              onlineGame.leaveRoom();
              setView('lobby');
            }}
          >
            离开
          </button>
        )}
        {!isOnline && (
          <button
            className={`${styles.btn} ${styles.btnLeave}`}
            onClick={() => setView('lobby')}
          >
            返回
          </button>
        )}
      </div>

      {/* ── Game over overlay ── */}
      {game.state.gameOver && game.score && (
        <div className={styles.gameOverOverlay}>
          <div className={styles.gameOverCard}>
            <h2 className={styles.gameOverTitle}>终局</h2>
            <ScoreBoard score={game.score} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
              <button
                className={`${styles.btn} ${styles.btnNew}`}
                onClick={game.handleReset}
              >
                新局
              </button>
              {isOnline ? (
                <button
                  className={`${styles.btn} ${styles.btnLeave}`}
                  onClick={() => {
                    onlineGame.leaveRoom();
                    setView('lobby');
                  }}
                >
                  返回大厅
                </button>
              ) : (
                <button
                  className={`${styles.btn} ${styles.btnLeave}`}
                  onClick={() => setView('lobby')}
                >
                  返回
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog (undo/reset request from opponent) ── */}
      {isOnline && onlineGame.pendingRequest && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmCard}>
            <p className={styles.confirmMessage}>
              {onlineGame.pendingRequest.type === 'undo'
                ? '对手请求悔棋，同意吗？'
                : '对手请求重新开始，同意吗？'}
            </p>
            <div className={styles.confirmButtons}>
              <button
                className={`${styles.btn} ${styles.btnAccept}`}
                onClick={onlineGame.handleAcceptRequest}
              >
                同意
              </button>
              <button
                className={`${styles.btn} ${styles.btnReject}`}
                onClick={onlineGame.handleRejectRequest}
              >
                拒绝
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disconnect overlay (online only) ── */}
      {isOnline && !onlineGame.opponentConnected && !game.state.gameOver && (
        <div className={styles.disconnectOverlay}>
          <div className={styles.disconnectCard}>
            <h3 className={styles.disconnectTitle}>对手已断开连接</h3>
            <button
              className={`${styles.btn} ${styles.btnLeave}`}
              onClick={() => {
                onlineGame.leaveRoom();
                setView('lobby');
              }}
            >
              返回大厅
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Score display — territory + captures + komi
   ═══════════════════════════════════════════════════ */

const cell = (
  label: string,
  blackVal: string,
  whiteVal: string,
  highlight?: 'black' | 'white',
): React.ReactNode => (
  <>
    <span style={{ color: '#8a7c62', textAlign: 'left' }}>{label}</span>
    <span
      style={{
        textAlign: 'center',
        fontWeight: highlight === 'black' ? 600 : 400,
        color: highlight === 'black' ? '#c8bc98' : '#a09478',
      }}
    >
      {blackVal}
    </span>
    <span
      style={{
        textAlign: 'center',
        fontWeight: highlight === 'white' ? 600 : 400,
        color: highlight === 'white' ? '#c8bc98' : '#a09478',
      }}
    >
      {whiteVal}
    </span>
  </>
);

function ScoreBoard({ score }: { score: ScoreResult }) {
  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr 1fr',
          gap: '6px 24px',
          fontSize: '0.9rem',
          marginBottom: 16,
        }}
      >
        <span />
        <span style={{ textAlign: 'center', color: '#c8bc98', fontWeight: 600 }}>
          ⚫ 黑棋
        </span>
        <span style={{ textAlign: 'center', color: '#c8bc98', fontWeight: 600 }}>
          ⚪ 白棋
        </span>

        {cell('目数', String(score.blackTerritory), String(score.whiteTerritory))}
        {cell('提子', String(score.blackCaptures), String(score.whiteCaptures))}
        {cell('贴目', '—', score.komi.toFixed(1))}

        <span style={{ gridColumn: '1 / -1', borderTop: '1px solid rgba(160,140,110,0.25)', margin: '4px 0' }} />

        {cell(
          '合计',
          score.blackTotal.toFixed(1),
          score.whiteTotal.toFixed(1),
          score.winner === 'black'
            ? 'black'
            : score.winner === 'white'
              ? 'white'
              : undefined,
        )}
      </div>

      <p
        style={{
          fontSize: '1rem',
          color: '#c8bc98',
          fontWeight: 600,
          margin: 0,
        }}
      >
        {score.winner === 'tie'
          ? '平局'
          : `${score.winner === 'black' ? '⚫ 黑棋' : '⚪ 白棋'} 胜 ${score.margin.toFixed(1)} 目`}
      </p>
    </div>
  );
}
