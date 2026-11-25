import { expect } from 'vitest';
import { getArenaSpec, getGameData } from '@sim/data';
import { ChunkState, FighterState, SimEventKind } from '@sim/enums';
import type { FighterRuntime, IslandState, ProjectileRuntime, SimEvent, WorldGadgetRuntime } from '@sim/types';

export interface WorldSnapshotView {
  readonly tick: number;
  readonly fighters: readonly FighterRuntime[];
  readonly island: IslandState;
  readonly projectiles: readonly ProjectileRuntime[];
  readonly worldGadgets: readonly WorldGadgetRuntime[];
}

/**
 * Universal structural invariant verifier (MASTER_DESIGN 10.4 "Bad state" gate).
 * Reused across unit, integration, bot, and netsim suites to guarantee zero NaN/Inf,
 * zero blast-zone escapes, and strict adherence to Rapier body caps.
 */
export function assertValidWorldState(world: WorldSnapshotView): void {
  const tuning = getGameData().tuning;
  const bz = getArenaSpec(world.island.arenaId).blastZone;

  let fallingChunks = 0;
  for (const ch of world.island.chunks) {
    expect(Number.isFinite(ch.x), `chunk ${ch.id}.x finite`).toBe(true);
    expect(Number.isFinite(ch.y), `chunk ${ch.id}.y finite`).toBe(true);
    expect(Number.isFinite(ch.hp), `chunk ${ch.id}.hp finite`).toBe(true);
    if (ch.state === ChunkState.Falling) fallingChunks++;
  }
  expect(fallingChunks).toBeLessThanOrEqual(tuning.terrain.maxDynamicChunks);
  expect(world.island.rubble.length).toBeLessThanOrEqual(tuning.terrain.maxRubble);
  expect(world.projectiles.length).toBeLessThanOrEqual(12);
  expect(world.worldGadgets.length).toBeLessThanOrEqual(8);

  for (const f of world.fighters) {
    expect(Number.isFinite(f.x), `fighter[${f.slot}].x finite`).toBe(true);
    expect(Number.isFinite(f.y), `fighter[${f.slot}].y finite`).toBe(true);
    expect(Number.isFinite(f.vx), `fighter[${f.slot}].vx finite`).toBe(true);
    expect(Number.isFinite(f.vy), `fighter[${f.slot}].vy finite`).toBe(true);
    expect(Number.isFinite(f.damage), `fighter[${f.slot}].damage finite`).toBe(true);
    expect(f.damage).toBeGreaterThanOrEqual(0);
    expect(f.gilt).toBeGreaterThanOrEqual(0);
    expect(f.gilt).toBeLessThanOrEqual(tuning.gilt.max);

    const alive =
      f.state !== FighterState.Eliminated &&
      f.state !== FighterState.Teaspoon &&
      f.state !== FighterState.Respawn;
    if (alive) {
      // Margin of 2 u accounts for single-tick crossing resolved at end of tick
      expect(f.x, `alive fighter[${f.slot}] inside horizontal blast zone`).toBeGreaterThanOrEqual(bz.left - 2.0);
      expect(f.x, `alive fighter[${f.slot}] inside horizontal blast zone`).toBeLessThanOrEqual(bz.right + 2.0);
      expect(f.y, `alive fighter[${f.slot}] inside vertical blast zone`).toBeGreaterThanOrEqual(bz.bottom - 2.0);
      expect(f.y, `alive fighter[${f.slot}] inside vertical blast zone`).toBeLessThanOrEqual(bz.top + 2.0);
    }
  }
}

export function assertWithinBand(actual: number, min: number, max: number, label: string): void {
  expect(actual, `${label}: expected ${actual} in [${min}, ${max}]`).toBeGreaterThanOrEqual(min);
  expect(actual, `${label}: expected ${actual} in [${min}, ${max}]`).toBeLessThanOrEqual(max);
}

export function findEvents(
  events: readonly SimEvent[],
  kind: SimEventKind,
  predicate?: (e: SimEvent) => boolean,
): SimEvent[] {
  return events.filter((e) => e.kind === kind && (predicate === undefined || predicate(e)));
}

export function expectEvent(
  events: readonly SimEvent[],
  kind: SimEventKind,
  predicate?: (e: SimEvent) => boolean,
): SimEvent {
  const found = findEvents(events, kind, predicate);
  expect(found.length, `expected at least one event of kind ${SimEventKind[kind]}`).toBeGreaterThan(0);
  return found[0] as SimEvent;
}
