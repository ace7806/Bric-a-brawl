import * as THREE from 'three';
import { assertNever } from '@sim/assert';
import { getMoveSpec } from '@sim/data';
import { FighterId, FighterState, MoveId } from '@sim/enums';
import type { SnapshotFighter } from '@net/codec';

export interface BoneSlot {
  readonly bone: THREE.Bone;
  readonly restPos: THREE.Vector3;
  readonly restQuat: THREE.Quaternion;
}

export interface FighterBoneRig {
  readonly fighterId: FighterId;
  readonly body: BoneSlot;
  readonly lid: BoneSlot | null;
  readonly head: BoneSlot | null;
  readonly hat: BoneSlot | null;
  readonly rod: BoneSlot | null;
  readonly handF: BoneSlot | null;
  readonly handB: BoneSlot | null;
  readonly footF: BoneSlot | null;
  readonly footB: BoneSlot | null;
  readonly hoofFL: BoneSlot | null;
  readonly hoofFR: BoneSlot | null;
  readonly hoofBL: BoneSlot | null;
  readonly hoofBR: BoneSlot | null;
}

export interface FighterAnimRuntime {
  boilPhase: number;
  squashY: number;
  squashVel: number;
  leanRad: number;
  leanVel: number;
  secPosY: number;
  secVelY: number;
  secRotZ: number;
  secRotVel: number;
  wasGrounded: boolean;
  wasHitstop: boolean;
  wasAttackActive: boolean;
  jitterSeed: number;
  facingYaw: number;
  rattleClock: number;
}

interface PoseSample {
  bodyX: number;
  bodyY: number;
  bodyPitchZ: number;
  bodyRollX: number;
  bodyYawY: number;
  pivotAroundCom: boolean;
  handFX: number;
  handFY: number;
  handFZ: number;
  handFRotZ: number;
  handFScale: number;
  handBX: number;
  handBY: number;
  handBZ: number;
  handBRotZ: number;
  handBScale: number;
  footFX: number;
  footFY: number;
  footFScale: number;
  footBX: number;
  footBY: number;
  footBScale: number;
  lidX: number;
  lidY: number;
  lidPitchZ: number;
  lidScale: number;
  headX: number;
  headY: number;
  headPitchZ: number;
  headScale: number;
  hatPitchZ: number;
  rodPitchZ: number;
  rodYawY: number;
  rodY: number;
  rodScale: number;
  hoofFrontX: number;
  hoofFrontY: number;
  hoofFrontPitchZ: number;
  hoofFrontScale: number;
  hoofBackX: number;
  hoofBackY: number;
  hoofBackPitchZ: number;
  hoofBackScale: number;
  squashBias: number;
}

// ART_BIBLE 42° camera cheat: GLB +X is forward, +Y is up, +Z is toward camera.
// Right-handed Y rotation: R_y(a)*(1,0,0) = (cos a, 0, -sin a). Negative angles turn +X toward +Z camera:
// Right facing = -42° (-0.733 rad); Left facing = -138° (-2.409 rad), pivoting cleanly through front (-90°).
export const FACING_RIGHT_YAW = -(42 * Math.PI) / 180;
export const FACING_LEFT_YAW = -(Math.PI - (42 * Math.PI) / 180);

const COM_Y_BY_FIGHTER: Record<FighterId, number> = {
  [FighterId.Earl]: 0.78,
  [FighterId.Grog]: 0.96,
  [FighterId.Nesta]: 0.75,
  [FighterId.Moss]: 0.65,
};

const EULER_TMP = new THREE.Euler();
const QUAT_TMP = new THREE.Quaternion();
const VEC_TMP = new THREE.Vector3();

export function createFighterAnimRuntime(slot: number): FighterAnimRuntime {
  return {
    boilPhase: slot * 1.7,
    squashY: 1.0,
    squashVel: 0,
    leanRad: 0,
    leanVel: 0,
    secPosY: 0,
    secVelY: 0,
    secRotZ: 0,
    secRotVel: 0,
    wasGrounded: true,
    wasHitstop: false,
    wasAttackActive: false,
    jitterSeed: slot * 13 + 7,
    facingYaw: FACING_RIGHT_YAW,
    rattleClock: 0,
  };
}

