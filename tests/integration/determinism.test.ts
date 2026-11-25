import { beforeAll, describe, expect, it } from 'vitest';
import { BotKind, buildBotView, createBot, type BotController } from '@bots/index';
import { getArenaSpec } from '@sim/data';
import { ArenaId, FighterId, MatchMode, TeamId } from '@sim/enums';
import { SeededRng } from '@sim/prng';
import type { MatchConfig, RoundResult } from '@sim/types';
import { initPhysics, SimWorld } from '@sim/world';

interface MatchRunSummary {
  readonly finalHash: string;
  readonly ticks: number;
  readonly result: RoundResult | null;
  readonly inputTapeBySlot: readonly (readonly number[])[];
}

function runBotMatch(
  seed: number,
  arenaId: ArenaId,
  bots: readonly { slot: number; id: FighterId; kind: BotKind }[],
  maxTicks = 1800,
): MatchRunSummary {
  const config: MatchConfig = {
    arenaId,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed,
    stocksOverride: 2,
    fighters: bots.map((b) => ({ slot: b.slot, id: b.id, team: TeamId.None })),
  };
  const world = new SimWorld(config);
  const arena = getArenaSpec(arenaId);
  const controllers = new Map<number, BotController>();
  const rngs = new Map<number, SeededRng>();
  const tapes: number[][] = bots.map(() => []);

  for (const b of bots) {
    controllers.set(b.slot, createBot({ kind: b.kind }));
    rngs.set(b.slot, new SeededRng((seed ^ ((b.slot + 1) * 0x9e3779b1)) | 0));
  }

  for (let t = 0; t < maxTicks && !world.isFinished(); t++) {
    const view = buildBotView(
      world.tick,
      world.fighters,
      world.island,
      world.gadgets.worldGadgets,
      world.gadgets.projectiles,
      arena.blastZone,
      arena.chunks,
    );
    const masks = bots.map((b) => {
      const m = controllers.get(b.slot)!.decide(view, b.slot, rngs.get(b.slot)!);
      tapes[b.slot]!.push(m);
      return m;
    });
    world.step(masks);
  }

  const finalHash = world.computeStateHash();
  const ticks = world.tick;
  const result = world.getRoundResult();
  world.dispose();
  return { finalHash, ticks, result, inputTapeBySlot: tapes };
}

function replayGoldenTape(
  seed: number,
  arenaId: ArenaId,
  fighters: readonly { slot: number; id: FighterId }[],
  tapes: readonly (readonly number[])[],
): { finalHash: string; result: RoundResult | null } {
  const world = new SimWorld({
    arenaId,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed,
    stocksOverride: 2,
    fighters: fighters.map((f) => ({ slot: f.slot, id: f.id, team: TeamId.None })),
  });
  const tapeBots = fighters.map((f) => createBot({ kind: BotKind.Tape, tape: tapes[f.slot]! }));
  const rng = new SeededRng(seed);
  const arena = getArenaSpec(arenaId);
  const totalTicks = tapes[0]?.length ?? 0;

  for (let t = 0; t < totalTicks && !world.isFinished(); t++) {
    const view = buildBotView(
      world.tick,
      world.fighters,
      world.island,
      world.gadgets.worldGadgets,
      world.gadgets.projectiles,
      arena.blastZone,
      arena.chunks,
    );
    const masks = fighters.map((f, i) => tapeBots[i]!.decide(view, f.slot, rng));
    world.step(masks);
  }

  const finalHash = world.computeStateHash();
  const result = world.getRoundResult();
  world.dispose();
  return { finalHash, result };
}

const GOLDEN_FIXTURES = [
  {
    name: 'Willow mixed 4-bot',
    seed: 101,
    arenaId: ArenaId.Willow,
    expectedHash: '5fef4f40',
    bots: [
      { slot: 0, id: FighterId.Earl, kind: BotKind.Brawler },
      { slot: 1, id: FighterId.Grog, kind: BotKind.Chaser },
      { slot: 2, id: FighterId.Nesta, kind: BotKind.Sharp },
      { slot: 3, id: FighterId.Moss, kind: BotKind.Masher },
    ],
  },
  {
    name: 'HighTea sharp/brawler',
    seed: 202,
    arenaId: ArenaId.HighTea,
    expectedHash: '5f79ef30',
    bots: [
      { slot: 0, id: FighterId.Grog, kind: BotKind.Sharp },
      { slot: 1, id: FighterId.Moss, kind: BotKind.Brawler },
      { slot: 2, id: FighterId.Earl, kind: BotKind.Chaser },
      { slot: 3, id: FighterId.Nesta, kind: BotKind.Masher },
    ],
  },
  {
    name: 'MendedBowl split chaos',
    seed: 303,
    arenaId: ArenaId.MendedBowl,
    expectedHash: 'b9f72acd',
    bots: [
      { slot: 0, id: FighterId.Nesta, kind: BotKind.Brawler },
      { slot: 1, id: FighterId.Earl, kind: BotKind.Sharp },
      { slot: 2, id: FighterId.Grog, kind: BotKind.Masher },
      { slot: 3, id: FighterId.Moss, kind: BotKind.Chaser },
    ],
  },
  {
    name: 'Willow mirror Sharp vs Brawler',
    seed: 404,
    arenaId: ArenaId.Willow,
    expectedHash: '837031d4',
    bots: [
      { slot: 0, id: FighterId.Moss, kind: BotKind.Sharp },
      { slot: 1, id: FighterId.Earl, kind: BotKind.Brawler },
      { slot: 2, id: FighterId.Grog, kind: BotKind.Chaser },
      { slot: 3, id: FighterId.Nesta, kind: BotKind.Sharp },
    ],
  },
  {
    name: 'HighTea Masher & Chaser',
    seed: 505,
    arenaId: ArenaId.HighTea,
    expectedHash: '3a14a8d5',
    bots: [
      { slot: 0, id: FighterId.Earl, kind: BotKind.Masher },
      { slot: 1, id: FighterId.Nesta, kind: BotKind.Chaser },
      { slot: 2, id: FighterId.Moss, kind: BotKind.Brawler },
      { slot: 3, id: FighterId.Grog, kind: BotKind.Sharp },
    ],
  },
] as const;

describe('Determinism & Golden Replays (M2.10)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it.each(GOLDEN_FIXTURES)(
    'reproduces identical computeStateHash, pinned golden hash, koOrder, and Tape replay for $name (seed=$seed)',
    ({ seed, arenaId, expectedHash, bots }) => {
      const runA = runBotMatch(seed, arenaId, bots);
      const runB = runBotMatch(seed, arenaId, bots);

      expect(runA.finalHash).toBe(expectedHash);
      expect(runA.finalHash).toBe(runB.finalHash);
      expect(runA.ticks).toBe(runB.ticks);
      expect(runA.result?.koOrder).toEqual(runB.result?.koOrder);
      expect(runA.result?.winnerSlot).toBe(runB.result?.winnerSlot);

      const replay = replayGoldenTape(seed, arenaId, bots, runA.inputTapeBySlot);
      expect(replay.finalHash).toBe(expectedHash);
      expect(replay.result?.koOrder).toEqual(runA.result?.koOrder);
    },
  );
});
