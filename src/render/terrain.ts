import * as THREE from 'three';
import { TILE_SIZE } from '../sim/config';
import { sampleTerrainHeight } from '../sim/mapGen';
import { MapData } from '../sim/types';
import { createContactShadow, getMaterialLibrary } from './materials';
import { createTerrainAlbedoTexture, createTerrainBumpTexture } from './textures';

export interface TerrainVisuals {
  group: THREE.Group;
  groundMesh: THREE.Mesh;
  updateOreVisuals: (map: MapData) => void;
  updateFogVisuals: (fog: Uint8Array, enabled: boolean) => void;
  dispose: () => void;
}

interface OreInstanceSlot {
  gx: number;
  gz: number;
  maxOre: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  rotY: number;
  scaleBase: number;
  isGem: boolean;
}

function createSkyDome(topHex: number, horizonHex: number, worldSize: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(Math.max(240, worldSize * 1.65), 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(topHex) },
      horizonColor: { value: new THREE.Color(horizonHex) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(normalize(vWorldPos).y * 1.45, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.65));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(worldSize * 0.5, 0, worldSize * 0.5);
  return mesh;
}

export function createTerrainVisuals(map: MapData): TerrainVisuals {
  const group = new THREE.Group();
  const mapSize = map.size;
  const worldSize = map.worldSize;

  // 0. Procedural gradient sky dome
  const skyDome = createSkyDome(map.theme.skyTopHex, map.theme.skyHorizonHex, worldSize);
  group.add(skyDome);

  // 1. Displaced heightmap terrain mesh
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, mapSize, mapSize);
  geo.rotateX(-Math.PI / 2);
  geo.translate(worldSize * 0.5, 0, worldSize * 0.5);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const cols = mapSize + 1;
  for (let vz = 0; vz < cols; vz++) {
    for (let vx = 0; vx < cols; vx++) {
      const idx = vz * cols + vx;
      pos.setY(idx, map.heights[idx]);
    }
  }
  geo.computeVertexNormals();

  const albedoTex = createTerrainAlbedoTexture(map);
  const bumpTex = createTerrainBumpTexture();

  const terrainMat = new THREE.MeshStandardMaterial({
    map: albedoTex,
    bumpMap: bumpTex,
    bumpScale: 0.22,
    roughness: map.preset === 'arctic' ? 0.78 : 0.92,
    metalness: 0.04,
  });

  const groundMesh = new THREE.Mesh(geo, terrainMat);
  groundMesh.receiveShadow = true;
  groundMesh.castShadow = true;
  groundMesh.name = 'terrain';
  group.add(groundMesh);

  // 2. Outer skirt blending smoothly into fog
  const skirtGeo = new THREE.PlaneGeometry(worldSize * 3.8, worldSize * 3.8);
  skirtGeo.rotateX(-Math.PI / 2);
  const skirtMat = new THREE.MeshStandardMaterial({
    color: map.theme.skirtHex,
    roughness: 0.96,
    metalness: 0.0,
  });
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.set(worldSize * 0.5, -0.25, worldSize * 0.5);
  skirt.receiveShadow = true;
  group.add(skirt);

  // 3. Instanced Ore & Gem crystal clusters
  const oreSlots: OreInstanceSlot[] = [];
  const gemSlots: OreInstanceSlot[] = [];

  for (let gz = 0; gz < mapSize; gz++) {
    for (let gx = 0; gx < mapSize; gx++) {
      const idx = gz * mapSize + gx;
      const amt = map.ore[idx];
      if (amt <= 0) continue;
      const wx = (gx + 0.5) * TILE_SIZE;
      const wz = (gz + 0.5) * TILE_SIZE;
      const wy = sampleTerrainHeight(map, wx, wz);
      const slot: OreInstanceSlot = {
        gx,
        gz,
        maxOre: amt,
        baseX: wx,
        baseY: wy,
        baseZ: wz,
        rotY: ((gx * 73 + gz * 31) % 360) * (Math.PI / 180),
        scaleBase: 0.72 + ((gx * 19 + gz * 43) % 10) * 0.045,
        isGem: map.isGem[idx] > 0,
      };
      if (slot.isGem) gemSlots.push(slot);
      else oreSlots.push(slot);
    }
  }

  // Build multi-shard crystalline geometry (3 fused angled mineral spires per cluster!)
  const buildCrystalClusterGeo = (heightScale: number): THREE.BufferGeometry => {
    const shards: Array<[number, number, number, number, number, number]> = [
      [0, 0.52 * heightScale, 0, 0.42, 1.05 * heightScale, 0.12],
      [0.32, 0.34 * heightScale, 0.18, 0.28, 0.72 * heightScale, -0.35],
      [-0.28, 0.3 * heightScale, -0.22, 0.26, 0.65 * heightScale, 0.38],
    ];
    const positions: number[] = [];
    const normals: number[] = [];
    const baseCone = new THREE.CylinderGeometry(0.04, 1.0, 1.0, 5, 1);
    const mat4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (const [ox, oy, oz, rad, h, tilt] of shards) {
      const g = baseCone.clone();
      euler.set(tilt, ox * 4, tilt * 0.7);
      quat.setFromEuler(euler);
      mat4.compose(new THREE.Vector3(ox, oy, oz), quat, new THREE.Vector3(rad, h, rad));
      g.applyMatrix4(mat4);
      const nonIndexed = g.toNonIndexed();
      nonIndexed.computeVertexNormals();
      const pAttr = nonIndexed.attributes.position;
      const nAttr = nonIndexed.attributes.normal;
      for (let i = 0; i < pAttr.count; i++) {
        positions.push(pAttr.getX(i), pAttr.getY(i), pAttr.getZ(i));
        normals.push(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i));
      }
      g.dispose();
      nonIndexed.dispose();
    }
    baseCone.dispose();
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return merged;
  };

  const oreCrystalGeo = buildCrystalClusterGeo(1.0);
  const oreMat = new THREE.MeshStandardMaterial({
    color: 0xf4ae2c,
    emissive: 0x6b3f06,
    emissiveIntensity: 0.55,
    roughness: 0.26,
    metalness: 0.72,
    flatShading: true,
  });
  const oreMesh = new THREE.InstancedMesh(oreCrystalGeo, oreMat, Math.max(1, oreSlots.length));
  oreMesh.castShadow = true;
  oreMesh.receiveShadow = true;
  group.add(oreMesh);

  const gemCrystalGeo = buildCrystalClusterGeo(1.38);
  const gemMat = new THREE.MeshStandardMaterial({
    color: map.preset === 'volcanic' ? 0x3ef79a : 0xff4c75,
    emissive: map.preset === 'volcanic' ? 0x0d7a46 : 0x99123a,
    emissiveIntensity: 0.95,
    roughness: 0.14,
    metalness: 0.82,
    flatShading: true,
  });
  const gemMesh = new THREE.InstancedMesh(gemCrystalGeo, gemMat, Math.max(1, gemSlots.length));
  gemMesh.castShadow = true;
  gemMesh.receiveShadow = true;
  group.add(gemMesh);

  const dummy = new THREE.Object3D();

  const updateOreVisuals = (currentMap: MapData) => {
    const ms = currentMap.size;
    for (let i = 0; i < oreSlots.length; i++) {
      const s = oreSlots[i];
      const rem = currentMap.ore[s.gz * ms + s.gx];
      const ratio = Math.max(0, Math.min(1, rem / s.maxOre));
      const sc = ratio <= 0.02 ? 0.0001 : s.scaleBase * (0.4 + ratio * 0.72);
      dummy.position.set(s.baseX, s.baseY, s.baseZ);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      oreMesh.setMatrixAt(i, dummy.matrix);
    }
    oreMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < gemSlots.length; i++) {
      const s = gemSlots[i];
      const rem = currentMap.ore[s.gz * ms + s.gx];
      const ratio = Math.max(0, Math.min(1, rem / s.maxOre));
      const sc = ratio <= 0.02 ? 0.0001 : s.scaleBase * (0.42 + ratio * 0.75);
      dummy.position.set(s.baseX, s.baseY, s.baseZ);
      dummy.rotation.set(0, s.rotY, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      gemMesh.setMatrixAt(i, dummy.matrix);
    }
    gemMesh.instanceMatrix.needsUpdate = true;
  };
  updateOreVisuals(map);

  // 4. Upgraded Environmental Props (Stratified rock clusters, ringed oil drums, tiered snow pines, military supply crates)
  const lib = getMaterialLibrary();
  const rockMat = new THREE.MeshStandardMaterial({
    color: map.theme.rockHex,
    bumpMap: lib.concreteBump,
    bumpScale: 0.15,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x3b483f,
    roughness: 0.44,
    metalness: 0.58,
  });
  const barrelBandMat = new THREE.MeshStandardMaterial({
    color: 0xb83228,
    roughness: 0.5,
    metalness: 0.35,
  });
  const crateMat = new THREE.MeshStandardMaterial({
    map: lib.cratePanelMap,
    color: 0x9aa094,
    roughness: 0.72,
    metalness: 0.25,
  });
  const pineMat = new THREE.MeshStandardMaterial({
    color: 0x264b3d,
    roughness: 0.85,
    flatShading: true,
  });
  const snowCapMat = new THREE.MeshStandardMaterial({
    color: 0xdce8f4,
    roughness: 0.75,
    flatShading: true,
  });
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4b3527,
    roughness: 0.95,
  });

  const rockGeo = new THREE.DodecahedronGeometry(0.95, 1);
  const barrelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.88, 12);
  const barrelRingGeo = new THREE.TorusGeometry(0.285, 0.025, 6, 12);
  barrelRingGeo.rotateX(Math.PI / 2);
  const crateGeo = new THREE.BoxGeometry(0.98, 0.76, 0.98);
  const coneGeo = new THREE.ConeGeometry(1.18, 2.2, 8);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.0, 7);

  for (const prop of map.props) {
    if (prop.kind === 'rock_large' || prop.kind === 'rock_small') {
      const cluster = new THREE.Group();
      const s = prop.kind === 'rock_large' ? prop.scale * 1.15 : prop.scale * 0.6;
      const main = new THREE.Mesh(rockGeo, rockMat);
      main.scale.set(s * 1.25, s * 0.72, s * 0.95);
      main.position.y = s * 0.22;
      main.rotation.set(0.18, prop.rotation, 0.14);
      main.castShadow = true;
      main.receiveShadow = true;
      cluster.add(main);

      if (prop.kind === 'rock_large') {
        const sub = new THREE.Mesh(rockGeo, rockMat);
        sub.scale.set(s * 0.65, s * 0.45, s * 0.7);
        sub.position.set(s * 0.75, s * 0.14, s * 0.35);
        sub.rotation.set(-0.2, prop.rotation + 1.2, 0.25);
        sub.castShadow = true;
        sub.receiveShadow = true;
        cluster.add(sub);
      }
      cluster.position.set(prop.x, prop.y, prop.z);
      group.add(cluster);
    } else if (prop.kind === 'pine_tree') {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.5;
      tree.add(trunk);
      for (let tier = 0; tier < 3; tier++) {
        const tScale = 1.0 - tier * 0.24;
        const c = new THREE.Mesh(coneGeo, tier === 2 ? snowCapMat : pineMat);
        c.scale.set(tScale, tScale * 0.92, tScale);
        c.position.y = 1.6 + tier * 0.98;
        tree.add(c);
      }
      tree.add(createContactShadow(2.4, 2.4, 0.5));
      tree.position.set(prop.x, prop.y, prop.z);
      tree.scale.setScalar(0.7 + prop.scale * 0.45);
      tree.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry.type !== 'PlaneGeometry') {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      group.add(tree);
    } else if (prop.kind === 'barrels') {
      const cluster = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const bx = Math.cos(k * 2.1) * 0.4;
        const bz = Math.sin(k * 2.1) * 0.4;
        const b = new THREE.Mesh(barrelGeo, k === 0 ? barrelBandMat : barrelMat);
        b.position.set(bx, 0.44, bz);
        b.castShadow = true;
        b.receiveShadow = true;
        cluster.add(b);
        for (const ry of [0.24, 0.64]) {
          const r = new THREE.Mesh(barrelRingGeo, barrelMat);
          r.position.set(bx, ry, bz);
          cluster.add(r);
        }
      }
      cluster.add(createContactShadow(1.65, 1.65, 0.55));
      cluster.position.set(prop.x, prop.y, prop.z);
      cluster.rotation.y = prop.rotation;
      group.add(cluster);
    } else if (prop.kind === 'outpost_crate') {
      const stack = new THREE.Group();
      const c1 = new THREE.Mesh(crateGeo, crateMat);
      c1.position.y = 0.38;
      c1.castShadow = true;
      c1.receiveShadow = true;
      const c2 = new THREE.Mesh(crateGeo, crateMat);
      c2.scale.setScalar(0.68);
      c2.position.set(0.1, 1.0, -0.05);
      c2.rotation.y = 0.45;
      c2.castShadow = true;
      c2.receiveShadow = true;
      stack.add(c1, c2, createContactShadow(1.6, 1.6, 0.55));
      stack.position.set(prop.x, prop.y, prop.z);
      stack.rotation.y = prop.rotation;
      group.add(stack);
    }
  }

  // 5. Fog of War overlay
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = mapSize;
  fogCanvas.height = mapSize;
  const fogCtx = fogCanvas.getContext('2d')!;
  const fogImg = fogCtx.createImageData(mapSize, mapSize);

  const fogTex = new THREE.CanvasTexture(fogCanvas);
  fogTex.minFilter = THREE.LinearFilter;
  fogTex.magFilter = THREE.LinearFilter;

  const fogGeo = geo.clone();
  const fogMat = new THREE.MeshBasicMaterial({
    map: fogTex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const fogMesh = new THREE.Mesh(fogGeo, fogMat);
  fogMesh.position.y = 0.08;
  fogMesh.renderOrder = 2;
  group.add(fogMesh);

  const updateFogVisuals = (fog: Uint8Array, enabled: boolean) => {
    fogMesh.visible = enabled;
    if (!enabled) return;

    const d = fogImg.data;
    const total = mapSize * mapSize;
    for (let i = 0; i < total; i++) {
      const state = fog[i];
      const o = i * 4;
      d[o] = 10;
      d[o + 1] = 12;
      d[o + 2] = 16;
      d[o + 3] = state === 2 ? 0 : state === 1 ? 115 : 225;
    }
    fogCtx.putImageData(fogImg, 0, 0);
    fogTex.needsUpdate = true;
  };

  return {
    group,
    groundMesh,
    updateOreVisuals,
    updateFogVisuals,
    dispose: () => {
      geo.dispose();
      fogGeo.dispose();
      albedoTex.dispose();
      bumpTex.dispose();
      fogTex.dispose();
      skyDome.geometry.dispose();
      (skyDome.material as THREE.Material).dispose();
    },
  };
}
