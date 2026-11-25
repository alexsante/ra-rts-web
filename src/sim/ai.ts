import { BUILDING_SPECS, tileToWorld } from './config';
import { AIDifficulty, BuildingType, Faction, UnitType, Vec2 } from './types';
import { GameWorld } from './world';

/**
 * Faction-aware Skirmish AI capable of commanding EITHER Allies or Soviets
 * across Easy / Normal / Brutal difficulties.
 */
export class SkirmishAI {
  private decisionTimer = 2.0;
  private waveTimer = 28;
  private objectiveTimer = 14;
  private waveNumber = 0;
  difficulty: AIDifficulty;
  readonly faction: Faction;
  statusText: string;

  constructor(difficulty: AIDifficulty = 'normal', faction: Faction = 'soviets') {
    this.difficulty = difficulty;
    this.faction = faction;
    this.waveTimer = difficulty === 'easy' ? 40 : difficulty === 'brutal' ? 20 : 28;
    this.statusText = `${faction === 'allies' ? 'ALLIED' : 'SOVIET'} AI // STAGING`;
  }

  private get enemyFaction(): Faction {
    return this.faction === 'allies' ? 'soviets' : 'allies';
  }

  update(world: GameWorld, dt: number): void {
    if (world.winner) return;

    if (this.difficulty === 'brutal') {
      world.players[this.faction].credits += 18 * dt;
    }

    this.decisionTimer -= dt;
    this.waveTimer -= dt;
    this.objectiveTimer -= dt;

    if (this.decisionTimer <= 0) {
      this.decisionTimer =
        this.difficulty === 'easy' ? 2.4 : this.difficulty === 'brutal' ? 1.1 : 1.5;
      this.manageEconomyAndProduction(world);
      this.defendBaseIfThreatened(world);
      this.useSuperweapons(world);
    }

    if (this.objectiveTimer <= 0) {
      this.objectiveTimer = 18;
      this.contestObjectives(world);
    }

    if (this.waveTimer <= 0) {
      this.launchAttackWave(world);
    }
  }

  private manageEconomyAndProduction(world: GameWorld): void {
    const f = this.faction;
    const p = world.players[f];

    if (this.difficulty !== 'easy' && p.credits > 600) {
      for (const b of world.buildings.values()) {
        if (b.faction === f && b.hp < b.maxHp * 0.72 && !b.repairing) {
          world.toggleRepairBuilding(f, b.id);
        }
      }
    }

    if (p.buildingProd?.ready) {
      const bType = p.buildingProd.type as BuildingType;
      const spot = this.findBaseBuildSpot(world, bType);
      if (spot) world.placeReadyBuilding(f, spot.gx, spot.gz);
      else world.cancelBuildingProduction(f);
    }

    const eliteDef: BuildingType = f === 'allies' ? 'prism' : 'tesla';
    const superBuilding: BuildingType = f === 'allies' ? 'chronosphere' : 'silo';

    if (!p.buildingProd && world.hasPrerequisites(f, ['conyard'])) {
      const counts = this.countBuildings(world);
      if (p.powerProduced < p.powerConsumed + 45 && p.credits >= 300) {
        world.startBuildingProduction(f, 'power');
      } else if (counts.refinery < 1 && p.credits >= 1000) {
        world.startBuildingProduction(f, 'refinery');
      } else if (counts.barracks < 1 && p.credits >= 500) {
        world.startBuildingProduction(f, 'barracks');
      } else if (counts.warfactory < 1 && p.credits >= 1200) {
        world.startBuildingProduction(f, 'warfactory');
      } else if (counts.techcenter < 1 && p.credits >= 1700 && this.waveNumber >= 1) {
        world.startBuildingProduction(f, 'techcenter');
      } else if (
        this.difficulty !== 'easy' &&
        world.config.superweaponsEnabled &&
        counts.techcenter >= 1 &&
        counts[superBuilding] < 1 &&
        p.credits >= 2600 &&
        p.powerProduced >= p.powerConsumed + 100
      ) {
        world.startBuildingProduction(f, superBuilding);
      } else if (
        counts.turret + counts[eliteDef] < (this.difficulty === 'brutal' ? 5 : 3) &&
        p.credits >= 1350
      ) {
        const defType: BuildingType =
          counts[eliteDef] < 2 && p.powerProduced >= p.powerConsumed + 80 ? eliteDef : 'turret';
        world.startBuildingProduction(f, defType);
      }
    }

    if (!p.unitProd && p.credits >= 220) {
      const unitCounts = this.countUnits(world);
      const totalCombat =
        unitCounts.rifle +
        unitCounts.rocket +
        unitCounts.tesla_trooper +
        unitCounts.medium_tank +
        unitCounts.prism_tank +
        unitCounts.chrono_tank +
        unitCounts.v2_launcher +
        unitCounts.mammoth_tank +
        unitCounts.kirov;

      const cap = this.difficulty === 'easy' ? 12 : this.difficulty === 'brutal' ? 24 : 18;
      if (unitCounts.harvester < 2 && world.hasPrerequisites(f, ['warfactory', 'refinery'])) {
        world.queueUnitProduction(f, 'harvester');
        return;
      }
      if (totalCombat >= cap) return;

      const pick = this.chooseNextUnit(world, unitCounts);
      if (pick) world.queueUnitProduction(f, pick);
    }
  }

