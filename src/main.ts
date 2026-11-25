import * as THREE from 'three';
import { SoundEngine } from './audio/sfx';
import { MultiplayerClient } from './net/multiplayer';
import type { GameCommand } from './net/protocol';
import { GameRenderer } from './render/renderer';
import { SkirmishAI } from './sim/ai';
import { SIM_DT } from './sim/config';
import type {
  AIDifficulty,
  BuildingType,
  Faction,
  MapPreset,
  SimEvent,
  SuperweaponType,
  UnitType,
} from './sim/types';
import { GameWorld } from './sim/world';
import { CursorToolMode, HUDController } from './ui/hud';
import './style.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const marqueeEl = document.getElementById('selection-marquee') as HTMLDivElement;

let currentMapPreset: MapPreset = 'canyon';
let currentDifficulty: AIDifficulty = 'normal';
let world = new GameWorld(false, currentMapPreset);
let ai = new SkirmishAI(currentDifficulty);
const renderer = new GameRenderer(canvas, world);
const sfx = new SoundEngine();

const selectedUnits = new Set<number>();
let selectedBuildingId: number | null = null;
const controlGroups = new Map<number, number[]>();

let placingBuilding = false;
let attackMoveArmed = false;
let toolMode: CursorToolMode = 'normal';
let armedSuperweapon: SuperweaponType | null = null;
let paused = false;
let gameSpeed = 1;

const SNAPSHOT_INTERVAL = 1 / 15;
let snapshotTimer = 0;
let pendingNetEvents: SimEvent[] = [];
let guestInterpElapsed = 0;

const keys = new Set<string>();
let mouseClientX = 0;
let mouseClientY = 0;
let lastWorldMouse: THREE.Vector3 | null = null;
let dragStart: { x: number; y: number } | null = null;
let isMarqueeDragging = false;
let isPanDragging = false;
let panLastX = 0;
let panLastY = 0;
let lastClickTime = 0;
let lastClickEntityId: number | null = null;

function clearSpecialModes(): void {
  placingBuilding = false;
  attackMoveArmed = false;
  toolMode = 'normal';
  armedSuperweapon = null;
  canvas.style.cursor = 'crosshair';
}

function pruneSelection(): void {
  for (const id of Array.from(selectedUnits)) {
    if (!world.units.has(id)) selectedUnits.delete(id);
  }
  if (selectedBuildingId && !world.buildings.has(selectedBuildingId)) {
    selectedBuildingId = null;
  }
}

function resetWorld(balancedPvP: boolean, localFaction: Faction, preset = currentMapPreset): void {
  currentMapPreset = preset;
  hud.setMapSelection(preset);
  world = new GameWorld(balancedPvP, preset);
  world.setLocalFaction(localFaction);
  ai = new SkirmishAI(currentDifficulty);
  selectedUnits.clear();
  selectedBuildingId = null;
  controlGroups.clear();
  clearSpecialModes();
  paused = false;
  pendingNetEvents = [];
  snapshotTimer = 0;
  guestInterpElapsed = 0;
  renderer.rebuildForNewWorld(world);
  hud.resetMinimapCache();
}

function dispatchCommand(cmd: GameCommand): void {
  if (mp.isGuest) {
    mp.sendCommand(cmd);
  } else {
    world.executeCommand(world.localFaction, cmd);
  }
}

