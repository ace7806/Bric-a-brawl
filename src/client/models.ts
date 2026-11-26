import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { InvariantError, assert, assertNever } from '@sim/assert';
import { getGameData } from '@sim/data';
import { ArenaId, ErrorCode, FighterId, GadgetId } from '@sim/enums';
import { getElementalFighter } from './elemental-roster';
import {
  ElementalToonMaterial,
  applyElementalFinish,
  createElementalOutlineMaterial,
  createElementalToonMaterial,
  ensureSmoothOutlineNormals,
  getFallbackBlackTexture,
  getFallbackWhiteTexture,
} from './elemental-toon-material';
import { GlazeFinish } from './enums';
import {
  GlazeMaterial,
  createGlazeMaterial,
  hexToLinearVec3,
  loadPackedMatcap,
} from './glaze-material';
import type { ElementalFighterRig } from './poses';

export interface CeramicAssetPack {
  readonly matcap: THREE.Texture;
  readonly fighters: ReadonlyMap<FighterId, GLTF>;
}

export interface InstantiatedFighter {
  readonly group: THREE.Group;
  readonly rig: ElementalFighterRig;
  readonly material: ElementalToonMaterial;
  readonly scale: number;
}

const ALL_SLOT_FIGHTERS: readonly FighterId[] = [
  FighterId.Earl,
  FighterId.Grog,
  FighterId.Nesta,
  FighterId.Moss,
];

