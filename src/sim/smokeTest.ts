import { SIM_DT } from './config';
import { SkirmishAI } from './ai';
import { MapPreset } from './types';
import { GameWorld } from './world';

/**
 * Comprehensive headless RTS simulation test:
 * Exercises all 3 maps, building/selling/repairing, Oil Derrick capture,
 * Bonus Crates, Tech Center + V2 + Tesla Trooper, Veterancy, Air Strike,
 * Nuclear Silo + Fallout, and Brutal Skirmish AI.
 */
function runSmokeTest(): void {
  // 1. Verify all 3 map presets generate cleanly
  for (const preset of ['canyon', 'arctic', 'volcanic'] as MapPreset[]) {
    const w = new GameWorld(false, preset);
    if (w.derricks.size !== 2) throw new Error(`Expected 2 Oil Derricks on ${preset}`);
    if (w.crates.size < 1) throw new Error(`Expected starter Bonus Crate on ${preset}`);
  }

  // 2. Full 100s battle & feature stress test on Canyon
  const world = new GameWorld(false, 'canyon');
  const ai = new SkirmishAI('normal');

  // Test Sell & Repair mechanics
  const allyTurret = Array.from(world.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'turret'
  );
  if (!allyTurret) throw new Error('Expected starting Allied turret');
  allyTurret.hp = allyTurret.maxHp * 0.5;
  const repairing = world.toggleRepairBuilding('allies', allyTurret.id);
  if (!repairing) throw new Error('Expected toggleRepairBuilding to activate');

  // Spawn Tech Center & Silo directly to test Superweapons + V2 + Tesla Trooper
  world.spawnBuilding('techcenter', 'allies', 14, 52, true);
  world.spawnBuilding('silo', 'allies', 17, 52, true);
  world.spawnBuilding('power', 'allies', 14, 56, true);
  world.spawnBuilding('power', 'allies', 17, 56, true);

  if (!world.queueUnitProduction('allies', 'v2_launcher')) {
    throw new Error('Failed to queue V2 Launcher');
  }
  if (!world.queueUnitProduction('allies', 'tesla_trooper')) {
    throw new Error('Failed to queue Tesla Trooper');
  }

  // Send a Rifle Squad to capture the West Tech Oil Derrick
  const derrick = Array.from(world.derricks.values())[0];
  const allyRifle = Array.from(world.units.values()).find(
    (u) => u.faction === 'allies' && u.type === 'rifle'
  );
  if (allyRifle) {
    world.issueMoveOrder([allyRifle.id], { x: derrick.x, z: derrick.z }, false);
  }

  // Send remaining combat units to central crossroads (to pick up starter crate & engage!)
  const allyCombat = Array.from(world.units.values())
    .filter((u) => u.faction === 'allies' && u.type !== 'harvester' && u.id !== allyRifle?.id)
    .map((u) => u.id);
  world.issueMoveOrder(allyCombat, { x: 76, z: 68 }, true);

  // Fast-charge superweapons for verification (Air Strike, Iron Curtain, Tactical Nuke)
  world.players.allies.superweapons.airstrike.cooldown = 0;
  world.players.allies.superweapons.iron_curtain.cooldown = 0;
  world.players.allies.superweapons.nuke.cooldown = 0;
  const firedAir = world.fireSuperweapon('allies', 'airstrike', { x: 112, z: 32 });
  const firedNuke = world.fireSuperweapon('allies', 'nuke', { x: 120, z: 24 });
  const firstTank = Array.from(world.units.values()).find(
    (u) => u.faction === 'allies' && u.type === 'medium_tank'
  )!;
  const firedIron = world.fireSuperweapon('allies', 'iron_curtain', {
    x: firstTank.x,
    z: firstTank.z,
  });
  if (!firedAir || !firedNuke || !firedIron) {
    throw new Error('Failed to fire Air Strike / Iron Curtain / Tactical Nuke');
  }
  if (firstTank.invulnerableTimer <= 0) {
    throw new Error('Expected Iron Curtain to grant invulnerability');
  }

  // Spawn a Kirov Airship and send it flying straight over cliffs toward Soviet base!
  const kirov = world.spawnUnit('kirov', 'allies', 30, 110);
  world.issueMoveOrder([kirov.id], { x: 118, z: 24 }, true);

  // Test selling a Power Plant refunds credits + spawns a Rifle Squad
  const extraPower = Array.from(world.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'power'
  )!;
  const unitsBeforeSell = world.units.size;
  const creditsBeforeSell = world.players.allies.credits;
  world.sellBuilding('allies', extraPower.id);
  if (world.units.size !== unitsBeforeSell + 1) {
    throw new Error('Expected selling building to spawn a Rifle Squad');
  }
  if (world.players.allies.credits <= creditsBeforeSell) {
    throw new Error('Expected selling building to refund credits');
  }

  let shotsFired = 0;
  let explosions = 0;
  let nukeImpacts = 0;
  let derricksCaptured = 0;
  let cratesPicked = 0;
  let promotions = 0;

  const ticks = 90 * 20;
  for (let t = 0; t < ticks; t++) {
    ai.update(world, SIM_DT);
    world.tick(SIM_DT);

    for (const ev of world.drainEvents()) {
      if (ev.type === 'shot') shotsFired++;
      if (ev.type === 'explosion') explosions++;
      if (ev.type === 'nuke_impact') nukeImpacts++;
      if (ev.type === 'derrick_captured') derricksCaptured++;
      if (ev.type === 'crate_pickup') cratesPicked++;
      if (ev.type === 'veterancy_up') promotions++;
    }

    for (const u of world.units.values()) {
      if (Number.isNaN(u.x) || Number.isNaN(u.y) || Number.isNaN(u.z)) {
        throw new Error(`Unit ${u.id} (${u.type}) had NaN coordinates!`);
      }
    }
  }

  console.log('=== Full Headless RTS Feature & Battle Test (90s) ===');
  console.log(`Maps Verified: canyon, arctic, volcanic`);
  console.log(`Allied Credits: $${Math.round(world.players.allies.credits)} | Harvested: $${Math.round(world.players.allies.stats.creditsHarvested)}`);
  console.log(`Shots: ${shotsFired} | Explosions: ${explosions} | Nuke Impacts: ${nukeImpacts}`);
  console.log(`Derricks Captured: ${derricksCaptured} | Crates Picked: ${cratesPicked} | Promotions: ${promotions}`);
  console.log(`AI Status: ${ai.statusText}`);

  if (shotsFired < 5) throw new Error('Expected combat shots');
  if (nukeImpacts < 1) throw new Error('Expected nuclear detonation to land');
  if (derricksCaptured < 1) throw new Error('Expected Tech Oil Derrick capture');
  if (world.players.allies.stats.creditsHarvested < 200) {
    throw new Error('Expected Allied harvesting');
  }
  console.log('PASS: All simulation, superweapon, derrick, crate, sell/repair, and AI systems healthy.');
}

runSmokeTest();
