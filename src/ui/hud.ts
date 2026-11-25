import type { MultiplayerMode } from '../net/multiplayer';
import {
  BUILDABLE_BUILDINGS,
  BUILDABLE_UNITS,
  BUILDING_SPECS,
  MAP_SIZE,
  TILE_SIZE,
  UNIT_SPECS,
  WORLD_SIZE,
} from '../sim/config';
import {
  AIDifficulty,
  BuildingType,
  Faction,
  MapPreset,
  SimEvent,
  SuperweaponType,
  UnitType,
  Vec2,
} from '../sim/types';
import { GameWorld } from '../sim/world';

export type CursorToolMode = 'normal' | 'repair' | 'sell';

export interface HUDCallbacks {
  onClickBuilding: (type: BuildingType) => void;
  onCancelBuilding: () => void;
  onClickUnit: (type: UnitType, count: number) => void;
  onCancelUnit: (type: UnitType) => void;
  onMinimapClick: (wx: number, wz: number) => void;
  onMinimapRightClick: (wx: number, wz: number, attackMove: boolean) => void;
  onHomeClick: () => void;
  onToggleSpeed: () => number;
  onTogglePause: () => boolean;
  onToggleFog: () => boolean;
  onToggleAudio: () => boolean;
  onToggleMusic: () => boolean;
  onChangeMap: (preset: MapPreset) => void;
  onChangeDifficulty: (diff: AIDifficulty) => void;
  onToggleToolMode: (mode: CursorToolMode) => void;
  onArmSuperweapon: (weapon: SuperweaponType) => void;
  onQuickSelect: (kind: 'army' | 'idle' | 'harvesters') => void;
  onRestart: () => void;
  onHostMultiplayer: () => void;
  onJoinMultiplayer: (code: string) => void;
  onLeaveMultiplayer: () => void;
  onSendChat: (text: string) => void;
}

