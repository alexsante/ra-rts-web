import * as THREE from 'three';
import { DamageType, Faction } from '../sim/types';
import { createSlopedHullGeometry } from './materials';
import { createFighterJetMesh, createNukeMissileMesh } from './models';
import { createCraterTexture, createSoftParticleTexture } from './textures';

interface Particle {
  mesh: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  gravity: number;
  startOpacity: number;
}

interface FlashLight {
  light: THREE.PointLight;
  age: number;
  maxAge: number;
  startIntensity: number;
}

interface TransientLine {
  line: THREE.Line;
  age: number;
  maxAge: number;
}

interface Shockwave {
  mesh: THREE.Mesh;
  age: number;
  maxAge: number;
  maxScale: number;
}

interface JetFlyby {
  group: THREE.Group;
  startX: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  age: number;
  maxAge: number;
  speed: number;
}

interface FallingNuke {
  mesh: THREE.Group;
  reticle: THREE.Mesh;
  targetX: number;
  targetY: number;
  targetZ: number;
  age: number;
  duration: number;
}

interface WreckageHulk {
  mesh: THREE.Group;
  baseY: number;
  age: number;
  maxAge: number;
  smokeTimer: number;
}

export class VFXManager {
  readonly group = new THREE.Group();
  shakeIntensity = 0;

