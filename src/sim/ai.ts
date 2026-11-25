import { BUILDING_SPECS, MAP_SIZE, tileToWorld } from './config';
import { AIDifficulty, BuildingType, UnitType, Vec2 } from './types';
import { GameWorld } from './world';

/**
 * Escalating Soviet Skirmish AI supporting Easy / Normal / Brutal difficulties.
 * Captures Oil Derricks, repairs damaged structures, builds Tech Center + V2s +
 * Tesla Troopers + Mammoth Tanks, flanks across lanes, and deploys Superweapons.
 */
export class SkirmishAI {
  private decisionTimer = 2.0;
  private waveTimer = 28;
  private objectiveTimer = 14;
  private waveNumber = 0;
  difficulty: AIDifficulty;
  statusText = 'SOVIET COMMAND // STAGING';

  constructor(difficulty: AIDifficulty = 'normal') {
    this.difficulty = difficulty;
    this.waveTimer = difficulty === 'easy' ? 40 : difficulty === 'brutal' ? 20 : 28;
  }

  update(world: GameWorld, dt: number): void {
    if (world.winner) return;

    // Brutal AI gets a subtle logistics income boost to keep late-game pressure high
    if (this.difficulty === 'brutal') {
      world.players.soviets.credits += 18 * dt;
    }

    this.decisionTimer -= dt;
    this.waveTimer -= dt;
    this.objectiveTimer -= dt;

    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.difficulty === 'easy' ? 2.4 : this.difficulty === 'brutal' ? 1.1 : 1.5;
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
    const p = world.players.soviets;

    // Repair damaged high-value Soviet structures
    if (this.difficulty !== 'easy' && p.credits > 600) {
      for (const b of world.buildings.values()) {
        if (b.faction === 'soviets' && b.hp < b.maxHp * 0.72 && !b.repairing) {
          world.toggleRepairBuilding('soviets', b.id);
        }
      }
    }

    // 1. Place ready building
    if (p.buildingProd?.ready) {
      const bType = p.buildingProd.type as BuildingType;
      const spot = this.findBaseBuildSpot(world, bType);
      if (spot) {
        world.placeReadyBuilding('soviets', spot.gx, spot.gz);
      } else {
        world.cancelBuildingProduction('soviets');
      }
    }

    // 2. Base build order including Tech Center & Nuclear Silo
    if (!p.buildingProd && world.hasPrerequisites('soviets', ['conyard'])) {
      const counts = this.countBuildings(world);
      if (p.powerProduced < p.powerConsumed + 45 && p.credits >= 300) {
        world.startBuildingProduction('soviets', 'power');
      } else if (counts.refinery < 1 && p.credits >= 1000) {
        world.startBuildingProduction('soviets', 'refinery');
      } else if (counts.barracks < 1 && p.credits >= 500) {
        world.startBuildingProduction('soviets', 'barracks');
      } else if (counts.warfactory < 1 && p.credits >= 1200) {
        world.startBuildingProduction('soviets', 'warfactory');
      } else if (counts.techcenter < 1 && p.credits >= 1700 && this.waveNumber >= 1) {
        world.startBuildingProduction('soviets', 'techcenter');
      } else if (
        this.difficulty !== 'easy' &&
        counts.techcenter >= 1 &&
        counts.silo < 1 &&
        p.credits >= 2700 &&
        p.powerProduced >= p.powerConsumed + 100
      ) {
        world.startBuildingProduction('soviets', 'silo');
      } else if (counts.turret + counts.tesla < (this.difficulty === 'brutal' ? 5 : 3) && p.credits >= 1350) {
        const defType: BuildingType =
          counts.tesla < 2 && p.powerProduced >= p.powerConsumed + 80 ? 'tesla' : 'turret';
        world.startBuildingProduction('soviets', defType);
      }
    }

    // 3. Unit production
    if (!p.unitProd && p.credits >= 220) {
      const unitCounts = this.countUnits(world);
      const totalCombat =
        unitCounts.rifle +
        unitCounts.rocket +
        unitCounts.tesla_trooper +
        unitCounts.medium_tank +
        unitCounts.v2_launcher +
        unitCounts.mammoth_tank;

      const cap = this.difficulty === 'easy' ? 12 : this.difficulty === 'brutal' ? 24 : 18;
      if (unitCounts.harvester < 2 && world.hasPrerequisites('soviets', ['warfactory', 'refinery'])) {
        world.queueUnitProduction('soviets', 'harvester');
        return;
      }
      if (totalCombat >= cap) return;

      const pick = this.chooseNextUnit(world, unitCounts);
      if (pick) world.queueUnitProduction('soviets', pick);
    }
  }

