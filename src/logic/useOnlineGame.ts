/* ═══════════════════════════════════════════════════════════
   useOnlineGame.ts — wraps useGameState with WebSocket
   for room-based online two-player Go.
   ═══════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { StoneColor } from '../types';
import { useGameState } from './useGameState';
import { replayHistory } from './goEngine';
import type { HistoryEntry } from './goEngine';
import { playStoneSound } from '../utils/sound';
import { getUserId } from '../utils/userId';

/* ─── Types ─── */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface PendingRequest {
  type: 'undo' | 'reset';
}

interface ServerMessage {
  type: string;
  code?: string;
  color?: StoneColor;
  row?: number;
  col?: number;
  message?: string;
  moveHistory?: HistoryEntry[];
  loser?: string;
}

/* ─── Constants ─── */

/** Auto-detect the WebSocket URL:
 *  - Dev:  separate WS server on port 3001 (Vite serves frontend on :5173)
 *  - Prod: same host as the page (Express serves frontend + WS on one port) */
function getWsUrl(): string {
  // Vite injects import.meta.env.DEV at build time
  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:3001`;
  }
  // Production: connect to the same host that served the page
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

const WS_URL = getWsUrl();

/* ─── Hook ─── */

export function useOnlineGame() {
  // Underlying local game engine
  const game = useGameState();

  // ── Stable refs to game handlers (never stale in ws.onmessage) ──
  const handlersRef = useRef(game);
  handlersRef.current = game;

  // ── Online state ──
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [roomCode, setRoomCode] = useState<string>('');
  const [myColor, setMyColor] = useState<StoneColor | null>(null);
  const [opponentConnected, setOpponentConnected] = useState(false);
  const [searching, setSearching] = useState(false);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number>(0);
  const [disconnectLoss, setDisconnectLoss] = useState<string | null>(null); // loser userId
  const [opponentResigned, setOpponentResigned] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── WebSocket ref ──
  const wsRef = useRef<WebSocket | null>(null);

  // ── Connect ──
  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    setConnectionStatus('connecting');
    setError(null);

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnectionStatus('connected');
      // Identify with persistent userId for reconnection
      ws.send(JSON.stringify({ type: 'identify', userId: getUserId() }));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'room_created':
          setRoomCode(msg.code!);
          setMyColor('black');
          setOpponentConnected(false);
          break;

        case 'room_joined':
          setRoomCode(msg.code!);
          setMyColor('white');
          setOpponentConnected(true); // creator is already in the room
          break;

        case 'player_joined':
          setOpponentConnected(true);
          break;

        case 'game_start':
          setOpponentConnected(true); // definitive: both players present
          setSearching(false);
          break;

        case 'match_found':
          setRoomCode(msg.code!);
          setMyColor(msg.color!);
          setOpponentConnected(true);
          setSearching(false);
          break;

        case 'game_sync': {
          // Reconnection — restore full game state from move history
          const history: HistoryEntry[] = msg.moveHistory || [];
          const replayed = replayHistory(history);
          handlersRef.current?.handleSyncState(replayed);
          setRoomCode(msg.code!);
          setMyColor(msg.color!);
          setOpponentConnected(true);
          setSearching(false);
          break;
        }

        case 'opponent_reconnected':
          setOpponentConnected(true);
          break;

        case 'searching':
          setSearching(true);
          break;

        case 'search_cancelled':
          setSearching(false);
          break;

        case 'move':
          // Opponent placed a stone — dispatch locally
          if (handlersRef.current) {
            handlersRef.current.handlePlaceStone(msg.row!, msg.col!);
            playStoneSound();
          }
          break;

        case 'pass':
          handlersRef.current?.handlePass();
          break;

        case 'undo_request':
          setPendingRequest({ type: 'undo' });
          break;

        case 'undo_accepted':
          handlersRef.current?.handleUndo();
          setPendingRequest(null);
          break;

        case 'undo_rejected':
          setPendingRequest(null);
          break;

        case 'reset_request':
          setPendingRequest({ type: 'reset' });
          break;

        case 'reset_accepted':
          handlersRef.current?.handleReset();
          setPendingRequest(null);
          break;

        case 'reset_rejected':
          setPendingRequest(null);
          break;

        case 'opponent_disconnected':
          setOpponentConnected(false);
          setDisconnectCountdown(30);
          break;

        case 'opponent_reconnected':
          setOpponentConnected(true);
          setDisconnectCountdown(0);
          break;

        case 'opponent_resigned':
          setOpponentConnected(false);
          setOpponentResigned(true);
          setDisconnectCountdown(0);
          break;

        case 'disconnect_loss': {
          const myId = getUserId();
          if (msg.loser === myId) {
            setDisconnectLoss(myId);
          } else {
            setDisconnectLoss(msg.loser || 'opponent');
          }
          setDisconnectCountdown(0);
          setOpponentConnected(false);
          break;
        }

        case 'error':
          setError(msg.message ?? 'Server error');
          break;
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setOpponentConnected(false);
    };

    ws.onerror = () => {
      setError('无法连接到服务器');
      setConnectionStatus('disconnected');
    };

    wsRef.current = ws;
  }, []);

  // ── Disconnect countdown interval ──
  useEffect(() => {
    if (disconnectCountdown <= 0) return;
    const id = setInterval(() => {
      setDisconnectCountdown((c) => {
        if (c <= 1) { clearInterval(id); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [disconnectCountdown > 0]); // eslint-disable-line

  // ── Send game_over on normal game end (territory) ──
  const gameOverSent = useRef(false);
  useEffect(() => {
    if (game.state.gameOver && game.score && !gameOverSent.current && roomCode) {
      gameOverSent.current = true;
      const winner = game.score.winner;
      if (winner !== 'tie') {
        wsRef.current?.send(JSON.stringify({
          type: 'game_over',
          winner,
          reason: 'territory',
        }));
      }
    }
    if (!game.state.gameOver) gameOverSent.current = false;
  }, [game.state.gameOver, game.score, roomCode]);

  // ── Disconnect on unmount ──
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ── Room management ──

  const createRoom = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setError(null);
    wsRef.current.send(JSON.stringify({ type: 'create_room' }));
  }, []);

  const joinRoom = useCallback((code: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setError(null);
    setSearching(false);
    wsRef.current.send(JSON.stringify({ type: 'join_room', code: code.toUpperCase() }));
  }, []);

  const findMatch = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setError(null);
    setSearching(true);
    wsRef.current.send(JSON.stringify({ type: 'find_match' }));
  }, []);

  const cancelSearch = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'cancel_search' }));
    setSearching(false);
  }, []);

  const leaveRoom = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'leave_room' }));
    wsRef.current?.close();
    setRoomCode('');
    setMyColor(null);
    setOpponentConnected(false);
    setSearching(false);
    setOpponentResigned(false);
    setDisconnectLoss(null);
    setPendingRequest(null);
    game.handleReset();
  }, [game]);

  // ── Online-aware game actions ──

  const isMyTurn =
    myColor !== null &&
    game.state.currentPlayer === myColor &&
    !game.state.gameOver &&
    opponentConnected;

  const myHandlePlaceStone = useCallback(
    (row: number, col: number) => {
      if (!isMyTurn) return;
      wsRef.current?.send(JSON.stringify({ type: 'place_stone', row, col }));
      game.handlePlaceStone(row, col);
    },
    [isMyTurn, game],
  );

  const myHandlePass = useCallback(() => {
    if (!isMyTurn) return;
    wsRef.current?.send(JSON.stringify({ type: 'pass' }));
    game.handlePass();
  }, [isMyTurn, game]);

  const myHandleUndo = useCallback(() => {
    if (game.state.moveHistory.length === 0) return;
    wsRef.current?.send(JSON.stringify({ type: 'undo_request' }));
  }, [game.state.moveHistory.length]);

  const myHandleReset = useCallback(() => {
    if (!opponentConnected) return;
    wsRef.current?.send(JSON.stringify({ type: 'reset_request' }));
  }, [opponentConnected]);

  const handleAcceptRequest = useCallback(() => {
    if (!pendingRequest) return;
    const reqType = pendingRequest.type;
    // Send accept — server broadcasts back to BOTH players,
    // including us. We apply when we receive the broadcast,
    // avoiding a double-apply.
    wsRef.current?.send(
      JSON.stringify({
        type: reqType === 'undo' ? 'undo_accept' : 'reset_accept',
      }),
    );
    setPendingRequest(null);
  }, [pendingRequest]);

  const handleRejectRequest = useCallback(() => {
    if (!pendingRequest) return;
    wsRef.current?.send(
      JSON.stringify({
        type: pendingRequest.type === 'undo' ? 'undo_reject' : 'reset_reject',
      }),
    );
    setPendingRequest(null);
  }, [pendingRequest]);

  const clearError = useCallback(() => setError(null), []);

  return {
    // Game interface (same shape as useGameState)
    state: game.state,
    score: game.score,
    handlePlaceStone: myHandlePlaceStone,
    handlePass: myHandlePass,
    handleUndo: myHandleUndo,
    handleReset: myHandleReset,

    // Connection
    connectionStatus,
    connect,

    // Room
    roomCode,
    myColor,
    opponentConnected,
    disconnectCountdown,
    disconnectLoss,
    opponentResigned,
    searching,
    createRoom,
    joinRoom,
    findMatch,
    cancelSearch,
    leaveRoom,

    // Requests
    pendingRequest,
    handleAcceptRequest,
    handleRejectRequest,

    // Error
    error,
    clearError,
  };
}
