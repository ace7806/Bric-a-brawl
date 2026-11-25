import * as THREE from 'three';
import { InvariantError, assert, assertNever } from '@sim/assert';
import { getArenaSpec, getFighterSpec, getGameData } from '@sim/data';
import {
  ArenaId,
  ChunkState,
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  MoveId,
  NestaSize,
  WorldGadgetState,
} from '@sim/enums';
import { polygonCentroid } from '@sim/geometry';
import type {
  FighterRuntime,
  HazardZoneRuntime,
  IslandState,
  ProjectileRuntime,
  WorldGadgetRuntime,
} from '@sim/types';
import { GlazeFinish, QualityTier } from './enums';
import {
  GlazeMaterial,
  createGlazeMaterial,
  createSkyGradientTexture,
  hexToLinearVec3,
} from './glaze-material';
import {
  type CeramicAssetPack,
  type InstantiatedFighter,
  buildArenaDressing,
  buildCloudMesh,
  buildGadgetMesh,
  buildParcelMesh,
  buildSidePlateMesh,
  buildTeaspoonMesh,
  instantiateFighterLodRig,
  instantiateFighterRig,
  loadCeramicAssets,
} from './models';
import {
  FACING_LEFT_YAW,
  FACING_RIGHT_YAW,
  type FighterAnimRuntime,
  applyFighterPose,
  createFighterAnimRuntime,
} from './poses';
import { VfxSystem } from './vfx';

interface FighterMeshRig {
  readonly slot: number;
  readonly fighterId: FighterId;
  readonly liveryHex: string;
  readonly finish: GlazeFinish;
  readonly inst: InstantiatedFighter;
  readonly anim: FighterAnimRuntime;
  readonly group: THREE.Group;
  readonly guardPlate: THREE.Mesh;
  readonly guardMat: GlazeMaterial;
  readonly teaspoon: THREE.Group;
  readonly giltRing: THREE.Mesh;
}

interface PooledGadgetProp {
  readonly kindKey: number; // -1 = parcel, else GadgetId
  readonly group: THREE.Group;
}

interface ArenaDressingHandle {
  readonly root: THREE.Group;
  readonly pourStream: THREE.Mesh | null;
  readonly bowlUpdraft: THREE.Group | null;
}

const PIXEL_RATIO_BY_TIER: Record<QualityTier, number> = {
  [QualityTier.Low]: 0.75,
  [QualityTier.Medium]: 1.0,
  [QualityTier.High]: 1.5,
};

const CLOUD_LAYOUT: readonly (readonly [number, number, number, number])[] = [
  [-12, 12.5, -30, 3.0],
  [17, 14.0, -36, 4.0],
  [24, 2.5, -26, 2.6],
  [-20, 1.5, -32, 3.2],
];

const MAX_ACTIVE_GADGET_PROPS = 8;

export interface RenderFrameInput {
  readonly fighters: readonly FighterRuntime[];
  readonly island: IslandState;
  readonly worldGadgets: readonly WorldGadgetRuntime[];
  readonly projectiles: readonly ProjectileRuntime[];
  readonly hazards: readonly HazardZoneRuntime[];
  readonly isLobby: boolean;
  readonly readyPlatterActive: boolean;
  readonly finishBySlot?: ReadonlyMap<number, GlazeFinish>;
  readonly localSlot?: number;
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        for (const m of mesh.material) m.dispose();
      } else {
        mesh.material.dispose();
      }
    }
  });
}

function buildChunkPalette(arenaId: ArenaId, isHighTeaRose: boolean): THREE.Vector3[] {
  const pal = getGameData().palette;
  const world = pal.world;
  const neutrals = pal.neutrals;
  const accents = pal.accents;

  let slot0: THREE.Vector3;
  let slot1: THREE.Vector3;
  let slot2: THREE.Vector3;

  switch (arenaId) {
    case ArenaId.Willow:
      slot0 = hexToLinearVec3(world['willow_glaze']!).lerp(hexToLinearVec3(world['willow_wash']!), 0.14);
      slot1 = hexToLinearVec3(world['willow_line']!);
      slot2 = hexToLinearVec3('#C69D7E');
      break;
    case ArenaId.HighTea:
      slot0 = isHighTeaRose ? hexToLinearVec3(world['tea_rose']!) : hexToLinearVec3(world['tea_cream']!);
      slot1 = hexToLinearVec3(accents['gilt']!);
      slot2 = hexToLinearVec3(neutrals['bisque']!);
      break;
    case ArenaId.MendedBowl:
      slot0 = hexToLinearVec3(world['bowl_tenmoku']!);
      slot1 = hexToLinearVec3(accents['gilt']!);
      slot2 = hexToLinearVec3('#2E2622');
      break;
    case ArenaId.Saucer:
      slot0 = hexToLinearVec3(neutrals['bone']!);
      slot1 = hexToLinearVec3(accents['gilt']!);
      slot2 = hexToLinearVec3(neutrals['bisque']!);
      break;
    default:
      assertNever(arenaId, 'buildChunkPalette');
  }

  return Array.from({ length: 16 }, (_, idx) => {
    if (idx === 1) return slot1.clone();
    if (idx === 2) return slot2.clone();
    return slot0.clone();
  });
}

function createExtrudedChunkGeometry(poly: readonly (readonly [number, number])[], arenaId: ArenaId): THREE.ExtrudeGeometry {
  const [cx, cy] = polygonCentroid(poly);
  const shape = new THREE.Shape();
  const first = poly[0]!;
  shape.moveTo(first[0] - cx, first[1] - cy);
  for (let i = 1; i < poly.length; i++) {
    const pt = poly[i]!;
    shape.lineTo(pt[0] - cx, pt[1] - cy);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 2.2,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -1.1);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const stripeMetal = arenaId === ArenaId.Willow ? 0.0 : 0.75;
  const colors = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const ny = norm.getY(i);
    const ao = 0.58 + 0.42 * Math.max(0, Math.min(1, 0.5 + 0.5 * ny));

    let slot = 0;
    let gloss = 1.0;
    let metal = 0.0;

    if (y >= maxY - 0.24 || ny > 0.55) {
      slot = 0;
      gloss = 1.0;
      metal = 0.0;
    } else if (y >= maxY - 0.50) {
      slot = 1;
      gloss = 0.95;
      metal = stripeMetal;
    } else {
      slot = 2;
      gloss = 0.25;
      metal = 0.0;
    }

    const i4 = i * 4;
    colors[i4] = slot / 15.0;
    colors[i4 + 1] = gloss;
    colors[i4 + 2] = ao;
    colors[i4 + 3] = metal;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geo;
}

