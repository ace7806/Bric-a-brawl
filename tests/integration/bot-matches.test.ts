import { beforeAll, describe, expect, it } from 'vitest';
import { BotKind, buildBotView, createBot } from '@bots/index';
import { getArenaSpec } from '@sim/data';
import { ALL_ARENA_IDS, ALL_FIGHTER_IDS, ArenaId, ChunkState, FighterId, MatchMode, TeamId } from '@sim/enums';
import { SeededRng } from '@sim/prng';
import { initPhysics, SimWorld } from '@sim/world';
import { assertValidWorldState } from '../support/asserts';

interface MatchFixture {
  readonly seed: number;
  readonly arenaId: ArenaId;
  readonly bots: readonly { slot: number; id: FighterId; kind: BotKind }[];
}

const BOT_POOL: readonly BotKind[] = [BotKind.Chaser, BotKind.Brawler, BotKind.Sharp, BotKind.Masher];

const MATCHES: readonly MatchFixture[] = Array.from({ length: 12 }, (_, idx) => {
  const arenaId = ALL_ARENA_IDS[idx % ALL_ARENA_IDS.length]!;
  return {
    seed: 7000 + idx * 17,
    arenaId,
    bots: ALL_FIGHTER_IDS.map((_fid, s) => ({
      slot: s,
      id: ALL_FIGHTER_IDS[(s + idx) % ALL_FIGHTER_IDS.length]!,
      kind: BOT_POOL[(s + idx) % BOT_POOL.length]!,
    })),
  };
});

function p99(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)]!;
}

describe('Bot match health, pacing, fracture & CPU speed (M2.4, M2.5)', () => {
  const aggregateTickMs: number[] = [];

  beforeAll(async () => {
    await initPhysics();
    const warmup = new SimWorld({
      arenaId: ArenaId.Willow,
      mode: MatchMode.FreeForAll,
      fragile: false,
      seed: 1,
      fighters: ALL_FIGHTER_IDS.map((id, slot) => ({ slot, id, team: TeamId.None })),
    });
    const arena = getArenaSpec(ArenaId.Willow);
    const bots = BOT_POOL.map((kind) => createBot({ kind }));
    const rngs = [1, 2, 3, 4].map((s) => new SeededRng(s * 97));
    for (let t = 0; t < 300 && !warmup.isFinished(); t++) {
      const view = buildBotView(
        warmup.tick,
        warmup.fighters,
        warmup.island,
        warmup.gadgets.worldGadgets,
        warmup.gadgets.projectiles,
        arena.blastZone,
        arena.chunks,
      );
      warmup.step(bots.map((b, i) => b.decide(view, i, rngs[i]!)));
    }
    warmup.dispose();
  });

  it.each(MATCHES)(
    'completes clean 4-bot match seed=$seed on arena=$arenaId within CPU < 12s and valid invariants',
    ({ seed, arenaId, bots }) => {
      const world = new SimWorld({
        arenaId,
        mode: MatchMode.FreeForAll,
        fragile: false,
        seed,
        fighters: bots.map((b) => ({ slot: b.slot, id: b.id, team: TeamId.None })),
      });
      const arena = getArenaSpec(arenaId);
      const controllers = bots.map((b) => createBot({ kind: b.kind }));
      const rngs = bots.map((b) => new SeededRng((seed ^ ((b.slot + 1) * 0x9e3779b1)) | 0));
      const cpuStart = performance.now();
      let maxDamageDealt = 0;

      try {
        // Run up to full hardEndSeconds (140 s = 8400 ticks)
        for (let t = 0; t < 8400 && !world.isFinished(); t++) {
          const view = buildBotView(
            world.tick,
            world.fighters,
            world.island,
            world.gadgets.worldGadgets,
            world.gadgets.projectiles,
            arena.blastZone,
            arena.chunks,
          );
          const masks = bots.map((b, i) => controllers[i]!.decide(view, b.slot, rngs[i]!));
          const t0 = performance.now();
          world.step(masks);
          aggregateTickMs.push(performance.now() - t0);

          for (const f of world.fighters) {
            if (f.damage > maxDamageDealt) maxDamageDealt = f.damage;
          }
          if (world.tick % 30 === 0) {
            assertValidWorldState({
              tick: world.tick,
              fighters: world.fighters,
              island: world.island,
              projectiles: world.gadgets.projectiles,
              worldGadgets: world.gadgets.worldGadgets,
            });
          }
        }

        const totalCpuMs = performance.now() - cpuStart;
        const result = world.getRoundResult();
        const fracturedChunks = world.island.chunks.filter((c) => c.state !== ChunkState.Intact).length;

        expect(result, 'match must terminate cleanly with a RoundResult').not.toBeNull();
        expect(result!.koOrder.length, 'KOs must occur during a full match').toBeGreaterThan(0);
        if (result!.endTick >= 1500) {
          expect(fracturedChunks, 'island chunks must fracture/progress past 25s').toBeGreaterThan(0);
        }
        expect(maxDamageDealt, 'fighters must deal real damage').toBeGreaterThan(0);
        expect(totalCpuMs, 'match CPU < 12 s').toBeLessThan(12_000);
      } finally {
        world.dispose();
      }
    },
  );

  it('maintains aggregate headless tick p99 < 4 ms across all 12 matches (M2.4)', () => {
    expect(aggregateTickMs.length).toBeGreaterThan(1000);
    expect(p99(aggregateTickMs), 'aggregate tick p99 < 4 ms').toBeLessThan(4.0);
  });
});
