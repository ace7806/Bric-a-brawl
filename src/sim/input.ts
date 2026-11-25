import { assert, assertNever } from './assert';
import { ErrorCode, InputBit, InputDir, MotionInput } from './enums';
import type { InputBufferEntry, InputHistoryRing, Vec2 } from './types';

const ACTION_BITS: readonly InputBit[] = [
  InputBit.Jump,
  InputBit.Attack,
  InputBit.Heavy,
  InputBit.Special,
  InputBit.Guard,
  InputBit.Grab,
  InputBit.Use,
  InputBit.Taunt,
];

const ALL_ACTION_MASK =
  InputBit.Jump |
  InputBit.Attack |
  InputBit.Heavy |
  InputBit.Special |
  InputBit.Guard |
  InputBit.Grab |
  InputBit.Use |
  InputBit.Taunt;

function assertValidDir(dir: number): InputDir {
  assert(
    Number.isInteger(dir) && dir >= InputDir.Neutral && dir <= InputDir.UpLeft,
    ErrorCode.InvalidEnumValue,
    `Invalid InputDir: ${String(dir)}`,
  );
  return dir as InputDir;
}

export function encodeInputMask(dir: InputDir, bits: number): number {
  assertValidDir(dir);
  assert(
    Number.isInteger(bits) && (bits & InputBit.DirMask) === 0 && (bits & ~0xffff) === 0,
    ErrorCode.InvariantViolation,
    `Invalid action bits mask: ${String(bits)}`,
  );
  return (bits | dir) & 0xffff;
}

export function decodeInputDir(mask: number): InputDir {
  assert(Number.isInteger(mask), ErrorCode.InvariantViolation, `Input mask must be an integer: ${String(mask)}`);
  return assertValidDir(mask & InputBit.DirMask);
}

export function hasBit(mask: number, bit: InputBit): boolean {
  return bit !== InputBit.None && (mask & bit) === bit;
}

