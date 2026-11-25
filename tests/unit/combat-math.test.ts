import { describe, expect, it } from 'vitest';
import fightersRaw from '@data/fighters.json';
import {
  applyLaunchSteering,
  capsulesOverlap,
  computeBlockstun,
  computeHitstop,
  computeHitstun,
  computeLaunchSpeed,
  createHurtboxFrame,
  getFighterHurtbox,
  getMoveHitbox,
  resolveStrike,
  simulateKoCheck,
} from '@sim/combat';
import { getFighterSpec, getGameData, getMoveSpec, parseFighterId } from '@sim/data';
import {
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  HitOutcome,
  InputDir,
  MotionInput,
  MoveId,
  NestaSize,
  TeamId,
} from '@sim/enums';
import { createInputHistory } from '@sim/input';
import type { Capsule, FighterRuntime } from '@sim/types';

function makeFighter(
  id: FighterId,
  overrides: Partial<FighterRuntime> = {},
): FighterRuntime {
  const spec = getFighterSpec(id);
  const f: FighterRuntime = {
    slot: 0,
    id,
    team: TeamId.None,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    kbVx: 0,
    kbVy: 0,
    state: FighterState.Idle,
    stateFrame: 0,
    flags: FighterFlag.FacingRight | FighterFlag.Grounded,
    damage: 0,
    guardHp: spec.stats.guardHP,
    guardRegenDelay: 0,
    parryCooldown: 0,
    gilt: 0,
    stocks: 3,
    heldGadget: GadgetId.None,
    heldGadgetAmmo: 0,
    gadgetCooldown: 0,
    corkChargeFrames: 0,
    activeMove: MoveId.None,
    moveFrame: 0,
    moveHitConnected: false,
    moveHitIds: [],
    moveIsClean: false,
    heavyChargeFrames: 0,
    hitstopFrames: 0,
    hitstunFrames: 0,
    blockstunFrames: 0,
    invulnFrames: 0,
    regrabImmunity: 0,
    grabbedBySlot: -1,
    grabbingSlot: -1,
    grabHoldFrames: 0,
    doubleJumpsLeft: 1,
    airDodgesLeft: 1,
    wallJumpsLeft: 1,
    ledgeGrabCount: 0,
    ledgeChunkIndex: -1,
    ledgeSide: 0,
    comboCount: 0,
    comboHitsByMove: new Map(),
    lastHitBySlot: -1,
    lastHitByGadget: GadgetId.None,
    lastHitByMove: MoveId.None,
    lastHitTick: -1,
    nestaSize: NestaSize.Mid,
    shedsRemaining: 2,
    pipingCharged: false,
    steepChargeFrames: 0,
    sneezeBuildFrames: 0,
    rootFrames: 0,
    rootMashCount: 0,
    slipperyFrames: 0,
    teaspoonCooldown: 0,
    teaspoonX: 0,
    lastInputMask: 0,
    prevInputMask: 0,
    lastInputTick: 0,
    posHistoryX: new Float32Array(120),
    posHistoryY: new Float32Array(120),
    posHistoryCursor: 0,
    posHistoryCount: 0,
    buffer: [],
    history: createInputHistory(32),
    hurtboxHistory: [],
    lastMotion: MotionInput.None,
    pendingHit: null,
    stampedeCarriedSlot: -1,
    stampedeCarryFrames: 0,
    bodyHandle: 0,
    colliderHandle: 0,
    ...overrides,
  };
  return f;
}

type RawMoveRow = {
  id: string;
  startup: number;
  total: number;
  damage: number;
  bkb: number;
  kbg: number;
  angle: number;
  class: string;
  hitstop?: number;
  blockstun?: number;
  onBlock?: number | null;
  launch0?: number;
  launch100?: number;
  koCentre: number | null;
  koLedge: number | null;
};

const ALL_RAW_MOVES = Object.entries(fightersRaw).flatMap(([fighterKey, fighter]) =>
  (fighter.moves as RawMoveRow[]).map((m) => ({
    label: `${fighterKey}.${m.id}`,
    fighterId: parseFighterId(fighterKey),
    raw: m,
  })),
);

