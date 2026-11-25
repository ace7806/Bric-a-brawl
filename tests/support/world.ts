import { requireAt } from '@sim/assert';
import { createHurtboxFrame } from '@sim/combat';
import { getFighterSpec } from '@sim/data';
import {
  ArenaId,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  MatchMode,
  MotionInput,
  MoveId,
  NestaSize,
  TeamId,
} from '@sim/enums';
import { getEffectiveStats } from '@sim/fighter';
import { querySurfaceAt } from '@sim/island';
import type { FighterRuntime, MatchConfig, SimEvent } from '@sim/types';
import { initPhysics, SimWorld } from '@sim/world';
import { assertValidWorldState } from './asserts';

const trackedWorlds: SimWorld[] = [];

/** Idempotent Rapier WASM initialization for integration and netsim tests. */
export async function ensurePhysics(): Promise<void> {
  await initPhysics();
}

/** Create a SimWorld with clean defaults (Willow, FreeForAll, 2x Earl, seed 7) and auto-track for disposal. */
export function createMatch(overrides: Partial<MatchConfig> = {}): SimWorld {
  const config: MatchConfig = {
    arenaId: overrides.arenaId ?? ArenaId.Willow,
    mode: overrides.mode ?? MatchMode.FreeForAll,
    fragile: overrides.fragile ?? false,
    seed: overrides.seed ?? 7,
    fighters: overrides.fighters ?? [
      { slot: 0, id: FighterId.Earl, team: TeamId.None },
      { slot: 1, id: FighterId.Earl, team: TeamId.None },
    ],
    ...(overrides.enableTierB !== undefined ? { enableTierB: overrides.enableTierB } : {}),
    ...(overrides.enableTierC !== undefined ? { enableTierC: overrides.enableTierC } : {}),
    ...(overrides.stocksOverride !== undefined ? { stocksOverride: overrides.stocksOverride } : {}),
  };
  const world = new SimWorld(config);
  trackedWorlds.push(world);
  return world;
}

/** Free all tracked SimWorld Rapier instances (call in afterEach). */
export function disposeAllWorlds(): void {
  while (trackedWorlds.length > 0) {
    trackedWorlds.pop()?.dispose();
  }
}

export function resetFighterForTest(world: SimWorld, f: FighterRuntime, x: number, y: number, facingRight: boolean): void {
  f.x = x;
  f.y = y;
  f.vx = 0;
  f.vy = 0;
  f.kbVx = 0;
  f.kbVy = 0;
  f.state = FighterState.Idle;
  f.stateFrame = 0;
  f.flags = (facingRight ? FighterFlag.FacingRight : FighterFlag.None) | FighterFlag.Grounded;
  f.damage = 0;
  f.gilt = 0;
  if (f.id === FighterId.Nesta) {
    f.nestaSize = NestaSize.Big;
    f.shedsRemaining = 2;
  }
  f.guardHp = getEffectiveStats(f).guardHP;
  f.guardRegenDelay = 0;
  f.parryCooldown = 0;
  f.heldGadget = GadgetId.None;
  f.heldGadgetAmmo = 0;
  f.gadgetCooldown = 0;
  f.corkChargeFrames = 0;
  f.activeMove = MoveId.None;
  f.moveFrame = 0;
  f.moveHitConnected = false;
  f.moveHitLanded = false;
  f.moveHitIds.length = 0;
  f.moveIsClean = false;
  f.heavyChargeFrames = 0;
  f.chaseDodgeWindow = 0;
  f.chaseDodgeActive = false;
  f.sdiNudgesLeft = 0;
  f.hitstopFrames = 0;
  f.hitstunFrames = 0;
  f.blockstunFrames = 0;
  f.invulnFrames = 0;
  f.regrabImmunity = 0;
  f.grabbedBySlot = -1;
  f.grabbingSlot = -1;
  f.grabHoldFrames = 0;
  f.doubleJumpsLeft = 1;
  f.airDodgesLeft = 1;
  f.wallJumpsLeft = 1;
  f.ledgeGrabCount = 0;
  f.ledgeChunkIndex = -1;
  f.ledgeSide = 0;
  f.comboCount = 0;
  f.comboHitsByMove.clear();
  f.lastHitBySlot = -1;
  f.lastHitByGadget = GadgetId.None;
  f.lastHitByMove = MoveId.None;
  f.lastHitTick = -1;
  f.pipingCharged = false;
  f.steepChargeFrames = 0;
  f.sneezeBuildFrames = 0;
  f.rootFrames = 0;
  f.rootMashCount = 0;
  f.slipperyFrames = 0;
  f.lastInputMask = 0;
  f.prevInputMask = 0;
  f.buffer.length = 0;
  f.history.head = 0;
  f.history.count = 0;
  f.hurtboxHistory.length = 0;
  f.hurtboxHistory.push(createHurtboxFrame(f, world.tick));
  f.lastMotion = MotionInput.None;
  f.pendingHit = null;
  f.stampedeCarriedSlot = -1;
  f.stampedeCarryFrames = 0;
  void getFighterSpec(f.id);
}

/** Place slots 0 and 1 grounded facing each other with all combat/guard/invuln state cleanly reset. */
export function positionPair(world: SimWorld, x0: number, x1: number, y?: number): void {
  const f0 = requireAt(world.fighters, 0, 'fighters');
  const f1 = requireAt(world.fighters, 1, 'fighters');
  const h0 = querySurfaceAt(world.island, x0, 10, -5, true);
  const h1 = querySurfaceAt(world.island, x1, 10, -5, true);
  const y0 = y !== undefined ? y : (h0 !== null ? h0.y : 0);
  const y1 = y !== undefined ? y : (h1 !== null ? h1.y : 0);
  resetFighterForTest(world, f0, x0, y0, x0 <= x1);
  resetFighterForTest(world, f1, x1, y1, x1 < x0);
}

export type TapesBySlot = readonly (readonly number[])[] | Readonly<Record<number, readonly number[]>>;

function getTapeInput(tapesBySlot: TapesBySlot, slot: number, tickOffset: number): number {
  const tape = Array.isArray(tapesBySlot)
    ? (tapesBySlot as readonly (readonly number[])[])[slot]
    : (tapesBySlot as Readonly<Record<number, readonly number[]>>)[slot];
  if (tape === undefined || tickOffset >= tape.length) return 0;
  return tape[tickOffset] ?? 0;
}

/** Step SimWorld feeding per-slot input tapes, assert world invariants every tick, and return all emitted events. */
export function runTape(world: SimWorld, tapesBySlot: TapesBySlot, maxTicks: number): SimEvent[] {
  const allEvents: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    const inputs = world.fighters.map((f) => getTapeInput(tapesBySlot, f.slot, t));
    const ev = world.step(inputs);
    for (let i = 0; i < ev.length; i++) allEvents.push(ev[i]!);
    assertValidWorldState({
      tick: world.tick,
      fighters: world.fighters,
      island: world.island,
      projectiles: world.gadgets.projectiles,
      worldGadgets: world.gadgets.worldGadgets,
    });
  }
  return allEvents;
}

/** Advance SimWorld with neutral inputs for `ticks`, asserting invariants every tick. */
export function stepIdle(world: SimWorld, ticks: number): SimEvent[] {
  return runTape(world, [], ticks);
}
