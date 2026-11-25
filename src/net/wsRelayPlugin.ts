import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { DEFAULT_MATCH_CONFIG, type Faction, type MatchConfig } from '../sim/types';
import type { ClientToServerMsg, LobbyStatePayload, ServerToClientMsg } from './protocol';

interface Room {
  id: string;
  config: MatchConfig;
  inMatch: boolean;
  host: WebSocket | null;
  hostToken: string;
  hostReady: boolean;
  hostDisconnectTimer: ReturnType<typeof setTimeout> | null;
  guest: WebSocket | null;
  guestToken: string | null;
  guestReady: boolean;
  guestDisconnectTimer: ReturnType<typeof setTimeout> | null;
}

export interface RelayOptions {
  /** How long a disconnected player's seat is reserved for mid-game reconnect (default: 45s). */
  reconnectGraceMs?: number;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateRoomCode(existing: Map<string, Room>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    }
    if (!existing.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function oppositeFaction(f: Faction): Faction {
  return f === 'allies' ? 'soviets' : 'allies';
}

function sanitizeConfig(input?: Partial<MatchConfig>, base?: MatchConfig): MatchConfig {
  const prev = base ?? { ...DEFAULT_MATCH_CONFIG, balancedPvP: true };
  const mapPreset =
    input?.mapPreset === 'arctic' || input?.mapPreset === 'volcanic' || input?.mapPreset === 'canyon'
      ? input.mapPreset
      : prev.mapPreset;
  const hostFaction: Faction =
    input?.hostFaction === 'soviets' || input?.hostFaction === 'allies'
      ? input.hostFaction
      : prev.hostFaction;
  const startingCredits =
    typeof input?.startingCredits === 'number' && Number.isFinite(input.startingCredits)
      ? Math.max(1500, Math.min(25000, Math.round(input.startingCredits)))
      : prev.startingCredits;
  const difficulty =
    input?.difficulty === 'easy' || input?.difficulty === 'normal' || input?.difficulty === 'brutal'
      ? input.difficulty
      : prev.difficulty;
  const seed =
    typeof input?.seed === 'number' && Number.isFinite(input.seed)
      ? input.seed >>> 0
      : prev.seed;

  return {
    mapPreset,
    hostFaction,
    startingCredits,
    difficulty,
    fogOfWar: typeof input?.fogOfWar === 'boolean' ? input.fogOfWar : prev.fogOfWar,
    cratesEnabled:
      typeof input?.cratesEnabled === 'boolean' ? input.cratesEnabled : prev.cratesEnabled,
    superweaponsEnabled:
      typeof input?.superweaponsEnabled === 'boolean'
        ? input.superweaponsEnabled
        : prev.superweaponsEnabled,
    balancedPvP: true,
    seed,
  };
}

function sendJson(ws: WebSocket | null, msg: ServerToClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function makeLobbyPayload(room: Room): LobbyStatePayload {
  return {
    roomId: room.id,
    config: room.config,
    hostReady: room.hostReady,
    guestReady: room.guestReady,
    peerConnected: room.host !== null && room.guest !== null,
    inMatch: room.inMatch,
  };
}

function broadcastLobby(room: Room): void {
  const payload = makeLobbyPayload(room);
  sendJson(room.host, { type: 'lobby_state', lobby: payload });
  sendJson(room.guest, { type: 'lobby_state', lobby: payload });
}

/**
 * Lightweight 2-player room relay with Pre-Game Lobby sync, Delta Snapshot routing,
 * and 45-second Mid-Game Reconnect grace period.
 */
export function attachRelayToHttpServer(
  httpServer: {
    on: (
      event: string,
      cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
    ) => void;
  },
  path = '/ws',
  options: RelayOptions = {}
): WebSocketServer {
  const reconnectGraceMs = options.reconnectGraceMs ?? 45_000;
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();
  const socketRoom = new Map<WebSocket, { roomId: string; role: 'host' | 'guest' }>();

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const urlPath = (req.url ?? '').split('?')[0];
    if (urlPath !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  const destroyRoom = (roomId: string) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    if (room.guestDisconnectTimer) clearTimeout(room.guestDisconnectTimer);
    if (room.host) socketRoom.delete(room.host);
    if (room.guest) socketRoom.delete(room.guest);
    rooms.delete(roomId);
  };

  const leaveCurrentRoom = (ws: WebSocket, permanent: boolean) => {
    const info = socketRoom.get(ws);
    if (!info) return;
    socketRoom.delete(ws);

    const room = rooms.get(info.roomId);
    if (!room) return;

    if (info.role === 'host') {
      if (room.host !== ws) return;
      room.host = null;
      if (permanent || !room.inMatch) {
        sendJson(room.guest, { type: 'peer_left' });
        destroyRoom(info.roomId);
        return;
      }

      // Mid-game unexpected disconnect: reserve host seat for grace period
      sendJson(room.guest, {
        type: 'peer_disconnected',
        graceSeconds: Math.max(1, Math.round(reconnectGraceMs / 1000)),
      });
      if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
      room.hostDisconnectTimer = setTimeout(() => {
        const current = rooms.get(info.roomId);
        if (!current || current.host !== null) return;
        sendJson(current.guest, { type: 'peer_left' });
        destroyRoom(info.roomId);
      }, reconnectGraceMs);
    } else {
      if (room.guest !== ws) return;
      room.guest = null;
      room.guestReady = false;

      if (permanent || !room.inMatch) {
        room.guestToken = null;
        sendJson(room.host, { type: 'peer_left' });
        broadcastLobby(room);
        return;
      }

      // Mid-game unexpected disconnect: reserve guest seat for grace period
      sendJson(room.host, {
        type: 'peer_disconnected',
        graceSeconds: Math.max(1, Math.round(reconnectGraceMs / 1000)),
      });
      if (room.guestDisconnectTimer) clearTimeout(room.guestDisconnectTimer);
      room.guestDisconnectTimer = setTimeout(() => {
        const current = rooms.get(info.roomId);
        if (!current || current.guest !== null) return;
        current.guestToken = null;
        current.guestReady = false;
        sendJson(current.host, { type: 'peer_left' });
      }, reconnectGraceMs);
    }
  };

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: ClientToServerMsg;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMsg;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendJson(ws, { type: 'pong', t: msg.t });
        return;
      }

      if (msg.type === 'create_room') {
        leaveCurrentRoom(ws, true);
        const roomId = generateRoomCode(rooms);
        const config = sanitizeConfig({
          ...(msg.config ?? {}),
          ...(msg.mapPreset ? { mapPreset: msg.mapPreset } : {}),
          seed: msg.config?.seed ?? Math.floor(Math.random() * 1_000_000) + 1,
        });
        const hostToken = msg.sessionToken?.trim() || generateToken();
        const room: Room = {
          id: roomId,
          config,
          inMatch: false,
          host: ws,
          hostToken,
          hostReady: false,
          hostDisconnectTimer: null,
          guest: null,
          guestToken: null,
          guestReady: false,
          guestDisconnectTimer: null,
        };
        rooms.set(roomId, room);
        socketRoom.set(ws, { roomId, role: 'host' });
        sendJson(ws, {
          type: 'room_created',
          roomId,
          faction: config.hostFaction,
          mapPreset: config.mapPreset,
          config,
          sessionToken: hostToken,
          inMatch: false,
          hostReady: false,
          guestReady: false,
        });
        return;
      }

      if (msg.type === 'join_room') {
        leaveCurrentRoom(ws, true);
        const roomId = msg.roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          sendJson(ws, { type: 'error', message: `Room "${roomId}" not found or expired.` });
          return;
        }

        const incomingToken = msg.sessionToken?.trim() || null;

        // 1) Host reconnect via matching sessionToken
        if (incomingToken && incomingToken === room.hostToken) {
          if (room.hostDisconnectTimer) {
            clearTimeout(room.hostDisconnectTimer);
            room.hostDisconnectTimer = null;
          }
          if (room.host && room.host !== ws) {
            socketRoom.delete(room.host);
            try {
              room.host.close();
            } catch {
              // ignore
            }
          }
          room.host = ws;
          socketRoom.set(ws, { roomId, role: 'host' });
          sendJson(ws, {
            type: 'room_joined',
            roomId,
            role: 'host',
            faction: room.config.hostFaction,
            mapPreset: room.config.mapPreset,
            config: room.config,
            sessionToken: room.hostToken,
            reconnected: true,
            inMatch: room.inMatch,
            hostReady: room.hostReady,
            guestReady: room.guestReady,
            peerConnected: room.guest !== null && room.guest.readyState === WebSocket.OPEN,
          });
          sendJson(room.guest, {
            type: 'peer_reconnected',
            peerFaction: room.config.hostFaction,
          });
          return;
        }

        // 2) Guest reconnect via matching sessionToken
        if (incomingToken && room.guestToken && incomingToken === room.guestToken) {
          if (room.guestDisconnectTimer) {
            clearTimeout(room.guestDisconnectTimer);
            room.guestDisconnectTimer = null;
          }
          if (room.guest && room.guest !== ws) {
            socketRoom.delete(room.guest);
            try {
              room.guest.close();
            } catch {
              // ignore
            }
          }
          room.guest = ws;
          socketRoom.set(ws, { roomId, role: 'guest' });
          const guestFaction = oppositeFaction(room.config.hostFaction);
          sendJson(ws, {
            type: 'room_joined',
            roomId,
            role: 'guest',
            faction: guestFaction,
            mapPreset: room.config.mapPreset,
            config: room.config,
            sessionToken: room.guestToken,
            reconnected: true,
            inMatch: room.inMatch,
            hostReady: room.hostReady,
            guestReady: room.guestReady,
            peerConnected: room.host !== null && room.host.readyState === WebSocket.OPEN,
          });
          sendJson(room.host, {
            type: 'peer_reconnected',
            peerFaction: guestFaction,
          });
          return;
        }

        // 3) New Guest joining
        if (room.guest && room.guest.readyState === WebSocket.OPEN) {
          sendJson(ws, {
            type: 'error',
            message: `Room "${roomId}" is already full (2/2 players).`,
          });
          return;
        }
        if (room.inMatch && room.guestToken) {
          sendJson(ws, {
            type: 'error',
            message: `Room "${roomId}" match is in progress (seat reserved for reconnecting player).`,
          });
          return;
        }

        const guestToken = incomingToken || generateToken();
        room.guest = ws;
        room.guestToken = guestToken;
        room.guestReady = false;
        socketRoom.set(ws, { roomId, role: 'guest' });
        const guestFaction = oppositeFaction(room.config.hostFaction);

        sendJson(ws, {
          type: 'room_joined',
          roomId,
          role: 'guest',
          faction: guestFaction,
          mapPreset: room.config.mapPreset,
          config: room.config,
          sessionToken: guestToken,
          reconnected: false,
          inMatch: room.inMatch,
          hostReady: room.hostReady,
          guestReady: room.guestReady,
          peerConnected: room.host !== null && room.host.readyState === WebSocket.OPEN,
        });
        sendJson(room.host, { type: 'peer_joined', peerFaction: guestFaction });
        broadcastLobby(room);
        return;
      }

      if (msg.type === 'leave_room') {
        leaveCurrentRoom(ws, true);
        return;
      }

      const info = socketRoom.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;

      if (msg.type === 'update_lobby' && info.role === 'host') {
        room.config = sanitizeConfig(msg.config, room.config);
        room.guestReady = false;
        broadcastLobby(room);
      } else if (msg.type === 'set_ready') {
        if (info.role === 'host') room.hostReady = !!msg.ready;
        else room.guestReady = !!msg.ready;
        broadcastLobby(room);
      } else if (msg.type === 'start_match' && info.role === 'host') {
        if (!room.guest || room.guest.readyState !== WebSocket.OPEN) {
          sendJson(ws, { type: 'error', message: 'Wait for an opponent to join before launching.' });
          return;
        }
        room.inMatch = true;
        room.hostReady = true;
        room.guestReady = true;
        sendJson(room.host, { type: 'match_started', config: room.config });
        sendJson(room.guest, { type: 'match_started', config: room.config });
      } else if (msg.type === 'cmd' && info.role === 'guest') {
        sendJson(room.host, { type: 'cmd', cmd: msg.cmd });
      } else if (msg.type === 'snapshot' && info.role === 'host') {
        sendJson(room.guest, { type: 'snapshot', snapshot: msg.snapshot });
      } else if (msg.type === 'snapshot_packet' && info.role === 'host') {
        sendJson(room.guest, { type: 'snapshot_packet', packet: msg.packet });
      } else if (msg.type === 'request_full_sync' && info.role === 'guest') {
        sendJson(room.host, { type: 'request_full_sync' });
      } else if (msg.type === 'restart_match' && info.role === 'host') {
        room.config = sanitizeConfig(
          {
            ...(msg.config ?? {}),
            ...(msg.mapPreset ? { mapPreset: msg.mapPreset } : {}),
            seed: msg.config?.seed ?? Math.floor(Math.random() * 1_000_000) + 1,
          },
          room.config
        );
        room.inMatch = true;
        sendJson(room.guest, {
          type: 'restart_match',
          mapPreset: room.config.mapPreset,
          config: room.config,
        });
      } else if (msg.type === 'chat') {
        const cleanText = String(msg.text ?? '').trim().slice(0, 140);
        if (!cleanText) return;
        const from =
          info.role === 'host'
            ? room.config.hostFaction
            : oppositeFaction(room.config.hostFaction);
        const peer = info.role === 'host' ? room.guest : room.host;
        sendJson(peer, { type: 'chat', from, text: cleanText });
      }
    });

    ws.on('close', () => leaveCurrentRoom(ws, false));
    ws.on('error', () => leaveCurrentRoom(ws, false));
  });

  wss.on('close', () => {
    for (const id of Array.from(rooms.keys())) {
      destroyRoom(id);
    }
  });

  return wss;
}

export function multiplayerRelayPlugin(): Plugin {
  return {
    name: 'red-alert-mp-relay',
    configureServer(server: ViteDevServer) {
      if (server.httpServer) {
        attachRelayToHttpServer(server.httpServer, '/ws');
      }
    },
    configurePreviewServer(server: PreviewServer) {
      if (server.httpServer) {
        attachRelayToHttpServer(server.httpServer, '/ws');
      }
    },
  };
}
