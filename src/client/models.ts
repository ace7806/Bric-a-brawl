import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { InvariantError, assert, assertNever } from '@sim/assert';
import { getFighterSpec, getGameData } from '@sim/data';
import { ArenaId, ErrorCode, FighterId, GadgetId, NestaSize } from '@sim/enums';
import { GlazeFinish } from './enums';
import {
  GlazeMaterial,
  applyGlazeFinish,
  buildFighterPalette,
  createGlazeMaterial,
  hexToLinearVec3,
  loadPackedMatcap,
} from './glaze-material';
import type { BoneSlot, FighterBoneRig } from './poses';

export interface CeramicAssetPack {
  readonly matcap: THREE.Texture;
  readonly fighters: ReadonlyMap<FighterId, GLTF>;
}

export interface InstantiatedFighter {
  readonly group: THREE.Group;
  readonly rig: FighterBoneRig;
  readonly material: GlazeMaterial;
  readonly scale: number;
}

const FIGHTER_ASSET_FILE: Record<FighterId, string> = {
  [FighterId.Earl]: './assets/earl.opt.glb',
  [FighterId.Grog]: './assets/grog.opt.glb',
  [FighterId.Nesta]: './assets/nesta.opt.glb',
  [FighterId.Moss]: './assets/moss.opt.glb',
};

const FIGHTER_BODY_BONE: Record<FighterId, string> = {
  [FighterId.Earl]: 'earl_body',
  [FighterId.Grog]: 'grog_body',
  [FighterId.Nesta]: 'nesta_body',
  [FighterId.Moss]: 'moss_body',
};

export async function loadCeramicAssets(): Promise<CeramicAssetPack> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const entries: readonly FighterId[] = [FighterId.Earl, FighterId.Grog, FighterId.Nesta, FighterId.Moss];
  const [matcap, ...gltfs] = await Promise.all([
    loadPackedMatcap('./assets/matcap_packed.png'),
    ...entries.map((id) => loader.loadAsync(FIGHTER_ASSET_FILE[id])),
  ]);
  const fighters = new Map<FighterId, GLTF>();
  entries.forEach((id, idx) => {
    const gltf = gltfs[idx];
    if (!gltf) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Failed to load GLB for fighter ${id}`);
    let hasSkinned = false;
    gltf.scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) hasSkinned = true;
    });
    assert(hasSkinned, ErrorCode.InvariantViolation, `Fighter ${id} GLB lacks SkinnedMesh`);
    fighters.set(id, gltf);
  });
  return { matcap, fighters };
}

function findBoneSlot(bones: readonly THREE.Bone[], name: string): BoneSlot | null {
  const b = bones.find((bn) => bn.name === name);
  if (!b) return null;
  return { bone: b, restPos: b.position.clone(), restQuat: b.quaternion.clone() };
}

function extractBoneRig(fighterId: FighterId, skeleton: THREE.Skeleton): FighterBoneRig {
  const bs = skeleton.bones;
  const body = findBoneSlot(bs, FIGHTER_BODY_BONE[fighterId]);
  if (!body) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Missing body bone for fighter ${fighterId}`);
  const prefix = FIGHTER_BODY_BONE[fighterId].split('_')[0]!;
  return {
    fighterId,
    body,
    lid: findBoneSlot(bs, `${prefix}_lid`),
    head: findBoneSlot(bs, `${prefix}_head`),
    hat: findBoneSlot(bs, `${prefix}_hat`),
    rod: findBoneSlot(bs, `${prefix}_rod`),
    handF: findBoneSlot(bs, `${prefix}_handF`),
    handB: findBoneSlot(bs, `${prefix}_handB`),
    footF: findBoneSlot(bs, `${prefix}_footF`),
    footB: findBoneSlot(bs, `${prefix}_footB`),
    hoofFL: findBoneSlot(bs, `${prefix}_hoofFL`),
    hoofFR: findBoneSlot(bs, `${prefix}_hoofFR`),
    hoofBL: findBoneSlot(bs, `${prefix}_hoofBL`),
    hoofBR: findBoneSlot(bs, `${prefix}_hoofBR`),
  };
}

