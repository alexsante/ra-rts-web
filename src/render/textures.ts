import * as THREE from 'three';
import { MAP_SIZE, TILE_SIZE, WORLD_SIZE } from '../sim/config';
import { sampleTerrainHeight } from '../sim/mapGen';
import { Faction, MapData, UnitType } from '../sim/types';

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Generates a high-resolution themed albedo texture for Canyon, Arctic, or Volcanic maps.
 */
export function createTerrainAlbedoTexture(map: MapData): THREE.CanvasTexture {
  const res = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  const data = img.data;
  const preset = map.preset;

  for (let py = 0; py < res; py++) {
    const wz = (py / res) * WORLD_SIZE;
    const gz = Math.min(MAP_SIZE - 1, Math.floor(wz / TILE_SIZE));
    for (let px = 0; px < res; px++) {
      const wx = (px / res) * WORLD_SIZE;
      const gx = Math.min(MAP_SIZE - 1, Math.floor(wx / TILE_SIZE));
      const h = sampleTerrainHeight(map, wx, wz);
      const hRight = sampleTerrainHeight(map, Math.min(WORLD_SIZE - 0.1, wx + 0.6), wz);
      const hDown = sampleTerrainHeight(map, wx, Math.min(WORLD_SIZE - 0.1, wz + 0.6));
      const slope = Math.hypot(hRight - h, hDown - h) / 0.6;

      const grain = (hash(px, py) - 0.5) * 14;
      const ripple = Math.sin(wx * 1.15 + wz * 0.45 + Math.sin(wz * 0.35) * 1.8) * 6;
      const macro = Math.sin(wx * 0.09) * Math.cos(wz * 0.08) * 9;

      let r: number;
      let g: number;
      let b: number;

      if (preset === 'arctic') {
        // Crisp sunlit alpine snowfield
        r = 216 + ripple * 0.5 + macro * 0.6 + grain * 0.6;
        g = 226 + ripple * 0.5 + macro * 0.6 + grain * 0.6;
        b = 238 + ripple * 0.4 + macro * 0.5 + grain * 0.5;

        // Exposed dark slate granite cliffs
        const cliffBlend = Math.max(0, Math.min(1, (slope - 0.18) * 2.2 + Math.max(0, h - 1.5) * 0.15));
        if (cliffBlend > 0.01) {
          const strata = Math.sin(h * 7.5) * 12;
          r = r * (1 - cliffBlend) + (82 + strata + grain) * cliffBlend;
          g = g * (1 - cliffBlend) + (94 + strata + grain) * cliffBlend;
          b = b * (1 - cliffBlend) + (112 + strata + grain) * cliffBlend;
        }
        // Snow caps on flat mesa tops
        if (h > 4.5 && slope < 0.25) {
          r = r * 0.4 + 232 * 0.6;
          g = g * 0.4 + 240 * 0.6;
          b = b * 0.4 + 248 * 0.6;
        }
      } else if (preset === 'volcanic') {
        // Dark volcanic ash & iron-rich scorched earth
        r = 92 + ripple * 0.6 + macro * 0.8 + grain;
        g = 72 + ripple * 0.5 + macro * 0.6 + grain * 0.8;
        b = 66 + ripple * 0.4 + macro * 0.5 + grain * 0.7;

        const cliffBlend = Math.max(0, Math.min(1, (slope - 0.18) * 2.2 + Math.max(0, h - 1.2) * 0.18));
        if (cliffBlend > 0.01) {
          const ember = Math.sin(h * 9.0 + wx * 0.2) > 0.86 ? 95 : 0;
          r = r * (1 - cliffBlend) + (56 + ember + grain) * cliffBlend;
          g = g * (1 - cliffBlend) + (40 + ember * 0.35 + grain * 0.7) * cliffBlend;
          b = b * (1 - cliffBlend) + (42 + grain * 0.6) * cliffBlend;
        }
      } else {
        // Warm golden-ochre desert canyon (default)
        r = 204 + ripple + macro + grain;
        g = 166 + ripple * 0.8 + macro * 0.7 + grain * 0.85;
        b = 122 + ripple * 0.5 + macro * 0.5 + grain * 0.65;

        const cliffBlend = Math.max(0, Math.min(1, (slope - 0.18) * 2.1 + Math.max(0, h - 1.1) * 0.18));
        if (cliffBlend > 0.01) {
          const strata = Math.sin(h * 7.5) * 14;
          r = r * (1 - cliffBlend) + (136 + strata + grain * 1.2) * cliffBlend;
          g = g * (1 - cliffBlend) + (92 + strata * 0.75 + grain) * cliffBlend;
          b = b * (1 - cliffBlend) + (66 + strata * 0.5 + grain * 0.7) * cliffBlend;
        }
        if (h > 4.2 && slope < 0.3) {
          const topBlend = Math.min(1, (h - 4.2) * 0.45);
          r = r * (1 - topBlend * 0.35) + 168 * (topBlend * 0.35);
          g = g * (1 - topBlend * 0.35) + 124 * (topBlend * 0.35);
          b = b * (1 - topBlend * 0.35) + 92 * (topBlend * 0.35);
        }
      }

      // Road asphalt blending
      const road = map.roadMask[gz * MAP_SIZE + gx];
      if (road > 0.05) {
        const dustNoise = (hash(px * 0.5, py * 0.5) - 0.5) * 16;
        const ar = (preset === 'arctic' ? 76 : 62) + dustNoise;
        const ag = (preset === 'arctic' ? 82 : 61) + dustNoise;
        const ab = (preset === 'arctic' ? 92 : 65) + dustNoise;
        const asphalt = Math.max(0, Math.min(1, (road - 0.15) * 1.45));
        r = r * (1 - asphalt) + ar * asphalt;
        g = g * (1 - asphalt) + ag * asphalt;
        b = b * (1 - asphalt) + ab * asphalt;
      }

      if (map.ore[gz * MAP_SIZE + gx] > 0) {
        const gem = map.isGem[gz * MAP_SIZE + gx] > 0;
        r = r * 0.78 + (gem ? 165 : 185) * 0.22;
        g = g * 0.78 + (gem ? 80 : 140) * 0.22;
        b = b * 0.78 + (gem ? 100 : 50) * 0.22;
      }

      const i = (py * res + px) * 4;
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Paint weathered asphalt highway ribbon + dashed yellow centerline
  ctx.save();
  const toPx = (wx: number, wz: number): [number, number] => [
    (wx / WORLD_SIZE) * res,
    (wz / WORLD_SIZE) * res,
  ];
  const waveAmp = preset === 'arctic' ? 16.0 : preset === 'volcanic' ? 6.0 : 11.0;
  const waveFreq = preset === 'arctic' ? 1.5 : 2.0;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const baseX = 24 + t * (WORLD_SIZE - 48);
    const baseZ = WORLD_SIZE - 24 - t * (WORLD_SIZE - 48);
    const wave = Math.sin(t * Math.PI * waveFreq) * waveAmp;
    pts.push(toPx(baseX + wave * 0.707, baseZ + wave * 0.707));
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = preset === 'arctic' ? 'rgba(62, 68, 78, 0.85)' : 'rgba(48, 47, 50, 0.88)';
  ctx.lineWidth = 42;
  ctx.beginPath();
  pts.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();

  ctx.strokeStyle = 'rgba(32, 32, 36, 0.45)';
  ctx.lineWidth = 22;
  ctx.stroke();

  ctx.strokeStyle = preset === 'volcanic' ? 'rgba(245, 148, 62, 0.72)' : 'rgba(232, 186, 78, 0.78)';
  ctx.lineWidth = 2.6;
  ctx.setLineDash([12, 14]);
  ctx.beginPath();
  pts.forEach(([x, y], idx) => (idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createTerrainBumpTexture(): THREE.CanvasTexture {
  const res = 256;
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const wave = Math.sin(x * 0.2 + Math.sin(y * 0.12) * 2.0) * 24;
      const grit = (hash(x, y) - 0.5) * 48;
      const v = Math.max(0, Math.min(255, 128 + wave + grit));
      const i = (y * res + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  return tex;
}

export function createHazardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e5a823';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1b1d20';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i - 112, 128);
    ctx.lineTo(i - 128, 128);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSoftParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCraterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 60);
  grad.addColorStop(0, 'rgba(18, 14, 12, 0.88)');
  grad.addColorStop(0.42, 'rgba(34, 24, 18, 0.68)');
  grad.addColorStop(0.75, 'rgba(65, 48, 34, 0.25)');
  grad.addColorStop(1, 'rgba(65, 48, 34, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const badgeCache = new Map<string, THREE.CanvasTexture>();

/**
 * Overhead tactical chevron/shield badges with Veterancy rank stars (★ / ★★★).
 */
export function getTacticalBadgeTexture(
  faction: Faction,
  type: UnitType,
  rank: 0 | 1 | 2 = 0
): THREE.CanvasTexture {
  const key = `${faction}:${type}:${rank}`;
  const cached = badgeCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 120;
  const ctx = canvas.getContext('2d')!;

  const primary = faction === 'allies' ? '#1e78d6' : '#c92a2a';
  const accent = faction === 'allies' ? '#70c5ff' : '#ff7b6b';
  const borderCol = rank === 2 ? '#ffbe2e' : rank === 1 ? '#fde047' : primary;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(14, 22);
  ctx.lineTo(82, 22);
  ctx.lineTo(82, 72);
  ctx.lineTo(48, 110);
  ctx.lineTo(14, 72);
  ctx.closePath();
  ctx.fillStyle = 'rgba(14, 18, 24, 0.9)';
  ctx.fill();
  ctx.lineWidth = rank > 0 ? 6 : 5;
  ctx.strokeStyle = borderCol;
  ctx.stroke();

  // Inner top faction strip
  ctx.fillStyle = primary;
  ctx.fillRect(19, 27, 58, 11);

  // Veterancy chevrons / stars above shield
  if (rank > 0) {
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = rank === 2 ? '#ff5e5e' : '#fde047';
    ctx.strokeStyle = '#090c10';
    ctx.lineWidth = 4;
    const stars = rank === 2 ? '★★★' : '★';
    ctx.strokeText(stars, 48, 18);
    ctx.fillText(stars, 48, 18);
  }

  // Unit silhouette icon
  ctx.fillStyle = '#f1f5f9';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;

  if (type === 'rifle') {
    ctx.beginPath();
    ctx.moveTo(28, 66);
    ctx.lineTo(48, 48);
    ctx.lineTo(68, 66);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(48, 76, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'rocket') {
    ctx.beginPath();
    ctx.moveTo(48, 43);
    ctx.lineTo(58, 62);
    ctx.lineTo(54, 80);
    ctx.lineTo(42, 80);
    ctx.lineTo(38, 62);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'tesla_trooper') {
    ctx.fillStyle = '#4aeaff';
    ctx.beginPath();
    ctx.moveTo(54, 41);
    ctx.lineTo(35, 63);
    ctx.lineTo(48, 63);
    ctx.lineTo(42, 84);
    ctx.lineTo(62, 59);
    ctx.lineTo(49, 59);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'harvester') {
    ctx.fillStyle = '#f5b82e';
    ctx.beginPath();
    ctx.moveTo(48, 44);
    ctx.lineTo(66, 64);
    ctx.lineTo(48, 84);
    ctx.lineTo(30, 64);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'medium_tank') {
    ctx.fillRect(30, 54, 36, 20);
    ctx.fillRect(44, 42, 8, 16);
  } else if (type === 'v2_launcher') {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(64, 43);
    ctx.lineTo(68, 53);
    ctx.lineTo(40, 81);
    ctx.lineTo(32, 73);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(58, 43, 8, 8);
  } else if (type === 'mammoth_tank') {
    ctx.fillRect(26, 56, 44, 22);
    ctx.fillRect(36, 42, 7, 16);
    ctx.fillRect(53, 42, 7, 16);
  } else if (type === 'kirov') {
    // Iconic Zeppelin silhouette!
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.ellipse(48, 60, 24, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(38, 72, 20, 6);
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  badgeCache.set(key, tex);
  return tex;
}
