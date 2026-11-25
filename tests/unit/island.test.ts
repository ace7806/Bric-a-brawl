import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requireAt } from '@sim/assert';
import { getArenaSpec, getFighterSpec, getGameData } from '@sim/data';
import {
  ArenaId,
  ChunkState,
  CrackSource,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  HazardId,
  MotionInput,
  MoveId,
  NestaSize,
  SimEventKind,
  TeamId,
} from '@sim/enums';
import { createInputHistory } from '@sim/input';
import { createIsland, damageChunk, getUpdraftBounds, querySurfaceAt, stepIsland } from '@sim/island';
import { SeededRng } from '@sim/prng';
import type { FighterRuntime, IslandState, SimEvent } from '@sim/types';
import { assertValidWorldState, assertWithinBand, expectEvent, findEvents } from '../support/asserts';

interface IslandHarness {
  readonly rapierWorld: RAPIER.World;
  readonly island: IslandState;
  readonly rng: SeededRng;
  readonly events: SimEvent[];
  step(tick: number, fighters?: readonly FighterRuntime[]): void;
  free(): void;
}

const activeWorlds: RAPIER.World[] = [];

function createHarness(arenaId: ArenaId, playerCount = 6, fragile = false): IslandHarness {
  const { gravity } = getGameData().tuning;
  const rapierWorld = new RAPIER.World({ x: 0, y: -gravity });
  rapierWorld.timestep = 1 / 60;
  activeWorlds.push(rapierWorld);
  const island = createIsland(RAPIER, rapierWorld, arenaId, playerCount, fragile);
  const rng = new SeededRng(42);
  const events: SimEvent[] = [];
  return {
    rapierWorld,
    island,
    rng,
    events,
    step(tick: number, fighters: readonly FighterRuntime[] = []) {
      rapierWorld.step();
      stepIsland(RAPIER, rapierWorld, island, fighters, tick, rng, events);
    },
    free() {
      rapierWorld.free();
    },
  };
}

function makeFighter(id: FighterId, overrides: Partial<FighterRuntime> = {}): FighterRuntime {
  const spec = getFighterSpec(id);
  return {
    slot: 0,
    id,
    team: TeamId.None,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    kbVx: 0,
    kbVy: 0,
    state: FighterState.Idle,
    stateFrame: 0,
    flags: FighterFlag.FacingRight | FighterFlag.Grounded,
    damage: 0,
    guardHp: spec.stats.guardHP,
    guardRegenDelay: 0,
    parryCooldown: 0,
    gilt: 0,
    stocks: 3,
    heldGadget: GadgetId.None,
    heldGadgetAmmo: 0,
    gadgetCooldown: 0,
    corkChargeFrames: 0,
    activeMove: MoveId.None,
    moveFrame: 0,
    moveHitConnected: false,
    moveHitIds: [],
    moveIsClean: false,
    heavyChargeFrames: 0,
    hitstopFrames: 0,
    hitstunFrames: 0,
    blockstunFrames: 0,
    invulnFrames: 0,
    regrabImmunity: 0,
    grabbedBySlot: -1,
    grabbingSlot: -1,
    grabHoldFrames: 0,
    doubleJumpsLeft: 1,
    airDodgesLeft: 1,
    wallJumpsLeft: 1,
    ledgeGrabCount: 0,
    ledgeChunkIndex: -1,
    ledgeSide: 0,
    comboCount: 0,
    comboHitsByMove: new Map(),
    lastHitBySlot: -1,
    lastHitByGadget: GadgetId.None,
    lastHitByMove: MoveId.None,
    lastHitTick: -1,
    nestaSize: NestaSize.Mid,
    shedsRemaining: 2,
    pipingCharged: false,
    steepChargeFrames: 0,
    sneezeBuildFrames: 0,
    rootFrames: 0,
    rootMashCount: 0,
    slipperyFrames: 0,
    teaspoonCooldown: 0,
    teaspoonX: 0,
    lastInputMask: 0,
    prevInputMask: 0,
    lastInputTick: 0,
    posHistoryX: new Float32Array(120),
    posHistoryY: new Float32Array(120),
    posHistoryCursor: 0,
    posHistoryCount: 0,
    buffer: [],
    history: createInputHistory(32),
    hurtboxHistory: [],
    lastMotion: MotionInput.None,
    pendingHit: null,
    stampedeCarriedSlot: -1,
    stampedeCarryFrames: 0,
    bodyHandle: 0,
    colliderHandle: 0,
    ...overrides,
  };
}

