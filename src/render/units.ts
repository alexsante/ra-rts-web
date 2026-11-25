import * as THREE from 'three';
import { Faction, UnitType } from '../sim/types';
import {
  FactionPalette,
  createBeveledBox,
  createContactShadow,
  createSlopedHullGeometry,
  getFactionPalette,
  getMaterialLibrary,
} from './materials';

export interface SoldierRig {
  group: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
}

export interface UnitMeshHandle {
  root: THREE.Group;
  hull: THREE.Group;
  turret?: THREE.Object3D;
  barrel?: THREE.Object3D;
  cargoPile?: THREE.Mesh;
  oreDrum?: THREE.Object3D;
  roofBeacon?: THREE.Object3D;
  v2Missile?: THREE.Object3D;
  propellers?: THREE.Object3D[];
  navStrobeMat?: THREE.MeshStandardMaterial;
  shieldDome: THREE.Mesh;
  soldiers?: SoldierRig[];
  selectRing: THREE.Mesh;
  hpBarBg: THREE.Mesh;
  hpBarFill: THREE.Mesh;
  badge?: THREE.Sprite;
  lastBadgeRank?: number;
}

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.noShadow !== true) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

// Reusable contoured LatheGeometry for V2 Ballistic Missile & Kirov Zeppelin
let cachedV2Geo: THREE.LatheGeometry | null = null;
function getV2MissileGeo(): THREE.LatheGeometry {
  if (!cachedV2Geo) {
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.02, -1.2),
      new THREE.Vector2(0.22, -1.12),
      new THREE.Vector2(0.29, -0.55),
      new THREE.Vector2(0.29, 0.45),
      new THREE.Vector2(0.22, 0.98),
      new THREE.Vector2(0.01, 1.55),
    ];
    cachedV2Geo = new THREE.LatheGeometry(pts, 14);
    cachedV2Geo.rotateX(Math.PI / 2);
  }
  return cachedV2Geo;
}

let cachedKirovHullGeo: THREE.LatheGeometry | null = null;
function getKirovHullGeo(): THREE.LatheGeometry {
  if (!cachedKirovHullGeo) {
    const pts: THREE.Vector2[] = [];
    const segs = 24;
    for (let i = 0; i <= segs; i++) {
      // Sweep from tail (-3.55, v=0) to nose (+3.55, v=1) for outward normals & correct nose UV!
      const t = i / segs;
      const y = -3.55 + t * 7.1;
      const profile = Math.sin(Math.pow(1 - t, 0.78) * Math.PI);
      const r = Math.max(0.02, profile * 1.48);
      pts.push(new THREE.Vector2(r, y));
    }
    cachedKirovHullGeo = new THREE.LatheGeometry(pts, 24);
    cachedKirovHullGeo.rotateX(Math.PI / 2);
  }
  return cachedKirovHullGeo;
}

/**
 * Helper: detailed armored tank track pod with textured grouser belt,
 * visible bogie road wheels, drive sprockets, and chamfered side skirt.
 */
function buildTrackPod(
  p: FactionPalette,
  width: number,
  height: number,
  length: number,
  wheelCount: number
): THREE.Group {
  const g = new THREE.Group();

  // Textured grouser tread loop
  const belt = new THREE.Mesh(createBeveledBox(width, height, length, 0.05), p.treadMat);
  g.add(belt);

  // Armored upper side skirt plate
  const skirt = new THREE.Mesh(
    createBeveledBox(width + 0.08, height * 0.42, length + 0.06, 0.03),
    p.armorMat
  );
  skirt.position.y = height * 0.34;
  g.add(skirt);

  // Individual metallic road wheels along outer face
  const wheelGeo = new THREE.CylinderGeometry(height * 0.36, height * 0.36, width + 0.04, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(height * 0.16, height * 0.16, width + 0.07, 8);
  hubGeo.rotateZ(Math.PI / 2);

  for (let i = 0; i < wheelCount; i++) {
    const t = wheelCount === 1 ? 0 : i / (wheelCount - 1) - 0.5;
    const wz = t * (length - height * 0.95);
    const wheel = new THREE.Mesh(wheelGeo, p.darkSteelMat);
    wheel.position.set(0, -height * 0.12, wz);
    const hub = new THREE.Mesh(hubGeo, p.gunmetalMat);
    hub.position.set(0, -height * 0.12, wz);
    g.add(wheel, hub);
  }

  return g;
}

/**
 * Helper: chunky rubber truck wheel with recessed steel rim & hubcap.
 */
function buildTruckWheel(p: FactionPalette, radius = 0.34, width = 0.28): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), p.rubberMat);
  tire.rotation.z = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.03, 10),
    p.armorMat
  );
  rim.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.24, radius * 0.24, width + 0.06, 8),
    p.darkSteelMat
  );
  hub.rotation.z = Math.PI / 2;
  g.add(tire, rim, hub);
  return g;
}

