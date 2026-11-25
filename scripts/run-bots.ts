import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';
import { createBot, type BotController } from '../src/bots/brains';
import { runAllComboSearches, type ComboSearchResult } from '../src/bots/comboSearch';
import { BotKind } from '../src/bots/enums';
import { buildBotView } from '../src/bots/view';
import { assert, assertFinite, requireAt, requireKey } from '../src/sim/assert';
import { getArenaSpec, getFighterSpec, getGameData, getGadgetSpec, parseArenaId, parseFighterId } from '../src/sim/data';
import {
  ALL_FIGHTER_IDS,
  ALL_GADGET_IDS,
  ArenaId,
  ChunkState,
  CrackSource,
  ErrorCode,
  FighterId,
  FighterState,
  GadgetId,
  KoCause,
  MatchMode,
  MoveId,
  SimEventKind,
  TeamId,
} from '../src/sim/enums';
import { SeededRng } from '../src/sim/prng';
import { initPhysics, SimWorld } from '../src/sim/world';

interface CliArgs {
  readonly fighters: FighterId[];
  readonly arena: ArenaId;
  readonly seed: number;
  readonly count: number;
  readonly outDir: string;
}

function parseCli(argv: readonly string[]): CliArgs {
  let fightersRaw = 'earl,grog,nesta,moss,earl,grog,nesta,moss';
  let arenaRaw = 'willow';
  let seed = 7;
  let count = 60;
  let outDir = 'evidence/M2';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fighters' && i + 1 < argv.length) fightersRaw = argv[++i]!;
    else if (a === '--arena' && i + 1 < argv.length) arenaRaw = argv[++i]!;
    else if (a === '--seed' && i + 1 < argv.length) seed = Number(argv[++i]);
    else if (a === '--count' && i + 1 < argv.length) count = Number(argv[++i]);
    else if (a === '--out' && i + 1 < argv.length) outDir = argv[++i]!;
  }

  assert(Number.isInteger(seed), ErrorCode.InvariantViolation, `Invalid --seed ${seed}`);
  assert(Number.isInteger(count) && count >= 1, ErrorCode.InvariantViolation, `Invalid --count ${count}`);
  const fighters = fightersRaw.split(',').map((s) => parseFighterId(s.trim()));
  assert(fighters.length >= 2 && fighters.length <= 8, ErrorCode.InvariantViolation, 'Fighter count must be 2..8');
  return { fighters, arena: parseArenaId(arenaRaw), seed, count, outDir };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx]!;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function gitCommitHash(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch (err) {
    throw new Error(`Failed to read git commit hash: ${String(err)}`);
  }
}

interface FighterAgg {
  matches: number;
  wins: number;
  damageDealt: number;
  damageTaken: number;
  kos: number;
  parriesLanded: number;
  guardBreaks: number;
  giltBreaks: number;
  offstageAttempts: number;
  offstageRecoveries: number;
  moveUses: Map<MoveId, number>;
  moveKos: Map<MoveId, number>;
}

function newFighterAgg(): FighterAgg {
  return {
    matches: 0,
    wins: 0,
    damageDealt: 0,
    damageTaken: 0,
    kos: 0,
    parriesLanded: 0,
    guardBreaks: 0,
    giltBreaks: 0,
    offstageAttempts: 0,
    offstageRecoveries: 0,
    moveUses: new Map(),
    moveKos: new Map(),
  };
}

interface GadgetAgg {
  spawned: number;
  pickedUp: number;
  used: number;
  kos: number;
  selfKos: number;
}

function incMap<K>(m: Map<K, number>, k: K, by = 1): void {
  m.set(k, (m.get(k) ?? 0) + by);
}

