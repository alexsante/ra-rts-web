import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BUILD_RADIUS_TILES, BUILDING_SPECS, TILE_SIZE, UNIT_SPECS } from '../sim/config';
import { sampleTerrainHeight } from '../sim/mapGen';
import {
  BuildingType,
  Entity,
  SimEvent,
  SuperweaponType,
  UnitEntity,
  Vec2,
} from '../sim/types';
import { GameWorld } from '../sim/world';
import { createEnvironmentIBL } from './materials';
import {
  BuildingMeshHandle,
  DerrickMeshHandle,
  UnitMeshHandle,
  createBuildingMesh,
  createCrateMesh,
  createOilDerrickMesh,
  createUnitMesh,
} from './models';
import { TerrainVisuals, createTerrainVisuals } from './terrain';
import { getTacticalBadgeTexture } from './textures';
import { VFXManager } from './vfx';

interface BuildingVisual extends BuildingMeshHandle {
  selectRing: THREE.Mesh;
  hpBarBg: THREE.Mesh;
  hpBarFill: THREE.Mesh;
  smokeTimer: number;
}

interface FloatingCallout {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  age: number;
  maxAge: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly vfx: VFXManager;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private envTexture: THREE.Texture | null = null;
  private terrain: TerrainVisuals;
  private worldSize: number;

  camTarget = new THREE.Vector3(28, 0, 116);
  camDistance = 42;
  camPitch = 0.86;
  camYaw = 0.45;

  private readonly buildingVisuals = new Map<number, BuildingVisual>();
  private readonly unitVisuals = new Map<number, UnitMeshHandle>();
  private readonly projectileMeshes = new Map<number, THREE.Mesh>();
  private readonly crateMeshes = new Map<number, THREE.Group>();
  private readonly derrickVisuals = new Map<number, DerrickMeshHandle>();
  private readonly falloutMeshes = new Map<number, THREE.Mesh>();
  private readonly floatingCallouts: FloatingCallout[] = [];
  private readonly calloutLayer: HTMLDivElement;

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Building placement hologram + turret range preview ring + base build perimeter
  private placementGroup = new THREE.Group();
  private placementMesh: THREE.Group | null = null;
  private placementType: BuildingType | null = null;
  private placementFaction: string | null = null;
  private placementTileMesh: THREE.Mesh | null = null;
  private placementRangeRing: THREE.Mesh | null = null;
  private buildRadiusRing: THREE.Mesh;

  // Superweapon targeting reticle on 3D terrain
  private swReticleGroup = new THREE.Group();
  private swReticleOuter: THREE.Mesh;
  private swReticleInner: THREE.Mesh;
  private chronoSourceRing: THREE.Mesh;

  private rallyFlag: THREE.Group;

  private readonly shellGeo = new THREE.SphereGeometry(0.19, 6, 6);
  private readonly rocketGeo = new THREE.ConeGeometry(0.2, 0.88, 6);
  private readonly shellMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  private readonly eliteShellMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
  private readonly rocketMat = new THREE.MeshBasicMaterial({ color: 0xff6b2b });

  private elapsed = 0;
  private oreSyncTimer = 0;
  private dustTimer = 0;

  constructor(private readonly canvas: HTMLCanvasElement, world: GameWorld) {
    this.rocketGeo.rotateX(Math.PI / 2);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    const theme = world.map.theme;
    this.scene.background = new THREE.Color(theme.fogHex);
    this.scene.fog = new THREE.FogExp2(theme.fogHex, 0.0044);

    // Procedural sunlit PMREM IBL reflections so PBR armor, chrome, glass & copper shine realistically!
    this.envTexture = createEnvironmentIBL(this.renderer, theme);
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.85;

    this.worldSize = world.map.worldSize;
    this.camTarget.set(28, 0, this.worldSize - 28);

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, Math.max(380, this.worldSize * 2.8));

    this.hemiLight = new THREE.HemisphereLight(theme.hemiSkyHex, theme.hemiGroundHex, 0.92);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(theme.sunHex, theme.sunIntensity);
    const halfW = this.worldSize * 0.5;
    const shadowHalf = Math.max(88, this.worldSize * 0.62);
    this.sunLight.position.set(halfW + 45, Math.max(92, this.worldSize * 0.65), halfW + 46);
    this.sunLight.target.position.set(halfW, 0, halfW);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -shadowHalf;
    this.sunLight.shadow.camera.right = shadowHalf;
    this.sunLight.shadow.camera.top = shadowHalf;
    this.sunLight.shadow.camera.bottom = -shadowHalf;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = Math.max(280, this.worldSize * 2.2);
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const rim = new THREE.DirectionalLight(0x9bc4f0, 0.45);
    rim.position.set(-40, 45, -35);
    this.scene.add(rim);

    this.terrain = createTerrainVisuals(world.map);
    this.scene.add(this.terrain.group);

    this.vfx = new VFXManager(theme.dustHex, this.worldSize);
    this.scene.add(this.vfx.group);

    this.scene.add(this.placementGroup);

    // Base build-radius perimeter indicator shown while placing structures
    const br = BUILD_RADIUS_TILES * TILE_SIZE;
    this.buildRadiusRing = new THREE.Mesh(
      new THREE.RingGeometry(br - 0.35, br, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.buildRadiusRing.visible = false;
    this.scene.add(this.buildRadiusRing);

    // Superweapon targeting reticle
    this.swReticleOuter = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.swReticleInner = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.swReticleGroup.add(this.swReticleOuter, this.swReticleInner);
    this.swReticleGroup.visible = false;
    this.scene.add(this.swReticleGroup);

    // Locked Chronoshift source squad zone marker
    this.chronoSourceRing = new THREE.Mesh(
      new THREE.RingGeometry(8.4, 9.2, 44).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x38e8ff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.chronoSourceRing.visible = false;
    this.scene.add(this.chronoSourceRing);

    // Rally flag
    this.rallyFlag = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
    );
    pole.position.y = 1.3;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.6),
      new THREE.MeshBasicMaterial({ color: 0x3bf095, side: THREE.DoubleSide })
    );
    banner.position.set(0.55, 2.25, 0);
    this.rallyFlag.add(pole, banner);
    this.rallyFlag.visible = false;
    this.scene.add(this.rallyFlag);

