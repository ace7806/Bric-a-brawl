import { assert } from './assert';
import { ErrorCode } from './enums';

export interface ChunkPolyBounds {
  readonly poly: readonly (readonly [number, number])[];
  readonly topX0: number;
  readonly topX1: number;
  readonly topY0: number;
  readonly topY1: number;
}

/** Arithmetic centroid of a convex chunk polygon in local/world authoring space. */
export function polygonCentroid(poly: readonly (readonly [number, number])[]): [number, number] {
  assert(poly.length >= 3, ErrorCode.InvariantViolation, `Chunk polygon requires >= 3 vertices, got ${poly.length}`);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < poly.length; i++) {
    const pt = poly[i]!;
    sx += pt[0];
    sy += pt[1];
  }
  return [sx / poly.length, sy / poly.length];
}

/** World-space horizontal span and top-surface elevation of a chunk given its live body centroid (x, y). */
export function chunkWorldTopBounds(
  spec: ChunkPolyBounds,
  x: number,
  y: number,
): { readonly x0: number; readonly x1: number; readonly y: number } {
  const [cx0, cy0] = polygonCentroid(spec.poly);
  const dx = x - cx0;
  const dy = y - cy0;
  return {
    x0: Math.min(spec.topX0, spec.topX1) + dx,
    x1: Math.max(spec.topX0, spec.topX1) + dx,
    y: (spec.topY0 + spec.topY1) * 0.5 + dy,
  };
}