  private chooseNextUnit(world: GameWorld, counts: Record<UnitType, number>): UnitType | null {
    const f = this.faction;
    const canWar = world.hasPrerequisites(f, ['warfactory']);
    const canTech = world.hasPrerequisites(f, ['warfactory', 'techcenter']);
    const canBarracks = world.hasPrerequisites(f, ['barracks']);
    const credits = world.players[f].credits;

    if (f === 'allies') {
      if (canTech && counts.prism_tank < (this.difficulty === 'brutal' ? 3 : 2) && credits >= 1250) {
        return 'prism_tank';
      }
      if (canTech && counts.chrono_tank < 2 && credits >= 1350) {
        return 'chrono_tank';
      }
    } else {
      if (canTech && counts.kirov < 1 && this.waveNumber >= 3 && credits >= 1750) {
        return 'kirov';
      }
      if (canTech && counts.mammoth_tank < (this.difficulty === 'brutal' ? 3 : 2) && credits >= 1450) {
        return 'mammoth_tank';
      }
      if (canTech && counts.v2_launcher < 2 && credits >= 950) {
        return 'v2_launcher';
      }
      if (canBarracks && world.hasPrerequisites(f, ['techcenter']) && counts.tesla_trooper < 2 && credits >= 550) {
        return 'tesla_trooper';
      }
    }

    if (canWar && counts.medium_tank < 4 + Math.min(3, this.waveNumber) && credits >= 650) {
      return 'medium_tank';
    }
    if (canBarracks && counts.rocket < 3 && credits >= 300) {
      return 'rocket';
    }
    if (canBarracks && counts.rifle < 4) {
      return 'rifle';
    }
    if (canWar) return 'medium_tank';
    if (canBarracks) return 'rifle';
    return null;
  }

  private useSuperweapons(world: GameWorld): void {
    if (this.difficulty === 'easy' || !world.config.superweaponsEnabled) return;
    const f = this.faction;
    const p = world.players[f];
    const enemyBuildings = Array.from(world.buildings.values()).filter(
      (b) => b.faction === this.enemyFaction
    );
    if (enemyBuildings.length === 0) return;

    const target =
      enemyBuildings.find((b) => b.type === 'warfactory' || b.type === 'refinery') ??
      enemyBuildings[0];

    if (f === 'allies') {
      if (p.superweapons.airstrike.unlocked && p.superweapons.airstrike.cooldown <= 0) {
        world.fireSuperweapon(f, 'airstrike', { x: target.x, z: target.z });
      }
    } else {
      if (
        this.difficulty === 'brutal' &&
        p.superweapons.nuke.unlocked &&
        p.superweapons.nuke.cooldown <= 0 &&
        p.powerRatio >= 1
      ) {
        world.fireSuperweapon(f, 'nuke', { x: target.x, z: target.z });
      }
    }
  }

  private contestObjectives(world: GameWorld): void {
    const idleScout: number[] = [];
    for (const u of world.units.values()) {
      if (
        u.faction === this.faction &&
        (u.type === 'rifle' || u.type === 'medium_tank') &&
        u.order.type === 'idle'
      ) {
        idleScout.push(u.id);
        if (idleScout.length >= 2) break;
      }
    }
    if (idleScout.length === 0) return;

    for (const d of world.derricks.values()) {
      if (d.owner !== this.faction) {
        world.issueMoveOrder(idleScout, { x: d.x, z: d.z }, true);
        return;
      }
    }
  }

