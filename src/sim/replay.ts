import type { GameCommand } from '../net/protocol';
import { SkirmishAI } from './ai';
import { SIM_DT } from './config';
import type { Faction, MatchConfig } from './types';
import { GameWorld } from './world';

export interface ReplayCommandEntry {
  tick: number;
  faction: Faction;
  cmd: GameCommand;
}

export interface MatchReplay {
  version: 1;
  recordedAt: string;
  mode: 'solo' | '1v1';
  config: MatchConfig;
  durationTicks: number;
  winner: Faction | null;
  commands: ReplayCommandEntry[];
}

/**
 * Records every authoritative command tagged with exact simulation tick
 * so any Solo or 1v1 match can be exported as lightweight JSON and replayed.
 */
export class ReplayRecorder {
  private config: MatchConfig;
  private mode: 'solo' | '1v1';
  private commands: ReplayCommandEntry[] = [];
  private recordedAt = new Date().toISOString();

  constructor(config: MatchConfig, mode: 'solo' | '1v1') {
    this.config = structuredClone(config);
    this.mode = mode;
  }

  reset(config: MatchConfig, mode: 'solo' | '1v1'): void {
    this.config = structuredClone(config);
    this.mode = mode;
    this.commands = [];
    this.recordedAt = new Date().toISOString();
  }

  get count(): number {
    return this.commands.length;
  }

  record(tick: number, faction: Faction, cmd: GameCommand): void {
    this.commands.push({ tick, faction, cmd: structuredClone(cmd) });
  }

  finalize(durationTicks: number, winner: Faction | null): MatchReplay {
    return {
      version: 1,
      recordedAt: this.recordedAt,
      mode: this.mode,
      config: structuredClone(this.config),
      durationTicks: Math.max(durationTicks, 1),
      winner,
      commands: this.commands.map((c) => structuredClone(c)),
    };
  }

  exportReplay(world: GameWorld): MatchReplay {
    return this.finalize(world.tickCount, world.winner);
  }
}

/**
 * Deterministic replay playback engine with pause, variable speed, and scrubber seek.
 */
export class ReplayPlayer {
  readonly replay: MatchReplay;
  world: GameWorld;
  private ai: SkirmishAI | null = null;
  private cmdCursor = 0;
  paused = false;
  speed: 1 | 2 | 4 = 1;

  constructor(replay: MatchReplay) {
    this.replay = replay;
    this.world = this.createInitialWorld();
    this.initAI();
  }

  get playing(): boolean {
    return !this.paused;
  }

  set playing(val: boolean) {
    this.paused = !val;
  }

  get currentSeconds(): number {
    return this.world.tickCount * SIM_DT;
  }

  get totalSeconds(): number {
    return this.replay.durationTicks * SIM_DT;
  }

  get progressFraction(): number {
    return this.progress;
  }

  private createInitialWorld(): GameWorld {
    const w = new GameWorld(this.replay.config);
    w.fogEnabled = false; // Full spectator visibility by default during replay
    return w;
  }

  private initAI(): void {
    if (this.replay.mode === 'solo') {
      const aiFaction: Faction = this.replay.config.hostFaction === 'allies' ? 'soviets' : 'allies';
      this.ai = new SkirmishAI(this.replay.config.difficulty, aiFaction);
    } else {
      this.ai = null;
    }
  }

  get progress(): number {
    return Math.min(1, this.world.tickCount / Math.max(1, this.replay.durationTicks));
  }

  get finished(): boolean {
    return this.world.tickCount >= this.replay.durationTicks || this.world.winner !== null;
  }

  stepTick(): void {
    if (this.finished) return;
    while (
      this.cmdCursor < this.replay.commands.length &&
      this.replay.commands[this.cmdCursor].tick <= this.world.tickCount
    ) {
      const entry = this.replay.commands[this.cmdCursor++];
      this.world.executeCommand(entry.faction, entry.cmd);
    }
    if (this.ai) {
      this.ai.update(this.world, SIM_DT);
    }
    this.world.tick(SIM_DT);
  }

  seekToFraction(frac: number): void {
    const targetTick = Math.max(
      0,
      Math.min(this.replay.durationTicks, Math.round(frac * this.replay.durationTicks))
    );
    this.world = this.createInitialWorld();
    this.initAI();
    this.cmdCursor = 0;

    while (this.world.tickCount < targetTick && !this.world.winner) {
      this.stepTick();
      this.world.drainEvents(); // Discard transient VFX during fast-forward seek
    }
  }
}

export function parseReplayJson(raw: string): MatchReplay {
  const parsed = JSON.parse(raw) as Partial<MatchReplay>;
  if (parsed.version !== 1 || !parsed.config || !Array.isArray(parsed.commands)) {
    throw new Error('Invalid replay file format');
  }
  return parsed as MatchReplay;
}