const mp = new MultiplayerClient({
  onStatusChange: (mode, roomId, faction, info, mapPreset) => {
    hud.updateMultiplayerStatus(mode, roomId, faction, mp.getInviteUrl(), mp.latencyMs, info);

    if (mode === 'guest_live') {
      gameSpeed = 1;
      paused = false;
      resetWorld(true, 'soviets', mapPreset ?? 'canyon');
      hud.closeMultiplayerModal();
      hud.showEvaBanner('Connected as Soviet Command — Destroy the Allied base in the SW!');
    } else if (mode === 'hosting_wait') {
      hud.openMultiplayerModal();
    } else if (mode === 'solo' && world.localFaction !== 'allies') {
      resetWorld(false, 'allies', currentMapPreset);
    }
  },
  onPeerJoined: () => {
    gameSpeed = 1;
    paused = false;
    resetWorld(true, 'allies', currentMapPreset);
    hud.closeMultiplayerModal();
    hud.showEvaBanner('Opponent connected! 1v1 match live — Destroy the Soviet base!');
    mp.sendSnapshot(world.createSnapshot([]));
  },
  onPeerLeft: () => {
    if (mp.isHost) {
      hud.showEvaBanner('Opponent disconnected — waiting for reconnect or leave room', true);
    } else {
      hud.showEvaBanner('Host left the match — returned to solo skirmish', true);
      resetWorld(false, 'allies', currentMapPreset);
    }
  },
  onRemoteCommand: (cmd) => {
    if (!mp.isHost) return;
    world.executeCommand('soviets', cmd);
  },
  onRemoteSnapshot: (snapshot) => {
    if (!mp.isGuest) return;
    guestInterpElapsed = 0;
    world.applySnapshot(snapshot);
    if (snapshot.events.length > 0) {
      renderer.handleSimEvents(snapshot.events, world);
      sfx.handleSimEvents(snapshot.events, world.localFaction);
      hud.handleSimEvents(snapshot.events, world);
    }
  },
  onRestartMatch: (mapPreset) => {
    if (!mp.isGuest) return;
    resetWorld(true, 'soviets', mapPreset);
    document.getElementById('gameover-modal')!.classList.add('hidden');
    hud.showEvaBanner(`Host deployed a new 1v1 skirmish on ${world.map.theme.name}!`);
  },
  onChatMessage: (from, text) => {
    hud.appendChatMessage(from, text);
    sfx.playClick();
  },
  onError: (msg) => {
    hud.showMultiplayerError(msg);
  },
});