const ICONS: Record<BuildingType | UnitType, string> = {
  conyard: `<svg viewBox="0 0 48 48"><rect x="8" y="22" width="32" height="16" rx="2" fill="#7aa6d6"/><path d="M14 22V12h12v10M28 16l10-6v6" stroke="#f5b82e" stroke-width="3" fill="none"/></svg>`,
  power: `<svg viewBox="0 0 48 48"><path d="M12 38l3-24h8l3 24M26 38l3-24h8l3 24" fill="#6d8094"/><path d="M26 10l-7 13h6l-3 12 9-15h-6z" fill="#38e8ff"/></svg>`,
  refinery: `<svg viewBox="0 0 48 48"><rect x="7" y="18" width="20" height="20" fill="#7d8f9e"/><rect x="27" y="26" width="14" height="12" fill="#e5a823"/><circle cx="14" cy="14" r="5" fill="#4ca3ff"/><rect x="12" y="24" width="10" height="6" fill="#ff7d1a"/></svg>`,
  barracks: `<svg viewBox="0 0 48 48"><path d="M8 38V20l16-8 16 8v18z" fill="#6c7d8e"/><rect x="19" y="25" width="10" height="13" fill="#1e242b"/><circle cx="34" cy="12" r="4" stroke="#70c5ff" stroke-width="2" fill="none"/></svg>`,
  warfactory: `<svg viewBox="0 0 48 48"><rect x="6" y="16" width="36" height="22" rx="2" fill="#6b7a8c"/><rect x="14" y="22" width="20" height="16" fill="#1b2026"/><rect x="12" y="18" width="24" height="4" fill="#e5a823"/></svg>`,
  turret: `<svg viewBox="0 0 48 48"><circle cx="24" cy="29" r="11" fill="#6c7d8e"/><rect x="20" y="9" width="3" height="18" fill="#d2dce6"/><rect x="25" y="9" width="3" height="18" fill="#d2dce6"/><circle cx="24" cy="27" r="6" fill="#3b82f6"/></svg>`,
  tesla: `<svg viewBox="0 0 48 48"><path d="M18 40l4-24h4l4 24z" fill="#788591"/><ellipse cx="24" cy="24" rx="10" ry="2.5" stroke="#d48b45" stroke-width="2.5" fill="none"/><ellipse cx="24" cy="30" rx="12" ry="2.8" stroke="#d48b45" stroke-width="2.5" fill="none"/><circle cx="24" cy="12" r="5.5" fill="#4aeaff"/></svg>`,
  techcenter: `<svg viewBox="0 0 48 48"><rect x="8" y="24" width="32" height="14" rx="2" fill="#6d7f91"/><path d="M12 24a12 12 0 0 1 24 0" fill="#2563eb"/><circle cx="24" cy="16" r="4" fill="#4aeaff"/><path d="M32 10l8-3-3 8" stroke="#e2e8f0" stroke-width="2.5" fill="none"/></svg>`,
  silo: `<svg viewBox="0 0 48 48"><rect x="8" y="28" width="32" height="10" rx="2" fill="#5c646d"/><path d="M24 7l7 11v12H17V18z" fill="#e2e8f0"/><path d="M24 7l7 11H17z" fill="#ef4444"/><rect x="12" y="26" width="24" height="3.5" fill="#f5b82e"/></svg>`,
  rifle: `<svg viewBox="0 0 48 48"><circle cx="24" cy="13" r="4" fill="#cbd5e1"/><path d="M17 36v-12l7-4 7 4v12" fill="#3b82f6"/><path d="M28 22l12-4" stroke="#e2e8f0" stroke-width="3"/></svg>`,
  rocket: `<svg viewBox="0 0 48 48"><circle cx="20" cy="14" r="4" fill="#cbd5e1"/><path d="M14 36V22h12v14" fill="#3b82f6"/><rect x="20" y="13" width="20" height="5" rx="2" fill="#e5a823"/><path d="M38 15.5l6-2-2 5z" fill="#ff5533"/></svg>`,
  tesla_trooper: `<svg viewBox="0 0 48 48"><circle cx="22" cy="13" r="4.5" fill="#94a3b8"/><path d="M13 37V21l9-3 9 3v16" fill="#2563eb"/><path d="M33 10l-6 11h5l-4 11 9-14h-5z" fill="#4aeaff"/></svg>`,
  harvester: `<svg viewBox="0 0 48 48"><rect x="7" y="20" width="18" height="14" rx="2" fill="#6b7a8c"/><polygon points="10,20 16,12 23,20" fill="#f5b82e"/><rect x="25" y="17" width="13" height="17" rx="2" fill="#3b82f6"/><circle cx="13" cy="36" r="4" fill="#181c22"/><circle cx="24" cy="36" r="4" fill="#181c22"/><circle cx="34" cy="36" r="4" fill="#181c22"/></svg>`,
  medium_tank: `<svg viewBox="0 0 48 48"><rect x="9" y="24" width="30" height="11" rx="3" fill="#4b5866"/><rect x="15" y="16" width="16" height="9" rx="2" fill="#3b82f6"/><rect x="28" y="18.5" width="15" height="3.5" fill="#cbd5e1"/></svg>`,
  v2_launcher: `<svg viewBox="0 0 48 48"><rect x="8" y="28" width="32" height="9" rx="2" fill="#525f6e"/><path d="M12 28l18-17 6 6-18 17z" fill="#f1f5f9"/><path d="M30 11l8-3-2 9z" fill="#ef4444"/><circle cx="14" cy="37" r="3.5" fill="#181c22"/><circle cx="24" cy="37" r="3.5" fill="#181c22"/><circle cx="34" cy="37" r="3.5" fill="#181c22"/></svg>`,
  mammoth_tank: `<svg viewBox="0 0 48 48"><rect x="6" y="24" width="36" height="13" rx="3" fill="#465261"/><rect x="11" y="14" width="20" height="12" rx="2" fill="#2563eb"/><rect x="28" y="15.5" width="16" height="3.2" fill="#e2e8f0"/><rect x="28" y="20.5" width="16" height="3.2" fill="#e2e8f0"/></svg>`,
  kirov: `<svg viewBox="0 0 48 48"><ellipse cx="25" cy="21" rx="18" ry="9" fill="#d4c7aa"/><path d="M32 13a18 9 0 0 1 11 8 18 9 0 0 1-11 8z" fill="#ef4444"/><polygon points="5,13 13,18 13,24 5,29" fill="#ef4444"/><rect x="17" y="30" width="14" height="5" rx="1.5" fill="#334155"/></svg>`,
};

export class HUDController {
  private activeTab: 'buildings' | 'units' = 'buildings';
  private displayedCredits = 5000;
  private evaTimeout: number | null = null;

