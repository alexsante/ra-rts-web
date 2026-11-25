import type {
  BuildingEntity,
  CrateEntity,
  FalloutZone,
  OilDerrickEntity,
  UnitEntity,
} from '../sim/types';
import type { DeltaWorldSnapshot, SnapshotPacket, WorldSnapshot } from './protocol';

function near(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) <= eps;
}

function buildingChanged(a: BuildingEntity, b: BuildingEntity): boolean {
  if (
    a.type !== b.type ||
    a.faction !== b.faction ||
    a.gx !== b.gx ||
    a.gz !== b.gz ||
    a.powered !== b.powered ||
    a.repairing !== b.repairing ||
    a.targetId !== b.targetId
  ) {
    return true;
  }
  if (
    !near(a.hp, b.hp, 0.05) ||
    !near(a.maxHp, b.maxHp, 0.05) ||
    !near(a.turretAngle, b.turretAngle, 0.02) ||
    !near(a.buildAnim, b.buildAnim, 0.01) ||
    !near(a.flashTimer, b.flashTimer, 0.01)
  ) {
    return true;
  }
  const ar = a.rallyPoint;
  const br = b.rallyPoint;
  if ((ar === null) !== (br === null)) return true;
  if (ar && br && (!near(ar.x, br.x, 0.05) || !near(ar.z, br.z, 0.05))) return true;
  return false;
}

function unitChanged(a: UnitEntity, b: UnitEntity): boolean {
  if (
    a.type !== b.type ||
    a.faction !== b.faction ||
    a.rank !== b.rank ||
    a.kills !== b.kills ||
    a.harvesterState !== b.harvesterState ||
    a.targetId !== b.targetId
  ) {
    return true;
  }
  if (
    !near(a.x, b.x, 0.015) ||
    !near(a.z, b.z, 0.015) ||
    !near(a.y, b.y, 0.02) ||
    !near(a.angle, b.angle, 0.02) ||
    !near(a.turretAngle, b.turretAngle, 0.02) ||
    !near(a.hp, b.hp, 0.05) ||
    !near(a.maxHp, b.maxHp, 0.05) ||
    !near(a.invulnerableTimer, b.invulnerableTimer, 0.05) ||
    !near(a.blinkCooldown, b.blinkCooldown, 0.1) ||
    !near(a.recoil, b.recoil, 0.02) ||
    !near(a.flashTimer, b.flashTimer, 0.01) ||
    !near(a.animPhase, b.animPhase, 0.05) ||
    !near(a.cargo, b.cargo, 0.5)
  ) {
    return true;
  }
  return false;
}

function cratesChanged(a: CrateEntity[], b: CrateEntity[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].kind !== b[i].kind) return true;
  }
  return false;
}

function derricksChanged(a: OilDerrickEntity[], b: OilDerrickEntity[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].owner !== b[i].owner ||
      a[i].capturingFaction !== b[i].capturingFaction ||
      !near(a[i].captureProgress, b[i].captureProgress, 0.01)
    ) {
      return true;
    }
  }
  return false;
}

function falloutChanged(a: FalloutZone[], b: FalloutZone[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || !near(a[i].remaining, b[i].remaining, 0.1)) return true;
  }
  return false;
}

/**
 * Encodes sequential WorldSnapshots into full keyframes + compact delta packets.
 * Unchanged buildings, stationary units, ore tiles, crates, and derricks are omitted.
 */
export class SnapshotDeltaEncoder {
  private seq = 0;
  private lastMapPreset: string | null = null;
  private lastMapSize = 0;
  private lastBuildings = new Map<number, BuildingEntity>();
  private lastUnits = new Map<number, UnitEntity>();
  private lastOre = new Map<number, number>();
  private lastCrates: CrateEntity[] = [];
  private lastDerricks: OilDerrickEntity[] = [];
  private lastFallout: FalloutZone[] = [];

  reset(): void {
    this.lastMapPreset = null;
    this.lastMapSize = 0;
    this.lastBuildings.clear();
    this.lastUnits.clear();
    this.lastOre.clear();
    this.lastCrates = [];
    this.lastDerricks = [];
    this.lastFallout = [];
  }

  encode(snap: WorldSnapshot, forceFull = false): SnapshotPacket {
    const prevSeq = this.seq;
    this.seq++;

    const sendFull =
      forceFull ||
      this.lastMapPreset === null ||
      this.lastMapPreset !== snap.mapPreset ||
      this.lastMapSize !== snap.mapSize;

    if (sendFull) {
      this.storeBaseline(snap);
      return { seq: this.seq, full: snap };
    }

    // Diff buildings
    const buildingsUpsert: BuildingEntity[] = [];
    const seenBuildings = new Set<number>();
    for (const b of snap.buildings) {
      seenBuildings.add(b.id);
      const prev = this.lastBuildings.get(b.id);
      if (!prev || buildingChanged(prev, b)) {
        buildingsUpsert.push(b);
      }
    }
    const buildingsRemoved: number[] = [];
    for (const id of this.lastBuildings.keys()) {
      if (!seenBuildings.has(id)) buildingsRemoved.push(id);
    }

    // Diff units
    const unitsUpsert: UnitEntity[] = [];
    const seenUnits = new Set<number>();
    for (const u of snap.units) {
      seenUnits.add(u.id);
      const prev = this.lastUnits.get(u.id);
      if (!prev || unitChanged(prev, u)) {
        unitsUpsert.push(u);
      }
    }
    const unitsRemoved: number[] = [];
    for (const id of this.lastUnits.keys()) {
      if (!seenUnits.has(id)) unitsRemoved.push(id);
    }

    // Diff ore tiles
    const oreDelta: Array<[number, number]> = [];
    for (const [idx, amt] of snap.oreUpdates) {
      if (this.lastOre.get(idx) !== amt) {
        oreDelta.push([idx, amt]);
      }
    }

    const delta: DeltaWorldSnapshot = {
      baseSeq: prevSeq,
      simTime: snap.simTime,
      tickCount: snap.tickCount,
      winner: snap.winner,
      players: snap.players,
      buildingsUpsert,
      buildingsRemoved,
      unitsUpsert,
      unitsRemoved,
      projectiles: snap.projectiles,
      oreDelta,
      events: snap.events,
    };

    if (cratesChanged(this.lastCrates, snap.crates)) {
      delta.crates = snap.crates;
    }
    if (derricksChanged(this.lastDerricks, snap.derricks)) {
      delta.derricks = snap.derricks;
    }
    if (falloutChanged(this.lastFallout, snap.falloutZones)) {
      delta.falloutZones = snap.falloutZones;
    }

    this.storeBaseline(snap);
    return { seq: this.seq, delta };
  }

