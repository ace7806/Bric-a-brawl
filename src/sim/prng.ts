import { assert } from './assert';
import { ErrorCode } from './enums';

/** Deterministic Mulberry32 PRNG. Pure integer state, zero Math.random usage. */
export class SeededRng {
  private state: number;

  public constructor(seed: number) {
    assert(Number.isInteger(seed), ErrorCode.InvariantViolation, `PRNG seed must be an integer, got ${seed}`);
    this.state = seed | 0;
  }

  public getState(): number {
    return this.state;
  }

  public setState(state: number): void {
    this.state = state | 0;
  }

  /** Uniform float in [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  public int(min: number, max: number): number {
    assert(max >= min, ErrorCode.InvariantViolation, `Invalid int range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  public range(min: number, max: number): number {
    assert(max >= min, ErrorCode.InvariantViolation, `Invalid range [${min}, ${max}]`);
    return min + this.next() * (max - min);
  }

  /** Pick uniformly from a non-empty array. */
  public pick<T>(items: readonly T[]): T {
    assert(items.length > 0, ErrorCode.IndexOutOfBounds, 'Cannot pick from empty array');
    return items[this.int(0, items.length - 1)] as T;
  }
}
