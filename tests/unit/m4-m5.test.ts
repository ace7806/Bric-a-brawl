import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { getElementalFighter } from '@client/elemental-roster';
import {
  applyElementalFinish,
  createElementalToonMaterial,
  ensureSmoothOutlineNormals,
  getFallbackBlackTexture,
  getFallbackWhiteTexture,
} from '@client/elemental-toon-material';
import { GlazeFinish, KeyAction } from '@client/enums';
import { applyGlazeFinish, buildFighterPalette, createGlazeMaterial, hexToLinearVec3 } from '@client/glaze-material';
import { formatKeyCode, InputCollector } from '@client/input';
import {
  applyElementalPose,
  createFighterAnimRuntime,
  moveIdToClipName,
  selectElementalClip,
  type ElementalFighterRig,
} from '@client/poses';
import {
  ALL_APPRAISAL_IDS, APPRAISAL_SPECS, AppraisalId, DEFAULT_LOT_NAMES, PROFILE_STORAGE_KEY,
  ROOM_ADJECTIVES, ROOM_SUFFIXES, ROOM_VESSELS, createDefaultPlayerProfile, evaluateRoundProgression,
  generateAppraisalLine, generateCeramicRoomCode, loadPlayerProfile, pickDefaultLotName,
  savePlayerProfile, type RoundTelemetryForAppraisal,
} from '@client/progression';
import type { SnapshotFighter } from '@net/codec';
import { getFighterSpec } from '@sim/data';
import { ALL_FIGHTER_IDS, FighterFlag, FighterId, FighterState, GadgetId, InputBit, InputDir, KoCause, MoveId, NestaSize } from '@sim/enums';
import { decodeInputDir } from '@sim/input';

function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, val) => { map.set(k, val); },
  };
}

const baseTelemetry = (over: Partial<RoundTelemetryForAppraisal> = {}): RoundTelemetryForAppraisal => ({
  fighterId: FighterId.Earl, won: false, kos: 0, damageTaken: 10, peakDamage: 10,
  attacksLanded: 1, parriesLanded: 0, chunksShattered: 0, chunksRemaining: 4,
  fighterCount: 4, fragileMode: false, sessionWon: false,
  selfKoByCork: false, parriedParriedCork: false, teaspoonFinalTap: false, exitCause: null,
  ...over,
});

const ALL_CLIP_NAMES = [
  'Idle', 'Walk', 'Run', 'Dash', 'Skid', 'JumpSquat', 'Jump', 'Fall', 'LandingLag',
  'Guard', 'Hitstun', 'Tumble', 'Roll', 'SpotDodge', 'AirDodge', 'ChaseDodge',
  'LedgeHang', 'LedgeGetup', 'ChargingHeavy', 'LedgeAtk',
  'Jab1', 'Jab2', 'Jab3', 'Ftilt', 'Utilt', 'Dtilt', 'DashAtk',
  'Fheavy', 'Uheavy', 'Dheavy', 'Nair', 'Fair', 'Bair', 'Uair', 'Dair',
  'Grab', 'Fthrow', 'Bthrow', 'Uthrow', 'Dthrow', 'Nspec', 'Sspec', 'Uspec', 'Dspec',
] as const;

function makeElementalRig(fighterId: FighterId): ElementalFighterRig {
  const fxGroup = new THREE.Group();
  const modelGroup = new THREE.Group();
  fxGroup.add(modelGroup);
  const rootBone = new THREE.Bone();
  rootBone.name = 'Root';
  modelGroup.add(rootBone);
  const skinnedMesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.2, 0.4), new THREE.MeshBasicMaterial());
  modelGroup.add(skinnedMesh);

  const mixer = new THREE.AnimationMixer(modelGroup);
  const clips = new Map<string, THREE.AnimationClip>();
  const actions = new Map<string, THREE.AnimationAction>();
  for (const name of ALL_CLIP_NAMES) {
    const track = new THREE.VectorKeyframeTrack('Root.position', [0, 0.6], [0, 0, 0, 0, 0.1, 0]);
    clips.set(name, new THREE.AnimationClip(name, 0.6, [track]));
  }
  return {
    fighterId,
    fxGroup,
    modelGroup,
    mixer,
    clips,
    actions,
    skinnedMesh,
    outlineMesh: null,
    rootBone,
    handR: null,
    handL: null,
    weaponR: null,
    headBone: null,
    activeActionName: null,
    activeAction: null,
    lastEvalFrame: -1,
  };
}

