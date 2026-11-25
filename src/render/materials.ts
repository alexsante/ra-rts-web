import * as THREE from 'three';
import { Faction, MapThemeColors } from '../sim/types';

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * Builds a procedural sunlit sky+ground IBL environment map via PMREMGenerator.
 * Gives all PBR metallic surfaces (armor, barrels, copper coils, glass, chrome)
 * crisp specular reflections and realistic bounce light with zero external HDRIs.
 */
export function createEnvironmentIBL(
  renderer: THREE.WebGLRenderer,
  theme: MapThemeColors
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  // Gradient sky dome inside the probe scene
  const skyGeo = new THREE.SphereGeometry(40, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topCol: { value: new THREE.Color(theme.skyTopHex) },
      horCol: { value: new THREE.Color(theme.skyHorizonHex) },
      gndCol: { value: new THREE.Color(theme.hemiGroundHex) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topCol;
      uniform vec3 horCol;
      uniform vec3 gndCol;
      varying vec3 vPos;
      void main() {
        float y = vPos.y;
        vec3 col = y >= 0.0
          ? mix(horCol, topCol, pow(y, 0.6))
          : mix(horCol * 0.75, gndCol, clamp(-y * 2.0, 0.0, 1.0));
        gl_FragColor = vec4(col * 1.15, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));

  // Bright sun specular disc in the environment map for crisp metallic glints
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 12, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.sunHex).multiplyScalar(3.5) })
  );
  sunDisc.position.set(18, 22, 18);
  envScene.add(sunDisc);

  // Subtle cool fill reflector opposite the sun
  const fillPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 14),
    new THREE.MeshBasicMaterial({ color: 0xa8ccf0, side: THREE.DoubleSide })
  );
  fillPanel.position.set(-22, 12, -18);
  fillPanel.lookAt(0, 0, 0);
  envScene.add(fillPanel);

  const rt = pmrem.fromScene(envScene, 0.035);
  skyGeo.dispose();
  skyMat.dispose();
  sunDisc.geometry.dispose();
  (sunDisc.material as THREE.Material).dispose();
  fillPanel.geometry.dispose();
  (fillPanel.material as THREE.Material).dispose();
  pmrem.dispose();

  return rt.texture;
}

// --- PROCEDURAL PBR CANVAS TEXTURES (CACHED ONCE) ---

interface MaterialLibrary {
  armorBump: THREE.CanvasTexture;
  armorRough: THREE.CanvasTexture;
  concreteMap: THREE.CanvasTexture;
  concreteBump: THREE.CanvasTexture;
  corrugatedMap: THREE.CanvasTexture;
  corrugatedBump: THREE.CanvasTexture;
  treadMap: THREE.CanvasTexture;
  treadBump: THREE.CanvasTexture;
  ventMap: THREE.CanvasTexture;
  ventBump: THREE.CanvasTexture;
  hazardMap: THREE.CanvasTexture;
  glassMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  kirovCanvasMap: Record<Faction, THREE.CanvasTexture>;
  cratePanelMap: THREE.CanvasTexture;
}

