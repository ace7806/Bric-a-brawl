import { describe, expect, it } from 'vitest';
import { InvariantError } from '@sim/assert';
import { getGameData } from '@sim/data';
import { ErrorCode, InputBit, InputDir, MotionInput } from '@sim/enums';
import {
  consumeBuffered,
  createInputHistory,
  decodeInputDir,
  detectMotionInput,
  dirToUnitVector,
  encodeInputMask,
  hasBit,
  pushInputHistory,
  resolveOppositeDirections,
  updateInputBuffer,
} from '@sim/input';
import type { InputBufferEntry } from '@sim/types';
import { mask, tape } from '../support/inputs';

const ALL_DIRS: readonly InputDir[] = [
  InputDir.Neutral,
  InputDir.Up,
  InputDir.UpRight,
  InputDir.Right,
  InputDir.DownRight,
  InputDir.Down,
  InputDir.DownLeft,
  InputDir.Left,
  InputDir.UpLeft,
];

const ALL_BITS: readonly InputBit[] = [
  InputBit.Tilt,
  InputBit.Jump,
  InputBit.Attack,
  InputBit.Heavy,
  InputBit.Special,
  InputBit.Guard,
  InputBit.Grab,
  InputBit.Use,
  InputBit.Taunt,
];

function pushTape(
  frames: readonly number[],
  startTick = 1,
): { ring: ReturnType<typeof createInputHistory>; lastTick: number } {
  const ring = createInputHistory(32);
  for (let i = 0; i < frames.length; i++) {
    pushInputHistory(ring, startTick + i, frames[i] as number);
  }
  return { ring, lastTick: startTick + frames.length - 1 };
}