  private readonly creditsEl = document.getElementById('credits-value')!;
  private readonly powerFillEl = document.getElementById('power-fill')!;
  private readonly powerMarkerEl = document.getElementById('power-drain-marker')!;
  private readonly powerTextEl = document.getElementById('power-text')!;
  private readonly buildGridEl = document.getElementById('build-grid')!;
  private readonly tooltipEl = document.getElementById('build-tooltip')!;
  private readonly selectionPanelEl = document.getElementById('selection-panel')!;
  private readonly evaBannerEl = document.getElementById('eva-banner')!;
  private readonly waveStatusEl = document.getElementById('wave-status')!;
  private readonly mapSubtitleEl = document.getElementById('map-subtitle')!;
  private readonly matchClockEl = document.getElementById('match-clock')!;
  private readonly telemetryEl = document.getElementById('empire-telemetry')!;
  private readonly minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
  private readonly minimapCtx = this.minimapCanvas.getContext('2d')!;
  private readonly helpModal = document.getElementById('help-modal')!;
  private readonly gameOverModal = document.getElementById('gameover-modal')!;
  private readonly mpModal = document.getElementById('mp-modal')!;
  private readonly mpBtn = document.getElementById('btn-mp')!;
  private readonly mpStatusPill = document.getElementById('mp-status-pill')!;
  private readonly mpErrorEl = document.getElementById('mp-error')!;
  private readonly mpLobbyIdle = document.getElementById('mp-lobby-idle')!;
  private readonly mpLobbyActive = document.getElementById('mp-lobby-active')!;
  private readonly mpRoomCodeEl = document.getElementById('mp-room-code')!;
  private readonly mpFactionLabelEl = document.getElementById('mp-faction-label')!;
  private readonly mpInviteUrlInput = document.getElementById('mp-invite-url') as HTMLInputElement;
  private readonly mpCodeInput = document.getElementById('mp-code-input') as HTMLInputElement;
  private readonly mpCopyBtn = document.getElementById('btn-mp-copy')!;
  private readonly speedBtn = document.getElementById('btn-speed')!;
  private readonly pauseBtn = document.getElementById('btn-pause')!;
  private readonly mapSelect = document.getElementById('select-map') as HTMLSelectElement;
  private readonly aiSelect = document.getElementById('select-ai') as HTMLSelectElement;
  private readonly repairBtn = document.getElementById('btn-tool-repair')!;
  private readonly sellBtn = document.getElementById('btn-tool-sell')!;
  private readonly swAirstrikeBtn = document.getElementById('btn-sw-airstrike')!;
  private readonly swAirstrikeTime = document.getElementById('sw-airstrike-time')!;
  private readonly swIronBtn = document.getElementById('btn-sw-iron')!;
  private readonly swIronTime = document.getElementById('sw-iron-time')!;
  private readonly swNukeBtn = document.getElementById('btn-sw-nuke')!;
  private readonly swNukeTime = document.getElementById('sw-nuke-time')!;
  private readonly chatBoxEl = document.getElementById('chat-box')!;
  private readonly chatLogEl = document.getElementById('chat-log')!;
  private readonly chatInputEl = document.getElementById('chat-input') as HTMLInputElement;

  private readonly radarPings: Array<{ x: number; z: number; time: number }> = [];
  lastAlertPos: Vec2 | null = null;

  private minimapDragging = false;
  private minimapTerrainCache: HTMLCanvasElement | null = null;
  private cardButtons = new Map<string, HTMLButtonElement>();

