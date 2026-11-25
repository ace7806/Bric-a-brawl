import { assertNever } from './assert';
import type { FighterStats, MoveSpec } from './data';
import { FighterFlag, MoveClass, MoveId } from './enums';
import type { FighterRuntime } from './types';

export const AUTO_CANCEL_LANDING_LAG = 3;
export const CHASE_DODGE_WINDOW_FRAMES = 14;
export const CHASE_DODGE_CANCEL_FRAME = 8;
export const CHASE_DODGE_SPEED_MULT = 1.28;
export const SDI_NUDGE_DISTANCE = 0.14;
export const SDI_MAX_NUDGES = 2;

export interface MoveKinematics {
  /** Signed horizontal velocity along facing on startup frame 1 (negative = coiled back-step). */
  readonly windupVx: number;
  /** Signed horizontal velocity along facing on active onset (positive = forward lunge/step-in). */
  readonly activeVx: number;
  /** Airborne vertical impulse on startup frame 1 (e.g. Dair brief hover stall). */
  readonly windupVy: number;
  /** Airborne vertical impulse on active onset (e.g. Dair downward stomp or Uair lift). */
  readonly activeVy: number;
  /** True for grounded tilts/jabs/smashes so forward step-ins stop safely at chunk ledges instead of SD'ing. */
  readonly edgeStop: boolean;
  /** Frames trimmed off late dead recovery ONLY when the move lands an unblocked Hit/Throw (never on Block/whiff). */
  readonly onHitIasaTrim: number;
}

const ZERO_KINEMATICS: MoveKinematics = {
  windupVx: 0,
  activeVx: 0,
  windupVy: 0,
  activeVy: 0,
  edgeStop: false,
  onHitIasaTrim: 0,
};

/** Platform-fighter per-move step-ins, lunges, recoils, edge-stop rules, and on-hit combo IASA windows. */
export function getMoveKinematics(moveId: MoveId): MoveKinematics {
  switch (moveId) {
    case MoveId.None:
      return ZERO_KINEMATICS;
    case MoveId.Jab1:
      return { windupVx: 0, activeVx: 3.0, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 3 };
    case MoveId.Jab2:
      return { windupVx: 0, activeVx: 3.8, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 3 };
    case MoveId.Jab3:
      return { windupVx: -1.1, activeVx: 5.6, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 4 };
    case MoveId.Ftilt:
      return { windupVx: -0.9, activeVx: 5.8, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 5 };
    case MoveId.Utilt:
      return { windupVx: 0, activeVx: 3.2, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 10 };
    case MoveId.Dtilt:
      return { windupVx: 0, activeVx: 5.4, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 9 };
    case MoveId.Dash:
      return { windupVx: 0, activeVx: 0, windupVy: 0, activeVy: 0, edgeStop: false, onHitIasaTrim: 5 };
    case MoveId.Fheavy:
      return { windupVx: -2.2, activeVx: 9.2, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 0 };
    case MoveId.Uheavy:
      return { windupVx: -1.0, activeVx: 3.6, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 0 };
    case MoveId.Dheavy:
      return { windupVx: 0, activeVx: 2.6, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 0 };
    case MoveId.Nair:
      return { windupVx: 0, activeVx: 0.6, windupVy: 0, activeVy: 0, edgeStop: false, onHitIasaTrim: 6 };
    case MoveId.Fair:
      return { windupVx: 0, activeVx: 2.0, windupVy: 0, activeVy: 0, edgeStop: false, onHitIasaTrim: 6 };
    case MoveId.Bair:
      // Reverse kick propels attacker slightly toward their facing (opposite of strike direction) for crisp Smash spacing
      return { windupVx: 0, activeVx: 2.4, windupVy: 0, activeVy: 0, edgeStop: false, onHitIasaTrim: 5 };
    case MoveId.Uair:
      return { windupVx: 0, activeVx: 0, windupVy: 0, activeVy: 2.2, edgeStop: false, onHitIasaTrim: 6 };
    case MoveId.Dair:
      // Classic Smash/Brawlhalla brief hover-stall on startup followed by punchy downward stomp impulse on active
      return { windupVx: 0, activeVx: 0, windupVy: 2.6, activeVy: -5.2, edgeStop: false, onHitIasaTrim: 5 };
    case MoveId.Grab:
      return { windupVx: 0, activeVx: 4.8, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 0 };
    case MoveId.Fthrow:
    case MoveId.Bthrow:
      return { windupVx: 0, activeVx: 0, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 4 };
    case MoveId.Uthrow:
    case MoveId.Dthrow:
      return { windupVx: 0, activeVx: 0, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 9 };
    case MoveId.Ledge:
      return { windupVx: 0, activeVx: 4.8, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 3 };
    case MoveId.Getup:
      return { windupVx: 0, activeVx: 3.0, windupVy: 0, activeVy: 0, edgeStop: true, onHitIasaTrim: 3 };
    case MoveId.Nspec:
    case MoveId.Sspec:
    case MoveId.Uspec:
    case MoveId.Dspec:
      return ZERO_KINEMATICS;
    default:
      return assertNever(moveId, 'getMoveKinematics');
  }
}