  private defendBaseIfThreatened(world: GameWorld): void {
    const start = this.faction === 'allies' ? world.map.alliesStart : world.map.sovietsStart;
    const baseCenter = tileToWorld(start.gx, start.gz);
    let threat: Vec2 | null = null;

    for (const u of world.units.values()) {
      if (u.faction !== this.enemyFaction) continue;
      if (Math.hypot(u.x - baseCenter.x, u.z - baseCenter.z) < 34) {
        threat = { x: u.x, z: u.z };
        break;
      }
    }
    if (!threat) return;

    const defenders: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction === this.faction && u.type !== 'harvester') {
        if (Math.hypot(u.x - baseCenter.x, u.z - baseCenter.z) < 46) {
          defenders.push(u.id);
        }
      }
    }
    if (defenders.length > 0) {
      world.issueMoveOrder(defenders, threat, true);
      this.statusText = `${this.faction === 'allies' ? 'ALLIED' : 'SOVIET'} AI // DEFENDING BASE`;
    }
  }

  private launchAttackWave(world: GameWorld): void {
    const idleCombat: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction === this.faction && u.type !== 'harvester' && u.order.type === 'idle') {
        idleCombat.push(u.id);
      }
    }

    const baseMin = this.difficulty === 'easy' ? 4 : 3;
    const minSquad = Math.min(9, baseMin + this.waveNumber);
    if (idleCombat.length < minSquad) {
      this.waveTimer = 8;
      return;
    }

    const targets = Array.from(world.buildings.values()).filter(
      (b) => b.faction === this.enemyFaction
    );
    if (targets.length === 0) return;

    targets.sort((a, b) => (a.type === 'conyard' ? 2 : 1) - (b.type === 'conyard' ? 2 : 1));
    const target = targets[this.waveNumber % targets.length];

    this.waveNumber++;
    const baseInterval = this.difficulty === 'easy' ? 46 : this.difficulty === 'brutal' ? 25 : 36;
    this.waveTimer = Math.max(20, baseInterval - this.waveNumber * 2);

    const sendIds = idleCombat.slice(0, Math.max(minSquad, Math.ceil(idleCombat.length * 0.85)));
    world.issueMoveOrder(sendIds, { x: target.x, z: target.z }, true);
    this.statusText = `${this.faction === 'allies' ? 'ALLIED' : 'SOVIET'} WAVE #${this.waveNumber} // INBOUND (${sendIds.length})`;
  }

  private findBaseBuildSpot(world: GameWorld, type: BuildingType): { gx: number; gz: number } | null {
    const start = this.faction === 'allies' ? world.map.alliesStart : world.map.sovietsStart;
    const cx = start.gx;
    const cz = start.gz;
    const isDefense = !!BUILDING_SPECS[type].weapon;
    const dir = this.faction === 'allies' ? 1 : -1;

    let best: { gx: number; gz: number } | null = null;
    let bestScore = Infinity;

    const mapSize = world.map.size;
    for (let dz = -11; dz <= 11; dz++) {
      for (let dx = -11; dx <= 11; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 2 || gz < 2 || gx >= mapSize - 4 || gz >= mapSize - 4) continue;
        if (!world.canPlaceBuilding(this.faction, type, gx, gz)) continue;

        const dist = Math.hypot(dx, dz);
        const frontBias = isDefense ? (-dx * dir + dz * dir) * 1.4 : 0;
        const score = dist + frontBias;
        if (score < bestScore) {
          bestScore = score;
          best = { gx, gz };
        }
      }
    }
    return best;
  }

  private countBuildings(world: GameWorld): Record<BuildingType, number> {
    const c: Record<BuildingType, number> = {
      conyard: 0,
      power: 0,
      refinery: 0,
      barracks: 0,
      warfactory: 0,
      turret: 0,
      prism: 0,
      tesla: 0,
      techcenter: 0,
      chronosphere: 0,
      silo: 0,
    };
    for (const b of world.buildings.values()) {
      if (b.faction === this.faction) c[b.type]++;
    }
    return c;
  }

  private countUnits(world: GameWorld): Record<UnitType, number> {
    const c: Record<UnitType, number> = {
      rifle: 0,
      rocket: 0,
      tesla_trooper: 0,
      harvester: 0,
      medium_tank: 0,
      prism_tank: 0,
      chrono_tank: 0,
      v2_launcher: 0,
      mammoth_tank: 0,
      kirov: 0,
    };
    for (const u of world.units.values()) {
      if (u.faction === this.faction) c[u.type]++;
    }
    return c;
  }
}