export async function loadCeramicAssets(): Promise<CeramicAssetPack> {
  const loader = new GLTFLoader();
  const [matcap, ...gltfs] = await Promise.all([
    loadPackedMatcap('./assets/matcap_packed.png'),
    ...ALL_SLOT_FIGHTERS.map((id) => loader.loadAsync(getElementalFighter(id).glbUrl)),
  ]);
  const fighters = new Map<FighterId, GLTF>();
  ALL_SLOT_FIGHTERS.forEach((id, idx) => {
    const gltf = gltfs[idx];
    if (!gltf) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Failed to load GLB for fighter ${id}`);
    let hasSkinned = false;
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        hasSkinned = true;
      }
    });
    assert(hasSkinned, ErrorCode.InvariantViolation, `Fighter ${id} GLB lacks SkinnedMesh`);
    assert(gltf.animations.length >= 20, ErrorCode.InvariantViolation, `Fighter ${id} GLB lacks embedded Smash clips`);
    fighters.set(id, gltf);
  });
  return { matcap, fighters };
}

function extractGltfTextures(mesh: THREE.SkinnedMesh): { albedoMap: THREE.Texture; emissiveMap: THREE.Texture } {
  const srcMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const std = srcMat as THREE.MeshStandardMaterial | undefined;
  const albedoMap = std?.map ?? getFallbackWhiteTexture();
  const emissiveMap = std?.emissiveMap ?? getFallbackBlackTexture();
  return { albedoMap, emissiveMap };
}

function findBone(bones: readonly THREE.Bone[], name: string): THREE.Bone | null {
  return bones.find((b) => b.name === name) ?? null;
}

export function instantiateFighterRig(
  pack: CeramicAssetPack,
  fighterId: FighterId,
  liveryHex: string,
  finish: GlazeFinish = GlazeFinish.Standard,
  includeOutline = true,
): InstantiatedFighter {
  const gltf = pack.fighters.get(fighterId);
  if (!gltf) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Unloaded fighter GLTF ${fighterId}`);
  const info = getElementalFighter(fighterId);
  const cloned = SkeletonUtils.clone(gltf.scene);

  const group = new THREE.Group();
  const fxGroup = new THREE.Group();
  const modelGroup = new THREE.Group();
  modelGroup.add(cloned);
  fxGroup.add(modelGroup);
  group.add(fxGroup);

  let skinned: THREE.SkinnedMesh | null = null;
  cloned.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      skinned = obj as THREE.SkinnedMesh;
    }
  });
  if (skinned === null) {
    throw new InvariantError(ErrorCode.InvariantViolation, `Cloned fighter ${fighterId} lacks SkinnedMesh`);
  }
  const sm = skinned as THREE.SkinnedMesh;
  sm.userData.sharedGeo = true;

  const { albedoMap, emissiveMap } = extractGltfTextures(sm);
  const rimCol = hexToLinearVec3(liveryHex).lerp(hexToLinearVec3(info.rimHex), 0.45);
  const material = createElementalToonMaterial({
    albedoMap,
    emissiveMap,
    rimColor: rimCol,
    rimStrength: 0.28,
    emissiveBoost: 0.48,
  });
  applyElementalFinish(material, finish);

  sm.material = material;
  sm.frustumCulled = false;

  // Optional Guilty-Gear style smooth-normal BackSide comic ink outline sharing the exact same skeleton!
  let outlineMesh: THREE.SkinnedMesh | null = null;
  if (includeOutline) {
    ensureSmoothOutlineNormals(sm.geometry);
    const outMat = createElementalOutlineMaterial(0.010);
    outlineMesh = new THREE.SkinnedMesh(sm.geometry, outMat);
    outlineMesh.name = `${sm.name}_Outline`;
    outlineMesh.userData.sharedGeo = true;
    outlineMesh.frustumCulled = false;
    outlineMesh.bind(sm.skeleton, sm.bindMatrix);
    if (sm.parent) {
      sm.parent.add(outlineMesh);
    } else {
      modelGroup.add(outlineMesh);
    }
  }

  const mixer = new THREE.AnimationMixer(cloned);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) {
    clips.set(clip.name, clip);
  }
  const actions = new Map<string, THREE.AnimationAction>();

  const bones = sm.skeleton.bones;
  const rig: ElementalFighterRig = {
    fighterId,
    fxGroup,
    modelGroup,
    mixer,
    clips,
    actions,
    skinnedMesh: sm,
    outlineMesh,
    rootBone: findBone(bones, 'Root'),
    handR: findBone(bones, 'Hand.R'),
    handL: findBone(bones, 'Hand.L'),
    weaponR: findBone(bones, 'Weapon.R'),
    headBone: findBone(bones, 'Head'),
    activeActionName: null,
    activeAction: null,
    lastEvalFrame: -1,
  };

  // Bind only Idle on spawn (rest bind lazily on first use — 45x faster spawn!)
  const idleClip = clips.get('Idle');
  if (idleClip) {
    const idleAction = mixer.clipAction(idleClip);
    actions.set('Idle', idleAction);
    idleAction.play();
    idleAction.time = 0;
    mixer.update(0);
    rig.activeActionName = 'Idle';
    rig.activeAction = idleAction;
    rig.lastEvalFrame = 0;
  }
  sm.updateMatrixWorld(true);

  return { group, rig, material, scale: info.gameplayScale };
}

// ---------------------------------------------------------------- Procedural Arena & Gadget Props

function palColor(name: string): THREE.Vector3 {
  const p = getGameData().palette;
  const hex =
    (p.neutrals as Record<string, string>)[name] ??
    (p.accents as Record<string, string>)[name] ??
    (p.world as Record<string, string>)[name];
  if (hex) return hexToLinearVec3(hex);
  const pl = p.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (pl) return hexToLinearVec3(pl.hex);
  throw new InvariantError(ErrorCode.MissingRequiredEntry, `Unknown palette color ${name}`);
}

function ceramicMat(
  matcap: THREE.Texture,
  color: string | THREE.Vector3,
  finish: 'glaze' | 'satin' | 'bisque' | 'gilt' = 'glaze',
  alpha = 1.0,
): GlazeMaterial {
  const vec = typeof color === 'string' ? (color.startsWith('#') ? hexToLinearVec3(color) : palColor(color)) : color;
  const cfg = {
    glaze: [1.0, 0.35, 0.0, 1.0],
    satin: [0.35, 0.5, 0.0, 0.6],
    bisque: [0.0, 0.12, 0.0, 0.8],
    gilt: [0.9, 0.6, 1.0, 0.0],
  }[finish];
  return createGlazeMaterial({
    matcap,
    usePaletteAttr: false,
    baseColor: vec,
    gloss: cfg[0]!,
    sheen: cfg[1]!,
    metal: cfg[2]!,
    speckle: cfg[3]!,
    alpha,
  });
}