const makeSnap = (over: Partial<SnapshotFighter> = {}): SnapshotFighter => ({
  slot: 0, x: 0, y: 0, vx: 3.5, vy: 1.5,
  state: FighterState.Idle, stateFrame: 6, activeMove: MoveId.None,
  flags: FighterFlag.Grounded | FighterFlag.FacingRight,
  damage: 25, guardHp: 100, gilt: 40, stocks: 3,
  heldGadget: GadgetId.None, heldGadgetAmmo: 0, nestaSize: NestaSize.Big, hitstopFrames: 4,
  ...over,
});

const expectFiniteVec3 = (v: THREE.Vector3): void => {
  expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
};

describe('M5 progression & appraisals (src/client/progression.ts)', () => {
  it('provides 64x64x64 room word lists, deterministic codes, and 32 indexed lot names', () => {
    expect(ROOM_ADJECTIVES).toHaveLength(64);
    expect(ROOM_VESSELS).toHaveLength(64);
    expect(ROOM_SUFFIXES).toHaveLength(64);
    expect(ROOM_ADJECTIVES.length * ROOM_VESSELS.length * ROOM_SUFFIXES.length).toBe(262_144);

    const vals = [0.0, 0.5, 0.99];
    let idx = 0;
    const c1 = generateCeramicRoomCode(() => vals[idx++ % 3]!);
    idx = 0;
    expect(c1).toBe(generateCeramicRoomCode(() => vals[idx++ % 3]!));
    expect(c1).toBe(`${ROOM_ADJECTIVES[0]}-${ROOM_VESSELS[32]}-${ROOM_SUFFIXES[63]}`);

    expect(DEFAULT_LOT_NAMES).toHaveLength(32);
    expect(pickDefaultLotName(0)).toBe(DEFAULT_LOT_NAMES[0]);
    expect(pickDefaultLotName(33)).toBe(DEFAULT_LOT_NAMES[1]);
    expect(pickDefaultLotName(-1)).toBe(DEFAULT_LOT_NAMES[31]);
  });

  it('round-trips PlayerProfile through Storage and resets on corrupt JSON or invalid schema', () => {
    const store = makeStorageStub();
    const custom = {
      ...createDefaultPlayerProfile(),
      lotName: 'Spode-42', lastFighter: FighterId.Moss, equippedFinish: GlazeFinish.Kintsugi,
      keyBindings: { [KeyAction.Jump]: 'Space' }, unlockedAppraisals: [AppraisalId.PacifistWin],
    };
    savePlayerProfile(custom, store);
    expect(loadPlayerProfile(store)).toEqual(custom);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.setItem(PROFILE_STORAGE_KEY, '{not-json');
    expect(loadPlayerProfile(store)).toEqual(createDefaultPlayerProfile());
    store.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ ...custom, volumeMaster: 2.5, lastFighter: 99 }));
    expect(loadPlayerProfile(store)).toEqual(createDefaultPlayerProfile());
    warn.mockRestore();
  });

  const appraisalCases: readonly [AppraisalId, Partial<RoundTelemetryForAppraisal>][] = [
    [AppraisalId.PacifistWin, { won: true, attacksLanded: 0 }],
    [AppraisalId.CorkSelfKo, { selfKoByCork: true }],
    [AppraisalId.ParryParriedCork, { parriedParriedCork: true }],
    [AppraisalId.TeaspoonFinalTap, { teaspoonFinalTap: true }],
    [AppraisalId.FragileSurvivor, { won: true, fragileMode: true }],
    [AppraisalId.TripleParry, { parriesLanded: 3 }],
    [AppraisalId.IslandCrusher, { chunksShattered: 4 }],
    [AppraisalId.LastChunkStanding, { won: true, chunksRemaining: 1 }],
    [AppraisalId.HatTrick, { kos: 3 }],
    [AppraisalId.ComebackGilt, { won: true, peakDamage: 120 }],
    [AppraisalId.SessionChampion, { sessionWon: true }],
    [AppraisalId.FullHouseBrawl, { fighterCount: 6 }],
  ];

  it.each(appraisalCases)('unlocks AppraisalId %i once and never double-unlocks', (id, override) => {
    const tel = baseTelemetry(override);
    const first = evaluateRoundProgression(createDefaultPlayerProfile(), tel);
    expect(first.newlyUnlocked).toEqual([id]);
    expect(first.profile.unlockedAppraisals).toEqual([id]);
    const repeat = evaluateRoundProgression(first.profile, tel);
    expect(repeat.newlyUnlocked).toEqual([]);
    expect(repeat.profile.unlockedAppraisals).toEqual([id]);
  });

  it('tracks fighter provenance, maps 12 appraisals to distinct GlazeFinishes, and generates lines', () => {
    const rewards = ALL_APPRAISAL_IDS.map((id) => APPRAISAL_SPECS[id].reward);
    expect(new Set(rewards).size).toBe(12);
    expect(rewards.every((r) => r >= GlazeFinish.Crackle && r <= GlazeFinish.RoyalGilt)).toBe(true);

    const r1 = evaluateRoundProgression(createDefaultPlayerProfile(), baseTelemetry({ fighterId: FighterId.Grog, won: true, kos: 2 }));
    const r2 = evaluateRoundProgression(r1.profile, baseTelemetry({ fighterId: FighterId.Grog, won: false, kos: 1, exitCause: KoCause.FallingChunk }));
    expect(r2.profile.provenance[FighterId.Grog]).toEqual({
      roundsPlayed: 2, wins: 1, kos: 3, mostEmbarrassingExit: 'Rode a doomed shard into the abyss',
    });

    const lines = [
      generateAppraisalLine(FighterId.Earl, 0, 40, true, null),
      generateAppraisalLine(FighterId.Moss, 3, 130, true, null),
      generateAppraisalLine(FighterId.Grog, 1, 95, false, KoCause.FighterMove),
      generateAppraisalLine(FighterId.Nesta, 0, 55, false, KoCause.SelfDestruct),
      generateAppraisalLine(FighterId.Earl, 2, 110, false, null),
    ];
    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0);
  });
});