function findKoPercent(
  bkb: number,
  kbg: number,
  angle: number,
  damage: number,
  startX: number,
  offstage: boolean,
): number | null {
  if (kbg === 0 || damage === 0) return null;
  for (let p = 0; p <= 300; p++) {
    if (simulateKoCheck(bkb, kbg, angle, damage, p, startX, FighterId.Earl, offstage)) return p;
  }
  return null;
}

describe('combat formulas, capsule geometry, DI & resolveStrike', () => {
  const tuning = getGameData().tuning;

  it('has all 102 moves in data/fighters.json and matches design_data.py formulas with exact parity', () => {
    expect(ALL_RAW_MOVES).toHaveLength(102);

    for (const { label, fighterId, raw } of ALL_RAW_MOVES) {
      const spec = getFighterSpec(fighterId);
      const move = Array.from(spec.moves.values()).find((mv) => mv.name === (raw as { name?: string }).name || mv.startup === raw.startup && mv.total === raw.total && mv.damage === raw.damage && mv.angle === raw.angle);
      expect(move, `${label} loaded in spec`).toBeDefined();
      const isHeavy = raw.class === 'heavy';

      if (raw.hitstop !== undefined) {
        expect(computeHitstop(raw.damage, isHeavy), `${label}.hitstop`).toBe(raw.hitstop);
      }
      if (raw.blockstun !== undefined) {
        const bs = computeBlockstun(raw.damage);
        expect(bs, `${label}.blockstun`).toBe(raw.blockstun);
        expect(bs - (raw.total - raw.startup), `${label}.onBlock`).toBe(raw.onBlock);
      }
      if (raw.launch0 !== undefined && raw.launch100 !== undefined) {
        const l0 = computeLaunchSpeed(raw.bkb, raw.kbg, raw.damage, 1.0);
        const l100 = computeLaunchSpeed(raw.bkb, raw.kbg, 100 + raw.damage, 1.0);
        expect(Math.abs(l0 - raw.launch0), `${label}.launch0`).toBeLessThanOrEqual(0.05 + 1e-9);
        expect(Math.abs(l100 - raw.launch100), `${label}.launch100`).toBeLessThanOrEqual(0.05 + 1e-9);
      }
      if (raw.class !== 'grab') {
        const isSpike = raw.angle >= 255 && raw.angle <= 285;
        const koCentre = isSpike ? null : findKoPercent(raw.bkb, raw.kbg, raw.angle, raw.damage, 0, false);
        const koLedge = findKoPercent(raw.bkb, raw.kbg, raw.angle, raw.damage, 12, isSpike);
        expect(koCentre, `${label}.koCentre`).toBe(raw.koCentre);
        expect(koLedge, `${label}.koLedge`).toBe(raw.koLedge);
      }
    }
  });

  it('computes hitstun with 6%/hit combo decay to 0.5 floor and 0.5x repeat-move penalty', () => {
    const base = computeHitstun(20); // round(6 + 1.25*20) = 31
    expect(base).toBe(31);
    expect(computeHitstun(20, 2, 0)).toBe(29); // round(31 * 0.94) = 29
    expect(computeHitstun(20, 10, 0)).toBe(16); // 1 - 0.54 = 0.46 -> clamped at 0.5 floor: roundHalfEven(15.5) = 16
    expect(computeHitstun(20, 15, 0)).toBe(16); // floor stays at 0.5
    expect(computeHitstun(20, 1, 1)).toBe(16); // repeat-move penalty 0.5x
    expect(computeHitstun(20, 15, 1)).toBe(8); // 0.5 floor * 0.5 repeat = 8
    expect(computeHitstun(200, 1, 0)).toBe(tuning.hitstun.max);
  });

  it.each<{ name: string; a: Capsule; b: Capsule; expected: boolean }>([
    {
      name: 'intersecting vertical capsules',
      a: { x0: 0, y0: 0, x1: 0, y1: 2, radius: 0.5 },
      b: { x0: 0.5, y0: 1, x1: 0.5, y1: 3, radius: 0.5 },
      expected: true,
    },
    {
      name: 'tangent horizontal capsules (exact radius sum)',
      a: { x0: 0, y0: 0, x1: 1, y1: 0, radius: 0.5 },
      b: { x0: 2, y0: 0, x1: 3, y1: 0, radius: 0.5 },
      expected: true,
    },
    {
      name: 'separated capsules beyond radius sum',
      a: { x0: 0, y0: 0, x1: 1, y1: 0, radius: 0.5 },
      b: { x0: 2.01, y0: 0, x1: 3, y1: 0, radius: 0.5 },
      expected: false,
    },
    {
      name: 'perpendicular crossing capsules',
      a: { x0: -1, y0: 1, x1: 1, y1: 1, radius: 0.25 },
      b: { x0: 0, y0: 0, x1: 0, y1: 2, radius: 0.25 },
      expected: true,
    },
    {
      name: 'perpendicular skew non-intersecting capsules',
      a: { x0: -1, y0: 0, x1: 1, y1: 0, radius: 0.25 },
      b: { x0: 0, y0: 0.6, x1: 0, y1: 2, radius: 0.25 },
      expected: false,
    },
  ])('capsule overlap: $name -> $expected', ({ a, b, expected }) => {
    expect(capsulesOverlap(a, b)).toBe(expected);
  });

  it.each([
    { angle: 40, facingRight: true, di: InputDir.Neutral, expected: 40 },
    { angle: 40, facingRight: false, di: InputDir.Neutral, expected: 140 },
    { angle: 0, facingRight: true, di: InputDir.Up, expected: 15 },
    { angle: 0, facingRight: true, di: InputDir.Down, expected: -15 },
    { angle: 90, facingRight: true, di: InputDir.Left, expected: 105 },
    { angle: 90, facingRight: false, di: InputDir.Right, expected: 75 },
  ])('applies ±15° DI steering (angle=$angle, right=$facingRight, di=$di)', ({ angle, facingRight, di, expected }) => {
    expect(applyLaunchSteering(angle, facingRight, di)).toBeCloseTo(expected, 6);
  });

  it('resolves Invuln, Parry (5f base + up to 3-tick latency grace), Block (0.35x pushback, grab bypass), and Armour', () => {
    const atk = makeFighter(FighterId.Earl, { x: 0, y: 0 });
    const ftilt = getMoveSpec(FighterId.Earl, MoveId.Ftilt);
    const grab = getMoveSpec(FighterId.Earl, MoveId.Grab);

    // Invuln beats hit
    const invulnDef = makeFighter(FighterId.Earl, { slot: 1, x: 0.8, y: 0, flags: FighterFlag.Invuln });
    expect(resolveStrike(atk, invulnDef, ftilt).outcome).toBe(HitOutcome.Invuln);

    // Active Parry state
    const parryDef = makeFighter(FighterId.Earl, { slot: 1, x: 0.8, y: 0, state: FighterState.Parry });
    expect(resolveStrike(atk, parryDef, ftilt).outcome).toBe(HitOutcome.Parry);

    // Guard within 3-tick latency grace converts to Parry; beyond grace -> Block
    const graceDef = makeFighter(FighterId.Earl, { slot: 1, x: 0.8, y: 0, state: FighterState.Guard, stateFrame: 2 });
    expect(resolveStrike(atk, graceDef, ftilt, 1, false, false, 0, 3).outcome).toBe(HitOutcome.Parry);
    const lateGuardDef = makeFighter(FighterId.Earl, { slot: 1, x: 0.8, y: 0, state: FighterState.Guard, stateFrame: 3 });
    const blk = resolveStrike(atk, lateGuardDef, ftilt, 1, false, false, 0, 5); // clamped to 3 ticks max
    expect(blk.outcome).toBe(HitOutcome.Block);
    expect(blk.pushbackSpeed).toBeCloseTo(blk.launchSpeed * tuning.guard.pushbackScale, 6);

    // Grab bypasses Guard & Parry
    expect(resolveStrike(atk, parryDef, grab).outcome).toBe(HitOutcome.Hit);
    expect(resolveStrike(atk, graceDef, grab, 1, false, false, 0, 3).outcome).toBe(HitOutcome.Hit);

    // Grog Stampede armour threshold (10% normal, 13% clean 236)
    const grogArmour = makeFighter(FighterId.Grog, {
      slot: 1,
      x: 0.8,
      y: 0,
      flags: FighterFlag.Armour,
      activeMove: MoveId.Sspec,
      lastMotion: MotionInput.None,
    });
    expect(resolveStrike(atk, grogArmour, ftilt).outcome).toBe(HitOutcome.Armour); // 8% < 10%
    const fheavy = getMoveSpec(FighterId.Earl, MoveId.Fheavy); // 15% >= 10%
    expect(resolveStrike(atk, grogArmour, fheavy).outcome).toBe(HitOutcome.Hit);

    const grogCleanArmour = makeFighter(FighterId.Grog, {
      slot: 1,
      x: 0.8,
      y: 0,
      flags: FighterFlag.Armour,
      activeMove: MoveId.Sspec,
      lastMotion: MotionInput.Qcf236,
    });
    const dheavy = getMoveSpec(FighterId.Earl, MoveId.Dheavy); // 12% < 13%
    expect(resolveStrike(atk, grogCleanArmour, dheavy).outcome).toBe(HitOutcome.Armour);
  });

  it('applies Nesta Big/Mid/Small multipliers, heavy 1.4x charge, and excludes Moss hat from hurtbox', () => {
    const def = makeFighter(FighterId.Earl, { slot: 1, x: 0.8, y: 0 });
    const ftilt = getMoveSpec(FighterId.Nesta, MoveId.Ftilt);
    const fheavy = getMoveSpec(FighterId.Earl, MoveId.Fheavy);

    const bigNesta = makeFighter(FighterId.Nesta, { nestaSize: NestaSize.Big });
    const midNesta = makeFighter(FighterId.Nesta, { nestaSize: NestaSize.Mid });
    const smallNesta = makeFighter(FighterId.Nesta, { nestaSize: NestaSize.Small });
    const bigHit = resolveStrike(bigNesta, def, ftilt);
    const midHit = resolveStrike(midNesta, def, ftilt);
    const smallHit = resolveStrike(smallNesta, def, ftilt);
    expect(bigHit.damage).toBeCloseTo(ftilt.damage * 1.15, 6);
    expect(midHit.damage).toBeCloseTo(ftilt.damage * 1.0, 6);
    expect(smallHit.damage).toBeCloseTo(ftilt.damage * 0.8, 6);
    expect(bigHit.launchSpeed).toBeGreaterThan(midHit.launchSpeed);
    expect(midHit.launchSpeed).toBeGreaterThan(smallHit.launchSpeed);

    // Heavy charge up to 1.4x
    const earl = makeFighter(FighterId.Earl, { x: 0, y: 0 });
    const charged = resolveStrike(earl, def, fheavy, tuning.input.smashChargeMaxMult);
    expect(charged.damage).toBeCloseTo(fheavy.damage * 1.4, 6);

    // Moss hat exclusion: total height 1.4, hurtbox height 0.7 (y in [0, 0.7])
    const moss = makeFighter(FighterId.Moss, { slot: 1, x: 0.8, y: 0 });
    const mossHurt = getFighterHurtbox(moss);
    expect(mossHurt.y1 + mossHurt.radius).toBeCloseTo(getFighterSpec(FighterId.Moss).stats.height * 0.5, 6);
    // High capsule touching only the hat (y = 0.85..1.35) must not overlap Moss hurtbox
    const hatOnlyHit: Capsule = { x0: 0.6, y0: 0.85, x1: 1.0, y1: 1.35, radius: 0.1 };
    expect(capsulesOverlap(hatOnlyHit, mossHurt)).toBe(false);

    // Hurtbox history rewind respects lagCompMaxTicks
    const pastFrame = createHurtboxFrame(makeFighter(FighterId.Earl, { slot: 1, x: 1.0, y: 0 }), 0);
    const nowFrame = createHurtboxFrame(makeFighter(FighterId.Earl, { slot: 1, x: 5.0, y: 0 }), 1);
    const rewoundDef = makeFighter(FighterId.Earl, { slot: 1, x: 5.0, y: 0, hurtboxHistory: [pastFrame, nowFrame] });
    expect(resolveStrike(earl, rewoundDef, ftilt, 1, false, false, 0).outcome).toBe(HitOutcome.Miss);
    expect(resolveStrike(earl, rewoundDef, ftilt, 1, false, false, 1).outcome).toBe(HitOutcome.Hit);
    // Sanity check getMoveHitbox returns finite capsule
    const hb = getMoveHitbox(earl, ftilt);
    expect(Number.isFinite(hb.x1) && hb.radius > 0).toBe(true);
  });
});