let cachedLib: MaterialLibrary | null = null;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finalizeTex(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  srgb = true
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildArmorBumpAndRough(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [bc, bctx] = makeCanvas(256, 256);
  const [rc, rctx] = makeCanvas(256, 256);

  // Neutral metallic plate base
  bctx.fillStyle = '#888888';
  bctx.fillRect(0, 0, 256, 256);
  rctx.fillStyle = '#868686';
  rctx.fillRect(0, 0, 256, 256);

  // Subtle brushed metal micro-grain & weathering
  for (let i = 0; i < 650; i++) {
    const x = hash(i, 1) * 256;
    const y = hash(i, 2) * 256;
    const len = 8 + hash(i, 3) * 32;
    const v = Math.floor(110 + hash(i, 4) * 40);
    bctx.fillStyle = `rgb(${v},${v},${v})`;
    bctx.fillRect(x, y, len, 1.5);
    const rv = Math.floor(95 + hash(i, 5) * 85);
    rctx.fillStyle = `rgb(${rv},${rv},${rv})`;
    rctx.fillRect(x, y, len, 2);
  }

  // Recessed armored plate seam grid (2x2 plates)
  bctx.strokeStyle = '#323232';
  bctx.lineWidth = 3;
  bctx.strokeRect(2, 2, 124, 124);
  bctx.strokeRect(130, 2, 124, 124);
  bctx.strokeRect(2, 130, 124, 124);
  bctx.strokeRect(130, 130, 124, 124);

  // Bright chamfer edge highlights beside seams
  bctx.strokeStyle = '#b8b8b8';
  bctx.lineWidth = 1.5;
  bctx.strokeRect(5, 5, 118, 118);
  bctx.strokeRect(133, 5, 118, 118);
  bctx.strokeRect(5, 133, 118, 118);
  bctx.strokeRect(133, 133, 118, 118);

  // Darker grime/rougher dirt accumulated along seams
  rctx.strokeStyle = '#d4d4d4';
  rctx.lineWidth = 5;
  rctx.strokeRect(2, 2, 124, 124);
  rctx.strokeRect(130, 2, 124, 124);
  rctx.strokeRect(2, 130, 124, 124);
  rctx.strokeRect(130, 130, 124, 124);

  // Raised steel rivets around panel perimeters
  const drawRivets = (ox: number, oy: number) => {
    for (let k = 0; k < 4; k++) {
      const p = 16 + k * 31;
      const pts: Array<[number, number]> = [
        [ox + p, oy + 11],
        [ox + p, oy + 113],
        [ox + 11, oy + p],
        [ox + 113, oy + p],
      ];
      for (const [rx, ry] of pts) {
        bctx.fillStyle = '#dcdcdc';
        bctx.beginPath();
        bctx.arc(rx, ry, 2.3, 0, Math.PI * 2);
        bctx.fill();
        rctx.fillStyle = '#555555';
        rctx.beginPath();
        rctx.arc(rx, ry, 2.3, 0, Math.PI * 2);
        rctx.fill();
      }
    }
  };
  drawRivets(2, 2);
  drawRivets(130, 2);
  drawRivets(2, 130);
  drawRivets(130, 130);

  return [finalizeTex(bc, 1, 1, false), finalizeTex(rc, 1, 1, false)];
}

function buildConcreteTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [ac, actx] = makeCanvas(256, 256);
  const [bc, bctx] = makeCanvas(256, 256);

  actx.fillStyle = '#6c6a63';
  actx.fillRect(0, 0, 256, 256);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);

  // Aggregate mineral speckle & oil smudges
  for (let i = 0; i < 1600; i++) {
    const x = hash(i, 11) * 256;
    const y = hash(i, 12) * 256;
    const sz = 1 + hash(i, 13) * 2.5;
    const d = Math.floor((hash(i, 14) - 0.5) * 32);
    actx.fillStyle = `rgb(${108 + d},${105 + d},${98 + d})`;
    actx.fillRect(x, y, sz, sz);
    const bv = 128 + d * 2;
    bctx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bctx.fillRect(x, y, sz, sz);
  }

  // Subtle weathered oil/dust stains
  for (let i = 0; i < 6; i++) {
    const x = hash(i, 21) * 256;
    const y = hash(i, 22) * 256;
    const rad = 18 + hash(i, 23) * 36;
    const g = actx.createRadialGradient(x, y, 2, x, y, rad);
    g.addColorStop(0, 'rgba(38, 35, 30, 0.25)');
    g.addColorStop(1, 'rgba(38, 35, 30, 0)');
    actx.fillStyle = g;
    actx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Cast concrete slab expansion joints
  actx.strokeStyle = 'rgba(28, 27, 25, 0.65)';
  actx.lineWidth = 3;
  bctx.strokeStyle = '#252525';
  bctx.lineWidth = 4;
  for (let p = 0; p < 256; p += 64) {
    actx.beginPath();
    actx.moveTo(p, 0);
    actx.lineTo(p, 256);
    actx.moveTo(0, p);
    actx.lineTo(256, p);
    actx.stroke();
    bctx.beginPath();
    bctx.moveTo(p, 0);
    bctx.lineTo(p, 256);
    bctx.moveTo(0, p);
    bctx.lineTo(256, p);
    bctx.stroke();
  }

  return [finalizeTex(ac, 2, 2, true), finalizeTex(bc, 2, 2, false)];
}

function buildCorrugatedTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [ac, actx] = makeCanvas(256, 256);
  const [bc, bctx] = makeCanvas(256, 256);

  for (let x = 0; x < 256; x++) {
    const rib = Math.sin((x / 256) * Math.PI * 24) * 0.5 + 0.5;
    const shade = Math.floor(148 + rib * 54);
    actx.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
    actx.fillRect(x, 0, 1, 256);
    const b = Math.floor(65 + rib * 155);
    bctx.fillStyle = `rgb(${b},${b},${b})`;
    bctx.fillRect(x, 0, 1, 256);
  }

  // Horizontal structural seam & subtle grime
  actx.fillStyle = 'rgba(20, 22, 26, 0.35)';
  actx.fillRect(0, 126, 256, 4);
  actx.fillRect(0, 252, 256, 4);
  bctx.fillStyle = '#222222';
  bctx.fillRect(0, 126, 256, 4);

  return [finalizeTex(ac, 2, 1, true), finalizeTex(bc, 2, 1, false)];
}

function buildTreadTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [ac, actx] = makeCanvas(128, 256);
  const [bc, bctx] = makeCanvas(128, 256);

  actx.fillStyle = '#1f2124';
  actx.fillRect(0, 0, 128, 256);
  bctx.fillStyle = '#303030';
  bctx.fillRect(0, 0, 128, 256);

  // Heavy repeating tank grouser cleats + central guide pins
  for (let y = 0; y < 256; y += 16) {
    actx.fillStyle = '#35383d';
    actx.fillRect(6, y + 2, 50, 10);
    actx.fillRect(72, y + 2, 50, 10);
    // Subtle dusty soil tint in crevices
    actx.fillStyle = '#473c30';
    actx.fillRect(0, y + 13, 128, 3);

    bctx.fillStyle = '#e0e0e0';
    bctx.fillRect(6, y + 2, 50, 10);
    bctx.fillRect(72, y + 2, 50, 10);
  }

  return [finalizeTex(ac, 1, 3, true), finalizeTex(bc, 1, 3, false)];
}

function buildVentTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const [ac, actx] = makeCanvas(128, 128);
  const [bc, bctx] = makeCanvas(128, 128);

  actx.fillStyle = '#2a2f36';
  actx.fillRect(0, 0, 128, 128);
  bctx.fillStyle = '#909090';
  bctx.fillRect(0, 0, 128, 128);

  for (let y = 10; y < 118; y += 12) {
    actx.fillStyle = '#0e1114';
    actx.fillRect(10, y, 108, 6);
    actx.fillStyle = '#4f5763';
    actx.fillRect(10, y + 6, 108, 2);

    bctx.fillStyle = '#181818';
    bctx.fillRect(10, y, 108, 6);
    bctx.fillStyle = '#dcdcdc';
    bctx.fillRect(10, y + 6, 108, 3);
  }
  actx.strokeStyle = '#5a6370';
  actx.lineWidth = 6;
  actx.strokeRect(3, 3, 122, 122);

  return [finalizeTex(ac, 1, 1, true), finalizeTex(bc, 1, 1, false)];
}

function buildWeatheredHazardTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#dfa01e';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#191b1f';
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 16, 0);
    ctx.lineTo(i - 112, 128);
    ctx.lineTo(i - 128, 128);
    ctx.closePath();
    ctx.fill();
  }
  // Gritty scratches & edge dirt
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = hash(i, 7) > 0.5 ? 'rgba(60,48,36,0.35)' : 'rgba(220,210,190,0.22)';
    ctx.fillRect(hash(i, 8) * 128, hash(i, 9) * 128, 2 + hash(i, 10) * 6, 2);
  }
  return finalizeTex(c, 2, 1, true);
}

function buildGlassTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#99dcff');
  g.addColorStop(0.42, '#2d5c85');
  g.addColorStop(0.55, '#132538');
  g.addColorStop(1, '#26445e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  // Subtle window mullions
  ctx.strokeStyle = 'rgba(15, 20, 28, 0.75)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.stroke();

  return finalizeTex(c, 1, 1, true);
}

function buildContactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
  g.addColorStop(0, 'rgba(8, 6, 4, 0.62)');
  g.addColorStop(0.55, 'rgba(8, 6, 4, 0.34)');
  g.addColorStop(1, 'rgba(8, 6, 4, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finalizeTex(c, 1, 1, true);
}