  private storeBaseline(snap: WorldSnapshot): void {
    this.lastMapPreset = snap.mapPreset;
    this.lastMapSize = snap.mapSize;
    this.lastBuildings.clear();
    for (const b of snap.buildings) {
      this.lastBuildings.set(b.id, {
        ...b,
        rallyPoint: b.rallyPoint ? { ...b.rallyPoint } : null,
      });
    }
    this.lastUnits.clear();
    for (const u of snap.units) {
      this.lastUnits.set(u.id, { ...u });
    }
    this.lastOre.clear();
    for (const [idx, amt] of snap.oreUpdates) {
      this.lastOre.set(idx, amt);
    }
    this.lastCrates = snap.crates.map((c) => ({ ...c }));
    this.lastDerricks = snap.derricks.map((d) => ({ ...d }));
    this.lastFallout = snap.falloutZones.map((f) => ({ ...f }));
  }
}

/**
 * Reconstructs full WorldSnapshots on the Guest from full keyframes + delta packets.
 * Signals `needsResync: true` if a packet arrives out of sequence or without a baseline.
 */
export class SnapshotDeltaDecoder {
  private lastSeq = 0;
  private mapPreset: WorldSnapshot['mapPreset'] | null = null;
  private mapSize = 72;
  private buildings = new Map<number, BuildingEntity>();
  private units = new Map<number, UnitEntity>();
  private ore = new Map<number, number>();
  private crates: CrateEntity[] = [];
  private derricks: OilDerrickEntity[] = [];
  private falloutZones: FalloutZone[] = [];

  reset(): void {
    this.lastSeq = 0;
    this.mapPreset = null;
    this.mapSize = 72;
    this.buildings.clear();
    this.units.clear();
    this.ore.clear();
    this.crates = [];
    this.derricks = [];
    this.falloutZones = [];
  }

  decode(packet: SnapshotPacket): { snapshot: WorldSnapshot | null; needsResync: boolean } {
    if (packet.full) {
      const full = packet.full;
      this.lastSeq = packet.seq;
      this.mapPreset = full.mapPreset;
      this.mapSize = full.mapSize;
      this.buildings.clear();
      for (const b of full.buildings) this.buildings.set(b.id, b);
      this.units.clear();
      for (const u of full.units) this.units.set(u.id, u);
      this.ore.clear();
      for (const [idx, amt] of full.oreUpdates) this.ore.set(idx, amt);
      this.crates = full.crates;
      this.derricks = full.derricks;
      this.falloutZones = full.falloutZones;
      return { snapshot: full, needsResync: false };
    }

    const delta = packet.delta;
    if (!delta || !this.mapPreset || delta.baseSeq !== this.lastSeq) {
      return { snapshot: null, needsResync: true };
    }

    this.lastSeq = packet.seq;

    for (const id of delta.buildingsRemoved) this.buildings.delete(id);
    for (const b of delta.buildingsUpsert) this.buildings.set(b.id, b);

    for (const id of delta.unitsRemoved) this.units.delete(id);
    for (const u of delta.unitsUpsert) this.units.set(u.id, u);

    for (const [idx, amt] of delta.oreDelta) this.ore.set(idx, amt);

    if (delta.crates !== undefined) this.crates = delta.crates;
    if (delta.derricks !== undefined) this.derricks = delta.derricks;
    if (delta.falloutZones !== undefined) this.falloutZones = delta.falloutZones;

    const snapshot: WorldSnapshot = {
      mapPreset: this.mapPreset,
      mapSize: this.mapSize,
      simTime: delta.simTime,
      tickCount: delta.tickCount,
      winner: delta.winner,
      players: delta.players,
      buildings: Array.from(this.buildings.values()).map((b) => ({ ...b })),
      units: Array.from(this.units.values()).map((u) => ({ ...u })),
      projectiles: delta.projectiles,
      crates: this.crates.map((c) => ({ ...c })),
      derricks: this.derricks.map((d) => ({ ...d })),
      falloutZones: this.falloutZones.map((f) => ({ ...f })),
      oreUpdates: delta.oreDelta,
      events: delta.events,
    };

    return { snapshot, needsResync: false };
  }
}
