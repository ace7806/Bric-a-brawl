import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GlazeFinish, KeyAction } from '@client/enums';
import { applyGlazeFinish, buildFighterPalette, createGlazeMaterial, hexToLinearVec3 } from '@client/glaze-material';
import { formatKeyCode, InputCollector } from '@client/input';
import { applyFighterPose, createFighterAnimRuntime, type BoneSlot, type FighterBoneRig } from '@client/poses';
import {
  ALL_APPRAISAL_IDS, APPRAISAL_SPECS, AppraisalId, DEFAULT_LOT_NAMES, PROFILE_STORAGE_KEY,
  ROOM_ADJECTIVES, ROOM_SUFFIXES, ROOM_VESSELS, createDefaultPlayerProfile, evaluateRoundProgression,
  generateAppraisalLine, generateCeramicRoomCode, loadPlayerProfile, pickDefaultLotName,
  savePlayerProfile, type RoundTelemetryForAppraisal,
} from '@client/progression';
import type { SnapshotFighter } from '@net/codec';
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

function makeSlot(y = 0): BoneSlot {
  const bone = new THREE.Bone();
  bone.position.set(0, y, 0);
  return { bone, restPos: bone.position.clone(), restQuat: bone.quaternion.clone() };
}

const makeRig = (fighterId: FighterId): FighterBoneRig => ({
  fighterId, body: makeSlot(0.5),
  lid: makeSlot(0.9), head: makeSlot(0.8), hat: makeSlot(1.1), rod: makeSlot(0.6),
  handF: makeSlot(0.4), handB: makeSlot(0.4), footF: makeSlot(0), footB: makeSlot(0),
  hoofFL: makeSlot(0), hoofFR: makeSlot(0), hoofBL: makeSlot(0), hoofBR: makeSlot(0),
});

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

describe('M4 GlazeMaterial math & palettes (src/client/glaze-material.ts)', () => {
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

  it('applies all 13 GlazeFinish presets with finite shader uniforms', () => {
    const mat = createGlazeMaterial({ matcap: new THREE.Texture(), usePaletteAttr: true });
    const finishes = Object.values(GlazeFinish).filter((v): v is GlazeFinish => typeof v === 'number');
    expect(finishes).toHaveLength(13);
    for (const finish of finishes) {
      applyGlazeFinish(mat, finish);
      const u = mat.uniforms;
      for (const val of [u.uCrack.value, u.uGilt.value, u.uLustre.value, u.uMatte.value, u.uSpeckle.value, u.uKintsugi.value]) {
        expect(Number.isFinite(val)).toBe(true);
      }
      expectFiniteVec3(u.uGlazeTint.value);
    }
  });
});

describe('M4 procedural pose tables & 6 life layers (src/client/poses.ts)', () => {
  const states: readonly FighterState[] = [
    FighterState.Idle, FighterState.Run, FighterState.JumpSquat, FighterState.Airborne,
    FighterState.Attack, FighterState.Guard, FighterState.Parry, FighterState.Tumble, FighterState.LedgeHang,
  ];
  const moves: readonly MoveId[] = [MoveId.Jab1, MoveId.Fheavy, MoveId.Uspec, MoveId.Sspec, MoveId.Dspec, MoveId.Nspec];

  it.each(ALL_FIGHTER_IDS)('applies finite bone transforms for FighterId %i across states, moves, and hitstop', (fid) => {
    const rig = makeRig(fid);
    const anim = createFighterAnimRuntime(fid);
    const slots = [rig.body, rig.lid!, rig.head!, rig.hat!, rig.rod!, rig.handF!, rig.handB!, rig.footF!, rig.footB!, rig.hoofFL!, rig.hoofFR!, rig.hoofBL!, rig.hoofBR!];

    for (const state of states) {
      for (const activeMove of state === FighterState.Attack ? moves : [MoveId.None]) {
        for (const hitstop of [false, true]) {
          applyFighterPose(rig, anim, makeSnap({ state, activeMove }), 1 / 60, 1.25, state !== FighterState.Tumble, state !== FighterState.Airborne, hitstop);
          expectFiniteVec3(rig.body.bone.scale);
          for (const s of slots) {
            expectFiniteVec3(s.bone.position);
            const q = s.bone.quaternion;
            expect(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)).toBe(true);
          }
        }
      }
    }
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
