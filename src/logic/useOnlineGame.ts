/* ═══════════════════════════════════════════════════════════
   useOnlineGame.ts — wraps useGameState with WebSocket
   for room-based online two-player Go.
   ═══════════════════════════════════════════════════════════ */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { StoneColor } from '../types';
import { useGameState } from './useGameState';
import { playStoneSound } from '../utils/sound';

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
          break;

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
    wsRef.current.send(JSON.stringify({ type: 'join_room', code: code.toUpperCase() }));
  }, []);

  const leaveRoom = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'leave_room' }));
    wsRef.current?.close();
    setRoomCode('');
    setMyColor(null);
    setOpponentConnected(false);
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
    createRoom,
    joinRoom,
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