function createGlazeInstancedPatch(mat: GlazeMaterial): void {
  // Three.js injects attribute mat4 instanceMatrix automatically under USE_INSTANCING; apply the transform here
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'vViewNormal = normalize(normalMatrix * objectNormal);',
      `#ifdef USE_INSTANCING
  objectNormal = mat3(instanceMatrix) * objectNormal;
  transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
vViewNormal = normalize(normalMatrix * objectNormal);`,
    );
  };
  mat.customProgramCacheKey = () => 'glaze-instanced-v2';
}

export class GreyboxRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly vfx: VfxSystem;

  private assets: CeramicAssetPack | null = null;
  private skyTexture: THREE.CanvasTexture | null = null;
  private readonly cloudMeshes: THREE.Mesh[] = [];

  private readonly fighterRigs = new Map<number, FighterMeshRig>();
  private readonly localFinishBySlot = new Map<number, GlazeFinish>();
  private readonly chunkMeshes: THREE.Mesh[] = [];
  private readonly platformMeshes: THREE.Mesh[] = [];
  private dressing: ArenaDressingHandle | null = null;

  private readonly worldGroup = new THREE.Group();
  private readonly showcaseGroup = new THREE.Group();
  private readonly gadgetPool: PooledGadgetProp[] = [];
  private readonly activeGadgetProps: PooledGadgetProp[] = [];

  private rubbleMesh: THREE.InstancedMesh | null = null;
  private projectileMesh: THREE.InstancedMesh | null = null;
  private hazardMesh: THREE.InstancedMesh | null = null;
  private lobbyPlatter: THREE.Mesh | null = null;
  private lobbyPlatterMat: GlazeMaterial | null = null;
  private lobbyRimMat: GlazeMaterial | null = null;
  private localMarkerMesh: THREE.Mesh | null = null;
  private localMarkerMat: GlazeMaterial | null = null;
  private localMarkerSlot = -1;

  private readonly dummy = new THREE.Object3D();
  private readonly activeSlotsSet = new Set<number>();
  private readonly shadowsBuffer: { x: number; y: number; scale: number }[] = [];
  private readonly lobbyBoneVec = new THREE.Vector3();
  private readonly lobbyOkVec = new THREE.Vector3();
  private readonly crazedGlazeTint = new THREE.Vector3(0.84, 0.80, 0.76);
  private readonly looseGlazeTint = new THREE.Vector3(0.72, 0.67, 0.63);
  private readonly whiteGlazeTint = new THREE.Vector3(1.0, 1.0, 1.0);
  private loadedArenaId: ArenaId | null = null;
  private tier: QualityTier;
  private renderScale = 1.0;
  private simTimeSec = 0;

  public constructor(canvas: HTMLCanvasElement, overlayRoot: HTMLElement, tier: QualityTier) {
    this.tier = tier;
    const camTuning = getGameData().tuning.camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier !== QualityTier.Low,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.skyTexture = createSkyGradientTexture();
    this.scene.background = this.skyTexture;

    this.camera = new THREE.PerspectiveCamera(camTuning.fovDeg, 16 / 9, 0.5, 160);
    this.camera.position.set(0, 4, 34);

    this.vfx = new VfxSystem(overlayRoot, { tier, reduceFlashes: false });
    this.worldGroup.add(this.vfx.group);
    this.scene.add(this.worldGroup, this.showcaseGroup);
    this.showcaseGroup.visible = false;

    this.resize(canvas.clientWidth || 640, canvas.clientHeight || 360);
  }

  public async initAssets(): Promise<void> {
    if (this.assets !== null) return;
    const pack = await loadCeramicAssets();
    this.assets = pack;
    this.buildBackdropAndInstancedMeshes(pack.matcap);
    if (this.loadedArenaId !== null) {
      const aid = this.loadedArenaId;
      this.loadedArenaId = null;
      this.syncArena(aid);
    }
  }

  public setLocalGlazeFinish(slot: number, finish: GlazeFinish): void {
    this.localFinishBySlot.set(slot, finish);
  }

  private buildBackdropAndInstancedMeshes(matcap: THREE.Texture): void {
    const pal = getGameData().palette;

    // 4 distant porcelain clouds (ART_BIBLE 4.4)
    for (let i = 0; i < CLOUD_LAYOUT.length; i++) {
      const [cx, cy, cz, cs] = CLOUD_LAYOUT[i]!;
      const c = buildCloudMesh(matcap, 60 + i);
      c.position.set(cx, cy, cz);
      c.scale.setScalar(cs);
      this.scene.add(c);
      this.cloudMeshes.push(c);
    }

    const rubbleMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: hexToLinearVec3(pal.neutrals['bisque']!),
      gloss: 0.25,
      sheen: 0.3,
      speckle: 1.0,
    });
    createGlazeInstancedPatch(rubbleMat);
    this.rubbleMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.26, 0), rubbleMat, 16);
    this.rubbleMesh.count = 0;
    this.rubbleMesh.frustumCulled = false;

    const projMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: hexToLinearVec3(pal.accents['stamp_red']!),
      gloss: 0.95,
      sheen: 0.4,
      speckle: 0.5,
    });
    createGlazeInstancedPatch(projMat);
    this.projectileMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), projMat, 12);
    this.projectileMesh.count = 0;
    this.projectileMesh.frustumCulled = false;

    const hazMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: hexToLinearVec3(pal.world['tea']!),
      gloss: 0.9,
      sheen: 0.3,
      speckle: 0.0,
      alpha: 0.55,
    });
    createGlazeInstancedPatch(hazMat);
    this.hazardMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.0, 1.0, 0.25, 14), hazMat, 8);
    this.hazardMesh.count = 0;
    this.hazardMesh.frustumCulled = false;

    const boneVec = hexToLinearVec3(pal.neutrals['bone']!);
    this.lobbyBoneVec.copy(boneVec);
    this.lobbyOkVec.copy(hexToLinearVec3(pal.ui['ok']!));

    this.lobbyPlatterMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: boneVec,
      gloss: 1.0,
      sheen: 0.4,
      speckle: 0.4,
    });
    this.lobbyRimMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: hexToLinearVec3(pal.accents['gilt']!),
      gloss: 0.9,
      sheen: 0.6,
      metal: 1.0,
      speckle: 0.0,
      gilt: 0.3,
    });
    const platterGroup = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.75, 0.14, 24), this.lobbyPlatterMat);
    const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.08, 6, 24), this.lobbyRimMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 0.06;
    platterGroup.add(rimMesh);
    platterGroup.position.set(0, 0.08, 0);
    platterGroup.visible = false;
    this.lobbyPlatter = platterGroup;

    // Lightweight overhead local-player ceramic chevron/diamond marker (1 draw call, ~8 tris)
    const markerGeo = new THREE.ConeGeometry(0.24, 0.42, 4);
    markerGeo.rotateX(Math.PI);
    this.localMarkerMat = createGlazeMaterial({
      matcap,
      usePaletteAttr: false,
      baseColor: hexToLinearVec3(pal.players[0]!.hex),
      gloss: 1.0,
      sheen: 0.5,
      speckle: 0.0,
      gilt: 0.2,
    });
    this.localMarkerMesh = new THREE.Mesh(markerGeo, this.localMarkerMat);
    this.localMarkerMesh.visible = false;
    this.localMarkerMesh.frustumCulled = false;

    this.worldGroup.add(this.rubbleMesh, this.projectileMesh, this.hazardMesh, this.lobbyPlatter, this.localMarkerMesh);
    this.applyTierBackdropAndMaterials();
  }

  private applyTierBackdropAndMaterials(): void {
    const isLow = this.tier === QualityTier.Low;
    for (const c of this.cloudMeshes) {
      c.visible = !isLow;
    }
    if (this.rubbleMesh) {
      (this.rubbleMesh.material as GlazeMaterial).uniforms.uSpeckle.value = isLow ? 0 : 1.0;
    }
    if (this.projectileMesh) {
      (this.projectileMesh.material as GlazeMaterial).uniforms.uSpeckle.value = isLow ? 0 : 0.5;
    }
    if (this.lobbyPlatterMat) {
      this.lobbyPlatterMat.uniforms.uSpeckle.value = isLow ? 0 : 0.4;
    }
    for (const mesh of this.chunkMeshes) {
      const mat = mesh.material as GlazeMaterial;
      mat.uniforms.uSpeckle.value = isLow ? 0 : 0.7;
      if (isLow) {
        mat.uniforms.uCrack.value = 0;
      } else {
        mat.uniforms.uGlazeTint.value.copy(this.whiteGlazeTint);
      }
    }
    for (const mesh of this.platformMeshes) {
      (mesh.material as GlazeMaterial).uniforms.uSpeckle.value = isLow ? 0 : 0.4;
    }
  }

  public setQuality(tier: QualityTier, renderScale: number): void {
    const wasLow = this.tier === QualityTier.Low;
    const nowLow = tier === QualityTier.Low;
    this.tier = tier;
    this.renderScale = renderScale;
    this.vfx.setTier(tier);
    if (wasLow !== nowLow) {
      for (const rig of this.fighterRigs.values()) this.disposeRig(rig);
      this.fighterRigs.clear();
    }
    this.applyTierBackdropAndMaterials();
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_BY_TIER[tier]) * renderScale;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
  }

  public resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_BY_TIER[this.tier]) * this.renderScale;
    this.renderer.setPixelRatio(Math.max(0.5, pr));
    this.renderer.setSize(w, h, false);
  }

  private clearArenaMeshes(): void {
    for (const m of this.chunkMeshes) {
      this.worldGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    for (const m of this.platformMeshes) {
      this.worldGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.chunkMeshes.length = 0;
    this.platformMeshes.length = 0;
    if (this.dressing !== null) {
      this.worldGroup.remove(this.dressing.root);
      disposeObjectTree(this.dressing.root);
      this.dressing = null;
    }
  }

  private platformGlazeColor(arenaId: ArenaId): THREE.Vector3 {
    const pal = getGameData().palette;
    switch (arenaId) {
      case ArenaId.Willow:
        return hexToLinearVec3(pal.world['willow_wash']!);
      case ArenaId.HighTea:
        return hexToLinearVec3(pal.world['tea_rose']!);
      case ArenaId.MendedBowl:
        return hexToLinearVec3(pal.world['bowl_inner']!);
      case ArenaId.Saucer:
        return hexToLinearVec3(pal.accents['gilt']!);
      default:
        assertNever(arenaId, 'platformGlazeColor');
    }
  }

  public syncArena(arenaId: ArenaId): void {
    if (this.loadedArenaId === arenaId && this.chunkMeshes.length > 0) return;
    this.loadedArenaId = arenaId;
    if (this.assets === null) return;

    this.clearArenaMeshes();
    const spec = getArenaSpec(arenaId);
    const matcap = this.assets.matcap;
    const platCol = this.platformGlazeColor(arenaId);
    const pal = getGameData().palette;

    for (let i = 0; i < spec.chunks.length; i++) {
      const ch = spec.chunks[i]!;
      const geo = createExtrudedChunkGeometry(ch.poly, arenaId);
      const isHighTeaRose = arenaId === ArenaId.HighTea && ch.id.startsWith('T2');
      const mat = createGlazeMaterial({
        matcap,
        usePaletteAttr: true,
        palette: buildChunkPalette(arenaId, isHighTeaRose),
        sheen: 0.4,
        speckle: this.tier === QualityTier.Low ? 0 : 0.7,
        kintsugi: arenaId === ArenaId.MendedBowl ? 1.0 : 0.0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.worldGroup.add(mesh);
      this.chunkMeshes.push(mesh);
    }

    for (const plat of spec.platforms) {
      const w = plat.x1 - plat.x0;
      const geo = new THREE.BoxGeometry(w, 0.24, 1.8);
      const mat = createGlazeMaterial({
        matcap,
        usePaletteAttr: false,
        baseColor: platCol,
        gloss: 0.75,
        sheen: 0.35,
        speckle: this.tier === QualityTier.Low ? 0 : 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((plat.x0 + plat.x1) * 0.5, plat.y - 0.12, 0);
      this.worldGroup.add(mesh);
      this.platformMeshes.push(mesh);
    }

    const dressingRoot = buildArenaDressing(arenaId, matcap);
    let pourStream: THREE.Mesh | null = null;
    let bowlUpdraft: THREE.Group | null = null;

    if (arenaId === ArenaId.HighTea && spec.pourHazard !== null) {
      const streamX = (spec.pourHazard.x0 + spec.pourHazard.x1) * 0.5;
      const streamGeo = new THREE.CylinderGeometry(0.32, 0.52, 11.5, 10);
      const streamMat = createGlazeMaterial({
        matcap,
        usePaletteAttr: false,
        baseColor: hexToLinearVec3(pal.world['tea']!),
        gloss: 0.95,
        sheen: 0.3,
        speckle: 0.0,
        alpha: 0.78,
      });
      pourStream = new THREE.Mesh(streamGeo, streamMat);
      pourStream.position.set(streamX, 5.8, 0.2);
      pourStream.visible = false;
      dressingRoot.add(pourStream);
    }

    if (arenaId === ArenaId.MendedBowl) {
      bowlUpdraft = new THREE.Group();
      const wispGeo = new THREE.CylinderGeometry(0.18, 0.05, 4.5, 6);
      const wispMat = createGlazeMaterial({
        matcap,
        usePaletteAttr: false,
        baseColor: hexToLinearVec3(pal.world['sky_mid']!),
        gloss: 0.0,
        sheen: 0.2,
        speckle: 0.0,
        alpha: 0.42,
      });
      for (let i = -1; i <= 1; i++) {
        const m = new THREE.Mesh(wispGeo, wispMat);
        m.position.set(i * 0.55, 2.2 + Math.abs(i) * 0.6, 0.2);
        bowlUpdraft.add(m);
      }
      bowlUpdraft.visible = false;
      dressingRoot.add(bowlUpdraft);
    }

    this.worldGroup.add(dressingRoot);
    this.dressing = { root: dressingRoot, pourStream, bowlUpdraft };
  }

  private disposeRig(rig: FighterMeshRig): void {
    this.worldGroup.remove(rig.group);
    disposeObjectTree(rig.group);
  }

  private ensureFighterRig(f: FighterRuntime, finish: GlazeFinish): FighterMeshRig {
    assert(this.assets !== null, ErrorCode.InvariantViolation, 'ensureFighterRig called before initAssets()');
    const pal = getGameData().palette;
    const liveryHex = pal.players[f.slot % pal.players.length]!.hex;
    const existing = this.fighterRigs.get(f.slot);
    if (
      existing &&
      existing.fighterId === f.id &&
      existing.liveryHex === liveryHex &&
      existing.finish === finish
    ) {
      return existing;
    }
    if (existing) {
      this.disposeRig(existing);
      this.fighterRigs.delete(f.slot);
    }

    const inst =
      this.tier === QualityTier.Low
        ? instantiateFighterLodRig(this.assets, f.id, liveryHex, finish)
        : instantiateFighterRig(this.assets, f.id, liveryHex, finish);
    const spec = getFighterSpec(f.id);
    const group = new THREE.Group();
    group.add(inst.group);

    const guardPlate = buildSidePlateMesh(liveryHex, this.assets.matcap);
    const guardMat = guardPlate.material as GlazeMaterial;
    guardPlate.position.set(0, spec.stats.height * 0.5, 0.52);
    guardPlate.visible = false;

    const teaspoon = buildTeaspoonMesh(liveryHex, this.assets.matcap);
    teaspoon.visible = false;

    const giltRing = new THREE.Mesh(
      new THREE.TorusGeometry(spec.stats.width * 0.58, 0.05, 6, 18),
      createGlazeMaterial({
        matcap: this.assets.matcap,
        usePaletteAttr: false,
        baseColor: hexToLinearVec3(pal.accents['gilt']!),
        gloss: 0.9,
        sheen: 0.6,
        metal: 1.0,
        speckle: 0.0,
        gilt: 0.7,
      }),
    );
    giltRing.rotation.x = Math.PI / 2;
    giltRing.position.y = spec.stats.height * 0.52;
    giltRing.visible = false;

    group.add(guardPlate, teaspoon, giltRing);
    this.worldGroup.add(group);

    const rig: FighterMeshRig = {
      slot: f.slot,
      fighterId: f.id,
      liveryHex,
      finish,
      inst,
      anim: createFighterAnimRuntime(f.slot),
      group,
      guardPlate,
      guardMat,
      teaspoon,
      giltRing,
    };
    this.fighterRigs.set(f.slot, rig);
    return rig;
  }

  private acquireGadgetProp(kindKey: number): PooledGadgetProp {
    assert(this.assets !== null, ErrorCode.InvariantViolation, 'acquireGadgetProp called before initAssets()');
    const idx = this.gadgetPool.findIndex((p) => p.kindKey === kindKey);
    if (idx >= 0) {
      const prop = this.gadgetPool.splice(idx, 1)[0]!;
      prop.group.visible = true;
      this.activeGadgetProps.push(prop);
      return prop;
    }
    const group =
      kindKey < 0
        ? buildParcelMesh(this.assets.matcap)
        : buildGadgetMesh(kindKey as GadgetId, this.assets.matcap);
    this.worldGroup.add(group);
    const prop: PooledGadgetProp = { kindKey, group };
    this.activeGadgetProps.push(prop);
    return prop;
  }

  private releaseAllGadgetProps(): void {
    while (this.activeGadgetProps.length > 0) {
      const prop = this.activeGadgetProps.pop()!;
      prop.group.visible = false;
      this.gadgetPool.push(prop);
    }
    while (this.gadgetPool.length > 16) {
      const evicted = this.gadgetPool.shift()!;
      this.worldGroup.remove(evicted.group);
      disposeObjectTree(evicted.group);
    }
  }

  private clearShowcase(): void {
    while (this.showcaseGroup.children.length > 0) {
      const child = this.showcaseGroup.children[0]!;
      this.showcaseGroup.remove(child);
      disposeObjectTree(child);
    }
    this.showcaseGroup.visible = false;
    this.worldGroup.visible = true;
  }

  public render(input: RenderFrameInput, dt: number): void {
    if (this.assets === null) return;
    if (this.showcaseGroup.visible) this.clearShowcase();
    this.simTimeSec += dt;

    this.syncArena(input.island.arenaId);
    const isLow = this.tier === QualityTier.Low;

    // Update arena chunks + GlazeMaterial crazing/kintsugi uniforms (clean tint fallback on Low)
    for (let i = 0; i < input.island.chunks.length; i++) {
      const ch = input.island.chunks[i]!;
      const mesh = this.chunkMeshes[i];
      if (!mesh) continue;
      mesh.visible = ch.state !== ChunkState.Gone;
      const trembleX = ch.state === ChunkState.Crazed ? Math.sin(this.simTimeSec * 42 + i * 2.1) * 0.032 : 0;
      mesh.position.set(ch.x + trembleX, ch.y, 0);
      mesh.rotation.z = ch.angle;

      const mat = mesh.material as GlazeMaterial;
      if (isLow) {
        mat.uniforms.uCrack.value = 0;
        mat.uniforms.uSpeckle.value = 0;
        if (ch.state === ChunkState.Crazed) {
          mat.uniforms.uGlazeTint.value.copy(this.crazedGlazeTint);
        } else if (ch.state === ChunkState.Loose || ch.state === ChunkState.Falling) {
          mat.uniforms.uGlazeTint.value.copy(this.looseGlazeTint);
        } else {
          mat.uniforms.uGlazeTint.value.copy(this.whiteGlazeTint);
        }
      } else {
        mat.uniforms.uGlazeTint.value.copy(this.whiteGlazeTint);
        const hpRatio = ch.maxHp > 0 ? Math.max(0, Math.min(1, ch.hp / ch.maxHp)) : 1;
        const stateCrack =
          ch.state === ChunkState.Crazed
            ? 0.75
            : ch.state === ChunkState.Loose || ch.state === ChunkState.Falling
              ? 1.0
              : 0.0;
        mat.uniforms.uCrack.value = Math.max(1 - hpRatio, stateCrack);
        mat.uniforms.uSpeckle.value = 0.7;
      }
      mat.uniforms.uKintsugi.value = input.island.arenaId === ArenaId.MendedBowl ? 1.0 : 0.0;
      mat.uniforms.uGilt.value = ch.state === ChunkState.Loose ? 0.35 : 0.0;
    }

    for (let i = 0; i < input.island.platforms.length; i++) {
      const plat = input.island.platforms[i]!;
      const mesh = this.platformMeshes[i];
      if (!mesh) continue;
      mesh.visible = plat.alive;
      mesh.position.set((plat.x0 + plat.x1) * 0.5, plat.y - 0.12, 0);
    }

    if (this.dressing?.pourStream) {
      this.dressing.pourStream.visible = input.island.pour.active || input.island.pour.telegraphing;
      this.dressing.pourStream.scale.set(
        input.island.pour.telegraphing && !input.island.pour.active ? 0.35 : 1.0,
        1.0,
        input.island.pour.telegraphing && !input.island.pour.active ? 0.35 : 1.0,
      );
    }
    if (this.dressing?.bowlUpdraft) {
      this.dressing.bowlUpdraft.visible = input.island.bowl.splitActive;
      if (input.island.bowl.splitActive) {
        this.dressing.bowlUpdraft.position.y = Math.sin(this.simTimeSec * 4.5) * 0.35;
      }
    }

    if (this.lobbyPlatter && this.lobbyPlatterMat) {
      this.lobbyPlatter.visible = input.isLobby;
      if (input.isLobby) {
        this.lobbyPlatterMat.uniforms.uBaseColor.value.copy(
          input.readyPlatterActive ? this.lobbyOkVec : this.lobbyBoneVec,
        );
      }
    }

    // Prune departed slots using pre-allocated Set
    this.activeSlotsSet.clear();
    for (let i = 0; i < input.fighters.length; i++) {
      this.activeSlotsSet.add(input.fighters[i]!.slot);
    }
    for (const [slot, rig] of this.fighterRigs) {
      if (!this.activeSlotsSet.has(slot)) {
        this.disposeRig(rig);
        this.fighterRigs.delete(slot);
      }
    }

    this.shadowsBuffer.length = 0;
    let markerFighter: FighterRuntime | null = null;
    const localSlot = input.localSlot;
    for (let i = 0; i < input.fighters.length; i++) {
      const f = input.fighters[i]!;
      const finish =
        input.finishBySlot?.get(f.slot) ?? this.localFinishBySlot.get(f.slot) ?? GlazeFinish.Standard;
      const rig = this.ensureFighterRig(f, finish);
      const isTeaspoon = f.state === FighterState.Teaspoon;
      const isEliminated = f.state === FighterState.Eliminated;

      if (
        localSlot !== undefined &&
        f.slot === localSlot &&
        !isEliminated &&
        !isTeaspoon &&
        f.stocks > 0
      ) {
        markerFighter = f;
      }

      rig.group.visible = !isEliminated;
      rig.inst.group.visible = !isTeaspoon;
      rig.teaspoon.visible = isTeaspoon;

      const facingRight = (f.flags & FighterFlag.FacingRight) !== 0;
      const grounded = (f.flags & FighterFlag.Grounded) !== 0;
      const isHitstop = f.hitstopFrames > 0;
      const invuln = (f.flags & FighterFlag.Invuln) !== 0 || f.invulnFrames > 0;

      rig.group.position.set(isTeaspoon ? f.teaspoonX : f.x, isTeaspoon ? 11.5 : f.y, 0);

      let nestaScale = rig.inst.scale;
      if (f.id === FighterId.Nesta) {
        if (f.nestaSize === NestaSize.Big) nestaScale = 1.25 * 0.893;
        else if (f.nestaSize === NestaSize.Small) nestaScale = 0.72 * 0.893;
        else nestaScale = 0.893;
      }
      rig.inst.group.scale.setScalar(nestaScale);

      if (!isTeaspoon && !isEliminated) {
        applyFighterPose(rig.inst.rig, rig.anim, f, dt, this.simTimeSec, facingRight, grounded, isHitstop);
        rig.inst.group.rotation.y = rig.anim.facingYaw;

        const u = rig.inst.material.uniforms;
        u.uSpeckle.value = isLow ? 0 : finish === GlazeFinish.SpeckledStone ? 1.6 : 1.0;
        u.uCrack.value = isLow
          ? 0
          : Math.max(finish === GlazeFinish.Crackle || finish === GlazeFinish.Kintsugi ? 0.85 : 0, Math.min(1, f.damage / 150));
        u.uGilt.value = f.gilt >= 100 ? 0.85 : finish === GlazeFinish.RoyalGilt ? 0.85 : finish === GlazeFinish.GoldRim ? 0.45 : 0;
        u.uFlash.value = f.hitstopFrames > 0 ? 0.85 : 0;
        u.uMatte.value = invuln ? 0.8 : finish === GlazeFinish.MatteBisque ? 0.85 : 0;
      }

      const guarding =
        f.state === FighterState.Guard ||
        f.state === FighterState.Parry ||
        f.state === FighterState.GuardStun;
      rig.guardPlate.visible = !isTeaspoon && guarding;
      if (guarding) {
        rig.guardPlate.position.x = (facingRight ? 0.55 : -0.55);
        rig.guardMat.uniforms.uAlpha.value = f.state === FighterState.Parry ? 0.95 : Math.max(0.28, f.guardHp / 60);
        rig.guardMat.uniforms.uGilt.value = f.state === FighterState.Parry ? 0.7 : 0.25;
      }
      rig.giltRing.visible = !isTeaspoon && f.gilt >= 100;

      this.vfx.updateRibbon(f.slot, f.x, f.y + 0.7, f.state === FighterState.Tumble, rig.liveryHex);
      if (!isTeaspoon && !isEliminated && grounded) {
        this.shadowsBuffer.push({ x: f.x, y: f.y, scale: nestaScale });
      }
    }
    this.vfx.updateBlobShadows(this.shadowsBuffer);

    if (this.localMarkerMesh && this.localMarkerMat) {
      if (markerFighter !== null) {
        if (this.localMarkerSlot !== markerFighter.slot) {
          this.localMarkerSlot = markerFighter.slot;
          const players = getGameData().palette.players;
          const liveryHex = players[markerFighter.slot % players.length]!.hex;
          this.localMarkerMat.uniforms.uBaseColor.value.copy(hexToLinearVec3(liveryHex));
        }
        const bob = Math.sin(this.simTimeSec * 5.5) * 0.1;
        this.localMarkerMesh.visible = true;
        this.localMarkerMesh.position.set(markerFighter.x, markerFighter.y + 2.35 + bob, 0.35);
        this.localMarkerMesh.rotation.y = this.simTimeSec * 1.6;
      } else {
        this.localMarkerMesh.visible = false;
      }
    }

    // Sync ceramic gadgets & parcels pool
    this.releaseAllGadgetProps();
    const gadgetCount = Math.min(input.worldGadgets.length, MAX_ACTIVE_GADGET_PROPS);
    for (let i = 0; i < gadgetCount; i++) {
      const g = input.worldGadgets[i]!;
      const kindKey = g.state === WorldGadgetState.Parcel ? -1 : g.gadgetId;
      const prop = this.acquireGadgetProp(kindKey);
      prop.group.position.set(g.x, g.y + (g.state === WorldGadgetState.Parcel ? 0.25 : 0.28), 0);
      prop.group.rotation.z = g.angle;
      prop.group.scale.setScalar(g.gadgetId === GadgetId.Toaster ? 1.15 : 1.0);
    }

    // Instanced rubble, projectiles, hazards
    if (this.rubbleMesh) {
      const n = Math.min(input.island.rubble.length, 16);
      for (let i = 0; i < n; i++) {
        const r = input.island.rubble[i]!;
        this.dummy.position.set(r.x, r.y, 0);
        this.dummy.rotation.set(0, 0, r.angle);
        this.dummy.scale.setScalar(r.isShell ? 1.5 : 1.0);
        this.dummy.updateMatrix();
        this.rubbleMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.rubbleMesh.count = n;
      if (n > 0) this.rubbleMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.projectileMesh) {
      const n = Math.min(input.projectiles.length, 12);
      for (let i = 0; i < n; i++) {
        const p = input.projectiles[i]!;
        this.dummy.position.set(p.x, p.y, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(Math.max(0.6, p.radius * 3));
        this.dummy.updateMatrix();
        this.projectileMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.projectileMesh.count = n;
      if (n > 0) this.projectileMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.hazardMesh) {
      const n = Math.min(input.hazards.length, 8);
      for (let i = 0; i < n; i++) {
        const h = input.hazards[i]!;
        this.dummy.position.set(h.x, h.y + 0.15, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(h.radius, 1, h.radius);
        this.dummy.updateMatrix();
        this.hazardMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.hazardMesh.count = n;
      if (n > 0) this.hazardMesh.instanceMatrix.needsUpdate = true;
    }

    this.vfx.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** M4.6 faithful Three.js reproduction of assets-src/blender/style_frame.py */
  public renderStyleFrame(): void {
    assert(this.assets !== null, ErrorCode.InvariantViolation, 'renderStyleFrame() requires initAssets()');
    this.clearShowcase();
    this.vfx.clear();

    const matcap = this.assets.matcap;
    const pal = getGameData().palette;
    const willow = getArenaSpec(ArenaId.Willow);
    this.syncArena(ArenaId.Willow);

    for (const c of this.cloudMeshes) c.visible = true;
    for (let i = 0; i < willow.chunks.length; i++) {
      const spec = willow.chunks[i]!;
      const mesh = this.chunkMeshes[i]!;
      const mat = mesh.material as GlazeMaterial;
      mat.uniforms.uGlazeTint.value.copy(this.whiteGlazeTint);
      mat.uniforms.uSpeckle.value = 0.7;
      const [cx, cy] = polygonCentroid(spec.poly);
      if (spec.id === 'W1') {
        mesh.visible = false;
      } else if (spec.id === 'W12') {
        mesh.visible = true;
        mesh.position.set(cx + 0.5, cy - 1.5, 0);
        mesh.rotation.z = (-17 * Math.PI) / 180;
        mat.uniforms.uCrack.value = 1.0;
      } else {
        mesh.visible = true;
        mesh.position.set(cx, cy, 0);
        mesh.rotation.z = 0;
        mat.uniforms.uCrack.value = spec.id === 'W2' || spec.id === 'W11' || spec.id === 'W5' ? 0.85 : 0.0;
      }
      mat.uniforms.uKintsugi.value = 0.0;
    }

    const dummySnap = (slot: number, x: number, y: number, vx: number, vy: number, state: FighterState, move = MoveId.None, facingRight = true) => ({
      slot,
      x,
      y,
      vx,
      vy,
      state,
      stateFrame: 6,
      activeMove: move,
      flags: facingRight ? FighterFlag.FacingRight | FighterFlag.Grounded : FighterFlag.Grounded,
      damage: 45,
      guardHp: 60,
      gilt: 0,
      stocks: 3,
      heldGadget: GadgetId.None,
      heldGadgetAmmo: 0,
      nestaSize: NestaSize.Mid,
      hitstopFrames: 0,
    });

    const placeShowcaseFighter = (
      id: FighterId,
      slot: number,
      x: number,
      y: number,
      facingRight: boolean,
      leanDeg: number,
      state: FighterState,
      move: MoveId,
      nestaScale = 1.0,
    ): InstantiatedFighter => {
      const hex = pal.players[slot]!.hex;
      const inst = instantiateFighterRig(this.assets!, id, hex, GlazeFinish.Standard);
      const anim = createFighterAnimRuntime(slot);
      applyFighterPose(inst.rig, anim, dummySnap(slot, x, y, 0, 0, state, move, facingRight), 1 / 60, 0.75, facingRight, true, false);
      inst.group.position.set(x, y, 0);
      inst.group.rotation.y = facingRight ? FACING_RIGHT_YAW : FACING_LEFT_YAW;
      inst.group.rotation.z = (-leanDeg * Math.PI) / 180;
      inst.group.scale.setScalar(nestaScale);
      this.showcaseGroup.add(inst.group);
      return inst;
    };

    this.worldGroup.visible = true;
    this.showcaseGroup.visible = true;
    this.releaseAllGadgetProps();
    for (const rig of this.fighterRigs.values()) rig.group.visible = false;
    if (this.lobbyPlatter) this.lobbyPlatter.visible = false;
    if (this.localMarkerMesh) this.localMarkerMesh.visible = false;
    if (this.rubbleMesh) this.rubbleMesh.count = 0;
    if (this.projectileMesh) this.projectileMesh.count = 0;
    if (this.hazardMesh) this.hazardMesh.count = 0;

    // P2 Grog oxblood (slot 1) at (5.9, 0)
    placeShowcaseFighter(FighterId.Grog, 1, 5.9, 0.0, true, 0, FighterState.Attack, MoveId.Uheavy);
    // P1 Earl cobalt (slot 0) tumbling at (8.35, 6.75) with lid popped off + cobalt trail + chip burst
    const earl = placeShowcaseFighter(FighterId.Earl, 0, 8.35, 6.75, true, 128, FighterState.Tumble, MoveId.None);
    if (earl.rig.lid) {
      earl.rig.lid.bone.position.y += 0.55;
      earl.rig.lid.bone.rotation.z += 0.6;
    }
    const trailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(6.9, 2.0, 0.4),
      new THREE.Vector3(7.35, 3.6, 0.4),
      new THREE.Vector3(7.7, 5.0, 0.4),
      new THREE.Vector3(7.98, 6.1, 0.4),
    ]);
    const trailMesh = new THREE.Mesh(
      new THREE.TubeGeometry(trailCurve, 12, 0.22, 6, false),
      new THREE.MeshBasicMaterial({ color: pal.players[0]!.hex, transparent: true, opacity: 0.9 }),
    );
    this.showcaseGroup.add(trailMesh);
    this.vfx.spawnChips(7.1, 2.4, 11, pal.players[0]!.hex, 5);

    // P3 Nesta mustard small (slot 2) on bridge at (-1.35, 3.03) holding Bellows + 3 puffs
    placeShowcaseFighter(FighterId.Nesta, 2, -1.35, 3.03, true, 4, FighterState.Idle, MoveId.None, 0.72 * 0.893);
    const bellows = buildGadgetMesh(GadgetId.Bellows, matcap);
    bellows.position.set(-0.32, 3.58, 0.38);
    bellows.scale.setScalar(0.95);
    this.showcaseGroup.add(bellows);
    const puffMat = new THREE.MeshBasicMaterial({ color: pal.neutrals['bone'], transparent: true, opacity: 0.82 });
    for (const [gx, gs, gy] of [[0.75, 0.2, 3.6], [1.5, 0.28, 3.72], [2.35, 0.38, 3.84]] as const) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(gs, 1), puffMat);
      puff.position.set(gx, gy, 0.3);
      this.showcaseGroup.add(puff);
    }

    // P4 Moss verdigris (slot 3) at (3.55, 4.05) casting rod
    placeShowcaseFighter(FighterId.Moss, 3, 3.55, 4.05, true, -26, FighterState.Attack, MoveId.Nspec);

    // P5 Nesta tangerine big (slot 4) at (-6.0, 0.02) guarding with SidePlate
    placeShowcaseFighter(FighterId.Nesta, 4, -6.0, 0.02, true, -5, FighterState.Guard, MoveId.None, 1.25 * 0.893);
    const sidePlate = buildSidePlateMesh(pal.players[4]!.hex, matcap);
    sidePlate.position.set(-4.93, 1.05, 0.45);
    sidePlate.rotation.set(0, Math.PI / 2 - 0.1, -0.42);
    this.showcaseGroup.add(sidePlate);

    // P6 Earl aubergine (slot 5) at (-3.35, 0.03) charging
    placeShowcaseFighter(FighterId.Earl, 5, -3.35, 0.03, false, 17, FighterState.ChargingHeavy, MoveId.None);

    // Arriving Parcel at (2.2, 7.7, -0.3)
    const parcel = buildParcelMesh(matcap);
    parcel.position.set(2.2, 7.7, -0.3);
    parcel.rotation.set(0.08, -0.12, 0.3);
    this.showcaseGroup.add(parcel);

    this.vfx.updateBlobShadows([
      { x: 5.9, y: 0, scale: 1.05 },
      { x: -6.0, y: 0.02, scale: 0.9 },
      { x: -3.35, y: 0.03, scale: 0.78 },
    ]);
    this.vfx.step(1 / 60);

    // Style-frame camera (Y-up conversion of Blender (0.55, -23.4, 6.75) -> (1.75, 0, 3.85))
    this.camera.fov = 30;
    this.camera.position.set(0.55, 6.75, 23.4);
    this.camera.lookAt(1.75, 3.85, 0);
    this.camera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);
  }

  /** M4 Showcase Mode: close-up fighter turntable shot or full-arena hero shot */
  public renderShowcase(kind: 'fighter' | 'arena', id: number): void {
    assert(this.assets !== null, ErrorCode.InvariantViolation, 'renderShowcase() requires initAssets()');
    this.clearShowcase();
    this.releaseAllGadgetProps();
    this.vfx.clear();

    if (kind === 'fighter') {
      const fighterId = id as FighterId;
      getFighterSpec(fighterId);
      const pal = getGameData().palette;
      const liveryHex = pal.players[fighterId % pal.players.length]!.hex;

      this.worldGroup.visible = false;
      this.showcaseGroup.visible = true;
      if (this.localMarkerMesh) this.localMarkerMesh.visible = false;

      // Bone saucer plinth with gilt rim
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(1.55, 1.32, 0.22, 24),
        createGlazeMaterial({
          matcap: this.assets.matcap,
          usePaletteAttr: false,
          baseColor: hexToLinearVec3(pal.neutrals['bone']!),
          gloss: 1.0,
          sheen: 0.4,
        }),
      );
      plinth.position.set(0, -0.11, 0);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.54, 0.05, 6, 24),
        createGlazeMaterial({
          matcap: this.assets.matcap,
          usePaletteAttr: false,
          baseColor: hexToLinearVec3(pal.accents['gilt']!),
          gloss: 0.9,
          sheen: 0.6,
          metal: 1.0,
          speckle: 0.0,
        }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.01;
      this.showcaseGroup.add(plinth, rim);

      const inst = instantiateFighterRig(this.assets, fighterId, liveryHex, GlazeFinish.Standard);
      inst.group.position.set(0, 0, 0);
      inst.group.rotation.y = FACING_RIGHT_YAW;
      inst.group.scale.setScalar(inst.scale);
      this.showcaseGroup.add(inst.group);

      this.camera.fov = 28;
      this.camera.position.set(0.45, 1.45, 5.4);
      this.camera.lookAt(0, 0.85, 0);
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (kind === 'arena') {
      const arenaId = id as ArenaId;
      const spec = getArenaSpec(arenaId);
      this.worldGroup.visible = true;
      this.showcaseGroup.visible = false;
      this.syncArena(arenaId);
      for (const c of this.cloudMeshes) c.visible = true;
      for (const rig of this.fighterRigs.values()) rig.group.visible = false;
      for (let i = 0; i < spec.chunks.length; i++) {
        const ch = spec.chunks[i]!;
        const [cx, cy] = polygonCentroid(ch.poly);
        const mesh = this.chunkMeshes[i];
        if (!mesh) continue;
        mesh.visible = true;
        mesh.position.set(cx, cy, 0);
        mesh.rotation.z = 0;
        const mat = mesh.material as GlazeMaterial;
        mat.uniforms.uGlazeTint.value.copy(this.whiteGlazeTint);
        mat.uniforms.uSpeckle.value = 0.7;
        mat.uniforms.uCrack.value = arenaId === ArenaId.MendedBowl ? 0.85 : 0.0;
        mat.uniforms.uKintsugi.value = arenaId === ArenaId.MendedBowl ? 1.0 : 0.0;
      }
      if (this.lobbyPlatter) this.lobbyPlatter.visible = arenaId === ArenaId.Saucer;
      if (this.localMarkerMesh) this.localMarkerMesh.visible = false;
      if (this.rubbleMesh) this.rubbleMesh.count = 0;
      if (this.projectileMesh) this.projectileMesh.count = 0;
      if (this.hazardMesh) this.hazardMesh.count = 0;

      const lookY = arenaId === ArenaId.HighTea ? 3.8 : 1.4;
      const distZ = arenaId === ArenaId.Saucer ? 20 : 28;
      this.camera.fov = getGameData().tuning.camera.fovDeg;
      this.camera.position.set(0, lookY + 4.5, distZ);
      this.camera.lookAt(0, lookY, 0);
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    throw new InvariantError(ErrorCode.InvalidEnumValue, `Unknown showcase kind: ${String(kind)}`);
  }

  public getRenderStats(): { drawCalls: number; triangles: number; gpu: string } {
    const info = this.renderer.info.render;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    return { drawCalls: info.calls, triangles: info.triangles, gpu };
  }

  public dispose(): void {
    this.clearShowcase();
    this.releaseAllGadgetProps();
    while (this.gadgetPool.length > 0) {
      const prop = this.gadgetPool.pop()!;
      this.worldGroup.remove(prop.group);
      disposeObjectTree(prop.group);
    }
    for (const rig of this.fighterRigs.values()) this.disposeRig(rig);
    this.fighterRigs.clear();
    this.clearArenaMeshes();
    for (const c of this.cloudMeshes) {
      this.scene.remove(c);
      disposeObjectTree(c);
    }
    this.cloudMeshes.length = 0;
    if (this.rubbleMesh) disposeObjectTree(this.rubbleMesh);
    if (this.projectileMesh) disposeObjectTree(this.projectileMesh);
    if (this.hazardMesh) disposeObjectTree(this.hazardMesh);
    if (this.lobbyPlatter) disposeObjectTree(this.lobbyPlatter);
    if (this.localMarkerMesh) disposeObjectTree(this.localMarkerMesh);
    this.skyTexture?.dispose();
    if (this.assets) {
      this.assets.matcap.dispose();
      for (const gltf of this.assets.fighters.values()) disposeObjectTree(gltf.scene);
      this.assets = null;
    }
    this.vfx.dispose();
    this.renderer.dispose();
  }
}
