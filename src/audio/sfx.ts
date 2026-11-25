import { DamageType, Faction, SimEvent } from '../sim/types';

/**
 * Zero-dependency Web Audio procedural SFX, EVA alerts, AND a Red Alert /
 * "Hell March"-inspired industrial rock synth sequencer!
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  enabled = true;
  musicEnabled = false;
  private lastShotTime = 0;
  private musicTimer: number | null = null;
  private musicStep = 0;

  private ensureContext(): AudioContext | null {
    if (!this.enabled && !this.musicEnabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.createNoiseBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  unlock(): void {
    this.ensureContext();
  }

  toggleMusic(): boolean {
    this.musicEnabled = !this.musicEnabled;
    if (this.musicEnabled) {
      this.ensureContext();
      this.startMusicLoop();
    } else {
      this.stopMusicLoop();
    }
    return this.musicEnabled;
  }

  private startMusicLoop(): void {
    this.stopMusicLoop();
    // 116 BPM sixteenth-note grid (~129ms per step) — classic stomping industrial march!
    const stepMs = Math.round((60 / 116 / 4) * 1000);
    // Driving minor-phrygian industrial riff (E1, E1, G1, E1, A1, G1, F1, E1...)
    const riff: Array<number | null> = [
      41.2, null, 41.2, 41.2, 49.0, null, 41.2, null,
      55.0, null, 49.0, null, 43.65, null, 41.2, null,
      41.2, null, 41.2, 41.2, 55.0, null, 49.0, null,
      61.74, null, 55.0, null, 49.0, 43.65, 41.2, null,
    ];

    this.musicTimer = window.setInterval(() => {
      if (!this.musicEnabled || !this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      const step = this.musicStep++ % 32;

      // Heavy industrial boot-stomp kick on beats 0, 4, 8, 12...
      if (step % 4 === 0 || step % 16 === 14) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, now);
        osc.frequency.exponentialRampToValueAtTime(34, now + 0.11);
        g.gain.setValueAtTime(0.11, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
      }

      // Metallic snare clap on beats 4 & 12
      if (step % 8 === 4 && this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1350;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.065, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
        src.connect(bp).connect(g).connect(this.ctx.destination);
        src.start(now);
        src.stop(now + 0.12);
      }

      // Gritty palm-muted sawtooth industrial guitar/bass riff
      const freq = riff[step];
      if (freq) {
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const lp = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc2.type = 'square';
        osc.frequency.value = freq;
        osc2.frequency.value = freq * 1.5; // Power chord fifth!
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(520, now);
        lp.frequency.exponentialRampToValueAtTime(180, now + 0.11);
        g.gain.setValueAtTime(0.055, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(lp);
        osc2.connect(lp);
        lp.connect(g).connect(this.ctx.destination);
        osc.start(now);
        osc2.start(now);
        osc.stop(now + 0.13);
        osc2.stop(now + 0.13);
      }
    }, stepMs);
  }

  private stopMusicLoop(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  playClick(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.045);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playOrderConfirm(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.setValueAtTime(740, now + 0.04);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  playBuildPlaced(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.24);
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playShot(damageType: DamageType): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastShotTime < 0.045) return;
    this.lastShotTime = now;

    if (damageType === 'tesla') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(980, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.26);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (damageType === 'shell') {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(175, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (damageType === 'rocket') {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1200, now);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.25);
    } else {
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      src.connect(filter).connect(g).connect(ctx.destination);
      src.start(now);
      src.stop(now + 0.06);
    }
  }

  playExplosion(scale: number): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const dur = Math.min(0.85, 0.2 + scale * 0.16);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(480, now);
    filter.frequency.exponentialRampToValueAtTime(65, now + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.32, 0.09 * scale), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  playJetFlyby(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, now);
    bp.frequency.exponentialRampToValueAtTime(280, now + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(0.2, now + 1.0);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2.4);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(now);
    src.stop(now + 2.45);
  }

  playNukeSiren(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      const t0 = now + i * 0.9;
      osc.frequency.setValueAtTime(420, t0);
      osc.frequency.linearRampToValueAtTime(760, t0 + 0.45);
      osc.frequency.linearRampToValueAtTime(420, t0 + 0.85);
      g.gain.setValueAtTime(0.09, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.88);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.9);
    }
  }

  playNukeDetonation(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const now = ctx.currentTime;

    // Massive sub-bass boom + prolonged thunderous roar
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(92, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 1.4);
    sg.gain.setValueAtTime(0.38, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    sub.connect(sg).connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 1.55);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.exponentialRampToValueAtTime(90, now + 2.2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.32, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 2.25);
    src.connect(lp).connect(ng).connect(ctx.destination);
    src.start(now);
    src.stop(now + 2.3);
  }

  playIronCurtain(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [110, 165, 220].forEach((freq) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.35, now + 0.65);
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
      osc.connect(g).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.75);
    });
  }

  playFanfare(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.08, now + i * 0.065);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.22);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.24);
    });
  }

  playCashDeposit(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.055, now + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.12);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.13);
    });
  }

  speakEva(text: string): void {
    if (!this.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.08;
      utter.pitch = 0.85;
      utter.volume = 0.55;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech restrictions gracefully
    }
  }

  handleSimEvents(events: SimEvent[], localFaction: Faction = 'allies'): void {
    for (const ev of events) {
      if (ev.type === 'shot') {
        this.playShot(ev.damageType);
      } else if (ev.type === 'explosion') {
        this.playExplosion(ev.scale);
      } else if (ev.type === 'building_placed') {
        this.playBuildPlaced();
      } else if (ev.type === 'building_sold' && ev.faction === localFaction) {
        this.playCashDeposit();
      } else if (ev.type === 'credits_deposited' && ev.faction === localFaction) {
        this.playCashDeposit();
      } else if (
        (ev.type === 'veterancy_up' || ev.type === 'crate_pickup' || ev.type === 'derrick_captured') &&
        ev.faction === localFaction
      ) {
        this.playFanfare();
      } else if (ev.type === 'airstrike_start') {
        this.playJetFlyby();
      } else if (ev.type === 'nuke_launched') {
        this.playNukeSiren();
      } else if (ev.type === 'nuke_impact') {
        this.playNukeDetonation();
      } else if (ev.type === 'iron_curtain_cast') {
        this.playIronCurtain();
      } else if (ev.type === 'eva' && ev.faction === localFaction) {
        if (
          ev.code === 'construction_complete' ||
          ev.code === 'low_power' ||
          ev.code === 'base_under_attack' ||
          ev.code === 'unit_ready' ||
          ev.code === 'superweapon_ready' ||
          ev.code === 'nuke_detected' ||
          ev.code === 'derrick_captured' ||
          ev.code === 'unit_promoted' ||
          ev.code === 'kirov_reporting' ||
          ev.code === 'iron_curtain'
        ) {
          this.speakEva(ev.text);
        }
      }
    }
  }
}