describe('M4 GlazeMaterial & ElementalToonMaterial shaders', () => {
  it('converts sRGB hex colors accurately to linear Vec3 [0..1]', () => {
    expect(hexToLinearVec3('#000000').toArray()).toEqual([0, 0, 0]);
    const white = hexToLinearVec3('#FFFFFF');
    expect(white.x).toBeCloseTo(1, 5);
    expect(white.y).toBeCloseTo(1, 5);
    expect(white.z).toBeCloseTo(1, 5);
    const cobalt = hexToLinearVec3('#24459A');
    expect(cobalt.x).toBeCloseTo(0.01764, 4);
    expect(cobalt.y).toBeCloseTo(0.05951, 4);
    expect(cobalt.z).toBeCloseTo(0.32314, 4);
  });

  it.each(ALL_FIGHTER_IDS)('builds 16 finite palette slots for FighterId %i with livery at slot 2', (fid) => {
    const pal = buildFighterPalette(fid, '#E3A72F');
    expect(pal).toHaveLength(16);
    for (const v of pal) {
      expect(v).toBeInstanceOf(THREE.Vector3);
      expectFiniteVec3(v);
    }
    expect(pal[2]!.distanceTo(hexToLinearVec3('#E3A72F'))).toBeLessThan(1e-6);
  });

  it('applies all 13 GlazeFinish presets with finite shader uniforms on GlazeMaterial and ElementalToonMaterial', () => {
    const mat = createGlazeMaterial({ matcap: new THREE.Texture(), usePaletteAttr: true });
    const toonMat = createElementalToonMaterial({
      albedoMap: getFallbackWhiteTexture(),
      emissiveMap: getFallbackBlackTexture(),
    });
    const finishes = Object.values(GlazeFinish).filter((v): v is GlazeFinish => typeof v === 'number');
    expect(finishes).toHaveLength(13);
    for (const finish of finishes) {
      applyGlazeFinish(mat, finish);
      const u = mat.uniforms;
      for (const val of [u.uCrack.value, u.uGilt.value, u.uLustre.value, u.uMatte.value, u.uSpeckle.value, u.uKintsugi.value]) {
        expect(Number.isFinite(val)).toBe(true);
      }
      expectFiniteVec3(u.uGlazeTint.value);

      applyElementalFinish(toonMat, finish);
      const tu = toonMat.uniforms;
      for (const val of [tu.uCrack.value, tu.uGilt.value, tu.uLustre.value, tu.uMatte.value, tu.uKintsugi.value]) {
        expect(Number.isFinite(val)).toBe(true);
      }
      expectFiniteVec3(tu.uGlazeTint.value);
    }
  });

  it('computes unit-length averaged smooth outline normals across hard-creased corners', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    ensureSmoothOutlineNormals(box);
    const attr = box.getAttribute('aSmoothNormal') as THREE.BufferAttribute;
    expect(attr).toBeDefined();
    expect(attr.count).toBe(box.getAttribute('position').count);
    for (let i = 0; i < attr.count; i++) {
      const nx = attr.getX(i);
      const ny = attr.getY(i);
      const nz = attr.getZ(i);
      const len = Math.hypot(nx, ny, nz);
      expect(len).toBeCloseTo(1, 4);
      // Every box corner normal averages 3 orthogonal face normals -> |component| = 1/sqrt(3)
      expect(Math.abs(nx)).toBeCloseTo(Math.SQRT1_2 * Math.sqrt(2 / 3), 3);
    }
  });
});

