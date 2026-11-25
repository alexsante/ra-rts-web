import { MAP_SIZE, TILE_SIZE, WORLD_SIZE } from './config';
import { MapData, MapPreset, MapProp, MapThemeColors, Vec2 } from './types';

function hash2d(x: number, y: number, seed = 1337): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed = 1337): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2d(xi, yi, seed);
  const b = hash2d(xi + 1, yi, seed);
  const c = hash2d(xi, yi + 1, seed);
  const d = hash2d(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, seed = 1337): number {
  return (
    valueNoise(x, y, seed) * 0.55 +
    valueNoise(x * 2.03, y * 2.03, seed + 17) * 0.3 +
    valueNoise(x * 4.11, y * 4.11, seed + 53) * 0.15
  );
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const MAP_THEMES: Record<MapPreset, MapThemeColors> = {
  canyon: {
    name: 'Canyon Protocol',
    subtitle: 'Arid Mesa Highway',
    fogHex: 0xcfa882,
    skyTopHex: 0x3b6fa6,
    skyHorizonHex: 0xe3ba92,
    sunHex: 0xfff0d4,
    sunIntensity: 2.35,
    hemiSkyHex: 0xfff1dc,
    hemiGroundHex: 0x8b6546,
    skirtHex: 0xc29b6e,
    dustHex: 0xf4cfa0,
    rockHex: 0x996548,
  },
  arctic: {
    name: 'Arctic Redoubt',
    subtitle: 'Classic Alpine Snowpass',
    fogHex: 0x9bb2c9,
    skyTopHex: 0x1d3557,
    skyHorizonHex: 0xb9d1e8,
    sunHex: 0xe4f1ff,
    sunIntensity: 2.1,
    hemiSkyHex: 0xdbeafe,
    hemiGroundHex: 0x5c7185,
    skirtHex: 0xaabccc,
    dustHex: 0xffffff,
    rockHex: 0x546270,
  },
  volcanic: {
    name: 'Volcanic Basin',
    subtitle: 'Dusk Obsidian Badlands',
    fogHex: 0x52342c,
    skyTopHex: 0x140f1d,
    skyHorizonHex: 0x9e4c32,
    sunHex: 0xffa66b,
    sunIntensity: 2.25,
    hemiSkyHex: 0xd98a6c,
    hemiGroundHex: 0x362421,
    skirtHex: 0x382824,
    dustHex: 0xff8a47,
    rockHex: 0x453533,
  },
};

export function roadDistance(wx: number, wz: number, preset: MapPreset = 'canyon'): number {
  let minD = 9999;
  const steps = 48;
  const waveAmp = preset === 'arctic' ? 16.0 : preset === 'volcanic' ? 6.0 : 11.0;
  const waveFreq = preset === 'arctic' ? 1.5 : 2.0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const baseX = 24 + t * (WORLD_SIZE - 48);
    const baseZ = WORLD_SIZE - 24 - t * (WORLD_SIZE - 48);
    const wave = Math.sin(t * Math.PI * waveFreq) * waveAmp;
    const rx = baseX + wave * 0.707;
    const rz = baseZ + wave * 0.707;
    const d = Math.hypot(wx - rx, wz - rz);
    if (d < minD) minD = d;
  }
  return minD;
}

interface MesaDef {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  height: number;
  angle: number;
}

const PRESET_MESAS: Record<MapPreset, MesaDef[]> = {
  canyon: [
    { cx: 52, cz: 60, rx: 14, rz: 9, height: 6.4, angle: 0.45 },
    { cx: 92, cz: 84, rx: 15, rz: 9.5, height: 6.8, angle: -0.35 },
    { cx: 18, cz: 20, rx: 18, rz: 14, height: 8.2, angle: 0.2 },
    { cx: 126, cz: 124, rx: 18, rz: 14, height: 8.2, angle: -0.2 },
    { cx: 40, cz: 36, rx: 7, rz: 5.5, height: 4.8, angle: 0.7 },
    { cx: 104, cz: 108, rx: 7.5, rz: 5.5, height: 4.8, angle: -0.6 },
    { cx: 74, cz: 7, rx: 24, rz: 6.5, height: 7.4, angle: 0.05 },
    { cx: 70, cz: 137, rx: 24, rz: 6.5, height: 7.4, angle: -0.05 },
  ],
  arctic: [
    // Sharp twin alpine ridges creating wide flanking corridors
    { cx: 60, cz: 48, rx: 15, rz: 8.5, height: 7.8, angle: -0.55 },
    { cx: 84, cz: 96, rx: 15, rz: 8.5, height: 7.8, angle: -0.55 },
    { cx: 16, cz: 18, rx: 16, rz: 16, height: 9.2, angle: 0.3 },
    { cx: 128, cz: 126, rx: 16, rz: 16, height: 9.2, angle: 0.3 },
    { cx: 24, cz: 72, rx: 8, rz: 10, height: 6.2, angle: 0.1 },
    { cx: 120, cz: 72, rx: 8, rz: 10, height: 6.2, angle: -0.1 },
  ],
  volcanic: [
    // Central caldera ring with 3 dramatic breach lanes
    { cx: 56, cz: 72, rx: 10, rz: 14, height: 7.4, angle: 0.25 },
    { cx: 88, cz: 72, rx: 10, rz: 14, height: 7.4, angle: 0.25 },
    { cx: 72, cz: 20, rx: 19, rz: 8, height: 8.5, angle: 0.0 },
    { cx: 72, cz: 124, rx: 19, rz: 8, height: 8.5, angle: 0.0 },
    { cx: 20, cz: 24, rx: 15, rz: 12, height: 8.2, angle: -0.3 },
    { cx: 124, cz: 120, rx: 15, rz: 12, height: 8.2, angle: -0.3 },
  ],
};

