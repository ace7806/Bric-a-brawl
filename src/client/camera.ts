import * as THREE from 'three';
import { assert, assertFinite } from '@sim/assert';
import { getArenaSpec, getGameData } from '@sim/data';
import { ArenaId, ErrorCode, FighterState } from '@sim/enums';
import type { FighterRuntime } from '@sim/types';

export interface CameraTarget {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly yawRad: number;
  readonly rollRad: number;
}

interface SpringState {
  value: number;
  vel: number;
}

const DEG2RAD = Math.PI / 180;
const LAUNCH_SPEED_THRESHOLD = 20.0;

function stepCriticallyDamped(s: SpringState, target: number, omega: number, dt: number): number {
  const diff = s.value - target;
  const e = Math.exp(-omega * dt);
  const next = target + (diff + (s.vel + omega * diff) * dt) * e;
  s.vel = (s.vel - omega * (s.vel + omega * diff) * dt) * e;
  s.value = next;
  return next;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CameraController {
  private readonly xSpring: SpringState = { value: 0, vel: 0 };
  private readonly ySpring: SpringState = { value: 2, vel: 0 };
  private readonly wSpring: SpringState;
  private readonly yawSpring: SpringState = { value: 0, vel: 0 };
  private readonly rollSpring: SpringState = { value: 0, vel: 0 };
  private trauma = 0;
  private shakePhase = 0;
  private shakeScale = 1.0;
  private launchHoldTicks = 0;
  private launchDir = 0;

  public constructor() {
    const cam = getGameData().tuning.camera;
    this.wSpring = { value: (cam.minWidth + cam.maxWidth) * 0.5, vel: 0 };
  }

  public setShakeScale(scale: number): void {
    assertFinite(scale, 'camera.shakeScale');
    assert(scale >= 0 && scale <= 1, ErrorCode.InvariantViolation, `shakeScale must be in [0, 1], got ${scale}`);
    this.shakeScale = scale;
  }

  public getShakeScale(): number {
    return this.shakeScale;
  }

  public addTrauma(amount: number): void {
    assertFinite(amount, 'camera.trauma');
    this.trauma = clamp(this.trauma + Math.max(0, amount), 0, 1);
  }

  public reset(arenaId: ArenaId): void {
    const spec = getArenaSpec(arenaId);
    const cam = getGameData().tuning.camera;
    const cx = (spec.cameraBounds.minX + spec.cameraBounds.maxX) * 0.5;
    const cy = clamp(2.0, spec.cameraBounds.minY, spec.cameraBounds.maxY);
    this.xSpring.value = cx;
    this.xSpring.vel = 0;
    this.ySpring.value = cy;
    this.ySpring.vel = 0;
    this.wSpring.value = clamp(24, cam.minWidth, cam.maxWidth);
    this.wSpring.vel = 0;
    this.yawSpring.value = 0;
    this.yawSpring.vel = 0;
    this.rollSpring.value = 0;
    this.rollSpring.vel = 0;
    this.trauma = 0;
    this.launchHoldTicks = 0;
    this.launchDir = 0;
  }

  public update(
    camera: THREE.PerspectiveCamera,
    fighters: readonly FighterRuntime[],
    arenaId: ArenaId,
    dt: number,
    aspect: number,
  ): CameraTarget {
    const cam = getGameData().tuning.camera;
    const arena = getArenaSpec(arenaId);
    const bounds = arena.cameraBounds;
    const safeDt = clamp(dt, 1 / 240, 0.05);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    let maxLaunchSpeed = 0;
    let launchSign = 0;

    for (const f of fighters) {
      if (f.state === FighterState.Eliminated || f.state === FighterState.Teaspoon) continue;
      // Do not chase a fighter outside the arena's camera bounds (ART_BIBLE 4.5)
      const fx = clamp(f.x, bounds.minX, bounds.maxX);
      const fy = clamp(f.y + 0.75, bounds.minY, bounds.maxY);
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
      count++;

      const spd = Math.hypot(f.vx + f.kbVx, f.vy + f.kbVy);
      if (spd > LAUNCH_SPEED_THRESHOLD && spd > maxLaunchSpeed) {
        maxLaunchSpeed = spd;
        const vxTot = f.vx + f.kbVx;
        launchSign = vxTot > 0.5 ? 1 : vxTot < -0.5 ? -1 : 0;
      }
    }

    if (count === 0) {
      minX = -4;
      maxX = 4;
      minY = 0;
      maxY = 4;
    }

    if (maxLaunchSpeed > LAUNCH_SPEED_THRESHOLD) {
      this.launchHoldTicks = 20;
      if (launchSign !== 0) this.launchDir = launchSign;
    } else if (this.launchHoldTicks > 0) {
      this.launchHoldTicks--;
    }

    const launchActive = this.launchHoldTicks > 0;
    const margin = cam.margin;
    const spanX = (maxX - minX) + margin * 2;
    const spanY = ((maxY - minY) + margin * 2) * aspect;
    const widenMult = launchActive ? 1 + cam.launchWiden : 1;
    const targetWidth = clamp(Math.max(spanX, spanY) * widenMult, cam.minWidth, cam.maxWidth);

    const targetX = clamp((minX + maxX) * 0.5, bounds.minX, bounds.maxX);
    const targetY = clamp((minY + maxY) * 0.5 + 0.8, bounds.minY, bounds.maxY);

    const x = stepCriticallyDamped(this.xSpring, targetX, cam.posOmega, safeDt);
    const y = stepCriticallyDamped(this.ySpring, targetY, cam.posOmega, safeDt);
    const width = stepCriticallyDamped(this.wSpring, targetWidth, cam.zoomOmega, safeDt);

    const midX = (bounds.minX + bounds.maxX) * 0.5;
    const halfSpan = Math.max(1, (bounds.maxX - bounds.minX) * 0.5);
    const normCenter = clamp((x - midX) / halfSpan, -1, 1);
    const baseYawDeg = -normCenter * cam.yawMaxDeg;
    const leanDeg = launchActive ? this.launchDir * cam.launchLeanDeg : 0;
    const targetYaw = (baseYawDeg + leanDeg) * DEG2RAD;
    const yawRad = stepCriticallyDamped(this.yawSpring, targetYaw, cam.posOmega, safeDt);
    const rollRad = stepCriticallyDamped(this.rollSpring, 0, cam.posOmega, safeDt);

    // Distance derived from vertical FOV & desired visible horizontal width
    const vFovRad = cam.fovDeg * DEG2RAD;
    const hHalfTan = Math.tan(vFovRad * 0.5) * Math.max(0.5, aspect);
    const dist = (width * 0.5) / hHalfTan;
    const pitchRad = cam.pitchDeg * DEG2RAD;

    // Trauma decay + high-frequency deterministic shake
    this.trauma = Math.max(0, this.trauma - safeDt * 1.8);
    this.shakePhase += safeDt * 48;
    const shakeAmt = this.trauma * this.trauma * 0.45 * this.shakeScale;
    const sx = Math.sin(this.shakePhase * 1.7) * shakeAmt;
    const sy = Math.cos(this.shakePhase * 2.3) * shakeAmt;

    const camYOffset = -Math.sin(pitchRad) * dist;
    const camZOffset = Math.cos(pitchRad) * dist;
    camera.fov = cam.fovDeg;
    camera.position.set(
      x - Math.sin(yawRad) * dist + sx,
      y + camYOffset + sy,
      camZOffset,
    );
    camera.lookAt(x + sx * 0.35, y + sy * 0.35, 0);
    camera.rotation.z += rollRad;
    camera.updateProjectionMatrix();

    return { x, y, width, yawRad, rollRad };
  }
}
