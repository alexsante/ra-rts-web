import type { AssetManifest } from './modelLoader';

export type AudioCueKey =
  | 'click'
  | 'order'
  | 'build_placed'
  | 'shot_bullet'
  | 'shot_shell'
  | 'shot_rocket'
  | 'shot_tesla'
  | 'shot_prism'
  | 'explosion'
  | 'airstrike'
  | 'nuke_siren'
  | 'nuke_detonation'
  | 'iron_curtain'
  | 'chrono_warp'
  | 'fanfare'
  | 'cash';

/**
 * Loads optional custom audio clips (`.wav`, `.mp3`, `.ogg`) declared in `/assets/manifest.json`
 * or dropped in at runtime, decoding them into Web Audio `AudioBuffer`s with seamless fallback
 * to the built-in procedural synth when no override exists.
 */
export class AudioPackManager {
  private readonly rawBuffers = new Map<string, ArrayBuffer>();
  private readonly decoded = new Map<string, AudioBuffer>();
  private readonly decoding = new Set<string>();
  private manifestLoaded = false;

  getLoadedCues(): string[] {
    return Array.from(this.rawBuffers.keys());
  }

  async loadManifest(url = '/assets/manifest.json'): Promise<void> {
    if (this.manifestLoaded || typeof fetch === 'undefined') return;
    this.manifestLoaded = true;

    let manifest: AssetManifest;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      manifest = (await res.json()) as AssetManifest;
    } catch {
      return;
    }

    const entries = Object.entries(manifest.audio ?? {});
    if (entries.length === 0) return;

    await Promise.allSettled(
      entries.map(async ([cue, clipUrl]) => {
        if (typeof clipUrl !== 'string' || !clipUrl.trim()) return;
        const r = await fetch(clipUrl);
        if (!r.ok) return;
        const ab = await r.arrayBuffer();
        this.rawBuffers.set(cue, ab);
      })
    );
  }

  async registerLocalAudio(cue: AudioCueKey, file: File): Promise<void> {
    const ab = await file.arrayBuffer();
    this.rawBuffers.set(cue, ab);
    this.decoded.delete(cue);
  }

  clearOverride(cue: string): void {
    this.rawBuffers.delete(cue);
    this.decoded.delete(cue);
  }

  /**
   * Plays a custom clip if loaded & decoded for `cue`. Returns `true` if played,
   * or `false` so SoundEngine uses its procedural synthesizer fallback.
   */
  playIfAvailable(ctx: AudioContext, cue: AudioCueKey, volume = 0.5): boolean {
    const buf = this.decoded.get(cue);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(ctx.destination);
      src.start(ctx.currentTime);
      return true;
    }

    const raw = this.rawBuffers.get(cue);
    if (raw && !this.decoding.has(cue)) {
      this.decoding.add(cue);
      void ctx
        .decodeAudioData(raw.slice(0))
        .then((audioBuf) => {
          this.decoded.set(cue, audioBuf);
        })
        .catch(() => {
          this.rawBuffers.delete(cue);
        })
        .finally(() => {
          this.decoding.delete(cue);
        });
    }
    return false;
  }
}

export const audioPack = new AudioPackManager();
