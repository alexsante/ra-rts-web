export type Faction = 'allies' | 'soviets';
export type MapPreset = 'canyon' | 'arctic' | 'volcanic';
export type AIDifficulty = 'easy' | 'normal' | 'brutal';

export interface MatchConfig {
  mapPreset: MapPreset;
  hostFaction: Faction;
  startingCredits: number;
  difficulty: AIDifficulty;
  fogOfWar: boolean;
  cratesEnabled: boolean;
  superweaponsEnabled: boolean;
  balancedPvP: boolean;
  seed: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mapPreset: 'canyon',
  hostFaction: 'allies',
  startingCredits: 5000,
  difficulty: 'normal',
  fogOfWar: true,
  cratesEnabled: true,
  superweaponsEnabled: true,
  balancedPvP: false,
  seed: 1337,
};

export type BuildingType =
  | 'conyard'
  | 'power'
  | 'refinery'
  | 'barracks'
  | 'warfactory'
  | 'turret'
  | 'prism'
  | 'tesla'
  | 'techcenter'
  | 'chronosphere'
  | 'silo';

export type UnitType =
  | 'rifle'
  | 'rocket'
  | 'tesla_trooper'
  | 'harvester'
  | 'medium_tank'
  | 'prism_tank'
  | 'chrono_tank'
  | 'v2_launcher'
  | 'mammoth_tank'
  | 'kirov';

export type SuperweaponType = 'airstrike' | 'chronoshift' | 'iron_curtain' | 'nuke';
export type BuildableType = BuildingType | UnitType;
export type DamageType = 'bullet' | 'shell' | 'rocket' | 'tesla' | 'prism' | 'nuke';
export type ArmorType = 'infantry' | 'light' | 'heavy' | 'building';
export type CrateKind = 'cash' | 'veterancy' | 'heal' | 'reinforcement';

export interface Vec2 {
  x: number;
  z: number;
}

export interface BuildingSpec {
  id: BuildingType;
  name: string;
  shortName: string;
  cost: number;
  buildTime: number;
  maxHp: number;
  powerDelta: number;
  footprint: [number, number];
  sight: number;
  requires: BuildingType[];
  factions?: Faction[]; // undefined = both factions
  isSuperweaponStructure?: boolean;
  description: string;
  hotkey: string;
  maxCount?: number;
  weapon?: {
    damage: number;
    damageType: DamageType;
    range: number;
    cooldown: number;
    projectileSpeed: number;
    splashRadius?: number;
    requiresPower?: boolean;
    canTargetAir?: boolean;
    chainBounceRange?: number;
  };
}

export interface UnitSpec {
  id: UnitType;
  name: string;
  shortName: string;
  cost: number;
  buildTime: number;
  maxHp: number;
  speed: number;
  turnRate: number;
  turretTurnRate: number;
  radius: number;
  sight: number;
  armor: ArmorType;
  factions?: Faction[]; // undefined = both factions
  isAir?: boolean;
  canPhaseBlink?: boolean;
  producedAt: 'barracks' | 'warfactory';
  requires: BuildingType[];
  description: string;
  hotkey: string;
  squadCount?: number;
  harvesterCapacity?: number;
  harvestRate?: number;
  weapon?: {
    damage: number;
    damageType: DamageType;
    range: number;
    minRange?: number;
    cooldown: number;
    projectileSpeed: number;
    splashRadius?: number;
    dualBarrel?: boolean;
    arcHeight?: number;
    canTargetAir?: boolean;
    chainBounceRange?: number;
  };
}

export interface BuildingEntity {
  id: number;
  kind: 'building';
  type: BuildingType;
  faction: Faction;
  gx: number;
  gz: number;
  x: number;
  z: number;
  y: number;
  hp: number;
  maxHp: number;
  turretAngle: number;
  attackCooldown: number;
  targetId: number | null;
  rallyPoint: Vec2 | null;
  buildAnim: number;
  flashTimer: number;
  powered: boolean;
  repairing: boolean;
}

export type UnitOrder =
  | { type: 'idle' }
  | { type: 'move'; target: Vec2 }
  | { type: 'attack_move'; target: Vec2 }
  | { type: 'attack'; targetId: number }
  | { type: 'harvest' };

export type HarvesterState =
  | 'idle'
  | 'moving_to_ore'
  | 'harvesting'
  | 'returning'
  | 'unloading';

export interface UnitEntity {
  id: number;
  kind: 'unit';
  type: UnitType;
  faction: Faction;
  x: number;
  z: number;
  y: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  angle: number;
  turretAngle: number;
  hp: number;
  maxHp: number;
  kills: number;
  rank: 0 | 1 | 2;
  invulnerableTimer: number;
  blinkCooldown: number;
  order: UnitOrder;
  path: Vec2[];
  pathIndex: number;
  repathTimer: number;
  attackCooldown: number;
  recoil: number;
  targetId: number | null;
  flashTimer: number;
  animPhase: number;
  cargo: number;
  harvesterState: HarvesterState;
  harvestTarget: { gx: number; gz: number } | null;
  refineryId: number | null;
}

export type Entity = BuildingEntity | UnitEntity;

