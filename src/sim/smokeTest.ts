import { SkirmishAI } from './ai';
import { SIM_DT, getBuildingsForFaction, getUnitsForFaction } from './config';
import { ReplayPlayer, ReplayRecorder, parseReplayJson } from './replay';
import { DEFAULT_MATCH_CONFIG, type MapPreset, type MatchConfig } from './types';
import { GameWorld } from './world';

/**
 * Comprehensive headless RTS simulation test:
 * Exercises all 3 maps, asymmetric Allies vs Soviets tech trees, Prism laser chain-bounces,
 * Chrono Tank Phase-Blink, 2-point Chronoshift teleport, Soviet Iron Curtain + Kirov + Nuke,
 * Oil Derricks, Crates, Sell/Repair, Allied & Soviet AI, and 100% deterministic Match Replays.
 */
function runSmokeTest(): void {
  // 1. Verify all 3 map presets generate cleanly
  for (const preset of ['canyon', 'arctic', 'volcanic'] as MapPreset[]) {
    const w = new GameWorld({ mapPreset: preset, cratesEnabled: true });
    if (w.derricks.size !== 2) throw new Error(`Expected 2 Oil Derricks on ${preset}`);
    if (w.crates.size < 1) throw new Error(`Expected starter Bonus Crate on ${preset}`);
  }

  // 2. Verify strict Asymmetric Faction Gating
  const allyBuildings = getBuildingsForFaction('allies');
  const sovBuildings = getBuildingsForFaction('soviets');
  const allyUnits = getUnitsForFaction('allies');
  const sovUnits = getUnitsForFaction('soviets');

  if (!allyBuildings.includes('prism') || !allyBuildings.includes('chronosphere')) {
    throw new Error('Allies missing Prism Tower or Chronosphere');
  }
  if (allyBuildings.includes('tesla') || allyBuildings.includes('silo')) {
    throw new Error('Allies should not have Soviet Tesla Coil or Silo');
  }
  if (!sovBuildings.includes('tesla') || !sovBuildings.includes('silo')) {
    throw new Error('Soviets missing Tesla Coil or Nuclear Silo');
  }
  if (sovBuildings.includes('prism') || sovBuildings.includes('chronosphere')) {
    throw new Error('Soviets should not have Allied Prism Tower or Chronosphere');
  }
  if (!allyUnits.includes('prism_tank') || !allyUnits.includes('chrono_tank')) {
    throw new Error('Allies missing Prism Tank or Chrono Tank');
  }
  if (allyUnits.includes('mammoth_tank') || allyUnits.includes('kirov')) {
    throw new Error('Allies should not have Mammoth Tank or Kirov');
  }
  if (!sovUnits.includes('mammoth_tank') || !sovUnits.includes('kirov')) {
    throw new Error('Soviets missing Mammoth Tank or Kirov');
  }
  if (sovUnits.includes('prism_tank') || sovUnits.includes('chrono_tank')) {
    throw new Error('Soviets should not have Prism Tank or Chrono Tank');
  }

  // 3. Asymmetric Battle & Feature Stress Test (90s)
  const world = new GameWorld({
    ...DEFAULT_MATCH_CONFIG,
    mapPreset: 'canyon',
    hostFaction: 'allies',
    startingCredits: 6000,
    seed: 4242,
  });
  const ai = new SkirmishAI('normal', 'soviets');

  // Verify faction build enforcement in GameWorld
  if (world.startBuildingProduction('allies', 'tesla')) {
    throw new Error('Allies must be blocked from building Soviet Tesla Coil');
  }
  if (world.startBuildingProduction('soviets', 'prism')) {
    throw new Error('Soviets must be blocked from building Allied Prism Tower');
  }

  // Test Sell & Repair mechanics
  const allyTurret = Array.from(world.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'turret'
  );
  if (!allyTurret) throw new Error('Expected starting Allied turret');
  allyTurret.hp = allyTurret.maxHp * 0.5;
  if (!world.toggleRepairBuilding('allies', allyTurret.id)) {
    throw new Error('Expected toggleRepairBuilding to activate');
  }

  // Build Allied & Soviet high-tech structures directly to test both full arsenals
  world.spawnBuilding('techcenter', 'allies', 14, 52, true);
  world.spawnBuilding('chronosphere', 'allies', 17, 52, true);
  world.spawnBuilding('prism', 'allies', 26, 48, true);
  world.spawnBuilding('power', 'allies', 14, 56, true);
  world.spawnBuilding('power', 'allies', 17, 56, true);
  world.spawnBuilding('power', 'allies', 20, 56, true);

  world.spawnBuilding('techcenter', 'soviets', 46, 16, true);
  world.spawnBuilding('silo', 'soviets', 43, 16, true);
  world.spawnBuilding('power', 'soviets', 46, 20, true);
  world.spawnBuilding('power', 'soviets', 43, 20, true);
  world.spawnBuilding('power', 'soviets', 40, 20, true);

  if (!world.queueUnitProduction('allies', 'prism_tank')) {
    throw new Error('Allies failed to queue Prism Tank');
  }
  if (!world.queueUnitProduction('allies', 'chrono_tank')) {
    throw new Error('Allies failed to queue Chrono Tank');
  }
  if (world.queueUnitProduction('allies', 'mammoth_tank')) {
    throw new Error('Allies should not be able to queue Soviet Mammoth Tank');
  }
  if (!world.queueUnitProduction('soviets', 'v2_launcher')) {
    throw new Error('Soviets failed to queue V2 Launcher');
  }
  if (!world.queueUnitProduction('soviets', 'tesla_trooper')) {
    throw new Error('Soviets failed to queue Tesla Trooper');
  }

  // Test Chrono Tank Phase-Blink!
  const chronoTank = world.spawnUnit('chrono_tank', 'allies', 30, 110);
  const startX = chronoTank.x;
  const startZ = chronoTank.z;
  world.issueMoveOrder([chronoTank.id], { x: 76, z: 68 }, true);
  const blinkDist = Math.hypot(chronoTank.x - startX, chronoTank.z - startZ);
  if (blinkDist < 12 || chronoTank.blinkCooldown <= 0) {
    throw new Error(`Expected Chrono Tank to Phase-Blink on >14 move (jumped ${blinkDist.toFixed(1)})`);
  }

  // Test Prism Tank Chain-Bounce laser in an isolated lane!
  const prismTank = world.spawnUnit('prism_tank', 'allies', 54, 92);
  const targetA = world.spawnUnit('rifle', 'soviets', 60, 92);
  const targetB = world.spawnUnit('rifle', 'soviets', 62.5, 92);
  const hpBeforeB = targetB.hp;
  world.issueAttackOrder([prismTank.id], targetA.id);
  let sawPrismBounce = false;
  for (let i = 0; i < 40; i++) {
    world.tick(SIM_DT);
    for (const ev of world.drainEvents()) {
      if (ev.type === 'shot' && ev.damageType === 'prism' && ev.bounceTo) {
        sawPrismBounce = true;
      }
    }
    if (sawPrismBounce) break;
  }
  if (!sawPrismBounce || targetB.hp >= hpBeforeB) {
    throw new Error('Expected Prism Tank laser to chain-bounce and damage secondary enemy!');
  }

  // Test 2-Point Allied Chronoshift Superweapon!
  world.players.allies.superweapons.chronoshift.cooldown = 0;
  world.players.allies.superweapons.airstrike.cooldown = 0;
  const warpUnit = world.spawnUnit('medium_tank', 'allies', 32, 108);
  const firedChrono = world.fireSuperweapon(
    'allies',
    'chronoshift',
    { x: 76, z: 72 },
    { x: warpUnit.x, z: warpUnit.z }
  );
  if (!firedChrono) throw new Error('Failed to fire Allied Chronoshift');
  if (Math.hypot(warpUnit.x - 76, warpUnit.z - 72) > 5) {
    throw new Error('Chronoshift did not teleport friendly unit to destination!');
  }
  const firedAir = world.fireSuperweapon('allies', 'airstrike', { x: 112, z: 32 });
  if (!firedAir) throw new Error('Failed to fire Allied A-10 Air Strike');

  // Test Soviet Superweapons (Iron Curtain + Tactical Nuke)
  world.players.soviets.superweapons.iron_curtain.cooldown = 0;
  world.players.soviets.superweapons.nuke.cooldown = 0;
  const sovTank = Array.from(world.units.values()).find(
    (u) => u.faction === 'soviets' && u.type === 'medium_tank'
  )!;
  const firedIron = world.fireSuperweapon('soviets', 'iron_curtain', { x: sovTank.x, z: sovTank.z });
  const firedNuke = world.fireSuperweapon('soviets', 'nuke', { x: 32, z: 112 });
  if (!firedIron || !firedNuke || sovTank.invulnerableTimer <= 0) {
    throw new Error('Failed to fire Soviet Iron Curtain or Tactical Nuke');
  }

  // Send Rifle Squad to capture West Oil Derrick
  const derrick = Array.from(world.derricks.values())[0];
  const allyRifle = Array.from(world.units.values()).find(
    (u) => u.faction === 'allies' && u.type === 'rifle'
  );
  if (allyRifle) {
    world.issueMoveOrder([allyRifle.id], { x: derrick.x, z: derrick.z }, false);
  }

  // Spawn Kirov Airship flying over cliffs
  const kirov = world.spawnUnit('kirov', 'soviets', 110, 34);
  world.issueMoveOrder([kirov.id], { x: 30, z: 114 }, true);

  // Test Sell Building refunds credits + spawns Rifle Squad
  const extraPower = Array.from(world.buildings.values()).find(
    (b) => b.faction === 'allies' && b.type === 'power'
  )!;
  const unitsBeforeSell = world.units.size;
  const creditsBeforeSell = world.players.allies.credits;
  world.sellBuilding('allies', extraPower.id);
  if (world.units.size !== unitsBeforeSell + 1 || world.players.allies.credits <= creditsBeforeSell) {
    throw new Error('Building sell failed to spawn infantry or refund credits');
  }

  let shotsFired = 0;
  let explosions = 0;
  let nukeImpacts = 0;
  let derricksCaptured = 0;
  let chronoWarps = 0;

  const ticks = 80 * 20;
  for (let t = 0; t < ticks; t++) {
    ai.update(world, SIM_DT);
    world.tick(SIM_DT);

    for (const ev of world.drainEvents()) {
      if (ev.type === 'shot') shotsFired++;
      if (ev.type === 'explosion') explosions++;
      if (ev.type === 'nuke_impact') nukeImpacts++;
      if (ev.type === 'derrick_captured') derricksCaptured++;
      if (ev.type === 'chrono_warp') chronoWarps++;
    }

    for (const u of world.units.values()) {
      if (Number.isNaN(u.x) || Number.isNaN(u.y) || Number.isNaN(u.z)) {
        throw new Error(`Unit ${u.id} (${u.type}) had NaN coordinates!`);
      }
    }
  }

  if (shotsFired < 5) throw new Error('Expected combat shots');
  if (nukeImpacts < 1) throw new Error('Expected Soviet nuclear detonation');
  if (derricksCaptured < 1) throw new Error('Expected Tech Oil Derrick capture');

  // 4. Verify Allied AI works when player plays as Soviets + Deterministic Replay Verification!
  const replayCfg: MatchConfig = {
    ...DEFAULT_MATCH_CONFIG,
    mapPreset: 'arctic',
    hostFaction: 'soviets',
    startingCredits: 5000,
    difficulty: 'normal',
    seed: 987654,
    balancedPvP: false,
  };
  const liveWorld = new GameWorld(replayCfg);
  const alliedAi = new SkirmishAI(replayCfg.difficulty, 'allies');
  const recorder = new ReplayRecorder(replayCfg, 'solo');

  const sovUnitsLive = Array.from(liveWorld.units.values())
    .filter((u) => u.faction === 'soviets' && u.type !== 'harvester')
    .map((u) => u.id);

  for (let t = 0; t < 500; t++) {
    if (t === 10) {
      const cmd = { type: 'queue_unit' as const, unitType: 'medium_tank' as const };
      recorder.record(liveWorld.tickCount, 'soviets', cmd);
      liveWorld.executeCommand('soviets', cmd);
    }
    if (t === 25) {
      const cmd = {
        type: 'move' as const,
        unitIds: sovUnitsLive,
        target: { x: 72, z: 72 },
        attackMove: true,
      };
      recorder.record(liveWorld.tickCount, 'soviets', cmd);
      liveWorld.executeCommand('soviets', cmd);
    }
    alliedAi.update(liveWorld, SIM_DT);
    liveWorld.tick(SIM_DT);
    liveWorld.drainEvents();
  }

  const replayData = recorder.finalize(liveWorld.tickCount, liveWorld.winner);
  const parsed = parseReplayJson(JSON.stringify(replayData));
  const player = new ReplayPlayer(parsed);
  while (!player.finished) {
    player.stepTick();
    player.world.drainEvents();
  }

  if (
    player.world.tickCount !== liveWorld.tickCount ||
    player.world.units.size !== liveWorld.units.size ||
    player.world.buildings.size !== liveWorld.buildings.size ||
    Math.abs(player.world.players.allies.credits - liveWorld.players.allies.credits) > 0.01 ||
    Math.abs(player.world.players.soviets.credits - liveWorld.players.soviets.credits) > 0.01
  ) {
    throw new Error(
      `Replay diverged! live=(u:${liveWorld.units.size}, c:${liveWorld.players.soviets.credits.toFixed(1)}) vs replay=(u:${player.world.units.size}, c:${player.world.players.soviets.credits.toFixed(1)})`
    );
  }

  // Test scrubbing backwards to 50% and back to 100%
  player.seekToFraction(0.5);
  if (player.world.tickCount !== 250) {
    throw new Error(`Expected seekToFraction(0.5) to land at tick 250, got ${player.world.tickCount}`);
  }
  player.seekToFraction(1.0);
  if (player.world.units.size !== liveWorld.units.size) {
    throw new Error('Scrubbing back to 1.0 diverged from original state');
  }

  console.log('=== Full Asymmetric RTS & Replay Simulation Test ===');
  console.log('Maps Verified: canyon, arctic, volcanic');
  console.log('Asymmetric Tech Trees: Allies (Prism/Chrono/Air Strike) vs Soviets (Tesla/Mammoth/Kirov/Nuke)');
  console.log(
    `Battle Stats (80s): Shots=${shotsFired} | Explosions=${explosions} | Nukes=${nukeImpacts} | Derricks=${derricksCaptured} | ChronoWarps=${chronoWarps}`
  );
  console.log(
    `Deterministic Replay (500 ticks, Arctic, Soviets vs Allied AI): EXACT MATCH (units=${player.world.units.size}, credits=$${Math.round(player.world.players.soviets.credits)})`
  );
  console.log('PASS: Asymmetric factions, superweapons, AI (both sides), and replays verified.');
}

runSmokeTest();
