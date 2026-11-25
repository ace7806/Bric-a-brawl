import { InputBit, InputDir } from '@sim/enums';

/** Compose a 16-bit input mask from a direction enum and action bit flags. */
export function mask(dir: InputDir = InputDir.Neutral, ...bits: InputBit[]): number {
  let out = dir & InputBit.DirMask;
  for (const bit of bits) out |= bit;
  return out;
}

/** Fluent deterministic input tape builder for frame-exact tests & Tape bot scenarios. */
export class TapeBuilder {
  private readonly frames: number[] = [];

  public wait(ticks: number): this {
    for (let i = 0; i < ticks; i++) this.frames.push(0);
    return this;
  }

  public hold(ticks: number, dir: InputDir, ...bits: InputBit[]): this {
    const m = mask(dir, ...bits);
    for (let i = 0; i < ticks; i++) this.frames.push(m);
    return this;
  }

  public tap(dir: InputDir, ...bits: InputBit[]): this {
    this.frames.push(mask(dir, ...bits));
    return this;
  }

  public motion236(facingRight: boolean, bit: InputBit = InputBit.Special): this {
    const df = facingRight ? InputDir.DownRight : InputDir.DownLeft;
    const f = facingRight ? InputDir.Right : InputDir.Left;
    this.frames.push(mask(InputDir.Down), mask(df), mask(f, bit));
    return this;
  }

  public motion623(facingRight: boolean, bit: InputBit = InputBit.Special): this {
    const df = facingRight ? InputDir.DownRight : InputDir.DownLeft;
    const f = facingRight ? InputDir.Right : InputDir.Left;
    this.frames.push(mask(f), mask(InputDir.Down), mask(df, bit));
    return this;
  }

  public motion214(facingRight: boolean, bit: InputBit = InputBit.Special): this {
    const db = facingRight ? InputDir.DownLeft : InputDir.DownRight;
    const b = facingRight ? InputDir.Left : InputDir.Right;
    this.frames.push(mask(InputDir.Down), mask(db), mask(b, bit));
    return this;
  }

  public build(): readonly number[] {
    return this.frames.slice();
  }
}

export function tape(): TapeBuilder {
  return new TapeBuilder();
}
