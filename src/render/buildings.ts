import * as THREE from 'three';
import { BUILDING_SPECS, TILE_SIZE } from '../sim/config';
import { BuildingType, Faction } from '../sim/types';
import {
  FactionPalette,
  createBeveledBox,
  createContactShadow,
  getFactionPalette,
  getMaterialLibrary,
} from './materials';

export interface BuildingMeshHandle {
  root: THREE.Group;
  body: THREE.Group;
  turret?: THREE.Object3D;
  animatedPart?: THREE.Object3D;
  secondaryAnimatedPart?: THREE.Object3D;
  siloDoors?: [THREE.Object3D, THREE.Object3D];
  glowMat?: THREE.MeshStandardMaterial;
}

export interface DerrickMeshHandle {
  root: THREE.Group;
  rockerArm: THREE.Object3D;
  ownerRingMat: THREE.MeshBasicMaterial;
  flagMat: THREE.MeshStandardMaterial;
  progressRing: THREE.Mesh;
}

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.noShadow !== true) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

// Reusable high-detail curved Lathe geometries
let cachedCoolingTowerGeo: THREE.LatheGeometry | null = null;
function getCoolingTowerGeo(): THREE.LatheGeometry {
  if (!cachedCoolingTowerGeo) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = t * 2.55;
      // Classic industrial hyperboloid profile
      const r = 0.86 - 0.34 * Math.sin(t * Math.PI * 0.88) + 0.08 * t * t;
      pts.push(new THREE.Vector2(r, y));
    }
    cachedCoolingTowerGeo = new THREE.LatheGeometry(pts, 18);
  }
  return cachedCoolingTowerGeo;
}

let cachedParabolicDishGeo: THREE.LatheGeometry | null = null;
function getParabolicDishGeo(): THREE.LatheGeometry {
  if (!cachedParabolicDishGeo) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector2(t * 0.72, t * t * 0.26));
    }
    cachedParabolicDishGeo = new THREE.LatheGeometry(pts, 16);
  }
  return cachedParabolicDishGeo;
}

let cachedIcbmGeo: THREE.LatheGeometry | null = null;
function getIcbmGeo(): THREE.LatheGeometry {
  if (!cachedIcbmGeo) {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(0.5, 0.05),
      new THREE.Vector2(0.48, 1.35),
      new THREE.Vector2(0.42, 1.55),
      new THREE.Vector2(0.42, 2.25),
      new THREE.Vector2(0.28, 2.75),
      new THREE.Vector2(0.02, 3.25),
    ];
    cachedIcbmGeo = new THREE.LatheGeometry(pts, 16);
  }
  return cachedIcbmGeo;
}

function buildRadarAssembly(p: FactionPalette, scale = 1.0): THREE.Group {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 0.95, 6), p.darkSteelMat);
  mast.position.y = 0.45;
  g.add(mast);

  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.26), p.teamMat);
  hub.position.set(0, 0.92, 0);
  g.add(hub);

  const dishHolder = new THREE.Group();
  dishHolder.position.set(0, 0.98, 0.14);
  dishHolder.rotation.x = Math.PI * 0.36;

  const dishMat = new THREE.MeshStandardMaterial({
    color: 0xd8e2ec,
    roughness: 0.34,
    metalness: 0.68,
    side: THREE.DoubleSide,
  });
  const dish = new THREE.Mesh(getParabolicDishGeo(), dishMat);
  dishHolder.add(dish);

  // Feed horn needle
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.55, 6), p.gunmetalMat);
  horn.position.y = 0.32;
  dishHolder.add(horn);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), p.teamMat);
  tip.position.y = 0.6;
  dishHolder.add(tip);

  g.add(dishHolder);
  g.scale.setScalar(scale);
  return g;
}

