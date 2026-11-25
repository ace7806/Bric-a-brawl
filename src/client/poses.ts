import * as THREE from 'three';
import { assertNever } from '@sim/assert';
import { getMoveSpec } from '@sim/data';
import { FighterFlag, FighterId, FighterState, MoveId } from '@sim/enums';
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
  jitterSeed: number;
  facingYaw: number;
}

export interface PoseSample {
  bodyPitchZ: number;
  bodyRollX: number;
  bodyYawY: number;
  bodyY: number;
  handFX: number;
  handFY: number;
  handFZ: number;
  handBX: number;
  handBY: number;
  handBZ: number;
  footFX: number;
  footFY: number;
  footBX: number;
  footBY: number;
  lidY: number;
  lidPitchZ: number;
  headY: number;
  headPitchZ: number;
  hatPitchZ: number;
  rodPitchZ: number;
  rodY: number;
  hoofFrontY: number;
  hoofFrontPitchZ: number;
  hoofBackY: number;
  hoofBackPitchZ: number;
  squashBias: number;
}

// ART_BIBLE 42° camera cheat: GLB +X is forward, +Y is up, +Z is toward camera.
// Right-handed Y rotation: R_y(a)*(1,0,0) = (cos a, 0, -sin a). Negative angles turn +X toward +Z camera:
// Right facing = -42° (-0.733 rad); Left facing = -138° (-2.409 rad), pivoting cleanly through front (-90°).
export const FACING_RIGHT_YAW = -(42 * Math.PI) / 180;
export const FACING_LEFT_YAW = -(Math.PI - (42 * Math.PI) / 180);

const EULER_TMP = new THREE.Euler();
const QUAT_TMP = new THREE.Quaternion();

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
    jitterSeed: slot * 13 + 7,
    facingYaw: FACING_RIGHT_YAW,
  };
}

