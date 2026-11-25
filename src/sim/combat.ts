import { assert, assertFinite, requireDefined, requireKey } from './assert';
import { getFighterSpec, getGameData, type MoveSpec } from './data';
import {
  ErrorCode,
  FighterFlag,
  FighterId,
  FighterState,
  HitOutcome,
  InputDir,
  MotionInput,
  MoveClass,
  MoveId,
} from './enums';
import { dirToUnitVector } from './input';
import type { Capsule, FighterHurtboxFrame, FighterRuntime, HitCheckResult } from './types';

function roundHalfEven(x: number): number {
  if (x < 0) return -roundHalfEven(-x);
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5 - 1e-9) return f;
  if (diff > 0.5 + 1e-9) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------- Combat Formulas

export function computeLaunchSpeed(
  bkb: number,
  kbg: number,
  percentAfterHit: number,
  weight: number,
  globalScale = 1.0,
): number {
  assertFinite(bkb, 'bkb');
  assertFinite(kbg, 'kbg');
  assertFinite(percentAfterHit, 'percentAfterHit');
  assertFinite(weight, 'weight');
  assertFinite(globalScale, 'globalScale');
  assert(weight > -1, ErrorCode.InvariantViolation, `Weight must exceed -1, got ${weight}`);
  return ((bkb + (kbg * percentAfterHit) / 100.0) * 2.0) / (1.0 + weight) * globalScale;
}

export function computeHitstun(launchSpeed: number, comboHitIndex = 1, repeatMoveCount = 0): number {
  assertFinite(launchSpeed, 'launchSpeed');
  const { base, perSpeed, max } = getGameData().tuning.hitstun;
  let frames = Math.min(max, roundHalfEven(base + perSpeed * launchSpeed));
  if (comboHitIndex > 1) {
    frames = roundHalfEven(frames * Math.max(0.5, 1.0 - 0.06 * (comboHitIndex - 1)));
  }
  if (repeatMoveCount >= 1) {
    frames = roundHalfEven(frames * 0.5);
  }
  return Math.max(0, frames);
}

export function computeHitstop(damage: number, isHeavy: boolean): number {
  assertFinite(damage, 'damage');
  const h = getGameData().tuning.hitstop;
  return Math.max(h.min, Math.min(h.max, roundHalfEven(h.base + h.perDamage * damage))) + (isHeavy ? h.heavyBonus : 0);
}

export function computeBlockstun(damage: number): number {
  assertFinite(damage, 'damage');
  const g = getGameData().tuning.guard;
  return roundHalfEven(g.blockstunBase + g.blockstunPerDamage * damage);
}

export function applyLaunchSteering(angleDeg: number, facingRight: boolean, diDir: InputDir): number {
  assertFinite(angleDeg, 'angleDeg');
  const baseDeg = facingRight ? angleDeg : 180 - angleDeg;
  if (diDir === InputDir.Neutral) return baseDeg;
  const { x: dx, y: dy } = dirToUnitVector(diDir);
  const rad = (baseDeg * Math.PI) / 180;
  const proj = -Math.sin(rad) * dx + Math.cos(rad) * dy;
  return baseDeg + proj * getGameData().tuning.launch.diMaxDeg;
}