export function dirToUnitVector(dir: InputDir): Vec2 {
  switch (dir) {
    case InputDir.Neutral:
      return { x: 0, y: 0 };
    case InputDir.Up:
      return { x: 0, y: 1 };
    case InputDir.UpRight:
      return { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    case InputDir.Right:
      return { x: 1, y: 0 };
    case InputDir.DownRight:
      return { x: Math.SQRT1_2, y: -Math.SQRT1_2 };
    case InputDir.Down:
      return { x: 0, y: -1 };
    case InputDir.DownLeft:
      return { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    case InputDir.Left:
      return { x: -1, y: 0 };
    case InputDir.UpLeft:
      return { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    default:
      return assertNever(dir, 'dirToUnitVector');
  }
}

export function resolveOppositeDirections(
  left: boolean,
  right: boolean,
  up: boolean,
  down: boolean,
  lastHorizontal: -1 | 0 | 1,
): InputDir {
  const hx: -1 | 0 | 1 = left && right ? lastHorizontal : right ? 1 : left ? -1 : 0;
  const vy: -1 | 0 | 1 = up && down ? 0 : up ? 1 : down ? -1 : 0;
  if (vy === 1) return hx === 1 ? InputDir.UpRight : hx === -1 ? InputDir.UpLeft : InputDir.Up;
  if (vy === -1) return hx === 1 ? InputDir.DownRight : hx === -1 ? InputDir.DownLeft : InputDir.Down;
  return hx === 1 ? InputDir.Right : hx === -1 ? InputDir.Left : InputDir.Neutral;
}

export function createInputHistory(capacity = 32): InputHistoryRing {
  assert(Number.isInteger(capacity) && capacity > 0, ErrorCode.InvariantViolation, `Invalid history capacity: ${capacity}`);
  return {
    masks: new Int32Array(capacity),
    ticks: new Int32Array(capacity),
    head: 0,
    count: 0,
  };
}

export function pushInputHistory(ring: InputHistoryRing, tick: number, mask: number): void {
  const cap = ring.masks.length;
  assert(cap > 0 && ring.ticks.length === cap, ErrorCode.InvariantViolation, 'Corrupt InputHistoryRing');
  assert(Number.isInteger(tick), ErrorCode.InvariantViolation, `Invalid tick: ${String(tick)}`);
  decodeInputDir(mask);
  ring.masks[ring.head] = mask;
  ring.ticks[ring.head] = tick;
  ring.head = (ring.head + 1) % cap;
  if (ring.count < cap) ring.count++;
}

export function updateInputBuffer(
  buffer: InputBufferEntry[],
  tick: number,
  mask: number,
  prevMask: number,
  bufferFrames: number,
): void {
  assert(Number.isInteger(bufferFrames) && bufferFrames >= 0, ErrorCode.InvariantViolation, `Invalid bufferFrames: ${bufferFrames}`);
  let write = 0;
  for (let i = 0; i < buffer.length; i++) {
    const entry = buffer[i];
    if (entry !== undefined && tick - entry.pressedTick <= bufferFrames) {
      buffer[write++] = entry;
    }
  }
  buffer.length = write;

  const dir = decodeInputDir(mask);
  const newlyPressed = (mask & ~prevMask) & ALL_ACTION_MASK;
  if (newlyPressed === 0) return;

  for (let i = 0; i < ACTION_BITS.length; i++) {
    const bit = ACTION_BITS[i];
    if (bit !== undefined && (newlyPressed & bit) !== 0) {
      buffer.push({ bit, dir, pressedTick: tick });
    }
  }
}

export function consumeBuffered(
  buffer: InputBufferEntry[],
  bit: InputBit,
  currentTick: number,
  bufferFrames: number,
): InputBufferEntry | null {
  assert(Number.isInteger(bufferFrames) && bufferFrames >= 0, ErrorCode.InvariantViolation, `Invalid bufferFrames: ${bufferFrames}`);
  for (let i = 0; i < buffer.length; i++) {
    const entry = buffer[i];
    if (entry === undefined) continue;
    const age = currentTick - entry.pressedTick;
    if (entry.bit === bit && age >= 0 && age <= bufferFrames) {
      buffer.splice(i, 1);
      return entry;
    }
  }
  return null;
}

function matchesSequence3(dirs: readonly InputDir[], a: InputDir, b: InputDir, c: InputDir): boolean {
  let stage = 0;
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    if (stage === 0) {
      if (d === a) stage = 1;
    } else if (stage === 1) {
      if (d === b) stage = 2;
    } else if (d === c) {
      return true;
    }
  }
  return false;
}

export function detectMotionInput(
  ring: InputHistoryRing,
  currentTick: number,
  facingRight: boolean,
  windowFrames: number,
): MotionInput {
  assert(Number.isInteger(windowFrames) && windowFrames >= 0, ErrorCode.InvariantViolation, `Invalid windowFrames: ${windowFrames}`);
  const cap = ring.masks.length;
  if (ring.count === 0 || cap === 0) return MotionInput.None;

  const dirs: InputDir[] = [];
  const start = (ring.head - ring.count + cap) % cap;
  for (let i = 0; i < ring.count; i++) {
    const idx = (start + i) % cap;
    const tick = ring.ticks[idx];
    const mask = ring.masks[idx];
    if (tick === undefined || mask === undefined) continue;
    const age = currentTick - tick;
    if (age >= 0 && age <= windowFrames) {
      dirs.push(decodeInputDir(mask));
    }
  }

  const fwd = facingRight ? InputDir.Right : InputDir.Left;
  const downFwd = facingRight ? InputDir.DownRight : InputDir.DownLeft;
  const back = facingRight ? InputDir.Left : InputDir.Right;
  const downBack = facingRight ? InputDir.DownLeft : InputDir.DownRight;

  if (matchesSequence3(dirs, fwd, InputDir.Down, downFwd)) return MotionInput.Dp623;
  if (matchesSequence3(dirs, InputDir.Down, downFwd, fwd)) return MotionInput.Qcf236;
  if (matchesSequence3(dirs, InputDir.Down, downBack, back)) return MotionInput.Qcb214;
  return MotionInput.None;
}