function zeroPose(): PoseSample {
  return {
    bodyPitchZ: 0, bodyRollX: 0, bodyYawY: 0, bodyY: 0,
    handFX: 0, handFY: 0, handFZ: 0, handBX: 0, handBY: 0, handBZ: 0,
    footFX: 0, footFY: 0, footBX: 0, footBY: 0,
    lidY: 0, lidPitchZ: 0, headY: 0, headPitchZ: 0, hatPitchZ: 0,
    rodPitchZ: 0, rodY: 0,
    hoofFrontY: 0, hoofFrontPitchZ: 0, hoofBackY: 0, hoofBackPitchZ: 0,
    squashBias: 0,
  };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function stepSpring(val: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const diff = val - target;
  const e = Math.exp(-omega * dt);
  const next = target + (diff + (vel + omega * diff) * dt) * e;
  const nextVel = (vel - omega * (vel + omega * diff) * dt) * e;
  return [next, nextVel];
}

function sampleMovePose(fighterId: FighterId, moveId: MoveId, frame: number): PoseSample {
  const p = zeroPose();
  if (moveId === MoveId.None) return p;
  const spec = getMoveSpec(fighterId, moveId);
  const total = Math.max(1, spec.total);
  const t = clamp(frame / total, 0, 1);
  const activeStart = spec.startup / total;
  const activeEnd = (spec.startup + Math.max(2, spec.active)) / total;
  const isWindup = t < activeStart;
  const isActive = t >= activeStart && t <= activeEnd;
  const punch = isWindup ? -0.45 * (t / Math.max(0.05, activeStart)) : isActive ? 1.0 : Math.max(0, 1 - (t - activeEnd) / Math.max(0.08, 1 - activeEnd));

  switch (moveId) {
    case MoveId.Jab1:
    case MoveId.Jab2:
    case MoveId.Jab3:
    case MoveId.Ftilt:
    case MoveId.Ledge:
    case MoveId.Getup:
      p.bodyPitchZ = -0.18 * punch;
      p.handFX = 0.62 * punch;
      p.handFY = 0.14 * punch;
      p.handBX = -0.18 * punch;
      p.headPitchZ = -0.22 * punch;
      p.rodPitchZ = -0.55 * punch;
      break;
    case MoveId.Utilt:
    case MoveId.Uair:
    case MoveId.Uthrow:
      p.bodyPitchZ = 0.16 * punch;
      p.handFY = 0.58 * punch;
      p.handBY = 0.42 * punch;
      p.lidY = 0.42 * punch;
      p.lidPitchZ = 0.35 * punch;
      p.headPitchZ = 0.48 * punch;
      p.hatPitchZ = -0.45 * punch;
      break;
    case MoveId.Dtilt:
    case MoveId.Dair:
      p.bodyPitchZ = -0.28 * punch;
      p.bodyY = -0.12 * punch;
      p.footFX = 0.45 * punch;
      p.footFY = -0.14 * punch;
      p.handFY = -0.25 * punch;
      p.squashBias = -0.12 * Math.abs(punch);
      break;
    case MoveId.Dash:
      p.bodyPitchZ = -0.34 * punch;
      p.handFX = 0.52 * punch;
      p.handBX = -0.35 * punch;
      p.headPitchZ = -0.35 * punch;
      p.hoofFrontY = 0.25 * punch;
      break;
    case MoveId.Fheavy:
    case MoveId.Uheavy:
    case MoveId.Dheavy: {
      const wind = isWindup ? -0.9 : 0;
      const swing = isActive ? 1.25 : Math.max(0, 1 - (t - activeEnd) * 2.2);
      const val = wind + swing;
      p.bodyPitchZ = (moveId === MoveId.Uheavy ? 0.35 : -0.36) * val;
      p.handFX = 0.78 * val;
      p.handFY = (moveId === MoveId.Uheavy ? 0.65 : 0.12) * val;
      p.lidY = 0.35 * Math.max(0, val);
      p.headPitchZ = (moveId === MoveId.Uheavy ? 0.55 : -0.42) * val;
      p.rodPitchZ = -0.9 * val;
      p.squashBias = isWindup ? -0.18 : 0.14 * Math.max(0, swing);
      break;
    }
    case MoveId.Nair:
    case MoveId.Fair:
    case MoveId.Bair:
      p.bodyYawY = moveId === MoveId.Nair ? t * Math.PI * 2 : moveId === MoveId.Bair ? -0.45 * punch : 0.2 * punch;
      p.bodyPitchZ = (moveId === MoveId.Bair ? 0.35 : -0.25) * punch;
      p.handFX = (moveId === MoveId.Bair ? -0.45 : 0.58) * punch;
      p.footBX = moveId === MoveId.Bair ? -0.48 * punch : 0;
      p.hoofBackPitchZ = moveId === MoveId.Bair ? 0.65 * punch : 0;
      break;
    case MoveId.Grab:
    case MoveId.Fthrow:
    case MoveId.Bthrow:
    case MoveId.Dthrow:
      p.bodyPitchZ = moveId === MoveId.Bthrow ? 0.35 * punch : -0.22 * punch;
      p.handFX = 0.54 * punch;
      p.handBX = 0.44 * punch;
      p.handFY = 0.18 * punch;
      p.rodPitchZ = -0.35 * punch;
      break;
    case MoveId.Uspec:
      p.bodyPitchZ = -0.12;
      p.lidY = fighterId === FighterId.Earl ? 0.95 * Math.sin(Math.min(1, t * 1.4) * Math.PI) : 0;
      p.lidPitchZ = -0.32 * punch;
      p.handFY = 0.72 * Math.sin(t * Math.PI);
      p.handBY = 0.72 * Math.sin(t * Math.PI);
      p.hoofFrontY = 0.36 * Math.sin(t * Math.PI);
      p.hoofFrontPitchZ = 0.45;
      p.rodPitchZ = -0.68 * punch;
      p.rodY = 0.25 * punch;
      p.squashBias = 0.16 * Math.sin(t * Math.PI);
      break;
    case MoveId.Nspec:
    case MoveId.Sspec:
    case MoveId.Dspec:
      if (fighterId === FighterId.Earl) {
        p.bodyPitchZ = moveId === MoveId.Sspec ? -0.32 : 0.12;
        p.lidY = moveId === MoveId.Nspec ? 0.35 * Math.sin(t * Math.PI) : 0.15;
        p.handFX = 0.42 * punch;
        p.handBX = 0.35 * punch;
      } else if (fighterId === FighterId.Grog) {
        // Stampede / Snort / Stamp
        const stride = Math.sin(frame * 0.55);
        p.bodyPitchZ = -0.18;
        p.headY = -0.22;
        p.headPitchZ = -0.42;
        p.hoofFrontY = 0.18 * Math.max(0, stride);
        p.hoofFrontPitchZ = 0.52 * stride;
        p.hoofBackY = 0.18 * Math.max(0, -stride);
        p.hoofBackPitchZ = -0.52 * stride;
      } else if (fighterId === FighterId.Nesta) {
        // Whirligig spin / Skittle / Shed
        p.bodyYawY = moveId === MoveId.Dspec ? 0 : t * Math.PI * 4;
        p.bodyPitchZ = moveId === MoveId.Sspec ? -0.28 : 0;
        p.handFX = 0.35;
        p.handBX = -0.35;
        p.handFY = moveId === MoveId.Dspec ? 0.45 * Math.sin(t * Math.PI) : 0.15;
        p.handBY = p.handFY;
      } else {
        // Moss Cast / Bobber / Gone Fishin'
        p.bodyPitchZ = isWindup ? 0.24 : -0.22 * punch;
        p.rodPitchZ = isWindup ? 0.65 : -0.78 * punch;
        p.rodY = 0.24 * punch;
        p.handFX = 0.2 * punch;
        p.hatPitchZ = 0.22 * punch;
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
      p.handFY = 0.03 * Math.sin(simTimeSec * 3.0);
      p.handBY = -p.handFY;
      break;
    case FighterState.Walk:
    case FighterState.Run:
    case FighterState.Dash: {
      const freq = s === FighterState.Walk ? 10 : 16;
      const amp = s === FighterState.Walk ? 0.65 : 1.0;
      const ph = simTimeSec * freq;
      const c = Math.sin(ph);
      p.bodyY = Math.abs(Math.cos(ph)) * 0.08 * amp;
      p.bodyPitchZ = -0.14 * amp;
      p.footFX = 0.22 * c * amp;
      p.footFY = 0.10 * Math.max(0, c) * amp;
      p.footBX = -0.22 * c * amp;
      p.footBY = 0.10 * Math.max(0, -c) * amp;
      p.handFX = -0.18 * c * amp;
      p.handBX = 0.18 * c * amp;
      p.hoofFrontPitchZ = 0.45 * c * amp;
      p.hoofBackPitchZ = -0.45 * c * amp;
      p.hoofFrontY = 0.12 * Math.max(0, c) * amp;
      p.hoofBackY = 0.12 * Math.max(0, -c) * amp;
      break;
    }
    case FighterState.Skid:
      p.bodyPitchZ = 0.24;
      p.footFX = 0.22;
      break;
    case FighterState.JumpSquat:
    case FighterState.LandingLag:
      p.squashBias = -0.22;
      p.bodyY = -0.06;
      break;
    case FighterState.Airborne:
    case FighterState.Helpless: {
      const rising = f.vy > 0.5;
      p.bodyPitchZ = rising ? 0.10 : -0.12;
      p.handFY = rising ? 0.24 : 0.36;
      p.handBY = p.handFY;
      p.footFY = rising ? -0.04 : 0.08;
      p.squashBias = rising ? 0.12 : -0.06;
      break;
    }
    case FighterState.Attack:
      return sampleMovePose(f.id ?? FighterId.Earl, f.activeMove, f.stateFrame);
    case FighterState.ChargingHeavy:
      p.bodyPitchZ = 0.22;
      p.handFX = -0.28;
      p.rodPitchZ = 0.55;
      p.squashBias = -0.16;
      break;
    case FighterState.Guard:
    case FighterState.GuardRelease:
    case FighterState.GuardStun:
    case FighterState.Parry:
      p.bodyPitchZ = s === FighterState.GuardStun ? 0.22 : -0.08;
      p.handFX = 0.36;
      p.handFY = 0.20;
      p.handBX = 0.18;
      break;
    case FighterState.GuardBreak:
    case FighterState.ParryStun:
    case FighterState.Hitstun:
      p.bodyPitchZ = 0.38;
      p.headPitchZ = 0.32;
      p.lidY = 0.22;
      p.handFY = 0.35;
      p.handBY = 0.35;
      break;
    case FighterState.Tumble:
      p.bodyPitchZ = -(simTimeSec * 9.5);
      p.lidY = 0.45;
      p.lidPitchZ = 0.6;
      p.handFX = 0.25;
      p.handFY = 0.35;
      p.handBX = -0.25;
      p.handBY = 0.30;
      break;
    case FighterState.Roll:
    case FighterState.SpotDodge:
    case FighterState.AirDodge:
      p.bodyPitchZ = s === FighterState.Roll ? -(f.stateFrame * 0.38) : 0.18;
      p.squashBias = -0.15;
      break;
    case FighterState.Grabbing:
      p.handFX = 0.48;
      p.handBX = 0.42;
      break;
    case FighterState.Held:
      p.bodyRollX = Math.sin(simTimeSec * 22) * 0.16;
      p.handFY = 0.35;
      break;
    case FighterState.LedgeHang:
      p.bodyY = -0.35;
      p.handFY = 0.72;
      p.handBY = 0.72;
      break;
    case FighterState.LedgeGetup:
      p.bodyPitchZ = -0.28;
      p.handFY = 0.25;
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

function setBoneOffset(slot: BoneSlot | null, dx: number, dy: number, dz: number, rx: number, ry: number, rz: number): void {
  if (slot === null) return;
  slot.bone.position.set(slot.restPos.x + dx, slot.restPos.y + dy, slot.restPos.z + dz);
  EULER_TMP.set(rx, ry, rz, 'XYZ');
  QUAT_TMP.setFromEuler(EULER_TMP);
  slot.bone.quaternion.copy(slot.restQuat).multiply(QUAT_TMP);
}

// Overload allowing SnapshotFighter with fighterId injected or explicit FighterId
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

  // Layer 1: 42° camera cheat facing interpolation
  const targetYaw = facingRight ? FACING_RIGHT_YAW : FACING_LEFT_YAW;
  const [nextYaw] = stepSpring(anim.facingYaw, 0, targetYaw, 22, safeDt);
  anim.facingYaw = nextYaw;

  // Layer 2: Breathing / idle boil (2-3% gentle pottery squash)
  anim.boilPhase += safeDt * (grounded ? 3.2 : 5.0);
  const boil = Math.sin(anim.boilPhase) * 0.025;

  // Layer 3: Landing squash impulse
  if (grounded && !anim.wasGrounded) {
    anim.squashY = 0.78;
    anim.squashVel = 1.6;
  }
  anim.wasGrounded = grounded;
  const [sq, sqV] = stepSpring(anim.squashY, anim.squashVel, 1.0 + pose.squashBias + boil, 18, safeDt);
  anim.squashY = clamp(sq, 0.72, 1.32);
  anim.squashVel = sqV;

  // Layer 4: Velocity lean
  const targetLean = clamp(-fighterSnap.vx * 0.024, -0.32, 0.32);
  const [ln, lnV] = stepSpring(anim.leanRad, anim.leanVel, targetLean, 14, safeDt);
  anim.leanRad = ln;
  anim.leanVel = lnV;

  // Layer 5: Secondary spring for lid/hat/rod
  const targetSecY = clamp(-fighterSnap.vy * 0.015, -0.08, 0.18);
  const [sy, syV] = stepSpring(anim.secPosY, anim.secVelY, targetSecY, 16, safeDt);
  anim.secPosY = sy;
  anim.secVelY = syV;
  const [sr, srV] = stepSpring(anim.secRotZ, anim.secRotVel, clamp(fighterSnap.vx * 0.025, -0.35, 0.35), 14, safeDt);
  anim.secRotZ = sr;
  anim.secRotVel = srV;

  // Layer 6: Hitstop micro-jitter
  let jitterX = 0;
  let jitterY = 0;
  if (isHitstop && fighterSnap.hitstopFrames > 0) {
    const j = Math.sin(fighterSnap.hitstopFrames * 2.7 + anim.jitterSeed);
    jitterX = j * 0.055;
    jitterY = Math.cos(fighterSnap.hitstopFrames * 3.1 + anim.jitterSeed) * 0.04;
  }

  // Apply volume-preserving squash & stretch on root body bone
  const invSq = 1 / Math.sqrt(anim.squashY);
  rig.body.bone.scale.set(invSq, anim.squashY, invSq);
  setBoneOffset(
    rig.body,
    jitterX,
    pose.bodyY + jitterY,
    0,
    pose.bodyRollX,
    pose.bodyYawY,
    pose.bodyPitchZ + anim.leanRad * (facingRight ? 1 : -1),
  );

  setBoneOffset(rig.handF, pose.handFX, pose.handFY, pose.handFZ, 0, 0, 0);
  setBoneOffset(rig.handB, pose.handBX, pose.handBY, pose.handBZ, 0, 0, 0);
  setBoneOffset(rig.footF, pose.footFX, pose.footFY, 0, 0, 0, -pose.footFX * 0.8);
  setBoneOffset(rig.footB, pose.footBX, pose.footBY, 0, 0, 0, -pose.footBX * 0.8);
  setBoneOffset(rig.lid, 0, pose.lidY + anim.secPosY, 0, 0, 0, pose.lidPitchZ + anim.secRotZ);
  setBoneOffset(rig.head, 0, pose.headY, 0, 0, 0, pose.headPitchZ);
  setBoneOffset(rig.hat, 0, anim.secPosY * 0.6, 0, 0, 0, pose.hatPitchZ + anim.secRotZ * 1.2);
  setBoneOffset(rig.rod, 0, pose.rodY + anim.secPosY * 0.5, 0, 0, 0, pose.rodPitchZ + anim.secRotZ * 0.8);
  setBoneOffset(rig.hoofFL, pose.hoofFrontY * 0.4, pose.hoofFrontY, 0, 0, 0, pose.hoofFrontPitchZ);
  setBoneOffset(rig.hoofFR, pose.hoofFrontY * 0.2, pose.hoofFrontY * 0.85, 0, 0, 0, pose.hoofFrontPitchZ * 0.9);
  setBoneOffset(rig.hoofBL, pose.hoofBackY * 0.2, pose.hoofBackY, 0, 0, 0, pose.hoofBackPitchZ);
  setBoneOffset(rig.hoofBR, pose.hoofBackY * 0.2, pose.hoofBackY * 0.85, 0, 0, 0, pose.hoofBackPitchZ * 0.9);
}

export const isFighterGroundedFlag = (flags: number): boolean => (flags & FighterFlag.Grounded) !== 0;
export const isFighterFacingRightFlag = (flags: number): boolean => (flags & FighterFlag.FacingRight) !== 0;
