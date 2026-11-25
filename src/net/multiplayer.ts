import type { Faction, MapPreset } from '../sim/types';
import type {
  ClientToServerMsg,
  GameCommand,
  ServerToClientMsg,
  WorldSnapshot,
} from './protocol';

export type MultiplayerMode = 'solo' | 'hosting_wait' | 'hosting_live' | 'guest_joining' | 'guest_live';

export interface MultiplayerCallbacks {
  onStatusChange: (
    mode: MultiplayerMode,
    roomId: string | null,
    faction: Faction,
    info?: string,
    mapPreset?: MapPreset
  ) => void;
  onPeerJoined: () => void;
  onPeerLeft: () => void;
  onRemoteCommand: (cmd: GameCommand) => void;
  onRemoteSnapshot: (snapshot: WorldSnapshot) => void;
  onRestartMatch: (mapPreset: MapPreset) => void;
  onChatMessage: (from: Faction, text: string) => void;
  onError: (message: string) => void;
}

/**
 * Browser WebSocket client managing a 2-player Host/Guest match over `/ws`.
 * Shareable link format: `<origin><pathname>?room=XXXXXX`
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;

  mode: MultiplayerMode = 'solo';
  roomId: string | null = null;
  faction: Faction = 'allies';
  latencyMs: number | null = null;

  constructor(private readonly cb: MultiplayerCallbacks) {}

  get isMultiplayerActive(): boolean {
    return this.mode === 'hosting_live' || this.mode === 'guest_live';
  }

  get isHost(): boolean {
    return this.mode === 'hosting_wait' || this.mode === 'hosting_live';
  }

  get isGuest(): boolean {
    return this.mode === 'guest_joining' || this.mode === 'guest_live';
  }

  getInviteUrl(): string | null {
    if (!this.roomId) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.roomId);
    return url.toString();
  }

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  private connect(onOpen: () => void): void {
    this.disconnectSocketOnly();

    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.startPingLoop();
      onOpen();
    });

    ws.addEventListener('message', (ev) => {
      let msg: ServerToClientMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerToClientMsg;
      } catch {
        return;
      }
      this.handleServerMessage(msg);
    });

    ws.addEventListener('close', () => {
      this.stopPingLoop();
      if (this.mode !== 'solo') {
        const wasLive = this.isMultiplayerActive;
        this.mode = 'solo';
        this.roomId = null;
        this.faction = 'allies';
        this.latencyMs = null;
        this.cb.onStatusChange(this.mode, null, 'allies', wasLive ? 'Disconnected from relay' : undefined);
      }
    });

    ws.addEventListener('error', () => {
      this.cb.onError('Unable to reach multiplayer relay (/ws). Make sure the dev/preview server is running.');
    });
  }

  private handleServerMessage(msg: ServerToClientMsg): void {
    if (msg.type === 'pong') {
      this.latencyMs = Math.max(1, Math.round(performance.now() - msg.t));
      return;
    }

    if (msg.type === 'room_created') {
      this.roomId = msg.roomId;
      this.faction = msg.faction;
      this.mode = 'hosting_wait';
      this.setUrlRoomParam(msg.roomId);
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        'Share invite link — waiting for 1 opponent',
        msg.mapPreset
      );
      return;
    }

    if (msg.type === 'room_joined') {
      this.roomId = msg.roomId;
      this.faction = msg.faction;
      this.mode = 'guest_live';
      this.setUrlRoomParam(msg.roomId);
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        'Connected as Soviet Command',
        msg.mapPreset
      );
      return;
    }

    if (msg.type === 'peer_joined') {
      this.mode = 'hosting_live';
      this.cb.onStatusChange(this.mode, this.roomId, this.faction, 'Opponent joined! 1v1 Live');
      this.cb.onPeerJoined();
      return;
    }

    if (msg.type === 'peer_left') {
      if (this.isHost) {
        this.mode = 'hosting_wait';
        this.cb.onStatusChange(this.mode, this.roomId, this.faction, 'Opponent disconnected — waiting for reconnect');
      } else {
        this.mode = 'solo';
        this.roomId = null;
        this.faction = 'allies';
        this.clearUrlRoomParam();
        this.cb.onStatusChange(this.mode, null, 'allies', 'Host left the room');
      }
      this.cb.onPeerLeft();
      return;
    }

    if (msg.type === 'cmd') {
      this.cb.onRemoteCommand(msg.cmd);
      return;
    }

    if (msg.type === 'snapshot') {
      this.cb.onRemoteSnapshot(msg.snapshot);
      return;
    }

    if (msg.type === 'restart_match') {
      this.cb.onRestartMatch(msg.mapPreset);
      return;
    }

    if (msg.type === 'chat') {
      this.cb.onChatMessage(msg.from, msg.text);
      return;
    }

    if (msg.type === 'error') {
      if (this.mode === 'guest_joining') {
        this.mode = 'solo';
        this.roomId = null;
        this.faction = 'allies';
        this.clearUrlRoomParam();
        this.cb.onStatusChange(this.mode, null, 'allies', msg.message);
      }
      this.cb.onError(msg.message);
    }
  }

  hostRoom(mapPreset: MapPreset = 'canyon'): void {
    this.connect(() => {
      this.send({ type: 'create_room', mapPreset });
    });
  }

  joinRoom(roomCode: string): void {
    const clean = roomCode.trim().toUpperCase();
    if (!clean) return;
    this.mode = 'guest_joining';
    this.roomId = clean;
    this.cb.onStatusChange(this.mode, clean, 'soviets', `Joining room ${clean}...`);
    this.connect(() => {
      this.send({ type: 'join_room', roomId: clean });
    });
  }

  leaveRoom(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave_room' });
    }
    this.disconnectSocketOnly();
    this.mode = 'solo';
    this.roomId = null;
    this.faction = 'allies';
    this.latencyMs = null;
    this.clearUrlRoomParam();
    this.cb.onStatusChange(this.mode, null, 'allies');
  }

  sendCommand(cmd: GameCommand): void {
    this.send({ type: 'cmd', cmd });
  }

  sendSnapshot(snapshot: WorldSnapshot): void {
    this.send({ type: 'snapshot', snapshot });
  }

  sendRestartMatch(mapPreset: MapPreset): void {
    this.send({ type: 'restart_match', mapPreset });
  }

  sendChat(text: string): void {
    const clean = text.trim().slice(0, 140);
    if (!clean) return;
    this.send({ type: 'chat', text: clean });
  }

  private send(msg: ClientToServerMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', t: performance.now() });
    }, 2500);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private disconnectSocketOnly(): void {
    this.stopPingLoop();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private setUrlRoomParam(code: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.history.replaceState({}, '', url.toString());
  }

  private clearUrlRoomParam(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  }
}