export interface ProjectileEntity {
  id: number;
  faction: Faction;
  attackerId: number | null;
  damage: number;
  damageType: DamageType;
  splashRadius: number;
  x: number;
  y: number;
  z: number;
  startX: number;
  startY: number;
  startZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetId: number | null;
  speed: number;
  progress: number;
  arcHeight: number;
  eliteShot?: boolean;
}

export interface CrateEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  kind: CrateKind;
}

export interface OilDerrickEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  owner: Faction | null;
  captureProgress: number;
  capturingFaction: Faction | null;
  incomeTimer: number;
}

export interface PendingStrike {
  id: number;
  type: 'airstrike' | 'nuke';
  faction: Faction;
  targetX: number;
  targetZ: number;
  elapsed: number;
  duration: number;
  bombsDropped: number;
  angle: number;
}

export interface FalloutZone {
  id: number;
  faction: Faction;
  x: number;
  z: number;
  radius: number;
  remaining: number;
}

export interface SuperweaponState {
  unlocked: boolean;
  cooldown: number;
  maxCooldown: number;
}

export interface ProductionSlot {
  type: BuildingType | UnitType;
  progress: number;
  paidSoFar: number;
  totalCost: number;
  ready: boolean;
  queue: UnitType[];
}

export interface PlayerState {
  faction: Faction;
  credits: number;
  powerProduced: number;
  powerConsumed: number;
  powerRatio: number;
  buildingProd: ProductionSlot | null;
  unitProd: ProductionSlot | null;
  superweapons: Record<SuperweaponType, SuperweaponState>;
  stats: {
    unitsBuilt: number;
    unitsLost: number;
    enemiesDestroyed: number;
    creditsHarvested: number;
  };
}

export interface MapProp {
  kind: 'rock_large' | 'rock_small' | 'barrels' | 'outpost_crate' | 'pine_tree';
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface MapThemeColors {
  name: string;
  subtitle: string;
  fogHex: number;
  skyTopHex: number;
  skyHorizonHex: number;
  sunHex: number;
  sunIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  skirtHex: number;
  dustHex: number;
  rockHex: number;
}

export interface MapData {
  preset: MapPreset;
  theme: MapThemeColors;
  size: number;
  tileSize: number;
  worldSize: number;
  heights: Float32Array;
  walkable: Uint8Array;
  buildable: Uint8Array;
  roadMask: Float32Array;
  ore: Float32Array;
  isGem: Uint8Array;
  props: MapProp[];
  derrickSpots: Vec2[];
  alliesStart: { gx: number; gz: number };
  sovietsStart: { gx: number; gz: number };
}

export type SimEvent =
  | {
      type: 'shot';
      damageType: DamageType;
      faction: Faction;
      fromX: number;
      fromY: number;
      fromZ: number;
      toX: number;
      toY: number;
      toZ: number;
      eliteShot?: boolean;
      bounceTo?: { x: number; y: number; z: number };
    }
  | {
      type: 'explosion';
      x: number;
      y: number;
      z: number;
      scale: number;
      damageType: DamageType;
      leaveCrater?: boolean;
      shake?: number;
    }
  | {
      type: 'building_placed';
      building: BuildingEntity;
    }
  | {
      type: 'building_sold';
      x: number;
      y: number;
      z: number;
      faction: Faction;
      refund: number;
    }
  | {
      type: 'building_destroyed';
      x: number;
      y: number;
      z: number;
      faction: Faction;
      footprint: [number, number];
    }
  | {
      type: 'unit_created';
      unit: UnitEntity;
    }
  | {
      type: 'unit_destroyed';
      x: number;
      y: number;
      z: number;
      faction: Faction;
      unitType: UnitType;
    }
  | {
      type: 'harvest_spark';
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'credits_deposited';
      faction: Faction;
      amount: number;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'veterancy_up';
      faction: Faction;
      rank: 1 | 2;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'crate_pickup';
      faction: Faction;
      kind: CrateKind;
      label: string;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'derrick_captured';
      faction: Faction;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'airstrike_start';
      faction: Faction;
      targetX: number;
      targetZ: number;
      angle: number;
    }
  | {
      type: 'nuke_launched';
      faction: Faction;
      targetX: number;
      targetZ: number;
    }
  | {
      type: 'nuke_impact';
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'iron_curtain_cast';
      faction: Faction;
      x: number;
      y: number;
      z: number;
      affectedCount: number;
    }
  | {
      type: 'chrono_warp';
      faction: Faction;
      fromX: number;
      fromY: number;
      fromZ: number;
      toX: number;
      toY: number;
      toZ: number;
      count: number;
    }
  | {
      type: 'radar_alert';
      faction: Faction;
      x: number;
      z: number;
    }
  | {
      type: 'floating_text';
      faction: Faction | 'all';
      text: string;
      color: string;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: 'eva';
      faction: Faction;
      code:
        | 'construction_complete'
        | 'unit_ready'
        | 'low_power'
        | 'power_restored'
        | 'base_under_attack'
        | 'insufficient_funds'
        | 'building'
        | 'cannot_deploy'
        | 'superweapon_ready'
        | 'nuke_detected'
        | 'airstrike_inbound'
        | 'derrick_captured'
        | 'unit_promoted'
        | 'kirov_reporting'
        | 'iron_curtain'
        | 'chronoshift';
      text: string;
    }
  | {
      type: 'game_over';
      winner: Faction;
    };