function makeLathe(pts: readonly (readonly [number, number])[], segs = 12, wobble = 0.014, squashZ = 1.0): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i) * squashZ;
    const a = Math.atan2(z, x);
    const w = 1 + wobble * Math.sin(3 * a + y * 2.3);
    pos.setXYZ(i, x * w, y, z * w);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeTube(pts: readonly (readonly [number, number, number])[], radius: number, segs = 8, radialSegs = 6): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return new THREE.TubeGeometry(curve, segs, radius, radialSegs, false);
}

function addPart(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos?: readonly [number, number, number],
  rot?: readonly [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  group.add(m);
  return m;
}

// ---------------------------------------------------------------- 9 Gadgets (<800 tris each)

export function buildGadgetMesh(gadgetId: GadgetId, matcap: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  switch (gadgetId) {
    case GadgetId.None:
      return g;
    case GadgetId.Bellows: {
      const wood = ceramicMat(matcap, 'terracotta', 'satin');
      const leather = ceramicMat(matcap, '#A3312B', 'satin');
      const brass = ceramicMat(matcap, 'gilt', 'gilt');
      const boardGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.04, 10);
      addPart(g, boardGeo, wood, [-0.04, 0.10, 0], [0, 0, -0.28]);
      addPart(g, boardGeo, wood, [-0.04, -0.10, 0], [0, 0, 0.28]);
      addPart(g, new THREE.SphereGeometry(0.16, 8, 6), leather, [-0.06, 0, 0]);
      addPart(g, makeTube([[0.18, 0, 0], [0.58, 0, 0]], 0.04, 4, 6), brass);
      return g;
    }
    case GadgetId.Plunger: {
      const cup = ceramicMat(matcap, '#A3312B', 'satin');
      const wood = ceramicMat(matcap, 'bisque', 'bisque');
      addPart(g, makeLathe([[0.28, 0], [0.29, 0.04], [0.2, 0.16], [0.06, 0.26], [0, 0.28]], 12), cup, [0, -0.2, 0]);
      addPart(g, makeTube([[0, 0.08, 0], [0, 0.72, 0]], 0.032, 4, 6), wood);
      g.rotation.z = -1.1;
      return g;
    }
    case GadgetId.Cork: {
      const glass = ceramicMat(matcap, '#2F8F7A', 'glaze');
      const label = ceramicMat(matcap, 'bone', 'satin');
      const foil = ceramicMat(matcap, 'gilt', 'gilt');
      const cork = ceramicMat(matcap, 'bisque', 'bisque');
      addPart(g, makeLathe([[0, 0], [0.19, 0], [0.2, 0.42], [0.14, 0.62], [0.07, 0.85], [0, 0.86]], 12), glass, [0, -0.4, 0]);
      addPart(g, new THREE.CylinderGeometry(0.205, 0.205, 0.18, 12, 1, true), label, [0, -0.14, 0]);
      addPart(g, new THREE.CylinderGeometry(0.075, 0.082, 0.2, 10), foil, [0, 0.36, 0]);
      addPart(g, new THREE.CylinderGeometry(0.085, 0.065, 0.14, 10), cork, [0, 0.50, 0]);
      g.rotation.z = -0.75;
      return g;
    }
    case GadgetId.Pepper: {
      const wood = ceramicMat(matcap, '#3A2A22', 'satin');
      const steel = ceramicMat(matcap, 'ash', 'gilt');
      addPart(g, makeLathe([[0, 0], [0.17, 0], [0.11, 0.24], [0.16, 0.56], [0.09, 0.64], [0.17, 0.78], [0.11, 0.92], [0, 0.94]], 12), wood, [0, -0.42, 0]);
      addPart(g, new THREE.SphereGeometry(0.07, 8, 6), steel, [0, 0.56, 0]);
      return g;
    }
    case GadgetId.Toaster: {
      const body = ceramicMat(matcap, 'ash', 'gilt');
      const toast = ceramicMat(matcap, '#E3A72F', 'bisque');
      const foot = ceramicMat(matcap, 'ink', 'satin');
      addPart(g, makeLathe([[0, 0], [0.36, 0], [0.38, 0.42], [0.32, 0.48], [0, 0.49]], 4, 0, 0.65), body, [0, -0.24, 0], [0, Math.PI / 4, 0]);
      addPart(g, new THREE.BoxGeometry(0.32, 0.2, 0.06), toast, [0, 0.30, 0]);
      addPart(g, new THREE.SphereGeometry(0.05, 6, 5), foot, [0.30, 0.06, 0]);
      return g;
    }
    case GadgetId.Jam: {
      const jam = ceramicMat(matcap, '#A3312B', 'glaze');
      const label = ceramicMat(matcap, 'bone', 'satin');
      const lid = ceramicMat(matcap, '#E3A72F', 'satin');
      addPart(g, makeLathe([[0, 0], [0.22, 0], [0.24, 0.42], [0.19, 0.50], [0, 0.50]], 12), jam, [0, -0.28, 0]);
      addPart(g, new THREE.CylinderGeometry(0.245, 0.245, 0.16, 12, 1, true), label, [0, -0.04, 0]);
      addPart(g, new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12), lid, [0, 0.26, 0]);
      return g;
    }
    case GadgetId.Timer: {
      const egg = ceramicMat(matcap, 'bone', 'glaze');
      const dial = ceramicMat(matcap, '#E36F36', 'satin');
      const base = ceramicMat(matcap, 'ink', 'satin');
      addPart(g, makeLathe([[0, 0], [0.2, 0], [0.28, 0.28], [0.22, 0.52], [0.12, 0.66], [0, 0.70]], 12), egg, [0, -0.34, 0]);
      addPart(g, new THREE.TorusGeometry(0.27, 0.025, 6, 12), dial, [0, -0.08, 0], [Math.PI / 2, 0, 0]);
      addPart(g, new THREE.CylinderGeometry(0.21, 0.22, 0.05, 12), base, [0, -0.34, 0]);
      return g;
    }
    case GadgetId.Hoover: {
      const body = ceramicMat(matcap, 'celadon', 'glaze');
      const trim = ceramicMat(matcap, 'ink', 'satin');
      const bag = ceramicMat(matcap, 'bisque', 'bisque');
      addPart(g, makeLathe([[0, 0], [0.22, 0.1], [0.24, 0.4], [0.12, 0.68], [0.08, 0.76]], 12), body, [-0.36, 0, 0], [0, 0, -Math.PI / 2]);
      addPart(g, makeTube([[0.38, 0, 0], [0.58, -0.04, 0], [0.72, -0.14, 0]], 0.08, 5, 8), trim);
      addPart(g, new THREE.SphereGeometry(0.20, 8, 6), bag, [-0.46, 0.04, 0]);
      return g;
    }
    case GadgetId.Magnet: {
      const red = ceramicMat(matcap, '#A3312B', 'glaze');
      const steel = ceramicMat(matcap, 'ash', 'gilt');
      const arc: [number, number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const a = (Math.PI * i) / 8;
        arc.push([0.24 * Math.cos(a), 0.24 * Math.sin(a) + 0.04, 0]);
      }
      addPart(g, makeTube(arc, 0.072, 10, 6), red);
      const tipGeo = new THREE.CylinderGeometry(0.076, 0.076, 0.16, 8);
      addPart(g, tipGeo, steel, [-0.24, -0.04, 0]);
      addPart(g, tipGeo, steel, [0.24, -0.04, 0]);
      return g;
    }
    default:
      assertNever(gadgetId, 'buildGadgetMesh');
  }
}

