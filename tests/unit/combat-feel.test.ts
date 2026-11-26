import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSlashForMove,
  classifyHitImpact,
  computeHitContactPoint,
  HitTier,
  selectSwingSound,
} from '@client/combat-feel';
import { getElementalFighter } from '@client/elemental-roster';
import { SoundId } from '@client/enums';
import { InputCollector } from '@client/input';
import {
  applyElementalPose,
  createFighterAnimRuntime,
  FACING_LEFT_YAW,
  FACING_RIGHT_YAW,
  type ElementalFighterRig,
} from '@client/poses';
import { HostSimulation } from '@host/engine';
import type { SnapshotData, SnapshotFighter } from '@net/codec';
import { RemoteInterpolator } from '@net/sync';
import { AUTO_CANCEL_LANDING_LAG, SDI_NUDGE_DISTANCE } from '@sim/combat-kinematics';
import { getFighterSpec } from '@sim/data';
import {
  ALL_FIGHTER_IDS,
  ArenaId,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  InputBit,
  InputDir,
  MatchMode,
  MoveId,
  NestaSize,
  SimEventKind,
  TeamId,
} from '@sim/enums';
import { createFighter } from '@sim/fighter';
import { encodeInputMask } from '@sim/input';
import { tape } from '../support/inputs';
import { createMatch, disposeAllWorlds, ensurePhysics, positionPair, runTape } from '../support/world';

const TEST_CLIP_NAMES = [
  'Idle', 'Run', 'Jump', 'Fall', 'LandingLag', 'ChargingHeavy', 'Hitstun', 'Tumble',
  'Jab1', 'Jab2', 'Jab3', 'Ftilt', 'Fheavy', 'Uspec',
] as const;

