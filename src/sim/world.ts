import type { GameCommand, WorldSnapshot } from '../net/protocol';
import {
  AIRSTRIKE_COOLDOWN,
  BUILD_RADIUS_TILES,
  BUILDING_SPECS,
  DAMAGE_MULTIPLIERS,
  IRON_CURTAIN_COOLDOWN,
  MAP_SIZE,
  NUKE_COOLDOWN,
  TILE_SIZE,
  UNIT_SPECS,
  WORLD_SIZE,
  tileToWorld,
  worldToTile,
} from './config';
import { generateMap, sampleTerrainHeight } from './mapGen';
import { findPath } from './pathfinding';
import {
  BuildingEntity,
  BuildingType,
  CrateEntity,
  CrateKind,
  DamageType,
  Entity,
  Faction,
  FalloutZone,
  MapData,
  MapPreset,
  OilDerrickEntity,
  PendingStrike,
  PlayerState,
  ProjectileEntity,
  SimEvent,
  SuperweaponType,
  UnitEntity,
  UnitType,
  Vec2,
} from './types';

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function stepAngle(current: number, target: number, maxDelta: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxDelta) return target;
  return wrapAngle(current + Math.sign(diff) * maxDelta);
}

export class GameWorld {
  readonly map: MapData;
  readonly players: Record<Faction, PlayerState>;
  readonly buildings = new Map<number, BuildingEntity>();
  readonly units = new Map<number, UnitEntity>();
  readonly projectiles = new Map<number, ProjectileEntity>();
  readonly crates = new Map<number, CrateEntity>();
  readonly derricks = new Map<number, OilDerrickEntity>();
  readonly falloutZones = new Map<number, FalloutZone>();
  private readonly pendingStrikes = new Map<number, PendingStrike>();

  readonly blocked = new Uint8Array(MAP_SIZE * MAP_SIZE);
  readonly fog = new Uint8Array(MAP_SIZE * MAP_SIZE);
  fogEnabled = true;
  localFaction: Faction = 'allies';

  simTime = 0;
  winner: Faction | null = null;
  events: SimEvent[] = [];

  private nextId = 1;
  private fogTickCounter = 0;
  private oreRegrowTimer = 0;
  private crateSpawnTimer = 28;
  private lastAttackAlertTime: Record<Faction, number> = { allies: -99, soviets: -99 };
  private lastLowPowerState: Record<Faction, boolean> = { allies: false, soviets: false };
  private initialOreIndices: number[] = [];

  constructor(balancedPvP = false, mapPreset: MapPreset = 'canyon') {
    this.map = generateMap(mapPreset);
    this.players = {
      allies: this.createPlayer('allies', 5000),
      soviets: this.createPlayer('soviets', balancedPvP ? 5000 : 4500),
    };

    for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
      this.blocked[i] = this.map.walkable[i] ? 0 : 1;
      if (this.map.ore[i] > 0) this.initialOreIndices.push(i);
    }

