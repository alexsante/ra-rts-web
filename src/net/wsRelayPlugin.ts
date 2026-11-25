import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import type { MapPreset } from '../sim/types';
import type { ClientToServerMsg, ServerToClientMsg } from './protocol';

interface Room {
  id: string;
  mapPreset: MapPreset;
  host: WebSocket;
  guest: WebSocket | null;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function sendJson(ws: WebSocket | null, msg: ServerToClientMsg): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Lightweight 2-player room relay attached directly to a Node HTTP server.
 * Used by both Vite dev/preview servers and the standalone production server.
 */
export function attachRelayToHttpServer(
  httpServer: { on: (event: string, cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void) => void },
  path = '/ws'
): WebSocketServer {
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

  const leaveCurrentRoom = (ws: WebSocket) => {
    const info = socketRoom.get(ws);
    if (!info) return;
    socketRoom.delete(ws);

    const room = rooms.get(info.roomId);
    if (!room) return;

    if (info.role === 'host') {
      sendJson(room.guest, { type: 'peer_left' });
      if (room.guest) socketRoom.delete(room.guest);
      rooms.delete(info.roomId);
    } else {
      room.guest = null;
      sendJson(room.host, { type: 'peer_left' });
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
        leaveCurrentRoom(ws);
        const roomId = generateRoomCode(rooms);
        const mapPreset: MapPreset = msg.mapPreset ?? 'canyon';
        rooms.set(roomId, { id: roomId, mapPreset, host: ws, guest: null });
        socketRoom.set(ws, { roomId, role: 'host' });
        sendJson(ws, { type: 'room_created', roomId, faction: 'allies', mapPreset });
        return;
      }

      if (msg.type === 'join_room') {
        leaveCurrentRoom(ws);
        const roomId = msg.roomId.trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          sendJson(ws, { type: 'error', message: `Room "${roomId}" not found or expired.` });
          return;
        }
        if (room.guest && room.guest.readyState === WebSocket.OPEN) {
          sendJson(ws, { type: 'error', message: `Room "${roomId}" is already full (2/2 players).` });
          return;
        }
        room.guest = ws;
        socketRoom.set(ws, { roomId, role: 'guest' });
        sendJson(ws, { type: 'room_joined', roomId, faction: 'soviets', mapPreset: room.mapPreset });
        sendJson(room.host, { type: 'peer_joined', peerFaction: 'soviets' });
        return;
      }

      if (msg.type === 'leave_room') {
        leaveCurrentRoom(ws);
        return;
      }

      const info = socketRoom.get(ws);
      if (!info) return;
      const room = rooms.get(info.roomId);
      if (!room) return;

      if (msg.type === 'cmd' && info.role === 'guest') {
        sendJson(room.host, { type: 'cmd', cmd: msg.cmd });
      } else if (msg.type === 'snapshot' && info.role === 'host') {
        sendJson(room.guest, { type: 'snapshot', snapshot: msg.snapshot });
      } else if (msg.type === 'restart_match' && info.role === 'host') {
        if (msg.mapPreset) room.mapPreset = msg.mapPreset;
        sendJson(room.guest, { type: 'restart_match', mapPreset: room.mapPreset });
      } else if (msg.type === 'chat') {
        const cleanText = String(msg.text ?? '').trim().slice(0, 140);
        if (!cleanText) return;
        const from = info.role === 'host' ? 'allies' : 'soviets';
        const peer = info.role === 'host' ? room.guest : room.host;
        sendJson(peer, { type: 'chat', from, text: cleanText });
      }
    });

    ws.on('close', () => leaveCurrentRoom(ws));
    ws.on('error', () => leaveCurrentRoom(ws));
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
