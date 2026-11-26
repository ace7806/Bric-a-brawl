import * as THREE from 'three';
import { assertNever } from '@sim/assert';
import { getFighterSpec } from '@sim/data';
import { FighterId, FighterState, MoveId } from '@sim/enums';
import type { SnapshotFighter } from '@net/codec';

export interface ElementalFighterRig {
  readonly fighterId: FighterId;
  readonly fxGroup: THREE.Group;
  readonly modelGroup: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly clips: ReadonlyMap<string, THREE.AnimationClip>;
  readonly actions: Map<string, THREE.AnimationAction>;
  readonly skinnedMesh: THREE.SkinnedMesh;
  readonly outlineMesh: THREE.SkinnedMesh | null;
  readonly rootBone: THREE.Bone | null;
  readonly handR: THREE.Bone | null;
  readonly handL: THREE.Bone | null;
  readonly weaponR: THREE.Bone | null;
  readonly headBone: THREE.Bone | null;
  activeActionName: string | null;
  activeAction: THREE.AnimationAction | null;
  lastEvalFrame: number;
}

export interface FighterAnimRuntime {
  loopTimeSec: number;
  lastClipName: string;
  squashY: number;
  squashVel: number;
  wasGrounded: boolean;
  wasHitstop: boolean;
  wasAttackActive: boolean;
  jitterSeed: number;
  facingYaw: number;
  rattleClock: number;
}

export interface ClipSelection {
  readonly clipName: string;
  readonly timeSec: number;
  readonly loop: boolean;
}

// Blender glTF export (export_yup=True) maps Blender -Y forward -> Three.js +Z forward.
// Right-handed Y rotation: R_y(a) * (0,0,1) = (sin a, 0, cos a).
// Smash 2.5D camera cheat (28 deg angled toward +Z camera):
//   Facing right (+X): +62 deg -> (+0.883, 0, +0.469)
//   Facing left  (-X): -62 deg -> (-0.883, 0, +0.469), pivoting cleanly through camera-front (0 deg)!
export const FACING_RIGHT_YAW = (62 * Math.PI) / 180;
export const FACING_LEFT_YAW = -(62 * Math.PI) / 180;

const SIM_FPS = 60;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function stepSpring(val: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const diff = val - target;
  const e = Math.exp(-omega * dt);
  const next = target + (diff + (vel + omega * diff) * dt) * e;
  const nextVel = (vel - omega * (vel + omega * diff) * dt) * e;
  return [next, nextVel];
}

export function createFighterAnimRuntime(slot: number): FighterAnimRuntime {
  return {
    loopTimeSec: (slot * 0.19) % 0.6,
    lastClipName: 'Idle',
    squashY: 1.0,
    squashVel: 0,
    wasGrounded: true,
    wasHitstop: false,
    wasAttackActive: false,
    jitterSeed: slot * 13 + 7,
    facingYaw: FACING_RIGHT_YAW,
    rattleClock: 0,
  };
}

/** Canonical mapping from simulation MoveId -> baked 60fps Elemental GLB clip name. */
export function moveIdToClipName(moveId: MoveId): string {
  switch (moveId) {
    case MoveId.None: return 'Idle';
    case MoveId.Jab1: return 'Jab1';
    case MoveId.Jab2: return 'Jab2';
    case MoveId.Jab3: return 'Jab3';
    case MoveId.Ftilt: return 'Ftilt';
    case MoveId.Utilt: return 'Utilt';
    case MoveId.Dtilt: return 'Dtilt';
    case MoveId.Dash: return 'DashAtk';
    case MoveId.Fheavy: return 'Fheavy';
    case MoveId.Uheavy: return 'Uheavy';
    case MoveId.Dheavy: return 'Dheavy';
    case MoveId.Nair: return 'Nair';
    case MoveId.Fair: return 'Fair';
    case MoveId.Bair: return 'Bair';
    case MoveId.Uair: return 'Uair';
    case MoveId.Dair: return 'Dair';
    case MoveId.Grab: return 'Grab';
    case MoveId.Fthrow: return 'Fthrow';
    case MoveId.Bthrow: return 'Bthrow';
    case MoveId.Uthrow: return 'Uthrow';
    case MoveId.Dthrow: return 'Dthrow';
    case MoveId.Nspec: return 'Nspec';
    case MoveId.Sspec: return 'Sspec';
    case MoveId.Uspec: return 'Uspec';
    case MoveId.Dspec: return 'Dspec';
    case MoveId.Ledge:
    case MoveId.Getup:
      return 'LedgeAtk';
    default:
      assertNever(moveId, 'moveIdToClipName');
  }
}