const hud = new HUDController({
  onClickBuilding: (type: BuildingType) => {
    sfx.unlock();
    sfx.playClick();
    toolMode = 'normal';
    armedSuperweapon = null;
    const prod = world.players[world.localFaction].buildingProd;
    if (prod && prod.type === type && prod.ready) {
      placingBuilding = !placingBuilding;
      attackMoveArmed = false;
      return;
    }
    if (!prod) {
      dispatchCommand({ type: 'start_building', buildingType: type });
    }
  },
  onCancelBuilding: () => {
    sfx.unlock();
    sfx.playClick();
    placingBuilding = false;
    dispatchCommand({ type: 'cancel_building' });
  },
  onClickUnit: (type: UnitType, count: number) => {
    sfx.unlock();
    sfx.playClick();
    for (let i = 0; i < count; i++) {
      dispatchCommand({ type: 'queue_unit', unitType: type });
    }
  },
  onCancelUnit: (type: UnitType) => {
    sfx.unlock();
    sfx.playClick();
    dispatchCommand({ type: 'cancel_unit', unitType: type });
  },
  onMinimapClick: (wx: number, wz: number) => {
    renderer.setCameraTargetWorld(wx, wz);
  },
  onMinimapRightClick: (wx: number, wz: number, attackMove: boolean) => {
    if (selectedUnits.size === 0) return;
    sfx.unlock();
    dispatchCommand({
      type: 'move',
      unitIds: Array.from(selectedUnits),
      target: { x: wx, z: wz },
      attackMove,
    });
    renderer.vfx.spawnGroundPing(wx, 0.5, wz, attackMove ? 0xff5a36 : 0x3bf095);
    sfx.playOrderConfirm();
  },
  onHomeClick: () => {
    sfx.playClick();
    renderer.focusOnBase(world);
  },
  onToggleSpeed: () => {
    sfx.playClick();
    if (mp.isMultiplayerActive || mp.isGuest) return 1;
    gameSpeed = gameSpeed === 1 ? 2 : 1;
    return gameSpeed;
  },
  onTogglePause: () => {
    sfx.playClick();
    if (mp.isGuest) return false;
    paused = !paused;
    return paused;
  },
  onToggleFog: () => {
    sfx.playClick();
    world.fogEnabled = !world.fogEnabled;
    return world.fogEnabled;
  },
  onToggleAudio: () => {
    sfx.enabled = !sfx.enabled;
    return sfx.enabled;
  },
  onToggleMusic: () => {
    sfx.unlock();
    return sfx.toggleMusic();
  },
  onChangeMap: (preset: MapPreset) => {
    sfx.playClick();
    if (mp.isGuest) return;
    currentMapPreset = preset;
    if (mp.isHost) {
      resetWorld(true, 'allies', preset);
      mp.sendRestartMatch(preset);
      mp.sendSnapshot(world.createSnapshot([]));
    } else {
      resetWorld(false, 'allies', preset);
    }
    hud.showEvaBanner(`Deployed to ${world.map.theme.name} — ${world.map.theme.subtitle}`);
  },
  onChangeDifficulty: (diff: AIDifficulty) => {
    sfx.playClick();
    currentDifficulty = diff;
    ai.difficulty = diff;
    hud.showEvaBanner(`Skirmish AI set to ${diff.toUpperCase()}`);
  },
  onToggleToolMode: (mode: CursorToolMode) => {
    sfx.unlock();
    sfx.playClick();
    const next = toolMode === mode ? 'normal' : mode;
    clearSpecialModes();
    toolMode = next;
    canvas.style.cursor = next === 'sell' ? 'alias' : next === 'repair' ? 'help' : 'crosshair';
  },
  onArmSuperweapon: (weapon: SuperweaponType) => {
    sfx.unlock();
    sfx.playClick();
    const p = world.players[world.localFaction];
    const sw = p.superweapons[weapon];
    if (!sw.unlocked || sw.cooldown > 0.05) return;
    if (weapon === 'nuke' && p.powerRatio < 1) {
      hud.showEvaBanner('Nuclear Silo offline — Build more Power Plants!', true);
      return;
    }
    const toggleOff = armedSuperweapon === weapon;
    clearSpecialModes();
    if (!toggleOff) {
      armedSuperweapon = weapon;
      canvas.style.cursor = 'crosshair';
      hud.showEvaBanner(
        weapon === 'nuke'
          ? 'Tactical Nuke Armed — Left-Click Target Coordinates!'
          : weapon === 'iron_curtain'
          ? 'Iron Curtain Armed — Left-Click Friendly Units for 10s Invulnerability!'
          : 'A-10 Air Strike Ready — Left-Click Strike Zone!'
      );
    }
  },
  onQuickSelect: (kind: 'army' | 'idle' | 'harvesters') => {
    sfx.playClick();
    selectedUnits.clear();
    selectedBuildingId = null;
    for (const u of world.units.values()) {
      if (u.faction !== world.localFaction) continue;
      if (kind === 'harvesters' && u.type === 'harvester') {
        selectedUnits.add(u.id);
      } else if (kind === 'army' && u.type !== 'harvester') {
        selectedUnits.add(u.id);
      } else if (kind === 'idle' && u.type !== 'harvester' && u.order.type === 'idle') {
        selectedUnits.add(u.id);
      }
    }
  },
  onRestart: () => {
    if (mp.isHost) {
      resetWorld(true, 'allies', currentMapPreset);
      mp.sendRestartMatch(currentMapPreset);
      mp.sendSnapshot(world.createSnapshot([]));
      hud.showEvaBanner('New 1v1 skirmish deployed!');
    } else if (mp.isGuest) {
      hud.showEvaBanner('Waiting for Host to deploy a new match');
    } else {
      resetWorld(false, 'allies', currentMapPreset);
      hud.showEvaBanner('Battlefield control online — Welcome back, Commander');
    }
  },
  onHostMultiplayer: () => {
    sfx.unlock();
    sfx.playClick();
    mp.hostRoom(currentMapPreset);
  },
  onJoinMultiplayer: (code: string) => {
    sfx.unlock();
    sfx.playClick();
    mp.joinRoom(code);
  },
  onLeaveMultiplayer: () => {
    sfx.playClick();
    mp.leaveRoom();
    hud.closeMultiplayerModal();
    resetWorld(false, 'allies', currentMapPreset);
    hud.showEvaBanner('Returned to Solo Skirmish vs Soviet AI');
  },
  onSendChat: (text: string) => {
    mp.sendChat(text);
    hud.appendChatMessage(world.localFaction, text);
  },
});