function addSandbagArc(
  parent: THREE.Object3D,
  mat: THREE.Material,
  cx: number,
  cz: number,
  radius: number,
  startAng: number,
  endAng: number,
  bags: number
): void {
  const bagGeo = new THREE.CapsuleGeometry(0.14, 0.24, 4, 6);
  bagGeo.rotateZ(Math.PI / 2);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < bags; i++) {
      const t = (i + row * 0.5) / Math.max(1, bags);
      const ang = startAng + (endAng - startAng) * t;
      const bag = new THREE.Mesh(bagGeo, mat);
      bag.position.set(
        cx + Math.cos(ang) * radius,
        0.34 + row * 0.2,
        cz + Math.sin(ang) * radius
      );
      bag.rotation.y = -ang + Math.PI * 0.5;
      parent.add(bag);
    }
  }
}

function addRoofHVAC(parent: THREE.Object3D, p: FactionPalette, x: number, y: number, z: number): void {
  const unit = new THREE.Mesh(createBeveledBox(0.75, 0.34, 0.65, 0.05), p.armorMat);
  unit.position.set(x, y + 0.17, z);
  parent.add(unit);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.45), p.ventMat);
  grille.position.set(x, y + 0.35, z);
  parent.add(grille);
}

/**
 * High-detail AA military PBR structures with beveled armor, corrugated roofs,
 * Lathe cooling towers/dishes/ICBMs, sandbags, floodlights, and contact AO shadows.
 */