describe('island physics, fracture state machine, hazards, and seam continuity', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  afterEach(() => {
    while (activeWorlds.length > 0) {
      activeWorlds.pop()!.free();
    }
  });

  it('progresses Willow Plate chunk through Intact -> Crazed -> Loose -> Falling -> Gone with ChunkState events', () => {
    const h = createHarness(ArenaId.Willow, 6, false);
    const { terrain, tickRate } = getGameData().tuning;
    const arena = getArenaSpec(ArenaId.Willow);
    const w1 = requireAt(h.island.chunks, 0, 'W1');
    const looseTicks = Math.round(terrain.looseSinkSeconds * tickRate);

    expect(w1.state).toBe(ChunkState.Intact);
    damageChunk(RAPIER, h.rapierWorld, h.island, 0, 30, CrackSource.Move, false, 1, h.rng, h.events);
    expect(w1.state).toBe(ChunkState.Intact);
    expect(findEvents(h.events, SimEventKind.ChunkState)).toHaveLength(0);

    damageChunk(RAPIER, h.rapierWorld, h.island, 0, 6, CrackSource.Move, false, 2, h.rng, h.events);
    expect(w1.hp).toBe(24);
    expect(w1.state).toBe(ChunkState.Crazed);
    expectEvent(h.events, SimEventKind.ChunkState, (e) => e.a === 0 && e.b === ChunkState.Crazed);

    damageChunk(RAPIER, h.rapierWorld, h.island, 0, 24, CrackSource.Slam, false, 3, h.rng, h.events);
    expect(w1.hp).toBe(0);
    expect(w1.state).toBe(ChunkState.Loose);
    assertWithinBand(h.island.rubble.length, terrain.rubblePerChunk[0], terrain.rubblePerChunk[1], 'W1 rubble shed');
    expectEvent(h.events, SimEventKind.ChunkState, (e) => e.a === 0 && e.b === ChunkState.Loose);

    for (let t = 1; t < looseTicks; t++) {
      h.step(t);
      expect(w1.state).toBe(ChunkState.Loose);
    }
    h.step(looseTicks);
    expect(w1.state).toBe(ChunkState.Falling);
    expectEvent(h.events, SimEventKind.ChunkState, (e) => e.a === 0 && e.b === ChunkState.Falling);

    for (let t = looseTicks + 1; t <= looseTicks + 120 && w1.state !== ChunkState.Gone; t++) {
      h.step(t);
    }
    expect(w1.state).toBe(ChunkState.Gone);
    expect(w1.y).toBeLessThan(arena.blastZone.bottom);
    expect(w1.bodyHandle).toBe(-1);
    expectEvent(h.events, SimEventKind.ChunkState, (e) => e.a === 0 && e.b === ChunkState.Gone);

    const states = findEvents(h.events, SimEventKind.ChunkState, (e) => e.a === 0).map((e) => e.b);
    expect(states).toEqual([ChunkState.Crazed, ChunkState.Loose, ChunkState.Falling, ChunkState.Gone]);
  });

  it.each([
    { arenaId: ArenaId.Willow, fragile: false, amount: 20, expectedDelta: 20, expectedState: ChunkState.Intact },
    { arenaId: ArenaId.Willow, fragile: true, amount: 20, expectedDelta: 40, expectedState: ChunkState.Crazed },
    { arenaId: ArenaId.Saucer, fragile: false, amount: 100, expectedDelta: 0, expectedState: ChunkState.Intact },
    { arenaId: ArenaId.Saucer, fragile: true, amount: 1000, expectedDelta: 0, expectedState: ChunkState.Intact },
  ])(
    'applies crack damage rules for arena=$arenaId fragile=$fragile',
    ({ arenaId, fragile, amount, expectedDelta, expectedState }) => {
      const h = createHarness(arenaId, 6, fragile);
      const chunk = requireAt(h.island.chunks, 0, 'chunk[0]');
      const startHp = chunk.hp;

      damageChunk(RAPIER, h.rapierWorld, h.island, 0, amount, CrackSource.Slam, fragile, 1, h.rng, h.events);
      expect(startHp - chunk.hp).toBe(expectedDelta);
      expect(h.island.crackTotals[CrackSource.Slam]).toBe(expectedDelta);
      expect(chunk.state).toBe(expectedState);
    },
  );

  it('enforces maxDynamicChunks (6) and maxRubble (16, oldest resting piece crumbles)', () => {
    const h = createHarness(ArenaId.Willow, 6, false);
    const { terrain, tickRate } = getGameData().tuning;
    const looseTicks = Math.round(terrain.looseSinkSeconds * tickRate);

    for (let i = 0; i < 8; i++) {
      damageChunk(RAPIER, h.rapierWorld, h.island, i, 500, CrackSource.Slam, false, 0, h.rng, h.events);
    }
    expect(h.island.rubble.length).toBe(terrain.maxRubble);

    for (let t = 1; t <= looseTicks + 120; t++) {
      h.step(t);
      assertValidWorldState({ tick: t, fighters: [], island: h.island, projectiles: [], worldGadgets: [] });
      if (t === looseTicks) {
        const falling = h.island.chunks.filter((c) => c.state === ChunkState.Falling).length;
        expect(falling).toBe(terrain.maxDynamicChunks);
        expect(requireAt(h.island.chunks, 6, 'W7').state).toBe(ChunkState.Loose);
        expect(requireAt(h.island.chunks, 7, 'W8').state).toBe(ChunkState.Loose);
      }
    }
    expect(requireAt(h.island.chunks, 6, 'W7').state).not.toBe(ChunkState.Loose);
    expect(requireAt(h.island.chunks, 7, 'W8').state).not.toBe(ChunkState.Loose);

    // Verify oldest resting rubble piece crumbles first while non-resting and newer resting pieces stay
    const h2 = createHarness(ArenaId.Willow, 6, false);
    for (let i = 0; i < 8; i++) {
      damageChunk(RAPIER, h2.rapierWorld, h2.island, i, 500, CrackSource.Slam, false, 0, h2.rng, h2.events);
    }
    expect(h2.island.rubble.length).toBe(terrain.maxRubble);
    requireAt(h2.island.rubble, 0, 'rubble[0]').resting = false;
    for (let i = 1; i <= 5; i++) requireAt(h2.island.rubble, i, `rubble[${i}]`).resting = true;
    const nonRestingId = requireAt(h2.island.rubble, 0, 'rubble[0]').id;
    const oldestRestingId = requireAt(h2.island.rubble, 1, 'rubble[1]').id;
    const newerRestingId = requireAt(h2.island.rubble, 5, 'rubble[5]').id;

    damageChunk(RAPIER, h2.rapierWorld, h2.island, 8, 500, CrackSource.Slam, false, 1, h2.rng, h2.events);
    expect(h2.island.rubble.length).toBe(terrain.maxRubble);
    expect(h2.island.rubble.some((r) => r.id === oldestRestingId)).toBe(false);
    expect(h2.island.rubble.some((r) => r.id === nonRestingId)).toBe(true);
    expect(h2.island.rubble.some((r) => r.id === newerRestingId)).toBe(true);
  });

  it('recomputes Willow Plate ledges immediately when W1 drops to Loose', () => {
    const h = createHarness(ArenaId.Willow, 6, false);
    expect(h.island.ledges).toEqual([
      { chunkIndex: 0, side: -1, x: -13.0, y: 0.5 },
      { chunkIndex: 11, side: 1, x: 13.0, y: 0.5 },
    ]);

    damageChunk(RAPIER, h.rapierWorld, h.island, 0, 100, CrackSource.Slam, false, 1, h.rng, h.events);
    expect(requireAt(h.island.chunks, 0, 'W1').state).toBe(ChunkState.Loose);
    expect(h.island.ledges).toEqual([
      { chunkIndex: 1, side: -1, x: -10.833, y: 0.024 },
      { chunkIndex: 11, side: 1, x: 13.0, y: 0.5 },
    ]);
  });

  it.each([
    { players: 2, expectedShift: 600, rimStart: ChunkState.Gone, w2CrazeTick: 2100 },
    { players: 6, expectedShift: 0, rimStart: ChunkState.Intact, w2CrazeTick: 2700 },
  ])(
    'scales Willow timeline and starting rim by playerCount=$players',
    ({ players, expectedShift, rimStart, w2CrazeTick }) => {
      const h = createHarness(ArenaId.Willow, players, false);
      expect(h.island.playerCountTimeShiftTicks).toBe(expectedShift);
      expect(requireAt(h.island.chunks, 0, 'W1').state).toBe(rimStart);
      expect(requireAt(h.island.chunks, 11, 'W12').state).toBe(rimStart);

      for (let t = 0; t < w2CrazeTick; t++) h.step(t);
      expect(h.island.timelineFired[2]).toBe(false);
      expect(requireAt(h.island.chunks, 1, 'W2').state).toBe(ChunkState.Intact);

      h.step(w2CrazeTick);
      expect(h.island.timelineFired[2]).toBe(true);
      expect(requireAt(h.island.chunks, 1, 'W2').state).toBe(ChunkState.Crazed);
    },
  );

  it('drops Willow Plate bridge platform only after both support chunks (W6, W7) fail', () => {
    const h = createHarness(ArenaId.Willow, 6, false);
    const bridge = requireAt(h.island.platforms, 0, 'bridge');

    damageChunk(RAPIER, h.rapierWorld, h.island, 5, 500, CrackSource.Slam, false, 0, h.rng, h.events);
    for (let t = 1; t <= 10; t++) h.step(t);
    expect(bridge.falling).toBe(false);
    expect(bridge.alive).toBe(true);
    expect(querySurfaceAt(h.island, 0, 2.8, 2.4, false)?.platformIndex).toBe(0);

    damageChunk(RAPIER, h.rapierWorld, h.island, 6, 500, CrackSource.Slam, false, 11, h.rng, h.events);
    h.step(11);
    expect(bridge.falling).toBe(true);
    expectEvent(h.events, SimEventKind.PlatformState, (e) => e.a === 0 && e.b === 1);
    expect(querySurfaceAt(h.island, 0, 2.8, 2.4, false)).toBeNull();

    for (let t = 12; t <= 90 && bridge.alive; t++) h.step(t);
    expect(bridge.alive).toBe(false);
  });

  it('runs High Tea Pour hazard phases and StemSnap seesaw torque capped at +/-14 deg', () => {
    const h = createHarness(ArenaId.HighTea, 6, false);
    const pour = getArenaSpec(ArenaId.HighTea).pourHazard!;
    const pourTick = pour.atTicks[0]!;

    for (let t = 0; t < pourTick; t++) h.step(t);
    expect(h.island.pour.telegraphing).toBe(false);

    h.step(pourTick);
    expect(h.island.pour.telegraphing).toBe(true);
    expect(h.island.pour.active).toBe(false);
    expectEvent(h.events, SimEventKind.Hazard, (e) => e.a === HazardId.Pour && e.b === 0);

    for (let t = pourTick + 1; t < pourTick + pour.telegraphTicks; t++) h.step(t);
    expect(h.island.pour.telegraphing).toBe(false);
    expect(h.island.pour.active).toBe(true);
    expectEvent(h.events, SimEventKind.Hazard, (e) => e.a === HazardId.Pour && e.b === 1);

    const inPour = makeFighter(FighterId.Earl, { slot: 0, x: 3.5, y: 4.2 });
    const outPour = makeFighter(FighterId.Earl, { slot: 1, x: -3.5, y: 4.2 });
    h.step(pourTick + pour.telegraphTicks, [inPour, outPour]);
    expect(inPour.vy).toBeLessThan(0);
    expect(inPour.vx).toBeGreaterThan(0);
    expect(inPour.flags & FighterFlag.Slippery).toBeTruthy();
    expect(inPour.slipperyFrames).toBe(pour.slipperyTicks);
    expect(outPour.vx).toBe(0);
    expect(outPour.vy).toBe(0);
    expect(outPour.flags & FighterFlag.Slippery).toBe(0);

    for (let t = pourTick + pour.telegraphTicks + 1; t <= pourTick + pour.telegraphTicks + pour.durationTicks; t++) {
      h.step(t);
    }
    expect(h.island.pour.active).toBe(false);
    expectEvent(h.events, SimEventKind.Hazard, (e) => e.a === HazardId.Pour && e.b === 2);

    for (let t = pourTick + pour.telegraphTicks + pour.durationTicks + 1; t <= 5100; t++) h.step(t);
    expect(h.island.seesaw.snapped).toBe(true);

    const heavy = makeFighter(FighterId.Grog, { slot: 0, x: 2.8, y: 8.0, flags: FighterFlag.Grounded });
    const light = makeFighter(FighterId.Moss, { slot: 1, x: -2.8, y: 8.0, flags: FighterFlag.Grounded });
    for (let t = 5101; t <= 5300; t++) h.step(t, [heavy, light]);
    expect(h.island.seesaw.angleDeg).toBeCloseTo(14.0, 5);

    heavy.x = -3.0;
    light.stocks = 0;
    for (let t = 5301; t <= 5600; t++) h.step(t, [heavy, light]);
    expect(h.island.seesaw.angleDeg).toBeCloseTo(-14.0, 5);
  });

  it('runs Mended Bowl Split to 8 u gap, activates Updraft at >= 2 u, and Tilts halves to +/-12 deg', () => {
    const h = createHarness(ArenaId.MendedBowl, 6, false);

    for (let t = 0; t < 2100; t++) h.step(t);
    expect(h.island.bowl.splitActive).toBe(false);
    expect(getUpdraftBounds(h.island)).toBeNull();

    let updraftActivatedGap = 0;
    for (let t = 2100; t <= 6000; t++) {
      const prevUpdraft = getUpdraftBounds(h.island);
      h.step(t);
      const nextUpdraft = getUpdraftBounds(h.island);
      if (prevUpdraft === null && nextUpdraft !== null) {
        updraftActivatedGap = h.island.bowl.gap;
        expect(nextUpdraft.x0).toBeCloseTo(-h.island.bowl.gap * 0.5, 6);
        expect(nextUpdraft.x1).toBeCloseTo(h.island.bowl.gap * 0.5, 6);
        expect(nextUpdraft.gravityMult).toBe(0.45);
      }
      if (t === 4000) expect(h.island.bowl.gap).toBe(8.0);
      if (t === 4500) expect(h.island.bowl.tiltActive).toBe(true);
    }

    expect(updraftActivatedGap).toBeGreaterThanOrEqual(2.0);
    expect(h.island.bowl.gap).toBe(8.0);
    expect(h.island.bowl.tiltDeg).toBe(12.0);
    expect(requireAt(h.island.chunks, 3, 'B4').angle).toBeCloseTo((12 * Math.PI) / 180, 6);
    expect(requireAt(h.island.chunks, 4, 'B5').angle).toBeCloseTo((-12 * Math.PI) / 180, 6);
  });

  it('guarantees continuous zero-gap surface queries across all Willow Plate chunk seams (Risk R13)', () => {
    const h = createHarness(ArenaId.Willow, 6, false);
    const arena = getArenaSpec(ArenaId.Willow);
    const xs = new Set<number>();

    for (let i = 0; i <= 1300; i++) xs.add(-13 + i * 0.02);
    for (const c of arena.chunks) {
      xs.add(c.topX0);
      xs.add(c.topX1);
      if (c.topX0 > -13) xs.add(c.topX0 - 1e-4);
      if (c.topX1 < 13) xs.add(c.topX1 + 1e-4);
    }

    const sorted = Array.from(xs).sort((a, b) => a - b);
    let prevY: number | null = null;
    for (const x of sorted) {
      const hit = querySurfaceAt(h.island, x, 0.8, -0.2, true);
      expect(hit, `expected surface hit at x=${x}`).not.toBeNull();
      expect(hit!.chunkIndex).toBeGreaterThanOrEqual(0);
      expect(hit!.platformIndex).toBe(-1);
      expect(Number.isFinite(hit!.y)).toBe(true);
      assertWithinBand(hit!.y, -1e-6, 0.5 + 1e-6, `surface y at x=${x}`);
      if (prevY !== null) {
        expect(Math.abs(hit!.y - prevY), `seam discontinuity near x=${x}`).toBeLessThanOrEqual(0.02);
      }
      prevY = hit!.y;
    }
  });
});