/** Resolves the exact baked 60fps clip name, frame-locked time, and loop flag for any fighter snapshot. */
export function selectElementalClip(snap: SnapshotFighter, loopTimeSec: number): ClipSelection {
  const frameTime = Math.max(0, snap.stateFrame / SIM_FPS);
  switch (snap.state) {
    case FighterState.Idle:
    case FighterState.Respawn:
    case FighterState.Teaspoon:
    case FighterState.Eliminated:
      return { clipName: 'Idle', timeSec: loopTimeSec, loop: true };
    case FighterState.Walk:
      return { clipName: 'Walk', timeSec: loopTimeSec, loop: true };
    case FighterState.Run:
      return { clipName: 'Run', timeSec: loopTimeSec, loop: true };
    case FighterState.Dash:
      return { clipName: 'Dash', timeSec: loopTimeSec, loop: true };
    case FighterState.Skid:
      return { clipName: 'Skid', timeSec: loopTimeSec, loop: true };
    case FighterState.JumpSquat:
      return { clipName: 'JumpSquat', timeSec: frameTime, loop: false };
    case FighterState.LandingLag:
      return { clipName: 'LandingLag', timeSec: frameTime, loop: false };
    case FighterState.Airborne:
      return { clipName: snap.vy > 0.6 ? 'Jump' : 'Fall', timeSec: loopTimeSec, loop: true };
    case FighterState.Helpless:
      return { clipName: 'Fall', timeSec: loopTimeSec, loop: true };
    case FighterState.Attack:
      return { clipName: moveIdToClipName(snap.activeMove), timeSec: frameTime, loop: false };
    case FighterState.ChargingHeavy:
      return { clipName: 'ChargingHeavy', timeSec: frameTime, loop: true };
    case FighterState.Guard:
    case FighterState.GuardRelease:
    case FighterState.Parry:
      return { clipName: 'Guard', timeSec: loopTimeSec, loop: true };
    case FighterState.GuardStun:
    case FighterState.GuardBreak:
    case FighterState.ParryStun:
    case FighterState.Hitstun:
    case FighterState.Held:
      return { clipName: 'Hitstun', timeSec: frameTime, loop: true };
    case FighterState.Tumble:
      return { clipName: 'Tumble', timeSec: loopTimeSec * 1.25, loop: true };
    case FighterState.Roll:
      return { clipName: 'Roll', timeSec: frameTime, loop: false };
    case FighterState.SpotDodge:
      return { clipName: 'SpotDodge', timeSec: frameTime, loop: false };
    case FighterState.AirDodge: {
      const fast = Math.hypot(snap.vx, snap.vy) > 13.8;
      return { clipName: fast ? 'ChaseDodge' : 'AirDodge', timeSec: frameTime, loop: false };
    }
    case FighterState.Grabbing:
      return { clipName: 'Grab', timeSec: frameTime, loop: false };
    case FighterState.LedgeHang:
      return { clipName: 'LedgeHang', timeSec: loopTimeSec, loop: true };
    case FighterState.LedgeGetup:
      return { clipName: 'LedgeGetup', timeSec: frameTime, loop: false };
    default:
      assertNever(snap.state, 'selectElementalClip');
  }
}

function isMoveInActiveWindow(fighterId: FighterId, moveId: MoveId, frame: number): boolean {
  if (moveId === MoveId.None) return false;
  const spec = getFighterSpec(fighterId).moves.get(moveId);
  if (spec === undefined) return false;
  return frame >= spec.startup && frame <= spec.startup + Math.max(2, spec.active);
}

function getOrBindAction(rig: ElementalFighterRig, clipName: string): { readonly name: string; readonly action: THREE.AnimationAction } | null {
  const existing = rig.actions.get(clipName);
  if (existing !== undefined) return { name: clipName, action: existing };
  const clip = rig.clips.get(clipName);
  if (clip !== undefined) {
    const action = rig.mixer.clipAction(clip);
    rig.actions.set(clipName, action);
    return { name: clipName, action };
  }
  const idleExisting = rig.actions.get('Idle');
  if (idleExisting !== undefined) return { name: 'Idle', action: idleExisting };
  const idleClip = rig.clips.get('Idle');
  if (idleClip !== undefined) {
    const action = rig.mixer.clipAction(idleClip);
    rig.actions.set('Idle', action);
    return { name: 'Idle', action };
  }
  return null;
}

/**
 * Drives an Elemental Fighter's 60fps skeletal AnimationMixer frame-locked 1:1 to simulation ticks,
 * layered with Smash facing turn, landing/impact squash-stretch, and hitstop/SDI rattle.
 */