export function createBuildingMesh(type: BuildingType, faction: Faction): BuildingMeshHandle {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const p = getFactionPalette(faction);
  const [fw, fh] = BUILDING_SPECS[type].footprint;
  const padW = fw * TILE_SIZE - 0.12;
  const padD = fh * TILE_SIZE - 0.12;

  // Grounded contact AO shadow decal
  const aoShadow = createContactShadow(padW + 1.3, padD + 1.3, 0.72);
  aoShadow.userData.noShadow = true;
  root.add(aoShadow);

  // Chamfered reinforced concrete slab foundation
  const pad = new THREE.Mesh(createBeveledBox(padW, 0.3, padD, 0.08), p.concreteMat);
  pad.position.y = 0.15;
  body.add(pad);

  let turret: THREE.Object3D | undefined;
  let animatedPart: THREE.Object3D | undefined;
  let secondaryAnimatedPart: THREE.Object3D | undefined;
  let siloDoors: [THREE.Object3D, THREE.Object3D] | undefined;
  let glowMat: THREE.MeshStandardMaterial | undefined;

  if (type === 'conyard') {
    // Stepped armored fabrication hall
    const mainHall = new THREE.Mesh(createBeveledBox(padW * 0.72, 1.75, padD * 0.66, 0.12), p.armorMat);
    mainHall.position.set(-0.5, 1.15, 0.42);
    body.add(mainHall);

    // Corrugated steel roof deck + team armor trim
    const roofDeck = new THREE.Mesh(createBeveledBox(padW * 0.66, 0.28, padD * 0.58, 0.06), p.corrugatedMat);
    roofDeck.position.set(-0.5, 2.1, 0.42);
    body.add(roofDeck);
    const teamStripe = new THREE.Mesh(createBeveledBox(padW * 0.68, 0.22, 0.6, 0.04), p.teamMat);
    teamStripe.position.set(-0.5, 2.24, 1.25);
    body.add(teamStripe);
    addRoofHVAC(body, p, -0.4, 2.24, -0.25);

    // Illuminated industrial assembly bay with hazard apron
    const bayPad = new THREE.Mesh(new THREE.BoxGeometry(padW * 0.42, 0.14, padD * 0.56), p.hazardMat);
    bayPad.position.set(1.45, 0.34, -0.55);
    body.add(bayPad);
    const bayDoor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.15, 1.9), p.ventMat);
    bayDoor.position.set(1.62, 0.92, 0.42);
    body.add(bayDoor);

    // Elevated command tower with wrap-around armored glass windows
    const tower = new THREE.Mesh(createBeveledBox(1.55, 2.6, 1.55, 0.1), p.darkSteelMat);
    tower.position.set(-1.65, 1.55, -1.45);
    body.add(tower);
    const windowBand = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.52, 1.62), p.glassMat);
    windowBand.position.set(-1.65, 2.28, -1.45);
    body.add(windowBand);
    const towerCap = new THREE.Mesh(createBeveledBox(1.68, 0.22, 1.68, 0.06), p.teamMat);
    towerCap.position.set(-1.65, 2.9, -1.45);
    body.add(towerCap);

    glowMat = new THREE.MeshStandardMaterial({
      color: p.glowHex,
      emissive: p.glowHex,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 10), glowMat);
    beacon.position.set(-1.65, 3.14, -1.45);
    body.add(beacon);

    // Whip radio antenna on command tower
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 1.6, 5), p.gunmetalMat);
    whip.position.set(-2.2, 3.65, -2.0);
    body.add(whip);

    // Detailed pivoting steel gantry crane with counterweight & hanging cable hook
    const crane = new THREE.Group();
    crane.position.set(1.25, 0.95, 1.25);
    const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.65, 10), p.darkSteelMat);
    crane.add(turretBase);
    const mast = new THREE.Mesh(createBeveledBox(0.38, 2.6, 0.38, 0.04), p.hazardMat);
    mast.position.y = 1.45;
    crane.add(mast);
    const boom = new THREE.Mesh(createBeveledBox(0.3, 0.34, 3.85, 0.04), p.hazardMat);
    boom.position.set(0, 2.62, -1.35);
    boom.rotation.x = 0.16;
    crane.add(boom);
    const counterWeight = new THREE.Mesh(createBeveledBox(0.55, 0.45, 0.72, 0.05), p.darkSteelMat);
    counterWeight.position.set(0, 2.35, 0.65);
    crane.add(counterWeight);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.25, 5), p.gunmetalMat);
    cable.position.set(0, 2.25, -2.95);
    crane.add(cable);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.04, 6, 10, Math.PI * 1.4), p.hazardMat);
    hook.position.set(0, 1.55, -2.95);
    crane.add(hook);
    body.add(crane);
    animatedPart = crane;
  } else if (type === 'power') {
    // Corrugated generator hall
    const house = new THREE.Mesh(createBeveledBox(padW * 0.84, 1.15, padD * 0.78, 0.09), p.armorMat);
    house.position.set(0, 0.84, 0.18);
    body.add(house);
    const roof = new THREE.Mesh(createBeveledBox(padW * 0.78, 0.2, padD * 0.68, 0.05), p.corrugatedMat);
    roof.position.set(0, 1.48, 0.18);
    body.add(roof);

    // Twin true hyperbolic LatheGeometry cooling towers!
    const towerGeo = getCoolingTowerGeo();
    for (const sx of [-0.95, 0.95]) {
      const tower = new THREE.Mesh(towerGeo, p.concreteMat);
      tower.position.set(sx, 0.42, -0.58);
      body.add(tower);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.07, 8, 18), p.darkSteelMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(sx, 2.98, -0.58);
      body.add(rim);

      const darkVent = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.1, 16), p.rubberMat);
      darkVent.position.set(sx, 2.92, -0.58);
      body.add(darkVent);
    }

    // Caged glowing plasma turbine core at front
    glowMat = new THREE.MeshStandardMaterial({
      color: 0x38e8ff,
      emissive: 0x1fd4ff,
      emissiveIntensity: 2.0,
      roughness: 0.12,
      metalness: 0.3,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.45, 16), glowMat);
    core.position.set(0, 1.35, 1.02);
    body.add(core);
    // Protective steel rib rings around reactor
    for (const ry of [0.85, 1.35, 1.85]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.055, 6, 16), p.darkSteelMat);
      rib.rotation.x = Math.PI / 2;
      rib.position.set(0, ry, 1.02);
      body.add(rib);
    }
    const teamBand = new THREE.Mesh(createBeveledBox(padW * 0.86, 0.24, 0.32, 0.04), p.teamMat);
    teamBand.position.set(0, 1.25, 1.32);
    body.add(teamBand);

    // High-voltage transformer ceramic insulators
    for (const sx of [-1.25, 1.25]) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.72, 8), p.copperMat);
      ins.position.set(sx, 1.82, 0.88);
      body.add(ins);
    }
  } else if (type === 'refinery') {
    // Heavy corrugated industrial smelter block
    const smelter = new THREE.Mesh(createBeveledBox(padW * 0.52, 2.15, padD * 0.82, 0.12), p.armorMat);
    smelter.position.set(-0.95, 1.32, 0);
    body.add(smelter);
    const roof = new THREE.Mesh(createBeveledBox(padW * 0.48, 0.22, padD * 0.76, 0.05), p.corrugatedMat);
    roof.position.set(-0.95, 2.46, 0);
    body.add(roof);

    // Twin ribbed ore storage silos + overhead steel transfer pipe
    for (const sz of [-0.78, 0.78]) {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 2.35, 16), p.teamMat);
      silo.position.set(-2.22, 1.45, sz);
      body.add(silo);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), p.darkSteelMat);
      dome.position.set(-2.22, 2.6, sz);
      body.add(dome);
      for (const ry of [0.95, 1.65, 2.25]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.04, 6, 16), p.darkSteelMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(-2.22, ry, sz);
        body.add(ring);
      }
    }

    // Sloped harvester unloading ramp + overhead gantry awning
    const dock = new THREE.Mesh(createBeveledBox(2.2, 0.24, 2.55, 0.05), p.hazardMat);
    dock.position.set(1.52, 0.34, 0);
    body.add(dock);
    // Steel awning pillars
    for (const sz of [-1.05, 1.05]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.65, 0.18), p.darkSteelMat);
      pillar.position.set(2.35, 1.15, sz);
      body.add(pillar);
    }
    const awning = new THREE.Mesh(createBeveledBox(1.9, 0.18, 2.4, 0.04), p.corrugatedMat);
    awning.position.set(1.55, 2.02, 0);
    awning.rotation.z = -0.14;
    body.add(awning);

    // Glowing molten furnace intake grate
    glowMat = new THREE.MeshStandardMaterial({
      color: 0xff8c1a,
      emissive: 0xff6200,
      emissiveIntensity: 2.1,
      roughness: 0.2,
    });
    const furnace = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.92, 1.48), glowMat);
    furnace.position.set(0.52, 0.98, 0);
    body.add(furnace);
    const grate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.95, 1.52), p.ventMat);
    grate.position.set(0.58, 0.98, 0);
    grate.scale.set(0.5, 0.85, 0.85);
    body.add(grate);

    // Twin tall industrial smokestacks with flanged tops
    for (const sz of [-0.75, -0.15]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2.5, 12), p.darkSteelMat);
      stack.position.set(-0.9, 3.1, sz);
      body.add(stack);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.24, 0.2, 12), p.hazardMat);
      collar.position.set(-0.9, 4.25, sz);
      body.add(collar);
    }
  } else if (type === 'barracks') {
    // Fortified concrete bunker base + Quonset arched corrugated roof!
    const walls = new THREE.Mesh(createBeveledBox(padW * 0.84, 1.05, padD * 0.78, 0.08), p.concreteMat);
    walls.position.set(0, 0.78, -0.05);
    body.add(walls);

    const archRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(padW * 0.38, padW * 0.38, padD * 0.74, 14, 1, false, 0, Math.PI),
      p.corrugatedMat
    );
    archRoof.rotation.z = Math.PI / 2;
    archRoof.rotation.y = Math.PI / 2;
    archRoof.position.set(0, 1.28, -0.05);
    body.add(archRoof);

    // Structural team-colored steel arch ribs
    for (const rz of [-0.95, 0, 0.95]) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(padW * 0.39, 0.08, 6, 16, Math.PI),
        p.teamMat
      );
      rib.position.set(0, 1.28, rz - 0.05);
      body.add(rib);
    }

    // Recessed blast exit + warm bay light + curved sandbag fortification!
    const doorFrame = new THREE.Mesh(createBeveledBox(1.32, 1.08, 0.36, 0.05), p.darkSteelMat);
    doorFrame.position.set(0, 0.78, padD * 0.38);
    body.add(doorFrame);
    const doorBay = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.86, 0.15), p.glassMat);
    doorBay.position.set(0, 0.72, padD * 0.44);
    body.add(doorBay);

    addSandbagArc(body, p.sandbagMat, -1.25, 1.15, 0.55, 0.2, Math.PI * 0.95, 5);
    addSandbagArc(body, p.sandbagMat, 1.25, 1.15, 0.55, 0.05, Math.PI * 0.8, 5);

    // Rotating parabolic comms radar dish
    const radar = buildRadarAssembly(p, 0.95);
    radar.position.set(0.95, 1.95, -0.75);
    body.add(radar);
    animatedPart = radar;
  } else if (type === 'warfactory') {
    // Monumental beveled vehicle assembly hangar with recessed dark vehicle bay!
    const rearBlock = new THREE.Mesh(createBeveledBox(padW * 0.88, 2.15, padD * 0.44, 0.12), p.armorMat);
    rearBlock.position.set(0, 1.32, -1.18);
    body.add(rearBlock);

    // Left & Right armored side piers framing deep recessed hangar bay
    for (const sx of [-1.85, 1.85]) {
      const pier = new THREE.Mesh(createBeveledBox(1.35, 2.0, padD * 0.54, 0.1), p.armorMat);
      pier.position.set(sx, 1.24, 0.95);
      body.add(pier);
      const wingRoof = new THREE.Mesh(createBeveledBox(1.42, 0.42, padD * 0.78, 0.06), p.teamMat);
      wingRoof.position.set(sx, 2.45, -0.1);
      body.add(wingRoof);
      // Side exhaust manifold pipes
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.45, 10), p.darkSteelMat);
      pipe.position.set(sx * 1.05, 3.0, -1.75);
      body.add(pipe);
    }

    // Center corrugated roof canopy + hazard lintel beam over open vehicle bay
    const centerRoof = new THREE.Mesh(createBeveledBox(2.85, 0.42, padD * 0.82, 0.06), p.corrugatedMat);
    centerRoof.position.set(0, 2.38, -0.05);
    body.add(centerRoof);
    const lintel = new THREE.Mesh(createBeveledBox(2.9, 0.34, 0.48, 0.04), p.hazardMat);
    lintel.position.set(0, 2.02, 2.35);
    body.add(lintel);

    // Recessed interior hangar glow + hazard exit apron
    const bayFloor = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.1, 2.4), p.hazardMat);
    bayFloor.position.set(0, 0.33, 1.25);
    body.add(bayFloor);
    glowMat = new THREE.MeshStandardMaterial({
      color: 0xffb347,
      emissive: 0xff8c1a,
      emissiveIntensity: 1.5,
      roughness: 0.3,
    });
    const interiorLight = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 0.45), glowMat);
    interiorLight.position.set(0, 1.85, 0.45);
    body.add(interiorLight);

    addRoofHVAC(body, p, 0, 2.58, -1.15);
  } else if (type === 'turret') {
    // Stepped octagonal concrete emplacement + circular sandbag berm
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 1.02, 0.88, 8), p.concreteMat);
    base.position.y = 0.68;
    body.add(base);
    addSandbagArc(body, p.sandbagMat, 0, 0, 1.05, 0, Math.PI * 2, 10);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 0.28, 12), p.teamMat);
    collar.position.y = 1.22;
    body.add(collar);

    // Detailed beveled twin-cannon rotating turret with optical sight & muzzle brakes!
    const tGroup = new THREE.Group();
    tGroup.position.y = 1.56;
    const head = new THREE.Mesh(createBeveledBox(1.06, 0.56, 1.2, 0.09), p.armorMat);
    tGroup.add(head);
    const topCap = new THREE.Mesh(createBeveledBox(0.84, 0.16, 0.9, 0.04), p.teamMat);
    topCap.position.set(0, 0.32, -0.05);
    tGroup.add(topCap);

    // Optical targeting pod
    const optic = new THREE.Mesh(createBeveledBox(0.28, 0.24, 0.32, 0.03), p.darkSteelMat);
    optic.position.set(0.36, 0.36, 0.22);
    tGroup.add(optic);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), p.glassMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0.36, 0.36, 0.38);
    tGroup.add(lens);

    // Twin stepped heavy auto-cannons with muzzle brakes
    for (const sx of [-0.25, 0.25]) {
      const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.125, 0.65, 10), p.darkSteelMat);
      jacket.rotation.x = Math.PI / 2;
      jacket.position.set(sx, 0.03, 0.68);
      tGroup.add(jacket);

      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.082, 1.05, 10), p.gunmetalMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(sx, 0.03, 1.25);
      tGroup.add(tube);

      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.2, 8), p.darkSteelMat);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(sx, 0.03, 1.78);
      tGroup.add(brake);
    }

    body.add(tGroup);
    turret = tGroup;
  } else if (type === 'tesla') {
    // Octagonal reinforced high-voltage pedestal + 4 steel buttress legs
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 1.02, 0.95, 8), p.darkSteelMat);
    base.position.y = 0.72;
    body.add(base);
    const hazardCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.85, 0.2, 8), p.hazardMat);
    hazardCollar.position.y = 1.16;
    body.add(hazardCollar);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.48, 3.05, 10), p.armorMat);
    spire.position.y = 2.55;
    body.add(spire);

    // 4 machined brushed-copper induction toroids + 4 vertical busbar rods
    const ringRadii: Array<[number, number]> = [
      [1.75, 0.68],
      [2.25, 0.58],
      [2.75, 0.48],
      [3.25, 0.38],
    ];
    for (const [ry, rad] of ringRadii) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.075, 10, 22), p.copperMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = ry;
      body.add(r);
    }
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI * 0.25;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 2.2, 6), p.darkSteelMat);
      strut.position.set(Math.cos(ang) * 0.56, 2.05, Math.sin(ang) * 0.56);
      strut.rotation.z = Math.cos(ang) * 0.22;
      strut.rotation.x = -Math.sin(ang) * 0.22;
      body.add(strut);
    }

    // Mirror-chrome capacitor sphere + glowing electric discharge crown!
    const chromeShell = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 16), p.chromeMat);
    chromeShell.position.y = 4.22;
    body.add(chromeShell);

    glowMat = new THREE.MeshStandardMaterial({
      color: 0x80f6ff,
      emissive: 0x22e0ff,
      emissiveIntensity: 2.5,
      roughness: 0.1,
      transparent: true,
      opacity: 0.78,
    });
    const plasmaHalo = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.045, 8, 20), glowMat);
    plasmaHalo.position.y = 4.22;
    plasmaHalo.rotation.x = Math.PI / 3;
    body.add(plasmaHalo);
    animatedPart = plasmaHalo;
  } else if (type === 'techcenter') {
    // Sleek multi-tier command laboratory with geodesic dome & twin satellite dishes
    const lower = new THREE.Mesh(createBeveledBox(padW * 0.88, 1.05, padD * 0.88, 0.12), p.armorMat);
    lower.position.y = 0.78;
    body.add(lower);

    // Panoramic illuminated lab windows
    const glassStrip = new THREE.Mesh(new THREE.BoxGeometry(padW * 0.9, 0.36, padD * 0.9), p.glassMat);
    glassStrip.position.y = 0.92;
    body.add(glassStrip);

    const upper = new THREE.Mesh(createBeveledBox(padW * 0.7, 0.55, padD * 0.7, 0.08), p.darkSteelMat);
    upper.position.y = 1.52;
    body.add(upper);

    // Ribbed geodesic dome + glowing holographic data ring
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.18, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      p.teamMat
    );
    dome.position.set(-0.35, 1.72, 0.25);
    body.add(dome);

    glowMat = new THREE.MeshStandardMaterial({
      color: 0x4aeaff,
      emissive: 0x22d3ee,
      emissiveIntensity: 2.2,
      roughness: 0.15,
    });
    const holoRing = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.08, 8, 28), glowMat);
    holoRing.rotation.x = Math.PI / 2;
    holoRing.position.set(-0.35, 1.85, 0.25);
    body.add(holoRing);

    // Primary & secondary rotating parabolic satellite dishes
    const dish1 = buildRadarAssembly(p, 1.1);
    dish1.position.set(1.05, 1.72, -0.95);
    body.add(dish1);
    animatedPart = dish1;

    const dish2 = buildRadarAssembly(p, 0.72);
    dish2.position.set(-1.1, 1.72, -1.05);
    body.add(dish2);
    secondaryAnimatedPart = dish2;
  } else if (type === 'silo') {
    // Reinforced octagonal nuclear blast bunker with sliding steel blast doors!
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.72, 1.98, 0.98, 8), p.concreteMat);
    collar.position.y = 0.74;
    body.add(collar);

    const hazardRing = new THREE.Mesh(new THREE.CylinderGeometry(1.48, 1.56, 0.24, 16), p.hazardMat);
    hazardRing.position.y = 1.26;
    body.add(hazardRing);

    // Illuminated launch shaft pit
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.06, 1.06, 0.3, 18),
      new THREE.MeshStandardMaterial({
        color: 0x1a0c0a,
        emissive: 0xff3c00,
        emissiveIntensity: 0.85,
        roughness: 0.8,
      })
    );
    shaft.position.y = 1.24;
    body.add(shaft);

    // 4 heavy angled blast-deflector armor buttresses + flashing corner beacons
    glowMat = new THREE.MeshStandardMaterial({
      color: 0xff3b22,
      emissive: 0xff2200,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + Math.PI * 0.25;
      const shield = new THREE.Mesh(createBeveledBox(0.85, 0.65, 0.42, 0.05), p.armorMat);
      shield.position.set(Math.cos(ang) * 1.62, 0.92, Math.sin(ang) * 1.62);
      shield.rotation.y = -ang + Math.PI * 0.5;
      body.add(shield);

      const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), glowMat);
      strobe.position.set(Math.cos(ang) * 1.62, 1.34, Math.sin(ang) * 1.62);
      body.add(strobe);
    }

    // Twin sliding armored blast doors (open smoothly as Nuke arms!)
    const doorLeft = new THREE.Mesh(createBeveledBox(1.05, 0.16, 2.0, 0.03), p.darkSteelMat);
    doorLeft.position.set(-0.54, 1.4, 0);
    const doorRight = new THREE.Mesh(createBeveledBox(1.05, 0.16, 2.0, 0.03), p.darkSteelMat);
    doorRight.position.set(0.54, 1.4, 0);
    body.add(doorLeft, doorRight);
    siloDoors = [doorLeft, doorRight];

    // Contoured LatheGeometry multi-stage ICBM rising out of the silo!
    const icbm = new THREE.Group();
    icbm.position.y = 0.2;
    const missileBody = new THREE.Mesh(
      getIcbmGeo(),
      new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.3, metalness: 0.45 })
    );
    const warheadTip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.72, 14), p.teamMat);
    warheadTip.position.y = 2.95;
    const warnBand = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.22, 14), glowMat);
    warnBand.position.y = 2.05;
    icbm.add(missileBody, warheadTip, warnBand);
    body.add(icbm);
    animatedPart = icbm;
  }

  enableShadows(body);

  return { root, body, turret, animatedPart, secondaryAnimatedPart, siloDoors, glowMat };
}