/**
 * Helper: stepped heavy tank gun barrel with thermal sleeve, bore evacuator, & muzzle brake.
 */
function buildCannonBarrel(p: FactionPalette, length: number, radius: number): THREE.Group {
  const g = new THREE.Group();
  const breech = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.45, radius * 1.6, length * 0.24, 10),
    p.darkSteelMat
  );
  breech.rotation.x = Math.PI / 2;
  breech.position.z = length * 0.12;
  g.add(breech);

  const mainTube = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.92, radius * 1.08, length, 10),
    p.gunmetalMat
  );
  mainTube.rotation.x = Math.PI / 2;
  mainTube.position.z = length * 0.52;
  g.add(mainTube);

  // Bore evacuator (fume extractor bulge midway down the barrel)
  const evac = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.38, radius * 1.38, length * 0.2, 10),
    p.armorMat
  );
  evac.rotation.x = Math.PI / 2;
  evac.position.z = length * 0.54;
  g.add(evac);

  // Flared muzzle brake at tip
  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.42, radius * 1.18, length * 0.14, 8),
    p.darkSteelMat
  );
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = length * 1.02;
  g.add(muzzle);

  return g;
}

/**
 * High-detail AA military PBR unit builder covering all 8 Red Alert unit classes.
 */
export function createUnitMesh(type: UnitType, faction: Faction): UnitMeshHandle {
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);

  const p = getFactionPalette(faction);

  let turret: THREE.Object3D | undefined;
  let barrel: THREE.Object3D | undefined;
  let cargoPile: THREE.Mesh | undefined;
  let oreDrum: THREE.Object3D | undefined;
  let roofBeacon: THREE.Object3D | undefined;
  let v2Missile: THREE.Object3D | undefined;
  let propellers: THREE.Object3D[] | undefined;
  let navStrobeMat: THREE.MeshStandardMaterial | undefined;
  let soldiers: SoldierRig[] | undefined;
  let ringRadius = 1.35;
  let barHeight = 2.6;

  if (type === 'medium_tank') {
    ringRadius = 1.5;
    barHeight = 2.45;

    const ao = createContactShadow(2.4, 3.0, 0.72);
    ao.userData.noShadow = true;
    hull.add(ao);

    // Textured armored track pods with 5 visible road wheels each!
    for (const sx of [-0.74, 0.74]) {
      const pod = buildTrackPod(p, 0.36, 0.5, 2.38, 5);
      pod.position.set(sx, 0.28, 0);
      hull.add(pod);
    }

    // Sloped beveled glacis main battle tank hull
    const chassis = new THREE.Mesh(createSlopedHullGeometry(1.24, 0.54, 2.24, 0.42, 0.25, 0.05), p.armorMat);
    chassis.position.set(0, 0.56, 0);
    hull.add(chassis);

    // Rear engine louver deck + twin exhaust mufflers
    const engineDeck = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.68), p.ventMat);
    engineDeck.position.set(0, 0.84, -0.62);
    hull.add(engineDeck);
    for (const sx of [-0.36, 0.36]) {
      const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.32, 8), p.gunmetalMat);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(sx, 0.68, -1.16);
      hull.add(exhaust);

      // Warm front LED headlights
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), p.headlightMat);
      lamp.position.set(sx * 1.45, 0.64, 1.06);
      hull.add(lamp);
    }

    // Independent beveled hexagonal turret + cupola + stowage rack + whip antenna
    const tGroup = new THREE.Group();
    tGroup.position.set(0, 1.06, -0.02);
    const tHead = new THREE.Mesh(createSlopedHullGeometry(1.06, 0.48, 1.32, 0.34, 0.22, 0.06), p.teamMat);
    tGroup.add(tHead);

    const mantlet = new THREE.Mesh(createBeveledBox(0.54, 0.32, 0.36, 0.04), p.armorMat);
    mantlet.position.set(0, 0.02, 0.58);
    tGroup.add(mantlet);

    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.18, 10), p.darkSteelMat);
    cupola.position.set(-0.22, 0.3, -0.18);
    tGroup.add(cupola);

    const bustle = new THREE.Mesh(createBeveledBox(0.84, 0.24, 0.32, 0.03), p.darkSteelMat);
    bustle.position.set(0, 0.06, -0.76);
    tGroup.add(bustle);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.024, 1.05, 5), p.gunmetalMat);
    antenna.position.set(0.38, 0.66, -0.45);
    tGroup.add(antenna);

    const bGroup = new THREE.Group();
    bGroup.position.set(0, 0.04, 0.62);
    bGroup.add(buildCannonBarrel(p, 1.55, 0.075));
    tGroup.add(bGroup);

    root.add(tGroup);
    turret = tGroup;
    barrel = bGroup;
  } else if (type === 'mammoth_tank') {
    // ICONIC SUPER-HEAVY MAMMOTH TITAN — Quad-tracks, dual bore-evacuator cannons, twin SAM pods!
    ringRadius = 1.92;
    barHeight = 3.25;

    const ao = createContactShadow(3.3, 3.8, 0.8);
    ao.userData.noShadow = true;
    hull.add(ao);

    // 4 oversized quad-track pods
    for (const sx of [-1.06, 1.06]) {
      for (const sz of [-0.88, 0.88]) {
        const pod = buildTrackPod(p, 0.54, 0.62, 1.28, 3);
        pod.position.set(sx, 0.34, sz);
        hull.add(pod);
      }
      // Side armored linkage strut between front & rear track pods
      const fender = new THREE.Mesh(createBeveledBox(0.56, 0.22, 0.6, 0.04), p.darkSteelMat);
      fender.position.set(sx, 0.62, 0);
      hull.add(fender);
    }

    // Massive beveled sloped super-hull
    const chassis = new THREE.Mesh(createSlopedHullGeometry(1.86, 0.74, 2.84, 0.52, 0.34, 0.07), p.armorMat);
    chassis.position.set(0, 0.74, 0);
    hull.add(chassis);

    const armorTrim = new THREE.Mesh(createBeveledBox(1.58, 0.16, 1.9, 0.04), p.teamMat);
    armorTrim.position.set(0, 1.12, -0.08);
    hull.add(armorTrim);

    // Rear heavy radiator vents + front headlights + bullbar
    const rearGrille = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.68), p.ventMat);
    rearGrille.position.set(0, 1.15, -0.96);
    hull.add(rearGrille);
    for (const sx of [-0.62, 0.62]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.08), p.headlightMat);
      lamp.position.set(sx, 0.78, 1.38);
      hull.add(lamp);
    }

    // Massive fortress turret with dual cannons & twin 6-tube SAM missile pods
    const tGroup = new THREE.Group();
    tGroup.position.set(0, 1.48, -0.1);
    const tHead = new THREE.Mesh(createSlopedHullGeometry(1.46, 0.68, 1.72, 0.36, 0.26, 0.08), p.teamMat);
    tGroup.add(tHead);

    const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.24, 10), p.darkSteelMat);
    cupola.position.set(-0.28, 0.42, -0.25);
    tGroup.add(cupola);
    for (const sx of [-0.55, 0.55]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 1.3, 5), p.gunmetalMat);
      ant.position.set(sx, 0.85, -0.62);
      tGroup.add(ant);
    }

    // Twin 6-tube side SAM missile launcher pods with visible red warhead tips!
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35, metalness: 0.3 });
    for (const sx of [-0.94, 0.94]) {
      const pod = new THREE.Mesh(createBeveledBox(0.42, 0.54, 0.84, 0.04), p.darkSteelMat);
      pod.position.set(sx, 0.12, -0.08);
      tGroup.add(pod);
      for (const ry of [-0.11, 0.11]) {
        for (const rx of [-0.09, 0.09]) {
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 6), tipMat);
          tip.position.set(sx + rx, 0.12 + ry, 0.36);
          tGroup.add(tip);
        }
      }
    }

    const mantlet = new THREE.Mesh(createBeveledBox(1.02, 0.42, 0.38, 0.05), p.armorMat);
    mantlet.position.set(0, 0.04, 0.78);
    tGroup.add(mantlet);

    const bGroup = new THREE.Group();
    bGroup.position.set(0, 0.05, 0.84);
    for (const sx of [-0.32, 0.32]) {
      const c = buildCannonBarrel(p, 1.85, 0.095);
      c.position.x = sx;
      bGroup.add(c);
    }
    tGroup.add(bGroup);

    root.add(tGroup);
    turret = tGroup;
    barrel = bGroup;
  } else if (type === 'v2_launcher') {
    ringRadius = 1.58;
    barHeight = 3.2;

    const ao = createContactShadow(2.3, 3.2, 0.72);
    ao.userData.noShadow = true;
    hull.add(ao);

    // 6x6 rugged military tires with rims
    for (const sx of [-0.76, 0.76]) {
      for (const sz of [-0.98, 0.04, 1.0]) {
        const w = buildTruckWheel(p, 0.33, 0.28);
        w.position.set(sx, 0.33, sz);
        hull.add(w);
      }
    }

    const chassis = new THREE.Mesh(createBeveledBox(1.36, 0.44, 2.75, 0.06), p.armorMat);
    chassis.position.set(0, 0.64, 0);
    hull.add(chassis);

    // Armored forward TEL cab + tinted split windshield + headlights
    const cab = new THREE.Mesh(createSlopedHullGeometry(1.3, 0.74, 0.98, 0.28, 0.08, 0.05), p.teamMat);
    cab.position.set(0, 1.12, 0.92);
    hull.add(cab);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.32, 0.14), p.glassMat);
    wind.position.set(0, 1.24, 1.32);
    wind.rotation.x = -0.25;
    hull.add(wind);
    for (const sx of [-0.46, 0.46]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), p.headlightMat);
      lamp.position.set(sx, 0.88, 1.4);
      hull.add(lamp);
    }

    // Hydraulic angled launch rail cradle
    const cradle = new THREE.Mesh(createBeveledBox(0.52, 0.22, 2.25, 0.04), p.darkSteelMat);
    cradle.position.set(0, 1.32, -0.35);
    cradle.rotation.x = -0.5;
    hull.add(cradle);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.95, 8), p.chromeMat);
    piston.position.set(0, 1.08, 0.1);
    piston.rotation.x = 0.28;
    hull.add(piston);

    // Contoured LatheGeometry ballistic V2 Rocket with 4 swept cruciform tail fins!
    const rocket = new THREE.Group();
    rocket.position.set(0, 1.72, -0.32);
    rocket.rotation.x = -0.5;
    const rBody = new THREE.Mesh(
      getV2MissileGeo(),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.32, metalness: 0.35 })
    );
    const rBand = new THREE.Mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.35, 14), p.darkSteelMat);
    rBand.rotation.x = Math.PI / 2;
    rBand.position.z = 0.15;
    const rTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.65, 14),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.28 })
    );
    rTip.rotation.x = Math.PI / 2;
    rTip.position.z = 1.24;
    // 4 cruciform tail fins
    const finH = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.05, 0.56), p.darkSteelMat);
    finH.position.z = -0.92;
    const finV = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.82, 0.56), p.darkSteelMat);
    finV.position.z = -0.92;
    rocket.add(rBody, rBand, rTip, finH, finV);
    hull.add(rocket);
    v2Missile = rocket;
  } else if (type === 'harvester') {
    ringRadius = 1.62;
    barHeight = 2.85;

    const ao = createContactShadow(2.4, 3.3, 0.74);
    ao.userData.noShadow = true;
    hull.add(ao);

    // 6 heavy rugged mining tires
    for (const sx of [-0.8, 0.8]) {
      for (const sz of [-0.9, 0.05, 0.92]) {
        const w = buildTruckWheel(p, 0.35, 0.32);
        w.position.set(sx, 0.35, sz);
        hull.add(w);
      }
    }

    // Heavy armored cab with roll-cage & sloped windshield
    const cab = new THREE.Mesh(createSlopedHullGeometry(1.42, 0.92, 1.15, 0.32, 0.1, 0.06), p.teamMat);
    cab.position.set(0, 0.94, 0.72);
    hull.add(cab);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.34, 0.12), p.glassMat);
    visor.position.set(0, 1.08, 1.2);
    visor.rotation.x = -0.25;
    hull.add(visor);
    for (const sx of [-0.52, 0.52]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), p.headlightMat);
      lamp.position.set(sx, 0.76, 1.3);
      hull.add(lamp);
      // Twin vertical exhaust stacks behind cab
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.95, 8), p.gunmetalMat);
      stack.position.set(sx * 1.3, 1.35, 0.12);
      hull.add(stack);
    }

    // Rotating amber warning roof beacon!
    const beaconGrp = new THREE.Group();
    beaconGrp.position.set(0, 1.48, 0.68);
    const beaconLamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.14, 0.2, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffb703,
        emissive: 0xff9f00,
        emissiveIntensity: 2.2,
        roughness: 0.2,
      })
    );
    beaconGrp.add(beaconLamp);
    hull.add(beaconGrp);
    roofBeacon = beaconGrp;

    // Front hydraulic arms + rotating spiked ore crusher drum!
    for (const sx of [-0.72, 0.72]) {
      const arm = new THREE.Mesh(createBeveledBox(0.14, 0.2, 0.65, 0.03), p.hazardMat);
      arm.position.set(sx, 0.5, 1.35);
      hull.add(arm);
    }
    const drumGrp = new THREE.Group();
    drumGrp.position.set(0, 0.42, 1.62);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.5, 12), p.copperMat);
    drum.rotation.z = Math.PI / 2;
    drumGrp.add(drum);
    // Crusher blades around drum
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.12), p.darkSteelMat);
      blade.position.set(0, Math.sin(ang) * 0.33, Math.cos(ang) * 0.33);
      blade.rotation.x = ang;
      drumGrp.add(blade);
    }
    hull.add(drumGrp);
    oreDrum = drumGrp;

    // Ribbed armored dump hopper bed
    const bed = new THREE.Mesh(createBeveledBox(1.56, 0.72, 1.68, 0.06), p.armorMat);
    bed.position.set(0, 0.84, -0.64);
    hull.add(bed);
    const bedTrim = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 1.72), p.hazardMat);
    bedTrim.position.set(0, 1.14, -0.64);
    hull.add(bedTrim);

    // Dynamic shimmering golden ore load
    cargoPile = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.72, 1),
      new THREE.MeshStandardMaterial({
        color: 0xf4b22c,
        roughness: 0.26,
        metalness: 0.72,
        emissive: 0x6b3e05,
        emissiveIntensity: 0.55,
        flatShading: true,
      })
    );
    cargoPile.scale.set(1.0, 0.01, 1.15);
    cargoPile.position.set(0, 1.15, -0.64);
    hull.add(cargoPile);
  } else if (type === 'kirov') {
    // ICONIC KIROV AIRSHIP — Contoured LatheGeometry dirigible with shark-tooth canvas,
    // riveted underside keel, illuminated command gondola, 4 braced fins & 3-blade brass props!
    ringRadius = 2.2;
    barHeight = 10.9;
    propellers = [];

    // Grounded soft shadow on sand far beneath the hovering zeppelin
    const groundAo = createContactShadow(4.5, 7.6, 0.45);
    groundAo.userData.noShadow = true;
    hull.add(groundAo);

    const airship = new THREE.Group();
    airship.position.y = 7.6;

    const canvasMat = new THREE.MeshStandardMaterial({
      map: getMaterialLibrary().kirovCanvasMap[faction],
      bumpMap: getMaterialLibrary().armorBump,
      bumpScale: 0.04,
      roughness: 0.62,
      metalness: 0.14,
    });
    const envelope = new THREE.Mesh(getKirovHullGeo(), canvasMat);
    airship.add(envelope);

    // Armored nose mooring cap
    const noseCap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 10), p.copperMat);
    noseCap.position.z = 3.42;
    airship.add(noseCap);

    // Structural riveted belly keel spine
    const keel = new THREE.Mesh(createBeveledBox(0.55, 0.35, 5.2, 0.05), p.darkSteelMat);
    keel.position.set(0, -1.25, -0.1);
    airship.add(keel);

    // Underslung armored bomb-bay & cockpit gondola with lit windows!
    const gondola = new THREE.Mesh(createSlopedHullGeometry(1.02, 0.76, 2.75, 0.4, 0.3, 0.06), p.armorMat);
    gondola.position.set(0, -1.58, 0.25);
    airship.add(gondola);
    const cockpitWin = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.26, 0.5), p.glassMat);
    cockpitWin.position.set(0, -1.48, 1.38);
    airship.add(cockpitWin);

    // 4 braced cruciform tail stabilizers with yellow/team trim
    const vFin = new THREE.Mesh(createBeveledBox(0.14, 2.75, 1.65, 0.03), p.teamMat);
    vFin.position.set(0, 0, -2.65);
    const hFin = new THREE.Mesh(createBeveledBox(2.85, 0.14, 1.65, 0.03), p.teamMat);
    hFin.position.set(0, 0, -2.65);
    airship.add(vFin, hFin);

    // Blinking navigation strobe lights on tail tips
    navStrobeMat = new THREE.MeshStandardMaterial({
      color: 0xff3b3b,
      emissive: 0xff2222,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    for (const sx of [-1.45, 1.45]) {
      const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), navStrobeMat);
      strobe.position.set(sx, 0, -2.65);
      airship.add(strobe);
    }

    // Twin outrigger steel struts + engine nacelles + spinning 3-blade brass propellers!
    for (const sx of [-1.38, 1.38]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.22), p.darkSteelMat);
      strut.position.set(sx * 0.62, -0.82, -0.85);
      airship.add(strut);

      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.25, 12), p.armorMat);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(sx, -0.82, -0.85);
      airship.add(pod);

      const prop = new THREE.Group();
      prop.position.set(sx, -0.82, -1.52);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 8), p.copperMat);
      spinner.rotation.x = -Math.PI / 2;
      prop.add(spinner);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.04), p.copperMat);
        const ang = (b / 3) * Math.PI * 2;
        blade.position.set(Math.sin(ang) * 0.28, Math.cos(ang) * 0.28, 0);
        blade.rotation.z = -ang;
        prop.add(blade);
      }
      airship.add(prop);
      propellers.push(prop);
    }

    hull.add(airship);
  } else {
    // Articulated Infantry Fireteams (Rifle x3, Rocket x2, Tesla Trooper Exosuit x2)
    ringRadius = 1.08;
    barHeight = 2.25;
    soldiers = [];

    const ao = createContactShadow(1.65, 1.65, 0.58);
    ao.userData.noShadow = true;
    hull.add(ao);

    const offsets: Array<[number, number]> =
      type === 'rifle'
        ? [
            [0, 0.36],
            [-0.44, -0.32],
            [0.44, -0.32],
          ]
        : [
            [-0.4, 0.08],
            [0.4, -0.14],
          ];

    const isTesla = type === 'tesla_trooper';
    const coilGlow = isTesla
      ? new THREE.MeshStandardMaterial({
          color: 0x64f4ff,
          emissive: 0x22d3ee,
          emissiveIntensity: 2.3,
          roughness: 0.15,
        })
      : null;

    for (const [ox, oz] of offsets) {
      const s = new THREE.Group();
      s.position.set(ox, 0, oz);
      const wMult = isTesla ? 1.32 : 1.0;

      // Articulated Left & Right Legs with armored boots
      const makeLeg = (lx: number): THREE.Group => {
        const lg = new THREE.Group();
        lg.position.set(lx, 0.44, 0);
        const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.13 * wMult, 0.36, 0.14 * wMult), p.darkSteelMat);
        thigh.position.y = -0.18;
        const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14 * wMult, 0.14, 0.22 * wMult), p.rubberMat);
        boot.position.set(0, -0.37, 0.04);
        lg.add(thigh, boot);
        return lg;
      };
      const leftLeg = makeLeg(-0.1 * wMult);
      const rightLeg = makeLeg(0.1 * wMult);
      s.add(leftLeg, rightLeg);

      // Padded tactical chest armor + shoulder pauldrons + backpack
      const torso = new THREE.Mesh(
        createBeveledBox(0.36 * wMult, 0.44, 0.26 * wMult, 0.04),
        p.teamMat
      );
      torso.position.y = 0.66;
      s.add(torso);

      for (const sx of [-0.22 * wMult, 0.22 * wMult]) {
        const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.11 * wMult, 8, 8), p.armorMat);
        pauldron.position.set(sx, 0.8, 0);
        s.add(pauldron);
      }

      // Contoured tactical helmet + reflective visor strip
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165 * wMult, 10, 10), p.armorMat);
      helmet.position.y = 1.02;
      s.add(helmet);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22 * wMult, 0.08, 0.1), p.glassMat);
      visor.position.set(0, 1.02, 0.12 * wMult);
      s.add(visor);

      if (type === 'rifle') {
        const pack = new THREE.Mesh(createBeveledBox(0.24, 0.3, 0.14, 0.03), p.darkSteelMat);
        pack.position.set(0, 0.68, -0.18);
        s.add(pack);
        const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.09, 0.66), p.gunmetalMat);
        rifle.position.set(0.2, 0.66, 0.28);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.07), p.darkSteelMat);
        mag.position.set(0.2, 0.58, 0.32);
        s.add(rifle, mag);
      } else if (type === 'rocket') {
        const pack = new THREE.Mesh(createBeveledBox(0.28, 0.34, 0.18, 0.03), p.darkSteelMat);
        pack.position.set(0, 0.68, -0.2);
        s.add(pack);
        const tubeMat = new THREE.MeshStandardMaterial({ color: 0x455942, roughness: 0.55, metalness: 0.45 });
        const launcher = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.02, 10), tubeMat);
        launcher.rotation.x = Math.PI / 2;
        launcher.position.set(0.24, 0.84, 0.16);
        const flare = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 10), p.darkSteelMat);
        flare.rotation.x = Math.PI / 2;
        flare.position.set(0.24, 0.84, -0.36);
        s.add(launcher, flare);
      } else if (coilGlow) {
        // Bulky Tesla Trooper copper twin-coil dynamo backpack + glowing forked emitter!
        for (const sx of [-0.11, 0.11]) {
          const dynamo = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.58, 10), p.copperMat);
          dynamo.position.set(sx, 0.78, -0.24);
          s.add(dynamo);
          const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), coilGlow);
          cap.position.set(sx, 1.1, -0.24);
          s.add(cap);
        }
        const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.72, 8), p.gunmetalMat);
        wand.rotation.x = Math.PI / 2;
        wand.position.set(0.28, 0.68, 0.36);
        const emitterOrb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), coilGlow);
        emitterOrb.position.set(0.28, 0.68, 0.74);
        s.add(wand, emitterOrb);
      }

      hull.add(s);
      soldiers.push({ group: s, leftLeg, rightLeg });
    }
  }

  enableShadows(root);

  // Iron Curtain shimmering metallic-crimson invulnerability dome
  const shieldDome = new THREE.Mesh(
    new THREE.SphereGeometry(ringRadius * 1.15, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff2255,
      transparent: true,
      opacity: 0.38,
      wireframe: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  shieldDome.position.y = type === 'kirov' ? 7.6 : 0.95;
  shieldDome.visible = false;
  shieldDome.userData.noShadow = true;
  root.add(shieldDome);

  const ringGeo = new THREE.RingGeometry(ringRadius * 0.82, ringRadius, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: faction === 'allies' ? 0x3bf095 : 0xff4b4b,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const selectRing = new THREE.Mesh(ringGeo, ringMat);
  selectRing.position.y = 0.12;
  selectRing.visible = false;
  selectRing.userData.noShadow = true;
  root.add(selectRing);

  const hpBarBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x11151b, depthTest: false })
  );
  hpBarBg.position.y = barHeight;
  hpBarBg.renderOrder = 10;
  hpBarBg.visible = false;
  hpBarBg.userData.noShadow = true;
  root.add(hpBarBg);

  const hpBarFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.42, 0.12),
    new THREE.MeshBasicMaterial({ color: 0x35e57e, depthTest: false })
  );
  hpBarFill.position.z = 0.01;
  hpBarFill.renderOrder = 11;
  hpBarFill.userData.noShadow = true;
  hpBarBg.add(hpBarFill);

  return {
    root,
    hull,
    turret,
    barrel,
    cargoPile,
    oreDrum,
    roofBeacon,
    v2Missile,
    propellers,
    navStrobeMat,
    shieldDome,
    soldiers,
    selectRing,
    hpBarBg,
    hpBarFill,
  };
}