const initialRoom = new URLSearchParams(window.location.search).get('room');
if (initialRoom) {
  hud.openMultiplayerModal();
  mp.joinRoom(initialRoom);
} else {
  hud.showEvaBanner('Battlefield control online — Capture Oil Derricks & destroy the NE base!');
}

// --- MOUSE CONTROLS ---

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  sfx.unlock();
  mouseClientX = e.clientX;
  mouseClientY = e.clientY;

  if (e.button === 1) {
    isPanDragging = true;
    panLastX = e.clientX;
    panLastY = e.clientY;
    return;
  }

  if (e.button === 2) {
    if (placingBuilding || attackMoveArmed || toolMode !== 'normal' || armedSuperweapon) {
      clearSpecialModes();
      sfx.playClick();
      return;
    }

    const wp = renderer.screenToWorld(e.clientX, e.clientY);
    if (!wp) return;

    if (selectedBuildingId && selectedUnits.size === 0) {
      const b = world.buildings.get(selectedBuildingId);
      if (
        b &&
        b.faction === world.localFaction &&
        (b.type === 'barracks' || b.type === 'warfactory')
      ) {
        dispatchCommand({ type: 'set_rally', buildingId: b.id, target: { x: wp.x, z: wp.z } });
        renderer.vfx.spawnGroundPing(wp.x, wp.y, wp.z, 0x3bf095);
        sfx.playOrderConfirm();
      }
      return;
    }

    if (selectedUnits.size === 0) return;

    const unitIds = Array.from(selectedUnits);
    const picked = renderer.pickEntityAtScreen(world, e.clientX, e.clientY);

    // Draw crisp fading tactical command lines from selected units to target!
    const drawOrderLines = (tx: number, ty: number, tz: number, col: number) => {
      let drawn = 0;
      for (const id of unitIds) {
        if (drawn++ > 12) break;
        const u = world.units.get(id);
        if (u) renderer.vfx.spawnOrderLine(u.x, u.y, u.z, tx, ty, tz, col);
      }
    };

    if (picked && picked.faction !== world.localFaction) {
      dispatchCommand({ type: 'attack', unitIds, targetId: picked.id });
      renderer.vfx.spawnGroundPing(picked.x, picked.y, picked.z, 0xff4b4b);
      drawOrderLines(picked.x, picked.y, picked.z, 0xff4b4b);
      sfx.playOrderConfirm();
    } else {
      const allHarvesters = unitIds.every((id) => world.units.get(id)?.type === 'harvester');
      if (allHarvesters) {
        dispatchCommand({ type: 'harvest', unitIds, target: { x: wp.x, z: wp.z } });
        renderer.vfx.spawnGroundPing(wp.x, wp.y, wp.z, 0xf5b82e);
        drawOrderLines(wp.x, wp.y, wp.z, 0xf5b82e);
      } else {
        const isAttackMove = e.altKey || e.shiftKey;
        const col = isAttackMove ? 0xff5a36 : 0x3bf095;
        dispatchCommand({
          type: 'move',
          unitIds,
          target: { x: wp.x, z: wp.z },
          attackMove: isAttackMove,
        });
        renderer.vfx.spawnGroundPing(wp.x, wp.y, wp.z, col);
        drawOrderLines(wp.x, wp.y, wp.z, col);
      }
      sfx.playOrderConfirm();
    }
    return;
  }

  if (e.button === 0) {
    // 1. Fire armed Superweapon!
    if (armedSuperweapon) {
      const wp = renderer.screenToWorld(e.clientX, e.clientY);
      if (wp) {
        dispatchCommand({
          type: 'fire_superweapon',
          weapon: armedSuperweapon,
          target: { x: wp.x, z: wp.z },
        });
        renderer.vfx.spawnGroundPing(wp.x, wp.y, wp.z, 0xff2a2a);
        sfx.playOrderConfirm();
      }
      clearSpecialModes();
      return;
    }

    // 2. Repair / Sell mode click on friendly building
    if (toolMode !== 'normal') {
      const picked = renderer.pickEntityAtScreen(world, e.clientX, e.clientY);
      if (picked && picked.kind === 'building' && picked.faction === world.localFaction) {
        if (toolMode === 'sell') {
          dispatchCommand({ type: 'sell_building', buildingId: picked.id });
        } else {
          dispatchCommand({ type: 'toggle_repair', buildingId: picked.id });
        }
        sfx.playClick();
      }
      return;
    }

    // 3. Place ready building
    const activeProd = world.players[world.localFaction].buildingProd;
    if (placingBuilding && activeProd?.ready) {
      const wp = renderer.screenToWorld(e.clientX, e.clientY);
      const preview = renderer.updatePlacementPreview(
        world,
        activeProd.type as BuildingType,
        wp
      );
      if (preview && preview.valid) {
        dispatchCommand({ type: 'place_building', gx: preview.gx, gz: preview.gz });
        placingBuilding = false;
      } else {
        hud.showEvaBanner('Cannot deploy here — place on flat ground near your base', true);
      }
      return;
    }

    // 4. Attack-Move click
    if (attackMoveArmed && selectedUnits.size > 0) {
      const wp = renderer.screenToWorld(e.clientX, e.clientY);
      if (wp) {
        dispatchCommand({
          type: 'move',
          unitIds: Array.from(selectedUnits),
          target: { x: wp.x, z: wp.z },
          attackMove: true,
        });
        renderer.vfx.spawnGroundPing(wp.x, wp.y, wp.z, 0xff5a36);
        sfx.playOrderConfirm();
      }
      attackMoveArmed = false;
      canvas.style.cursor = 'crosshair';
      return;
    }

    // 5. Selection / drag marquee
    dragStart = { x: e.clientX, y: e.clientY };
    isMarqueeDragging = false;
  }
});