function makeTestRig(fighterId: FighterId): ElementalFighterRig {
  const fxGroup = new THREE.Group();
  const modelGroup = new THREE.Group();
  fxGroup.add(modelGroup);
  const rootBone = new THREE.Bone();
  rootBone.name = 'Root';
  modelGroup.add(rootBone);
  const skinnedMesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), new THREE.MeshBasicMaterial());
  modelGroup.add(skinnedMesh);

  const mixer = new THREE.AnimationMixer(modelGroup);
  const clips = new Map<string, THREE.AnimationClip>();
  const actions = new Map<string, THREE.AnimationAction>();
  for (const name of TEST_CLIP_NAMES) {
    const track = new THREE.VectorKeyframeTrack('Root.position', [0, 1.0], [0, 0, 0, 0, 0.25, 0]);
    clips.set(name, new THREE.AnimationClip(name, 1.0, [track]));
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

function makeSnap(over: Partial<SnapshotFighter> = {}): SnapshotFighter {
  return {
    slot: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    state: FighterState.Idle,
    stateFrame: 0,
    activeMove: MoveId.None,
    flags: FighterFlag.Grounded | FighterFlag.FacingRight,
    damage: 30,
    guardHp: 50,
    gilt: 20,
    stocks: 3,
    heldGadget: GadgetId.None,
    heldGadgetAmmo: 0,
    nestaSize: NestaSize.Mid,
    hitstopFrames: 0,
    ...over,
  };
}

describe('Smash Game Feel — Input Responsiveness, Sim Combat & Hitstop Sync', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it('Gate F2: InputCollector latches brief sub-frame touch taps so pollMask never drops them', () => {
    const collector = new InputCollector(null);
    collector.setTouchStick(InputDir.Right, false);
    collector.setTouchBit(InputBit.Attack, true);
    // Simulate tap release BEFORE pollMask runs on next rAF
    collector.setTouchBit(InputBit.Attack, false);
    collector.setTouchStick(InputDir.Neutral, false);

    const m1 = collector.pollMask();
    expect((m1 & InputBit.Attack) !== 0).toBe(true);
    expect((m1 & InputBit.DirMask) === InputDir.Right).toBe(true);
    // Latch clears after consumption
    expect(collector.pollMask()).toBe(0);
  });

  it('Gate F1/F2: HostSimulation queues rapid local taps and emits 60Hz local snapshots while keeping 30Hz wire broadcasts', () => {
    const host = new HostSimulation({
      match: {
        arenaId: ArenaId.Willow,
        mode: MatchMode.FreeForAll,
        fragile: false,
        seed: 42,
        fighters: [
          { slot: 0, id: FighterId.Earl, team: TeamId.None },
          { slot: 1, id: FighterId.Grog, team: TeamId.None },
        ],
      },
      localSlot: 0,
      bots: {},
      emitLocalEveryTick: true,
    });
    try {
      positionPair(host.world, 0, 3.0);
      // Main thread sends Attack press then immediate release BEFORE worker tick executes
      host.setLocalInput(0, encodeInputMask(InputDir.Right, InputBit.Attack));
      host.setLocalInput(0, 0);

      const out1 = host.stepTick();
      expect(host.world.fighters[0]!.state).toBe(FighterState.Attack);
      expect(host.world.fighters[0]!.activeMove).toBe(MoveId.Ftilt);
      // Tick 1 is odd -> no 30Hz network broadcast, but 60Hz localSnapshotBytes IS emitted!
      expect(out1.snapshotBytes).toBeNull();
      expect(out1.localSnapshotBytes).not.toBeNull();

      const out2 = host.stepTick();
      // Tick 2 is even -> 30Hz network broadcast emitted, localSnapshotBytes is null
      expect(out2.snapshotBytes).not.toBeNull();
      expect(out2.localSnapshotBytes).toBeNull();
    } finally {
      host.dispose();
    }
  });

  it('Gate F3 (Hitstop Sync): RemoteInterpolator propagates hitstopFrames, freezes stateFrame during hitstop, and supports 0ms local host delay', () => {
    const interp = new RemoteInterpolator(0);
    expect(interp.getInterpDelayMs()).toBe(0);

    const snap: SnapshotData = {
      tick: 50,
      epoch: 0,
      lastAppliedInputTicks: [50, 50],
      fighters: [
        makeSnap({ slot: 0, state: FighterState.Attack, stateFrame: 8, activeMove: MoveId.Fheavy, hitstopFrames: 6 }),
        makeSnap({ slot: 1, x: 1.5, state: FighterState.Tumble, stateFrame: 1, hitstopFrames: 6 }),
      ],
      projectiles: [],
      chunks: [],
      rubble: [],
      gadgets: [],
      hasWorld: false,
    };
    interp.pushSnapshot(snap, 1000);

    // 2 ticks later (still inside 6f hitstop): hitstopFrames decrements to 4, stateFrame stays frozen!
    const sampledFrozen = interp.sample(1033, 52);
    expect(sampledFrozen.fighters[0]!.hitstopFrames).toBe(4);
    expect(sampledFrozen.fighters[0]!.stateFrame).toBe(8);
    expect(sampledFrozen.fighters[0]!.moveFrame).toBe(8);
    expect(sampledFrozen.fighters[1]!.hitstopFrames).toBe(4);
    expect(sampledFrozen.fighters[1]!.stateFrame).toBe(1);

    // 8 ticks later (past 6f hitstop): hitstop reaches 0 and pose resumes advancing by 2 frames
    const sampledAfter = interp.sample(1133, 58);
    expect(sampledAfter.fighters[0]!.hitstopFrames).toBe(0);
    expect(sampledAfter.fighters[0]!.stateFrame).toBe(10);
  });

  it('Gate F5 (Jab Mash Regression): mashing Attack connects Jab1 -> Jab2 -> Jab3 instead of deleting Jab1/Jab2 hitboxes', () => {
    const world = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Grog, team: TeamId.None },
      ],
    });
    positionPair(world, 0, 1.05);

    // Human-like Attack mashing every 3 ticks
    const mashTape = tape()
      .tap(InputDir.Neutral, InputBit.Attack)
      .wait(2)
      .tap(InputDir.Neutral, InputBit.Attack)
      .wait(5)
      .tap(InputDir.Neutral, InputBit.Attack)
      .wait(8)
      .tap(InputDir.Neutral, InputBit.Attack)
      .build();

    const events = runTape(world, [mashTape, []], 45);
    const hitMoves = events.filter((e) => e.kind === SimEventKind.Hit && e.a === 0 && e.b === 1).map((e) => e.d as MoveId);
    expect(hitMoves).toContain(MoveId.Jab1);
    expect(hitMoves).toContain(MoveId.Jab2);
    expect(hitMoves).toContain(MoveId.Jab3);
  });

  it('Gate F5 (Airborne Heavy / C-Stick): pressing Heavy in midair executes directional aerials', () => {
    const cases: readonly [InputDir, MoveId][] = [
      [InputDir.Right, MoveId.Fair],
      [InputDir.Left, MoveId.Bair],
      [InputDir.Up, MoveId.Uair],
      [InputDir.Down, MoveId.Dair],
      [InputDir.Neutral, MoveId.Nair],
    ];
    for (const [dir, expectedMove] of cases) {
      const world = createMatch();
      const f = world.fighters[0]!;
      f.y = 3.5;
      f.flags = FighterFlag.FacingRight; // airborne, facing right
      f.state = FighterState.Airborne;
      runTape(world, [tape().tap(dir, InputBit.Heavy).build(), []], 2);
      expect(f.state).toBe(FighterState.Attack);
      expect(f.activeMove).toBe(expectedMove);
    }
  });

  it('Gate F5 (Buffered Short-Hop Aerial): tapping Attack during JumpSquat fires rising short-hop aerial on takeoff', () => {
    const world = createMatch();
    positionPair(world, 0, 4.0);
    const f = world.fighters[0]!;
    // Tick 0: tap Jump -> enters JumpSquat. Tick 1: tap Right+Attack (released before JumpSquat ends on tick 3!)
    const t = tape().tap(InputDir.Neutral, InputBit.Jump).tap(InputDir.Right, InputBit.Attack).build();
    runTape(world, [t, []], 5);
    expect(f.state).toBe(FighterState.Attack);
    expect(f.activeMove).toBe(MoveId.Fair);
    expect((f.flags & FighterFlag.Grounded) === 0).toBe(true);
  });

  it('Gate F5 (Turnaround, Ground Momentum Slide & Utilt Coverage): diagonal aim flips facing, running tilts slide, Utilt hits melee foes', () => {
    // Diagonal facing turnaround on DownLeft + Attack
    const w1 = createMatch();
    positionPair(w1, 0, 4.0);
    const f1 = w1.fighters[0]!;
    expect((f1.flags & FighterFlag.FacingRight) !== 0).toBe(true);
    runTape(w1, [tape().tap(InputDir.DownLeft, InputBit.Attack).build(), []], 2);
    expect((f1.flags & FighterFlag.FacingRight) === 0).toBe(true);
    expect(f1.activeMove).toBe(MoveId.Dtilt);

    // Running into Ftilt preserves partial sliding momentum instead of brick-wall zeroing vx
    const w2 = createMatch();
    positionPair(w2, -2, 4.0);
    const f2 = w2.fighters[0]!;
    f2.state = FighterState.Walk;
    f2.vx = 6.0;
    runTape(w2, [tape().tap(InputDir.Right, InputBit.Attack).build(), []], 1);
    expect(f2.activeMove).toBe(MoveId.Ftilt);
    expect(f2.vx).toBeGreaterThan(1.5);

    // Utilt connects cleanly against an adjacent grounded opponent right in front
    const w3 = createMatch();
    positionPair(w3, 0, 1.05);
    const evs = runTape(w3, [tape().tap(InputDir.Up, InputBit.Attack).build(), []], 14);
    expect(evs.some((e) => e.kind === SimEventKind.Hit && e.a === 0 && e.b === 1 && e.d === MoveId.Utilt)).toBe(true);
  });
});