// ---------------------------------------------------------------- Props & Dressing

export function buildParcelMesh(matcap: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const paper = ceramicMat(matcap, 'bisque', 'bisque');
  const stringMat = ceramicMat(matcap, 'stamp_red', 'satin');
  const lace = ceramicMat(matcap, 'bone', 'satin');
  addPart(g, new THREE.BoxGeometry(0.56, 0.48, 0.56), paper, [0, 0.24, 0], [0, Math.PI / 4, 0]);
  addPart(g, new THREE.BoxGeometry(0.58, 0.50, 0.06), stringMat, [0, 0.24, 0], [0, Math.PI / 4, 0]);
  addPart(g, new THREE.BoxGeometry(0.06, 0.50, 0.58), stringMat, [0, 0.24, 0], [0, Math.PI / 4, 0]);
  const canopy = makeLathe([[0, 1.85], [0.48, 1.78], [0.92, 1.60], [1.18, 1.32], [1.24, 1.18]], 16, 0.04);
  const canopyMat = ceramicMat(matcap, 'bone', 'satin');
  canopyMat.side = THREE.DoubleSide;
  addPart(g, canopy, canopyMat);
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    addPart(g, makeTube([[1.18 * Math.cos(a), 1.22, 1.18 * Math.sin(a)], [0.2 * Math.cos(a), 0.48, 0.2 * Math.sin(a)]], 0.01, 2, 4), lace);
  }
  return g;
}