/** Applies subtle windup pullback / aerial hover-stall on startup frame 1. */
export function applyMoveWindupKinematics(f: FighterRuntime, moveId: MoveId): void {
  const k = getMoveKinematics(moveId);
  const grounded = (f.flags & FighterFlag.Grounded) !== 0;
  const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;

  if (grounded && k.windupVx !== 0 && Math.abs(f.vx) < 2.5) {
    f.vx = facing * k.windupVx;
  }
  if (!grounded && k.windupVy > 0 && f.vy < k.windupVy) {
    f.vy = k.windupVy;
  }
}

/** Applies physical forward lunge, step-in, Bair opposite recoil, or Dair stomp on active onset. */
export function applyMoveActiveKinematics(
  f: FighterRuntime,
  moveId: MoveId,
  stats: FighterStats,
  chargeRatio: number,
): void {
  const k = getMoveKinematics(moveId);
  const grounded = (f.flags & FighterFlag.Grounded) !== 0;
  const facing = (f.flags & FighterFlag.FacingRight) !== 0 ? 1 : -1;

  if (grounded) {
    if (k.activeVx !== 0) {
      const chargeBoost = moveId === MoveId.Fheavy ? 1 + 0.25 * chargeRatio : 1;
      const targetVx = facing * k.activeVx * chargeBoost;
      // Preserve existing dash-grab / running slide speed if already moving faster in the lunge direction
      if (Math.sign(f.vx) === Math.sign(targetVx) && Math.abs(f.vx) > Math.abs(targetVx)) {
        f.vx = f.vx * 0.92;
      } else {
        f.vx = targetVx;
      }
    }
  } else {
    if (k.activeVx !== 0) {
      const cap = stats.airSpeed * 1.15;
      f.vx = Math.max(-cap, Math.min(cap, f.vx + facing * k.activeVx));
    }
    if (k.activeVy < 0) {
      f.vy = Math.min(f.vy, k.activeVy);
    } else if (k.activeVy > 0 && f.vy < k.activeVy) {
      f.vy = Math.min(k.activeVy, f.vy + k.activeVy * 0.65);
    }
  }
}

/**
 * On-Hit IASA (First Actionable Frame): when a melee strike or combo throw connects UNBLOCKED
 * (`moveHitLanded === true`), the attacker can cancel late follow-through frames into Jump, Dash,
 * Chase-Dodge, or a combo follow-up without ever altering `onBlock` or whiff punishment frames.
 */
export function canHitCancelMove(f: FighterRuntime, move: MoveSpec, st: number): boolean {
  if (!f.moveHitLanded) return false;
  const k = getMoveKinematics(move.id);
  if (k.onHitIasaTrim <= 0) return false;
  const activeEnd = st + move.active;
  const minFollowThrough = Math.min(move.total, activeEnd + 2);
  const iasaFrame = Math.max(minFollowThrough, move.total - k.onHitIasaTrim);
  return f.moveFrame >= iasaFrame;
}

/**
 * Smash-style aerial auto-cancel: landing during early startup (before hitbox appears) or late
 * recovery (well after hitbox ends) cancels into a crisp 3-frame standard landing instead of full landingLag.
 */
export function shouldAutoCancelAerial(move: MoveSpec, st: number, moveFrame: number): boolean {
  if (move.moveClass !== MoveClass.Air) return false;
  if (moveFrame <= 2) return true;
  const lateAcFrame = Math.max(st + move.active + 4, move.total - 5);
  return moveFrame >= lateAcFrame;
}