  private chooseNextUnit(world: GameWorld, counts: Record<UnitType, number>): UnitType | null {
    const canWar = world.hasPrerequisites('soviets', ['warfactory']);
    const canTech = world.hasPrerequisites('soviets', ['warfactory', 'techcenter']);
    const canBarracks = world.hasPrerequisites('soviets', ['barracks']);
    const canTeslaTroop = world.hasPrerequisites('soviets', ['barracks', 'techcenter']);
    const credits = world.players.soviets.credits;

    if (canTech && counts.kirov < 1 && this.waveNumber >= 3 && credits >= 1750) {
      return 'kirov';
    }
    if (canTech && counts.mammoth_tank < (this.difficulty === 'brutal' ? 3 : 2) && credits >= 1450) {
      return 'mammoth_tank';
    }
    if (canTech && counts.v2_launcher < 2 && credits >= 950) {
      return 'v2_launcher';
    }
    if (canTeslaTroop && counts.tesla_trooper < 2 && credits >= 550) {
      return 'tesla_trooper';
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
    if (this.difficulty === 'easy') return;
    const p = world.players.soviets;
    const allyBuildings = Array.from(world.buildings.values()).filter((b) => b.faction === 'allies');
    if (allyBuildings.length === 0) return;

    // Pick high-value target cluster
    const target =
      allyBuildings.find((b) => b.type === 'warfactory' || b.type === 'refinery') ?? allyBuildings[0];

    if (p.superweapons.airstrike.unlocked && p.superweapons.airstrike.cooldown <= 0) {
      world.fireSuperweapon('soviets', 'airstrike', { x: target.x, z: target.z });
    } else if (
      this.difficulty === 'brutal' &&
      p.superweapons.nuke.unlocked &&
      p.superweapons.nuke.cooldown <= 0 &&
      p.powerRatio >= 1
    ) {
      world.fireSuperweapon('soviets', 'nuke', { x: target.x, z: target.z });
    }
  }

  private contestObjectives(world: GameWorld): void {
    // Send a small idle squad to capture unowned Oil Derricks or nearby crates
    const idleScout: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction === 'soviets' && (u.type === 'rifle' || u.type === 'medium_tank') && u.order.type === 'idle') {
        idleScout.push(u.id);
        if (idleScout.length >= 2) break;
      }
    }
    if (idleScout.length === 0) return;

    for (const d of world.derricks.values()) {
      if (d.owner !== 'soviets') {
        world.issueMoveOrder(idleScout, { x: d.x, z: d.z }, true);
        return;
      }
    }
  }

  private defendBaseIfThreatened(world: GameWorld): void {
    const baseCenter = tileToWorld(world.map.sovietsStart.gx, world.map.sovietsStart.gz);
    let threat: Vec2 | null = null;

    for (const u of world.units.values()) {
      if (u.faction !== 'allies') continue;
      if (Math.hypot(u.x - baseCenter.x, u.z - baseCenter.z) < 34) {
        threat = { x: u.x, z: u.z };
        break;
      }
    }
    if (!threat) return;

    const defenders: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction === 'soviets' && u.type !== 'harvester') {
        if (Math.hypot(u.x - baseCenter.x, u.z - baseCenter.z) < 46) {
          defenders.push(u.id);
        }
      }
    }
    if (defenders.length > 0) {
      world.issueMoveOrder(defenders, threat, true);
      this.statusText = 'SOVIET COMMAND // DEFENDING BASE';
    }
  }

  private launchAttackWave(world: GameWorld): void {
    const idleCombat: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction === 'soviets' && u.type !== 'harvester' && u.order.type === 'idle') {
        idleCombat.push(u.id);
      }
    }

    const baseMin = this.difficulty === 'easy' ? 4 : this.difficulty === 'brutal' ? 3 : 3;
    const minSquad = Math.min(9, baseMin + this.waveNumber);
    if (idleCombat.length < minSquad) {
      this.waveTimer = 8;
      return;
    }

    const targets = Array.from(world.buildings.values()).filter((b) => b.faction === 'allies');
    if (targets.length === 0) return;

    targets.sort((a, b) => (a.type === 'conyard' ? 2 : 1) - (b.type === 'conyard' ? 2 : 1));
    const target = targets[this.waveNumber % targets.length];

    this.waveNumber++;
    const baseInterval = this.difficulty === 'easy' ? 46 : this.difficulty === 'brutal' ? 25 : 36;
    this.waveTimer = Math.max(20, baseInterval - this.waveNumber * 2);

    const sendIds = idleCombat.slice(0, Math.max(minSquad, Math.ceil(idleCombat.length * 0.85)));
    world.issueMoveOrder(sendIds, { x: target.x, z: target.z }, true);
    this.statusText = `SOVIET WAVE #${this.waveNumber} // INBOUND (${sendIds.length} UNITS)`;
  }

  private findBaseBuildSpot(world: GameWorld, type: BuildingType): { gx: number; gz: number } | null {
    const cx = world.map.sovietsStart.gx;
    const cz = world.map.sovietsStart.gz;
    const isDefense = !!BUILDING_SPECS[type].weapon;

    let best: { gx: number; gz: number } | null = null;
    let bestScore = Infinity;

    for (let dz = -11; dz <= 11; dz++) {
      for (let dx = -11; dx <= 11; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 2 || gz < 2 || gx >= MAP_SIZE - 4 || gz >= MAP_SIZE - 4) continue;
        if (!world.canPlaceBuilding('soviets', type, gx, gz)) continue;

        const dist = Math.hypot(dx, dz);
        const frontBias = isDefense ? (dx - dz) * 1.4 : 0;
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
      tesla: 0,
      techcenter: 0,
      silo: 0,
    };
    for (const b of world.buildings.values()) {
      if (b.faction === 'soviets') c[b.type]++;
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
      v2_launcher: 0,
      mammoth_tank: 0,
      kirov: 0,
    };
    for (const u of world.units.values()) {
      if (u.faction === 'soviets') c[u.type]++;
    }
    return c;
  }
}