export function buildSidePlateMesh(liveryHex: string, matcap: THREE.Texture): THREE.Mesh {
  const geo = makeLathe([[0, 0], [0.34, 0], [0.48, 0.04], [0.64, 0.11], [0.66, 0.13], [0.60, 0.13], [0.38, 0.06], [0, 0.05]], 20, 0.015);
  geo.rotateX(Math.PI / 2);
  const mat = ceramicMat(matcap, liveryHex, 'glaze', 0.82);
  mat.uniforms.uGilt.value = 0.25;
  return new THREE.Mesh(geo, mat);
}

export function buildTeaspoonMesh(liveryHex: string, matcap: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const silver = ceramicMat(matcap, 'ash', 'gilt');
  const liv = ceramicMat(matcap, liveryHex, 'glaze');
  const bowlGeo = new THREE.SphereGeometry(0.18, 10, 8);
  bowlGeo.scale(1.0, 1.35, 0.35);
  addPart(g, bowlGeo, silver, [0, 0, 0]);
  addPart(g, makeTube([[0, 0.22, 0], [0.02, 0.68, 0], [0, 1.15, 0]], 0.036, 6, 6), silver);
  addPart(g, new THREE.SphereGeometry(0.07, 8, 6), liv, [0, 1.22, 0]);
  g.rotation.z = Math.PI;
  return g;
}

export function buildCloudMesh(matcap: THREE.Texture, seed: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1.0, 12, 8);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const puff = 1 + 0.22 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed);
    pos.setXYZ(i, x * 1.9 * puff, Math.max(-0.35, y * 0.72 * puff), z * 0.85 * puff);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, ceramicMat(matcap, 'cloud', 'bisque'));
}

