import { useState } from 'react';
import type { ConnectionStatus } from '../../logic/useOnlineGame';
import styles from './Lobby.module.css';

/* ═══════════════════════════════════════════════════
   Lobby — room creation & joining screen
   ═══════════════════════════════════════════════════ */

export interface LobbyProps {
  connectionStatus: ConnectionStatus;
  roomCode: string;
  opponentConnected: boolean;
  error: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onStartLocalGame: () => void;
  onClearError: () => void;
}

export default function Lobby({
  connectionStatus,
  roomCode,
  opponentConnected,
  error,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onStartLocalGame,
  onClearError,
}: LobbyProps) {
  const [joinCode, setJoinCode] = useState('');

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
            {/* Room code display */}
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

      {/* ── Local game ── */}
      <button
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onStartLocalGame}
      >
        本地对局
      </button>
    </div>
  );
}