describe('Smash Game Feel — Elemental 60fps Skeletal Clips, Squash/Stretch, Hitlag Rattle & Feedback', () => {
  it.each(ALL_FIGHTER_IDS)(
    'Gate F4: Elemental Fighter %i locks 60fps skeletal clip time 1:1 to stateFrame, pops squash on active frames, and pivots +62° <-> -62° through front',
    (fid) => {
      const rig = makeTestRig(fid);
      const anim = createFighterAnimRuntime(0);
      const fheavy = getFighterSpec(fid).moves.get(MoveId.Fheavy)!;
      const windupFrame = Math.max(1, Math.floor(fheavy.startup * 0.6));
      const activeFrame = fheavy.startup + 1;

      // Sample Windup
      applyElementalPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Attack, activeMove: MoveId.Fheavy, stateFrame: windupFrame }),
        1 / 60,
        0.5,
        true,
        true,
        false,
      );
      const fheavyAction = rig.actions.get('Fheavy')!;
      expect(rig.activeActionName).toBe('Fheavy');
      expect(fheavyAction.time).toBeCloseTo(windupFrame / 60, 4);

      // Sample Peak Active Frame -> action time locks to activeFrame/60 and active stretch pops
      applyElementalPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Attack, activeMove: MoveId.Fheavy, stateFrame: activeFrame }),
        1 / 60,
        0.55,
        true,
        true,
        false,
      );
      expect(fheavyAction.time).toBeCloseTo(activeFrame / 60, 4);
      expect(rig.fxGroup.scale.y).toBeGreaterThan(1.01);
      // Volume preservation: sx * sy * sz === 1
      expect(rig.fxGroup.scale.x * rig.fxGroup.scale.y * rig.fxGroup.scale.z).toBeCloseTo(1.0, 4);

      // Landing from airborne triggers squash compression (scale.y < 0.95)
      applyElementalPose(rig, anim, makeSnap({ state: FighterState.Airborne, vy: -3.0 }), 1 / 60, 0.6, true, false, false);
      applyElementalPose(rig, anim, makeSnap({ state: FighterState.LandingLag, stateFrame: 0 }), 1 / 60, 0.62, true, true, false);
      expect(rig.fxGroup.scale.y).toBeLessThan(0.95);

      // Turning left pivots cleanly from +62 deg toward -62 deg through 0 deg (camera-front)
      expect(rig.modelGroup.rotation.y).toBeCloseTo(FACING_RIGHT_YAW, 2);
      for (let i = 0; i < 20; i++) {
        applyElementalPose(rig, anim, makeSnap({ state: FighterState.Idle }), 1 / 60, 0.7 + i / 60, false, true, false);
      }
      expect(rig.modelGroup.rotation.y).toBeCloseTo(FACING_LEFT_YAW, 2);
    },
  );

  it('Gate F4: Jab1/Jab2/Jab3 dispatch distinct baked clips, ChargingHeavy shivers, and victim hitstop freezes clip clock while rattling strongly', () => {
    const rig = makeTestRig(FighterId.Earl);
    const anim = createFighterAnimRuntime(0);

    for (const [moveId, expectedClip] of [
      [MoveId.Jab1, 'Jab1'],
      [MoveId.Jab2, 'Jab2'],
      [MoveId.Jab3, 'Jab3'],
    ] as const) {
      const st = getFighterSpec(FighterId.Earl).moves.get(moveId)!.startup;
      applyElementalPose(rig, anim, makeSnap({ state: FighterState.Attack, activeMove: moveId, stateFrame: st + 1 }), 1 / 60, 0.5, true, true, false);
      expect(rig.activeActionName).toBe(expectedClip);
      expect(rig.actions.get(expectedClip)!.time).toBeCloseTo((st + 1) / 60, 4);
    }

    // ChargingHeavy shivers visibly across frames
    applyElementalPose(rig, anim, makeSnap({ state: FighterState.ChargingHeavy, stateFrame: 30 }), 1 / 60, 1.0, true, true, false);
    const c1 = rig.fxGroup.position.x;
    applyElementalPose(rig, anim, makeSnap({ state: FighterState.ChargingHeavy, stateFrame: 32 }), 1 / 60, 1.033, true, true, false);
    const c2 = rig.fxGroup.position.x;
    expect(Math.abs(c2 - c1)).toBeGreaterThan(0.02);

    // Victim hitstop freezes loopTimeSec AND rattles fxGroup strongly (>= 0.14 u peak-to-peak)
    const loopClockBefore = anim.loopTimeSec;
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      applyElementalPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Hitstun, stateFrame: 1, hitstopFrames: 8 - i }),
        1 / 60,
        2.0 + i / 60,
        false,
        true,
        true,
      );
      xs.push(rig.fxGroup.position.x);
    }
    expect(anim.loopTimeSec).toBe(loopClockBefore);
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThanOrEqual(0.14);
  });

  it('Gate F6: Hit contact spawns on defender (not behind attacker), elemental slash arcs & swing whooshes cover all melee moves', () => {
    const atk = createFighter(0, FighterId.Earl, TeamId.None, -2.0, 0, 3);
    const def = createFighter(1, FighterId.Grog, TeamId.None, 1.0, 0, 3);
    atk.flags = FighterFlag.FacingRight | FighterFlag.Grounded;

    const contact = computeHitContactPoint(atk, def, MoveId.Fheavy);
    expect(Math.abs(contact.x - def.x)).toBeLessThan(Math.abs(contact.x - atk.x));
    expect(contact.x).toBeGreaterThan(0);

    // Impact classification escalates cleanly to KillSpark
    expect(classifyHitImpact(2.5, FighterId.Earl, MoveId.Jab1, 4)).toBe(HitTier.Light);
    expect(classifyHitImpact(8, FighterId.Earl, MoveId.Ftilt, 14)).toBe(HitTier.Mid);
    expect(classifyHitImpact(15, FighterId.Earl, MoveId.Fheavy, 16)).toBe(HitTier.Heavy);
    expect(classifyHitImpact(15, FighterId.Earl, MoveId.Fheavy, 28)).toBe(HitTier.KillSpark);

    // Every melee attack has both a swing whoosh cue and a finite 3D elemental slash arc
    const meleeMoves: readonly MoveId[] = [
      MoveId.Jab1, MoveId.Jab2, MoveId.Jab3, MoveId.Ftilt, MoveId.Utilt, MoveId.Dtilt,
      MoveId.Dash, MoveId.Fheavy, MoveId.Uheavy, MoveId.Dheavy,
      MoveId.Nair, MoveId.Fair, MoveId.Bair, MoveId.Uair, MoveId.Dair,
    ];
    for (const fid of ALL_FIGHTER_IDS) {
      const elem = getElementalFighter(fid);
      const f = createFighter(0, fid, TeamId.None, 0, 0, 3);
      f.flags = FighterFlag.FacingRight | FighterFlag.Grounded;
      for (const mid of meleeMoves) {
        if (!getFighterSpec(fid).moves.has(mid)) continue;
        f.activeMove = mid;
        const cue = selectSwingSound(fid, mid);
        expect(cue, `Swing sound missing for fighter ${fid} move ${mid}`).not.toBeNull();
        expect([SoundId.SwingLight, SoundId.SwingHeavy]).toContain(cue!.soundId);

        const slash = buildSlashForMove(f, '#24459A');
        expect(slash, `Slash arc missing for fighter ${fid} move ${mid}`).not.toBeNull();
        expect(Number.isFinite(slash!.x) && Number.isFinite(slash!.y) && slash!.radius > 0.3).toBe(true);
        expect(slash!.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
        if (mid === MoveId.Fheavy || mid === MoveId.Uheavy || mid === MoveId.Dheavy) {
          expect(slash!.colorHex).toBe(elem.heavySlashHex);
        }
      }
    }
  });
});