export function instantiateFighterRig(
  pack: CeramicAssetPack,
  fighterId: FighterId,
  liveryHex: string,
  finish: GlazeFinish = GlazeFinish.Standard,
): InstantiatedFighter {
  const gltf = pack.fighters.get(fighterId);
  if (!gltf) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Unloaded fighter GLTF ${fighterId}`);
  const cloned = SkeletonUtils.clone(gltf.scene);
  const group = new THREE.Group();
  group.add(cloned);

  const material = createGlazeMaterial({
    matcap: pack.matcap,
    usePaletteAttr: true,
    palette: buildFighterPalette(fighterId, liveryHex),
    speckle: 1.0,
  });
  applyGlazeFinish(material, finish);

  let skinned: THREE.SkinnedMesh | null = null;
  cloned.traverse((obj) => {
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = obj as THREE.SkinnedMesh;
      sm.material = material;
      sm.frustumCulled = false;
      skinned = sm;
    }
  });
  if (skinned === null) {
    throw new InvariantError(ErrorCode.InvariantViolation, `Cloned fighter ${fighterId} lacks SkinnedMesh`);
  }
  const rig = extractBoneRig(fighterId, (skinned as THREE.SkinnedMesh).skeleton);
  const spec = getFighterSpec(fighterId);
  const scale = fighterId === FighterId.Nesta && spec.nestaSizes ? spec.nestaSizes.get(NestaSize.Mid)!.scale : 1.0;
  return { group, rig, material, scale };
}

interface LodPartChunk {
  readonly geo: THREE.BufferGeometry;
  readonly boneIndex: number;
  readonly paletteSlot: number;
  readonly gloss: number;
  readonly metal: number;
}

function makeLodBlob(rx: number, ry: number, rz: number, wSeg = 6, hSeg = 4): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg);
  geo.scale(rx, ry, rz);
  return geo;
}

function makeLodLathe(
  pts: readonly (readonly [number, number])[],
  segs = 8,
  squashZ = 1.0,
): THREE.BufferGeometry {
  return makeLathe(pts, segs, 0.012, squashZ);
}

function makeLodHandGeo(r: number): THREE.BufferGeometry {
  return makeLodBlob(r, r * 0.9, r * 0.8, 6, 4);
}

function makeLodFootGeo(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  return makeLodBlob(rx, ry, rz, 6, 3);
}

function mergeLodPartsToSkinnedMesh(
  parts: readonly LodPartChunk[],
  bones: THREE.Bone[],
  material: GlazeMaterial,
): THREE.SkinnedMesh {
  let totalVerts = 0;
  let totalIndices = 0;
  const prepped = parts.map((p) => {
    const g = p.geo;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const idx = g.getIndex();
    totalVerts += pos.count;
    totalIndices += idx ? idx.count : pos.count;
    return { ...p, pos, norm: g.getAttribute('normal') as THREE.BufferAttribute, idx };
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 4);
  const skinIndices = new Uint16Array(totalVerts * 4);
  const skinWeights = new Float32Array(totalVerts * 4);
  const indices = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;
  for (const p of prepped) {
    const count = p.pos.count;
    const slotR = p.paletteSlot / 15.0;
    for (let v = 0; v < count; v++) {
      const i3 = (vOff + v) * 3;
      const i4 = (vOff + v) * 4;
      positions[i3] = p.pos.getX(v);
      positions[i3 + 1] = p.pos.getY(v);
      positions[i3 + 2] = p.pos.getZ(v);
      const nx = p.norm.getX(v);
      const ny = p.norm.getY(v);
      const nz = p.norm.getZ(v);
      normals[i3] = nx;
      normals[i3 + 1] = ny;
      normals[i3 + 2] = nz;
      const ao = 0.55 + 0.45 * Math.max(0, Math.min(1, 0.5 + 0.5 * ny));
      colors[i4] = slotR;
      colors[i4 + 1] = p.gloss;
      colors[i4 + 2] = ao;
      colors[i4 + 3] = p.metal;
      skinIndices[i4] = p.boneIndex;
      skinWeights[i4] = 1.0;
    }
    if (p.idx) {
      for (let k = 0; k < p.idx.count; k++) {
        indices[iOff++] = p.idx.getX(k) + vOff;
      }
    } else {
      for (let k = 0; k < count; k++) {
        indices[iOff++] = k + vOff;
      }
    }
    vOff += count;
    p.geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();

  const skinned = new THREE.SkinnedMesh(merged, material);
  skinned.frustumCulled = false;
  for (const b of bones) {
    if (b.parent === null) skinned.add(b);
  }
  skinned.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(bones));
  return skinned;
}

export function instantiateFighterLodRig(
  pack: CeramicAssetPack,
  fighterId: FighterId,
  liveryHex: string,
  finish: GlazeFinish = GlazeFinish.Standard,
): InstantiatedFighter {
  const group = new THREE.Group();
  const palette = buildFighterPalette(fighterId, liveryHex);
  const material = createGlazeMaterial({
    matcap: pack.matcap,
    usePaletteAttr: true,
    palette,
    speckle: 0.0,
  });
  applyGlazeFinish(material, finish);
  material.uniforms.uSpeckle.value = 0;
  material.uniforms.uCrack.value = 0;

  const bones: THREE.Bone[] = [];
  const boneIndexMap = new Map<THREE.Bone, number>();
  const parts: LodPartChunk[] = [];

  const regBone = (name: string, x: number, y: number, z: number, parent?: THREE.Bone): BoneSlot => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    if (parent) parent.add(bone);
    boneIndexMap.set(bone, bones.length);
    bones.push(bone);
    return { bone, restPos: bone.position.clone(), restQuat: bone.quaternion.clone() };
  };

  const pushPart = (
    slot: BoneSlot,
    geo: THREE.BufferGeometry,
    paletteSlot: number,
    gloss = 1.0,
    pos?: readonly [number, number, number],
    rot?: readonly [number, number, number],
    metal = 0.0,
  ): void => {
    if (rot) {
      if (rot[0] !== 0) geo.rotateX(rot[0]);
      if (rot[1] !== 0) geo.rotateY(rot[1]);
      if (rot[2] !== 0) geo.rotateZ(rot[2]);
    }
    const ox = slot.restPos.x + (pos ? pos[0] : 0);
    const oy = slot.restPos.y + (pos ? pos[1] : 0);
    const oz = slot.restPos.z + (pos ? pos[2] : 0);
    if (ox !== 0 || oy !== 0 || oz !== 0) geo.translate(ox, oy, oz);
    parts.push({ geo, boneIndex: boneIndexMap.get(slot.bone)!, paletteSlot, gloss, metal });
  };

  const prefix = FIGHTER_BODY_BONE[fighterId].split('_')[0]!;
  const body = regBone(`${prefix}_body`, 0, 0, 0);
  const regChild = (name: string, x: number, y: number, z: number): BoneSlot => regBone(name, x, y, z, body.bone);
  let lid: BoneSlot | null = null;
  let head: BoneSlot | null = null;
  let hat: BoneSlot | null = null;
  let rod: BoneSlot | null = null;
  let handF: BoneSlot | null = null;
  let handB: BoneSlot | null = null;
  let footF: BoneSlot | null = null;
  let footB: BoneSlot | null = null;
  let hoofFL: BoneSlot | null = null;
  let hoofFR: BoneSlot | null = null;
  let hoofBL: BoneSlot | null = null;
  let hoofBR: BoneSlot | null = null;

  switch (fighterId) {
    case FighterId.Earl: {
      // Palette: 0=trim(livery), 1=body(bone), 2=livery, 3=bone, 6=gilt
      const z0 = 0.16;
      pushPart(body, makeLodLathe([[0, 0], [0.33, 0.06], [0.54, 0.28], [0.635, 0.60], [0.52, 0.90], [0.35, 1.08]], 8), 1, 1.0, [0, z0, 0]);
      pushPart(body, makeLodLathe([[0.36, 0.97], [0.47, 0.98], [0.35, 1.085]], 8), 2, 1.0, [0, z0, 0]);
      pushPart(body, makeTube([[0.50, z0 + 0.46, 0], [0.85, z0 + 0.65, 0], [1.10, z0 + 1.02, 0]], 0.10, 3, 4), 1, 1.0);
      pushPart(body, makeTube([[-0.50, z0 + 0.90, 0], [-0.94, z0 + 0.68, 0], [-0.55, z0 + 0.34, 0]], 0.06, 3, 4), 2, 1.0);

      lid = regChild('earl_lid', 0, z0 + 1.085, 0);
      pushPart(lid, makeLodLathe([[0.34, 0], [0.22, 0.12], [0.06, 0.21], [0.10, 0.30], [0, 0.35]], 7), 2, 1.0);

      handF = regChild('earl_handF', 0.16, z0 + 0.36, 0.88);
      pushPart(handF, makeLodHandGeo(0.15), 2, 1.0);
      handB = regChild('earl_handB', 0.16, z0 + 0.36, -0.88);
      pushPart(handB, makeLodHandGeo(0.15), 2, 1.0);

      footF = regChild('earl_footF', 0.02, 0, 0.25);
      pushPart(footF, makeLodFootGeo(0.20, 0.075, 0.13), 0, 1.0, [0.05, 0.075, 0]);
      footB = regChild('earl_footB', 0.02, 0, -0.25);
      pushPart(footB, makeLodFootGeo(0.20, 0.075, 0.13), 0, 1.0, [0.05, 0.075, 0]);
      break;
    }
    case FighterId.Grog: {
      // Palette: 0=body(basalt), 1=hoof(tenmoku), 2=livery, 3=bone, 6=gilt
      const zc = 0.98;
      const bodyLathe = makeLodLathe([[0, -0.80], [0.38, -0.70], [0.55, -0.28], [0.62, 0.28], [0.54, 0.70], [0, 0.86]], 8, 0.94);
      bodyLathe.rotateZ(-Math.PI / 2);
      pushPart(body, bodyLathe, 0, 0.35, [0, zc, 0]);

      const sash = makeLodLathe([[0.57, -0.24], [0.60, 0.02], [0.63, 0.25]], 8, 0.94);
      sash.rotateZ(-Math.PI / 2);
      pushPart(body, sash, 2, 1.0, [0, zc, 0]);

      head = regChild('grog_head', 0.92, zc + 0.16, 0);
      pushPart(head, makeLodBlob(0.37, 0.35, 0.36, 6, 4), 0, 0.35);
      pushPart(head, makeTube([[0, 0, 0], [0.12, 0.24, 0.22], [0.28, 0.44, 0.26]], 0.07, 3, 4), 3, 1.0, [-0.02, 0.27, 0.27]);
      pushPart(head, makeTube([[0, 0, 0], [0.12, 0.24, -0.22], [0.28, 0.44, -0.26]], 0.07, 3, 4), 3, 1.0, [-0.02, 0.27, -0.27]);

      const makeHoof = () => makeLodLathe([[0, 0], [0.16, 0], [0.17, 0.08], [0.13, 0.26]], 6);
      hoofFL = regChild('grog_hoofFL', 0.56, 0, 0.33);
      pushPart(hoofFL, makeHoof(), 2, 1.0);
      hoofFR = regChild('grog_hoofFR', 0.56, 0, -0.33);
      pushPart(hoofFR, makeHoof(), 2, 1.0);
      hoofBL = regChild('grog_hoofBL', -0.50, 0, 0.33);
      pushPart(hoofBL, makeHoof(), 1, 0.35);
      hoofBR = regChild('grog_hoofBR', -0.50, 0, -0.33);
      pushPart(hoofBR, makeHoof(), 1, 0.35);
      break;
    }
    case FighterId.Nesta: {
      // Palette: 0=trim(livery), 1=body(slip), 2=livery, 3=bone
      const K = 0.88;
      pushPart(body, makeLodLathe([[0, 0], [0.35 * K, 0.04], [0.47 * K, 0.34], [0.50 * K, 0.58], [0.45 * K, 0.84], [0.34 * K, 1.04]], 8), 1, 1.0);
      pushPart(body, makeLodLathe([[0.335 * K, 1.04], [0.385 * K, 1.18], [0.36 * K, 1.36], [0.24 * K, 1.54], [0, 1.68]], 8), 2, 1.0);
      pushPart(body, makeLodBlob(0.12, 0.10, 0.12, 5, 3), 2, 1.0, [-0.36 * K, 1.17, 0]);
      pushPart(body, makeLodBlob(0.08, 0.21, 0.21, 5, 3), 3, 1.0, [0.30 * K, 1.285, 0]);

      handF = regChild('nesta_handF', 0.14, 0.68, 0.66);
      pushPart(handF, makeLodHandGeo(0.125), 2, 1.0);
      handB = regChild('nesta_handB', 0.14, 0.68, -0.66);
      pushPart(handB, makeLodHandGeo(0.125), 2, 1.0);
      break;
    }
    case FighterId.Moss: {
      // Palette: 0=coat(terracotta), 2=livery, 3=bone, 8=skin(bisque), 10=boot(tenmoku), 11=iron
      pushPart(body, makeLodLathe([[0, 0.15], [0.32, 0.16], [0.40, 0.40], [0.34, 0.72], [0.24, 0.90]], 7), 0, 0.0);
      pushPart(body, makeLodBlob(0.24, 0.23, 0.24, 6, 3), 8, 0.35, [0, 0.99, 0]);
      pushPart(body, makeLodLathe([[0, 0.30], [0.16, 0.48], [0.24, 0.78], [0.15, 1.02], [0, 1.04]], 6, 0.66), 3, 1.0, [0.21, -0.03, 0]);

      hat = regChild('moss_hat', 0, 1.07, 0);
      pushPart(hat, makeLodLathe([[0, -0.03], [0.36, 0.0], [0.26, 0.20], [0.14, 0.60], [0, 1.0]], 7), 2, 1.0, [0, 0, 0], [0, 0, 0.24]);

      handF = regChild('moss_handF', 0.30, 0.50, 0.66);
      pushPart(handF, makeLodHandGeo(0.12), 2, 1.0);
      handB = regChild('moss_handB', 0.30, 0.50, -0.66);
      pushPart(handB, makeLodHandGeo(0.12), 2, 1.0);

      footF = regChild('moss_footF', 0, 0, 0.19);
      pushPart(footF, makeLodFootGeo(0.18, 0.075, 0.12), 10, 0.35, [0.06, 0.075, 0]);
      footB = regChild('moss_footB', 0, 0, -0.19);
      pushPart(footB, makeLodFootGeo(0.18, 0.075, 0.12), 10, 0.35, [0.06, 0.075, 0]);

      rod = regChild('moss_rod', 0.30, 0.50, 0.66);
      pushPart(rod, makeTube([[0, 0, 0], [0.70, 0.72, 0], [1.42, 1.18, 0]], 0.022, 3, 4), 11, 0.35);
      pushPart(rod, makeLodBlob(0.06, 0.08, 0.06, 5, 3), 2, 1.0, [1.50, 0.42, 0]);
      break;
    }
    default:
      assertNever(fighterId, 'instantiateFighterLodRig');
  }

  const skinned = mergeLodPartsToSkinnedMesh(parts, bones, material);
  group.add(skinned);

  const rig: FighterBoneRig = {
    fighterId,
    body,
    lid,
    head,
    hat,
    rod,
    handF,
    handB,
    footF,
    footB,
    hoofFL,
    hoofFR,
    hoofBL,
    hoofBR,
  };
  const spec = getFighterSpec(fighterId);
  const scale = fighterId === FighterId.Nesta && spec.nestaSizes ? spec.nestaSizes.get(NestaSize.Mid)!.scale : 1.0;
  return { group, rig, material, scale };
}

// ---------------------------------------------------------------- Procedural Ceramic Primitives

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

function ceramicMat(matcap: THREE.Texture, color: string | THREE.Vector3, finish: 'glaze' | 'satin' | 'bisque' | 'gilt' = 'glaze', alpha = 1.0): GlazeMaterial {
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

function addPart(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, pos?: readonly [number, number, number], rot?: readonly [number, number, number]): THREE.Mesh {
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
      // Arched bridge in back Z
      for (const zOff of [-0.75, 0.75]) {
        addPart(g, makeTube([[-3, 2.5, zOff], [-1.5, 2.92, zOff], [0, 3.05, zOff], [1.5, 2.92, zOff], [3, 2.5, zOff]], 0.11, 10, 6), blue);
      }
      for (let i = -3; i <= 3; i++) {
        const y = 2.46 + 0.55 * (1 - (i / 3) ** 2);
        addPart(g, new THREE.BoxGeometry(0.36, 0.14, 1.4), white, [i * 0.85, y, 0]);
      }
      // Bonsai willow tree right
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
      // Background pouring teapot
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
