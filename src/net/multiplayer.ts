import { DEFAULT_MATCH_CONFIG, type Faction, type MapPreset, type MatchConfig } from '../sim/types';
import { SnapshotDeltaDecoder } from './delta';
import type {
  ClientToServerMsg,
  GameCommand,
  LobbyStatePayload,
  ServerToClientMsg,
  SnapshotPacket,
  WorldSnapshot,
} from './protocol';

export type MultiplayerMode =
  | 'solo'
  | 'hosting_lobby'
  | 'hosting_live'
  | 'guest_joining'
  | 'guest_lobby'
  | 'guest_live';

export interface MultiplayerCallbacks {
  onStatusChange: (
    mode: MultiplayerMode,
    roomId: string | null,
    faction: Faction,
    info?: string,
    config?: MatchConfig
  ) => void;
  onLobbyUpdate: (lobby: LobbyStatePayload) => void;
  onMatchStarted: (config: MatchConfig, faction: Faction, reconnected: boolean) => void;
  onPeerJoined: (peerFaction: Faction) => void;
  onPeerDisconnected: (graceSeconds: number) => void;
  onPeerReconnected: (peerFaction: Faction) => void;
  onPeerLeft: () => void;
  onRemoteCommand: (cmd: GameCommand) => void;
  onRemoteSnapshot: (snapshot: WorldSnapshot) => void;
  onFullSyncRequested: () => void;
  onRestartMatch: (config: MatchConfig) => void;
  onChatMessage: (from: Faction, text: string) => void;
  onError: (message: string) => void;
}

const TOKEN_STORAGE_KEY = 'ra_rts_session_token';