/**
 * Detailed A-10 / MiG Close-Air-Support Strike Jet with bubble canopy,
 * ordnance pylons, twin rear turbofans, canted twin tail fins & afterburners.
 */
export function createFighterJetMesh(faction: Faction): THREE.Group {
  const g = new THREE.Group();
  const p = getFactionPalette(faction);
  const afterburnerMat = new THREE.MeshStandardMaterial({
    color: 0xffb703,
    emissive: 0xff6b00,
    emissiveIntensity: 3.2,
    roughness: 0.1,
  });

  // Contoured nose + fuselage body
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.9, 10), p.armorMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.8;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 3.1, 10), p.armorMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.z = -0.65;
  g.add(nose, fuse);

  // Bubble tinted glass cockpit canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), p.glassMat);
  canopy.scale.set(0.82, 0.65, 2.0);
  canopy.position.set(0, 0.34, 0.72);
  g.add(canopy);

  // Straight/swept armored attack wings + underwing rocket pods
  const wing = new THREE.Mesh(createBeveledBox(5.6, 0.12, 1.32, 0.03), p.teamMat);
  wing.position.set(0, -0.04, -0.2);
  g.add(wing);
  for (const sx of [-1.65, 1.65]) {
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.15, 8), p.darkSteelMat);
    pylon.rotation.x = Math.PI / 2;
    pylon.position.set(sx, -0.22, -0.05);
    g.add(pylon);
  }

  // Twin rear-mounted turbofan nacelles + glowing afterburners
  for (const sx of [-0.62, 0.62]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 1.45, 10), p.darkSteelMat);
    nac.rotation.x = Math.PI / 2;
    nac.position.set(sx, 0.22, -1.25);
    g.add(nac);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 8), afterburnerMat);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(sx, 0.22, -2.42);
    g.add(flame);
  }

  // Horizontal stabilizer + canted twin vertical tail fins
  const hStab = new THREE.Mesh(createBeveledBox(2.2, 0.1, 0.72, 0.02), p.teamMat);
  hStab.position.set(0, 0.14, -2.05);
  g.add(hStab);
  for (const sx of [-1.05, 1.05]) {
    const fin = new THREE.Mesh(createBeveledBox(0.1, 0.92, 0.78, 0.02), p.teamMat);
    fin.position.set(sx, 0.52, -2.05);
    fin.rotation.z = sx > 0 ? -0.15 : 0.15;
    g.add(fin);
  }

  enableShadows(g);
  return g;
}

/**
 * Detailed descending staged ICBM Nuclear Missile with fins & plasma exhaust cone.
 */
export function createNukeMissileMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.56, 4.1, 16),
    new THREE.MeshStandardMaterial({ color: 0xe6edf5, roughness: 0.28, metalness: 0.45 })
  );
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.45, 16),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.28, metalness: 0.35 })
  );
  nose.position.y = -2.75;
  nose.rotation.x = Math.PI;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.35, 16),
    new THREE.MeshStandardMaterial({ color: 0xf5b82e, roughness: 0.4, metalness: 0.3 })
  );
  band.position.y = -1.2;

  const finMat = new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.5, metalness: 0.65 });
  const fin1 = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.9, 0.1), finMat);
  fin1.position.y = 1.65;
  const fin2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.75), finMat);
  fin2.position.y = 1.65;

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.68, 2.8, 12),
    new THREE.MeshStandardMaterial({
      color: 0xffd166,
      emissive: 0xff7b00,
      emissiveIntensity: 3.6,
      roughness: 0.1,
    })
  );
  flame.position.y = 3.2;

  g.add(body, nose, band, fin1, fin2, flame);
  return g;
}