  constructor(private readonly cb: HUDCallbacks) {
    document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchTab((btn.dataset.tab as 'buildings' | 'units') ?? 'buildings');
      });
    });

    this.mapSelect.addEventListener('change', () => {
      cb.onChangeMap(this.mapSelect.value as MapPreset);
    });
    this.aiSelect.addEventListener('change', () => {
      cb.onChangeDifficulty(this.aiSelect.value as AIDifficulty);
    });

    document.getElementById('btn-home')!.addEventListener('click', () => cb.onHomeClick());
    this.speedBtn.addEventListener('click', () => {
      const s = cb.onToggleSpeed();
      this.speedBtn.textContent = `${s}x`;
      this.speedBtn.classList.toggle('active', s > 1);
    });
    this.pauseBtn.addEventListener('click', () => {
      const paused = cb.onTogglePause();
      this.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      this.pauseBtn.classList.toggle('active', paused);
    });
    const fogBtn = document.getElementById('btn-fog')!;
    fogBtn.addEventListener('click', () => {
      const on = cb.onToggleFog();
      fogBtn.textContent = on ? 'Fog: ON' : 'Fog: OFF';
      fogBtn.classList.toggle('active', on);
    });
    const musicBtn = document.getElementById('btn-music')!;
    musicBtn.addEventListener('click', () => {
      const on = cb.onToggleMusic();
      musicBtn.textContent = on ? 'Music: ON' : 'Music: OFF';
      musicBtn.classList.toggle('active', on);
    });
    const audioBtn = document.getElementById('btn-audio')!;
    audioBtn.addEventListener('click', () => {
      const on = cb.onToggleAudio();
      audioBtn.textContent = on ? 'SFX: ON' : 'SFX: OFF';
      audioBtn.classList.toggle('active', on);
    });

    // Repair / Sell tools
    this.repairBtn.addEventListener('click', () => cb.onToggleToolMode('repair'));
    this.sellBtn.addEventListener('click', () => cb.onToggleToolMode('sell'));

    // Superweapons
    this.swAirstrikeBtn.addEventListener('click', () => cb.onArmSuperweapon('airstrike'));
    this.swIronBtn.addEventListener('click', () => cb.onArmSuperweapon('iron_curtain'));
    this.swNukeBtn.addEventListener('click', () => cb.onArmSuperweapon('nuke'));

    // 1v1 Chat input
    this.chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.chatInputEl.value.trim();
        if (text) {
          cb.onSendChat(text);
          this.chatInputEl.value = '';
        }
        this.chatInputEl.blur();
      } else if (e.key === 'Escape') {
        this.chatInputEl.blur();
      }
    });

    // Quick select
    document.getElementById('btn-sel-army')!.addEventListener('click', () => cb.onQuickSelect('army'));
    document.getElementById('btn-sel-idle')!.addEventListener('click', () => cb.onQuickSelect('idle'));
    document.getElementById('btn-sel-harv')!.addEventListener('click', () => cb.onQuickSelect('harvesters'));

    document.getElementById('btn-help')!.addEventListener('click', () => {
      this.helpModal.classList.toggle('hidden');
    });
    document.getElementById('btn-close-help')!.addEventListener('click', () => {
      this.helpModal.classList.add('hidden');
    });
    document.getElementById('btn-restart')!.addEventListener('click', () => {
      this.gameOverModal.classList.add('hidden');
      cb.onRestart();
    });

    // Multiplayer Lobby modal
    this.mpBtn.addEventListener('click', () => {
      this.mpErrorEl.classList.add('hidden');
      this.mpModal.classList.toggle('hidden');
    });
    document.getElementById('btn-close-mp')!.addEventListener('click', () => {
      this.mpModal.classList.add('hidden');
    });
    document.getElementById('btn-mp-host')!.addEventListener('click', () => {
      this.mpErrorEl.classList.add('hidden');
      cb.onHostMultiplayer();
    });
    document.getElementById('btn-mp-join')!.addEventListener('click', () => {
      this.mpErrorEl.classList.add('hidden');
      cb.onJoinMultiplayer(this.mpCodeInput.value);
    });
    this.mpCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.mpErrorEl.classList.add('hidden');
        cb.onJoinMultiplayer(this.mpCodeInput.value);
      }
    });
    document.getElementById('btn-mp-leave')!.addEventListener('click', () => {
      cb.onLeaveMultiplayer();
    });
    this.mpCopyBtn.addEventListener('click', async () => {
      const url = this.mpInviteUrlInput.value;
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        this.mpInviteUrlInput.select();
        document.execCommand('copy');
      }
      this.mpCopyBtn.textContent = 'COPIED!';
      window.setTimeout(() => {
        this.mpCopyBtn.textContent = 'COPY LINK';
      }, 1600);
    });

    // Interactive Minimap (LMB = pan camera, RMB = quick Move / Shift+RMB Attack-Move!)
    const handleMiniPointer = (e: MouseEvent) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      cb.onMinimapClick(nx * WORLD_SIZE, ny * WORLD_SIZE);
    };
    this.minimapCanvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = this.minimapCanvas.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      cb.onMinimapRightClick(nx * WORLD_SIZE, ny * WORLD_SIZE, e.shiftKey || e.altKey);
    });
    this.minimapCanvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.minimapDragging = true;
      handleMiniPointer(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (this.minimapDragging) handleMiniPointer(e);
    });
    window.addEventListener('mouseup', () => {
      this.minimapDragging = false;
    });

    this.rebuildCards();
  }

  switchTab(tab: 'buildings' | 'units'): void {
    this.activeTab = tab;
    document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    this.rebuildCards();
  }

  setMapSelection(preset: MapPreset): void {
    this.mapSelect.value = preset;
  }

  private rebuildCards(): void {
    this.buildGridEl.innerHTML = '';
    this.cardButtons.clear();

    const items = this.activeTab === 'buildings' ? BUILDABLE_BUILDINGS : BUILDABLE_UNITS;
    for (const id of items) {
      const isBuilding = this.activeTab === 'buildings';
      const spec = isBuilding
        ? BUILDING_SPECS[id as BuildingType]
        : UNIT_SPECS[id as UnitType];

      const btn = document.createElement('button');
      btn.className = 'build-card';
      btn.innerHTML = `
        <div class="card-icon">${ICONS[id]}</div>
        <div class="card-name">${spec.shortName}</div>
        <div class="card-cost">$${spec.cost}</div>
        <div class="card-progress"></div>
        <div class="card-badge hidden"></div>
      `;

      btn.addEventListener('click', (e) => {
        if (isBuilding) this.cb.onClickBuilding(id as BuildingType);
        else this.cb.onClickUnit(id as UnitType, e.shiftKey ? 5 : 1);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (isBuilding) this.cb.onCancelBuilding();
        else this.cb.onCancelUnit(id as UnitType);
      });
      btn.addEventListener('mouseenter', () => {
        const extra = isBuilding
          ? `Power: ${(spec as typeof BUILDING_SPECS[BuildingType]).powerDelta >= 0 ? '+' : ''}${(spec as typeof BUILDING_SPECS[BuildingType]).powerDelta}`
          : `HP: ${spec.maxHp} | Shift+Click ×5`;
        this.tooltipEl.innerHTML = `<strong>${spec.name}</strong> ($${spec.cost}) — ${extra}<br/><span>${spec.description}</span>`;
      });

      this.buildGridEl.appendChild(btn);
      this.cardButtons.set(id, btn);
    }
  }

  showEvaBanner(text: string, alert = false): void {
    this.evaBannerEl.textContent = text.toUpperCase();
    this.evaBannerEl.classList.remove('hidden', 'alert');
    if (alert) this.evaBannerEl.classList.add('alert');
    if (this.evaTimeout) window.clearTimeout(this.evaTimeout);
    this.evaTimeout = window.setTimeout(() => {
      this.evaBannerEl.classList.add('hidden');
    }, 3600);
  }

  openMultiplayerModal(): void {
    this.mpModal.classList.remove('hidden');
  }

  closeMultiplayerModal(): void {
    this.mpModal.classList.add('hidden');
  }

  showMultiplayerError(msg: string): void {
    this.mpErrorEl.textContent = msg;
    this.mpErrorEl.classList.remove('hidden');
    this.mpModal.classList.remove('hidden');
  }

  appendChatMessage(from: Faction | 'system', text: string): void {
    const line = document.createElement('div');
    line.className = `chat-line ${from}`;
    if (from === 'system') {
      line.textContent = text;
    } else {
      const label = from === 'allies' ? 'ALLIES' : 'SOVIETS';
      const b = document.createElement('b');
      b.textContent = `[${label}] `;
      line.appendChild(b);
      line.appendChild(document.createTextNode(text));
    }
    this.chatLogEl.appendChild(line);
    while (this.chatLogEl.children.length > 24) {
      this.chatLogEl.firstChild?.remove();
    }
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  focusChatInput(): void {
    if (!this.chatBoxEl.classList.contains('hidden')) {
      this.chatInputEl.focus();
    }
  }

  updateMultiplayerStatus(
    mode: MultiplayerMode,
    roomId: string | null,
    faction: Faction,
    inviteUrl: string | null,
    latencyMs: number | null,
    info?: string
  ): void {
    this.mpBtn.classList.remove('live', 'waiting');
    const isGuest = mode === 'guest_joining' || mode === 'guest_live';
    const isLive = mode === 'hosting_live' || mode === 'guest_live';

    this.speedBtn.style.display = isLive || isGuest ? 'none' : '';
    this.pauseBtn.style.display = isGuest ? 'none' : '';
    this.aiSelect.style.display = mode === 'solo' ? '' : 'none';
    this.mapSelect.disabled = isGuest;
    this.chatBoxEl.classList.toggle('hidden', !isLive);

    if (mode === 'solo') {
      this.mpBtn.textContent = '1v1 Multiplayer';
      this.mpStatusPill.textContent = info
        ? `SOLO // ${info.toUpperCase()}`
        : 'MODE: SOLO SKIRMISH (VS AI)';
      this.mpLobbyIdle.classList.remove('hidden');
      this.mpLobbyActive.classList.add('hidden');
      return;
    }

    this.mpLobbyIdle.classList.add('hidden');
    this.mpLobbyActive.classList.remove('hidden');
    this.mpRoomCodeEl.textContent = roomId ?? '------';
    this.mpFactionLabelEl.textContent = faction === 'allies' ? 'ALLIES (BLUE)' : 'SOVIETS (RED)';
    this.mpFactionLabelEl.style.color = faction === 'allies' ? '#60a5fa' : '#ff5c5c';
    this.mpInviteUrlInput.value = inviteUrl ?? '';

    if (mode === 'hosting_wait') {
      this.mpBtn.textContent = `WAIT · ${roomId}`;
      this.mpBtn.classList.add('waiting');
      this.mpStatusPill.textContent = `HOSTING ROOM ${roomId} // WAITING FOR OPPONENT...`;
    } else if (mode === 'guest_joining') {
      this.mpBtn.textContent = `JOINING · ${roomId}`;
      this.mpBtn.classList.add('waiting');
      this.mpStatusPill.textContent = `CONNECTING TO ROOM ${roomId}...`;
    } else {
      const pingTxt = latencyMs !== null ? ` · ${latencyMs}ms` : '';
      this.mpBtn.textContent = `1v1 LIVE${pingTxt}`;
      this.mpBtn.classList.add('live');
      const role = faction === 'allies' ? 'HOST (ALLIES)' : 'GUEST (SOVIETS)';
      this.mpStatusPill.textContent = `LIVE 1v1 // ${role} // ROOM ${roomId}${pingTxt}`;
    }
  }

  handleSimEvents(events: SimEvent[], world: GameWorld): void {
    for (const ev of events) {
      if (ev.type === 'radar_alert' && ev.faction === world.localFaction) {
        this.radarPings.push({ x: ev.x, z: ev.z, time: performance.now() });
        this.lastAlertPos = { x: ev.x, z: ev.z };
      } else if (ev.type === 'eva' && ev.faction === world.localFaction) {
        const isAlert =
          ev.code === 'low_power' ||
          ev.code === 'base_under_attack' ||
          ev.code === 'cannot_deploy' ||
          ev.code === 'insufficient_funds' ||
          ev.code === 'nuke_detected' ||
          ev.code === 'kirov_reporting';
        this.showEvaBanner(ev.text, isAlert);
      } else if (ev.type === 'game_over') {
        this.showGameOver(ev.winner, world);
      }
    }
  }

  private showGameOver(winner: Faction, world: GameWorld): void {
    const title = document.getElementById('gameover-title')!;
    const sub = document.getElementById('gameover-subtitle')!;
    const statsEl = document.getElementById('gameover-stats')!;
    const won = winner === world.localFaction;

    if (won) {
      title.textContent = 'MISSION ACCOMPLISHED';
      title.style.color = '#3bf095';
      sub.textContent =
        world.localFaction === 'allies'
          ? 'Soviet command structures neutralized. Sector secured.'
          : 'Allied command crushed. Soviet armor controls the sector.';
    } else {
      title.textContent = 'MISSION FAILED';
      title.style.color = '#ff4b4b';
      sub.textContent =
        world.localFaction === 'allies'
          ? 'Allied command lost. Soviet armored columns control the sector.'
          : 'Soviet base destroyed. Allied forces have secured the sector.';
    }

    const s = world.players[world.localFaction].stats;
    const mins = Math.floor(world.simTime / 60);
    const secs = Math.floor(world.simTime % 60)
      .toString()
      .padStart(2, '0');
    statsEl.innerHTML = `
      <div><span>Elapsed Time</span><strong>${mins}:${secs}</strong></div>
      <div><span>Units Deployed</span><strong>${s.unitsBuilt}</strong></div>
      <div><span>Enemies Destroyed</span><strong>${s.enemiesDestroyed}</strong></div>
      <div><span>Ore Harvested</span><strong>$${Math.round(s.creditsHarvested)}</strong></div>
    `;
    this.gameOverModal.classList.remove('hidden');
  }

  update(
    world: GameWorld,
    statusFooterText: string,
    selectedUnitIds: Set<number>,
    selectedBuildingId: number | null,
    placingBuilding: boolean,
    toolMode: CursorToolMode,
    armedSuperweapon: SuperweaponType | null,
    camCorners: Vec2[]
  ): void {
    const faction = world.localFaction;
    const p = world.players[faction];

    this.mapSubtitleEl.textContent = world.map.theme.name.toUpperCase();
    const mins = Math.floor(world.simTime / 60)
      .toString()
      .padStart(2, '0');
    const secs = Math.floor(world.simTime % 60)
      .toString()
      .padStart(2, '0');
    this.matchClockEl.textContent = `${mins}:${secs}`;

    // Live Empire Telemetry readout
    let armyCount = 0;
    for (const u of world.units.values()) {
      if (u.faction === faction && u.type !== 'harvester') armyCount++;
    }
    let oilHeld = 0;
    for (const d of world.derricks.values()) {
      if (d.owner === faction) oilHeld++;
    }
    this.telemetryEl.textContent = `ARMY ${armyCount} · OIL ${oilHeld}/${world.derricks.size} · KILLS ${p.stats.enemiesDestroyed}`;

    this.repairBtn.classList.toggle('active', toolMode === 'repair');
    this.sellBtn.classList.toggle('active', toolMode === 'sell');

    // Update Superweapon Command Dock
    this.updateSuperweaponCard(
      this.swAirstrikeBtn,
      this.swAirstrikeTime,
      p.superweapons.airstrike,
      'BUILD TECH',
      armedSuperweapon === 'airstrike',
      false
    );
    this.updateSuperweaponCard(
      this.swIronBtn,
      this.swIronTime,
      p.superweapons.iron_curtain,
      'BUILD TECH',
      armedSuperweapon === 'iron_curtain',
      false
    );
    this.updateSuperweaponCard(
      this.swNukeBtn,
      this.swNukeTime,
      p.superweapons.nuke,
      'BUILD SILO',
      armedSuperweapon === 'nuke',
      p.powerRatio < 1
    );

    const diff = p.credits - this.displayedCredits;
    this.displayedCredits += Math.abs(diff) < 3 ? diff : diff * 0.25;
    this.creditsEl.textContent = `$${Math.round(this.displayedCredits)}`;

    const maxScale = Math.max(200, p.powerProduced, p.powerConsumed) * 1.15;
    const prodPct = Math.min(100, (p.powerProduced / maxScale) * 100);
    const drainPct = Math.min(100, (p.powerConsumed / maxScale) * 100);
    this.powerFillEl.style.height = `${prodPct}%`;
    this.powerMarkerEl.style.bottom = `${drainPct}%`;

    const lowPower = p.powerProduced < p.powerConsumed;
    const tightPower = !lowPower && p.powerProduced < p.powerConsumed + 30;
    this.powerFillEl.style.background = lowPower
      ? 'linear-gradient(to top, #b91c1c, #ff4b4b)'
      : tightPower
      ? 'linear-gradient(to top, #c27803, #f5b82e)'
      : 'linear-gradient(to top, #15803d, #3bf095)';
    this.powerTextEl.textContent = `${p.powerProduced}/${p.powerConsumed}`;
    this.powerTextEl.style.color = lowPower ? '#ff5c5c' : '#94a3b8';

    for (const [id, btn] of this.cardButtons) {
      const progressEl = btn.querySelector('.card-progress') as HTMLElement;
      const badgeEl = btn.querySelector('.card-badge') as HTMLElement;

      if (this.activeTab === 'buildings') {
        const bType = id as BuildingType;
        const spec = BUILDING_SPECS[bType];
        const atLimit = !!spec.maxCount && world.countFactionBuilding(faction, bType) >= spec.maxCount;
        const unlocked = world.hasPrerequisites(faction, spec.requires) && !atLimit;
        btn.classList.toggle('locked', !unlocked);

        const active = p.buildingProd?.type === bType;
        const ready = active && p.buildingProd!.ready;
        btn.classList.toggle('building-active', active && !ready);
        btn.classList.toggle('building-ready', ready);
        btn.classList.toggle('placing', ready && placingBuilding);

        progressEl.style.height = active ? `${Math.round(p.buildingProd!.progress * 100)}%` : '0%';
        if (ready) {
          badgeEl.textContent = placingBuilding ? 'PLACE' : 'READY';
          badgeEl.classList.remove('hidden');
        } else if (atLimit) {
          badgeEl.textContent = 'BUILT';
          badgeEl.classList.remove('hidden');
        } else {
          badgeEl.classList.add('hidden');
        }
      } else {
        const uType = id as UnitType;
        const unlocked = world.hasPrerequisites(faction, UNIT_SPECS[uType].requires);
        btn.classList.toggle('locked', !unlocked);

        const active = p.unitProd?.type === uType;
        const queuedCount =
          (active ? 1 : 0) + (p.unitProd?.queue.filter((q) => q === uType).length ?? 0);
        btn.classList.toggle('building-active', active);
        progressEl.style.height = active ? `${Math.round(p.unitProd!.progress * 100)}%` : '0%';
        if (queuedCount > 0) {
          badgeEl.textContent = `×${queuedCount}`;
          badgeEl.classList.remove('hidden');
        } else {
          badgeEl.classList.add('hidden');
        }
      }
    }

    this.renderSelectionPanel(world, selectedUnitIds, selectedBuildingId);

    this.waveStatusEl.textContent = lowPower
      ? '⚠ LOW POWER — BUILD POWER PLANT'
      : statusFooterText;
    this.waveStatusEl.classList.toggle('warn', lowPower);

    this.renderMinimap(world, camCorners);
  }

  private updateSuperweaponCard(
    btn: HTMLElement,
    timerEl: HTMLElement,
    sw: { unlocked: boolean; cooldown: number },
    lockedText: string,
    armed: boolean,
    offline: boolean
  ): void {
    const ready = sw.unlocked && sw.cooldown <= 0.05 && !offline;
    btn.classList.toggle('locked', !sw.unlocked);
    btn.classList.toggle('ready', ready);
    btn.classList.toggle('armed', armed);

    if (!sw.unlocked) {
      timerEl.textContent = lockedText;
    } else if (offline) {
      timerEl.textContent = 'LOW POWER';
    } else if (armed) {
      timerEl.textContent = 'CLICK TARGET';
    } else if (ready) {
      timerEl.textContent = 'READY — FIRE!';
    } else {
      const s = Math.ceil(sw.cooldown);
      const m = Math.floor(s / 60);
      const r = (s % 60).toString().padStart(2, '0');
      timerEl.textContent = `${m}:${r}`;
    }
  }

  private renderSelectionPanel(
    world: GameWorld,
    selectedUnitIds: Set<number>,
    selectedBuildingId: number | null
  ): void {
    if (selectedUnitIds.size > 0) {
      const counts = new Map<UnitType, number>();
      let hpSum = 0;
      let maxHpSum = 0;
      let maxRank = 0;
      for (const id of selectedUnitIds) {
        const u = world.units.get(id);
        if (!u) continue;
        counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
        hpSum += u.hp;
        maxHpSum += u.maxHp;
        if (u.rank > maxRank) maxRank = u.rank;
      }
      const summary = Array.from(counts.entries())
        .map(([t, c]) => `${c}× ${UNIT_SPECS[t].shortName}`)
        .join(' · ');
      const pct = maxHpSum > 0 ? Math.round((hpSum / maxHpSum) * 100) : 0;
      const rankTag = maxRank === 2 ? ' <span class="red-text">★★★</span>' : maxRank === 1 ? ' <span class="amber-text">★</span>' : '';
      this.selectionPanelEl.innerHTML = `<span class="sel-title">SELECTED (${selectedUnitIds.size})</span>${rankTag} <span class="sel-detail">${summary}</span> <span class="sel-hp">HP ${pct}%</span>`;
    } else if (selectedBuildingId) {
      const b = world.buildings.get(selectedBuildingId);
      if (b) {
        const spec = BUILDING_SPECS[b.type];
        const rallyNote =
          b.type === 'barracks' || b.type === 'warfactory'
            ? ' · Right-click ground to set Rally'
            : '';
        const repNote = b.repairing ? ' · REPAIRING' : '';
        this.selectionPanelEl.innerHTML = `<span class="sel-title">${spec.name.toUpperCase()}</span> <span class="sel-hp">HP ${Math.round(b.hp)}/${b.maxHp}${repNote}</span><span class="sel-detail">${rallyNote}</span>`;
      } else {
        this.selectionPanelEl.innerHTML = '';
      }
    } else {
      this.selectionPanelEl.innerHTML = `<span class="sel-detail">Capture flank Oil Derricks (+$45/2s), grab glowing Crates, and build a Tech Center!</span>`;
    }
  }

  private ensureMinimapTerrainCache(world: GameWorld): void {
    if (this.minimapTerrainCache) return;
    const c = document.createElement('canvas');
    c.width = MAP_SIZE;
    c.height = MAP_SIZE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    const preset = world.map.preset;

    for (let gz = 0; gz < MAP_SIZE; gz++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const idx = gz * MAP_SIZE + gx;
        const o = idx * 4;
        if (!world.map.walkable[idx]) {
          img.data[o] = preset === 'arctic' ? 88 : preset === 'volcanic' ? 54 : 102;
          img.data[o + 1] = preset === 'arctic' ? 102 : preset === 'volcanic' ? 38 : 68;
          img.data[o + 2] = preset === 'arctic' ? 120 : preset === 'volcanic' ? 38 : 48;
        } else if (world.map.roadMask[idx] > 0.35) {
          img.data[o] = 66;
          img.data[o + 1] = 66;
          img.data[o + 2] = 72;
        } else {
          img.data[o] = preset === 'arctic' ? 196 : preset === 'volcanic' ? 92 : 166;
          img.data[o + 1] = preset === 'arctic' ? 210 : preset === 'volcanic' ? 72 : 132;
          img.data[o + 2] = preset === 'arctic' ? 224 : preset === 'volcanic' ? 66 : 94;
        }
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.minimapTerrainCache = c;
  }

  private renderMinimap(world: GameWorld, camCorners: Vec2[]): void {
    this.ensureMinimapTerrainCache(world);
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const scaleX = w / WORLD_SIZE;
    const scaleY = h / WORLD_SIZE;

    ctx.drawImage(this.minimapTerrainCache!, 0, 0, w, h);

    const tilePx = w / MAP_SIZE;
    for (let gz = 0; gz < MAP_SIZE; gz++) {
      for (let gx = 0; gx < MAP_SIZE; gx++) {
        const idx = gz * MAP_SIZE + gx;
        if (world.map.ore[idx] > 20) {
          ctx.fillStyle = world.map.isGem[idx] ? '#ff4c75' : '#f5b82e';
          ctx.fillRect(gx * tilePx, gz * tilePx, Math.ceil(tilePx), Math.ceil(tilePx));
        }
      }
    }

    // Oil Derricks on minimap (diamond pips)
    for (const d of world.derricks.values()) {
      ctx.fillStyle = d.owner === 'allies' ? '#60a5fa' : d.owner === 'soviets' ? '#ff5c5c' : '#ffffff';
      ctx.fillRect(d.x * scaleX - 3, d.z * scaleY - 3, 6, 6);
    }

    // Crates on minimap
    for (const c of world.crates.values()) {
      ctx.fillStyle = '#fde047';
      ctx.fillRect(c.x * scaleX - 2, c.z * scaleY - 2, 4, 4);
    }

    for (const b of world.buildings.values()) {
      const tileIdx = Math.floor(b.z / TILE_SIZE) * MAP_SIZE + Math.floor(b.x / TILE_SIZE);
      if (b.faction !== world.localFaction && world.fogEnabled && world.fog[tileIdx] === 0) continue;
      const [fw, fh] = BUILDING_SPECS[b.type].footprint;
      ctx.fillStyle = b.faction === 'allies' ? '#4ca3ff' : '#ff4b4b';
      ctx.fillRect(b.gx * tilePx, b.gz * tilePx, Math.max(3, fw * tilePx), Math.max(3, fh * tilePx));
    }

    for (const u of world.units.values()) {
      if (u.faction !== world.localFaction && !world.isVisibleToPlayer(u.x, u.z)) continue;
      ctx.fillStyle = u.faction === 'allies' ? '#7cf7b8' : '#ff6b6b';
      ctx.fillRect(u.x * scaleX - 1.5, u.z * scaleY - 1.5, 3, 3);
    }

    if (world.fogEnabled) {
      for (let gz = 0; gz < MAP_SIZE; gz++) {
        for (let gx = 0; gx < MAP_SIZE; gx++) {
          const state = world.fog[gz * MAP_SIZE + gx];
          if (state === 2) continue;
          ctx.fillStyle = state === 1 ? 'rgba(8,10,14,0.42)' : 'rgba(8,10,14,0.88)';
          ctx.fillRect(gx * tilePx, gz * tilePx, Math.ceil(tilePx), Math.ceil(tilePx));
        }
      }
    }

    // Flashing red attack radar pings on minimap!
    const now = performance.now();
    for (let i = this.radarPings.length - 1; i >= 0; i--) {
      const rp = this.radarPings[i];
      const age = (now - rp.time) / 1000;
      if (age > 4.0) {
        this.radarPings.splice(i, 1);
        continue;
      }
      const radius = 4 + ((age * 2.2) % 1) * 16;
      ctx.strokeStyle = `rgba(255, 65, 65, ${Math.max(0.15, 1 - age / 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rp.x * scaleX, rp.z * scaleY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (camCorners.length === 4) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      camCorners.forEach((pt, idx) => {
        const mx = pt.x * scaleX;
        const my = pt.z * scaleY;
        if (idx === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  resetMinimapCache(): void {
    this.minimapTerrainCache = null;
  }
}