/**
 * Detailed industrial Tech Oil Derrick with steel lattice A-frame, horsehead pumpjack,
 * riveted crude tank, pipeline manifold, and holographic capture ring.
 */
export function createOilDerrickMesh(): DerrickMeshHandle {
  const root = new THREE.Group();
  const p = getFactionPalette('allies');

  const ao = createContactShadow(4.6, 4.6, 0.7);
  ao.userData.noShadow = true;
  root.add(ao);

  const base = new THREE.Mesh(createBeveledBox(3.7, 0.32, 3.7, 0.08), p.concreteMat);
  base.position.y = 0.16;
  root.add(base);

  // 4-leg tapered steel lattice A-frame tower
  for (const [sx, sz] of [
    [-0.52, -0.52],
    [0.52, -0.52],
    [-0.52, 0.52],
    [0.52, 0.52],
  ]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 3.15, 6), p.darkSteelMat);
    leg.position.set(sx * 0.65, 1.72, sz * 0.65);
    leg.rotation.z = sx * 0.28;
    leg.rotation.x = -sz * 0.28;
    root.add(leg);
  }
  const pivotCap = new THREE.Mesh(createBeveledBox(0.75, 0.34, 0.75, 0.04), p.armorMat);
  pivotCap.position.set(0, 3.15, 0);
  root.add(pivotCap);

  // Motor gearbox housing behind A-frame
  const gearbox = new THREE.Mesh(createBeveledBox(0.85, 0.75, 0.9, 0.06), p.darkSteelMat);
  gearbox.position.set(0, 0.68, -1.15);
  root.add(gearbox);

  // Riveted cylindrical crude tank + curved transfer pipeline
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 1.75, 16), p.armorMat);
  tank.position.set(-1.18, 1.05, 0.82);
  root.add(tank);
  for (const ry of [0.65, 1.42]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.71, 0.04, 6, 16), p.darkSteelMat);
    band.rotation.x = Math.PI / 2;
    band.position.set(-1.18, ry, 0.82);
    root.add(band);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), p.copperMat);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(-0.45, 0.65, 0.82);
  root.add(pipe);

  // Animated horsehead walking beam + counterweight!
  const rockerArm = new THREE.Group();
  rockerArm.position.set(0, 3.28, 0);
  const beam = new THREE.Mesh(createBeveledBox(0.3, 0.3, 2.95, 0.04), p.hazardMat);
  const horsehead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.65, 0.65, 0.38, 10, 1, false, -0.7, 1.4),
    p.darkSteelMat
  );
  horsehead.rotation.z = Math.PI / 2;
  horsehead.position.set(0, -0.05, 1.35);
  const counterWt = new THREE.Mesh(createBeveledBox(0.55, 0.55, 0.62, 0.05), p.darkSteelMat);
  counterWt.position.set(0, -0.1, -1.35);
  rockerArm.add(beam, horsehead, counterWt);
  root.add(rockerArm);

  // Owner status holographic beacon
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    emissive: 0x475569,
    emissiveIntensity: 0.5,
    roughness: 0.25,
    metalness: 0.4,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.42, 10), flagMat);
  beacon.position.set(-1.18, 2.12, 0.82);
  root.add(beacon);

  enableShadows(root);

  const ringGeo = new THREE.RingGeometry(4.25, 4.6, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ownerRingMat = new THREE.MeshBasicMaterial({
    color: 0xe2e8f0,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ownerRing = new THREE.Mesh(ringGeo, ownerRingMat);
  ownerRing.position.y = 0.14;
  ownerRing.userData.noShadow = true;
  root.add(ownerRing);

  const progGeo = new THREE.RingGeometry(3.4, 4.05, 36);
  progGeo.rotateX(-Math.PI / 2);
  const progressRing = new THREE.Mesh(
    progGeo,
    new THREE.MeshBasicMaterial({
      color: 0xf5b82e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  progressRing.position.y = 0.18;
  progressRing.visible = false;
  progressRing.userData.noShadow = true;
  root.add(progressRing);

  return { root, rockerArm, ownerRingMat, flagMat, progressRing };
}

/**
 * Reinforced steel-and-wood military drop crate with glowing tech beacon.
 */
export function createCrateMesh(): THREE.Group {
  const g = new THREE.Group();
  const lib = getMaterialLibrary();
  const box = new THREE.Mesh(
    createBeveledBox(1.22, 1.22, 1.22, 0.08),
    new THREE.MeshStandardMaterial({
      map: lib.cratePanelMap,
      roughness: 0.48,
      metalness: 0.35,
      emissive: 0x6b4708,
      emissiveIntensity: 0.55,
    })
  );
  box.position.y = 0.68;
  box.castShadow = true;
  box.receiveShadow = true;

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.28, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xfde047,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  halo.position.y = 0.12;
  g.add(box, halo);
  return g;
}
