import { useState } from 'react';
import type { ConnectionStatus } from '../../logic/useOnlineGame';
import type { AIDifficulty } from '../../logic/useAIGame';
import { getUserId } from '../../utils/userId';
import styles from './Lobby.module.css';

interface GameRecord {
  gameId: string;
  date: string;
  blackUserId: string;
  whiteUserId: string;
  winner: 'black' | 'white';
  winReason: string;
}

/* ═══════════════════════════════════════════════════
   Lobby — room creation, joining, and AI match
   ═══════════════════════════════════════════════════ */

export interface LobbyProps {
  connectionStatus: ConnectionStatus;
  roomCode: string;
  opponentConnected: boolean;
  searching: boolean;
  error: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onFindMatch: () => void;
  onCancelSearch: () => void;
  onLeaveRoom: () => void;
  onStartLocalGame: () => void;
  onStartAIGame: (difficulty: AIDifficulty) => void;
  onClearError: () => void;
}

export default function Lobby({
  connectionStatus,
  roomCode,
  opponentConnected,
  searching,
  error,
  onCreateRoom,
  onJoinRoom,
  onFindMatch,
  onCancelSearch,
  onLeaveRoom,
  onStartLocalGame,
  onStartAIGame,
  onClearError,
}: LobbyProps) {
  const [joinCode, setJoinCode] = useState('');
  const [showDifficulty, setShowDifficulty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<GameRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const myId = getUserId();

  const apiBase = import.meta.env.DEV ? 'http://localhost:3001' : '';

  const fetchHistory = () => {
    setHistoryLoading(true);
    setShowHistory(true);
    fetch(`${apiBase}/api/history/${myId}`)
      .then(r => r.json())
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  };

  const handleJoin = () => {
    const clean = joinCode.trim().toUpperCase();
    if (clean.length !== 6) return;
    onClearError();
    onJoinRoom(clean);
    setJoinCode('');
  };

  const isConnected = connectionStatus === 'connected';
  const hasRoom = roomCode !== '';

  return (
    <div className={styles.lobby}>
      {/* ── Title ── */}
      <h1 className={styles.title}>弈手围棋</h1>

      {/* ── Connection indicator ── */}
      <div className={styles.statusRow}>
        <span
          className={`${styles.statusDot} ${
            isConnected ? styles.dotConnected : styles.dotDisconnected
          }`}
        />
        {isConnected ? '已连接服务器' : '未连接'}
      </div>

      {/* ── Create room ── */}
      <div className={styles.panel}>
        <span className={styles.panelLabel}>创建房间</span>

        {!hasRoom ? (
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnWide}`}
            onClick={onCreateRoom}
            disabled={!isConnected}
          >
            创建房间
          </button>
        ) : (
          <>
            <div className={styles.codeBox}>
              {roomCode.split('').map((ch, i) => (
                <span key={i} className={styles.codeChar}>
                  {ch}
                </span>
              ))}
            </div>
            <p className={styles.waiting}>
              {opponentConnected ? '对手已加入，开始对局' : '等待对手加入...'}
            </p>
            <button
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnWide}`}
              onClick={onLeaveRoom}
              style={{ marginTop: 12 }}
            >
              取消
            </button>
          </>
        )}
      </div>

      {/* ── Divider ── */}
      <div className={styles.divider}>或</div>

      {/* ── Join room ── */}
      <div className={styles.panel}>
        <span className={styles.panelLabel}>加入房间</span>
        <div className={styles.joinRow}>
          <input
            className={styles.input}
            type="text"
            maxLength={6}
            placeholder="输入房间代码"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
          <button
            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
            onClick={handleJoin}
            disabled={joinCode.trim().length !== 6 || !isConnected}
          >
            加入
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>

      {/* ── Divider ── */}
      <div className={styles.divider}>或</div>

      {/* ── AI game ── */}
      <div className={styles.panel}>
        <span className={styles.panelLabel}>人机对弈</span>
        <button
          className={`${styles.btn} ${styles.btnAI} ${styles.btnWide}`}
          onClick={() => setShowDifficulty(true)}
        >
          人机对弈
        </button>
      </div>

      {/* ── Divider ── */}
      <div className={styles.divider}>或</div>

      {/* ── Random matchmaking ── */}
      <div className={styles.panel}>
        <span className={styles.panelLabel}>随机匹配</span>
        {searching ? (
          <div style={{ textAlign: 'center' }}>
            <p className={styles.waiting}>正在寻找对手...</p>
            <button
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnWide}`}
              onClick={onCancelSearch}
              style={{ marginTop: 10 }}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnMatch} ${styles.btnWide}`}
            onClick={onFindMatch}
            disabled={!isConnected}
          >
            随机匹配
          </button>
        )}
      </div>

      {/* ── Local game ── */}
      <button
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onStartLocalGame}
      >
        本地对局
      </button>

      {/* ── Match history ── */}
      <button
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={fetchHistory}
      >
        战绩
      </button>

      {/* ── History modal ── */}
      {showHistory && (
        <div className={styles.modalOverlay} onClick={() => setShowHistory(false)}>
          <div className={styles.historyModal} onClick={e => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>战绩记录</h3>
            {historyLoading ? (
              <p className={styles.waiting}>加载中...</p>
            ) : history.length === 0 ? (
              <p style={{ color: '#8a7c62', fontSize: '0.82rem', textAlign: 'center', padding: '20px 0' }}>
                暂无对局记录
              </p>
            ) : (
              <div className={styles.historyList}>
                {history.map(r => {
                  const myColor = r.blackUserId === myId ? 'black' : 'white';
                  const opponent = myColor === 'black' ? r.whiteUserId : r.blackUserId;
                  const isWin = r.winner === myColor;
                  const reasonLabel = r.winReason === 'resign' ? '认输' : r.winReason === 'timeout' ? '断线' : '数目';
                  return (
                    <div key={r.gameId} className={styles.historyRow}>
                      <div className={styles.historyInfo}>
                        <span className={styles.historyDate}>
                          {new Date(r.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={styles.historyRole}>
                          {myColor === 'black' ? '⚫ 执黑' : '⚪ 执白'}
                        </span>
                        <span className={styles.historyOpponent}>
                          vs {opponent.slice(0, 8)}
                        </span>
                        <span className={styles.historyReason}>
                          {reasonLabel}
                        </span>
                      </div>
                      <span className={isWin ? styles.historyWin : styles.historyLoss}>
                        {isWin ? '胜' : '负'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              className={styles.modalCancel}
              onClick={() => setShowHistory(false)}
              style={{ marginTop: 16 }}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ── Difficulty selection modal ── */}
      {showDifficulty && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowDifficulty(false)}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>选择难度</h3>
            <div className={styles.difficultyList}>
              <button
                className={styles.diffBtn}
                onClick={() => onStartAIGame('easy')}
              >
                简单
                <span className={styles.diffLabel}>Easy</span>
              </button>
              <button
                className={styles.diffBtn}
                onClick={() => onStartAIGame('medium')}
              >
                中等
                <span className={styles.diffLabel}>Medium</span>
              </button>
              <button
                className={styles.diffBtn}
                onClick={() => onStartAIGame('hard')}
              >
                困难
                <span className={styles.diffLabel}>Hard</span>
              </button>
            </div>
            <button
              className={styles.modalCancel}
              onClick={() => setShowDifficulty(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
