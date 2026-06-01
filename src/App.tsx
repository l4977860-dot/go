import { useEffect, useRef, useState } from 'react';
import Board from './components/Board/Board';
import Lobby from './components/Lobby/Lobby';
import { useGameState } from './logic/useGameState';
import { useOnlineGame } from './logic/useOnlineGame';
import { useAIGame } from './logic/useAIGame';
import type { AIDifficulty } from './logic/useAIGame';
import { playCaptureSound } from './utils/sound';
import { getUserId } from './utils/userId';
import type { ScoreResult } from './logic/goEngine';
import styles from './App.module.css';

/* ═══════════════════════════════════════════════════
   App — 弈手围棋
   Views: lobby → local / online / ai
   ═══════════════════════════════════════════════════ */

type AppView = 'lobby' | 'local' | 'online' | 'ai';

export default function App() {
  const [view, setView] = useState<AppView>('lobby');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // ── Local game ──
  const localGame = useGameState();

  // ── Online game ──
  const onlineGame = useOnlineGame();

  // ── AI game ──
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const aiGame = useAIGame(aiDifficulty);

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

  // ── Resolve active game ──
  const isOnline = view === 'online';
  const isAI = view === 'ai';
  const game = isOnline ? onlineGame : isAI ? aiGame : localGame;

  // ── Turn / disabled logic ──
  const isOnlineTurn =
    !isOnline ||
    (onlineGame.myColor !== null &&
      game.state.currentPlayer === onlineGame.myColor &&
      !game.state.gameOver &&
      onlineGame.opponentConnected);

  const isHumanTurn =
    !isAI ||
    (game.state.currentPlayer === aiGame.humanColor &&
      !game.state.gameOver &&
      !aiGame.aiThinking);

  const boardDisabled =
    game.state.gameOver ||
    (isOnline && !isOnlineTurn) ||
    (isAI && !isHumanTurn);

  // ── Capture sound ──
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
        searching={onlineGame.searching}
        error={onlineGame.error}
        onCreateRoom={onlineGame.createRoom}
        onJoinRoom={onlineGame.joinRoom}
        onFindMatch={onlineGame.findMatch}
        onCancelSearch={onlineGame.cancelSearch}
        onLeaveRoom={onlineGame.leaveRoom}
        onStartLocalGame={() => {
          localGame.handleReset();
          setView('local');
        }}
        onStartAIGame={(diff: AIDifficulty) => {
          setAiDifficulty(diff);
          aiGame.handleReset();
          setView('ai');
        }}
        onClearError={onlineGame.clearError}
      />
    );
  }

  /* ══════════════════════════════════════════════
     Game view (shared: local / online / ai)
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

      {/* ── AI indicator ── */}
      {isAI && (
        <div className={styles.onlineBar}>
          <span
            className={`${styles.onlineDot} ${
              aiGame.aiThinking
                ? styles.onlineDotDisconnected
                : styles.onlineDotConnected
            }`}
          />
          你执 ⚫ 黑棋 · AI {aiGame.difficulty === 'easy' ? '简单' : aiGame.difficulty === 'medium' ? '中等' : '困难'}
          {aiGame.aiThinking && (
            <span style={{ color: '#8a7c62', marginLeft: 6 }}>思考中...</span>
          )}
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
              : isAI
                ? isHumanTurn
                  ? '轮到你'
                  : 'AI 思考中'
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
        disabled={boardDisabled}
      />

      {/* ── Controls ── */}
      <div className={styles.controls}>
        <button
          className={`${styles.btn} ${styles.btnPass}`}
          onClick={game.handlePass}
          disabled={game.state.gameOver || !isOnlineTurn || (isAI && !isHumanTurn)}
        >
          虚手
        </button>
        <button
          className={styles.btn}
          onClick={game.handleUndo}
          disabled={
            game.state.moveHistory.length === 0 ||
            game.state.gameOver ||
            (isAI && game.state.moveHistory.length < 2)
          }
        >
          悔棋
        </button>
        <button
          className={`${styles.btn} ${styles.btnNew}`}
          onClick={game.handleReset}
          disabled={isOnline && !onlineGame.opponentConnected}
        >
          新局
        </button>
        {isOnline && onlineGame.opponentConnected && (
          <button
            className={`${styles.btn} ${styles.btnLeave}`}
            onClick={() => setShowLeaveConfirm(true)}
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

      {/* ── Confirm dialog (undo/reset from opponent) ── */}
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

      {/* ── Leave confirm dialog (online only) ── */}
      {showLeaveConfirm && (
        <div className={styles.confirmOverlay} onClick={() => setShowLeaveConfirm(false)}>
          <div className={styles.confirmCard} onClick={(e) => e.stopPropagation()}>
            <p className={styles.confirmMessage}>
              确定要离开吗？
              <br />
              <span style={{ color: '#9a7060', fontSize: '0.78rem' }}>离开将视为认输</span>
            </p>
            <div className={styles.confirmButtons}>
              <button
                className={`${styles.btn} ${styles.btnAccept}`}
                onClick={() => {
                  setShowLeaveConfirm(false);
                  try { onlineGame.leaveRoom(); } catch {}
                  setView('lobby');
                }}
              >
                认输离开
              </button>
              <button
                className={`${styles.btn} ${styles.btnReject}`}
                onClick={() => setShowLeaveConfirm(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Opponent resigned overlay (online only) ── */}
      {isOnline && onlineGame.opponentResigned && !game.state.gameOver && (
        <div className={styles.disconnectOverlay}>
          <div className={styles.disconnectCard}>
            <h3 className={styles.disconnectTitle}>对方认输</h3>
            <p style={{ color: '#8a7c62', fontSize: '0.82rem', margin: '0 0 18px' }}>
              对手主动离开了棋局
            </p>
            <button
              className={`${styles.btn} ${styles.btnNew}`}
              onClick={() => {
                try { onlineGame.leaveRoom(); } catch {}
                setView('lobby');
              }}
            >
              返回大厅
            </button>
          </div>
        </div>
      )}

      {/* ── Disconnect overlay with countdown (online only) ── */}
      {isOnline && !onlineGame.opponentConnected && !game.state.gameOver && !onlineGame.disconnectLoss && !onlineGame.opponentResigned && (
        <div className={styles.disconnectOverlay}>
          <div className={styles.disconnectCard}>
            <h3 className={styles.disconnectTitle}>对手已断开连接</h3>
            {onlineGame.disconnectCountdown > 0 ? (
              <>
                <p style={{ color: '#a09478', fontSize: '0.9rem', margin: '0 0 18px' }}>
                  对手剩余重连时间{' '}
                  <span style={{ color: '#c8bc98', fontWeight: 600, fontSize: '1.3rem' }}>
                    {onlineGame.disconnectCountdown}
                  </span>{' '}
                  秒
                </p>
                <p style={{ color: '#6e6250', fontSize: '0.72rem', margin: '0 0 16px' }}>
                  超时后对手将自动判负
                </p>
              </>
            ) : (
              <p style={{ color: '#8a7c62', fontSize: '0.82rem', margin: '0 0 18px' }}>
                等待对手重连...
              </p>
            )}
            <button
              className={`${styles.btn} ${styles.btnLeave}`}
              onClick={() => {
                try { onlineGame.leaveRoom(); } catch {}
                setView('lobby');
              }}
            >
              返回大厅
            </button>
          </div>
        </div>
      )}

      {/* ── Disconnect loss overlay (online only) ── */}
      {isOnline && onlineGame.disconnectLoss && (
        <div className={styles.disconnectOverlay}>
          <div className={styles.disconnectCard}>
            <h3 className={styles.disconnectTitle}>
              {onlineGame.disconnectLoss === getUserId()
                ? '你已断连超时，判负'
                : '对方断连被判负'}
            </h3>
            <p style={{ color: '#8a7c62', fontSize: '0.82rem', margin: '0 0 18px' }}>
              {onlineGame.disconnectLoss === getUserId()
                ? '你断开连接超过30秒'
                : '对手在30秒内未重连，系统判负'}
            </p>
            <button
              className={`${styles.btn} ${styles.btnNew}`}
              onClick={() => {
                try { onlineGame.leaveRoom(); } catch {}
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
