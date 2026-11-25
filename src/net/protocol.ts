import type {
  BuildingEntity,
  BuildingType,
  CrateEntity,
  Faction,
  FalloutZone,
  MapPreset,
  MatchConfig,
  OilDerrickEntity,
  PlayerState,
  ProjectileEntity,
  SimEvent,
  SuperweaponType,
  UnitEntity,
  UnitType,
  Vec2,
} from '../sim/types';

export type GameCommand =
  | { type: 'move'; unitIds: number[]; target: Vec2; attackMove: boolean }
  | { type: 'attack'; unitIds: number[]; targetId: number }
  | { type: 'harvest'; unitIds: number[]; target?: Vec2 }
  | { type: 'stop'; unitIds: number[] }
  | { type: 'set_rally'; buildingId: number; target: Vec2 }
  | { type: 'start_building'; buildingType: BuildingType }
  | { type: 'cancel_building' }
  | { type: 'place_building'; gx: number; gz: number }
  | { type: 'sell_building'; buildingId: number }
  | { type: 'toggle_repair'; buildingId: number }
  | { type: 'queue_unit'; unitType: UnitType }
  | { type: 'cancel_unit'; unitType?: UnitType }
  | { type: 'fire_superweapon'; weapon: SuperweaponType; target: Vec2; source?: Vec2 };

export interface WorldSnapshot {
  mapPreset: MapPreset;
  mapSize: number;
  simTime: number;
  tickCount: number;
  winner: Faction | null;
  players: Record<Faction, PlayerState>;
  buildings: BuildingEntity[];
  units: UnitEntity[];
  projectiles: ProjectileEntity[];
  crates: CrateEntity[];
  derricks: OilDerrickEntity[];
  falloutZones: FalloutZone[];
  oreUpdates: Array<[number, number]>;
  events: SimEvent[];
}

export interface DeltaWorldSnapshot {
  baseSeq: number;
  simTime: number;
  tickCount: number;
  winner: Faction | null;
  players: Record<Faction, PlayerState>;
  buildingsUpsert: BuildingEntity[];
  buildingsRemoved: number[];
  unitsUpsert: UnitEntity[];
  unitsRemoved: number[];
  projectiles: ProjectileEntity[];
  crates?: CrateEntity[];
  derricks?: OilDerrickEntity[];
  falloutZones?: FalloutZone[];
  oreDelta: Array<[number, number]>;
  events: SimEvent[];
}

export interface SnapshotPacket {
  seq: number;
  full?: WorldSnapshot;
  delta?: DeltaWorldSnapshot;
}

export interface LobbyStatePayload {
  roomId: string;
  config: MatchConfig;
  hostReady: boolean;
  guestReady: boolean;
  peerConnected: boolean;
  inMatch: boolean;
}

export type ClientToServerMsg =
  | {
      type: 'create_room';
      mapPreset?: MapPreset;
      config?: Partial<MatchConfig>;
      sessionToken?: string;
    }
  | { type: 'join_room'; roomId: string; sessionToken?: string }
  | { type: 'leave_room' }
  | { type: 'update_lobby'; config: Partial<MatchConfig> }
  | { type: 'set_ready'; ready: boolean }
  | { type: 'start_match' }
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'snapshot_packet'; packet: SnapshotPacket }
  | { type: 'request_full_sync' }
  | { type: 'restart_match'; mapPreset?: MapPreset; config?: Partial<MatchConfig> }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type ServerToClientMsg =
  | {
      type: 'room_created';
      roomId: string;
      faction: Faction;
      mapPreset: MapPreset;
      config: MatchConfig;
      sessionToken: string;
      inMatch: boolean;
      hostReady: boolean;
      guestReady: boolean;
    }
  | {
      type: 'room_joined';
      roomId: string;
      role: 'host' | 'guest';
      faction: Faction;
      mapPreset: MapPreset;
      config: MatchConfig;
      sessionToken: string;
      reconnected: boolean;
      inMatch: boolean;
      hostReady: boolean;
      guestReady: boolean;
      peerConnected: boolean;
    }
  | { type: 'lobby_state'; lobby: LobbyStatePayload }
  | { type: 'match_started'; config: MatchConfig }
  | { type: 'peer_joined'; peerFaction: Faction }
  | { type: 'peer_disconnected'; graceSeconds: number }
  | { type: 'peer_reconnected'; peerFaction: Faction }
  | { type: 'peer_left' }
  | { type: 'error'; message: string }
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'snapshot_packet'; packet: SnapshotPacket }
  | { type: 'request_full_sync' }
  | { type: 'restart_match'; mapPreset: MapPreset; config: MatchConfig }
  | { type: 'chat'; from: Faction; text: string }
  | { type: 'pong'; t: number };