function buildKirovFabricTexture(faction: Faction): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 256);
  // Warm doped linen / armored dirigible fabric
  ctx.fillStyle = '#c8bc9e';
  ctx.fillRect(0, 0, 512, 256);

  // Longitudinal rib ribs & stitched panels
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = 'rgba(40, 34, 28, 0.22)';
    ctx.fillRect(0, y, 512, 3);
  }
  for (let x = 0; x < 512; x += 42) {
    ctx.fillStyle = 'rgba(40, 34, 28, 0.16)';
    ctx.fillRect(x, 0, 2, 256);
  }

  const teamHex = faction === 'allies' ? '#1e5fa8' : '#b22222';
  // Bold faction war stripe around nose (right side of UV along Lathe V)
  ctx.fillStyle = teamHex;
  ctx.fillRect(0, 0, 512, 68);
  ctx.fillStyle = '#e5a823';
  ctx.fillRect(0, 68, 512, 10);

  // Iconic shark-tooth grin along the upper nose band!
  ctx.fillStyle = '#f8fafc';
  for (let x = 8; x < 512; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 68);
    ctx.lineTo(x + 12, 46);
    ctx.lineTo(x + 24, 68);
    ctx.closePath();
    ctx.fill();
  }

  // Tail band
  ctx.fillStyle = teamHex;
  ctx.fillRect(0, 212, 512, 44);

  return finalizeTex(c, 1, 1, true);
}

function buildCrateTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#9c7840';
  ctx.fillRect(0, 0, 128, 128);
  // Slatted wood planks
  ctx.strokeStyle = '#5c4320';
  ctx.lineWidth = 3;
  for (let y = 24; y < 128; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }
  // Heavy steel perimeter frame + diagonal brace
  ctx.strokeStyle = '#3c434d';
  ctx.lineWidth = 14;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.strokeStyle = '#e5a823';
  ctx.lineWidth = 5;
  ctx.strokeRect(14, 14, 100, 100);
  // Glowing star emblem in center
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(64, 64, 16, 0, Math.PI * 2);
  ctx.fill();
  return finalizeTex(c, 1, 1, true);
}

export function getMaterialLibrary(): MaterialLibrary {
  if (!cachedLib) {
    const [armorBump, armorRough] = buildArmorBumpAndRough();
    const [concreteMap, concreteBump] = buildConcreteTextures();
    const [corrugatedMap, corrugatedBump] = buildCorrugatedTextures();
    const [treadMap, treadBump] = buildTreadTextures();
    const [ventMap, ventBump] = buildVentTextures();
    cachedLib = {
      armorBump,
      armorRough,
      concreteMap,
      concreteBump,
      corrugatedMap,
      corrugatedBump,
      treadMap,
      treadBump,
      ventMap,
      ventBump,
      hazardMap: buildWeatheredHazardTexture(),
      glassMap: buildGlassTexture(),
      contactShadowMap: buildContactShadowTexture(),
      kirovCanvasMap: {
        allies: buildKirovFabricTexture('allies'),
        soviets: buildKirovFabricTexture('soviets'),
      },
      cratePanelMap: buildCrateTexture(),
    };
  }
  return cachedLib;
}

export interface FactionPalette {
  armorMat: THREE.MeshStandardMaterial;
  teamMat: THREE.MeshStandardMaterial;
  darkSteelMat: THREE.MeshStandardMaterial;
  gunmetalMat: THREE.MeshStandardMaterial;
  concreteMat: THREE.MeshStandardMaterial;
  corrugatedMat: THREE.MeshStandardMaterial;
  treadMat: THREE.MeshStandardMaterial;
  ventMat: THREE.MeshStandardMaterial;
  hazardMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  copperMat: THREE.MeshStandardMaterial;
  chromeMat: THREE.MeshStandardMaterial;
  sandbagMat: THREE.MeshStandardMaterial;
  rubberMat: THREE.MeshStandardMaterial;
  headlightMat: THREE.MeshStandardMaterial;
  glowHex: number;
  primaryHex: number;
}

const paletteCache = new Map<Faction, FactionPalette>();

/**
 * Shared, cached PBR material palette per faction (minimal GPU state changes + rich realism).
 */