    this.setupMapObjectives();
    this.setupInitialBases(balancedPvP);
    this.recomputePower('allies', true);
    this.recomputePower('soviets', true);
    this.syncSuperweaponUnlocks('allies', true);
    this.syncSuperweaponUnlocks('soviets', true);
    this.updateFogOfWar();
  }

  private createPlayer(faction: Faction, credits: number): PlayerState {
    return {
      faction,
      credits,
      powerProduced: 0,
      powerConsumed: 0,
      powerRatio: 1,
      buildingProd: null,
      unitProd: null,
      superweapons: {
        airstrike: { unlocked: false, cooldown: AIRSTRIKE_COOLDOWN * 0.45, maxCooldown: AIRSTRIKE_COOLDOWN },
        iron_curtain: { unlocked: false, cooldown: IRON_CURTAIN_COOLDOWN * 0.4, maxCooldown: IRON_CURTAIN_COOLDOWN },
        nuke: { unlocked: false, cooldown: NUKE_COOLDOWN * 0.75, maxCooldown: NUKE_COOLDOWN },
      },
      stats: {
        unitsBuilt: 0,
        unitsLost: 0,
        enemiesDestroyed: 0,
        creditsHarvested: 0,
      },
    };
  }

  private setupMapObjectives(): void {
    // Spawn neutral Tech Oil Derricks on map flanks
    for (const spot of this.map.derrickSpots) {
      const y = sampleTerrainHeight(this.map, spot.x, spot.z);
      const id = this.nextId++;
      this.derricks.set(id, {
        id,
        x: spot.x,
        y,
        z: spot.z,
        owner: null,
        captureProgress: 0,
        capturingFaction: null,
        incomeTimer: 0,
      });
    }

    // Drop 1 tempting starter Bonus Crate near the central crossroads!
    this.spawnCrateAt(WORLD_SIZE * 0.5 + 4, WORLD_SIZE * 0.5 - 4, 'cash');
  }

  private setupInitialBases(balancedPvP: boolean): void {
    // --- ALLIED BASE (Southwest Plateau) ---
    const ax = this.map.alliesStart.gx;
    const az = this.map.alliesStart.gz;

    this.spawnBuilding('conyard', 'allies', ax, az, true);
    this.spawnBuilding('power', 'allies', ax - 4, az + 1, true);
    this.spawnBuilding('refinery', 'allies', ax + 5, az + 1, true);
    this.spawnBuilding('barracks', 'allies', ax - 1, az - 4, true);
    this.spawnBuilding('warfactory', 'allies', ax + 4, az - 5, true);
    this.spawnBuilding('turret', 'allies', ax + 8, az - 5, true);

    const allyRally = tileToWorld(ax + 10, az - 9);
    this.spawnUnit('medium_tank', 'allies', allyRally.x - 3, allyRally.z + 2);
    this.spawnUnit('medium_tank', 'allies', allyRally.x, allyRally.z + 4);
    this.spawnUnit('rifle', 'allies', allyRally.x + 3, allyRally.z + 2);
    this.spawnUnit('rifle', 'allies', allyRally.x + 2, allyRally.z - 1);
    this.spawnUnit('rocket', 'allies', allyRally.x - 1, allyRally.z - 2);

    // --- SOVIET BASE (Northeast Plateau) ---
    const sx = this.map.sovietsStart.gx;
    const sz = this.map.sovietsStart.gz;

    this.spawnBuilding('conyard', 'soviets', sx, sz, true);
    this.spawnBuilding('power', 'soviets', sx + 4, sz - 1, true);
    this.spawnBuilding('refinery', 'soviets', sx - 5, sz - 1, true);
    this.spawnBuilding('barracks', 'soviets', sx + 1, sz + 4, true);
    this.spawnBuilding('warfactory', 'soviets', sx - 5, sz + 4, true);
    this.spawnBuilding('turret', 'soviets', sx - 8, sz + 5, true);

    const sovRally = tileToWorld(sx - 9, sz + 8);
    this.spawnUnit('medium_tank', 'soviets', sovRally.x, sovRally.z);
    this.spawnUnit('medium_tank', 'soviets', sovRally.x + 3, sovRally.z + 2);
    this.spawnUnit('rifle', 'soviets', sovRally.x - 2, sovRally.z + 2);
    this.spawnUnit('rocket', 'soviets', sovRally.x + 2, sovRally.z - 2);

    if (balancedPvP) {
      this.spawnUnit('rifle', 'soviets', sovRally.x - 3, sovRally.z - 1);
    } else {
      this.spawnBuilding('power', 'soviets', sx + 4, sz + 2, true);
      this.spawnBuilding('tesla', 'soviets', sx - 4, sz + 9, true);
      const mid = tileToWorld(38, 35);
      this.spawnUnit('rifle', 'soviets', mid.x, mid.z);
      this.spawnUnit('medium_tank', 'soviets', mid.x + 3, mid.z - 3);
    }
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  hasPrerequisites(faction: Faction, requires: BuildingType[]): boolean {
    if (requires.length === 0) return true;
    const owned = new Set<BuildingType>();
    for (const b of this.buildings.values()) {
      if (b.faction === faction) owned.add(b.type);
    }
    return requires.every((r) => owned.has(r));
  }

  countFactionBuilding(faction: Faction, type: BuildingType): number {
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.type === type) n++;
    }
    return n;
  }

  canPlaceBuilding(faction: Faction, type: BuildingType, gx: number, gz: number): boolean {
    const spec = BUILDING_SPECS[type];
    const [fw, fh] = spec.footprint;
    if (gx < 1 || gz < 1 || gx + fw >= MAP_SIZE - 1 || gz + fh >= MAP_SIZE - 1) return false;

    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        const idx = (gz + dz) * MAP_SIZE + (gx + dx);
        if (!this.map.buildable[idx] || this.blocked[idx]) return false;
      }
    }

    const cx = (gx + fw * 0.5) * TILE_SIZE;
    const cz = (gz + fh * 0.5) * TILE_SIZE;
    const halfW = fw * TILE_SIZE * 0.5 + 0.6;
    const halfH = fh * TILE_SIZE * 0.5 + 0.6;
    for (const u of this.units.values()) {
      if (Math.abs(u.x - cx) < halfW && Math.abs(u.z - cz) < halfH) return false;
    }

    const maxDistWorld = BUILD_RADIUS_TILES * TILE_SIZE;
    let nearFriendly = false;
    for (const b of this.buildings.values()) {
      if (b.faction !== faction) continue;
      if (Math.hypot(b.x - cx, b.z - cz) <= maxDistWorld) {
        nearFriendly = true;
        break;
      }
    }
    return nearFriendly;
  }

  spawnBuilding(
    type: BuildingType,
    faction: Faction,
    gx: number,
    gz: number,
    instant = false
  ): BuildingEntity {
    const spec = BUILDING_SPECS[type];
    const [fw, fh] = spec.footprint;
    const x = (gx + fw * 0.5) * TILE_SIZE;
    const z = (gz + fh * 0.5) * TILE_SIZE;
    const y = sampleTerrainHeight(this.map, x, z);

    const b: BuildingEntity = {
      id: this.nextId++,
      kind: 'building',
      type,
      faction,
      gx,
      gz,
      x,
      z,
      y,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      turretAngle: faction === 'allies' ? -Math.PI * 0.25 : Math.PI * 0.75,
      attackCooldown: 0,
      targetId: null,
      rallyPoint:
        type === 'barracks' || type === 'warfactory'
          ? {
              x: x + (faction === 'allies' ? 5.5 : -5.5),
              z: z + (faction === 'allies' ? -5.5 : 5.5),
            }
          : null,
      buildAnim: instant ? 1 : 0,
      flashTimer: 0,
      powered: true,
      repairing: false,
    };

    this.buildings.set(b.id, b);
    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        this.blocked[(gz + dz) * MAP_SIZE + (gx + dx)] = 1;
      }
    }

    this.recomputePower(faction, instant);
    this.syncSuperweaponUnlocks(faction, instant);

    if (!instant) {
      this.events.push({ type: 'building_placed', building: b });
    }

    if (type === 'refinery') {
      const exitPos = this.findSpawnPointNearBuilding(b);
      const h = this.spawnUnit('harvester', faction, exitPos.x, exitPos.z);
      h.refineryId = b.id;
      h.order = { type: 'harvest' };
      h.harvesterState = 'idle';
    }

    return b;
  }

  private findSpawnPointNearBuilding(b: BuildingEntity): Vec2 {
    const [fw, fh] = BUILDING_SPECS[b.type].footprint;
    const dir = b.faction === 'allies' ? 1 : -1;
    const candidates: Array<{ gx: number; gz: number; score: number }> = [];
    for (let dz = -1; dz <= fh; dz++) {
      for (let dx = -1; dx <= fw; dx++) {
        if (dx >= 0 && dx < fw && dz >= 0 && dz < fh) continue;
        const gx = b.gx + dx;
        const gz = b.gz + dz;
        if (gx < 1 || gz < 1 || gx >= MAP_SIZE - 1 || gz >= MAP_SIZE - 1) continue;
        if (!this.blocked[gz * MAP_SIZE + gx]) {
          const score = dx * dir - dz * dir;
          candidates.push({ gx, gz, score });
        }
      }
    }
    candidates.sort((a, b2) => b2.score - a.score);
    if (candidates.length > 0) {
      return tileToWorld(candidates[0].gx, candidates[0].gz);
    }
    return { x: b.x + dir * 4, z: b.z - dir * 4 };
  }

  spawnUnit(type: UnitType, faction: Faction, x: number, z: number): UnitEntity {
    const spec = UNIT_SPECS[type];
    const clampedX = Math.max(TILE_SIZE, Math.min(WORLD_SIZE - TILE_SIZE, x));
    const clampedZ = Math.max(TILE_SIZE, Math.min(WORLD_SIZE - TILE_SIZE, z));
    const y = sampleTerrainHeight(this.map, clampedX, clampedZ);
    const angle = faction === 'allies' ? -Math.PI * 0.25 : Math.PI * 0.75;

    const u: UnitEntity = {
      id: this.nextId++,
      kind: 'unit',
      type,
      faction,
      x: clampedX,
      z: clampedZ,
      y,
      prevX: clampedX,
      prevZ: clampedZ,
      vx: 0,
      vz: 0,
      angle,
      turretAngle: angle,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      kills: 0,
      rank: 0,
      invulnerableTimer: 0,
      order: type === 'harvester' ? { type: 'harvest' } : { type: 'idle' },
      path: [],
      pathIndex: 0,
      repathTimer: 0,
      attackCooldown: 0,
      recoil: 0,
      targetId: null,
      flashTimer: 0,
      animPhase: Math.random() * Math.PI * 2,
      cargo: 0,
      harvesterState: 'idle',
      harvestTarget: null,
      refineryId: null,
    };

    this.units.set(u.id, u);
    this.players[faction].stats.unitsBuilt++;
    this.events.push({ type: 'unit_created', unit: u });
    return u;
  }

  // --- PRODUCTION, SELL, REPAIR & SUPERWEAPONS ---

  startBuildingProduction(faction: Faction, type: BuildingType): boolean {
    const player = this.players[faction];
    const spec = BUILDING_SPECS[type];
    if (!this.hasPrerequisites(faction, spec.requires)) return false;
    if (spec.maxCount && this.countFactionBuilding(faction, type) >= spec.maxCount) return false;
    if (player.buildingProd) return false;
    if (player.credits < 10) {
      this.emitEva(faction, 'insufficient_funds', 'Insufficient funds');
      return false;
    }

    player.buildingProd = {
      type,
      progress: 0,
      paidSoFar: 0,
      totalCost: spec.cost,
      ready: false,
      queue: [],
    };
    this.emitEva(faction, 'building', `Building ${spec.name}`);
    return true;
  }

  cancelBuildingProduction(faction: Faction): void {
    const player = this.players[faction];
    if (!player.buildingProd) return;
    player.credits += Math.round(player.buildingProd.paidSoFar);
    player.buildingProd = null;
  }

  placeReadyBuilding(faction: Faction, gx: number, gz: number): BuildingEntity | null {
    const player = this.players[faction];
    const prod = player.buildingProd;
    if (!prod || !prod.ready) return null;
    const type = prod.type as BuildingType;
    if (!this.canPlaceBuilding(faction, type, gx, gz)) {
      this.emitEva(faction, 'cannot_deploy', 'Cannot deploy here');
      return null;
    }
    player.buildingProd = null;
    return this.spawnBuilding(type, faction, gx, gz, false);
  }

  sellBuilding(faction: Faction, buildingId: number): boolean {
    const b = this.buildings.get(buildingId);
    if (!b || b.faction !== faction) return false;

    const spec = BUILDING_SPECS[b.type];
    const hpRatio = Math.max(0.25, b.hp / b.maxHp);
    const refund = Math.round(spec.cost * (0.3 + 0.25 * hpRatio));
    this.players[faction].credits += refund;

    this.buildings.delete(b.id);
    const [fw, fh] = spec.footprint;
    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        const idx = (b.gz + dz) * MAP_SIZE + (b.gx + dx);
        this.blocked[idx] = this.map.walkable[idx] ? 0 : 1;
      }
    }

    this.recomputePower(faction);
    this.syncSuperweaponUnlocks(faction);

    // Classic Red Alert: selling a structure pops out a surviving Rifle Squad!
    this.spawnUnit('rifle', faction, b.x, b.z);
    this.events.push({
      type: 'building_sold',
      x: b.x,
      y: b.y + 1.4,
      z: b.z,
      faction,
      refund,
    });
    this.events.push({
      type: 'floating_text',
      faction,
      text: `SOLD +$${refund}`,
      color: '#f5b82e',
      x: b.x,
      y: b.y + 2.8,
      z: b.z,
    });
    return true;
  }

  toggleRepairBuilding(faction: Faction, buildingId: number): boolean {
    const b = this.buildings.get(buildingId);
    if (!b || b.faction !== faction) return false;
    if (b.hp >= b.maxHp - 1) {
      b.repairing = false;
      return false;
    }
    b.repairing = !b.repairing;
    return b.repairing;
  }

  fireSuperweapon(faction: Faction, weapon: SuperweaponType, target: Vec2): boolean {
    const p = this.players[faction];
    const sw = p.superweapons[weapon];
    if (!sw.unlocked || sw.cooldown > 0.05) return false;
    if (weapon === 'nuke' && p.powerRatio < 1) {
      this.emitEva(faction, 'low_power', 'Nuclear Silo offline — Low Power!');
      return false;
    }

    sw.cooldown = sw.maxCooldown;
    const tx = Math.max(TILE_SIZE * 2, Math.min(WORLD_SIZE - TILE_SIZE * 2, target.x));
    const tz = Math.max(TILE_SIZE * 2, Math.min(WORLD_SIZE - TILE_SIZE * 2, target.z));

    if (weapon === 'iron_curtain') {
      let affected = 0;
      const by = sampleTerrainHeight(this.map, tx, tz);
      for (const u of this.units.values()) {
        if (u.faction !== faction) continue;
        if (Math.hypot(u.x - tx, u.z - tz) <= 8.0 && affected < 6) {
          u.invulnerableTimer = 10.0;
          affected++;
        }
      }
      if (affected === 0) {
        // Refund cooldown if user clicked empty ground!
        sw.cooldown = 0;
        this.emitEva(faction, 'cannot_deploy', 'Iron Curtain needs friendly units in target zone');
        return false;
      }
      this.events.push({
        type: 'iron_curtain_cast',
        faction,
        x: tx,
        y: by,
        z: tz,
        affectedCount: affected,
      });
      this.events.push({
        type: 'floating_text',
        faction: 'all',
        text: `IRON CURTAIN ACTIVE (${affected} UNITS · 10s)`,
        color: '#ff4b6b',
        x: tx,
        y: by + 3.2,
        z: tz,
      });
      this.emitEva(faction, 'iron_curtain', 'Iron Curtain activated — Units invulnerable!');
      return true;
    }

    const id = this.nextId++;
    if (weapon === 'airstrike') {
      const angle = faction === 'allies' ? -Math.PI * 0.25 : Math.PI * 0.75;
      this.pendingStrikes.set(id, {
        id,
        type: 'airstrike',
        faction,
        targetX: tx,
        targetZ: tz,
        elapsed: 0,
        duration: 4.2,
        bombsDropped: 0,
        angle,
      });
      this.events.push({
        type: 'airstrike_start',
        faction,
        targetX: tx,
        targetZ: tz,
        angle,
      });
      this.emitEva(faction, 'airstrike_inbound', 'A-10 Air Strike Inbound!');
      this.emitEva(
        faction === 'allies' ? 'soviets' : 'allies',
        'airstrike_inbound',
        'Warning: Enemy Air Strike Detected!'
      );
    } else {
      this.pendingStrikes.set(id, {
        id,
        type: 'nuke',
        faction,
        targetX: tx,
        targetZ: tz,
        elapsed: 0,
        duration: 3.4,
        bombsDropped: 0,
        angle: 0,
      });
      this.events.push({
        type: 'nuke_launched',
        faction,
        targetX: tx,
        targetZ: tz,
      });
      this.emitEva('allies', 'nuke_detected', 'WARNING: Nuclear Missile Launched!');
      this.emitEva('soviets', 'nuke_detected', 'WARNING: Nuclear Missile Launched!');
    }
    return true;
  }

  queueUnitProduction(faction: Faction, type: UnitType): boolean {
    const player = this.players[faction];
    const spec = UNIT_SPECS[type];
    if (!this.hasPrerequisites(faction, spec.requires)) return false;

    if (!player.unitProd) {
      if (player.credits < 10) {
        this.emitEva(faction, 'insufficient_funds', 'Insufficient funds');
        return false;
      }
      player.unitProd = {
        type,
        progress: 0,
        paidSoFar: 0,
        totalCost: spec.cost,
        ready: false,
        queue: [],
      };
      return true;
    }

    if (player.unitProd.queue.length >= 8) return false;
    player.unitProd.queue.push(type);
    return true;
  }

  cancelUnitProduction(faction: Faction, type?: UnitType): void {
    const player = this.players[faction];
    if (!player.unitProd) return;

    if (type) {
      const qIdx = player.unitProd.queue.lastIndexOf(type);
      if (qIdx !== -1) {
        player.unitProd.queue.splice(qIdx, 1);
        return;
      }
      if (player.unitProd.type !== type) return;
    }

    player.credits += Math.round(player.unitProd.paidSoFar);
    const next = player.unitProd.queue.shift();
    if (next) {
      player.unitProd = {
        type: next,
        progress: 0,
        paidSoFar: 0,
        totalCost: UNIT_SPECS[next].cost,
        ready: false,
        queue: player.unitProd.queue,
      };
    } else {
      player.unitProd = null;
    }
  }

  // --- UNIT ORDERS ---

  issueMoveOrder(unitIds: number[], target: Vec2, attackMove = false): void {
    const units = unitIds
      .map((id) => this.units.get(id))
      .filter((u): u is UnitEntity => !!u);
    if (units.length === 0) return;

    const cols = Math.ceil(Math.sqrt(units.length));
    const spacing = 2.6;

    units.forEach((u, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const offsetX = (col - (cols - 1) * 0.5) * spacing;
      const offsetZ = (row - (Math.ceil(units.length / cols) - 1) * 0.5) * spacing;
      const dest: Vec2 = {
        x: Math.max(TILE_SIZE * 1.5, Math.min(WORLD_SIZE - TILE_SIZE * 1.5, target.x + offsetX)),
        z: Math.max(TILE_SIZE * 1.5, Math.min(WORLD_SIZE - TILE_SIZE * 1.5, target.z + offsetZ)),
      };

      u.order = attackMove ? { type: 'attack_move', target: dest } : { type: 'move', target: dest };
      u.targetId = null;
      u.path = UNIT_SPECS[u.type].isAir
        ? [dest]
        : findPath({ x: u.x, z: u.z }, dest, this.blocked);
      u.pathIndex = 0;
      u.repathTimer = 0.6;
    });
  }

  issueAttackOrder(unitIds: number[], targetId: number): void {
    const target = this.getEntity(targetId);
    if (!target) return;

    for (const id of unitIds) {
      const u = this.units.get(id);
      if (!u || u.type === 'harvester') continue;
      if (target.kind === 'unit' && UNIT_SPECS[target.type].isAir && !UNIT_SPECS[u.type].weapon?.canTargetAir) {
        continue;
      }
      u.order = { type: 'attack', targetId };
      u.targetId = targetId;
      u.path = UNIT_SPECS[u.type].isAir
        ? [{ x: target.x, z: target.z }]
        : findPath({ x: u.x, z: u.z }, { x: target.x, z: target.z }, this.blocked);
      u.pathIndex = 0;
      u.repathTimer = 0.5;
    }
  }

  issueHarvestOrder(unitIds: number[], targetWorld?: Vec2): void {
    for (const id of unitIds) {
      const u = this.units.get(id);
      if (!u || u.type !== 'harvester') continue;
      u.order = { type: 'harvest' };
      u.harvesterState = 'idle';
      if (targetWorld) {
        const tile = worldToTile(targetWorld.x, targetWorld.z);
        if (this.map.ore[tile.gz * MAP_SIZE + tile.gx] > 0) {
          u.harvestTarget = tile;
          u.harvesterState = 'moving_to_ore';
          u.path = findPath({ x: u.x, z: u.z }, targetWorld, this.blocked);
          u.pathIndex = 0;
        }
      }
    }
  }

  issueStopOrder(unitIds: number[]): void {
    for (const id of unitIds) {
      const u = this.units.get(id);
      if (!u) continue;
      u.order = { type: 'idle' };
      u.path = [];
      u.targetId = null;
    }
  }

  setRallyPoint(buildingId: number, target: Vec2): void {
    const b = this.buildings.get(buildingId);
    if (!b || (b.type !== 'barracks' && b.type !== 'warfactory')) return;
    b.rallyPoint = { x: target.x, z: target.z };
  }

  getEntity(id: number): Entity | undefined {
    return this.units.get(id) ?? this.buildings.get(id);
  }

  // --- MAIN FIXED-TIMESTEP SIMULATION TICK ---

  tick(dt: number): void {
    if (this.winner) return;
    this.simTime += dt;

    this.updateProduction('allies', dt);
    this.updateProduction('soviets', dt);
    this.updateSuperweapons('allies', dt);
    this.updateSuperweapons('soviets', dt);
    this.updatePendingStrikes(dt);
    this.updateFalloutZones(dt);
    this.updateBuildings(dt);
    this.updateUnits(dt);
    this.updateProjectiles(dt);
    this.updateDerricks(dt);
    this.updateCrates(dt);
    this.updateOreRegrowth(dt);

    this.fogTickCounter++;
    if (this.fogTickCounter >= 4) {
      this.fogTickCounter = 0;
      this.updateFogOfWar();
    }

    this.checkWinCondition();
  }

  private recomputePower(faction: Faction, silent = false): void {
    let produced = 0;
    let consumed = 0;
    for (const b of this.buildings.values()) {
      if (b.faction !== faction) continue;
      const delta = BUILDING_SPECS[b.type].powerDelta;
      if (delta >= 0) produced += delta;
      else consumed += -delta;
    }
    const p = this.players[faction];
    p.powerProduced = produced;
    p.powerConsumed = consumed;
    p.powerRatio = consumed === 0 ? 1 : Math.min(1, produced / consumed);

    const lowPower = produced < consumed;
    for (const b of this.buildings.values()) {
      if (b.faction === faction) {
        b.powered = !lowPower;
      }
    }

    if (!silent && lowPower !== this.lastLowPowerState[faction]) {
      this.lastLowPowerState[faction] = lowPower;
      if (lowPower) {
        this.emitEva(faction, 'low_power', 'Low power! Build Power Plants');
      } else {
        this.emitEva(faction, 'power_restored', 'Power restored');
      }
    } else if (silent) {
      this.lastLowPowerState[faction] = lowPower;
    }
  }

  private syncSuperweaponUnlocks(faction: Faction, silent = false): void {
    const p = this.players[faction];
    const hasTech = this.countFactionBuilding(faction, 'techcenter') > 0;
    const hasSilo = this.countFactionBuilding(faction, 'silo') > 0;

    if (hasTech && !p.superweapons.airstrike.unlocked && !silent) {
      this.emitEva(faction, 'building', 'Tech Center online — Air Strike charging');
    }
    if (hasSilo && !p.superweapons.nuke.unlocked && !silent) {
      this.emitEva(faction, 'building', 'Nuclear Silo online — Warhead arming');
    }

    p.superweapons.airstrike.unlocked = hasTech;
    p.superweapons.iron_curtain.unlocked = hasTech;
    p.superweapons.nuke.unlocked = hasSilo;
  }

  private updateSuperweapons(faction: Faction, dt: number): void {
    const p = this.players[faction];
    const rate = p.powerRatio >= 1 ? 1.0 : 0.3;

    for (const key of ['airstrike', 'iron_curtain', 'nuke'] as const) {
      const sw = p.superweapons[key];
      if (!sw.unlocked || sw.cooldown <= 0) continue;
      const prev = sw.cooldown;
      sw.cooldown = Math.max(0, sw.cooldown - dt * rate);
      if (prev > 0 && sw.cooldown === 0) {
        this.emitEva(
          faction,
          'superweapon_ready',
          key === 'nuke'
            ? 'Nuclear Missile Ready!'
            : key === 'iron_curtain'
            ? 'Iron Curtain Ready!'
            : 'A-10 Air Strike Ready!'
        );
      }
    }
  }

  private updatePendingStrikes(dt: number): void {
    const finished: number[] = [];
    for (const s of this.pendingStrikes.values()) {
      s.elapsed += dt;

      if (s.type === 'airstrike') {
        // Carpet-bomb 6 explosions along a 16-unit run across the target
        const bombWindowStart = 1.45;
        const bombInterval = 0.2;
        const expectedBombs = Math.min(
          6,
          Math.max(0, Math.floor((s.elapsed - bombWindowStart) / bombInterval) + 1)
        );
        while (s.bombsDropped < expectedBombs) {
          const idx = s.bombsDropped++;
          const offset = (idx - 2.5) * 3.2;
          const bx = s.targetX + Math.sin(s.angle) * offset + (Math.random() - 0.5) * 1.6;
          const bz = s.targetZ + Math.cos(s.angle) * offset + (Math.random() - 0.5) * 1.6;
          const by = sampleTerrainHeight(this.map, bx, bz);

          this.events.push({
            type: 'explosion',
            x: bx,
            y: by + 0.6,
            z: bz,
            scale: 2.35,
            damageType: 'rocket',
            leaveCrater: true,
            shake: 0.55,
          });
          this.applyAreaDamage(bx, bz, 5.2, 130, 'rocket', s.faction, null);
        }
      } else if (s.type === 'nuke' && s.bombsDropped === 0 && s.elapsed >= s.duration) {
        s.bombsDropped = 1;
        const by = sampleTerrainHeight(this.map, s.targetX, s.targetZ);
        this.events.push({
          type: 'nuke_impact',
          x: s.targetX,
          y: by,
          z: s.targetZ,
        });
        this.events.push({
          type: 'explosion',
          x: s.targetX,
          y: by + 1.2,
          z: s.targetZ,
          scale: 5.5,
          damageType: 'nuke',
          leaveCrater: true,
          shake: 1.8,
        });

        // Catastrophic blast radius + lingering nuclear fallout zone!
        this.applyAreaDamage(s.targetX, s.targetZ, 14.5, 680, 'nuke', s.faction, null, true);

        const fid = this.nextId++;
        this.falloutZones.set(fid, {
          id: fid,
          faction: s.faction,
          x: s.targetX,
          z: s.targetZ,
          radius: 11.5,
          remaining: 11.0,
        });
      }

      if (s.elapsed >= s.duration) {
        finished.push(s.id);
      }
    }

    for (const id of finished) this.pendingStrikes.delete(id);
  }

  private updateFalloutZones(dt: number): void {
    const expired: number[] = [];
    for (const fz of this.falloutZones.values()) {
      fz.remaining -= dt;
      if (fz.remaining <= 0) {
        expired.push(fz.id);
        continue;
      }
      // Radiation slowly cooks units standing inside the fallout crater
      for (const u of this.units.values()) {
        if (Math.hypot(u.x - fz.x, u.z - fz.z) <= fz.radius) {
          this.applyDamage(u, 22 * dt, 'nuke', fz.faction, null);
        }
      }
    }
    for (const id of expired) this.falloutZones.delete(id);
  }

  private updateDerricks(dt: number): void {
    for (const d of this.derricks.values()) {
      // Passive income for owner
      if (d.owner) {
        d.incomeTimer += dt;
        if (d.incomeTimer >= 2.0) {
          d.incomeTimer = 0;
          const bonus = 45;
          this.players[d.owner].credits += bonus;
          this.players[d.owner].stats.creditsHarvested += bonus;
          this.events.push({
            type: 'floating_text',
            faction: d.owner,
            text: `+$${bonus}`,
            color: '#f5b82e',
            x: d.x,
            y: d.y + 4.4,
            z: d.z,
          });
        }
      }

      // Check nearby ground units for capturing
      let alliesNear = 0;
      let sovietsNear = 0;
      for (const u of this.units.values()) {
        if (u.type === 'harvester') continue;
        if (Math.hypot(u.x - d.x, u.z - d.z) <= 6.2) {
          if (u.faction === 'allies') alliesNear++;
          else sovietsNear++;
        }
      }

      const capturer: Faction | null =
        alliesNear > 0 && sovietsNear === 0
          ? 'allies'
          : sovietsNear > 0 && alliesNear === 0
          ? 'soviets'
          : null;

      if (capturer && capturer !== d.owner) {
        if (d.capturingFaction !== capturer) {
          d.capturingFaction = capturer;
          d.captureProgress = 0;
        }
        d.captureProgress = Math.min(1, d.captureProgress + dt * 0.28);
        if (d.captureProgress >= 1) {
          d.owner = capturer;
          d.captureProgress = 0;
          d.capturingFaction = null;
          d.incomeTimer = 0;
          this.players[capturer].credits += 250;
          this.players[capturer].stats.creditsHarvested += 250;
          this.events.push({ type: 'derrick_captured', faction: capturer, x: d.x, y: d.y, z: d.z });
          this.events.push({
            type: 'floating_text',
            faction: 'all',
            text: `OIL DERRICK CAPTURED (+$250)`,
            color: capturer === 'allies' ? '#60a5fa' : '#ff5c5c',
            x: d.x,
            y: d.y + 4.8,
            z: d.z,
          });
          this.emitEva(capturer, 'derrick_captured', 'Tech Oil Derrick captured! Passive income online');
        }
      } else {
        d.captureProgress = Math.max(0, d.captureProgress - dt * 0.2);
        if (d.captureProgress === 0) d.capturingFaction = null;
      }
    }
  }

  private spawnCrateAt(wx: number, wz: number, forceKind?: CrateKind): void {
    const kinds: CrateKind[] = ['cash', 'veterancy', 'heal', 'reinforcement'];
    const kind = forceKind ?? kinds[Math.floor(Math.random() * kinds.length)];
    const y = sampleTerrainHeight(this.map, wx, wz);
    const id = this.nextId++;
    this.crates.set(id, { id, x: wx, y, z: wz, kind });
  }

  private updateCrates(dt: number): void {
    this.crateSpawnTimer -= dt;
    if (this.crateSpawnTimer <= 0 && this.crates.size < 3) {
      this.crateSpawnTimer = 34;
      // Pick a random walkable non-base tile in the middle 65% of the map
      for (let attempt = 0; attempt < 25; attempt++) {
        const gx = Math.floor(14 + Math.random() * (MAP_SIZE - 28));
        const gz = Math.floor(14 + Math.random() * (MAP_SIZE - 28));
        const idx = gz * MAP_SIZE + gx;
        if (!this.blocked[idx] && this.map.walkable[idx]) {
          const w = tileToWorld(gx, gz);
          this.spawnCrateAt(w.x, w.z);
          break;
        }
      }
    }

    const pickedIds: number[] = [];
    for (const c of this.crates.values()) {
      for (const u of this.units.values()) {
        if (Math.hypot(u.x - c.x, u.z - c.z) <= 2.3) {
          pickedIds.push(c.id);
          this.applyCrateEffect(c, u);
          break;
        }
      }
    }
    for (const id of pickedIds) this.crates.delete(id);
  }

  private applyCrateEffect(c: CrateEntity, u: UnitEntity): void {
    let label = 'CRATE';
    let color = '#f5b82e';

    if (c.kind === 'cash') {
      this.players[u.faction].credits += 1000;
      this.players[u.faction].stats.creditsHarvested += 1000;
      label = 'CRATE: +$1000 CREDITS!';
      color = '#f5b82e';
    } else if (c.kind === 'veterancy') {
      let promoted = 0;
      for (const ally of this.units.values()) {
        if (ally.faction === u.faction && ally.type !== 'harvester' && Math.hypot(ally.x - c.x, ally.z - c.z) <= 8) {
          if (this.promoteUnit(ally)) promoted++;
        }
      }
      label = promoted > 0 ? 'CRATE: UNIT PROMOTED ★' : 'CRATE: +$600 BONUS';
      if (promoted === 0) this.players[u.faction].credits += 600;
      color = '#fde047';
    } else if (c.kind === 'heal') {
      for (const ally of this.units.values()) {
        if (ally.faction === u.faction && Math.hypot(ally.x - c.x, ally.z - c.z) <= 10) {
          ally.hp = ally.maxHp;
        }
      }
      label = 'CRATE: SQUAD REPAIRED!';
      color = '#3bf095';
    } else {
      const bonusType: UnitType = Math.random() > 0.4 ? 'medium_tank' : 'tesla_trooper';
      this.spawnUnit(bonusType, u.faction, c.x + 1.5, c.z - 1.5);
      label = `CRATE: FREE ${UNIT_SPECS[bonusType].shortName.toUpperCase()}!`;
      color = '#60a5fa';
    }

    this.events.push({
      type: 'crate_pickup',
      faction: u.faction,
      kind: c.kind,
      label,
      x: c.x,
      y: c.y + 0.8,
      z: c.z,
    });
    this.events.push({
      type: 'floating_text',
      faction: u.faction,
      text: label,
      color,
      x: c.x,
      y: c.y + 2.6,
      z: c.z,
    });
  }

  private promoteUnit(u: UnitEntity): boolean {
    if (u.rank >= 2 || u.type === 'harvester') return false;
    u.rank = (u.rank + 1) as 1 | 2;
    const baseHp = UNIT_SPECS[u.type].maxHp;
    const newMax = Math.round(baseHp * (u.rank === 2 ? 1.38 : 1.2));
    const delta = newMax - u.maxHp;
    u.maxHp = newMax;
    u.hp = Math.min(u.maxHp, u.hp + delta + u.maxHp * 0.25);

    this.events.push({
      type: 'veterancy_up',
      faction: u.faction,
      rank: u.rank,
      x: u.x,
      y: u.y + 1.4,
      z: u.z,
    });
    this.events.push({
      type: 'floating_text',
      faction: u.faction,
      text: u.rank === 2 ? '★★★ ELITE!' : '★ VETERAN!',
      color: u.rank === 2 ? '#ff6b6b' : '#fde047',
      x: u.x,
      y: u.y + 3.0,
      z: u.z,
    });
    this.emitEva(u.faction, 'unit_promoted', u.rank === 2 ? 'Unit promoted to Elite!' : 'Unit promoted!');
    return true;
  }

  private updateProduction(faction: Faction, dt: number): void {
    const player = this.players[faction];
    const speedMult = player.powerRatio >= 1 ? 1.0 : 0.45;

    const bProd = player.buildingProd;
    if (bProd && !bProd.ready) {
      const spec = BUILDING_SPECS[bProd.type as BuildingType];
      if (!this.hasPrerequisites(faction, spec.requires)) {
        this.cancelBuildingProduction(faction);
      } else {
        const stepProgress = (dt / spec.buildTime) * speedMult;
        const targetProgress = Math.min(1, bProd.progress + stepProgress);
        const costNeeded = targetProgress * bProd.totalCost - bProd.paidSoFar;
        if (costNeeded <= player.credits) {
          player.credits -= costNeeded;
          bProd.paidSoFar += costNeeded;
          bProd.progress = targetProgress;
        } else if (player.credits > 0) {
          const affordableFrac = player.credits / bProd.totalCost;
          bProd.paidSoFar += player.credits;
          player.credits = 0;
          bProd.progress = Math.min(1, bProd.progress + affordableFrac);
        }

        if (bProd.progress >= 0.9999) {
          bProd.progress = 1;
          bProd.ready = true;
          this.emitEva(faction, 'construction_complete', `Construction complete: ${spec.name}`);
        }
      }
    }

    const uProd = player.unitProd;
    if (uProd) {
      const spec = UNIT_SPECS[uProd.type as UnitType];
      if (!this.hasPrerequisites(faction, spec.requires)) {
        this.cancelUnitProduction(faction);
      } else {
        const stepProgress = (dt / spec.buildTime) * speedMult;
        const targetProgress = Math.min(1, uProd.progress + stepProgress);
        const costNeeded = targetProgress * uProd.totalCost - uProd.paidSoFar;
        if (costNeeded <= player.credits) {
          player.credits -= costNeeded;
          uProd.paidSoFar += costNeeded;
          uProd.progress = targetProgress;
        } else if (player.credits > 0) {
          const affordableFrac = player.credits / uProd.totalCost;
          uProd.paidSoFar += player.credits;
          player.credits = 0;
          uProd.progress = Math.min(1, uProd.progress + affordableFrac);
        }

        if (uProd.progress >= 0.9999) {
          const producer = this.findProducerBuilding(faction, spec.producedAt);
          if (producer) {
            const spawnPos = this.findSpawnPointNearBuilding(producer);
            const unit = this.spawnUnit(spec.id, faction, spawnPos.x, spawnPos.z);
            if (spec.id !== 'harvester' && producer.rallyPoint) {
              this.issueMoveOrder([unit.id], producer.rallyPoint, true);
            }
            if (spec.id === 'kirov') {
              // Iconic global Kirov warning!
              this.emitEva('allies', 'kirov_reporting', 'Kirov reporting!');
              this.emitEva('soviets', 'kirov_reporting', 'Kirov reporting!');
            } else {
              this.emitEva(faction, 'unit_ready', `Unit ready: ${spec.name}`);
            }
          }
          const next = uProd.queue.shift();
          if (next) {
            player.unitProd = {
              type: next,
              progress: 0,
              paidSoFar: 0,
              totalCost: UNIT_SPECS[next].cost,
              ready: false,
              queue: uProd.queue,
            };
          } else {
            player.unitProd = null;
          }
        }
      }
    }
  }

  private findProducerBuilding(
    faction: Faction,
    type: 'barracks' | 'warfactory'
  ): BuildingEntity | undefined {
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.type === type) return b;
    }
    return undefined;
  }

  private updateBuildings(dt: number): void {
    for (const b of this.buildings.values()) {
      if (b.buildAnim < 1) {
        b.buildAnim = Math.min(1, b.buildAnim + dt * 2.2);
      }
      if (b.flashTimer > 0) b.flashTimer = Math.max(0, b.flashTimer - dt);
      if (b.attackCooldown > 0) b.attackCooldown = Math.max(0, b.attackCooldown - dt);

      const spec = BUILDING_SPECS[b.type];

      // Active building Repair (drains credits smoothly like classic C&C)
      if (b.repairing) {
        if (b.hp >= b.maxHp - 0.5) {
          b.hp = b.maxHp;
          b.repairing = false;
        } else {
          const healAmt = Math.min(b.maxHp - b.hp, 42 * dt);
          const repairCost = (healAmt / b.maxHp) * spec.cost * 0.4;
          const p = this.players[b.faction];
          if (p.credits >= repairCost) {
            p.credits -= repairCost;
            b.hp += healAmt;
            if (Math.random() < 0.22) {
              this.events.push({ type: 'harvest_spark', x: b.x, y: b.y + 1.8, z: b.z });
            }
          } else {
            b.repairing = false;
          }
        }
      }

      if (!spec.weapon || b.buildAnim < 0.9) continue;
      if (spec.weapon.requiresPower && !b.powered) continue;

      let target = b.targetId ? this.getEntity(b.targetId) : undefined;
      if (
        !target ||
        target.faction === b.faction ||
        Math.hypot(target.x - b.x, target.z - b.z) > spec.weapon.range
      ) {
        target = this.findNearestEnemy(
          b.faction,
          b.x,
          b.z,
          spec.weapon.range,
          0,
          !!spec.weapon.canTargetAir
        );
        b.targetId = target ? target.id : null;
      }

      if (target) {
        const desiredAngle = Math.atan2(target.x - b.x, target.z - b.z);
        b.turretAngle = stepAngle(b.turretAngle, desiredAngle, 6.0 * dt);

        if (b.attackCooldown <= 0) {
          const aimDiff = Math.abs(wrapAngle(desiredAngle - b.turretAngle));
          if (spec.weapon.damageType === 'tesla' || aimDiff < 0.25) {
            this.fireWeapon(
              b.faction,
              null,
              b.x,
              b.y + (b.type === 'tesla' ? 4.3 : 1.7),
              b.z,
              target,
              spec.weapon.damage,
              spec.weapon.damageType,
              spec.weapon.projectileSpeed,
              spec.weapon.splashRadius ?? 0,
              0.7,
              false
            );
            b.attackCooldown = spec.weapon.cooldown;
          }
        }
      }
    }
  }

  private updateUnits(dt: number): void {
    const unitArr = Array.from(this.units.values());

    for (const u of unitArr) {
      u.prevX = u.x;
      u.prevZ = u.z;
      if (u.flashTimer > 0) u.flashTimer = Math.max(0, u.flashTimer - dt);
      if (u.invulnerableTimer > 0) u.invulnerableTimer = Math.max(0, u.invulnerableTimer - dt);
      if (u.attackCooldown > 0) u.attackCooldown = Math.max(0, u.attackCooldown - dt);
      if (u.recoil > 0) u.recoil = Math.max(0, u.recoil - dt * 4.5);
      if (u.repathTimer > 0) u.repathTimer = Math.max(0, u.repathTimer - dt);

      const spec = UNIT_SPECS[u.type];

      // Mammoth Tank self-repair up to 50% HP, and Elite (★★★) units self-repair to 100%!
      if (u.rank === 2 && u.hp < u.maxHp) {
        u.hp = Math.min(u.maxHp, u.hp + 12 * dt);
      } else if (u.type === 'mammoth_tank' && u.hp < u.maxHp * 0.5) {
        u.hp = Math.min(u.maxHp * 0.5, u.hp + 9 * dt);
      }

      if (u.type === 'harvester') {
        this.updateHarvester(u, dt);
      } else {
        this.updateCombatUnit(u, dt);
      }

      let moveX = 0;
      let moveZ = 0;
      let moving = false;

      if (u.path.length > 0 && u.pathIndex < u.path.length) {
        const wp = u.path[u.pathIndex];
        const dx = wp.x - u.x;
        const dz = wp.z - u.z;
        const dist = Math.hypot(dx, dz);
        const reachThreshold = u.pathIndex === u.path.length - 1 ? 0.65 : 1.1;

        if (dist <= reachThreshold) {
          u.pathIndex++;
          if (u.pathIndex >= u.path.length) {
            u.path = [];
            if (u.order.type === 'move' || u.order.type === 'attack_move') {
              u.order = { type: 'idle' };
            }
          }
        } else {
          moving = true;
          moveX = dx / dist;
          moveZ = dz / dist;
        }
      }

      let sepX = 0;
      let sepZ = 0;
      for (const other of unitArr) {
        if (other.id === u.id) continue;
        // Air units only separate from other air units; ground units only from ground
        if (!!UNIT_SPECS[other.type].isAir !== !!spec.isAir) continue;
        const dx = u.x - other.x;
        const dz = u.z - other.z;
        const minDist = spec.radius + UNIT_SPECS[other.type].radius + 0.25;
        const dSq = dx * dx + dz * dz;
        if (dSq > 0.0001 && dSq < minDist * minDist) {
          const d = Math.sqrt(dSq);
          const push = (minDist - d) / minDist;
          sepX += (dx / d) * push;
          sepZ += (dz / d) * push;
        }
      }

      const speedVetMult = u.rank === 2 ? 1.14 : u.rank === 1 ? 1.07 : 1.0;

      if (moving) {
        const desiredHeading = Math.atan2(moveX, moveZ);
        u.angle = stepAngle(u.angle, desiredHeading, spec.turnRate * dt);
        const speedFactor = Math.max(0.35, Math.cos(wrapAngle(desiredHeading - u.angle)));
        u.vx = moveX * spec.speed * speedVetMult * speedFactor + sepX * 3.5;
        u.vz = moveZ * spec.speed * speedVetMult * speedFactor + sepZ * 3.5;
        u.animPhase += dt * (spec.armor === 'infantry' ? 12 : 6);
      } else {
        u.vx = sepX * 2.5;
        u.vz = sepZ * 2.5;
      }

      const nextX = Math.max(TILE_SIZE, Math.min(WORLD_SIZE - TILE_SIZE, u.x + u.vx * dt));
      const nextZ = Math.max(TILE_SIZE, Math.min(WORLD_SIZE - TILE_SIZE, u.z + u.vz * dt));

      if (spec.isAir) {
        // Kirov Airship glides smoothly over all cliffs, mesas, and structures!
        u.x = nextX;
        u.z = nextZ;
      } else {
        const nextTile = worldToTile(nextX, nextZ);
        if (!this.blocked[nextTile.gz * MAP_SIZE + nextTile.gx]) {
          u.x = nextX;
          u.z = nextZ;
        } else {
          const tx = worldToTile(nextX, u.z);
          const tz = worldToTile(u.x, nextZ);
          if (!this.blocked[tx.gz * MAP_SIZE + tx.gx]) u.x = nextX;
          else if (!this.blocked[tz.gz * MAP_SIZE + tz.gx]) u.z = nextZ;
        }
      }

      u.y = sampleTerrainHeight(this.map, u.x, u.z);

      if (!u.targetId) {
        u.turretAngle = stepAngle(u.turretAngle, u.angle, spec.turretTurnRate * dt);
      }
    }
  }

  private updateCombatUnit(u: UnitEntity, dt: number): void {
    const spec = UNIT_SPECS[u.type];
    const weapon = spec.weapon;
    if (!weapon) return;

    if (u.order.type === 'move') {
      u.targetId = null;
      return;
    }

    let target: Entity | undefined;
    if (u.order.type === 'attack') {
      target = this.getEntity(u.order.targetId);
      if (!target) {
        u.order = { type: 'idle' };
        u.targetId = null;
        u.path = [];
      }
    } else {
      const scanRange = Math.max(weapon.range + 4, spec.sight);
      target = u.targetId ? this.getEntity(u.targetId) : undefined;
      if (
        !target ||
        target.faction === u.faction ||
        Math.hypot(target.x - u.x, target.z - u.z) > scanRange
      ) {
        target = this.findNearestEnemy(
          u.faction,
          u.x,
          u.z,
          scanRange,
          weapon.minRange ?? 0,
          !!weapon.canTargetAir
        );
      }
    }

    u.targetId = target ? target.id : null;
    if (!target) {
      if (u.order.type === 'attack_move' && u.path.length === 0 && u.repathTimer <= 0) {
        const dGoal = Math.hypot(u.order.target.x - u.x, u.order.target.z - u.z);
        if (dGoal > 1.8) {
          u.path = spec.isAir
            ? [u.order.target]
            : findPath({ x: u.x, z: u.z }, u.order.target, this.blocked);
          u.pathIndex = 0;
          u.repathTimer = 1.0;
        }
      }
      return;
    }

    const dx = target.x - u.x;
    const dz = target.z - u.z;
    const dist = Math.hypot(dx, dz);
    const targetPadding =
      target.kind === 'building'
        ? Math.max(...BUILDING_SPECS[target.type].footprint) * TILE_SIZE * 0.45
        : UNIT_SPECS[target.type].radius;
    const effectiveRange = weapon.range + targetPadding;

    if (dist > effectiveRange) {
      if ((u.order.type === 'attack' || u.order.type === 'attack_move') && u.repathTimer <= 0) {
        u.path = spec.isAir
          ? [{ x: target.x, z: target.z }]
          : findPath({ x: u.x, z: u.z }, { x: target.x, z: target.z }, this.blocked);
        u.pathIndex = 0;
        u.repathTimer = 0.75;
      }
      return;
    }

    if (weapon.minRange && dist < weapon.minRange) {
      return;
    }

    if (u.order.type === 'attack' || u.order.type === 'attack_move') {
      u.path = [];
    }

    const desiredAngle = Math.atan2(dx, dz);
    u.turretAngle = stepAngle(u.turretAngle, desiredAngle, spec.turretTurnRate * dt);
    if (spec.armor === 'infantry' || u.type === 'v2_launcher' || u.type === 'tesla_trooper') {
      u.angle = u.turretAngle;
    }

    const dmgVetMult = u.rank === 2 ? 1.55 : u.rank === 1 ? 1.25 : 1.0;
    const rofVetMult = u.rank === 2 ? 0.72 : u.rank === 1 ? 0.86 : 1.0;
    const eliteShot = u.rank === 2;

    const aimDiff = Math.abs(wrapAngle(desiredAngle - u.turretAngle));
    if (u.attackCooldown <= 0 && (spec.isAir || aimDiff < 0.24)) {
      const muzzleY =
        u.y +
        (spec.isAir ? 6.8 : u.type === 'v2_launcher' ? 2.1 : spec.armor === 'infantry' ? 0.9 : 1.35);
      const muzzleForward = spec.isAir ? 0 : spec.armor === 'infantry' ? 0.45 : 1.4;
      const fx = u.x + Math.sin(u.turretAngle) * muzzleForward;
      const fz = u.z + Math.cos(u.turretAngle) * muzzleForward;
      const arc = weapon.arcHeight ?? (weapon.damageType === 'rocket' ? 1.8 : 0.7);

      if (weapon.dualBarrel) {
        const perpX = Math.cos(u.turretAngle) * 0.42;
        const perpZ = -Math.sin(u.turretAngle) * 0.42;
        this.fireWeapon(
          u.faction,
          u.id,
          fx + perpX,
          muzzleY,
          fz + perpZ,
          target,
          weapon.damage * 0.5 * dmgVetMult,
          weapon.damageType,
          weapon.projectileSpeed,
          weapon.splashRadius ?? 0,
          arc,
          eliteShot
        );
        this.fireWeapon(
          u.faction,
          u.id,
          fx - perpX,
          muzzleY,
          fz - perpZ,
          target,
          weapon.damage * 0.5 * dmgVetMult,
          weapon.damageType,
          weapon.projectileSpeed,
          weapon.splashRadius ?? 0,
          arc,
          eliteShot
        );
      } else {
        this.fireWeapon(
          u.faction,
          u.id,
          fx,
          muzzleY,
          fz,
          target,
          weapon.damage * dmgVetMult,
          weapon.damageType,
          weapon.projectileSpeed,
          weapon.splashRadius ?? 0,
          arc,
          eliteShot
        );
      }

      u.attackCooldown = weapon.cooldown * rofVetMult;
      u.recoil = 1.0;
    }
  }

  private updateHarvester(u: UnitEntity, dt: number): void {
    if (u.order.type === 'move') return;

    const spec = UNIT_SPECS.harvester;
    const capacity = spec.harvesterCapacity ?? 750;
    const rate = spec.harvestRate ?? 155;

    let ref = u.refineryId ? this.buildings.get(u.refineryId) : undefined;
    if (!ref || ref.type !== 'refinery' || ref.faction !== u.faction) {
      ref = this.findNearestRefinery(u.faction, u.x, u.z);
      u.refineryId = ref ? ref.id : null;
    }

    if (u.harvesterState === 'idle') {
      if (u.cargo >= capacity * 0.95 && ref) {
        u.harvesterState = 'returning';
        u.path = findPath({ x: u.x, z: u.z }, { x: ref.x, z: ref.z }, this.blocked);
        u.pathIndex = 0;
        return;
      }
      const oreTile = this.findNearestOre(u.x, u.z);
      if (oreTile) {
        u.harvestTarget = oreTile;
        u.harvesterState = 'moving_to_ore';
        const w = tileToWorld(oreTile.gx, oreTile.gz);
        u.path = findPath({ x: u.x, z: u.z }, w, this.blocked);
        u.pathIndex = 0;
      }
      return;
    }

    if (u.harvesterState === 'moving_to_ore') {
      if (!u.harvestTarget) {
        u.harvesterState = 'idle';
        return;
      }
      const idx = u.harvestTarget.gz * MAP_SIZE + u.harvestTarget.gx;
      if (this.map.ore[idx] <= 0) {
        u.harvesterState = 'idle';
        return;
      }
      const w = tileToWorld(u.harvestTarget.gx, u.harvestTarget.gz);
      if (Math.hypot(w.x - u.x, w.z - u.z) <= 2.4) {
        u.path = [];
        u.harvesterState = 'harvesting';
      } else if (u.path.length === 0 && u.repathTimer <= 0) {
        u.path = findPath({ x: u.x, z: u.z }, w, this.blocked);
        u.pathIndex = 0;
        u.repathTimer = 1.0;
      }
      return;
    }

    if (u.harvesterState === 'harvesting') {
      if (!u.harvestTarget) {
        u.harvesterState = 'idle';
        return;
      }
      const idx = u.harvestTarget.gz * MAP_SIZE + u.harvestTarget.gx;
      const available = this.map.ore[idx];
      if (available <= 0) {
        u.harvestTarget = null;
        u.harvesterState = u.cargo >= capacity * 0.65 && ref ? 'returning' : 'idle';
        if (u.harvesterState === 'returning' && ref) {
          u.path = findPath({ x: u.x, z: u.z }, { x: ref.x, z: ref.z }, this.blocked);
          u.pathIndex = 0;
        }
        return;
      }

      const gemBonus = this.map.isGem[idx] ? 1.55 : 1.0;
      const mined = Math.min(available, rate * gemBonus * dt, capacity - u.cargo);
      this.map.ore[idx] = Math.max(0, available - mined);
      u.cargo += mined;
      u.animPhase += dt * 10;

      if (Math.random() < 0.25) {
        this.events.push({ type: 'harvest_spark', x: u.x, y: u.y + 0.5, z: u.z });
      }

      if (u.cargo >= capacity - 1) {
        u.harvesterState = 'returning';
        if (ref) {
          u.path = findPath({ x: u.x, z: u.z }, { x: ref.x, z: ref.z }, this.blocked);
          u.pathIndex = 0;
        }
      }
      return;
    }

    if (u.harvesterState === 'returning') {
      if (!ref) {
        u.harvesterState = 'idle';
        return;
      }
      if (Math.hypot(ref.x - u.x, ref.z - u.z) <= 4.8) {
        u.path = [];
        u.harvesterState = 'unloading';
      } else if (u.path.length === 0 && u.repathTimer <= 0) {
        u.path = findPath({ x: u.x, z: u.z }, { x: ref.x, z: ref.z }, this.blocked);
        u.pathIndex = 0;
        u.repathTimer = 1.0;
      }
      return;
    }

    if (u.harvesterState === 'unloading') {
      if (!ref) {
        u.harvesterState = 'idle';
        return;
      }
      const unloadAmt = Math.min(u.cargo, 460 * dt);
      u.cargo -= unloadAmt;
      this.players[u.faction].credits += unloadAmt;
      this.players[u.faction].stats.creditsHarvested += unloadAmt;

      if (u.cargo <= 1) {
        const bonus = Math.round(u.cargo);
        this.players[u.faction].credits += bonus;
        u.cargo = 0;
        this.events.push({
          type: 'credits_deposited',
          faction: u.faction,
          amount: capacity,
          x: ref.x,
          y: ref.y + 3.2,
          z: ref.z,
        });
        this.events.push({
          type: 'floating_text',
          faction: u.faction,
          text: `+$${capacity}`,
          color: '#f5b82e',
          x: ref.x,
          y: ref.y + 3.6,
          z: ref.z,
        });
        u.harvesterState = 'idle';
      }
    }
  }

  private findNearestRefinery(faction: Faction, x: number, z: number): BuildingEntity | undefined {
    let best: BuildingEntity | undefined;
    let bestD = Infinity;
    for (const b of this.buildings.values()) {
      if (b.faction === faction && b.type === 'refinery') {
        const d = Math.hypot(b.x - x, b.z - z);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
    }
    return best;
  }

  private findNearestOre(x: number, z: number): { gx: number; gz: number } | null {
    let bestGx = -1;
    let bestGz = -1;
    let bestD = Infinity;
    for (let gz = 1; gz < MAP_SIZE - 1; gz++) {
      for (let gx = 1; gx < MAP_SIZE - 1; gx++) {
        const idx = gz * MAP_SIZE + gx;
        if (this.map.ore[idx] <= 20) continue;
        const wx = (gx + 0.5) * TILE_SIZE;
        const wz = (gz + 0.5) * TILE_SIZE;
        const d = Math.hypot(wx - x, wz - z);
        if (d < bestD) {
          bestD = d;
          bestGx = gx;
          bestGz = gz;
        }
      }
    }
    return bestGx >= 0 ? { gx: bestGx, gz: bestGz } : null;
  }

  private findNearestEnemy(
    faction: Faction,
    x: number,
    z: number,
    maxRange: number,
    minRange = 0,
    canTargetAir = false
  ): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Infinity;

    for (const u of this.units.values()) {
      if (u.faction === faction) continue;
      if (UNIT_SPECS[u.type].isAir && !canTargetAir) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= maxRange && d >= minRange) {
        const score = d + (u.type === 'harvester' ? 4 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = u;
        }
      }
    }

    for (const b of this.buildings.values()) {
      if (b.faction === faction) continue;
      const pad = Math.max(...BUILDING_SPECS[b.type].footprint) * TILE_SIZE * 0.45;
      const d = Math.hypot(b.x - x, b.z - z) - pad;
      if (d <= maxRange && d + pad >= minRange) {
        const score = d + (BUILDING_SPECS[b.type].weapon ? 1.5 : 5);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
    }

    return best;
  }

  private fireWeapon(
    faction: Faction,
    attackerId: number | null,
    fromX: number,
    fromY: number,
    fromZ: number,
    target: Entity,
    damage: number,
    damageType: DamageType,
    projectileSpeed: number,
    splashRadius: number,
    arcHeight: number,
    eliteShot: boolean
  ): void {
    const ty =
      target.y +
      (target.kind === 'building' ? 1.6 : UNIT_SPECS[target.type].isAir ? 7.6 : 0.9);
    this.events.push({
      type: 'shot',
      damageType,
      faction,
      fromX,
      fromY,
      fromZ,
      toX: target.x,
      toY: ty,
      toZ: target.z,
      eliteShot,
    });

    if (projectileSpeed <= 0) {
      this.applyDamage(target, damage, damageType, faction, attackerId);
      if (damageType === 'tesla') {
        this.events.push({
          type: 'explosion',
          x: target.x,
          y: ty,
          z: target.z,
          scale: 1.15,
          damageType: 'tesla',
          shake: 0.12,
        });
      }
      return;
    }

    const p: ProjectileEntity = {
      id: this.nextId++,
      faction,
      attackerId,
      damage,
      damageType,
      splashRadius,
      x: fromX,
      y: fromY,
      z: fromZ,
      startX: fromX,
      startY: fromY,
      startZ: fromZ,
      targetX: target.x,
      targetY: ty,
      targetZ: target.z,
      targetId: target.id,
      speed: projectileSpeed,
      progress: 0,
      arcHeight,
      eliteShot,
    };
    this.projectiles.set(p.id, p);
  }

  private updateProjectiles(dt: number): void {
    const toRemove: number[] = [];
    for (const p of this.projectiles.values()) {
      // Homing rockets (non-V2 ballistic) track targets
      if (p.damageType === 'rocket' && p.arcHeight < 4 && p.targetId) {
        const t = this.getEntity(p.targetId);
        if (t) {
          p.targetX = t.x;
          p.targetY = t.y + (t.kind === 'building' ? 1.5 : 0.9);
          p.targetZ = t.z;
        }
      }

      const totalDist = Math.max(0.5, Math.hypot(p.targetX - p.startX, p.targetZ - p.startZ));
      p.progress += (p.speed * dt) / totalDist;

      if (p.progress >= 1) {
        this.detonateProjectile(p);
        toRemove.push(p.id);
      } else {
        const t = p.progress;
        p.x = p.startX + (p.targetX - p.startX) * t;
        p.z = p.startZ + (p.targetZ - p.startZ) * t;
        const linearY = p.startY + (p.targetY - p.startY) * t;
        p.y = linearY + Math.sin(t * Math.PI) * p.arcHeight;
      }
    }

    for (const id of toRemove) this.projectiles.delete(id);
  }

  private detonateProjectile(p: ProjectileEntity): void {
    const isV2 = p.splashRadius >= 3.5;
    this.events.push({
      type: 'explosion',
      x: p.targetX,
      y: p.targetY,
      z: p.targetZ,
      scale: isV2 ? 2.6 : p.splashRadius > 1.8 ? 1.45 : 0.9,
      damageType: p.damageType,
      leaveCrater: p.damageType === 'shell' || isV2,
      shake: isV2 ? 0.72 : p.splashRadius > 2 ? 0.25 : 0.08,
    });

    if (p.splashRadius > 0) {
      const hitAny = this.applyAreaDamage(
        p.targetX,
        p.targetZ,
        p.splashRadius,
        p.damage,
        p.damageType,
        p.faction,
        p.attackerId
      );
      if (!hitAny && p.targetId) {
        const direct = this.getEntity(p.targetId);
        if (direct && direct.faction !== p.faction) {
          this.applyDamage(direct, p.damage, p.damageType, p.faction, p.attackerId);
        }
      }
    } else if (p.targetId) {
      const direct = this.getEntity(p.targetId);
      if (direct && direct.faction !== p.faction) {
        this.applyDamage(direct, p.damage, p.damageType, p.faction, p.attackerId);
      }
    }
  }

  private applyAreaDamage(
    x: number,
    z: number,
    radius: number,
    damage: number,
    damageType: DamageType,
    attackerFaction: Faction,
    attackerId: number | null,
    friendlyFire = false
  ): boolean {
    let hitAny = false;
    for (const u of Array.from(this.units.values())) {
      if (!friendlyFire && u.faction === attackerFaction) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= radius + UNIT_SPECS[u.type].radius) {
        const falloff = Math.max(0.35, 1 - d / (radius + 1.8));
        this.applyDamage(u, damage * falloff, damageType, attackerFaction, attackerId);
        hitAny = true;
      }
    }
    for (const b of Array.from(this.buildings.values())) {
      if (!friendlyFire && b.faction === attackerFaction) continue;
      const pad = Math.max(...BUILDING_SPECS[b.type].footprint) * TILE_SIZE * 0.5;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d <= radius + pad) {
        const falloff = Math.max(0.45, 1 - d / (radius + pad + 2.0));
        this.applyDamage(b, damage * falloff, damageType, attackerFaction, attackerId);
        hitAny = true;
      }
    }
    return hitAny;
  }

  private applyDamage(
    target: Entity,
    rawDamage: number,
    damageType: DamageType,
    attackerFaction: Faction,
    attackerId: number | null
  ): void {
    // Iron Curtain completely blocks all damage while active!
    if (target.kind === 'unit' && target.invulnerableTimer > 0) {
      return;
    }

    const armor = target.kind === 'building' ? 'building' : UNIT_SPECS[target.type].armor;
    const mult = DAMAGE_MULTIPLIERS[damageType][armor];
    target.hp -= rawDamage * mult;
    target.flashTimer = 0.12;

    if (target.kind === 'building') {
      if (this.simTime - this.lastAttackAlertTime[target.faction] > 10) {
        this.lastAttackAlertTime[target.faction] = this.simTime;
        this.events.push({ type: 'radar_alert', faction: target.faction, x: target.x, z: target.z });
        this.emitEva(target.faction, 'base_under_attack', 'Warning: Base under attack!');
      }
    }

    if (target.hp <= 0) {
      // Award veterancy kill credit to attacker unit!
      if (attackerId !== null && target.faction !== attackerFaction) {
        const killer = this.units.get(attackerId);
        if (killer) {
          killer.kills += target.kind === 'building' ? 2 : 1;
          if (killer.rank === 0 && killer.kills >= 2) this.promoteUnit(killer);
          else if (killer.rank === 1 && killer.kills >= 5) this.promoteUnit(killer);
        }
      }

      if (target.kind === 'unit') {
        this.units.delete(target.id);
        this.players[target.faction].stats.unitsLost++;
        if (target.faction !== attackerFaction) {
          this.players[attackerFaction].stats.enemiesDestroyed++;
        }
        this.events.push({
          type: 'unit_destroyed',
          x: target.x,
          y: target.y + 0.6,
          z: target.z,
          faction: target.faction,
          unitType: target.type,
        });
        this.events.push({
          type: 'explosion',
          x: target.x,
          y: target.y + 0.7,
          z: target.z,
          scale:
            target.type === 'mammoth_tank'
              ? 2.2
              : UNIT_SPECS[target.type].armor === 'infantry'
              ? 0.55
              : 1.5,
          damageType: 'shell',
          leaveCrater: UNIT_SPECS[target.type].armor !== 'infantry',
          shake: target.type === 'mammoth_tank' ? 0.55 : UNIT_SPECS[target.type].armor === 'infantry' ? 0 : 0.22,
        });
      } else {
        this.destroyBuilding(target, attackerFaction);
      }
    }
  }

  private destroyBuilding(b: BuildingEntity, attackerFaction: Faction): void {
    this.buildings.delete(b.id);
    const [fw, fh] = BUILDING_SPECS[b.type].footprint;
    for (let dz = 0; dz < fh; dz++) {
      for (let dx = 0; dx < fw; dx++) {
        const idx = (b.gz + dz) * MAP_SIZE + (b.gx + dx);
        this.blocked[idx] = this.map.walkable[idx] ? 0 : 1;
      }
    }
    if (b.faction !== attackerFaction) {
      this.players[attackerFaction].stats.enemiesDestroyed++;
    }
    this.recomputePower(b.faction);
    this.syncSuperweaponUnlocks(b.faction);
    this.events.push({
      type: 'building_destroyed',
      x: b.x,
      y: b.y,
      z: b.z,
      faction: b.faction,
      footprint: [fw, fh],
    });
    this.events.push({
      type: 'explosion',
      x: b.x,
      y: b.y + 1.5,
      z: b.z,
      scale: 2.9,
      damageType: 'shell',
      leaveCrater: true,
      shake: 0.7,
    });
  }

  private updateOreRegrowth(dt: number): void {
    this.oreRegrowTimer += dt;
    if (this.oreRegrowTimer < 5) return;
    this.oreRegrowTimer = 0;
    for (let i = 0; i < this.map.ore.length; i++) {
      if (this.map.ore[i] > 50 && this.map.ore[i] < 800 && !this.map.isGem[i]) {
        this.map.ore[i] += 8;
      }
    }
  }

  updateFogOfWar(): void {
    for (let i = 0; i < this.fog.length; i++) {
      if (this.fog[i] === 2) this.fog[i] = 1;
    }

    const reveal = (wx: number, wz: number, sightWorld: number) => {
      const rTiles = Math.ceil(sightWorld / TILE_SIZE);
      const center = worldToTile(wx, wz);
      const rSq = sightWorld * sightWorld;
      const minX = Math.max(0, center.gx - rTiles);
      const maxX = Math.min(MAP_SIZE - 1, center.gx + rTiles);
      const minZ = Math.max(0, center.gz - rTiles);
      const maxZ = Math.min(MAP_SIZE - 1, center.gz + rTiles);

      for (let gz = minZ; gz <= maxZ; gz++) {
        const tz = (gz + 0.5) * TILE_SIZE - wz;
        for (let gx = minX; gx <= maxX; gx++) {
          const tx = (gx + 0.5) * TILE_SIZE - wx;
          if (tx * tx + tz * tz <= rSq) {
            this.fog[gz * MAP_SIZE + gx] = 2;
          }
        }
      }
    };

    for (const b of this.buildings.values()) {
      if (b.faction === this.localFaction) reveal(b.x, b.z, BUILDING_SPECS[b.type].sight);
    }
    for (const u of this.units.values()) {
      if (u.faction === this.localFaction) reveal(u.x, u.z, UNIT_SPECS[u.type].sight);
    }
    for (const d of this.derricks.values()) {
      if (d.owner === this.localFaction) reveal(d.x, d.z, 15);
    }
  }

  setLocalFaction(faction: Faction): void {
    if (this.localFaction === faction) return;
    this.localFaction = faction;
    this.fog.fill(0);
    this.updateFogOfWar();
  }

  executeCommand(faction: Faction, cmd: GameCommand): void {
    if (this.winner) return;

    const filterOwnedUnits = (ids: number[]) =>
      ids.filter((id) => this.units.get(id)?.faction === faction);

    switch (cmd.type) {
      case 'move': {
        const owned = filterOwnedUnits(cmd.unitIds);
        if (owned.length > 0) this.issueMoveOrder(owned, cmd.target, cmd.attackMove);
        break;
      }
      case 'attack': {
        const owned = filterOwnedUnits(cmd.unitIds);
        const target = this.getEntity(cmd.targetId);
        if (owned.length > 0 && target && target.faction !== faction) {
          this.issueAttackOrder(owned, cmd.targetId);
        }
        break;
      }
      case 'harvest': {
        const owned = filterOwnedUnits(cmd.unitIds);
        if (owned.length > 0) this.issueHarvestOrder(owned, cmd.target);
        break;
      }
      case 'stop': {
        const owned = filterOwnedUnits(cmd.unitIds);
        if (owned.length > 0) this.issueStopOrder(owned);
        break;
      }
      case 'set_rally': {
        const b = this.buildings.get(cmd.buildingId);
        if (b && b.faction === faction) {
          this.setRallyPoint(cmd.buildingId, cmd.target);
        }
        break;
      }
      case 'start_building':
        this.startBuildingProduction(faction, cmd.buildingType);
        break;
      case 'cancel_building':
        this.cancelBuildingProduction(faction);
        break;
      case 'place_building':
        this.placeReadyBuilding(faction, cmd.gx, cmd.gz);
        break;
      case 'sell_building':
        this.sellBuilding(faction, cmd.buildingId);
        break;
      case 'toggle_repair':
        this.toggleRepairBuilding(faction, cmd.buildingId);
        break;
      case 'queue_unit':
        this.queueUnitProduction(faction, cmd.unitType);
        break;
      case 'cancel_unit':
        this.cancelUnitProduction(faction, cmd.unitType);
        break;
      case 'fire_superweapon':
        this.fireSuperweapon(faction, cmd.weapon, cmd.target);
        break;
    }
  }

  createSnapshot(events: SimEvent[]): WorldSnapshot {
    const oreUpdates: Array<[number, number]> = [];
    for (const idx of this.initialOreIndices) {
      oreUpdates.push([idx, Math.round(this.map.ore[idx])]);
    }

    return {
      mapPreset: this.map.preset,
      simTime: this.simTime,
      winner: this.winner,
      players: {
        allies: structuredClone(this.players.allies),
        soviets: structuredClone(this.players.soviets),
      },
      buildings: Array.from(this.buildings.values()),
      units: Array.from(this.units.values()).map((u) => ({
        ...u,
        path: [],
      })),
      projectiles: Array.from(this.projectiles.values()),
      crates: Array.from(this.crates.values()),
      derricks: Array.from(this.derricks.values()),
      falloutZones: Array.from(this.falloutZones.values()),
      oreUpdates,
      events,
    };
  }

  applySnapshot(snap: WorldSnapshot): void {
    this.simTime = snap.simTime;
    this.winner = snap.winner;
    this.players.allies = snap.players.allies;
    this.players.soviets = snap.players.soviets;

    this.buildings.clear();
    for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
      this.blocked[i] = this.map.walkable[i] ? 0 : 1;
    }
    for (const b of snap.buildings) {
      this.buildings.set(b.id, b);
      const [fw, fh] = BUILDING_SPECS[b.type].footprint;
      for (let dz = 0; dz < fh; dz++) {
        for (let dx = 0; dx < fw; dx++) {
          this.blocked[(b.gz + dz) * MAP_SIZE + (b.gx + dx)] = 1;
        }
      }
    }

    const prevPos = new Map<number, { x: number; z: number }>();
    for (const [id, existing] of this.units) {
      prevPos.set(id, { x: existing.x, z: existing.z });
    }
    this.units.clear();
    for (const u of snap.units) {
      const prev = prevPos.get(u.id);
      u.prevX = prev ? prev.x : u.x;
      u.prevZ = prev ? prev.z : u.z;
      this.units.set(u.id, u);
    }

    this.projectiles.clear();
    for (const p of snap.projectiles) this.projectiles.set(p.id, p);

    this.crates.clear();
    for (const c of snap.crates) this.crates.set(c.id, c);

    this.derricks.clear();
    for (const d of snap.derricks) this.derricks.set(d.id, d);

    this.falloutZones.clear();
    for (const fz of snap.falloutZones) this.falloutZones.set(fz.id, fz);

    for (const [idx, amt] of snap.oreUpdates) {
      this.map.ore[idx] = amt;
    }

    this.updateFogOfWar();
  }

  isVisibleToPlayer(wx: number, wz: number): boolean {
    if (!this.fogEnabled) return true;
    const t = worldToTile(wx, wz);
    return this.fog[t.gz * MAP_SIZE + t.gx] === 2;
  }

  private checkWinCondition(): void {
    let alliesBuildings = 0;
    let sovietsBuildings = 0;
    for (const b of this.buildings.values()) {
      if (b.faction === 'allies') alliesBuildings++;
      else sovietsBuildings++;
    }

    if (sovietsBuildings === 0) {
      this.winner = 'allies';
      this.events.push({ type: 'game_over', winner: 'allies' });
    } else if (alliesBuildings === 0) {
      this.winner = 'soviets';
      this.events.push({ type: 'game_over', winner: 'soviets' });
    }
  }

  private emitEva(
    faction: Faction,
    code: Extract<SimEvent, { type: 'eva' }>['code'],
    text: string
  ): void {
    this.events.push({ type: 'eva', faction, code, text });
  }
}
