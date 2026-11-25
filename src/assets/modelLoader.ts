import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Faction } from '../sim/types';

export interface AssetModelEntry {
  url: string;
  scale?: number;
  rotationY?: number;
  yOffset?: number;
  turretNodeName?: string;
  barrelNodeName?: string;
  teamColorMaterialPrefix?: string;
}

export interface AssetManifest {
  models?: Record<string, AssetModelEntry>;
  audio?: Record<string, string>;
}

interface LoadedModelRecord {
  entry: AssetModelEntry;
  scene: THREE.Group;
  sourceLabel: string;
}

export interface InstantiatedGlb {
  root: THREE.Group;
  turret?: THREE.Object3D;
  barrel?: THREE.Object3D;
}

const TEAM_COLORS: Record<Faction, number> = {
  allies: 0x2563eb,
  soviets: 0xdc2626,
};

/**
 * Loads optional external `.glb` / `.gltf` models declared in `/assets/manifest.json`
 * OR dropped in live at runtime via `registerLocalGlb()`.
 * Falls back cleanly to procedural PBR models whenever an entity has no custom override.
 */
export class AssetModelManager {
  private readonly loader = new GLTFLoader();
  private readonly loaded = new Map<string, LoadedModelRecord>();
  private readonly listeners = new Set<() => void>();
  private manifestLoaded = false;

  onUpdate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emitUpdate(): void {
    for (const cb of this.listeners) cb();
  }

  hasOverride(targetId: string): boolean {
    return this.loaded.has(targetId);
  }

  getLoadedOverrides(): Array<{ id: string; source: string }> {
    return Array.from(this.loaded.entries()).map(([id, rec]) => ({
      id,
      source: rec.sourceLabel,
    }));
  }

  clearOverride(targetId: string): void {
    if (this.loaded.delete(targetId)) {
      this.emitUpdate();
    }
  }

  clearAllOverrides(): void {
    if (this.loaded.size > 0) {
      this.loaded.clear();
      this.emitUpdate();
    }
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

    const entries = Object.entries(manifest.models ?? {});
    if (entries.length === 0) return;

    const results = await Promise.allSettled(
      entries.map(async ([targetId, entry]) => {
        if (!entry || typeof entry.url !== 'string' || !entry.url.trim()) return;
        const gltf = await this.loadGlbUrl(entry.url);
        this.loaded.set(targetId, {
          entry,
          scene: gltf.scene,
          sourceLabel: entry.url,
        });
      })
    );

    if (results.some((r) => r.status === 'fulfilled')) {
      this.emitUpdate();
    }
  }

  /**
   * Live drag-and-drop / file-picker override for testing custom `.glb` models in-game!
   */
  async registerLocalGlb(
    targetId: string,
    file: File,
    opts: Partial<AssetModelEntry> = {}
  ): Promise<void> {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      this.loader.parse(buffer, '', resolve, reject);
    });
    this.loaded.set(targetId, {
      entry: {
        url: file.name,
        scale: opts.scale ?? 1,
        rotationY: opts.rotationY ?? 0,
        yOffset: opts.yOffset ?? 0,
        turretNodeName: opts.turretNodeName,
        barrelNodeName: opts.barrelNodeName,
        teamColorMaterialPrefix: opts.teamColorMaterialPrefix,
      },
      scene: gltf.scene,
      sourceLabel: file.name,
    });
    this.emitUpdate();
  }

  private loadGlbUrl(url: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this.loader.load(url, resolve, undefined, reject);
    });
  }

  /**
   * Clones a loaded `.glb` scene with team-color tinting, auto-grounding (`y=0`),
   * shadow setup, and optional turret/barrel node extraction.
   */
  instantiate(
    targetId: string,
    faction: Faction,
    targetSpan?: number
  ): InstantiatedGlb | null {
    const record = this.loaded.get(targetId);
    if (!record) return null;

    const { entry, scene } = record;
    const wrapper = new THREE.Group();
    const clone = scene.clone(true);

    const prefix = (entry.teamColorMaterialPrefix ?? 'teamcolor').toLowerCase();
    const teamColor = TEAM_COLORS[faction];

    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      const applyTint = (mat: THREE.Material): THREE.Material => {
        const cloned = mat.clone();
        const name = (cloned.name ?? '').toLowerCase();
        if (
          (name.startsWith(prefix) || name.includes('team_color') || name.includes('teamcolor')) &&
          'color' in cloned &&
          cloned.color instanceof THREE.Color
        ) {
          cloned.color.setHex(teamColor);
        }
        return cloned;
      };

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(applyTint);
      } else if (obj.material) {
        obj.material = applyTint(obj.material);
      }
    });

    // Compute bounds to auto-normalize size if user didn't specify explicit scale,
    // and ground bottom edge cleanly at y = 0.
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    let finalScale = entry.scale ?? 1;
    if (entry.scale === undefined && targetSpan && targetSpan > 0) {
      const maxHoriz = Math.max(size.x, size.z, 0.001);
      finalScale = targetSpan / maxHoriz;
    }

    clone.scale.setScalar(finalScale);
    clone.position.set(
      -center.x * finalScale,
      -box.min.y * finalScale + (entry.yOffset ?? 0),
      -center.z * finalScale
    );
    if (entry.rotationY) {
      clone.rotation.y = entry.rotationY;
    }

    wrapper.add(clone);

    const turretName = entry.turretNodeName ?? 'Turret';
    const barrelName = entry.barrelNodeName ?? 'Barrel';
    const turret = clone.getObjectByName(turretName) ?? undefined;
    const barrel = clone.getObjectByName(barrelName) ?? undefined;

    return { root: wrapper, turret, barrel };
  }
}

export const assetModels = new AssetModelManager();