export function getFactionPalette(faction: Faction): FactionPalette {
  const cached = paletteCache.get(faction);
  if (cached) return cached;

  const lib = getMaterialLibrary();
  const isAllies = faction === 'allies';
  const primaryHex = isAllies ? 0x2466b0 : 0xb52929;
  const armorHex = isAllies ? 0x6f7b87 : 0x655c57;
  const darkHex = isAllies ? 0x2a313a : 0x2a2424;
  const glowHex = isAllies ? 0x38d9ff : 0xff6230;

  const palette: FactionPalette = {
    armorMat: new THREE.MeshStandardMaterial({
      color: armorHex,
      bumpMap: lib.armorBump,
      bumpScale: 0.08,
      roughnessMap: lib.armorRough,
      roughness: 0.56,
      metalness: 0.52,
    }),
    teamMat: new THREE.MeshStandardMaterial({
      color: primaryHex,
      bumpMap: lib.armorBump,
      bumpScale: 0.06,
      roughnessMap: lib.armorRough,
      roughness: 0.44,
      metalness: 0.36,
    }),
    darkSteelMat: new THREE.MeshStandardMaterial({
      color: darkHex,
      bumpMap: lib.armorBump,
      bumpScale: 0.05,
      roughness: 0.54,
      metalness: 0.65,
    }),
    gunmetalMat: new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      roughness: 0.34,
      metalness: 0.86,
    }),
    concreteMat: new THREE.MeshStandardMaterial({
      map: lib.concreteMap,
      bumpMap: lib.concreteBump,
      bumpScale: 0.12,
      roughness: 0.92,
      metalness: 0.04,
    }),
    corrugatedMat: new THREE.MeshStandardMaterial({
      color: isAllies ? 0x89949e : 0x827974,
      map: lib.corrugatedMap,
      bumpMap: lib.corrugatedBump,
      bumpScale: 0.14,
      roughness: 0.58,
      metalness: 0.48,
    }),
    treadMat: new THREE.MeshStandardMaterial({
      map: lib.treadMap,
      bumpMap: lib.treadBump,
      bumpScale: 0.15,
      roughness: 0.85,
      metalness: 0.2,
    }),
    ventMat: new THREE.MeshStandardMaterial({
      map: lib.ventMap,
      bumpMap: lib.ventBump,
      bumpScale: 0.14,
      roughness: 0.62,
      metalness: 0.55,
    }),
    hazardMat: new THREE.MeshStandardMaterial({
      map: lib.hazardMap,
      roughness: 0.68,
      metalness: 0.18,
    }),
    glassMat: new THREE.MeshStandardMaterial({
      map: lib.glassMap,
      roughness: 0.12,
      metalness: 0.78,
      emissive: isAllies ? 0x1a486e : 0x5c2c16,
      emissiveIntensity: 0.42,
    }),
    copperMat: new THREE.MeshStandardMaterial({
      color: 0xd98744,
      roughness: 0.24,
      metalness: 0.92,
    }),
    chromeMat: new THREE.MeshStandardMaterial({
      color: 0xdde8f2,
      roughness: 0.1,
      metalness: 0.96,
    }),
    sandbagMat: new THREE.MeshStandardMaterial({
      color: 0xa69474,
      bumpMap: lib.concreteBump,
      bumpScale: 0.08,
      roughness: 0.95,
      metalness: 0.0,
    }),
    rubberMat: new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      roughness: 0.9,
      metalness: 0.08,
    }),
    headlightMat: new THREE.MeshStandardMaterial({
      color: 0xfff5d6,
      emissive: 0xffe49e,
      emissiveIntensity: 1.85,
      roughness: 0.15,
    }),
    glowHex,
    primaryHex,
  };

  paletteCache.set(faction, palette);
  return palette;
}

/**
 * Creates a soft baked contact-AO shadow decal that anchors a unit or building to the ground.
 */
export function createContactShadow(width: number, depth: number, opacity = 0.75): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: getMaterialLibrary().contactShadowMap,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.05;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Chamfered armor block geometry with real 45-degree beveled edges that catch specular light!
 */
export function createBeveledBox(
  w: number,
  h: number,
  d: number,
  bevel = 0.08
): THREE.BufferGeometry {
  const b = Math.min(bevel, w * 0.25, h * 0.25, d * 0.25);
  const hw = w * 0.5 - b;
  const hh = h * 0.5 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, d - b * 2),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

/**
 * Creates a sloped armored hull prism (classic MBT glacis silhouette) centered at origin.
 */
export function createSlopedHullGeometry(
  width: number,
  height: number,
  length: number,
  frontSlope = 0.35,
  rearSlope = 0.2,
  bevel = 0.06
): THREE.BufferGeometry {
  const hl = length * 0.5;
  const hh = height * 0.5;
  // Side profile in XY plane (X = Z-length, Y = height), then rotated so +Z is forward!
  const shape = new THREE.Shape();
  shape.moveTo(-hl + rearSlope * 0.4, -hh);
  shape.lineTo(hl - frontSlope * 0.3, -hh);
  shape.lineTo(hl, -hh * 0.15);
  shape.lineTo(hl - frontSlope, hh);
  shape.lineTo(-hl + rearSlope, hh);
  shape.lineTo(-hl, hh * 0.2);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.05, width - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
  });
  geo.center();
  // Rotate so X profile becomes +Z forward axis
  geo.rotateY(-Math.PI / 2);
  return geo;
}