describe('Platform-Fighter Fundamentals — Attack Kinematics, Combos, Movement & Recovery (Gates F8–F10)', () => {
  beforeAll(async () => {
    await ensurePhysics();
  });

  afterEach(() => {
    disposeAllWorlds();
  });

  it('Gate F8: Grounded/aerial attack kinematics apply subtle windup coil -> forward step-in, Bair recoil, Dair stall->stomp, and ledge edge-stop', () => {
    // 1) Fheavy: windup pulls back slightly, active surges forward for clear ground travel
    const wHeavy = createMatch();
    positionPair(wHeavy, 0, 8.0);
    const fH = wHeavy.fighters[0]!;
    const fheavySpec = getFighterSpec(FighterId.Earl).moves.get(MoveId.Fheavy)!;
    let sawWindupPullback = false;
    let sawActiveSurge = false;
    const hTape = tape().tap(InputDir.Right, InputBit.Heavy).build();
    for (let t = 0; t < fheavySpec.total + 2; t++) {
      wHeavy.step([hTape[t] ?? 0, 0]);
      if (fH.state === FighterState.Attack && fH.moveFrame === 1 && fH.vx < -0.5) sawWindupPullback = true;
      if (fH.state === FighterState.Attack && fH.moveFrame === fheavySpec.startup && fH.vx > 5.0) sawActiveSurge = true;
    }
    expect(sawWindupPullback).toBe(true);
    expect(sawActiveSurge).toBe(true);
    expect(fH.x).toBeGreaterThan(0.35);

    // 2) Ftilt steps physically forward from idle
    const wTilt = createMatch();
    positionPair(wTilt, 0, 8.0);
    const fT = wTilt.fighters[0]!;
    runTape(wTilt, [tape().tap(InputDir.Right, InputBit.Attack).build(), []], 20);
    expect(fT.x).toBeGreaterThan(0.18);

    // 3) Bair recoils opposite strike direction (+X when facing right & kicking left); Dair stalls then stomps down
    const wAir = createMatch();
    const fA = wAir.fighters[0]!;
    fA.x = 0; fA.y = 4.0; fA.vx = 0; fA.vy = 0;
    fA.flags = FighterFlag.FacingRight;
    fA.state = FighterState.Airborne;
    const bairSpec = getFighterSpec(FighterId.Earl).moves.get(MoveId.Bair)!;
    runTape(wAir, [tape().tap(InputDir.Left, InputBit.Attack).build(), []], bairSpec.startup + 1);
    expect(fA.activeMove).toBe(MoveId.Bair);
    expect(fA.vx).toBeGreaterThan(0.8);

    const wDair = createMatch();
    const fD = wDair.fighters[0]!;
    fD.x = 0; fD.y = 5.0; fD.vx = 0; fD.vy = -1.5;
    fD.flags = FighterFlag.FacingRight;
    fD.state = FighterState.Airborne;
    const dairSpec = getFighterSpec(FighterId.Earl).moves.get(MoveId.Dair)!;
    let maxStartupVy = -99;
    let minActiveVy = 99;
    const dTape = tape().tap(InputDir.Down, InputBit.Attack).build();
    for (let t = 0; t < dairSpec.startup + 2; t++) {
      wDair.step([dTape[t] ?? 0, 0]);
      if (fD.moveFrame === 1) maxStartupVy = Math.max(maxStartupVy, fD.vy);
      if (fD.moveFrame >= dairSpec.startup) minActiveVy = Math.min(minActiveVy, fD.vy);
    }
    expect(maxStartupVy).toBeGreaterThan(-0.5);
    expect(minActiveVy).toBeLessThanOrEqual(-5.0);

    // 4) Grounded ledge Edge-Stop: Fheavy right at Willow's right rim stops cleanly instead of lunging offstage!
    const wEdge = createMatch({
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 1, id: FighterId.Earl, team: TeamId.None },
        { slot: 2, id: FighterId.Earl, team: TeamId.None },
        { slot: 3, id: FighterId.Earl, team: TeamId.None },
        { slot: 4, id: FighterId.Earl, team: TeamId.None },
      ],
    });
    positionPair(wEdge, 12.6, -4.0);
    wEdge.fighters[2]!.x = -8; wEdge.fighters[3]!.x = -9; wEdge.fighters[4]!.x = -10;
    const fEdge = wEdge.fighters[0]!;
    runTape(wEdge, [tape().tap(InputDir.Right, InputBit.Heavy).build(), [], [], [], []], fheavySpec.total + 4);
    expect((fEdge.flags & FighterFlag.Grounded) !== 0).toBe(true);
    expect(fEdge.x).toBeLessThanOrEqual(13.05);
  });

  it('Gate F9 (Movement): True Dash-Dancing, RAR (Reverse Aerial Rush), mid-aerial SHFF Fast-Fall, and 3f Auto-Cancel', () => {
    // 1) Dash-Dancing: flip direction during initial dash reverses facing & stays in Dash with full opposite speed
    const wDD = createMatch();
    positionPair(wDD, 0, 8.0);
    const fDD = wDD.fighters[0]!;
    const ddTape = tape().hold(4, InputDir.Right).hold(3, InputDir.Left).build();
    runTape(wDD, [ddTape, []], 7);
    expect(fDD.state).toBe(FighterState.Dash);
    expect((fDD.flags & FighterFlag.FacingRight) === 0).toBe(true);
    expect(fDD.vx).toBeLessThan(-7.0);

    // 2) RAR (Reverse Aerial Rush): run right -> tap left (Skid) -> jump + attack -> flies right while facing left!
    const wRar = createMatch();
    positionPair(wRar, -3.0, 8.0);
    const fRar = wRar.fighters[0]!;
    const rarTape = tape()
      .hold(14, InputDir.Right) // Dash -> Run
      .tap(InputDir.Left) // Skid
      .tap(InputDir.Left, InputBit.Jump) // RAR jump flip
      .tap(InputDir.Right, InputBit.Attack) // buffered Bair moving forward!
      .build();
    runTape(wRar, [rarTape, []], 20);
    expect((fRar.flags & FighterFlag.Grounded) === 0).toBe(true);
    expect((fRar.flags & FighterFlag.FacingRight) === 0).toBe(true);
    expect(fRar.vx).toBeGreaterThan(2.5);
    expect(fRar.activeMove).toBe(MoveId.Bair);

    // 3) Mid-aerial SHFF Fast-Fall + Auto-Cancel landing lag (3f instead of full landingLag)
    const wShff = createMatch();
    const fS = wShff.fighters[0]!;
    fS.x = 0; fS.y = 4.2; fS.vx = 0; fS.vy = -1.0;
    fS.flags = FighterFlag.FacingRight;
    fS.state = FighterState.Airborne;
    const fairSpec = getFighterSpec(FighterId.Earl).moves.get(MoveId.Fair)!;
    // Start Fair, tap Down mid-aerial while falling -> FastFall engages during Attack!
    const ffTape = tape().tap(InputDir.Right, InputBit.Attack).wait(2).tap(InputDir.Down).build();
    runTape(wShff, [ffTape, []], 5);
    expect(fS.state).toBe(FighterState.Attack);
    expect((fS.flags & FighterFlag.FastFall) !== 0).toBe(true);

    // Auto-Cancel: place fighter right above ground during late recovery frame of Fair -> lands with 3f lag!
    fS.flags &= ~FighterFlag.FastFall;
    fS.moveFrame = fairSpec.total - 3;
    fS.y = 0.08;
    fS.vy = -4.0;
    wShff.step([0, 0]);
    expect(fS.state).toBe(FighterState.LandingLag);
    expect(fS.hitstunFrames).toBe(AUTO_CANCEL_LANDING_LAG);
    expect(fairSpec.landingLag).toBeGreaterThan(AUTO_CANCEL_LANDING_LAG);
  });

  it('Gate F9 (Combos & Counterplay): On-Hit IASA combo cancels, Brawlhalla Chase-Dodge attack cancel, and Hitstop SDI', () => {
    // 1) On-Hit IASA combo: Earl Utilt -> early Jump cancel (10f before total!) -> Uair true 2-hit combo
    const wCombo = createMatch();
    positionPair(wCombo, 0, 1.15);
    const atk = wCombo.fighters[0]!;
    const def = wCombo.fighters[1]!;
    def.damage = 25;
    const utiltSpec = getFighterSpec(FighterId.Earl).moves.get(MoveId.Utilt)!;
    let jumpedEarlyAtFrame = -1;
    let maxCombo = 0;
    let hit1 = false;
    let jumpQueued = false;
    let airQueued = false;
    for (let t = 0; t < 44; t++) {
      let aM = 0;
      const prevFrame = atk.moveFrame;
      if (t === 0) {
        aM = encodeInputMask(InputDir.Up, InputBit.Attack);
      } else if (hit1 && !jumpQueued && atk.state === FighterState.Attack && atk.moveFrame >= 15) {
        aM = encodeInputMask(InputDir.Right, InputBit.Jump);
        jumpQueued = true;
      } else if (jumpQueued && !airQueued && atk.state === FighterState.JumpSquat) {
        aM = encodeInputMask(InputDir.Up, InputBit.Attack);
        airQueued = true;
      } else if (airQueued) {
        aM = encodeInputMask(InputDir.Right, 0);
      }
      const evs = wCombo.step([aM, 0]);
      if (!hit1 && evs.some((e) => e.kind === SimEventKind.Hit && e.a === 0 && e.b === 1)) {
        hit1 = true;
      }
      if (hit1 && jumpedEarlyAtFrame < 0 && atk.state === FighterState.JumpSquat) {
        jumpedEarlyAtFrame = prevFrame;
      }
      maxCombo = Math.max(maxCombo, def.comboCount);
    }
    expect(jumpedEarlyAtFrame).toBeGreaterThan(0);
    expect(jumpedEarlyAtFrame).toBeLessThan(utiltSpec.total);
    expect(maxCombo).toBeGreaterThanOrEqual(2);

    // 2) Brawlhalla Chase-Dodge + Chase-Dodge Attack Cancel after landing a hit
    const wChase = createMatch();
    const fC = wChase.fighters[0]!;
    fC.x = 0; fC.y = 3.2; fC.vx = 0; fC.vy = 0;
    fC.flags = FighterFlag.FacingRight;
    fC.state = FighterState.Airborne;
    fC.chaseDodgeWindow = 10;
    const chaseTape = tape()
      .tap(InputDir.Right, InputBit.Guard) // triggers Chase-Dodge!
      .wait(7)
      .tap(InputDir.Right, InputBit.Attack) // cancels Chase-Dodge into Fair!
      .build();
    wChase.step([chaseTape[0] ?? 0, 0]);
    expect(fC.state).toBe(FighterState.AirDodge);
    expect(fC.chaseDodgeActive).toBe(true);
    for (let t = 1; t < chaseTape.length + 2; t++) {
      wChase.step([chaseTape[t] ?? 0, 0]);
    }
    expect(fC.state).toBe(FighterState.Attack);
    expect(fC.activeMove).toBe(MoveId.Fair);

    // 3) Smash Hitstop SDI: tapping directional input during hitstop nudges victim cleanly
    const wSdi = createMatch();
    positionPair(wSdi, 0, 1.2);
    const defS = wSdi.fighters[1]!;
    defS.state = FighterState.Hitstun;
    defS.hitstopFrames = 6;
    defS.hitstunFrames = 14;
    defS.sdiNudgesLeft = 2;
    const xBefore = defS.x;
    wSdi.step([0, encodeInputMask(InputDir.Right, 0)]);
    expect(defS.sdiNudgesLeft).toBe(1);
    expect(defS.x - xBefore).toBeCloseTo(SDI_NUDGE_DISTANCE, 3);
  });

  it.each(ALL_FIGHTER_IDS)(
    'Gate F10: Fighter %i recovers reliably from deep offstage via directional Uspec ledge-snap and AirDodge ledge-snap',
    (fid) => {
      // 1) Deep offstage right of Willow's ledge (x=13.0, y=0.0): doubleJump inward + UpLeft Uspec -> recovers to ledge/stage!
      const world = createMatch({
        stocksOverride: 1,
        fighters: [
          { slot: 0, id: fid, team: TeamId.None },
          { slot: 1, id: FighterId.Earl, team: TeamId.None },
          { slot: 2, id: FighterId.Earl, team: TeamId.None },
          { slot: 3, id: FighterId.Earl, team: TeamId.None },
          { slot: 4, id: FighterId.Earl, team: TeamId.None },
        ],
      });
      positionPair(world, 0, -4.0);
      world.fighters[2]!.x = -7; world.fighters[3]!.x = -9; world.fighters[4]!.x = -11;
      const f = world.fighters[0]!;
      f.x = 16.0;
      f.y = -2.0;
      f.vx = 0;
      f.vy = -2.0;
      f.flags = FighterFlag.FacingRight; // facing away from stage initially!
      f.state = FighterState.Airborne;
      f.doubleJumpsLeft = 1;
      f.airDodgesLeft = 1;

      let recovered = false;
      for (let t = 0; t < 150; t++) {
        let m = encodeInputMask(InputDir.Left, 0);
        if (t === 0) m = encodeInputMask(InputDir.Left, InputBit.Jump);
        else if (t === 22) m = encodeInputMask(InputDir.UpLeft, InputBit.Special);
        world.step([m, 0, 0, 0, 0]);
        const cur = world.fighters[0]!;
        if (cur.state === FighterState.LedgeHang || (cur.flags & FighterFlag.Grounded) !== 0) {
          recovered = true;
          break;
        }
      }
      expect(recovered, `Fighter ${fid} failed deep offstage Uspec recovery`).toBe(true);
      expect(f.stocks).toBe(1);

      // 2) Air-Dodge ledge magnetism: airborne just outside ledge dodging inward grabs ledge cleanly
      const wAd = createMatch({
        stocksOverride: 1,
        fighters: [
          { slot: 0, id: fid, team: TeamId.None },
          { slot: 1, id: FighterId.Earl, team: TeamId.None },
          { slot: 2, id: FighterId.Earl, team: TeamId.None },
          { slot: 3, id: FighterId.Earl, team: TeamId.None },
          { slot: 4, id: FighterId.Earl, team: TeamId.None },
        ],
      });
      positionPair(wAd, 0, -4.0);
      wAd.fighters[2]!.x = -7; wAd.fighters[3]!.x = -9; wAd.fighters[4]!.x = -11;
      const fAd = wAd.fighters[0]!;
      fAd.x = 14.3;
      fAd.y = -0.6;
      fAd.vx = 0;
      fAd.vy = -1.0;
      fAd.flags = FighterFlag.FacingRight;
      fAd.state = FighterState.Airborne;
      fAd.airDodgesLeft = 1;

      let grabbed = false;
      for (let t = 0; t < 30; t++) {
        const m = t === 0 ? encodeInputMask(InputDir.Left, InputBit.Guard) : encodeInputMask(InputDir.Left, 0);
        wAd.step([m, 0, 0, 0, 0]);
        const cur = wAd.fighters[0]!;
        if (cur.state === FighterState.LedgeHang || (cur.flags & FighterFlag.Grounded) !== 0) {
          grabbed = true;
          break;
        }
      }
      expect(grabbed, `Fighter ${fid} failed AirDodge ledge-snap recovery`).toBe(true);
    },
  );
});
