import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildSlashForMove,
  classifyHitImpact,
  computeHitContactPoint,
  HitTier,
  selectSwingSound,
} from '@client/combat-feel';
import { SoundId } from '@client/enums';
import { InputCollector } from '@client/input';
import { applyFighterPose, createFighterAnimRuntime, type BoneSlot, type FighterBoneRig } from '@client/poses';
import { HostSimulation } from '@host/engine';
import type { SnapshotData, SnapshotFighter } from '@net/codec';
import { RemoteInterpolator } from '@net/sync';
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

function makeSlot(x = 0, y = 0, z = 0): BoneSlot {
  const bone = new THREE.Bone();
  bone.position.set(x, y, z);
  return { bone, restPos: bone.position.clone(), restQuat: bone.quaternion.clone() };
}

function makeTestRig(fighterId: FighterId): FighterBoneRig {
  const body = makeSlot(0, 0, 0);
  const child = (x: number, y: number, z: number): BoneSlot => {
    const s = makeSlot(x, y, z);
    body.bone.add(s.bone);
    return s;
  };
  return {
    fighterId,
    body,
    lid: fighterId === FighterId.Earl ? child(0, 1.24, 0) : null,
    head: fighterId === FighterId.Grog ? child(0.92, 1.14, 0) : null,
    hat: fighterId === FighterId.Moss ? child(0, 1.07, 0) : null,
    rod: fighterId === FighterId.Moss ? child(0.3, 0.5, 0.66) : null,
    handF: fighterId !== FighterId.Grog ? child(0.2, 0.52, 0.72) : null,
    handB: fighterId !== FighterId.Grog ? child(0.2, 0.52, -0.72) : null,
    footF: fighterId === FighterId.Earl || fighterId === FighterId.Moss ? child(0.02, 0, 0.25) : null,
    footB: fighterId === FighterId.Earl || fighterId === FighterId.Moss ? child(0.02, 0, -0.25) : null,
    hoofFL: fighterId === FighterId.Grog ? child(0.56, 0, 0.33) : null,
    hoofFR: fighterId === FighterId.Grog ? child(0.56, 0, -0.33) : null,
    hoofBL: fighterId === FighterId.Grog ? child(-0.5, 0, 0.33) : null,
    hoofBR: fighterId === FighterId.Grog ? child(-0.5, 0, -0.33) : null,
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

describe('Smash Game Feel — Expressive Model Poses, Limb Pop, Hitlag Rattle & Feedback', () => {
  it.each(ALL_FIGHTER_IDS)(
    'Gate F4: Fighter %i shows coiled windup -> forward active lunge & exaggerated striking-limb scale pop (>=1.25x)',
    (fid) => {
      const rig = makeTestRig(fid);
      const anim = createFighterAnimRuntime(0);
      const fheavy = getFighterSpec(fid).moves.get(MoveId.Fheavy)!;

      // Sample Windup
      applyFighterPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Attack, activeMove: MoveId.Fheavy, stateFrame: Math.max(1, Math.floor(fheavy.startup * 0.6)) }),
        1 / 60,
        0.5,
        true,
        true,
        false,
      );
      rig.body.bone.updateMatrixWorld(true);
      const striker = fid === FighterId.Grog ? rig.head! : rig.handF!;
      const windupBodyX = rig.body.bone.position.x;
      const windupStrikerWorld = striker.bone.getWorldPosition(new THREE.Vector3());

      // Sample Peak Active Frame
      applyFighterPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Attack, activeMove: MoveId.Fheavy, stateFrame: fheavy.startup + 1 }),
        1 / 60,
        0.55,
        true,
        true,
        false,
      );
      rig.body.bone.updateMatrixWorld(true);
      const activeBodyX = rig.body.bone.position.x;
      const activeStrikerWorld = striker.bone.getWorldPosition(new THREE.Vector3());

      // Whole body must coil backward in windup and explode forward on active hit frame!
      expect(windupBodyX).toBeLessThan(-0.15);
      expect(activeBodyX).toBeGreaterThan(0.42);
      expect(activeBodyX - windupBodyX).toBeGreaterThan(0.6);

      // Striking part (handF for Earl/Nesta/Moss, head for Grog) surges in world space, pops >= 1.25x,
      // and stays cleanly at chest/face height above the floor (never sinking to y~0)!
      expect(activeStrikerWorld.x - windupStrikerWorld.x).toBeGreaterThan(0.9);
      expect(activeStrikerWorld.y).toBeGreaterThanOrEqual(0.45);
      expect(striker.bone.scale.x).toBeGreaterThanOrEqual(1.25);

      // Anatomical cohesion: Grog's head stays attached to neck, Earl's lid stays over crown, Moss's rod stays above floor!
      if (fid === FighterId.Grog && rig.head) {
        expect(Math.abs(rig.head.bone.position.x - rig.head.restPos.x)).toBeLessThanOrEqual(0.32);
      }
      if (fid === FighterId.Earl && rig.lid) {
        expect(Math.abs(rig.lid.bone.position.x - rig.lid.restPos.x)).toBeLessThanOrEqual(0.2);
      }
      if (fid === FighterId.Moss && rig.rod) {
        const rodTipLocal = new THREE.Vector3(1.42, 1.18, 0);
        const rodTipWorld = rodTipLocal.applyMatrix4(rig.rod.bone.matrixWorld);
        expect(rodTipWorld.y).toBeGreaterThanOrEqual(0.4);
      }
    },
  );

  it('Gate F4: Jab1, Jab2, Jab3 produce distinct choreography, ChargingHeavy shivers, and victim hitstop rattles strongly', () => {
    const rig = makeTestRig(FighterId.Earl);
    const anim = createFighterAnimRuntime(0);

    const sampleJab = (moveId: MoveId) => {
      const st = getFighterSpec(FighterId.Earl).moves.get(moveId)!.startup;
      applyFighterPose(rig, anim, makeSnap({ state: FighterState.Attack, activeMove: moveId, stateFrame: st + 1 }), 1 / 60, 0.5, true, true, false);
      return {
        handFX: rig.handF!.bone.position.x,
        handBX: rig.handB!.bone.position.x,
        bodyX: rig.body.bone.position.x,
      };
    };
    const j1 = sampleJab(MoveId.Jab1);
    const j2 = sampleJab(MoveId.Jab2);
    const j3 = sampleJab(MoveId.Jab3);
    // Jab1 leads with front hand, Jab2 switches to back hand, Jab3 lunges further forward!
    expect(j1.handFX).toBeGreaterThan(j1.handBX + 0.5);
    expect(j2.handBX).toBeGreaterThan(j2.handFX + 0.5);
    expect(j3.bodyX).toBeGreaterThan(j1.bodyX + 0.15);

    // ChargingHeavy shivers visibly across frames
    applyFighterPose(rig, anim, makeSnap({ state: FighterState.ChargingHeavy, stateFrame: 30 }), 1 / 60, 1.0, true, true, false);
    const c1 = rig.body.bone.position.x;
    applyFighterPose(rig, anim, makeSnap({ state: FighterState.ChargingHeavy, stateFrame: 32 }), 1 / 60, 1.033, true, true, false);
    const c2 = rig.body.bone.position.x;
    expect(Math.abs(c2 - c1)).toBeGreaterThan(0.02);

    // Victim hitstop rattle produces strong oscillation (>= 0.08 u peak-to-peak)
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      applyFighterPose(
        rig,
        anim,
        makeSnap({ state: FighterState.Hitstun, stateFrame: 1, hitstopFrames: 8 - i }),
        1 / 60,
        2.0 + i / 60,
        false,
        true,
        true,
      );
      xs.push(rig.body.bone.position.x);
    }
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThanOrEqual(0.14);
  });

  it('Gate F6: Hit contact spawns on defender (not behind attacker), slash arcs & swing whooshes cover all melee moves', () => {
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

    // Every melee attack has both a swing whoosh cue and a finite 3D slash arc
    const meleeMoves: readonly MoveId[] = [
      MoveId.Jab1, MoveId.Jab2, MoveId.Jab3, MoveId.Ftilt, MoveId.Utilt, MoveId.Dtilt,
      MoveId.Dash, MoveId.Fheavy, MoveId.Uheavy, MoveId.Dheavy,
      MoveId.Nair, MoveId.Fair, MoveId.Bair, MoveId.Uair, MoveId.Dair,
    ];
    for (const fid of ALL_FIGHTER_IDS) {
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
      }
    }
  });
});