export function sampleTerrainHeight(map: MapData, wx: number, wz: number): number {
  const cols = map.size + 1;
  const fx = Math.max(0, Math.min(map.size - 0.001, wx / map.tileSize));
  const fz = Math.max(0, Math.min(map.size - 0.001, wz / map.tileSize));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = map.heights[z0 * cols + x0];
  const h10 = map.heights[z0 * cols + (x0 + 1)];
  const h01 = map.heights[(z0 + 1) * cols + x0];
  const h11 = map.heights[(z0 + 1) * cols + (x0 + 1)];
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - tz) + hx1 * tz;
}

export function generateMap(preset: MapPreset = 'canyon'): MapData {
  const size = MAP_SIZE;
  const cols = size + 1;
  const heights = new Float32Array(cols * cols);
  const walkable = new Uint8Array(size * size);
  const buildable = new Uint8Array(size * size);
  const roadMask = new Float32Array(size * size);
  const ore = new Float32Array(size * size);
  const isGem = new Uint8Array(size * size);

  const alliesCenter = { x: 24, z: WORLD_SIZE - 24 };
  const sovietsCenter = { x: WORLD_SIZE - 24, z: 24 };
  const mesas = PRESET_MESAS[preset];
  const seed = preset === 'arctic' ? 2025 : preset === 'volcanic' ? 6667 : 42;

  // Flanking Tech Oil Derrick coordinates (always flat & reachable)
  const derrickSpots: Vec2[] = [
    { x: 24, z: 54 }, // West flank derrick
    { x: WORLD_SIZE - 24, z: WORLD_SIZE - 54 }, // East flank derrick
  ];

  for (let vz = 0; vz < cols; vz++) {
    for (let vx = 0; vx < cols; vx++) {
      const wx = vx * TILE_SIZE;
      const wz = vz * TILE_SIZE;

      let h = (fbm(wx * 0.035, wz * 0.035, seed) - 0.45) * 1.15;

      for (const m of mesas) {
        const dx = wx - m.cx;
        const dz = wz - m.cz;
        const cos = Math.cos(m.angle);
        const sin = Math.sin(m.angle);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const n = (fbm(wx * 0.09, wz * 0.09, seed + 57) - 0.5) * 0.35;
        const ell = Math.hypot(lx / m.rx, lz / m.rz) + n;
        if (ell < 1.15) {
          const plateau = 1.0 - smoothstep(0.68, 1.08, ell);
          const terraced = Math.round(plateau * 4.5) / 4.5 * 0.3 + plateau * 0.7;
          const capRoughness = (fbm(wx * 0.14, wz * 0.14, seed + 261) - 0.5) * 0.7;
          h = Math.max(h, terraced * m.height + plateau * capRoughness);
        }
      }

      // Flatten base pads & Oil Derrick plateaus
      const dAllies = Math.hypot(wx - alliesCenter.x, wz - alliesCenter.z);
      const dSoviets = Math.hypot(wx - sovietsCenter.x, wz - sovietsCenter.z);
      let flatten = Math.max(
        1 - smoothstep(14, 26, dAllies),
        1 - smoothstep(14, 26, dSoviets)
      );
      for (const ds of derrickSpots) {
        flatten = Math.max(flatten, 1 - smoothstep(6, 13, Math.hypot(wx - ds.x, wz - ds.z)));
      }
      h *= 1 - flatten * 0.92;

      const rDist = roadDistance(wx, wz, preset);
      const roadFlatten = 1 - smoothstep(4.2, 8.5, rDist);
      h *= 1 - roadFlatten * 0.94;

      heights[vz * cols + vx] = Math.max(0, h);
    }
  }

  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const idx = gz * size + gx;
      const wx = (gx + 0.5) * TILE_SIZE;
      const wz = (gz + 0.5) * TILE_SIZE;

      const h00 = heights[gz * cols + gx];
      const h10 = heights[gz * cols + (gx + 1)];
      const h01 = heights[(gz + 1) * cols + gx];
      const h11 = heights[(gz + 1) * cols + (gx + 1)];
      const avgH = (h00 + h10 + h01 + h11) * 0.25;
      const maxDiff = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);

      const rDist = roadDistance(wx, wz, preset);
      const onRoad = 1 - smoothstep(2.9, 4.1, rDist);
      roadMask[idx] = onRoad;

      const nearBorder = gx <= 0 || gz <= 0 || gx >= size - 1 || gz >= size - 1;
      const isCliff = avgH > 1.35 || maxDiff > 0.72;

      walkable[idx] = !nearBorder && !isCliff ? 1 : 0;
      buildable[idx] =
        !nearBorder && !isCliff && avgH < 0.85 && maxDiff < 0.38 && onRoad < 0.35 ? 1 : 0;

      // Reserve tiny footprint directly around Tech Oil Derricks
      for (const ds of derrickSpots) {
        if (Math.hypot(wx - ds.x, wz - ds.z) < 4.0) {
          buildable[idx] = 0;
        }
      }
    }
  }

  const addOrePatch = (cx: number, cz: number, radiusTiles: number, amount: number, gem = false) => {
    for (let dz = -radiusTiles; dz <= radiusTiles; dz++) {
      for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 2 || gz < 2 || gx >= size - 2 || gz >= size - 2) continue;
        const d = Math.hypot(dx, dz);
        const jitter = hash2d(gx, gz, seed + 777) * 0.9;
        if (d + jitter <= radiusTiles + 0.2) {
          const idx = gz * size + gx;
          if (walkable[idx] && roadMask[idx] < 0.25) {
            ore[idx] = amount * (0.75 + hash2d(gx, gz, seed + 888) * 0.5);
            isGem[idx] = gem ? 1 : 0;
            buildable[idx] = 0;
          }
        }
      }
    }
  };

  // Safe starting ore patches
  addOrePatch(22, size - 14, 4, 900, false);
  addOrePatch(8, size - 22, 3, 800, false);
  addOrePatch(size - 22, 14, 4, 900, false);
  addOrePatch(size - 8, 22, 3, 800, false);

  // Rich contested gem basins
  const gemAmt = preset === 'volcanic' ? 1850 : 1400;
  addOrePatch(16, 36, 3, gemAmt, true);
  addOrePatch(size - 16, size - 36, 3, gemAmt, true);
  addOrePatch(Math.floor(size / 2), Math.floor(size / 2), 3, gemAmt + 250, true);

  const props: MapProp[] = [];
  const mapObj: MapData = {
    preset,
    theme: MAP_THEMES[preset],
    size,
    tileSize: TILE_SIZE,
    worldSize: WORLD_SIZE,
    heights,
    walkable,
    buildable,
    roadMask,
    ore,
    isGem,
    props,
    derrickSpots,
    alliesStart: { gx: 10, gz: size - 13 },
    sovietsStart: { gx: size - 13, gz: 10 },
  };

  for (let i = 0; i < 165; i++) {
    const r1 = hash2d(i, 1, seed + 5150);
    const r2 = hash2d(i, 2, seed + 5150);
    const r3 = hash2d(i, 3, seed + 5150);
    const r4 = hash2d(i, 4, seed + 5150);
    const gx = Math.floor(2 + r1 * (size - 4));
    const gz = Math.floor(2 + r2 * (size - 4));
    const idx = gz * size + gx;
    const wx = (gx + 0.5) * TILE_SIZE;
    const wz = (gz + 0.5) * TILE_SIZE;

    if (Math.hypot(wx - alliesCenter.x, wz - alliesCenter.z) < 22) continue;
    if (Math.hypot(wx - sovietsCenter.x, wz - sovietsCenter.z) < 22) continue;
    if (derrickSpots.some((ds) => Math.hypot(wx - ds.x, wz - ds.z) < 7)) continue;
    if (ore[idx] > 0 || roadMask[idx] > 0.1) continue;

    const h = sampleTerrainHeight(mapObj, wx, wz);
    if (!walkable[idx] && h > 2.2) {
      props.push({
        kind: preset === 'arctic' && r3 > 0.45 ? 'pine_tree' : r3 > 0.45 ? 'rock_large' : 'rock_small',
        x: wx,
        y: h - 0.12,
        z: wz,
        scale: 0.8 + r4 * 1.3,
        rotation: r3 * Math.PI * 2,
      });
    } else if (walkable[idx] && r3 > 0.72) {
      const rd = roadDistance(wx, wz, preset);
      if (rd > 4.6 && rd < 7.8) {
        props.push({
          kind: r4 > 0.5 ? 'barrels' : 'outpost_crate',
          x: wx,
          y: h,
          z: wz,
          scale: 0.9 + r4 * 0.25,
          rotation: r3 * Math.PI * 2,
        });
      }
    }
  }

  return mapObj;
}

export function generateCanyonMap(): MapData {
  return generateMap('canyon');
}
