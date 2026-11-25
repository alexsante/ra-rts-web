import type {
  BuildingEntity,
  BuildingType,
  CrateEntity,
  Faction,
  FalloutZone,
  MapPreset,
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
  | { type: 'fire_superweapon'; weapon: SuperweaponType; target: Vec2 };

export interface WorldSnapshot {
  mapPreset: MapPreset;
  simTime: number;
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

export type ClientToServerMsg =
  | { type: 'create_room'; mapPreset?: MapPreset }
  | { type: 'join_room'; roomId: string }
  | { type: 'leave_room' }
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'restart_match'; mapPreset?: MapPreset }
  | { type: 'chat'; text: string }
  | { type: 'ping'; t: number };

export type ServerToClientMsg =
  | { type: 'room_created'; roomId: string; faction: Faction; mapPreset: MapPreset }
  | { type: 'room_joined'; roomId: string; faction: Faction; mapPreset: MapPreset }
  | { type: 'peer_joined'; peerFaction: Faction }
  | { type: 'peer_left' }
  | { type: 'error'; message: string }
  | { type: 'cmd'; cmd: GameCommand }
  | { type: 'snapshot'; snapshot: WorldSnapshot }
  | { type: 'restart_match'; mapPreset: MapPreset }
  | { type: 'chat'; from: Faction; text: string }
  | { type: 'pong'; t: number };