function getOrCreateSessionToken(): string {
  try {
    const existing = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (existing) return existing;
    const token = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    return token;
  } catch {
    return `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Browser WebSocket client managing a 2-player Host/Guest lobby & match over `/ws`.
 * Features Delta Snapshot decoding, automatic sessionToken reconnect on mid-game drops,
 * and shareable invite URLs (`?room=XXXXXX`).
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private readonly decoder = new SnapshotDeltaDecoder();
  private sessionToken = getOrCreateSessionToken();

  mode: MultiplayerMode = 'solo';
  roomId: string | null = null;
  faction: Faction = 'allies';
  config: MatchConfig = { ...DEFAULT_MATCH_CONFIG, balancedPvP: true };
  hostReady = false;
  guestReady = false;
  peerConnected = false;
  latencyMs: number | null = null;

  constructor(private readonly cb: MultiplayerCallbacks) {}

  get isMultiplayerActive(): boolean {
    return this.mode === 'hosting_live' || this.mode === 'guest_live';
  }

  get isInRoom(): boolean {
    return this.mode !== 'solo';
  }

  get isHost(): boolean {
    return this.mode === 'hosting_lobby' || this.mode === 'hosting_live';
  }

  get isGuest(): boolean {
    return (
      this.mode === 'guest_joining' ||
      this.mode === 'guest_lobby' ||
      this.mode === 'guest_live'
    );
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
    this.clearReconnectTimer();
    this.intentionalClose = false;
    this.disconnectSocketOnly();

    const ws = new WebSocket(this.getWsUrl());
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.reconnectAttempts = 0;
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
      if (this.intentionalClose || this.mode === 'solo') return;

      // Mid-game or lobby unexpected drop: attempt automatic reconnect with sessionToken!
      const savedRoom = this.roomId;
      if (savedRoom && this.reconnectAttempts < 6) {
        const delayMs = Math.min(8000, 1000 * Math.pow(1.6, this.reconnectAttempts));
        this.reconnectAttempts++;
        this.cb.onStatusChange(
          this.mode,
          savedRoom,
          this.faction,
          `Connection lost — reconnecting (${this.reconnectAttempts}/6)...`,
          this.config
        );
        this.reconnectTimer = window.setTimeout(() => {
          if (!this.roomId) return;
          this.connect(() => {
            this.send({
              type: 'join_room',
              roomId: savedRoom,
              sessionToken: this.sessionToken,
            });
          });
        }, delayMs);
        return;
      }

      const wasLive = this.isMultiplayerActive;
      this.mode = 'solo';
      this.roomId = null;
      this.faction = 'allies';
      this.peerConnected = false;
      this.latencyMs = null;
      this.cb.onStatusChange(
        this.mode,
        null,
        'allies',
        wasLive ? 'Disconnected from relay' : undefined
      );
    });

    ws.addEventListener('error', () => {
      if (this.reconnectAttempts === 0) {
        this.cb.onError(
          'Unable to reach multiplayer relay (/ws). Make sure the dev/preview server is running.'
        );
      }
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
      this.config = msg.config;
      this.sessionToken = msg.sessionToken;
      this.hostReady = msg.hostReady;
      this.guestReady = msg.guestReady;
      this.peerConnected = false;
      this.mode = 'hosting_lobby';
      this.decoder.reset();
      this.setUrlRoomParam(msg.roomId);
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        'Lobby open — share invite link with 1 opponent',
        this.config
      );
      this.cb.onLobbyUpdate({
        roomId: msg.roomId,
        config: msg.config,
        hostReady: msg.hostReady,
        guestReady: msg.guestReady,
        peerConnected: false,
        inMatch: false,
      });
      return;
    }

    if (msg.type === 'room_joined') {
      this.roomId = msg.roomId;
      this.faction = msg.faction;
      this.config = msg.config;
      this.sessionToken = msg.sessionToken;
      this.hostReady = msg.hostReady;
      this.guestReady = msg.guestReady;
      this.peerConnected = msg.peerConnected;
      this.decoder.reset();
      this.setUrlRoomParam(msg.roomId);

      if (msg.role === 'host') {
        this.mode = msg.inMatch ? 'hosting_live' : 'hosting_lobby';
      } else {
        this.mode = msg.inMatch ? 'guest_live' : 'guest_lobby';
      }

      const label = msg.reconnected
        ? `Reconnected to room ${msg.roomId}!`
        : msg.inMatch
        ? `Connected as ${msg.faction === 'allies' ? 'Allied' : 'Soviet'} Command`
        : `Joined Lobby ${msg.roomId} — waiting for Host to deploy`;

      this.cb.onStatusChange(this.mode, this.roomId, this.faction, label, this.config);
      this.cb.onLobbyUpdate({
        roomId: msg.roomId,
        config: msg.config,
        hostReady: msg.hostReady,
        guestReady: msg.guestReady,
        peerConnected: msg.peerConnected,
        inMatch: msg.inMatch,
      });

      if (msg.inMatch) {
        this.cb.onMatchStarted(msg.config, msg.faction, msg.reconnected);
        if (msg.role === 'guest') {
          this.send({ type: 'request_full_sync' });
        }
      }
      return;
    }

    if (msg.type === 'lobby_state') {
      this.config = msg.lobby.config;
      this.hostReady = msg.lobby.hostReady;
      this.guestReady = msg.lobby.guestReady;
      this.peerConnected = msg.lobby.peerConnected;
      this.faction = this.isHost
        ? msg.lobby.config.hostFaction
        : msg.lobby.config.hostFaction === 'allies'
        ? 'soviets'
        : 'allies';
      this.cb.onLobbyUpdate(msg.lobby);
      return;
    }

    if (msg.type === 'match_started') {
      this.config = msg.config;
      this.faction = this.isHost
        ? msg.config.hostFaction
        : msg.config.hostFaction === 'allies'
        ? 'soviets'
        : 'allies';
      this.mode = this.isHost ? 'hosting_live' : 'guest_live';
      this.decoder.reset();
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        `1v1 Match Live (${this.faction === 'allies' ? 'Allies' : 'Soviets'})`,
        this.config
      );
      this.cb.onMatchStarted(msg.config, this.faction, false);
      return;
    }

    if (msg.type === 'peer_joined') {
      this.peerConnected = true;
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        'Opponent joined lobby — ready to deploy!',
        this.config
      );
      this.cb.onPeerJoined(msg.peerFaction);
      return;
    }

    if (msg.type === 'peer_disconnected') {
      this.peerConnected = false;
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        `Opponent lost connection (${msg.graceSeconds}s reconnect window)`,
        this.config
      );
      this.cb.onPeerDisconnected(msg.graceSeconds);
      return;
    }

    if (msg.type === 'peer_reconnected') {
      this.peerConnected = true;
      this.cb.onStatusChange(
        this.mode,
        this.roomId,
        this.faction,
        'Opponent reconnected — resyncing battlefield!',
        this.config
      );
      this.cb.onPeerReconnected(msg.peerFaction);
      return;
    }

    if (msg.type === 'peer_left') {
      this.peerConnected = false;
      if (this.isHost) {
        this.guestReady = false;
        this.mode = 'hosting_lobby';
        this.cb.onStatusChange(
          this.mode,
          this.roomId,
          this.faction,
          'Opponent left room — waiting for new player',
          this.config
        );
      } else {
        this.mode = 'solo';
        this.roomId = null;
        this.faction = 'allies';
        this.clearUrlRoomParam();
        this.cb.onStatusChange(this.mode, null, 'allies', 'Host closed the room');
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

    if (msg.type === 'snapshot_packet') {
      const res = this.decoder.decode(msg.packet);
      if (res.needsResync) {
        this.send({ type: 'request_full_sync' });
      } else if (res.snapshot) {
        this.cb.onRemoteSnapshot(res.snapshot);
      }
      return;
    }

    if (msg.type === 'request_full_sync') {
      this.cb.onFullSyncRequested();
      return;
    }

    if (msg.type === 'restart_match') {
      this.config = msg.config;
      this.decoder.reset();
      this.cb.onRestartMatch(msg.config);
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

  hostRoom(config: Partial<MatchConfig> = {}): void {
    this.connect(() => {
      this.send({
        type: 'create_room',
        mapPreset: config.mapPreset,
        config,
        sessionToken: this.sessionToken,
      });
    });
  }

  joinRoom(roomCode: string): void {
    const clean = roomCode.trim().toUpperCase();
    if (!clean) return;
    this.mode = 'guest_joining';
    this.roomId = clean;
    this.cb.onStatusChange(this.mode, clean, 'soviets', `Joining room ${clean}...`);
    this.connect(() => {
      this.send({
        type: 'join_room',
        roomId: clean,
        sessionToken: this.sessionToken,
      });
    });
  }

  updateLobbyConfig(config: Partial<MatchConfig>): void {
    if (!this.isHost) return;
    this.send({ type: 'update_lobby', config });
  }

  setReady(ready: boolean): void {
    if (!this.isInRoom) return;
    this.send({ type: 'set_ready', ready });
  }

  startMatch(): void {
    if (!this.isHost) return;
    this.send({ type: 'start_match' });
  }

  leaveRoom(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave_room' });
    }
    this.disconnectSocketOnly();
    this.decoder.reset();
    this.mode = 'solo';
    this.roomId = null;
    this.faction = 'allies';
    this.peerConnected = false;
    this.hostReady = false;
    this.guestReady = false;
    this.latencyMs = null;
    this.clearUrlRoomParam();
    this.cb.onStatusChange(this.mode, null, 'allies');
  }

  sendCommand(cmd: GameCommand): void {
    this.send({ type: 'cmd', cmd });
  }

  sendSnapshotPacket(packet: SnapshotPacket): void {
    this.send({ type: 'snapshot_packet', packet });
  }

  sendRestartMatch(config: MatchConfig): void {
    this.send({ type: 'restart_match', mapPreset: config.mapPreset as MapPreset, config });
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

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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