export function buildArenaDressing(arenaId: ArenaId, matcap: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  switch (arenaId) {
    case ArenaId.Willow: {
      const blue = ceramicMat(matcap, 'willow_wash', 'glaze');
      const white = ceramicMat(matcap, 'willow_glaze', 'glaze');
      for (const zOff of [-0.75, 0.75]) {
        addPart(g, makeTube([[-3, 2.5, zOff], [-1.5, 2.92, zOff], [0, 3.05, zOff], [1.5, 2.92, zOff], [3, 2.5, zOff]], 0.11, 10, 6), blue);
      }
      for (let i = -3; i <= 3; i++) {
        const y = 2.46 + 0.55 * (1 - (i / 3) ** 2);
        addPart(g, new THREE.BoxGeometry(0.36, 0.14, 1.4), white, [i * 0.85, y, 0]);
      }
      addPart(g, makeTube([[10.5, 0.2, 1.3], [10.0, 2.0, 1.1], [9.6, 3.3, 0.8], [10.3, 4.8, 0.9]], 0.28, 8, 6), blue);
      addPart(g, makeTube([[9.8, 3.1, 0.7], [8.5, 2.95, 0.1], [7.0, 2.9, 0.0]], 0.18, 6, 6), blue);
      const foliagePos: readonly (readonly [number, number])[] = [[7.4, 2.5], [8.6, 2.4], [9.8, 4.2], [10.6, 4.4]];
      for (const [fx, fy] of foliagePos) {
        addPart(g, new THREE.SphereGeometry(0.45, 8, 6), ceramicMat(matcap, 'celadon_dk', 'satin'), [fx, fy, 0.5]);
      }
      return g;
    }
    case ArenaId.HighTea: {
      const cream = ceramicMat(matcap, 'tea_cream', 'glaze');
      const rose = ceramicMat(matcap, 'tea_rose', 'glaze');
      const gilt = ceramicMat(matcap, 'gilt', 'gilt');
      addPart(g, makeLathe([[0, -2.2], [1.5, -2.1], [0.55, -0.6], [0.45, 3.0], [0.42, 6.2], [0.34, 8.8], [0, 9.6]], 14), cream, [0, 0, 1.4]);
      addPart(g, new THREE.TorusGeometry(0.65, 0.12, 6, 12), rose, [0, 2.3, 1.4], [Math.PI / 2, 0, 0]);
      const pot = new THREE.Group();
      addPart(pot, makeLathe([[0, 0], [1.2, 0], [2.2, 1.8], [1.4, 3.6], [0.4, 4.5], [0, 4.7]], 14), cream);
      addPart(pot, makeTube([[-2.0, 1.5, 0], [-3.4, 2.2, 0], [-4.1, 3.4, 0]], 0.34, 6, 6), cream);
      addPart(pot, new THREE.TorusGeometry(0.42, 0.1, 6, 10), gilt, [0, 4.4, 0], [Math.PI / 2, 0, 0]);
      pot.position.set(8.8, 10.0, 6.5);
      pot.rotation.z = 0.65;
      g.add(pot);
      return g;
    }
    case ArenaId.MendedBowl: {
      const tenmoku = ceramicMat(matcap, 'bowl_tenmoku', 'satin');
      const gilt = ceramicMat(matcap, 'gilt', 'gilt');
      const steamMat = ceramicMat(matcap, 'sky_mid', 'bisque', 0.45);
      addPart(g, new THREE.TorusGeometry(13.6, 0.32, 8, 24, Math.PI), tenmoku, [0, 1.2, 1.8], [0, 0, Math.PI]);
      for (const sx of [-4.5, 0.0, 4.5]) {
        addPart(g, makeTube([[sx, -2.6, -2.6], [sx + 0.1, -0.4, -2.8], [sx, 0.1, 2.2]], 0.07, 6, 5), gilt);
      }
      for (let i = -2; i <= 2; i++) {
        addPart(g, new THREE.TorusGeometry(0.45, 0.06, 6, 12), steamMat, [i * 1.1, -1.5 + Math.abs(i) * 0.5, 0.2], [Math.PI / 2, 0, 0]);
      }
      return g;
    }
    case ArenaId.Saucer: {
      const bone = ceramicMat(matcap, 'bone', 'glaze');
      const gilt = ceramicMat(matcap, 'gilt', 'gilt');
      addPart(g, new THREE.CylinderGeometry(7.3, 6.4, 0.35, 24), bone, [0, -0.25, 0]);
      addPart(g, new THREE.TorusGeometry(7.25, 0.11, 6, 28), gilt, [0, -0.05, 0], [Math.PI / 2, 0, 0]);
      return g;
    }
    default:
      assertNever(arenaId, 'buildArenaDressing');
  }
}