export function simulateKoCheck(
  bkb: number,
  kbg: number,
  angleDeg: number,
  damage: number,
  percentBefore: number,
  startX: number,
  victimId: FighterId = FighterId.Earl,
  offstage = false,
): boolean {
  const tuning = getGameData().tuning;
  const st = getFighterSpec(victimId).stats;
  const bz = tuning.blastZone;
  const g = tuning.gravity * st.gravityScale;
  const dec = tuning.kbDecay;
  const dt = 1 / tuning.tickRate;

  const pct = percentBefore + damage;
  const L = computeLaunchSpeed(bkb, kbg, pct, st.weight);
  const H = computeHitstun(L);
  const a = (angleDeg * Math.PI) / 180;
  const ux = Math.abs(Math.cos(a));
  const uy = Math.sin(a);

  let x = offstage ? 14.2 : startX;
  let y = 0.8;
  let kb = L;
  let vy = 0.0;
  let vx = 0.0;
  let f = 0;

  while (kb > 0 || f < H) {
    x += (kb * ux + vx) * dt;
    y += (kb * uy + vy) * dt;
    kb = Math.max(0.0, kb - dec * dt);
    vy = Math.max(-st.maxFall, vy - g * dt);
    f += 1;
    if (f > H) vx = Math.max(-st.airSpeed, vx - st.airAccel * dt);
    if (x >= bz.right || y >= bz.top || y <= bz.bottom) return true;
    if (y <= 0.8 && x <= 13.0 && kb * uy + vy <= 0 && f > 2) return false;
    if (f > 400) break;
  }

  if (x > 13.0) {
    const reachY = st.doubleJump + 4.6 - 0.8;
    const reachX = st.airSpeed * 1.3;
    if (y < -reachY || x - 13.0 > reachX + 6.0) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Capsule Overlap

export function segmentSegmentDistSq(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): number {
  const d1x = ax1 - ax0;
  const d1y = ay1 - ay0;
  const d2x = bx1 - bx0;
  const d2y = by1 - by0;
  const rx = ax0 - bx0;
  const ry = ay0 - by0;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const eps = 1e-12;

  let s = 0;
  let t = 0;
  if (a <= eps && e <= eps) {
    return rx * rx + ry * ry;
  }
  if (a <= eps) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= eps) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const cx = ax0 + d1x * s - (bx0 + d2x * t);
  const cy = ay0 + d1y * s - (by0 + d2y * t);
  return cx * cx + cy * cy;
}

export function capsulesOverlap(a: Capsule, b: Capsule): boolean {
  const r = a.radius + b.radius;
  return segmentSegmentDistSq(a.x0, a.y0, a.x1, a.y1, b.x0, b.y0, b.x1, b.y1) <= r * r;
}

// ---------------------------------------------------------------- Hurtboxes & Hitboxes

function getFighterBodyDims(fighter: FighterRuntime): { width: number; height: number; hurtHeight: number } {
  const spec = getFighterSpec(fighter.id);
  let width = spec.stats.width;
  let height = spec.stats.height;
  if (fighter.id === FighterId.Nesta) {
    const sizeSpec = requireKey(requireDefined(spec.nestaSizes, 'nesta.nestaSizes'), fighter.nestaSize, 'nestaSizes');
    width *= sizeSpec.scale;
    height *= sizeSpec.scale;
  }
  // Moss's hat is half his height and is NOT part of his hurtbox above the brim (GDD 3.6).
  const hurtHeight = fighter.id === FighterId.Moss ? height * 0.5 : height;
  return { width, height, hurtHeight };
}

export function createHurtboxFrame(fighter: FighterRuntime, tick: number): FighterHurtboxFrame {
  const { width, hurtHeight } = getFighterBodyDims(fighter);
  const radius = Math.min(width, hurtHeight) * 0.5;
  const halfHeight = Math.max(0, hurtHeight * 0.5 - radius);
  return {
    tick,
    x: fighter.x,
    y: fighter.y + hurtHeight * 0.5,
    radius,
    halfHeight,
    state: fighter.state,
    flags: fighter.flags,
  };
}

export function getFighterHurtbox(fighter: FighterRuntime, tickOffsetBack = 0): Capsule {
  const maxRewind = getGameData().tuning.net.lagCompMaxTicks;
  const rewind = Math.min(Math.max(0, Math.round(tickOffsetBack)), maxRewind);
  let frame: FighterHurtboxFrame;
  if (fighter.hurtboxHistory.length > 0) {
    const idx = Math.max(0, fighter.hurtboxHistory.length - 1 - rewind);
    frame = requireDefined(fighter.hurtboxHistory[idx], 'hurtboxHistory[idx]');
  } else {
    frame = createHurtboxFrame(fighter, fighter.lastInputTick);
  }
  return {
    x0: frame.x,
    y0: frame.y - frame.halfHeight,
    x1: frame.x,
    y1: frame.y + frame.halfHeight,
    radius: frame.radius,
  };
}

export function getMoveHitbox(fighter: FighterRuntime, move: MoveSpec): Capsule {
  const spec = getFighterSpec(fighter.id);
  const { width, hurtHeight } = getFighterBodyDims(fighter);
  let reach = move.reach;
  if (fighter.id === FighterId.Nesta) {
    const sizeSpec = requireKey(requireDefined(spec.nestaSizes, 'nesta.nestaSizes'), fighter.nestaSize, 'nestaSizes');
    reach = move.moveClass === MoveClass.Grab ? sizeSpec.grabRange : reach * sizeSpec.scale;
  }

  const facing = (fighter.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;
  const cx = fighter.x;
  const cy = fighter.y + hurtHeight * 0.5;
  const r = Math.max(0.28, Math.min(0.5, width * 0.35));
  const span = Math.max(0.2, reach - r);

  if (move.bothSides || move.id === MoveId.Dspec) {
    const y = move.id === MoveId.Dspec ? fighter.y + r : cy - 0.1;
    return { x0: cx - span, y0: y, x1: cx + span, y1: y, radius: r };
  }
  if (move.id === MoveId.Utilt || move.id === MoveId.Uheavy || move.id === MoveId.Uair || move.id === MoveId.Uspec) {
    return { x0: cx, y0: cy, x1: cx, y1: cy + span, radius: Math.max(r, width * 0.45) };
  }
  if (move.id === MoveId.Dair) {
    return { x0: cx, y0: fighter.y - Math.max(0.1, reach * 0.65 - r), x1: cx, y1: cy, radius: Math.max(r, width * 0.4) };
  }
  if (move.id === MoveId.Dtilt) {
    return { x0: cx + facing * 0.1, y0: fighter.y + r, x1: cx + facing * span, y1: fighter.y + r, radius: r };
  }
  if (move.id === MoveId.Nair) {
    return { x0: cx - width * 0.35, y0: cy, x1: cx + width * 0.35, y1: cy, radius: Math.max(r, width * 0.45) };
  }
  if (move.id === MoveId.Bair) {
    const back = -facing;
    return { x0: cx + back * 0.15, y0: cy, x1: cx + back * span, y1: cy, radius: r };
  }
  const startOff = move.moveClass === MoveClass.Grab ? width * 0.25 : 0.15;
  return { x0: cx + facing * startOff, y0: cy, x1: cx + facing * span, y1: cy, radius: r };
}

// ---------------------------------------------------------------- Strike Resolution

function getArmourThreshold(defender: FighterRuntime): number {
  if (defender.id === FighterId.Grog && defender.activeMove === MoveId.Dash) return 8;
  if (defender.id === FighterId.Grog && defender.activeMove === MoveId.Sspec) {
    return defender.lastMotion === MotionInput.Qcf236 ? 13 : 10;
  }
  return 10;
}

const MISS_RESULT: HitCheckResult = {
  outcome: HitOutcome.Miss,
  damage: 0,
  launchSpeed: 0,
  launchAngleDeg: 0,
  hitstun: 0,
  hitstop: 0,
  blockstun: 0,
  pushbackSpeed: 0,
};

export function resolveStrike(
  attacker: FighterRuntime,
  defender: FighterRuntime,
  move: MoveSpec,
  chargeMult = 1.0,
  isPiping = false,
  isClean = false,
  attackerRewindTicks = 0,
  defenderLatencyTicks = 0,
): HitCheckResult {
  if (defender.state === FighterState.Eliminated || defender.state === FighterState.Teaspoon) {
    return MISS_RESULT;
  }
  const hitbox = getMoveHitbox(attacker, move);
  const hurtbox = getFighterHurtbox(defender, attackerRewindTicks);
  if (!capsulesOverlap(hitbox, hurtbox)) {
    return MISS_RESULT;
  }

  const tuning = getGameData().tuning;
  const facingRight = (attacker.flags & FighterFlag.FacingRight) !== 0;
  const launchAngleDeg = applyLaunchSteering(move.angle, facingRight, InputDir.Neutral);

  if ((defender.flags & FighterFlag.Invuln) !== 0 || defender.invulnFrames > 0) {
    return { ...MISS_RESULT, outcome: HitOutcome.Invuln, launchAngleDeg };
  }

  const isGrab = move.moveClass === MoveClass.Grab;
  const graceTicks = Math.min(Math.max(0, Math.round(defenderLatencyTicks)), tuning.net.defenderGraceMaxTicks);
  const inParryGrace =
    defender.state === FighterState.Guard && defender.parryCooldown <= 0 && defender.stateFrame < graceTicks;

  if (!isGrab && (defender.state === FighterState.Parry || inParryGrace)) {
    return { ...MISS_RESULT, outcome: HitOutcome.Parry, launchAngleDeg };
  }

  let baseDamage = move.damage;
  let kbg = move.kbg;
  if (isPiping && attacker.id === FighterId.Earl && move.id === MoveId.Uspec) kbg = 18;
  if (isClean) {
    if (attacker.id === FighterId.Earl && move.id === MoveId.Sspec) baseDamage = 12.5;
    else if (attacker.id === FighterId.Nesta && move.id === MoveId.Sspec) baseDamage = 10;
    else if (attacker.id === FighterId.Moss && move.id === MoveId.Sspec) baseDamage = 7;
    else if (attacker.id === FighterId.Moss && move.id === MoveId.Uspec) baseDamage = 5;
  }

  let damage = baseDamage;
  let kbMult = 1.0;
  if (attacker.id === FighterId.Nesta) {
    const atkSpec = getFighterSpec(FighterId.Nesta);
    const atkSize = requireKey(requireDefined(atkSpec.nestaSizes, 'nestaSizes'), attacker.nestaSize, 'nestaSizes');
    damage *= atkSize.damageMult;
    kbMult *= atkSize.kbMult;
  }
  const isHeavy = move.moveClass === MoveClass.Heavy;
  if (isHeavy) {
    assertFinite(chargeMult, 'chargeMult');
    damage *= chargeMult;
    kbMult *= chargeMult;
  }

  const defSpec = getFighterSpec(defender.id);
  const defWeight =
    defender.id === FighterId.Nesta
      ? requireKey(requireDefined(defSpec.nestaSizes, 'nestaSizes'), defender.nestaSize, 'nestaSizes').weight
      : defSpec.stats.weight;

  const launchSpeed = computeLaunchSpeed(move.bkb, kbg, defender.damage + damage, defWeight) * kbMult;
  const hitstop = computeHitstop(damage, isHeavy);

  if (!isGrab && (defender.state === FighterState.Guard || defender.state === FighterState.GuardStun)) {
    return {
      outcome: HitOutcome.Block,
      damage,
      launchSpeed,
      launchAngleDeg,
      hitstun: 0,
      hitstop,
      blockstun: computeBlockstun(damage),
      pushbackSpeed: launchSpeed * tuning.guard.pushbackScale,
    };
  }

  if (!isGrab && (defender.flags & FighterFlag.Armour) !== 0 && damage < getArmourThreshold(defender)) {
    return {
      outcome: HitOutcome.Armour,
      damage,
      launchSpeed: 0,
      launchAngleDeg,
      hitstun: 0,
      hitstop,
      blockstun: 0,
      pushbackSpeed: 0,
    };
  }

  const repeatCount = defender.comboHitsByMove.has(move.id)
    ? requireKey(defender.comboHitsByMove, move.id, 'comboHitsByMove')
    : 0;
  const hitstun = isGrab ? 0 : computeHitstun(launchSpeed, defender.comboCount + 1, repeatCount);

  return {
    outcome: HitOutcome.Hit,
    damage,
    launchSpeed,
    launchAngleDeg,
    hitstun,
    hitstop,
    blockstun: 0,
    pushbackSpeed: 0,
  };
}