    // Screen-projected floating world callout layer
    this.calloutLayer = document.createElement('div');
    this.calloutLayer.className = 'floating-callout-layer';
    this.canvas.parentElement?.appendChild(this.calloutLayer);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.36, 0.48, 0.84);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    this.focusOnBase(world);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }

  focusOnBase(world: GameWorld): void {
    const start =
      world.localFaction === 'allies' ? world.map.alliesStart : world.map.sovietsStart;
    let tx = (start.gx + 2) * TILE_SIZE;
    let tz = (start.gz + 1) * TILE_SIZE;
    for (const b of world.buildings.values()) {
      if (b.faction === world.localFaction && b.type === 'conyard') {
        tx = b.x;
        tz = b.z;
        break;
      }
    }
    this.camTarget.set(tx, 0, tz);
    this.updateCameraTransform();
  }

  panCamera(rightDelta: number, forwardDelta: number): void {
    const cos = Math.cos(this.camYaw);
    const sin = Math.sin(this.camYaw);
    const dx = rightDelta * cos - forwardDelta * sin;
    const dz = rightDelta * sin + forwardDelta * cos;
    this.camTarget.x = Math.max(8, Math.min(this.worldSize - 8, this.camTarget.x + dx));
    this.camTarget.z = Math.max(8, Math.min(this.worldSize - 8, this.camTarget.z + dz));
  }

  zoomCamera(delta: number): void {
    const maxZoom = Math.max(72, this.worldSize * 0.45);
    this.camDistance = Math.max(18, Math.min(maxZoom, this.camDistance + delta));
  }

  rotateCamera(deltaYaw: number): void {
    this.camYaw += deltaYaw;
  }

  setCameraTargetWorld(wx: number, wz: number): void {
    this.camTarget.x = Math.max(8, Math.min(this.worldSize - 8, wx));
    this.camTarget.z = Math.max(8, Math.min(this.worldSize - 8, wz));
  }

  getCameraGroundCorners(): Vec2[] {
    const ndcCorners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const pts: Vec2[] = [];
    const hit = new THREE.Vector3();
    for (const [nx, ny] of ndcCorners) {
      this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
        pts.push({ x: hit.x, z: hit.z });
      }
    }
    return pts;
  }

  private updateCameraTransform(): void {
    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const vert = Math.sin(this.camPitch) * this.camDistance;
    const ox = Math.sin(this.camYaw) * horiz;
    const oz = Math.cos(this.camYaw) * horiz;

    const shake = this.vfx.shakeIntensity;
    const sx = shake > 0.01 ? (Math.random() - 0.5) * shake * 1.1 : 0;
    const sy = shake > 0.01 ? (Math.random() - 0.5) * shake * 0.7 : 0;
    const sz = shake > 0.01 ? (Math.random() - 0.5) * shake * 1.1 : 0;

    this.camera.position.set(this.camTarget.x + ox + sx, vert + sy, this.camTarget.z + oz + sz);
    this.camera.lookAt(this.camTarget.x + sx * 0.5, 0.5, this.camTarget.z + sz * 0.5);
  }

  screenToWorld(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);

    const hits = this.raycaster.intersectObject(this.terrain.groundMesh, false);
    if (hits.length > 0) return hits[0].point;

    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, pt)) return pt;
    return null;
  }

  pickEntityAtScreen(world: GameWorld, clientX: number, clientY: number): Entity | null {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;

    let best: Entity | null = null;
    let bestDist = 30;
    const proj = new THREE.Vector3();

    for (const u of world.units.values()) {
      if (u.faction !== world.localFaction && !world.isVisibleToPlayer(u.x, u.z)) continue;
      const pickY = u.y + (UNIT_SPECS[u.type].isAir ? 7.6 : 0.9);
      proj.set(u.x, pickY, u.z).project(this.camera);
      if (proj.z > 1) continue;
      const px = (proj.x * 0.5 + 0.5) * rect.width;
      const py = (-proj.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(px - sx, py - sy);
      const hitRadius = UNIT_SPECS[u.type].radius * 22 + 12;
      if (d < hitRadius && d < bestDist) {
        bestDist = d;
        best = u;
      }
    }
    if (best) return best;

    const wp = this.screenToWorld(clientX, clientY);
    if (!wp) return null;
    for (const b of world.buildings.values()) {
      if (b.faction !== world.localFaction && !world.isVisibleToPlayer(b.x, b.z)) continue;
      const [fw, fh] = BUILDING_SPECS[b.type].footprint;
      if (
        Math.abs(wp.x - b.x) <= fw * TILE_SIZE * 0.55 &&
        Math.abs(wp.z - b.z) <= fh * TILE_SIZE * 0.55
      ) {
        return b;
      }
    }
    return null;
  }

  getUnitsInScreenBox(
    world: GameWorld,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number[] {
    const rect = this.canvas.getBoundingClientRect();
    const minX = Math.min(x1, x2) - rect.left;
    const maxX = Math.max(x1, x2) - rect.left;
    const minY = Math.min(y1, y2) - rect.top;
    const maxY = Math.max(y1, y2) - rect.top;

    const proj = new THREE.Vector3();
    const selected: number[] = [];

    for (const u of world.units.values()) {
      if (u.faction !== world.localFaction) continue;
      proj.set(u.x, u.y + (UNIT_SPECS[u.type].isAir ? 7.6 : 0.7), u.z).project(this.camera);
      if (proj.z > 1) continue;
      const px = (proj.x * 0.5 + 0.5) * rect.width;
      const py = (-proj.y * 0.5 + 0.5) * rect.height;
      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        selected.push(u.id);
      }
    }
    return selected;
  }

  getVisibleMatchingUnits(world: GameWorld, unitType: UnitEntity['type']): number[] {
    const proj = new THREE.Vector3();
    const ids: number[] = [];
    for (const u of world.units.values()) {
      if (u.faction !== world.localFaction || u.type !== unitType) continue;
      proj.set(u.x, u.y + 0.7, u.z).project(this.camera);
      if (proj.z <= 1 && Math.abs(proj.x) <= 1 && Math.abs(proj.y) <= 1) {
        ids.push(u.id);
      }
    }
    return ids;
  }

  updateSuperweaponReticle(
    weapon: SuperweaponType | null,
    worldPos: THREE.Vector3 | null,
    chronoSource?: Vec2 | null,
    world?: GameWorld
  ): void {
    if (!weapon || !worldPos) {
      this.swReticleGroup.visible = false;
      this.chronoSourceRing.visible = false;
      return;
    }
    const radius =
      weapon === 'nuke'
        ? 14.5
        : weapon === 'chronoshift'
        ? 9.0
        : weapon === 'iron_curtain'
        ? 8.0
        : 8.5;
    const col =
      weapon === 'nuke'
        ? 0xff2a2a
        : weapon === 'chronoshift'
        ? 0x38e8ff
        : weapon === 'iron_curtain'
        ? 0xe11d48
        : 0xf59e0b;
    (this.swReticleOuter.material as THREE.MeshBasicMaterial).color.setHex(col);
    (this.swReticleInner.material as THREE.MeshBasicMaterial).color.setHex(col);
    this.swReticleGroup.position.set(worldPos.x, worldPos.y + 0.25, worldPos.z);
    const pulse = 1 + Math.sin(this.elapsed * 8) * 0.04;
    this.swReticleGroup.scale.setScalar(radius * pulse);
    this.swReticleGroup.visible = true;

    if (weapon === 'chronoshift' && chronoSource && world) {
      const sy = sampleTerrainHeight(world.map, chronoSource.x, chronoSource.z);
      this.chronoSourceRing.position.set(chronoSource.x, sy + 0.26, chronoSource.z);
      this.chronoSourceRing.scale.setScalar(1 + Math.sin(this.elapsed * 10) * 0.04);
      this.chronoSourceRing.visible = true;
    } else {
      this.chronoSourceRing.visible = false;
    }
  }

  updatePlacementPreview(
    world: GameWorld,
    type: BuildingType | null,
    worldPos: THREE.Vector3 | null
  ): { gx: number; gz: number; valid: boolean } | null {
    if (!type || !worldPos) {
      this.placementGroup.visible = false;
      this.buildRadiusRing.visible = false;
      return null;
    }

    // Show base build perimeter around nearest friendly Construction Yard / building
    let anchor: { x: number; y: number; z: number } | null = null;
    for (const b of world.buildings.values()) {
      if (b.faction === world.localFaction && b.type === 'conyard') {
        anchor = b;
        break;
      }
    }
    if (anchor) {
      this.buildRadiusRing.position.set(anchor.x, anchor.y + 0.22, anchor.z);
      (this.buildRadiusRing.material as THREE.MeshBasicMaterial).color.setHex(
        world.localFaction === 'allies' ? 0x60a5fa : 0xff5c5c
      );
      this.buildRadiusRing.visible = true;
    } else {
      this.buildRadiusRing.visible = false;
    }

    if (this.placementType !== type || this.placementFaction !== world.localFaction) {
      this.placementGroup.clear();
      const handle = createBuildingMesh(type, world.localFaction);
      handle.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (o.userData.noShadow === true) {
            o.visible = false;
            return;
          }
          o.castShadow = false;
          o.receiveShadow = false;
          o.material = new THREE.MeshBasicMaterial({
            color: 0x3bf095,
            transparent: true,
            opacity: 0.48,
          });
        }
      });
      this.placementMesh = handle.root;

      const [fw, fh] = BUILDING_SPECS[type].footprint;
      const padGeo = new THREE.PlaneGeometry(fw * TILE_SIZE, fh * TILE_SIZE);
      padGeo.rotateX(-Math.PI / 2);
      this.placementTileMesh = new THREE.Mesh(
        padGeo,
        new THREE.MeshBasicMaterial({
          color: 0x3bf095,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      );
      this.placementTileMesh.position.y = 0.16;

      this.placementGroup.add(this.placementMesh, this.placementTileMesh);

      // Show exact weapon firing radius ring when placing Gun Turret or Tesla Coil!
      const weapon = BUILDING_SPECS[type].weapon;
      if (weapon) {
        const rangeGeo = new THREE.RingGeometry(weapon.range - 0.35, weapon.range, 48);
        rangeGeo.rotateX(-Math.PI / 2);
        this.placementRangeRing = new THREE.Mesh(
          rangeGeo,
          new THREE.MeshBasicMaterial({
            color: type === 'tesla' || type === 'prism' ? 0x38d9ff : 0xf5b82e,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        this.placementRangeRing.position.y = 0.22;
        this.placementGroup.add(this.placementRangeRing);
      } else {
        this.placementRangeRing = null;
      }

      this.placementType = type;
      this.placementFaction = world.localFaction;
    }

    const [fw, fh] = BUILDING_SPECS[type].footprint;
    const gx = Math.round(worldPos.x / TILE_SIZE - fw * 0.5);
    const gz = Math.round(worldPos.z / TILE_SIZE - fh * 0.5);
    const valid = world.canPlaceBuilding(world.localFaction, type, gx, gz);

    const cx = (gx + fw * 0.5) * TILE_SIZE;
    const cz = (gz + fh * 0.5) * TILE_SIZE;
    const cy = sampleTerrainHeight(world.map, cx, cz);

    this.placementGroup.position.set(cx, cy, cz);
    this.placementGroup.visible = true;

    const col = valid ? 0x35f08e : 0xff3b3b;
    if (this.placementMesh) {
      this.placementMesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          (o.material as THREE.MeshBasicMaterial).color.setHex(col);
        }
      });
    }
    if (this.placementTileMesh) {
      (this.placementTileMesh.material as THREE.MeshBasicMaterial).color.setHex(col);
    }

    return { gx, gz, valid };
  }

  private addFloatingText(text: string, color: string, x: number, y: number, z: number): void {
    if (this.floatingCallouts.length > 24) return;
    const el = document.createElement('div');
    el.className = 'floating-callout';
    el.textContent = text;
    el.style.color = color;
    this.calloutLayer.appendChild(el);
    this.floatingCallouts.push({ el, x, y, z, age: 0, maxAge: 1.65 });
  }

  handleSimEvents(events: SimEvent[], world: GameWorld): void {
    for (const ev of events) {
      if (ev.type === 'shot') {
        this.vfx.spawnShot(
          ev.damageType,
          ev.fromX,
          ev.fromY,
          ev.fromZ,
          ev.toX,
          ev.toY,
          ev.toZ,
          ev.eliteShot,
          ev.bounceTo
        );
      } else if (ev.type === 'explosion') {
        this.vfx.spawnExplosion(
          ev.x,
          ev.y,
          ev.z,
          ev.scale,
          ev.damageType,
          ev.leaveCrater,
          ev.shake ?? 0
        );
      } else if (ev.type === 'harvest_spark') {
        this.vfx.spawnHarvestSpark(ev.x, ev.y, ev.z);
      } else if (ev.type === 'veterancy_up') {
        this.vfx.spawnVeterancyBurst(ev.x, ev.y, ev.z);
      } else if (ev.type === 'airstrike_start') {
        this.vfx.spawnAirstrike(ev.faction, ev.targetX, ev.targetZ, ev.angle);
      } else if (ev.type === 'nuke_launched') {
        const y = sampleTerrainHeight(world.map, ev.targetX, ev.targetZ);
        this.vfx.spawnNukeLaunch(ev.targetX, y, ev.targetZ);
      } else if (ev.type === 'nuke_impact') {
        this.vfx.spawnNukeImpact(ev.x, ev.y, ev.z);
      } else if (ev.type === 'iron_curtain_cast') {
        this.vfx.spawnGroundPing(ev.x, ev.y, ev.z, 0xff2255);
        this.vfx.addShake(0.35);
      } else if (ev.type === 'chrono_warp') {
        this.vfx.spawnChronoWarp(
          ev.fromX,
          ev.fromY,
          ev.fromZ,
          ev.toX,
          ev.toY,
          ev.toZ,
          ev.count
        );
      } else if (ev.type === 'unit_destroyed') {
        if (UNIT_SPECS[ev.unitType].armor !== 'infantry') {
          this.vfx.spawnWreckage(
            ev.x,
            sampleTerrainHeight(world.map, ev.x, ev.z),
            ev.z,
            ev.unitType === 'mammoth_tank' ? 1.35 : 0.95
          );
        }
      } else if (ev.type === 'building_destroyed') {
        this.vfx.spawnWreckage(ev.x, ev.y, ev.z, 1.5);
      } else if (ev.type === 'floating_text') {
        if (ev.faction === 'all' || ev.faction === world.localFaction) {
          this.addFloatingText(ev.text, ev.color, ev.x, ev.y, ev.z);
        }
      }
    }
  }

  renderFrame(
    world: GameWorld,
    dt: number,
    alpha: number,
    selectedUnitIds: Set<number>,
    selectedBuildingId: number | null
  ): void {
    this.elapsed += dt;
    this.dustTimer += dt;
    const emitDust = this.dustTimer >= 0.14;
    if (emitDust) this.dustTimer = 0;

    this.updateCameraTransform();
    this.syncBuildings(world, dt, selectedBuildingId);
    this.syncUnits(world, alpha, selectedUnitIds, emitDust);
    this.syncProjectiles(world);
    this.syncCrates(world);
    this.syncDerricks(world);
    this.syncFalloutZones(world);
    this.syncRallyFlag(world, selectedBuildingId);

    this.oreSyncTimer += dt;
    if (this.oreSyncTimer >= 0.35) {
      this.oreSyncTimer = 0;
      this.terrain.updateOreVisuals(world.map);
      this.terrain.updateFogVisuals(world.fog, world.fogEnabled);
    }

    this.vfx.update(dt);
    this.composer.render();
    this.updateFloatingCallouts(dt);
  }

  private updateFloatingCallouts(dt: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const proj = new THREE.Vector3();

    for (let i = this.floatingCallouts.length - 1; i >= 0; i--) {
      const c = this.floatingCallouts[i];
      c.age += dt;
      if (c.age >= c.maxAge) {
        c.el.remove();
        this.floatingCallouts.splice(i, 1);
        continue;
      }
      const t = c.age / c.maxAge;
      proj.set(c.x, c.y + t * 2.4, c.z).project(this.camera);
      if (proj.z > 1) {
        c.el.style.display = 'none';
        continue;
      }
      c.el.style.display = 'block';
      const px = (proj.x * 0.5 + 0.5) * rect.width;
      const py = (-proj.y * 0.5 + 0.5) * rect.height;
      c.el.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px)`;
      c.el.style.opacity = String(Math.max(0, 1 - Math.pow(t, 1.8)));
    }
  }

  private syncBuildings(world: GameWorld, dt: number, selectedBuildingId: number | null): void {
    for (const [id, vis] of this.buildingVisuals) {
      if (!world.buildings.has(id)) {
        this.scene.remove(vis.root);
        this.buildingVisuals.delete(id);
      }
    }

    for (const b of world.buildings.values()) {
      let vis = this.buildingVisuals.get(b.id);
      if (!vis) {
        const handle = createBuildingMesh(b.type, b.faction);
        const [fw, fh] = BUILDING_SPECS[b.type].footprint;
        const r = Math.max(fw, fh) * TILE_SIZE * 0.56;
        const ringGeo = new THREE.RingGeometry(r * 0.9, r, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const selectRing = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({
            color: 0x3bf095,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        selectRing.position.y = 0.14;
        selectRing.visible = false;
        handle.root.add(selectRing);

        const hpBarBg = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 0.24),
          new THREE.MeshBasicMaterial({ color: 0x11151b, depthTest: false })
        );
        hpBarBg.position.y = b.type === 'tesla' || b.type === 'prism' ? 5.1 : 3.8;
        hpBarBg.renderOrder = 10;
        hpBarBg.visible = false;
        handle.root.add(hpBarBg);

        const hpBarFill = new THREE.Mesh(
          new THREE.PlaneGeometry(2.48, 0.16),
          new THREE.MeshBasicMaterial({ color: 0x35e57e, depthTest: false })
        );
        hpBarFill.position.z = 0.01;
        hpBarFill.renderOrder = 11;
        hpBarBg.add(hpBarFill);

        this.scene.add(handle.root);
        vis = { ...handle, selectRing, hpBarBg, hpBarFill, smokeTimer: 0 };
        this.buildingVisuals.set(b.id, vis);
      }

      const tileIdx = Math.floor(b.z / TILE_SIZE) * world.map.size + Math.floor(b.x / TILE_SIZE);
      const visible = b.faction === world.localFaction || !world.fogEnabled || world.fog[tileIdx] >= 1;
      vis.root.visible = visible;
      if (!visible) continue;

      vis.root.position.set(b.x, b.y, b.z);
      const anim = Math.max(0.05, b.buildAnim);
      vis.body.scale.set(1, anim, 1);

      if (vis.turret) vis.turret.rotation.y = b.turretAngle;
      if (vis.animatedPart) {
        if (b.type === 'barracks' || b.type === 'techcenter') {
          vis.animatedPart.rotation.y = this.elapsed * 1.4;
          if (vis.secondaryAnimatedPart) {
            vis.secondaryAnimatedPart.rotation.y = -this.elapsed * 2.1;
          }
        } else if (b.type === 'conyard') {
          vis.animatedPart.rotation.y = Math.sin(this.elapsed * 0.9) * 0.65;
        } else if (b.type === 'prism') {
          vis.animatedPart.rotation.y = this.elapsed * (b.powered ? 2.4 : 0.35);
          vis.animatedPart.position.y = 4.35 + (b.powered ? Math.sin(this.elapsed * 4.2) * 0.1 : 0);
          if (b.powered && Math.random() < 0.06) {
            this.vfx.spawnTeslaAmbientSpark(b.x, b.y + 4.35, b.z);
          }
        } else if (b.type === 'chronosphere') {
          const sw = world.players[b.faction].superweapons.chronoshift;
          const charge = 1 - Math.min(1, sw.cooldown / sw.maxCooldown);
          const spin = b.powered ? 1.1 + charge * 4.5 : 0.2;
          vis.animatedPart.rotation.y = this.elapsed * spin;
          vis.animatedPart.rotation.x = Math.sin(this.elapsed * 0.9) * 0.25;
          if (vis.secondaryAnimatedPart) {
            vis.secondaryAnimatedPart.rotation.y = -this.elapsed * spin * 1.35;
            vis.secondaryAnimatedPart.rotation.z = this.elapsed * spin * 0.8;
          }
          if (b.powered && charge > 0.7 && Math.random() < 0.08) {
            this.vfx.spawnTeslaAmbientSpark(b.x, b.y + 2.65, b.z);
          }
        } else if (b.type === 'tesla') {
          const pulse = b.powered ? 1.0 + Math.sin(this.elapsed * 9) * 0.14 : 0.72;
          vis.animatedPart.scale.setScalar(pulse);
          vis.animatedPart.rotation.y = this.elapsed * (b.powered ? 3.2 : 0.4);
          vis.animatedPart.rotation.z = this.elapsed * (b.powered ? 2.1 : 0.2);
          if (b.powered && Math.random() < 0.08) {
            this.vfx.spawnTeslaAmbientSpark(b.x, b.y + 4.2, b.z);
          }
        } else if (b.type === 'silo') {
          // Sliding blast doors open smoothly & ICBM rises as Silo arms!
          const sw = world.players[b.faction].superweapons.nuke;
          const charge = 1 - Math.min(1, sw.cooldown / sw.maxCooldown);
          vis.animatedPart.position.y = -0.35 + charge * 1.75;
          if (vis.siloDoors) {
            const slide = Math.max(0, (charge - 0.15) / 0.85) * 0.72;
            vis.siloDoors[0].position.x = -0.54 - slide;
            vis.siloDoors[1].position.x = 0.54 + slide;
          }
        }
      }
      // Subtle industrial smokestack wisps on active Ore Refineries
      if (b.type === 'refinery' && b.buildAnim >= 1 && Math.random() < 0.03) {
        this.vfx.spawnSmokePuff(b.x - 0.9, b.y + 4.35, b.z - 0.45);
      }
      if (vis.glowMat) {
        vis.glowMat.emissiveIntensity = b.powered ? 1.5 + Math.sin(this.elapsed * 5) * 0.4 : 0.15;
      }

      const isSelected = selectedBuildingId === b.id;
      vis.selectRing.visible = isSelected || b.repairing;
      (vis.selectRing.material as THREE.MeshBasicMaterial).color.setHex(
        b.repairing ? 0xfacc15 : 0x3bf095
      );

      const hpRatio = Math.max(0, b.hp / b.maxHp);
      vis.hpBarBg.visible = isSelected || hpRatio < 0.99 || b.repairing;
      if (vis.hpBarBg.visible) {
        vis.hpBarBg.quaternion.copy(this.camera.quaternion);
        vis.hpBarFill.scale.x = Math.max(0.001, hpRatio);
        vis.hpBarFill.position.x = -(1 - hpRatio) * 1.24;
        (vis.hpBarFill.material as THREE.MeshBasicMaterial).color.setHex(
          b.repairing ? 0x38e8ff : hpRatio > 0.55 ? 0x35e57e : hpRatio > 0.25 ? 0xf5b82e : 0xff3b3b
        );
      }

      if (hpRatio < 0.6) {
        vis.smokeTimer -= dt;
        if (vis.smokeTimer <= 0) {
          vis.smokeTimer = hpRatio < 0.3 ? 0.18 : 0.42;
          this.vfx.spawnSmokePuff(b.x, b.y + 1.8, b.z);
        }
      }
    }
  }

  private syncUnits(
    world: GameWorld,
    alpha: number,
    selectedUnitIds: Set<number>,
    emitDust: boolean
  ): void {
    for (const [id, vis] of this.unitVisuals) {
      if (!world.units.has(id)) {
        this.scene.remove(vis.root);
        this.unitVisuals.delete(id);
      }
    }

    for (const u of world.units.values()) {
      let vis = this.unitVisuals.get(u.id);
      if (!vis) {
        vis = createUnitMesh(u.type, u.faction);
        const badgeMat = new THREE.SpriteMaterial({
          map: getTacticalBadgeTexture(u.faction, u.type, u.rank),
          transparent: true,
          depthTest: false,
        });
        const badge = new THREE.Sprite(badgeMat);
        badge.scale.set(1.25, 1.56, 1);
        badge.position.y =
          u.type === 'kirov' ? 12.1 : u.type === 'mammoth_tank' ? 4.5 : 3.7;
        badge.renderOrder = 12;
        vis.root.add(badge);
        vis.badge = badge;
        vis.lastBadgeRank = u.rank;

        this.scene.add(vis.root);
        this.unitVisuals.set(u.id, vis);
      }

      const visible = u.faction === world.localFaction || world.isVisibleToPlayer(u.x, u.z);
      vis.root.visible = visible;
      if (!visible) continue;

      const ix = u.prevX + (u.x - u.prevX) * alpha;
      const iz = u.prevZ + (u.z - u.prevZ) * alpha;
      const iy = sampleTerrainHeight(world.map, ix, iz);
      vis.root.position.set(ix, iy, iz);
      vis.hull.rotation.y = u.angle;

      // Kick up tread dust trails behind moving ground vehicles!
      const speedSq = u.vx * u.vx + u.vz * u.vz;
      if (emitDust && speedSq > 1.5 && UNIT_SPECS[u.type].armor !== 'infantry' && !UNIT_SPECS[u.type].isAir) {
        this.vfx.spawnTreadDust(
          ix - Math.sin(u.angle) * 1.1,
          iy,
          iz - Math.cos(u.angle) * 1.1,
          world.map.theme.dustHex
        );
      }

      // Spin Kirov propellers + gentle majestic airship hover bob + blinking nav strobes
      if (vis.propellers) {
        for (const p of vis.propellers) p.rotation.z = this.elapsed * 18;
        vis.hull.position.y = Math.sin(this.elapsed * 1.8 + u.id) * 0.35;
      } else if (u.type === 'chrono_tank') {
        vis.hull.position.y = 0.08 + Math.sin(this.elapsed * 5.2 + u.id) * 0.06;
      }
      if (vis.navStrobeMat) {
        vis.navStrobeMat.emissiveIntensity = Math.sin(this.elapsed * 7 + u.id) > 0.25 ? 2.8 : 0.25;
      }
      // Spin Harvester front ore grinder drum & rotating roof beacon
      if (vis.oreDrum) {
        const drumSpeed = u.harvesterState === 'harvesting' ? 14 : speedSq > 0.2 ? 3.5 : 0;
        vis.oreDrum.rotation.x += drumSpeed * 0.02;
      }
      if (vis.roofBeacon) {
        vis.roofBeacon.rotation.y = this.elapsed * 6.5;
      }

      // Iron Curtain shimmering invulnerability shield!
      vis.shieldDome.visible = u.invulnerableTimer > 0;
      if (vis.shieldDome.visible) {
        vis.shieldDome.rotation.y = this.elapsed * 2.8;
        vis.shieldDome.rotation.x = this.elapsed * 1.2;
        const pulse = 0.96 + Math.sin(this.elapsed * 12) * 0.06;
        vis.shieldDome.scale.setScalar(pulse);
      }

      if (vis.turret) {
        vis.turret.rotation.y = vis.turretRelativeToHull ? u.turretAngle - u.angle : u.turretAngle;
      }
      if (vis.barrel) vis.barrel.position.z = -u.recoil * 0.28;

      // Hide V2 missile on rail while reloading right after launch
      if (vis.v2Missile) {
        vis.v2Missile.visible = u.attackCooldown < 1.8;
      }

      if (vis.cargoPile) {
        const cap = UNIT_SPECS.harvester.harvesterCapacity ?? 750;
        const fill = Math.min(1, u.cargo / cap);
        vis.cargoPile.visible = fill > 0.03;
        vis.cargoPile.scale.set(1.0, Math.max(0.05, fill * 0.95), 1.15);
        vis.cargoPile.position.y = 0.95 + fill * 0.28;
      }

      if (vis.soldiers) {
        const total = vis.soldiers.length;
        const aliveCount = Math.max(1, Math.ceil((u.hp / u.maxHp) * total));
        const moving = speedSq > 0.12;
        vis.soldiers.forEach((s, idx) => {
          s.group.visible = idx < aliveCount;
          const phase = u.animPhase + idx * 1.7;
          s.group.position.y = moving ? Math.abs(Math.sin(phase)) * 0.1 : 0;
          const swing = moving ? Math.sin(phase) * 0.55 : 0;
          s.leftLeg.rotation.x = swing;
          s.rightLeg.rotation.x = -swing;
        });
      }

      const isSelected = selectedUnitIds.has(u.id);
      vis.selectRing.visible = isSelected || u.rank === 2;
      (vis.selectRing.material as THREE.MeshBasicMaterial).color.setHex(
        isSelected
          ? u.faction === 'allies'
            ? 0x3bf095
            : 0xff4b4b
          : 0xfacc15
      );
      (vis.selectRing.material as THREE.MeshBasicMaterial).opacity = isSelected ? 0.92 : 0.45;

      const hpRatio = Math.max(0, u.hp / u.maxHp);
      vis.hpBarBg.visible = isSelected || hpRatio < 0.99;
      if (vis.hpBarBg.visible) {
        vis.hpBarBg.quaternion.copy(this.camera.quaternion);
        vis.hpBarFill.scale.x = Math.max(0.001, hpRatio);
        vis.hpBarFill.position.x = -(1 - hpRatio) * 0.71;
        (vis.hpBarFill.material as THREE.MeshBasicMaterial).color.setHex(
          hpRatio > 0.55 ? 0x35e57e : hpRatio > 0.25 ? 0xf5b82e : 0xff3b3b
        );
      }

      // Refresh tactical shield badge when unit promotes to Veteran / Elite!
      if (vis.badge) {
        if (vis.lastBadgeRank !== u.rank) {
          vis.badge.material.map = getTacticalBadgeTexture(u.faction, u.type, u.rank);
          vis.badge.material.needsUpdate = true;
          vis.lastBadgeRank = u.rank;
        }
        const badgeScale = isSelected ? 1.5 : 1.15;
        vis.badge.scale.set(badgeScale, badgeScale * 1.24, 1);
      }
    }
  }

  private syncProjectiles(world: GameWorld): void {
    for (const [id, mesh] of this.projectileMeshes) {
      if (!world.projectiles.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    for (const p of world.projectiles.values()) {
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        const isRocket = p.damageType === 'rocket';
        mesh = new THREE.Mesh(
          isRocket ? this.rocketGeo : this.shellGeo,
          isRocket ? this.rocketMat : p.eliteShot ? this.eliteShellMat : this.shellMat
        );
        if (p.splashRadius >= 3.5) {
          mesh.scale.setScalar(2.4); // Big V2 ballistic missile!
        }
        this.scene.add(mesh);
        this.projectileMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, p.y, p.z);
      if (p.damageType === 'rocket') {
        mesh.lookAt(p.targetX, p.targetY, p.targetZ);
        if (Math.random() < (p.splashRadius >= 3.5 ? 0.9 : 0.55)) {
          this.vfx.spawnSmokePuff(p.x, p.y, p.z);
        }
      }
    }
  }

  private syncCrates(world: GameWorld): void {
    for (const [id, m] of this.crateMeshes) {
      if (!world.crates.has(id)) {
        this.scene.remove(m);
        this.crateMeshes.delete(id);
      }
    }
    for (const c of world.crates.values()) {
      let m = this.crateMeshes.get(c.id);
      if (!m) {
        m = createCrateMesh();
        this.scene.add(m);
        this.crateMeshes.set(c.id, m);
      }
      const tileIdx = Math.floor(c.z / TILE_SIZE) * world.map.size + Math.floor(c.x / TILE_SIZE);
      m.visible = !world.fogEnabled || world.fog[tileIdx] >= 1;
      m.position.set(c.x, c.y + Math.sin(this.elapsed * 3.2 + c.id) * 0.18, c.z);
      m.rotation.y = this.elapsed * 1.1;
    }
  }

  private syncDerricks(world: GameWorld): void {
    for (const [id, vis] of this.derrickVisuals) {
      if (!world.derricks.has(id)) {
        this.scene.remove(vis.root);
        this.derrickVisuals.delete(id);
      }
    }
    for (const d of world.derricks.values()) {
      let vis = this.derrickVisuals.get(d.id);
      if (!vis) {
        vis = createOilDerrickMesh();
        this.scene.add(vis.root);
        this.derrickVisuals.set(d.id, vis);
      }
      vis.root.position.set(d.x, d.y, d.z);
      // Pump rocker beam continuously when owned!
      vis.rockerArm.rotation.x = d.owner ? Math.sin(this.elapsed * 3.8) * 0.34 : 0;

      const ownerColor = d.owner === 'allies' ? 0x3b82f6 : d.owner === 'soviets' ? 0xef4444 : 0xdbeafe;
      vis.ownerRingMat.color.setHex(ownerColor);
      vis.flagMat.color.setHex(ownerColor);
      vis.flagMat.emissive.setHex(ownerColor);
      vis.flagMat.emissiveIntensity = d.owner ? 1.4 : 0.25;

      vis.progressRing.visible = d.captureProgress > 0.02;
      if (vis.progressRing.visible) {
        vis.progressRing.scale.setScalar(0.3 + d.captureProgress * 0.7);
        (vis.progressRing.material as THREE.MeshBasicMaterial).color.setHex(
          d.capturingFaction === 'allies' ? 0x60a5fa : 0xff5c5c
        );
      }
    }
  }

  private syncFalloutZones(world: GameWorld): void {
    for (const [id, m] of this.falloutMeshes) {
      if (!world.falloutZones.has(id)) {
        this.scene.remove(m);
        (m.material as THREE.Material).dispose();
        m.geometry.dispose();
        this.falloutMeshes.delete(id);
      }
    }
    for (const fz of world.falloutZones.values()) {
      let m = this.falloutMeshes.get(fz.id);
      if (!m) {
        const geo = new THREE.CircleGeometry(fz.radius, 36).rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x84ff2e,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        m = new THREE.Mesh(geo, mat);
        const y = sampleTerrainHeight(world.map, fz.x, fz.z);
        m.position.set(fz.x, y + 0.16, fz.z);
        this.scene.add(m);
        this.falloutMeshes.set(fz.id, m);
      }
      const fade = Math.min(1, fz.remaining / 3.0);
      (m.material as THREE.MeshBasicMaterial).opacity =
        (0.18 + Math.sin(this.elapsed * 6) * 0.05) * fade;
    }
  }

  private syncRallyFlag(world: GameWorld, selectedBuildingId: number | null): void {
    if (!selectedBuildingId) {
      this.rallyFlag.visible = false;
      return;
    }
    const b = world.buildings.get(selectedBuildingId);
    if (!b || b.faction !== world.localFaction || !b.rallyPoint) {
      this.rallyFlag.visible = false;
      return;
    }
    const ry = sampleTerrainHeight(world.map, b.rallyPoint.x, b.rallyPoint.z);
    this.rallyFlag.position.set(b.rallyPoint.x, ry, b.rallyPoint.z);
    this.rallyFlag.visible = true;
  }

  /**
   * Hot-rebuilds all building & unit meshes when a custom `.glb` asset override is loaded or cleared.
   */
  refreshCustomModels(): void {
    for (const vis of this.buildingVisuals.values()) this.scene.remove(vis.root);
    this.buildingVisuals.clear();
    for (const vis of this.unitVisuals.values()) this.scene.remove(vis.root);
    this.unitVisuals.clear();
    this.placementType = null;
  }

  rebuildForNewWorld(world: GameWorld): void {
    for (const vis of this.buildingVisuals.values()) this.scene.remove(vis.root);
    this.buildingVisuals.clear();
    for (const vis of this.unitVisuals.values()) this.scene.remove(vis.root);
    this.unitVisuals.clear();
    for (const m of this.projectileMeshes.values()) this.scene.remove(m);
    this.projectileMeshes.clear();
    for (const m of this.crateMeshes.values()) this.scene.remove(m);
    this.crateMeshes.clear();
    for (const vis of this.derrickVisuals.values()) this.scene.remove(vis.root);
    this.derrickVisuals.clear();
    for (const m of this.falloutMeshes.values()) this.scene.remove(m);
    this.falloutMeshes.clear();

    // Update lighting, atmosphere, shadow bounds & PMREM IBL to match map theme & size
    this.worldSize = world.map.worldSize;
    this.camera.far = Math.max(380, this.worldSize * 2.8);
    this.camera.updateProjectionMatrix();

    const halfW = this.worldSize * 0.5;
    const shadowHalf = Math.max(88, this.worldSize * 0.62);
    this.sunLight.position.set(halfW + 45, Math.max(92, this.worldSize * 0.65), halfW + 46);
    this.sunLight.target.position.set(halfW, 0, halfW);
    this.sunLight.shadow.camera.left = -shadowHalf;
    this.sunLight.shadow.camera.right = shadowHalf;
    this.sunLight.shadow.camera.top = shadowHalf;
    this.sunLight.shadow.camera.bottom = -shadowHalf;
    this.sunLight.shadow.camera.far = Math.max(280, this.worldSize * 2.2);
    this.sunLight.shadow.camera.updateProjectionMatrix();

    const theme = world.map.theme;
    this.scene.background = new THREE.Color(theme.fogHex);
    this.scene.fog = new THREE.FogExp2(theme.fogHex, Math.max(0.0022, 0.0044 * (144 / this.worldSize)));
    if (this.envTexture) this.envTexture.dispose();
    this.envTexture = createEnvironmentIBL(this.renderer, theme);
    this.scene.environment = this.envTexture;
    this.hemiLight.color.setHex(theme.hemiSkyHex);
    this.hemiLight.groundColor.setHex(theme.hemiGroundHex);
    this.sunLight.color.setHex(theme.sunHex);
    this.sunLight.intensity = theme.sunIntensity;
    this.vfx.setDustColor(theme.dustHex);
    this.vfx.setWorldSize(this.worldSize);

    this.scene.remove(this.terrain.group);
    this.terrain.dispose();
    this.terrain = createTerrainVisuals(world.map);
    this.scene.add(this.terrain.group);
    this.focusOnBase(world);
  }
}