  private readonly softTex = createSoftParticleTexture();
  private readonly craterTex = createCraterTexture();
  private readonly particles: Particle[] = [];
  private readonly lights: FlashLight[] = [];
  private readonly lines: TransientLine[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly craters: THREE.Mesh[] = [];
  private readonly jets: JetFlyby[] = [];
  private readonly nukes: FallingNuke[] = [];
  private readonly wrecks: WreckageHulk[] = [];
  private ambientDust: THREE.Points;

  private readonly ringGeo = new THREE.RingGeometry(0.45, 0.85, 28);
  private readonly craterGeo = new THREE.PlaneGeometry(1, 1);

  constructor(dustHex = 0xf4cfa0) {
    this.ringGeo.rotateX(-Math.PI / 2);
    this.craterGeo.rotateX(-Math.PI / 2);

    const count = 280;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * 144;
      positions[i * 3 + 1] = 1.5 + Math.random() * 16;
      positions[i * 3 + 2] = Math.random() * 144;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: dustHex,
      size: 0.48,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.ambientDust = new THREE.Points(dustGeo, dustMat);
    this.group.add(this.ambientDust);
  }

  setDustColor(hex: number): void {
    (this.ambientDust.material as THREE.PointsMaterial).color.setHex(hex);
  }

  addShake(amount: number): void {
    this.shakeIntensity = Math.min(2.2, this.shakeIntensity + amount);
  }

  spawnTreadDust(x: number, y: number, z: number, colorHex = 0xc9a87e): void {
    if (this.particles.length > 320) return;
    this.spawnSprite(
      x + (Math.random() - 0.5) * 0.6,
      y + 0.25,
      z + (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 0.5,
      0.7 + Math.random() * 0.4,
      (Math.random() - 0.5) * 0.5,
      colorHex,
      0.55,
      1.45,
      0.55,
      0,
      0.34,
      false
    );
  }

  spawnOrderLine(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number, colorHex: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fromX, fromY + 0.35, fromZ),
      new THREE.Vector3(toX, toY + 0.35, toZ),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.78,
    });
    const line = new THREE.Line(geo, mat);
    this.group.add(line);
    this.lines.push({ line, age: 0, maxAge: 0.65 });
  }

  spawnShot(
    damageType: DamageType,
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    eliteShot = false
  ): void {
    const muzzleColor = damageType === 'tesla' ? 0x6ef4ff : eliteShot ? 0xff5a5a : 0xffcc55;
    this.spawnSprite(
      fromX,
      fromY,
      fromZ,
      0,
      0,
      0,
      muzzleColor,
      damageType === 'bullet' ? 0.55 : 1.4,
      0.2,
      0.1,
      0,
      0.95,
      true
    );

    if (damageType === 'bullet') {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(fromX, fromY, fromZ),
        new THREE.Vector3(toX, toY, toZ),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: eliteShot ? 0xff6b4a : 0xffdf7a,
        transparent: true,
        opacity: 0.88,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.lines.push({ line, age: 0, maxAge: 0.1 });
    } else if (damageType === 'tesla') {
      for (let strand = 0; strand < 2; strand++) {
        const segs = 12;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          const jitter = i === 0 || i === segs ? 0 : strand === 0 ? 0.9 : 1.35;
          pts.push(
            new THREE.Vector3(
              fromX + (toX - fromX) * t + (Math.random() - 0.5) * jitter,
              fromY + (toY - fromY) * t + (Math.random() - 0.5) * jitter,
              fromZ + (toZ - fromZ) * t + (Math.random() - 0.5) * jitter
            )
          );
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color: strand === 0 ? 0xffffff : eliteShot ? 0x9b5de5 : 0x3ee4ff,
          transparent: true,
          opacity: 1.0,
        });
        const line = new THREE.Line(geo, mat);
        this.group.add(line);
        this.lines.push({ line, age: 0, maxAge: 0.28 });
      }
      this.spawnFlashLight(fromX, fromY, fromZ, 0x3ce8ff, 8, 18, 0.25);
      this.spawnFlashLight(toX, toY, toZ, 0x3ce8ff, 9, 18, 0.28);
    } else {
      this.spawnFlashLight(fromX, fromY, fromZ, 0xffaa33, 4.5, 11, 0.14);
      this.spawnSprite(fromX, fromY, fromZ, 0, 1.2, 0, 0x8f8a82, 0.5, 1.6, 0.45, 0, 0.45, false);
    }
  }

  spawnExplosion(
    x: number,
    y: number,
    z: number,
    scale: number,
    damageType: DamageType,
    leaveCrater = false,
    shake = 0
  ): void {
    if (shake > 0) this.addShake(shake);

    const isTesla = damageType === 'tesla';
    const flashColor = isTesla ? 0x4aeaff : 0xff922b;

    this.spawnSprite(x, y + 0.3, z, 0, 0.6, 0, isTesla ? 0xc2fcff : 0xfff0b3, scale * 1.1, scale * 2.8, 0.28, 0, 1.0, true);
    this.spawnSprite(x, y + 0.4, z, 0, 1.1, 0, flashColor, scale * 0.9, scale * 3.4, 0.48, 0, 0.9, true);

    const smokeCount = Math.min(8, Math.max(2, Math.round(scale * 3)));
    for (let i = 0; i < smokeCount; i++) {
      this.spawnSprite(
        x + (Math.random() - 0.5) * scale * 0.7,
        y + 0.3,
        z + (Math.random() - 0.5) * scale * 0.7,
        (Math.random() - 0.5) * 1.4,
        1.6 + Math.random() * 1.8,
        (Math.random() - 0.5) * 1.4,
        isTesla ? 0x62808f : 0x332f2c,
        scale * 0.7,
        scale * 2.9,
        0.95 + Math.random() * 0.6,
        -0.3,
        0.6,
        false
      );
    }

    const sparkCount = Math.min(14, Math.max(4, Math.round(scale * 5)));
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (2.5 + Math.random() * 5.5) * Math.sqrt(scale);
      this.spawnSprite(
        x,
        y + 0.3,
        z,
        Math.cos(ang) * spd,
        3.2 + Math.random() * 4.5,
        Math.sin(ang) * spd,
        isTesla ? 0x7ef7ff : 0xffc145,
        0.38,
        0.08,
        0.45 + Math.random() * 0.35,
        12,
        1.0,
        true
      );
    }

    const swMat = new THREE.MeshBasicMaterial({
      color: isTesla ? 0x52ebff : 0xffb347,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sw = new THREE.Mesh(this.ringGeo, swMat);
    sw.position.set(x, Math.max(0.15, y - 0.35), z);
    this.group.add(sw);
    this.shockwaves.push({ mesh: sw, age: 0, maxAge: 0.42, maxScale: scale * 3.2 });

    this.spawnFlashLight(x, y + 1.1, z, flashColor, 7 * scale, 18 * scale, 0.35);

    if (leaveCrater) {
      const cMat = new THREE.MeshBasicMaterial({
        map: this.craterTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const crater = new THREE.Mesh(this.craterGeo, cMat);
      const cSize = Math.min(9.5, 1.4 + scale * 1.35);
      crater.scale.set(cSize, cSize, cSize);
      crater.position.set(x, Math.max(0.09, y - 0.45), z);
      crater.rotation.y = Math.random() * Math.PI * 2;
      this.group.add(crater);
      this.craters.push(crater);
      if (this.craters.length > 85) {
        const old = this.craters.shift()!;
        this.group.remove(old);
        (old.material as THREE.Material).dispose();
      }
    }
  }

  /**
   * Twin A-10 / MiG strike jets roaring low across the canyon!
   */
  spawnAirstrike(faction: Faction, targetX: number, targetZ: number, angle: number): void {
    const dirX = Math.sin(angle);
    const dirZ = Math.cos(angle);
    const perpX = Math.cos(angle);
    const perpZ = -Math.sin(angle);
    const speed = 56;
    const leadDist = speed * 2.0;

    for (const side of [-1, 1]) {
      const jet = createFighterJetMesh(faction);
      const sx = targetX - dirX * leadDist + perpX * side * 3.8;
      const sz = targetZ - dirZ * leadDist + perpZ * side * 3.8;
      jet.position.set(sx, 14.5 + (side > 0 ? 0.8 : 0), sz);
      jet.rotation.y = angle;
      this.group.add(jet);
      this.jets.push({
        group: jet,
        startX: sx,
        startZ: sz,
        dirX,
        dirZ,
        age: 0,
        maxAge: 4.4,
        speed,
      });
    }
  }

  /**
   * Tactical Nuclear Missile descent + warning reticle on the ground!
   */
  spawnNukeLaunch(targetX: number, targetY: number, targetZ: number): void {
    const missile = createNukeMissileMesh();
    missile.position.set(targetX, 130, targetZ);
    this.group.add(missile);

    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(4.5, 5.4, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xff2a2a,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    reticle.position.set(targetX, targetY + 0.25, targetZ);
    this.group.add(reticle);

    this.nukes.push({
      mesh: missile,
      reticle,
      targetX,
      targetY,
      targetZ,
      age: 0,
      duration: 3.4,
    });
  }

  /**
   * Towering multi-stage Nuclear Mushroom Cloud + blinding flash!
   */
  spawnNukeImpact(x: number, y: number, z: number): void {
    this.addShake(2.2);
    this.spawnFlashLight(x, y + 6, z, 0xfff3c4, 35, 80, 1.3);

    // Massive expanding shockwave rings
    for (let r = 0; r < 2; r++) {
      const swMat = new THREE.MeshBasicMaterial({
        color: r === 0 ? 0xffffff : 0xff7b24,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sw = new THREE.Mesh(this.ringGeo, swMat);
      sw.position.set(x, y + 0.4 + r * 0.4, z);
      this.group.add(sw);
      this.shockwaves.push({
        mesh: sw,
        age: 0,
        maxAge: 1.1 + r * 0.45,
        maxScale: 24 + r * 8,
      });
    }

    // Rising incandescent mushroom stem
    for (let i = 0; i < 12; i++) {
      this.spawnSprite(
        x + (Math.random() - 0.5) * 2.5,
        y + 1.0 + i * 0.6,
        z + (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 0.8,
        5.5 + i * 0.7,
        (Math.random() - 0.5) * 0.8,
        i % 2 === 0 ? 0xff922b : 0x453b36,
        3.2,
        6.8,
        2.6 + Math.random() * 0.8,
        -0.4,
        0.85,
        i % 3 === 0
      );
    }

    // Billowing mushroom cloud cap
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      this.spawnSprite(
        x + Math.cos(ang) * 3.8,
        y + 9.5,
        z + Math.sin(ang) * 3.8,
        Math.cos(ang) * 3.4,
        2.6 + Math.random() * 1.4,
        Math.sin(ang) * 3.4,
        i % 2 === 0 ? 0xff7518 : 0xffd166,
        4.5,
        10.5,
        2.8 + Math.random() * 0.9,
        0.5,
        0.88,
        true
      );
    }
  }

  spawnVeterancyBurst(x: number, y: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      this.spawnSprite(
        x + Math.cos(ang) * 0.7,
        y,
        z + Math.sin(ang) * 0.7,
        Math.cos(ang) * 1.4,
        3.5 + Math.random() * 1.2,
        Math.sin(ang) * 1.4,
        0xfde047,
        0.55,
        0.1,
        0.75,
        1.5,
        1.0,
        true
      );
    }
  }

  /**
   * Charred smoldering tank/building wreckage hulk that smokes and sinks into the terrain.
   */
  spawnWreckage(x: number, y: number, z: number, scale = 1.0): void {
    if (this.wrecks.length > 26) {
      const old = this.wrecks.shift()!;
      this.group.remove(old.mesh);
    }
    const g = new THREE.Group();
    const charredMat = new THREE.MeshStandardMaterial({
      color: 0x201d1c,
      roughness: 0.92,
      metalness: 0.42,
    });
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      emissive: 0xff4500,
      emissiveIntensity: 1.9,
      roughness: 0.5,
    });

    // Charred sloped hull + mangled track remnants
    const hull = new THREE.Mesh(
      createSlopedHullGeometry(1.32 * scale, 0.54 * scale, 2.08 * scale, 0.35 * scale, 0.2 * scale, 0.04),
      charredMat
    );
    hull.position.y = 0.28 * scale;
    hull.rotation.z = (Math.random() - 0.5) * 0.25;
    hull.castShadow = true;
    g.add(hull);

    for (const sx of [-0.72 * scale, 0.72 * scale]) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.32 * scale, 0.36 * scale, 1.95 * scale), charredMat);
      tread.position.set(sx, 0.18 * scale, (Math.random() - 0.5) * 0.2 * scale);
      tread.rotation.y = (Math.random() - 0.5) * 0.18;
      g.add(tread);
    }

    // Popped-off tilted turret with drooping burnt cannon barrel!
    const popped = new THREE.Group();
    popped.position.set(0.32 * scale, 0.52 * scale, -0.15 * scale);
    popped.rotation.set(0.28, Math.random() * Math.PI, -0.42);
    const turret = new THREE.Mesh(new THREE.BoxGeometry(0.84 * scale, 0.36 * scale, 0.98 * scale), charredMat);
    const burntBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06 * scale, 0.08 * scale, 1.25 * scale, 8),
      charredMat
    );
    burntBarrel.rotation.x = Math.PI / 2 + 0.18;
    burntBarrel.position.set(0, 0, 0.85 * scale);
    popped.add(turret, burntBarrel);
    g.add(popped);

    // Smoldering open turret ring embers
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.36 * scale, 0.36 * scale, 0.12 * scale, 10), emberMat);
    glow.position.set(0, 0.52 * scale, 0);
    g.add(glow);

    g.position.set(x, y, z);
    g.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(g);
    this.wrecks.push({ mesh: g, baseY: y, age: 0, maxAge: 16, smokeTimer: 0.1 });
  }

  spawnTeslaAmbientSpark(x: number, y: number, z: number): void {
    this.spawnSprite(
      x + (Math.random() - 0.5) * 0.7,
      y + (Math.random() - 0.5) * 0.5,
      z + (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 1.1,
      0.5,
      (Math.random() - 0.5) * 1.1,
      0x5ef2ff,
      0.42,
      0.06,
      0.24,
      0,
      0.95,
      true
    );
  }

  spawnHarvestSpark(x: number, y: number, z: number): void {
    this.spawnSprite(
      x + (Math.random() - 0.5) * 0.9,
      y,
      z + (Math.random() - 0.5) * 0.9,
      (Math.random() - 0.5) * 1.5,
      1.8 + Math.random() * 1.2,
      (Math.random() - 0.5) * 1.5,
      0xffcc44,
      0.42,
      0.08,
      0.4,
      5,
      0.9,
      true
    );
  }

  spawnGroundPing(x: number, y: number, z: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.position.set(x, y + 0.14, z);
    this.group.add(ring);
    this.shockwaves.push({ mesh: ring, age: 0, maxAge: 0.45, maxScale: 2.2 });
  }

  spawnSmokePuff(x: number, y: number, z: number): void {
    this.spawnSprite(
      x + (Math.random() - 0.5) * 0.6,
      y,
      z + (Math.random() - 0.5) * 0.6,
      0.4,
      1.6,
      0.2,
      0x292726,
      0.55,
      1.9,
      1.1,
      -0.2,
      0.48,
      false
    );
  }

  private spawnSprite(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    startScale: number,
    endScale: number,
    maxAge: number,
    gravity: number,
    startOpacity: number,
    additive: boolean
  ): void {
    if (this.particles.length > 380) return;
    const mat = new THREE.SpriteMaterial({
      map: this.softTex,
      color,
      transparent: true,
      opacity: startOpacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(startScale, startScale, 1);
    this.group.add(sprite);
    this.particles.push({
      mesh: sprite,
      vx,
      vy,
      vz,
      age: 0,
      maxAge,
      startScale,
      endScale,
      gravity,
      startOpacity,
    });
  }

  private spawnFlashLight(
    x: number,
    y: number,
    z: number,
    color: number,
    intensity: number,
    distance: number,
    maxAge: number
  ): void {
    if (this.lights.length >= 8) return;
    const light = new THREE.PointLight(color, intensity, distance, 1.5);
    light.position.set(x, y, z);
    this.group.add(light);
    this.lights.push({ light, age: 0, maxAge, startIntensity: intensity });
  }

  update(dt: number): void {
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.8);

    const pos = this.ambientDust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + dt * 1.4;
      if (x > 144) x -= 144;
      pos.setX(i, x);
    }
    pos.needsUpdate = true;

    // Update Air Strike jets + contrails
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.age += dt;
      if (j.age >= j.maxAge) {
        this.group.remove(j.group);
        this.jets.splice(i, 1);
        continue;
      }
      const dist = j.age * j.speed;
      j.group.position.x = j.startX + j.dirX * dist;
      j.group.position.z = j.startZ + j.dirZ * dist;
      if (Math.random() < 0.7) {
        this.spawnSprite(
          j.group.position.x - j.dirX * 2.2,
          j.group.position.y,
          j.group.position.z - j.dirZ * 2.2,
          0,
          0.1,
          0,
          0xdbeafe,
          0.7,
          2.2,
          0.7,
          0,
          0.35,
          false
        );
      }
    }

    // Update Descending Nuclear Missiles
    for (let i = this.nukes.length - 1; i >= 0; i--) {
      const n = this.nukes[i];
      n.age += dt;
      const t = Math.min(1, n.age / n.duration);
      n.mesh.position.y = n.targetY + 135 * (1 - t * t);
      n.mesh.rotation.y += dt * 4;
      const pulse = 0.85 + Math.sin(n.age * 14) * 0.25;
      n.reticle.scale.setScalar(pulse);

      if (Math.random() < 0.85) {
        this.spawnSprite(
          n.mesh.position.x,
          n.mesh.position.y + 3.2,
          n.mesh.position.z,
          0,
          2,
          0,
          0xff9f43,
          1.2,
          3.4,
          0.55,
          0,
          0.75,
          true
        );
      }
      if (n.age >= n.duration) {
        this.group.remove(n.mesh);
        this.group.remove(n.reticle);
        this.nukes.splice(i, 1);
      }
    }

    // Update smoldering wreckage hulks
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.age += dt;
      if (w.age >= w.maxAge) {
        this.group.remove(w.mesh);
        this.wrecks.splice(i, 1);
        continue;
      }
      if (w.age < 10) {
        w.smokeTimer -= dt;
        if (w.smokeTimer <= 0) {
          w.smokeTimer = 0.55;
          this.spawnSmokePuff(w.mesh.position.x, w.baseY + 0.5, w.mesh.position.z);
        }
      } else {
        // Sink gracefully into ground during final 6 seconds
        const sinkT = (w.age - 10) / 6;
        w.mesh.position.y = w.baseY - sinkT * 1.4;
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.group.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.age / p.maxAge;
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const sc = p.startScale + (p.endScale - p.startScale) * t;
      p.mesh.scale.set(sc, sc, 1);
      p.mesh.material.opacity = p.startOpacity * (1 - t);
    }

    for (let i = this.lights.length - 1; i >= 0; i--) {
      const fl = this.lights[i];
      fl.age += dt;
      if (fl.age >= fl.maxAge) {
        this.group.remove(fl.light);
        this.lights.splice(i, 1);
        continue;
      }
      fl.light.intensity = fl.startIntensity * (1 - fl.age / fl.maxAge);
    }

    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.age += dt;
      if (l.age >= l.maxAge) {
        this.group.remove(l.line);
        l.line.geometry.dispose();
        (l.line.material as THREE.Material).dispose();
        this.lines.splice(i, 1);
        continue;
      }
      (l.line.material as THREE.LineBasicMaterial).opacity = 1 - l.age / l.maxAge;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.group.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const t = s.age / s.maxAge;
      const sc = 0.25 + s.maxScale * t;
      s.mesh.scale.set(sc, sc, sc);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
    }
  }
}