describe('input mask, opposite directions, buffer & motion detection', () => {
  const { actionBufferFrames, motionWindowFrames } = getGameData().tuning.input;

  it.each(ALL_DIRS)('round-trips 16-bit mask for InputDir %i with all action bits', (dir) => {
    const allActionBits = ALL_BITS.reduce((acc, b) => acc | b, 0);
    const encoded = encodeInputMask(dir, allActionBits);
    expect(decodeInputDir(encoded)).toBe(dir);
    for (const bit of ALL_BITS) {
      expect(hasBit(encoded, bit)).toBe(true);
    }
    expect(hasBit(encoded, InputBit.None)).toBe(false);
    const vec = dirToUnitVector(dir);
    expect(Number.isFinite(vec.x) && Number.isFinite(vec.y)).toBe(true);
  });

  it.each(ALL_BITS)('round-trips individual InputBit %i cleanly', (bit) => {
    const encoded = encodeInputMask(InputDir.Neutral, bit);
    expect(decodeInputDir(encoded)).toBe(InputDir.Neutral);
    for (const other of ALL_BITS) {
      expect(hasBit(encoded, other)).toBe(other === bit);
    }
  });

  it.each([9, 15, -1, 1.5])('throws InvariantError for invalid InputDir %s', (badDir) => {
    expect(() => encodeInputMask(badDir as InputDir, 0)).toThrow(InvariantError);
    if (Number.isInteger(badDir)) {
      expect(() => decodeInputDir(badDir)).toThrow(InvariantError);
      try {
        decodeInputDir(badDir);
      } catch (err) {
        expect((err as InvariantError).code).toBe(ErrorCode.InvalidEnumValue);
      }
    }
  });

  it.each([
    { l: true, r: true, u: false, d: false, last: 1 as const, expected: InputDir.Right },
    { l: true, r: true, u: false, d: false, last: -1 as const, expected: InputDir.Left },
    { l: true, r: true, u: false, d: false, last: 0 as const, expected: InputDir.Neutral },
    { l: false, r: false, u: true, d: true, last: 0 as const, expected: InputDir.Neutral },
    { l: true, r: true, u: true, d: true, last: 1 as const, expected: InputDir.Right },
    { l: true, r: true, u: true, d: false, last: -1 as const, expected: InputDir.UpLeft },
    { l: false, r: true, u: false, d: true, last: -1 as const, expected: InputDir.DownRight },
  ])('resolves opposite directions ($#): expected $expected', ({ l, r, u, d, last, expected }) => {
    expect(resolveOppositeDirections(l, r, u, d, last)).toBe(expected);
  });

  it('captures newly pressed bits in 8-frame buffer and expires them on frame 9', () => {
    const buf: InputBufferEntry[] = [];
    const pressed = mask(InputDir.Right, InputBit.Attack);
    updateInputBuffer(buf, 10, pressed, 0, actionBufferFrames);
    expect(buf).toHaveLength(1);

    // Holding the same button on tick 11 must not re-buffer
    updateInputBuffer(buf, 11, pressed, pressed, actionBufferFrames);
    expect(buf).toHaveLength(1);

    // Still valid at +8 frames (tick 18)
    updateInputBuffer(buf, 10 + actionBufferFrames, 0, pressed, actionBufferFrames);
    expect(buf).toHaveLength(1);

    // Consume works on frame 8; separate buffer expires on frame 9 (tick 19)
    const expBuf: InputBufferEntry[] = [];
    updateInputBuffer(expBuf, 10, mask(InputDir.Down, InputBit.Jump), 0, actionBufferFrames);
    expect(consumeBuffered(expBuf, InputBit.Jump, 10 + actionBufferFrames, actionBufferFrames)).not.toBeNull();

    updateInputBuffer(expBuf, 20, mask(InputDir.Up, InputBit.Special), 0, actionBufferFrames);
    expect(consumeBuffered(expBuf, InputBit.Special, 20 + actionBufferFrames + 1, actionBufferFrames)).toBeNull();
    updateInputBuffer(expBuf, 20 + actionBufferFrames + 1, 0, 0, actionBufferFrames);
    expect(expBuf).toHaveLength(0);
  });

  it.each([
    { name: '236 right', facingRight: true, frames: tape().motion236(true).build(), expected: MotionInput.Qcf236 },
    { name: '236 left', facingRight: false, frames: tape().motion236(false).build(), expected: MotionInput.Qcf236 },
    { name: '623 right', facingRight: true, frames: tape().motion623(true).build(), expected: MotionInput.Dp623 },
    { name: '623 left', facingRight: false, frames: tape().motion623(false).build(), expected: MotionInput.Dp623 },
    { name: '214 right', facingRight: true, frames: tape().motion214(true).build(), expected: MotionInput.Qcb214 },
    { name: '214 left', facingRight: false, frames: tape().motion214(false).build(), expected: MotionInput.Qcb214 },
    {
      name: '623 takes precedence over 236 (6-2-3-6)',
      facingRight: true,
      frames: tape().motion623(true, InputBit.None).tap(InputDir.Right, InputBit.Special).build(),
      expected: MotionInput.Dp623,
    },
    {
      name: '623 takes precedence over 236 facing left',
      facingRight: false,
      frames: tape().motion623(false, InputBit.None).tap(InputDir.Left, InputBit.Special).build(),
      expected: MotionInput.Dp623,
    },
  ])('detects 12-frame motion: $name', ({ facingRight, frames, expected }) => {
    const { ring, lastTick } = pushTape(frames);
    expect(detectMotionInput(ring, lastTick, facingRight, motionWindowFrames)).toBe(expected);
  });

  it('keeps motion valid across 12-frame window and expires past frame 12', () => {
    const startFrame = tape().motion236(true).build();
    const ring = createInputHistory(32);
    pushInputHistory(ring, 10, startFrame[0] as number);
    pushInputHistory(ring, 15, startFrame[1] as number);
    pushInputHistory(ring, 22, startFrame[2] as number);

    // 22 - 10 = 12 frames inclusive -> valid
    expect(detectMotionInput(ring, 22, true, motionWindowFrames)).toBe(MotionInput.Qcf236);
    // At tick 23, tick 10 is 13 frames old -> expired
    expect(detectMotionInput(ring, 23, true, motionWindowFrames)).toBe(MotionInput.None);
  });
});