window.addEventListener('mousemove', (e) => {
  mouseClientX = e.clientX;
  mouseClientY = e.clientY;

  if (isPanDragging) {
    const dx = e.clientX - panLastX;
    const dy = e.clientY - panLastY;
    panLastX = e.clientX;
    panLastY = e.clientY;
    const scale = renderer.camDistance * 0.0022;
    renderer.panCamera(-dx * scale, -dy * scale);
    return;
  }

  if (dragStart) {
    const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    if (dist > 6) {
      isMarqueeDragging = true;
      marqueeEl.style.display = 'block';
      marqueeEl.style.left = `${Math.min(dragStart.x, e.clientX)}px`;
      marqueeEl.style.top = `${Math.min(dragStart.y, e.clientY)}px`;
      marqueeEl.style.width = `${Math.abs(e.clientX - dragStart.x)}px`;
      marqueeEl.style.height = `${Math.abs(e.clientY - dragStart.y)}px`;
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 1) {
    isPanDragging = false;
    return;
  }
  if (e.button !== 0 || !dragStart) return;

  if (isMarqueeDragging) {
    const found = renderer.getUnitsInScreenBox(
      world,
      dragStart.x,
      dragStart.y,
      e.clientX,
      e.clientY
    );
    if (!e.shiftKey) {
      selectedUnits.clear();
      selectedBuildingId = null;
    }
    for (const id of found) selectedUnits.add(id);
    if (found.length > 0) sfx.playClick();
  } else {
    const picked = renderer.pickEntityAtScreen(world, e.clientX, e.clientY);
    const now = performance.now();

    if (picked && picked.faction === world.localFaction) {
      if (picked.kind === 'unit') {
        selectedBuildingId = null;
        if (!e.shiftKey) selectedUnits.clear();
        if (lastClickEntityId === picked.id && now - lastClickTime < 340) {
          const allSame = renderer.getVisibleMatchingUnits(world, picked.type);
          for (const id of allSame) selectedUnits.add(id);
        } else {
          selectedUnits.add(picked.id);
        }
        lastClickEntityId = picked.id;
        lastClickTime = now;
        sfx.playClick();
      } else {
        selectedUnits.clear();
        selectedBuildingId = picked.id;
        sfx.playClick();
      }
    } else if (!e.shiftKey) {
      selectedUnits.clear();
      selectedBuildingId = null;
    }
  }

  dragStart = null;
  isMarqueeDragging = false;
  marqueeEl.style.display = 'none';
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.zoomCamera(e.deltaY * 0.035);
  },
  { passive: false }
);

// --- KEYBOARD SHORTCUTS ---

window.addEventListener('keydown', (e) => {
  if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement) {
    return;
  }

  const k = e.key.toLowerCase();
  keys.add(k);

  if (k === 'escape') {
    clearSpecialModes();
    document.getElementById('help-modal')!.classList.add('hidden');
    hud.closeMultiplayerModal();
    return;
  }
  if (k === 'g' && selectedUnits.size > 0 && !e.ctrlKey && !e.metaKey) {
    clearSpecialModes();
    attackMoveArmed = true;
    canvas.style.cursor = 'cell';
    return;
  }
  if (k === 'r' && !e.ctrlKey && !e.metaKey) {
    document.getElementById('btn-tool-repair')!.click();
    return;
  }
  if (k === 'v' && !e.ctrlKey && !e.metaKey) {
    document.getElementById('btn-tool-sell')!.click();
    return;
  }
  if (k === 'b' && !e.ctrlKey && !e.metaKey) {
    hud.switchTab('buildings');
    return;
  }
  if (k === 'u' && !e.ctrlKey && !e.metaKey) {
    hud.switchTab('units');
    return;
  }
  if (k === 'x' && selectedUnits.size > 0 && !e.ctrlKey && !e.metaKey) {
    dispatchCommand({ type: 'stop', unitIds: Array.from(selectedUnits) });
    sfx.playClick();
    return;
  }
  if (k === 'h' || k === ' ') {
    e.preventDefault();
    renderer.focusOnBase(world);
    return;
  }
  if (k === 'backspace' && hud.lastAlertPos) {
    e.preventDefault();
    renderer.setCameraTargetWorld(hud.lastAlertPos.x, hud.lastAlertPos.z);
    return;
  }
  if (k === 'enter' && mp.isMultiplayerActive) {
    e.preventDefault();
    hud.focusChatInput();
    return;
  }
  if (k === 'p' && !mp.isGuest) {
    document.getElementById('btn-pause')!.click();
    return;
  }
  if (k === 'f') {
    document.getElementById('btn-fog')!.click();
    return;
  }
  if (k === 'm') {
    document.getElementById('btn-audio')!.click();
    return;
  }

  if (k >= '1' && k <= '5') {
    const groupNum = Number(k);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (selectedUnits.size > 0) {
        controlGroups.set(groupNum, Array.from(selectedUnits));
        hud.showEvaBanner(`Squad ${groupNum} assigned (${selectedUnits.size} units)`);
      }
    } else {
      const saved = controlGroups.get(groupNum);
      if (saved && saved.length > 0) {
        selectedUnits.clear();
        selectedBuildingId = null;
        for (const id of saved) {
          if (world.units.has(id)) selectedUnits.add(id);
        }
        sfx.playClick();
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
});

window.addEventListener('resize', () => renderer.resize());

// --- MAIN LOOP ---

let lastTime = performance.now();
let accumulator = 0;
let pingUiTimer = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  const panSpeed = (28 + renderer.camDistance * 0.48) * rawDt;
  let right = 0;
  let forward = 0;
  if (keys.has('a') || keys.has('arrowleft')) right -= panSpeed;
  if (keys.has('d') || keys.has('arrowright')) right += panSpeed;
  if (keys.has('w') || keys.has('arrowup')) forward -= panSpeed;
  if (keys.has('s') || keys.has('arrowdown')) forward += panSpeed;
  if (right !== 0 || forward !== 0) {
    renderer.panCamera(right, forward);
  }
  if (keys.has('q')) renderer.rotateCamera(-1.35 * rawDt);
  if (keys.has('e')) renderer.rotateCamera(1.35 * rawDt);

  let alpha = 1;

  if (mp.isGuest) {
    guestInterpElapsed += rawDt;
    alpha = Math.max(0, Math.min(1, guestInterpElapsed / SNAPSHOT_INTERVAL));
  } else {
    const shouldSimulate = !paused && !world.winner && mp.mode !== 'hosting_wait';
    if (shouldSimulate) {
      const effectiveSpeed = mp.mode === 'hosting_live' ? 1 : gameSpeed;
      accumulator += rawDt * effectiveSpeed;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < 6) {
        if (mp.mode === 'solo') {
          ai.update(world, SIM_DT);
        }
        world.tick(SIM_DT);
        accumulator -= SIM_DT;
        steps++;
      }
    }

    const events = world.drainEvents();
    if (events.length > 0) {
      renderer.handleSimEvents(events, world);
      sfx.handleSimEvents(events, world.localFaction);
      hud.handleSimEvents(events, world);
      if (mp.mode === 'hosting_live') {
        pendingNetEvents.push(...events);
      }
    }

    if (mp.mode === 'hosting_live') {
      snapshotTimer += rawDt;
      if (snapshotTimer >= SNAPSHOT_INTERVAL) {
        snapshotTimer = 0;
        mp.sendSnapshot(world.createSnapshot(pendingNetEvents));
        pendingNetEvents = [];
      }
    }

    alpha = Math.max(0, Math.min(1, accumulator / SIM_DT));
  }

  pingUiTimer += rawDt;
  if (pingUiTimer >= 1.5 && mp.mode !== 'solo') {
    pingUiTimer = 0;
    hud.updateMultiplayerStatus(mp.mode, mp.roomId, mp.faction, mp.getInviteUrl(), mp.latencyMs);
  }

  // Update 3D ground previews (Building hologram or Superweapon targeting reticle)
  const bProd = world.players[world.localFaction].buildingProd;
  if (!bProd?.ready && placingBuilding) placingBuilding = false;

  if (armedSuperweapon) {
    lastWorldMouse = renderer.screenToWorld(mouseClientX, mouseClientY);
    renderer.updateSuperweaponReticle(armedSuperweapon, lastWorldMouse);
    renderer.updatePlacementPreview(world, null, null);
  } else if (placingBuilding && bProd?.ready) {
    lastWorldMouse = renderer.screenToWorld(mouseClientX, mouseClientY);
    renderer.updatePlacementPreview(world, bProd.type as BuildingType, lastWorldMouse);
    renderer.updateSuperweaponReticle(null, null);
  } else {
    renderer.updatePlacementPreview(world, null, null);
    renderer.updateSuperweaponReticle(null, null);
  }

  pruneSelection();

  const footerText =
    mp.mode === 'hosting_live'
      ? `1v1 LIVE // ALLIED HOST · ROOM ${mp.roomId}`
      : mp.mode === 'guest_live'
      ? `1v1 LIVE // SOVIET COMMAND · ROOM ${mp.roomId}`
      : mp.mode === 'hosting_wait'
      ? `WAITING FOR OPPONENT // ROOM ${mp.roomId}`
      : ai.statusText;

  renderer.renderFrame(world, rawDt, alpha, selectedUnits, selectedBuildingId);
  hud.update(
    world,
    footerText,
    selectedUnits,
    selectedBuildingId,
    placingBuilding,
    toolMode,
    armedSuperweapon,
    renderer.getCameraGroundCorners()
  );
}

requestAnimationFrame(frame);