function zeroPose(): PoseSample {
  return {
    bodyX: 0, bodyY: 0, bodyPitchZ: 0, bodyRollX: 0, bodyYawY: 0, pivotAroundCom: false,
    handFX: 0, handFY: 0, handFZ: 0, handFRotZ: 0, handFScale: 1,
    handBX: 0, handBY: 0, handBZ: 0, handBRotZ: 0, handBScale: 1,
    footFX: 0, footFY: 0, footFScale: 1,
    footBX: 0, footBY: 0, footBScale: 1,
    lidX: 0, lidY: 0, lidPitchZ: 0, lidScale: 1,
    headX: 0, headY: 0, headPitchZ: 0, headScale: 1,
    hatPitchZ: 0,
    rodPitchZ: 0, rodYawY: 0, rodY: 0, rodScale: 1,
    hoofFrontX: 0, hoofFrontY: 0, hoofFrontPitchZ: 0, hoofFrontScale: 1,
    hoofBackX: 0, hoofBackY: 0, hoofBackPitchZ: 0, hoofBackScale: 1,
    squashBias: 0,
  };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const easeOutQuad = (u: number): number => 1 - (1 - u) * (1 - u);
const easeOutCubic = (u: number): number => {
  const k = 1 - u;
  return 1 - k * k * k;
};
const easeInQuad = (u: number): number => u * u;

function stepSpring(val: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const diff = val - target;
  const e = Math.exp(-omega * dt);
  const next = target + (diff + (vel + omega * diff) * dt) * e;
  const nextVel = (vel - omega * (vel + omega * diff) * dt) * e;
  return [next, nextVel];
}

interface AttackPhase {
  readonly t: number;
  readonly isWindup: boolean;
  readonly isActive: boolean;
  readonly wind: number;    // 0 -> 1 coiled anticipation during startup
  readonly snap: number;    // 0 -> 1 explosive snap on active + smooth follow-through decay
  readonly popScale: number; // 0 -> 1 exaggerated Smash limb scale pop on active frames
}

function evalAttackPhase(fighterId: FighterId, moveId: MoveId, frame: number): AttackPhase {
  const spec = getMoveSpec(fighterId, moveId);
  const total = Math.max(1, spec.total);
  const st = Math.max(1, spec.startup);
  const actEnd = st + Math.max(3, spec.active);
  const t = clamp(frame / total, 0, 1);

  if (frame < st) {
    const u = clamp(frame / st, 0, 1);
    return { t, isWindup: true, isActive: false, wind: easeOutQuad(u), snap: 0, popScale: 0 };
  }
  if (frame <= actEnd) {
    const u = clamp((frame - st) / Math.max(1, actEnd - st), 0, 1);
    // Smash 1-frame snap: jump straight to peak extension with tiny punch overshoot
    const snap = 1.0 + Math.sin(u * Math.PI) * 0.12;
    return { t, isWindup: false, isActive: true, wind: 0, snap, popScale: 1.0 - u * 0.18 };
  }
  const rec = clamp((frame - actEnd) / Math.max(1, total - actEnd), 0, 1);
  // Hold the follow-through pose briefly then ease back cleanly
  const decay = 1 - easeInQuad(rec);
  return { t, isWindup: false, isActive: false, wind: 0, snap: decay, popScale: decay * 0.35 };
}

function sampleMovePose(fighterId: FighterId, moveId: MoveId, frame: number): PoseSample {
  const p = zeroPose();
  if (moveId === MoveId.None) return p;

  const ph = evalAttackPhase(fighterId, moveId, frame);
  const w = ph.wind;
  const s = ph.snap;
  const pop = ph.popScale;
  const dir = s - w * 0.65;

  switch (moveId) {
    case MoveId.Jab1:
      // Crisp front-side jab flick / quick horn jab / level rod poke
      p.bodyX = -0.14 * w + 0.30 * s;
      p.bodyPitchZ = 0.14 * w - 0.18 * s;
      p.bodyYawY = -0.22 * w + 0.36 * s;
      p.handFX = -0.26 * w + 0.78 * s;
      p.handFY = 0.12 * w + 0.28 * s;
      p.handFZ = -0.44 * s;
      p.handFRotZ = -0.25 * s;
      p.handFScale = 1 + 0.48 * pop;
      p.handBX = -0.24 * s;
      p.handBY = 0.08 * s;
      p.headX = -0.08 * w + 0.16 * s;
      p.headY = 0.05 * s;
      p.headPitchZ = 0.16 * w - 0.32 * s;
      p.headScale = 1 + 0.28 * pop;
      p.hoofFrontX = 0.28 * s;
      p.hoofFrontY = 0.16 * s;
      p.hoofFrontPitchZ = 0.42 * s;
      p.rodPitchZ = 0.58 * w - 0.48 * s;
      p.rodY = 0.12 * s;
      p.rodScale = 1 + 0.25 * pop;
      p.lidY = 0.12 * s;
      p.squashBias = -0.10 * w + 0.08 * pop;
      break;

    case MoveId.Jab2:
      // Opposite-hand cross hook / sweeping horn cross / backhand rod whip
      p.bodyX = -0.12 * w + 0.36 * s;
      p.bodyPitchZ = 0.14 * w - 0.22 * s;
      p.bodyYawY = 0.28 * w - 0.32 * s;
      p.handBX = -0.24 * w + 0.84 * s;
      p.handBY = 0.14 * w + 0.32 * s;
      p.handBZ = 0.46 * s;
      p.handBRotZ = -0.30 * s;
      p.handBScale = 1 + 0.52 * pop;
      p.handFX = -0.28 * s;
      p.handFY = 0.10 * s;
      p.headX = -0.10 * w + 0.18 * s;
      p.headY = 0.10 * s;
      p.headPitchZ = -0.16 * w + 0.28 * s;
      p.headScale = 1 + 0.30 * pop;
      p.hoofFrontX = 0.34 * s;
      p.hoofFrontY = 0.20 * s;
      p.rodPitchZ = -0.35 * w + 0.42 * s;
      p.rodYawY = -0.65 * s;
      p.rodY = 0.14 * s;
      p.rodScale = 1 + 0.25 * pop;
      p.lidY = 0.16 * s;
      p.lidPitchZ = -0.18 * s;
      p.squashBias = -0.10 * w + 0.10 * pop;
      break;

    case MoveId.Jab3:
      // Committed combo finisher: double-glove thrust / full horn thrust / heavy rod lash
      p.bodyX = -0.24 * w + 0.48 * s;
      p.bodyPitchZ = 0.20 * w - 0.26 * s;
      p.bodyYawY = -0.24 * w + 0.38 * s;
      p.handFX = -0.32 * w + 0.88 * s;
      p.handFY = 0.18 * w + 0.34 * s;
      p.handFZ = -0.46 * s;
      p.handFScale = 1 + 0.58 * pop;
      p.handBX = -0.24 * w + 0.72 * s;
      p.handBY = 0.14 * w + 0.26 * s;
      p.handBZ = 0.40 * s;
      p.handBScale = 1 + 0.44 * pop;
      p.headX = -0.10 * w + 0.20 * s;
      p.headY = 0.08 * s;
      p.headPitchZ = 0.24 * w - 0.42 * s;
      p.headScale = 1 + 0.36 * pop;
      p.lidX = 0.08 * s;
      p.lidY = 0.24 * s;
      p.lidPitchZ = -0.32 * s;
      p.rodPitchZ = 0.78 * w - 0.52 * s;
      p.rodY = 0.16 * s;
      p.rodScale = 1 + 0.32 * pop;
      p.squashBias = -0.16 * w + 0.14 * pop;
      break;

    case MoveId.Ftilt:
    case MoveId.Ledge:
    case MoveId.Getup:
      // Long-reach forward strike with shoulder snap & level horizontal rod slash
      p.bodyX = -0.20 * w + 0.44 * s;
      p.bodyPitchZ = 0.18 * w - 0.22 * s;
      p.bodyYawY = -0.24 * w + 0.42 * s;
      p.handFX = -0.28 * w + 0.68 * s;
      p.handFY = 0.22 * w + 0.30 * s;
      p.handFZ = -0.46 * s;
      p.handFRotZ = -0.28 * s;
      p.handFScale = 1 + 0.54 * pop;
      p.handBX = -0.30 * s;
      p.handBY = 0.12 * s;
      p.headX = -0.10 * w + 0.20 * s;
      p.headY = 0.06 * s;
      p.headPitchZ = 0.22 * w - 0.38 * s;
      p.headScale = 1 + 0.34 * pop;
      p.hoofFrontX = 0.32 * s;
      p.hoofFrontY = 0.20 * s;
      p.hoofFrontPitchZ = 0.50 * s;
      p.rodPitchZ = 0.85 * w - 0.50 * s;
      p.rodYawY = 0.24 * s;
      p.rodY = 0.18 * s;
      p.rodScale = 1 + 0.32 * pop;
      p.lidY = 0.18 * s;
      p.squashBias = -0.14 * w + 0.12 * pop;
      break;

    case MoveId.Utilt:
    case MoveId.Uair:
    case MoveId.Uthrow:
      // Crouch coil -> explosive upward uppercut / lid-pop / horn-toss / rod overhead arc
      p.bodyY = -0.14 * w + 0.20 * s;
      p.bodyPitchZ = -0.16 * w + 0.26 * s;
      p.bodyYawY = -0.20 * w + 0.28 * s;
      p.handFX = 0.28 * s;
      p.handFY = -0.18 * w + 0.92 * s;
      p.handFZ = -0.36 * s;
      p.handFScale = 1 + 0.52 * pop;
      p.handBY = -0.14 * w + 0.76 * s;
      p.handBScale = 1 + 0.38 * pop;
      p.lidY = -0.04 * w + 0.56 * s;
      p.lidPitchZ = 0.42 * s;
      p.lidScale = 1 + 0.30 * pop;
      p.headY = -0.12 * w + 0.26 * s;
      p.headX = 0.12 * s;
      p.headPitchZ = -0.30 * w + 0.64 * s;
      p.headScale = 1 + 0.36 * pop;
      p.hoofFrontY = 0.34 * s;
      p.hoofFrontPitchZ = 0.65 * s;
      p.hatPitchZ = -0.52 * s;
      p.rodPitchZ = -0.55 * w + 0.82 * s;
      p.rodY = 0.32 * s;
      p.rodScale = 1 + 0.28 * pop;
      p.squashBias = -0.20 * w + 0.20 * pop;
      break;

    case MoveId.Dtilt:
      // Low sweeping kick / low horn poke / low rod skim
      p.bodyX = -0.12 * w + 0.36 * s;
      p.bodyY = -0.14 * w - 0.16 * s;
      p.bodyPitchZ = 0.12 * w - 0.22 * s;
      p.bodyYawY = -0.22 * w + 0.42 * s;
      p.footFX = 0.62 * s;
      p.footFY = 0.12 * s;
      p.footFScale = 1 + 0.52 * pop;
      p.handFX = 0.64 * s;
      p.handFY = -0.04 * s;
      p.handFZ = -0.38 * s;
      p.handFScale = 1 + 0.42 * pop;
      p.headX = 0.18 * s;
      p.headY = -0.16 * s;
      p.headPitchZ = -0.42 * s;
      p.hoofFrontX = 0.46 * s;
      p.hoofFrontPitchZ = 0.56 * s;
      p.hoofFrontScale = 1 + 0.42 * pop;
      p.rodPitchZ = 0.42 * w - 0.72 * s;
      p.rodY = -0.06 * s;
      p.squashBias = -0.22 * (w + s * 0.5);
      break;

    case MoveId.Dair:
      // Meteor stomp / downward spike slam
      p.pivotAroundCom = true;
      p.bodyY = 0.18 * w - 0.16 * s;
      p.bodyPitchZ = 0.28 * w - 0.34 * s;
      p.footFX = 0.18 * s;
      p.footFY = 0.18 * w - 0.38 * s;
      p.footBX = -0.12 * s;
      p.footBY = 0.16 * w - 0.34 * s;
      p.footFScale = 1 + 0.58 * pop;
      p.footBScale = 1 + 0.45 * pop;
      p.handFY = 0.38 * w - 0.36 * s;
      p.handBY = 0.32 * w - 0.32 * s;
      p.handFScale = 1 + 0.45 * pop;
      p.hoofFrontY = 0.26 * w - 0.38 * s;
      p.hoofBackY = 0.20 * w - 0.32 * s;
      p.hoofFrontScale = 1 + 0.48 * pop;
      p.rodPitchZ = 0.85 * w - 0.95 * s;
      p.squashBias = -0.20 * w + 0.22 * pop;
      break;

    case MoveId.Dash:
      // Explosive shoulder-check / lunging tackle
      p.bodyX = -0.16 * w + 0.50 * s;
      p.bodyY = 0.08 * s;
      p.bodyPitchZ = 0.18 * w - 0.32 * s;
      p.bodyYawY = 0.32 * s;
      p.handFX = 0.74 * s;
      p.handFY = 0.26 * s;
      p.handFZ = -0.40 * s;
      p.handFScale = 1 + 0.48 * pop;
      p.handBX = -0.42 * s;
      p.handBY = 0.14 * s;
      p.headX = 0.20 * s;
      p.headY = 0.02 * s;
      p.headPitchZ = -0.42 * s;
      p.headScale = 1 + 0.34 * pop;
      p.hoofFrontX = 0.38 * s;
      p.hoofFrontY = 0.26 * s;
      p.hoofFrontPitchZ = 0.62 * s;
      p.hoofBackX = -0.34 * s;
      p.rodPitchZ = 0.65 * w - 0.58 * s;
      p.rodY = 0.12 * s;
      p.squashBias = -0.16 * w + 0.16 * pop;
      break;

    case MoveId.Fheavy:
    case MoveId.Uheavy:
    case MoveId.Dheavy: {
      // SMASH ATTACKS: massive coiled pullback -> explosive forward lunge & oversized striking limb pop!
      if (moveId === MoveId.Uheavy) {
        p.bodyY = -0.22 * w + 0.28 * s;
        p.bodyPitchZ = -0.24 * w + 0.36 * s;
        p.handFX = 0.30 * s;
        p.handFY = -0.24 * w + 1.05 * s;
        p.handBY = -0.20 * w + 0.92 * s;
        p.handFScale = 1 + 0.66 * pop;
        p.handBScale = 1 + 0.56 * pop;
        p.lidY = -0.02 * w + 0.68 * s;
        p.lidPitchZ = 0.52 * s;
        p.lidScale = 1 + 0.42 * pop;
        p.headY = -0.16 * w + 0.32 * s;
        p.headX = 0.14 * s;
        p.headPitchZ = -0.38 * w + 0.78 * s;
        p.headScale = 1 + 0.44 * pop;
        p.hoofFrontY = 0.46 * s;
        p.hoofFrontPitchZ = 0.82 * s;
        p.rodPitchZ = -0.68 * w + 0.96 * s;
        p.rodY = 0.38 * s;
        p.rodScale = 1 + 0.40 * pop;
        p.squashBias = -0.26 * w + 0.28 * pop;
      } else if (moveId === MoveId.Dheavy) {
        // 360-degree heavy spin sweep hitting both sides
        p.bodyY = -0.16 * w - 0.10 * s;
        p.bodyYawY = ph.isWindup ? -0.35 * w : easeOutCubic(clamp((ph.t - 0.2) / 0.6, 0, 1)) * Math.PI * 2.15;
        p.bodyPitchZ = -0.16 * s;
        p.handFX = 0.80 * s;
        p.handFY = 0.16 * s;
        p.handBX = -0.80 * s;
        p.handBY = 0.16 * s;
        p.handFScale = 1 + 0.60 * pop;
        p.handBScale = 1 + 0.60 * pop;
        p.headX = 0.20 * s;
        p.headScale = 1 + 0.38 * pop;
        p.hoofFrontX = 0.44 * s;
        p.hoofBackX = -0.44 * s;
        p.hoofFrontScale = 1 + 0.46 * pop;
        p.hoofBackScale = 1 + 0.46 * pop;
        p.rodPitchZ = -0.65 * s;
        p.rodScale = 1 + 0.38 * pop;
        p.lidY = 0.28 * s;
        p.squashBias = -0.24 * (w + 0.4 * s);
      } else {
        // Forward Heavy Smash: Earl Lid Crash & Fist Ram, Grog Horn Gore, Nesta Double Slam, Moss Power Cast
        p.bodyX = -0.34 * w + 0.56 * s;
        p.bodyY = -0.10 * w + 0.08 * s;
        p.bodyPitchZ = 0.24 * w - 0.24 * s;
        p.bodyYawY = -0.26 * w + 0.44 * s;
        p.handFX = -0.38 * w + 0.94 * s;
        p.handFY = 0.28 * w + 0.34 * s;
        p.handFZ = -0.52 * s;
        p.handFRotZ = 0.32 * w - 0.40 * s;
        p.handFScale = 1 + 0.72 * pop;
        p.handBX = -0.34 * w + 0.58 * s;
        p.handBY = 0.16 * w + 0.22 * s;
        p.handBZ = 0.38 * s;
        p.handBScale = 1 + 0.46 * pop;
        p.lidX = -0.06 * w + 0.12 * s;
        p.lidY = 0.24 * w + 0.30 * s;
        p.lidPitchZ = 0.34 * w - 0.44 * s;
        p.lidScale = 1 + 0.32 * pop;
        p.headX = -0.14 * w + 0.24 * s;
        p.headY = 0.16 * w + 0.08 * s;
        p.headPitchZ = 0.34 * w - 0.46 * s;
        p.headScale = 1 + 0.40 * pop;
        p.hoofFrontX = -0.20 * w + 0.42 * s;
        p.hoofFrontY = 0.34 * w + 0.22 * s;
        p.hoofFrontPitchZ = 0.68 * s;
        p.rodPitchZ = 0.98 * w - 0.58 * s;
        p.rodYawY = 0.28 * s;
        p.rodY = 0.22 * w + 0.16 * s;
        p.rodScale = 1 + 0.40 * pop;
        p.squashBias = -0.24 * w + 0.22 * pop;
      }
      break;
    }

    case MoveId.Nair:
      p.pivotAroundCom = true;
      p.bodyYawY = easeOutQuad(ph.t) * Math.PI * 2.5;
      p.bodyPitchZ = -0.18 * s;
      p.handFX = 0.68 * s;
      p.handFY = 0.16 * s;
      p.handBX = -0.68 * s;
      p.handBY = 0.16 * s;
      p.handFScale = 1 + 0.48 * pop;
      p.handBScale = 1 + 0.48 * pop;
      p.hoofFrontX = 0.38 * s;
      p.hoofBackX = -0.38 * s;
      p.rodPitchZ = -0.55 * s;
      p.squashBias = 0.14 * pop;
      break;

    case MoveId.Fair:
      p.pivotAroundCom = true;
      p.bodyX = -0.16 * w + 0.40 * s;
      p.bodyPitchZ = 0.24 * w - 0.32 * s;
      p.bodyYawY = -0.26 * w + 0.42 * s;
      p.handFX = -0.28 * w + 0.86 * s;
      p.handFY = 0.34 * w + 0.16 * s;
      p.handFZ = -0.44 * s;
      p.handFScale = 1 + 0.56 * pop;
      p.headX = 0.20 * s;
      p.headPitchZ = -0.45 * s;
      p.headScale = 1 + 0.34 * pop;
      p.rodPitchZ = 0.92 * w - 0.62 * s;
      p.rodScale = 1 + 0.34 * pop;
      p.squashBias = -0.14 * w + 0.16 * pop;
      break;

    case MoveId.Bair:
      // Reverse mule-kick / spinning backhand!
      p.pivotAroundCom = true;
      p.bodyX = 0.16 * w - 0.38 * s;
      p.bodyPitchZ = -0.20 * w + 0.36 * s;
      p.bodyYawY = 0.28 * w - 0.48 * s;
      p.handFX = -0.70 * s;
      p.handFY = 0.18 * s;
      p.handBX = -0.84 * s;
      p.handBY = 0.22 * s;
      p.handBScale = 1 + 0.55 * pop;
      p.footBX = -0.78 * s;
      p.footBY = 0.24 * s;
      p.footBScale = 1 + 0.62 * pop;
      p.hoofBackX = -0.68 * s;
      p.hoofBackY = 0.34 * s;
      p.hoofBackPitchZ = -0.88 * s;
      p.hoofBackScale = 1 + 0.58 * pop;
      p.rodPitchZ = -0.35 * w + 0.95 * s;
      p.rodYawY = Math.PI * 0.72 * s;
      p.squashBias = -0.14 * w + 0.18 * pop;
      break;

    case MoveId.Grab:
    case MoveId.Fthrow:
    case MoveId.Bthrow:
    case MoveId.Dthrow: {
      const back = moveId === MoveId.Bthrow;
      p.bodyX = (back ? -0.30 : 0.36) * s;
      p.bodyPitchZ = (back ? 0.32 : -0.22) * s;
      p.bodyYawY = (back ? -0.36 : 0.32) * s;
      p.handFX = (back ? -0.66 : 0.78) * s;
      p.handBX = (back ? -0.60 : 0.72) * s;
      p.handFY = 0.28 * s;
      p.handBY = 0.24 * s;
      p.handFZ = -0.32 * s;
      p.handBZ = 0.32 * s;
      p.handFScale = 1 + 0.44 * pop;
      p.handBScale = 1 + 0.44 * pop;
      p.headX = (back ? -0.14 : 0.20) * s;
      p.rodPitchZ = (back ? 0.85 : -0.52) * s;
      p.squashBias = 0.14 * pop;
      break;
    }

    case MoveId.Uspec:
      p.pivotAroundCom = true;
      p.bodyY = -0.14 * w + 0.24 * s;
      p.bodyPitchZ = -0.16 * s;
      p.lidY = fighterId === FighterId.Earl ? 0.78 * Math.sin(Math.min(1, ph.t * 1.4) * Math.PI) : 0;
      p.lidPitchZ = -0.36 * dir;
      p.lidScale = 1 + 0.32 * pop;
      p.handFY = 0.78 * Math.sin(ph.t * Math.PI);
      p.handBY = 0.78 * Math.sin(ph.t * Math.PI);
      p.handFScale = 1 + 0.38 * pop;
      p.hoofFrontY = 0.48 * Math.sin(ph.t * Math.PI);
      p.hoofFrontPitchZ = 0.72;
      p.headY = 0.24 * s;
      p.headPitchZ = 0.56 * s;
      p.rodPitchZ = 0.72 * s;
      p.rodY = 0.30 * s;
      p.squashBias = -0.20 * w + 0.24 * Math.sin(ph.t * Math.PI);
      break;

    case MoveId.Nspec:
    case MoveId.Sspec:
    case MoveId.Dspec:
      if (fighterId === FighterId.Earl) {
        p.bodyX = moveId === MoveId.Sspec ? 0.44 * s : -0.12 * w + 0.20 * s;
        p.bodyPitchZ = moveId === MoveId.Sspec ? -0.28 * s : moveId === MoveId.Dspec ? 0.10 : 0.18 * w - 0.20 * s;
        p.lidY = moveId === MoveId.Nspec ? 0.46 * Math.sin(ph.t * Math.PI) : 0.24 * s;
        p.lidPitchZ = moveId === MoveId.Sspec ? -0.36 * s : 0.22 * Math.sin(frame * 0.8);
        p.handFX = 0.68 * s;
        p.handFY = 0.24 * s;
        p.handBX = 0.45 * s;
        p.handBY = 0.18 * s;
        p.handFScale = 1 + 0.40 * pop;
        p.squashBias = moveId === MoveId.Dspec ? -0.16 + Math.sin(frame * 0.6) * 0.06 : -0.16 * w + 0.16 * pop;
      } else if (fighterId === FighterId.Grog) {
        if (moveId === MoveId.Dspec) {
          // Rearing earth-shaker front hoof stamp!
          p.bodyPitchZ = 0.42 * w - 0.22 * s;
          p.bodyY = 0.28 * w - 0.12 * s;
          p.hoofFrontY = 0.68 * w - 0.16 * s;
          p.hoofFrontPitchZ = 0.82 * w - 0.35 * s;
          p.hoofFrontScale = 1 + 0.52 * pop;
          p.headPitchZ = 0.38 * w - 0.34 * s;
          p.squashBias = 0.14 * w - 0.28 * pop;
        } else {
          // Furious bull stampede / snort!
          const stride = Math.sin(frame * 0.72);
          p.bodyX = 0.36 * s;
          p.bodyPitchZ = -0.20;
          p.headX = 0.20 * s;
          p.headY = -0.06;
          p.headPitchZ = -0.44;
          p.headScale = 1 + 0.34 * pop;
          p.hoofFrontX = 0.34 * stride;
          p.hoofFrontY = 0.24 * Math.max(0, stride);
          p.hoofFrontPitchZ = 0.70 * stride;
          p.hoofBackX = -0.34 * stride;
          p.hoofBackY = 0.24 * Math.max(0, -stride);
          p.hoofBackPitchZ = -0.70 * stride;
          p.squashBias = 0.10 * pop;
        }
      } else if (fighterId === FighterId.Nesta) {
        p.bodyYawY = moveId === MoveId.Dspec ? 0 : ph.t * Math.PI * 6;
        p.bodyX = moveId === MoveId.Sspec ? 0.44 * s : 0;
        p.bodyPitchZ = moveId === MoveId.Sspec ? -0.26 * s : 0;
        p.handFX = 0.68 * s;
        p.handBX = -0.68 * s;
        p.handFY = moveId === MoveId.Dspec ? 0.52 * Math.sin(ph.t * Math.PI) : 0.26;
        p.handBY = p.handFY;
        p.handFScale = 1 + 0.46 * pop;
        p.handBScale = 1 + 0.46 * pop;
        p.squashBias = moveId === MoveId.Dspec ? 0.24 * Math.sin(ph.t * Math.PI) : 0.12 * pop;
      } else {
        // Moss Cast / Bobber / Gone Fishin'
        p.bodyX = -0.20 * w + 0.36 * s;
        p.bodyPitchZ = 0.24 * w - 0.20 * s;
        p.bodyYawY = -0.26 * w + 0.40 * s;
        p.rodPitchZ = 0.95 * w - 0.56 * s;
        p.rodY = 0.24 * s;
        p.rodScale = 1 + 0.36 * pop;
        p.handFX = -0.24 * w + 0.60 * s;
        p.handFY = 0.22 * w + 0.26 * s;
        p.handFZ = -0.32 * s;
        p.hatPitchZ = -0.26 * w + 0.36 * s;
        p.squashBias = -0.16 * w + 0.16 * pop;
      }
      break;

    default:
      assertNever(moveId, 'sampleMovePose');
  }
  return p;
}

function sampleStatePose(f: SnapshotFighter & { id?: FighterId }, simTimeSec: number): PoseSample {
  const p = zeroPose();
  const s = f.state;
  switch (s) {
    case FighterState.Idle:
      p.handFY = 0.04 * Math.sin(simTimeSec * 3.2);
      p.handBY = -p.handFY;
      break;
    case FighterState.Walk:
    case FighterState.Run:
    case FighterState.Dash: {
      const freq = s === FighterState.Walk ? 11 : 18;
      const amp = s === FighterState.Walk ? 0.65 : 1.15;
      const ph = simTimeSec * freq;
      const c = Math.sin(ph);
      p.bodyY = Math.abs(Math.cos(ph)) * 0.11 * amp;
      p.bodyPitchZ = -0.18 * amp;
      p.footFX = 0.28 * c * amp;
      p.footFY = 0.14 * Math.max(0, c) * amp;
      p.footBX = -0.28 * c * amp;
      p.footBY = 0.14 * Math.max(0, -c) * amp;
      p.handFX = -0.24 * c * amp;
      p.handBX = 0.24 * c * amp;
      p.hoofFrontPitchZ = 0.56 * c * amp;
      p.hoofBackPitchZ = -0.56 * c * amp;
      p.hoofFrontY = 0.16 * Math.max(0, c) * amp;
      p.hoofBackY = 0.16 * Math.max(0, -c) * amp;
      break;
    }
    case FighterState.Skid:
      p.bodyPitchZ = 0.30;
      p.footFX = 0.30;
      p.squashBias = -0.12;
      break;
    case FighterState.JumpSquat:
    case FighterState.LandingLag:
      p.squashBias = -0.26;
      p.bodyY = -0.08;
      break;
    case FighterState.Airborne:
    case FighterState.Helpless: {
      const rising = f.vy > 0.5;
      p.bodyPitchZ = rising ? 0.14 : -0.16;
      p.handFY = rising ? 0.28 : 0.42;
      p.handBY = p.handFY;
      p.footFY = rising ? -0.05 : 0.10;
      p.squashBias = rising ? 0.15 : -0.08;
      break;
    }
    case FighterState.Attack:
      return sampleMovePose(f.id ?? FighterId.Earl, f.activeMove, f.stateFrame);
    case FighterState.ChargingHeavy: {
      // Smash smash-charge coil with escalating shiver intensity
      const chargeT = clamp(f.stateFrame / 45, 0, 1);
      const shiver = Math.sin(simTimeSec * (38 + chargeT * 30)) * (0.025 + chargeT * 0.065);
      p.bodyX = -0.32 + shiver;
      p.bodyY = -0.10;
      p.bodyPitchZ = 0.24 + chargeT * 0.10;
      p.bodyYawY = -0.26 - chargeT * 0.10;
      p.handFX = -0.36;
      p.handFY = 0.28;
      p.headX = -0.14;
      p.headY = 0.12;
      p.headPitchZ = 0.34;
      p.lidY = 0.22 + chargeT * 0.18;
      p.lidPitchZ = 0.30;
      p.rodPitchZ = 0.96 + chargeT * 0.20;
      p.squashBias = -0.20 - chargeT * 0.08;
      break;
    }
    case FighterState.Guard:
    case FighterState.GuardRelease:
    case FighterState.GuardStun:
    case FighterState.Parry:
      p.bodyX = s === FighterState.GuardStun ? -0.18 : 0;
      p.bodyPitchZ = s === FighterState.GuardStun ? 0.32 : -0.10;
      p.handFX = 0.46;
      p.handFY = 0.24;
      p.handBX = 0.24;
      p.squashBias = s === FighterState.GuardStun ? -0.18 : -0.06;
      break;
    case FighterState.GuardBreak:
    case FighterState.ParryStun:
    case FighterState.Hitstun:
      // Dramatic hurt recoil: flung backward, arms splayed, lid/hat popped
      p.bodyX = -0.24;
      p.bodyPitchZ = 0.56;
      p.headPitchZ = 0.62;
      p.headY = 0.18;
      p.lidY = 0.55;
      p.lidPitchZ = 0.72;
      p.hatPitchZ = 0.78;
      p.handFX = -0.25;
      p.handFY = 0.55;
      p.handBX = -0.35;
      p.handBY = 0.50;
      p.hoofFrontY = 0.35;
      p.squashBias = -0.22;
      break;
    case FighterState.Tumble:
      p.pivotAroundCom = true;
      p.bodyPitchZ = -(simTimeSec * 12.5);
      p.lidY = 0.62;
      p.lidPitchZ = 0.85;
      p.hatPitchZ = 0.90;
      p.handFX = 0.38;
      p.handFY = 0.48;
      p.handBX = -0.38;
      p.handBY = 0.42;
      p.squashBias = 0.14;
      break;
    case FighterState.Roll:
    case FighterState.SpotDodge:
    case FighterState.AirDodge:
      p.pivotAroundCom = s === FighterState.Roll;
      p.bodyPitchZ = s === FighterState.Roll ? -(f.stateFrame * 0.44) : 0.24;
      p.squashBias = -0.18;
      break;
    case FighterState.Grabbing:
      p.bodyX = 0.22;
      p.handFX = 0.72;
      p.handBX = 0.64;
      p.handFZ = -0.28;
      p.handBZ = 0.28;
      break;
    case FighterState.Held:
      p.bodyRollX = Math.sin(simTimeSec * 28) * 0.22;
      p.handFY = 0.45;
      p.handBY = 0.45;
      break;
    case FighterState.LedgeHang:
      p.bodyY = -0.35;
      p.handFY = 0.78;
      p.handBY = 0.78;
      break;
    case FighterState.LedgeGetup:
      p.bodyPitchZ = -0.32;
      p.handFY = 0.28;
      break;
    case FighterState.Respawn:
    case FighterState.Teaspoon:
    case FighterState.Eliminated:
      break;
    default:
      assertNever(s, 'sampleStatePose');
  }
  return p;
}

function setBoneTransform(
  slot: BoneSlot | null,
  dx: number,
  dy: number,
  dz: number,
  rx: number,
  ry: number,
  rz: number,
  scale = 1,
): void {
  if (slot === null) return;
  slot.bone.position.set(slot.restPos.x + dx, slot.restPos.y + dy, slot.restPos.z + dz);
  EULER_TMP.set(rx, ry, rz, 'XYZ');
  QUAT_TMP.setFromEuler(EULER_TMP);
  slot.bone.quaternion.copy(slot.restQuat).multiply(QUAT_TMP);
  slot.bone.scale.setScalar(scale);
}

export function applyFighterPose(
  rig: FighterBoneRig,
  anim: FighterAnimRuntime,
  fighterSnap: SnapshotFighter & { id?: FighterId },
  dtSec: number,
  simTimeSec: number,
  facingRight: boolean,
  grounded: boolean,
  isHitstop: boolean,
): void {
  const safeDt = clamp(dtSec, 1 / 240, 0.05);
  const fWithId = { ...fighterSnap, id: rig.fighterId };
  const pose = sampleStatePose(fWithId, simTimeSec);
  const hitFrozen = isHitstop && fighterSnap.hitstopFrames > 0;
  const isVictim =
    fighterSnap.state === FighterState.Hitstun ||
    fighterSnap.state === FighterState.Tumble ||
    fighterSnap.state === FighterState.GuardStun ||
    fighterSnap.state === FighterState.GuardBreak ||
    fighterSnap.state === FighterState.ParryStun;

  // Layer 1: 42° camera cheat facing interpolation (snappier turn-around!)
  const targetYaw = facingRight ? FACING_RIGHT_YAW : FACING_LEFT_YAW;
  const [nextYaw] = stepSpring(anim.facingYaw, 0, targetYaw, 30, safeDt);
  anim.facingYaw = nextYaw;

  // Layer 2: Breathing / idle boil (paused during hitstop freeze)
  if (!hitFrozen) {
    anim.boilPhase += safeDt * (grounded ? 3.2 : 5.0);
  }
  const boil = Math.sin(anim.boilPhase) * 0.025;

  // Layer 3: Landing & impact squash/stretch impulse
  if (grounded && !anim.wasGrounded) {
    anim.squashY = 0.74;
    anim.squashVel = 2.0;
  }
  anim.wasGrounded = grounded;

  // Punch squash sharply on hitstop entry so impact reads on frame 1!
  if (hitFrozen && !anim.wasHitstop) {
    anim.squashY = isVictim ? 0.68 : 1.18;
    anim.squashVel = isVictim ? 2.4 : -1.2;
  }
  anim.wasHitstop = hitFrozen;

  // Snap stretch impulse right when attack enters active frames!
  const inActiveAttack =
    fighterSnap.state === FighterState.Attack &&
    fighterSnap.activeMove !== MoveId.None &&
    evalAttackPhase(rig.fighterId, fighterSnap.activeMove, fighterSnap.stateFrame).isActive;
  if (inActiveAttack && !anim.wasAttackActive) {
    anim.squashY = clamp(anim.squashY + 0.16, 0.72, 1.32);
    anim.squashVel = -1.4;
  }
  anim.wasAttackActive = inActiveAttack;

  if (!hitFrozen) {
    const [sq, sqV] = stepSpring(anim.squashY, anim.squashVel, 1.0 + pose.squashBias + boil, 22, safeDt);
    anim.squashY = clamp(sq, 0.66, 1.36);
    anim.squashVel = sqV;
  }

  // Layer 4: Velocity lean
  const targetLean = clamp(-fighterSnap.vx * 0.026, -0.34, 0.34);
  if (!hitFrozen) {
    const [ln, lnV] = stepSpring(anim.leanRad, anim.leanVel, targetLean, 16, safeDt);
    anim.leanRad = ln;
    anim.leanVel = lnV;
  }

  // Layer 5: Secondary spring for lid/hat/rod
  if (!hitFrozen) {
    const targetSecY = clamp(-fighterSnap.vy * 0.016, -0.08, 0.22);
    const [sy, syV] = stepSpring(anim.secPosY, anim.secVelY, targetSecY, 16, safeDt);
    anim.secPosY = sy;
    anim.secVelY = syV;
    const [sr, srV] = stepSpring(anim.secRotZ, anim.secRotVel, clamp(fighterSnap.vx * 0.028, -0.38, 0.38), 14, safeDt);
    anim.secRotZ = sr;
    anim.secRotVel = srV;
  }

  // Layer 6: Visceral Smash hitstop / SDI rattle (strong on victim, crisp recoil on attacker)
  let jitterX = 0;
  let jitterY = 0;
  if (hitFrozen) {
    anim.rattleClock += safeDt * 110;
    const ampX = isVictim ? 0.145 : 0.045;
    const ampY = isVictim ? 0.095 : 0.025;
    jitterX = Math.sin(anim.rattleClock * 1.9 + anim.jitterSeed) * ampX;
    jitterY = Math.cos(anim.rattleClock * 2.5 + anim.jitterSeed) * ampY;
  } else {
    anim.rattleClock = 0;
  }

  // Apply volume-preserving squash & stretch + center-of-mass rotation offset when spinning/tumbling
  const invSq = 1 / Math.sqrt(anim.squashY);
  const bodyRotX = pose.bodyRollX;
  const bodyRotY = pose.bodyYawY;
  const bodyRotZ = pose.bodyPitchZ + anim.leanRad * (facingRight ? 1 : -1);

  let comOffX = 0;
  let comOffY = 0;
  let comOffZ = 0;
  if (pose.pivotAroundCom || Math.abs(bodyRotZ) > 1e-4 || Math.abs(bodyRotX) > 1e-4) {
    const pivotY = COM_Y_BY_FIGHTER[rig.fighterId] * (pose.pivotAroundCom ? 1.0 : 0.58);
    EULER_TMP.set(bodyRotX, bodyRotY, bodyRotZ, 'XYZ');
    QUAT_TMP.setFromEuler(EULER_TMP);
    VEC_TMP.set(0, pivotY, 0).applyQuaternion(QUAT_TMP);
    comOffX = -VEC_TMP.x;
    comOffY = pivotY - VEC_TMP.y;
    comOffZ = -VEC_TMP.z;
  }

  setBoneTransform(
    rig.body,
    pose.bodyX + jitterX + comOffX,
    pose.bodyY + jitterY + comOffY,
    comOffZ,
    bodyRotX,
    bodyRotY,
    bodyRotZ,
    1,
  );
  rig.body.bone.scale.set(invSq, anim.squashY, invSq);

  setBoneTransform(rig.handF, pose.handFX, pose.handFY, pose.handFZ, 0, 0, pose.handFRotZ, pose.handFScale);
  setBoneTransform(rig.handB, pose.handBX, pose.handBY, pose.handBZ, 0, 0, pose.handBRotZ, pose.handBScale);
  setBoneTransform(rig.footF, pose.footFX, pose.footFY, 0, 0, 0, -pose.footFX * 0.9, pose.footFScale);
  setBoneTransform(rig.footB, pose.footBX, pose.footBY, 0, 0, 0, -pose.footBX * 0.9, pose.footBScale);
  setBoneTransform(rig.lid, pose.lidX, pose.lidY + anim.secPosY, 0, 0, 0, pose.lidPitchZ + anim.secRotZ, pose.lidScale);
  setBoneTransform(rig.head, pose.headX, pose.headY, 0, 0, 0, pose.headPitchZ, pose.headScale);
  setBoneTransform(rig.hat, 0, anim.secPosY * 0.65, 0, 0, 0, pose.hatPitchZ + anim.secRotZ * 1.25, 1);

  // Moss's fishing rod shares handF's pivot: carry it WITH handF so it never detaches during swings!
  const rodFollowX = rig.handF !== null ? pose.handFX : 0;
  const rodFollowY = (rig.handF !== null ? pose.handFY : 0) + pose.rodY + anim.secPosY * 0.45;
  const rodFollowZ = rig.handF !== null ? pose.handFZ : 0;
  setBoneTransform(
    rig.rod,
    rodFollowX,
    rodFollowY,
    rodFollowZ,
    0,
    pose.rodYawY,
    pose.rodPitchZ + anim.secRotZ * 0.6,
    pose.rodScale,
  );

  setBoneTransform(rig.hoofFL, pose.hoofFrontX + pose.hoofFrontY * 0.35, pose.hoofFrontY, 0, 0, 0, pose.hoofFrontPitchZ, pose.hoofFrontScale);
  setBoneTransform(rig.hoofFR, pose.hoofFrontX * 0.85 + pose.hoofFrontY * 0.2, pose.hoofFrontY * 0.88, 0, 0, 0, pose.hoofFrontPitchZ * 0.9, pose.hoofFrontScale);
  setBoneTransform(rig.hoofBL, pose.hoofBackX + pose.hoofBackY * 0.2, pose.hoofBackY, 0, 0, 0, pose.hoofBackPitchZ, pose.hoofBackScale);
  setBoneTransform(rig.hoofBR, pose.hoofBackX * 0.85 + pose.hoofBackY * 0.2, pose.hoofBackY * 0.88, 0, 0, 0, pose.hoofBackPitchZ * 0.9, pose.hoofBackScale);
}