export function applyElementalPose(
  rig: ElementalFighterRig,
  anim: FighterAnimRuntime,
  fighterSnap: SnapshotFighter,
  dtSec: number,
  simTimeSec: number,
  facingRight: boolean,
  grounded: boolean,
  isHitstop: boolean,
): void {
  const safeDt = clamp(dtSec, 1 / 240, 0.05);
  const hitFrozen = isHitstop && fighterSnap.hitstopFrames > 0;
  const isVictim =
    fighterSnap.state === FighterState.Hitstun ||
    fighterSnap.state === FighterState.Tumble ||
    fighterSnap.state === FighterState.GuardStun ||
    fighterSnap.state === FighterState.GuardBreak ||
    fighterSnap.state === FighterState.ParryStun;

  // 1. Advance looping playback clock (frozen during hitstop so strikes hold rock-solid on impact!)
  if (!hitFrozen) {
    anim.loopTimeSec += safeDt;
  }

  // 2. Select & evaluate exact 60fps Blender clip lazily on THREE.AnimationMixer
  const sel = selectElementalClip(fighterSnap, anim.loopTimeSec);
  const resolved = getOrBindAction(rig, sel.clipName);
  if (resolved !== null) {
    const { name: clipName, action } = resolved;
    const switched = rig.activeActionName !== clipName;
    if (switched) {
      if (rig.activeAction !== null) rig.activeAction.stop();
      action.reset();
      action.setLoop(sel.loop ? THREE.LoopRepeat : THREE.LoopOnce, sel.loop ? Infinity : 1);
      action.clampWhenFinished = !sel.loop;
      action.enabled = true;
      action.setEffectiveWeight(1);
      action.play();
      rig.activeAction = action;
      rig.activeActionName = clipName;
      anim.lastClipName = clipName;
    }
    const dur = Math.max(1 / SIM_FPS, action.getClip().duration);
    const evalTime = sel.loop
      ? ((sel.timeSec % dur) + dur) % dur
      : clamp(sel.timeSec, 0, Math.max(0, dur - 1 / 240));
    const evalFrame = Math.round(evalTime * SIM_FPS);
    if (switched || rig.lastEvalFrame !== evalFrame) {
      action.time = evalTime;
      rig.mixer.update(0);
      rig.lastEvalFrame = evalFrame;
    }
  }

  // 3. Smash 2.5D camera-cheat facing yaw (+62 deg right / -62 deg left through front 0 deg)
  const targetYaw = facingRight ? FACING_RIGHT_YAW : FACING_LEFT_YAW;
  const yawAlpha = 1 - Math.exp(-38 * safeDt);
  anim.facingYaw += (targetYaw - anim.facingYaw) * yawAlpha;
  rig.modelGroup.rotation.set(0, anim.facingYaw, 0);

  // 4. Crisp Smash squash & stretch on landing, hitstop entry, and active strike pop
  if (grounded && !anim.wasGrounded) {
    anim.squashY = 0.84;
    anim.squashVel = 1.6;
  }
  anim.wasGrounded = grounded;

  if (hitFrozen && !anim.wasHitstop) {
    anim.squashY = isVictim ? 0.78 : 1.09;
    anim.squashVel = isVictim ? 1.8 : -0.9;
  }
  anim.wasHitstop = hitFrozen;

  const inActiveAttack =
    fighterSnap.state === FighterState.Attack &&
    isMoveInActiveWindow(rig.fighterId, fighterSnap.activeMove, fighterSnap.stateFrame);
  if (inActiveAttack && !anim.wasAttackActive) {
    anim.squashY = clamp(anim.squashY + 0.08, 0.82, 1.16);
    anim.squashVel = -0.9;
  }
  anim.wasAttackActive = inActiveAttack;

  if (!hitFrozen) {
    const [sq, sqV] = stepSpring(anim.squashY, anim.squashVel, 1.0, 24, safeDt);
    anim.squashY = clamp(sq, 0.76, 1.18);
    anim.squashVel = sqV;
  }

  // 5. Visceral screen-XY hitstop SDI rattle & heavy-charge anticipation tremble
  let jitterX = 0;
  let jitterY = 0;
  if (hitFrozen) {
    anim.rattleClock += safeDt * 115;
    const ampX = isVictim ? 0.135 : 0.04;
    const ampY = isVictim ? 0.085 : 0.022;
    jitterX = Math.sin(anim.rattleClock * 1.9 + anim.jitterSeed) * ampX;
    jitterY = Math.cos(anim.rattleClock * 2.5 + anim.jitterSeed) * ampY;
  } else {
    anim.rattleClock = 0;
    if (fighterSnap.state === FighterState.ChargingHeavy) {
      const chargeT = clamp(fighterSnap.stateFrame / 45, 0, 1);
      jitterX = Math.sin(simTimeSec * (42 + chargeT * 28)) * (0.018 + chargeT * 0.045);
    }
  }

  const invSq = 1 / Math.sqrt(anim.squashY);
  rig.fxGroup.position.set(jitterX, jitterY, 0);
  rig.fxGroup.scale.set(invSq, anim.squashY, invSq);
}