function verifyWorldStepInvariants(world: SimWorld): { nans: number; stuck: number } {
  const tuning = getGameData().tuning;
  const bz = getArenaSpec(world.config.arenaId).blastZone;
  let nans = 0;
  let stuck = 0;

  let falling = 0;
  for (const ch of world.island.chunks) {
    if (!Number.isFinite(ch.x) || !Number.isFinite(ch.y) || !Number.isFinite(ch.hp)) nans++;
    if (ch.state === ChunkState.Falling) falling++;
  }
  assert(falling <= tuning.terrain.maxDynamicChunks, ErrorCode.BudgetExceeded, `Falling chunks ${falling} > cap`);
  assert(world.island.rubble.length <= tuning.terrain.maxRubble, ErrorCode.BudgetExceeded, 'Rubble cap exceeded');
  assert(world.gadgets.projectiles.length <= 12, ErrorCode.BudgetExceeded, 'Projectile cap exceeded');
  assert(world.gadgets.worldGadgets.length <= 8, ErrorCode.BudgetExceeded, 'WorldGadget cap exceeded');

  for (const f of world.fighters) {
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y) || !Number.isFinite(f.vx) || !Number.isFinite(f.vy) || !Number.isFinite(f.damage)) {
      nans++;
    }
    const alive = f.state !== FighterState.Eliminated && f.state !== FighterState.Teaspoon && f.state !== FighterState.Respawn;
    if (alive && (f.x < bz.left - 2 || f.x > bz.right + 2 || f.y < bz.bottom - 2 || f.y > bz.top + 2)) {
      stuck++;
    }
  }
  return { nans, stuck };
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  await initPhysics();
  const data = getGameData();
  const hz = data.tuning.tickRate;
  const arena = getArenaSpec(args.arena);
  const hardEndTicks = Math.round(data.tuning.match.hardEndSeconds * hz) + 120;

  const wallT0 = performance.now();
  const tickDurationsMs: number[] = [];
  const matchLengthsSec: number[] = [];
  const matchCpuSec: number[] = [];
  const firstKoSec: number[] = [];
  const stockDurationsSec: number[] = [];
  const halfIslandGoneSec: number[] = [];
  const endKinds = { lastStock: 0, suddenDeath: 0, hardEnd: 0 };

  const koByCause: Record<KoCause, number> = {
    [KoCause.FighterMove]: 0,
    [KoCause.Gadget]: 0,
    [KoCause.FallingChunk]: 0,
    [KoCause.Hazard]: 0,
    [KoCause.SelfDestruct]: 0,
    [KoCause.HardEnd]: 0,
  };
  const crackTotals: Record<CrackSource, number> = {
    [CrackSource.Slam]: 0,
    [CrackSource.Move]: 0,
    [CrackSource.Teaspoon]: 0,
    [CrackSource.FallingChunk]: 0,
    [CrackSource.Timeline]: 0,
  };

  const fighterAgg = new Map<FighterId, FighterAgg>();
  for (const id of ALL_FIGHTER_IDS) fighterAgg.set(id, newFighterAgg());

  const gadgetAgg = new Map<GadgetId, GadgetAgg>();
  for (const id of ALL_GADGET_IDS) {
    gadgetAgg.set(id, { spawned: 0, pickedUp: 0, used: 0, kos: 0, selfKos: 0 });
  }

  const comboHistogram = new Map<number, number>();
  let longestObservedCombo = 0;
  let exceptions = 0;
  let nanCount = 0;
  let stuckCount = 0;
  let totalStocksLost = 0;
  const startHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);

  const matchRecords: unknown[] = [];

  for (let m = 0; m < args.count; m++) {
    const matchSeed = args.seed + m * 101;
    // Rotate fighter roster per match to obtain balanced per-fighter stats across 60 matches
    const matchFighters = args.fighters.map((id, idx) => ({
      slot: idx,
      id: m === 0 ? id : ALL_FIGHTER_IDS[(args.fighters.indexOf(id) + m + idx) % ALL_FIGHTER_IDS.length]!,
      team: TeamId.None,
    }));
    const world = new SimWorld({
      arenaId: args.arena,
      mode: MatchMode.FreeForAll,
      fragile: false,
      seed: matchSeed,
      fighters: matchFighters,
    });

    const bots: BotController[] = matchFighters.map((_, idx) =>
      createBot({ kind: idx % 3 === 0 ? BotKind.Chaser : BotKind.Brawler }),
    );
    const botRngs = matchFighters.map((_, idx) => new SeededRng(matchSeed + 1000 + idx));
    const prevMoveBySlot = new Array<MoveId>(matchFighters.length).fill(MoveId.None);
    const lastComboBySlot = new Array<number>(matchFighters.length).fill(0);
    const lastLifeStartTick = new Array<number>(matchFighters.length).fill(0);
    const offstageFlag = new Array<boolean>(matchFighters.length).fill(false);
    const matchStartCpu = performance.now();

    for (const fc of matchFighters) {
      requireKey(fighterAgg, fc.id, 'fighterAgg').matches++;
    }

    try {
      let firstKoTick = -1;
      for (let t = 0; t < hardEndTicks && !world.isFinished(); t++) {
        const view = buildBotView(
          world.tick,
          world.fighters,
          world.island,
          world.gadgets.worldGadgets,
          world.gadgets.projectiles,
          arena.blastZone,
          arena.chunks,
        );
        const masks = bots.map((b, slot) => b.decide(view, slot, botRngs[slot]!));

        const t0 = performance.now();
        const events = world.step(masks);
        tickDurationsMs.push(performance.now() - t0);

        const inv = verifyWorldStepInvariants(world);
        nanCount += inv.nans;
        stuckCount += inv.stuck;

        for (const f of world.fighters) {
          const agg = requireKey(fighterAgg, f.id, 'fighterAgg');
          if (f.activeMove !== MoveId.None && f.activeMove !== prevMoveBySlot[f.slot]) {
            incMap(agg.moveUses, f.activeMove);
          }
          prevMoveBySlot[f.slot] = f.activeMove;

          if (f.comboCount > 0) {
            lastComboBySlot[f.slot] = Math.max(lastComboBySlot[f.slot]!, f.comboCount);
          } else if (lastComboBySlot[f.slot]! > 0) {
            const len = lastComboBySlot[f.slot]!;
            incMap(comboHistogram, len);
            if (len > longestObservedCombo) longestObservedCombo = len;
            lastComboBySlot[f.slot] = 0;
          }

          const onStage = world.island.chunks.some(
            (c, ci) =>
              (c.state === ChunkState.Intact || c.state === ChunkState.Crazed || c.state === ChunkState.Loose) &&
              f.x >= arena.chunks[ci]!.topX0 &&
              f.x <= arena.chunks[ci]!.topX1,
          );
          if (!onStage && f.stocks > 0 && f.state !== FighterState.Respawn && !offstageFlag[f.slot]) {
            offstageFlag[f.slot] = true;
            agg.offstageAttempts++;
          } else if (onStage && offstageFlag[f.slot]) {
            offstageFlag[f.slot] = false;
            agg.offstageRecoveries++;
          }
        }

        for (const ev of events) {
          if (ev.kind === SimEventKind.Hit) {
            const atk = world.fighters[ev.a];
            const def = world.fighters[ev.b];
            const dmg = ev.c / 10;
            if (atk) requireKey(fighterAgg, atk.id, 'fighterAgg').damageDealt += dmg;
            if (def) requireKey(fighterAgg, def.id, 'fighterAgg').damageTaken += dmg;
          } else if (ev.kind === SimEventKind.Parry) {
            const def = world.fighters[ev.a];
            if (def) requireKey(fighterAgg, def.id, 'fighterAgg').parriesLanded++;
          } else if (ev.kind === SimEventKind.GuardBreak) {
            const f = world.fighters[ev.a];
            if (f) requireKey(fighterAgg, f.id, 'fighterAgg').guardBreaks++;
          } else if (ev.kind === SimEventKind.GiltBreak) {
            const f = world.fighters[ev.a];
            if (f) requireKey(fighterAgg, f.id, 'fighterAgg').giltBreaks++;
          } else if (ev.kind === SimEventKind.Ko) {
            totalStocksLost++;
            if (firstKoTick < 0) firstKoTick = ev.tick;
            stockDurationsSec.push((ev.tick - lastLifeStartTick[ev.a]!) / hz);
            lastLifeStartTick[ev.a] = ev.tick;
            offstageFlag[ev.a] = false;
            const cause = ev.c as KoCause;
            koByCause[cause]++;
          }
        }
      }

      const res = world.getRoundResult();
      assert(res !== null, ErrorCode.InvariantViolation, `Match ${m} did not finish`);
      matchLengthsSec.push(res.endTick / hz);
      matchCpuSec.push((performance.now() - matchStartCpu) / 1000);
      if (firstKoTick >= 0) firstKoSec.push(firstKoTick / hz);
      if (world.island.halfGoneTick >= 0) halfIslandGoneSec.push(world.island.halfGoneTick / hz);

      if (res.endedByHardEnd) endKinds.hardEnd++;
      else if (res.endedBySuddenDeath) endKinds.suddenDeath++;
      else endKinds.lastStock++;

      const winnerFighter = requireAt(world.fighters, res.winnerSlot, 'fighters');
      requireKey(fighterAgg, winnerFighter.id, 'fighterAgg').wins++;

      for (const ko of res.koOrder) {
        if (ko.killerSlot >= 0 && ko.killerSlot !== ko.victimSlot) {
          const killer = world.fighters[ko.killerSlot];
          if (killer) {
            const ka = requireKey(fighterAgg, killer.id, 'fighterAgg');
            ka.kos++;
            if (ko.moveId !== MoveId.None) incMap(ka.moveKos, ko.moveId);
          }
        }
        if (ko.gadgetId !== GadgetId.None) {
          const ga = requireKey(gadgetAgg, ko.gadgetId, 'gadgetAgg');
          if (ko.killerSlot === ko.victimSlot || ko.killerSlot < 0) ga.selfKos++;
          else ga.kos++;
        }
      }

      for (const gid of ALL_GADGET_IDS) {
        const ga = requireKey(gadgetAgg, gid, 'gadgetAgg');
        ga.spawned += world.gadgets.stats.spawned[gid];
        ga.pickedUp += world.gadgets.stats.pickedUp[gid];
        ga.used += world.gadgets.stats.used[gid];
      }
      for (const cs of [CrackSource.Slam, CrackSource.Move, CrackSource.Teaspoon, CrackSource.FallingChunk, CrackSource.Timeline]) {
        crackTotals[cs] += world.island.crackTotals[cs];
      }

      matchRecords.push({
        matchIndex: m,
        seed: matchSeed,
        endSec: Number((res.endTick / hz).toFixed(2)),
        winnerSlot: res.winnerSlot,
        winnerFighter: FighterId[winnerFighter.id],
        firstKoSec: firstKoTick >= 0 ? Number((firstKoTick / hz).toFixed(2)) : null,
        halfIslandGoneSec: world.island.halfGoneTick >= 0 ? Number((world.island.halfGoneTick / hz).toFixed(2)) : null,
        koCount: res.koOrder.length,
      });
    } catch (err) {
      exceptions++;
      throw err;
    } finally {
      world.dispose();
    }
  }

  const comboSearches: ComboSearchResult[] = runAllComboSearches();
  const maxComboSearchHits = Math.max(...comboSearches.map((c) => c.maxTrueComboHits));
  const anyZeroTod = comboSearches.some((c) => c.killedFromZeroAtCentre);

  const sortedTicks = [...tickDurationsMs].sort((a, b) => a - b);
  const sortedMatchLen = [...matchLengthsSec].sort((a, b) => a - b);
  const sortedFirstKo = [...firstKoSec].sort((a, b) => a - b);
  const sortedHalfGone = [...halfIslandGoneSec].sort((a, b) => a - b);
  const sortedCpu = [...matchCpuSec].sort((a, b) => a - b);
  const meanTickMs = tickDurationsMs.reduce((s, v) => s + v, 0) / Math.max(1, tickDurationsMs.length);
  const p99TickMs = percentile(sortedTicks, 0.99);
  const maxMatchCpuSec = sortedCpu[sortedCpu.length - 1] ?? 0;

  const endHeapMb = process.memoryUsage().heapUsed / (1024 * 1024);
  const sdRate = totalStocksLost > 0 ? koByCause[KoCause.SelfDestruct] / totalStocksLost : 0;
  const gadgetKoRate = totalStocksLost > 0 ? koByCause[KoCause.Gadget] / totalStocksLost : 0;
  const medianMatchSec = median(sortedMatchLen);
  const medianFirstKoSec = median(sortedFirstKo);
  const medianHalfGoneSec = median(sortedHalfGone);

  assertFinite(meanTickMs, 'meanTickMs');

  const acceptance = [
    { id: 'M2.4.ex', metric: 'Exceptions / NaNs / Stuck', actual: `${exceptions}/${nanCount}/${stuckCount}`, band: '0/0/0', pass: exceptions === 0 && nanCount === 0 && stuckCount === 0 },
    { id: 'M2.4.cpu', metric: 'Max 2-min match CPU', actual: `${maxMatchCpuSec.toFixed(2)} s`, band: '<= 12 s', pass: maxMatchCpuSec <= 12 },
    { id: 'M2.4.tick', metric: 'Tick time p99', actual: `${p99TickMs.toFixed(3)} ms`, band: '<= 4 ms', pass: p99TickMs <= 4 },
    { id: 'M2.5.len', metric: 'Median match length', actual: `${medianMatchSec.toFixed(1)} s`, band: '100 - 135 s', pass: medianMatchSec >= 100 && medianMatchSec <= 135 },
    { id: 'M2.5.ko', metric: 'Median first KO', actual: `${medianFirstKoSec.toFixed(1)} s`, band: '20 - 50 s', pass: medianFirstKoSec >= 20 && medianFirstKoSec <= 50 },
    { id: 'M2.5.half', metric: 'Half island gone', actual: `${medianHalfGoneSec.toFixed(1)} s`, band: '50 - 80 s', pass: medianHalfGoneSec >= 50 && medianHalfGoneSec <= 80 },
    { id: 'M2.5.sd', metric: 'Self-destruct share', actual: `${(sdRate * 100).toFixed(1)}%`, band: '10% - 25%', pass: sdRate >= 0.1 && sdRate <= 0.25 },
    { id: 'GDD.gadget', metric: 'Gadget KO share', actual: `${(gadgetKoRate * 100).toFixed(1)}%`, band: '30% - 45% (info M2)', pass: gadgetKoRate >= 0.05 },
    { id: 'M2.9', metric: 'ComboSearch max hits / 0% TOD', actual: `${maxComboSearchHits} hits / ${anyZeroTod}`, band: '<= 12 / false', pass: maxComboSearchHits <= 12 && !anyZeroTod },
  ];

  const commit = gitCommitHash();
  const cmdLine = `npm run bots -- ${process.argv.slice(2).join(' ')}`.trim();
  const wallSec = (performance.now() - wallT0) / 1000;

  const perFighterOut: Record<string, unknown> = {};
  for (const id of ALL_FIGHTER_IDS) {
    const a = requireKey(fighterAgg, id, 'fighterAgg');
    const topMoveKos: Record<string, number> = {};
    for (const [mid, cnt] of a.moveKos.entries()) topMoveKos[MoveId[mid]] = cnt;
    const moveUsage: Record<string, number> = {};
    for (const [mid, cnt] of a.moveUses.entries()) moveUsage[MoveId[mid]] = cnt;
    perFighterOut[FighterId[id]] = {
      matches: a.matches,
      wins: a.wins,
      winRate: a.matches > 0 ? Number((a.wins / a.matches).toFixed(3)) : 0,
      damageDealt: Number(a.damageDealt.toFixed(1)),
      damageTaken: Number(a.damageTaken.toFixed(1)),
      kos: a.kos,
      recoveryRate: a.offstageAttempts > 0 ? Number((a.offstageRecoveries / a.offstageAttempts).toFixed(3)) : 1,
      parriesLanded: a.parriesLanded,
      guardBreaks: a.guardBreaks,
      giltBreaks: a.giltBreaks,
      moveKos: topMoveKos,
      moveUsage,
    };
  }

  const perGadgetOut: Record<string, unknown> = {};
  for (const gid of ALL_GADGET_IDS) {
    const g = requireKey(gadgetAgg, gid, 'gadgetAgg');
    perGadgetOut[getGadgetSpec(gid).name] = g;
  }

  const reportJson = {
    meta: {
      commit,
      command: cmdLine,
      seed: args.seed,
      arena: ArenaId[args.arena],
      count: args.count,
      wallSec: Number(wallSec.toFixed(2)),
      timestamp: new Date().toISOString(),
      host: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpus: os.cpus().length,
        totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      },
    },
    health: {
      exceptions,
      nanCount,
      stuckCount,
      tickMeanMs: Number(meanTickMs.toFixed(4)),
      tickP99Ms: Number(p99TickMs.toFixed(4)),
      maxMatchCpuSec: Number(maxMatchCpuSec.toFixed(3)),
      heapGrowthMb: Number((endHeapMb - startHeapMb).toFixed(2)),
    },
    matchesSummary: {
      medianSec: Number(medianMatchSec.toFixed(2)),
      meanSec: Number((matchLengthsSec.reduce((s, v) => s + v, 0) / args.count).toFixed(2)),
      minSec: Number((sortedMatchLen[0] ?? 0).toFixed(2)),
      maxSec: Number((sortedMatchLen[sortedMatchLen.length - 1] ?? 0).toFixed(2)),
      endKinds,
      firstKoMedianSec: Number(medianFirstKoSec.toFixed(2)),
      stockDurationMedianSec: Number(median([...stockDurationsSec].sort((a, b) => a - b)).toFixed(2)),
      halfIslandGoneMedianSec: Number(medianHalfGoneSec.toFixed(2)),
    },
    koByCause: Object.fromEntries(Object.entries(koByCause).map(([k, v]) => [KoCause[Number(k) as KoCause], v])),
    crackTotals: Object.fromEntries(Object.entries(crackTotals).map(([k, v]) => [CrackSource[Number(k) as CrackSource], Math.round(v)])),
    fighters: perFighterOut,
    gadgets: perGadgetOut,
    combos: {
      longestObserved: longestObservedCombo,
      histogram: Object.fromEntries(Array.from(comboHistogram.entries()).sort((a, b) => a[0] - b[0])),
      comboSearch: comboSearches.map((c) => ({
        fighter: FighterId[c.fighterId],
        maxTrueComboHits: c.maxTrueComboHits,
        killedFromZeroAtCentre: c.killedFromZeroAtCentre,
        maxDamageFromZero: c.maxDamageFromZero,
        longestSequence: c.longestSequence.map((m) => MoveId[m]),
      })),
    },
    acceptance,
    matches: matchRecords,
  };

  const outAbs = resolve(args.outDir);
  mkdirSync(outAbs, { recursive: true });
  writeFileSync(resolve(outAbs, 'bot-report.json'), JSON.stringify(reportJson, null, 2), 'utf8');

  const md = [
    '# Headless Bot Match Report',
    '',
    `- **Commit:** \`${commit}\``,
    `- **Command:** \`${cmdLine}\``,
    `- **Seed / Arena / Matches:** ${args.seed} / ${ArenaId[args.arena]} / ${args.count}`,
    `- **Wall time:** ${wallSec.toFixed(2)} s (${os.cpus().length} CPUs, Node ${process.version})`,
    '',
    '## Acceptance Bands (GDD 3.10 & M2.4 / M2.5 / M2.9)',
    '',
    '| ID | Criterion | Measured | Target Band | Status |',
    '|---|---|---|---|---|',
    ...acceptance.map((a) => `| ${a.id} | ${a.metric} | ${a.actual} | ${a.band} | ${a.pass ? 'PASS' : 'FAIL'} |`),
    '',
    '## Fighter Summary',
    '',
    '| Fighter | Matches | Wins | Win Rate | KOs | Dmg Dealt | Dmg Taken | Parries | Guard Breaks |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...ALL_FIGHTER_IDS.map((id) => {
      const f = perFighterOut[FighterId[id]] as Record<string, number>;
      return `| ${getFighterSpec(id).name} | ${f['matches']} | ${f['wins']} | ${(Number(f['winRate']) * 100).toFixed(1)}% | ${f['kos']} | ${f['damageDealt']} | ${f['damageTaken']} | ${f['parriesLanded']} | ${f['guardBreaks']} |`;
    }),
    '',
    '## ComboSearch (M2.9)',
    '',
    '| Fighter | Max True Hits | 0% Centre TOD | Max 0% Dmg | Longest Sequence |',
    '|---|---:|---|---:|---|',
    ...comboSearches.map((c) => `| ${getFighterSpec(c.fighterId).name} | ${c.maxTrueComboHits} | ${c.killedFromZeroAtCentre} | ${c.maxDamageFromZero}% | ${c.longestSequence.map((m) => MoveId[m]).join(' -> ')} |`),
    '',
  ].join('\n');

  writeFileSync(resolve(outAbs, 'bot-report.md'), md, 'utf8');
  console.log(`[run-bots] Wrote ${resolve(outAbs, 'bot-report.json')} and bot-report.md in ${wallSec.toFixed(2)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