describe('Elemental 60fps skeletal pose engine & Gate V4 clip coverage (src/client/poses.ts)', () => {
  const states: readonly FighterState[] = [
    FighterState.Idle, FighterState.Walk, FighterState.Run, FighterState.Dash, FighterState.Skid,
    FighterState.JumpSquat, FighterState.Airborne, FighterState.LandingLag, FighterState.Attack,
    FighterState.ChargingHeavy, FighterState.Guard, FighterState.Parry, FighterState.Hitstun,
    FighterState.Tumble, FighterState.Roll, FighterState.SpotDodge, FighterState.AirDodge,
    FighterState.Grabbing, FighterState.LedgeHang, FighterState.LedgeGetup, FighterState.Helpless,
  ];
  const moves: readonly MoveId[] = Object.values(MoveId).filter((v): v is MoveId => typeof v === 'number' && v !== MoveId.None);

  it.each(ALL_FIGHTER_IDS)('applies finite rig transforms for FighterId %i across all states, moves, and hitstop', (fid) => {
    const rig = makeElementalRig(fid);
    const anim = createFighterAnimRuntime(fid);

    for (const state of states) {
      for (const activeMove of state === FighterState.Attack ? moves : [MoveId.None]) {
        for (const hitstop of [false, true]) {
          applyElementalPose(rig, anim, makeSnap({ state, activeMove }), 1 / 60, 1.25, state !== FighterState.Tumble, state !== FighterState.Airborne, hitstop);
          expectFiniteVec3(rig.fxGroup.position);
          expectFiniteVec3(rig.fxGroup.scale);
          expect(Number.isFinite(rig.modelGroup.rotation.y)).toBe(true);
          expect(rig.activeActionName).not.toBeNull();
        }
      }
    }
  });

  it.each(ALL_FIGHTER_IDS)('Gate V4: exported GLB manifest & binary for Elemental Fighter %i has 100% clip coverage and exact 60fps sim-tick timing', (fid) => {
    const elem = getElementalFighter(fid);
    const metaPath = resolve(import.meta.dirname, '../../public/assets', `${elem.slug}.json`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { clips: readonly string[] };
    const clipSet = new Set(meta.clips);

    for (const moveId of moves) {
      const clipName = moveIdToClipName(moveId);
      expect(clipSet.has(clipName), `${elem.slug}.json missing MoveId clip "${clipName}"`).toBe(true);
    }

    const stateSnapshots: readonly SnapshotFighter[] = [
      ...states.map((state) => makeSnap({ state, activeMove: state === FighterState.Attack ? MoveId.Fheavy : MoveId.None, vy: 2.0, vx: 2.0 })),
      makeSnap({ state: FighterState.Airborne, vy: -3.0 }),
      makeSnap({ state: FighterState.AirDodge, vx: 16.0, vy: 0 }),
    ];
    for (const snap of stateSnapshots) {
      const sel = selectElementalClip(snap, 0.25);
      expect(clipSet.has(sel.clipName), `${elem.slug}.json missing state clip "${sel.clipName}" (state=${snap.state})`).toBe(true);
    }

    // Parse binary GLB JSON chunk and assert Fheavy clip duration matches 60fps sim total frames
    const glbBuf = readFileSync(resolve(import.meta.dirname, '../../public/assets', `${elem.slug}.glb`));
    const jsonLen = glbBuf.readUInt32LE(12);
    const gltf = JSON.parse(glbBuf.subarray(20, 20 + jsonLen).toString('utf8')) as {
      animations: { name: string; samplers: { input: number }[] }[];
      accessors: { max: number[] }[];
    };
    const fhAnim = gltf.animations.find((a) => a.name === 'Fheavy');
    expect(fhAnim).toBeDefined();
    const fhMaxSec = Math.max(...fhAnim!.samplers.map((s) => gltf.accessors[s.input]!.max[0]!));
    const expectedSec = getFighterSpec(fid).moves.get(MoveId.Fheavy)!.total / 60;
    expect(fhMaxSec).toBeCloseTo(expectedSec, 2);
  });
});

describe('Mobile virtual touch controls & human key formatting (src/client/input.ts)', () => {
  it('formats KeyboardEvent.code strings into clean human key labels', () => {
    expect(formatKeyCode('KeyJ')).toBe('J');
    expect(formatKeyCode('Digit4')).toBe('4');
    expect(formatKeyCode('ShiftLeft')).toBe('Shift');
    expect(formatKeyCode('ArrowLeft')).toBe('←');
    expect(formatKeyCode('ArrowRight')).toBe('→');
    expect(formatKeyCode('Space')).toBe('Space');
    expect(formatKeyCode('Escape')).toBe('Esc');
  });

  it('merges virtual touch stick direction, tilt, action bits, and clears cleanly', () => {
    const collector = new InputCollector(makeStorageStub());
    expect(collector.pollMask()).toBe(0);

    collector.setTouchStick(InputDir.UpRight, true);
    collector.setTouchBit(InputBit.Attack, true);
    collector.setTouchBit(InputBit.Jump, true);
    const mask = collector.pollMask();
    expect(decodeInputDir(mask)).toBe(InputDir.UpRight);
    expect((mask & InputBit.Tilt) !== 0).toBe(true);
    expect((mask & InputBit.Attack) !== 0).toBe(true);
    expect((mask & InputBit.Jump) !== 0).toBe(true);

    collector.setTouchBit(InputBit.Attack, false);
    const mask2 = collector.pollMask();
    expect((mask2 & InputBit.Attack) !== 0).toBe(false);
    expect((mask2 & InputBit.Jump) !== 0).toBe(true);

    collector.clearTouch();
    expect(collector.pollMask()).toBe(0);
  });
});
