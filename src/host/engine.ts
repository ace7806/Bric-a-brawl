import { buildBotView, createBot, type BotConfig, type BotController } from '@bots/index';
import {
  encodeSnapshot,
  type InputPacket,
  type SnapshotChunk,
  type SnapshotData,
  type SnapshotFighter,
  type SnapshotGadget,
  type SnapshotProjectile,
  type SnapshotRubble,
} from '@net/codec';
import { InputJitterBuffer, unwrap16 } from '@net/sync';
import { assert, assertFinite } from '@sim/assert';
import { getArenaSpec, getGameData } from '@sim/data';
import { ArenaId, ErrorCode, FighterId, InputBit, MatchMode, TeamId } from '@sim/enums';
import { SeededRng } from '@sim/prng';
import type { MatchConfig, RoundResult, SimEvent } from '@sim/types';
import { initPhysics, SimWorld, type SlotLatency } from '@sim/world';

const STRUGGLING_THRESHOLD_MS = 12;
const STRUGGLING_SUSTAIN_TICKS = 120;
const KEYFRAME_INTERVAL_TICKS = 120;
const STRUGGLING_RUBBLE_CAP = 8;
const BENCHMARK_TICKS = 60;
const BENCHMARK_SEED = 0x42524943;

export interface HostEngineConfig {
  readonly match: MatchConfig;
  readonly localSlot?: number | null;
  readonly bots?: ReadonlyMap<number, BotConfig> | Readonly<Record<number, BotConfig>>;
}

export interface HostTickOutput {
  readonly tick: number;
  readonly events: readonly SimEvent[];
  readonly snapshotBytes: Uint8Array | null;
  readonly snapshotData: SnapshotData | null;
  readonly includeWorld: boolean;
  readonly struggling: boolean;
  readonly roundResult: RoundResult | null;
  readonly finished: boolean;
}

function normalizeBotConfigs(
  bots: HostEngineConfig['bots'],
): ReadonlyMap<number, BotConfig> {
  const out = new Map<number, BotConfig>();
  if (!bots) return out;
  if (bots instanceof Map) {
    for (const [slot, cfg] of bots) out.set(slot, cfg);
    return out;
  }
  for (const [k, cfg] of Object.entries(bots)) {
    const slot = Number(k);
    assert(Number.isInteger(slot) && slot >= 0, ErrorCode.InvariantViolation, `Invalid bot slot key: ${k}`);
    if (cfg !== undefined) out.set(slot, cfg);
  }
  return out;
}

export class HostSimulation {
  public readonly world: SimWorld;
  public readonly jitter: InputJitterBuffer;
  public readonly bots = new Map<number, BotController>();
  private readonly botRngs = new Map<number, SeededRng>();
  private readonly localSlot: number | null;
  private readonly normalSnapshotEvery: number;
  private readonly normalWorldEverySnapshots = 2;
  private readonly strugglingSnapshotEvery = 3;
  private readonly strugglingWorldEverySnapshots = 2;
  private readonly maxSlotCount: number;
  private localMask = 0;
  private slowTickStreak = 0;
  private struggling = false;
  private snapshotCounter = 0;

  public constructor(config: HostEngineConfig) {
    this.world = new SimWorld(config.match);
    this.jitter = new InputJitterBuffer();
    this.localSlot = config.localSlot ?? null;

    const { tuning } = getGameData();
    this.normalSnapshotEvery = Math.max(1, Math.round(tuning.tickRate / tuning.net.snapshotHz));

    const botConfigs = normalizeBotConfigs(config.bots);
    let maxSlot = 0;
    for (const fc of config.match.fighters) {
      if (fc.slot > maxSlot) maxSlot = fc.slot;
      const botCfg = botConfigs.get(fc.slot);
      if (botCfg) {
        assert(fc.slot !== this.localSlot, ErrorCode.InvariantViolation, `Slot ${fc.slot} cannot be both local and bot`);
        this.bots.set(fc.slot, createBot(botCfg));
        this.botRngs.set(fc.slot, new SeededRng((config.match.seed ^ ((fc.slot + 1) * 0x9e3779b1)) | 0));
      }
    }
    this.maxSlotCount = maxSlot + 1;
  }

  public setLocalInput(slot: number, mask: number): void {
    assert(this.localSlot !== null && slot === this.localSlot, ErrorCode.InvariantViolation, `Slot ${slot} is not the local host slot`);
    assert(Number.isInteger(mask), ErrorCode.InvariantViolation, `Input mask must be an integer: ${mask}`);
    this.localMask = mask & 0xffff;
  }

  public ingestClientInput(slot: number, packet: InputPacket): void {
    assert(slot !== this.localSlot && !this.bots.has(slot), ErrorCode.InvariantViolation, `Slot ${slot} is not a remote client slot`);
    const unwrappedTick = unwrap16(packet.tick, this.world.tick);
    this.jitter.ingestPacket(slot, packet, this.world.tick);
    const defender = this.world.fighters.find((f) => f.slot === slot);
    if (defender && defender.pendingHit !== null) {
      for (let i = 0; i < packet.masks.length; i++) {
        const m = packet.masks[i]!;
        if ((m & InputBit.Guard) !== 0 && this.world.applyDefenderGrace(slot, m, unwrappedTick - i)) {
          break;
        }
      }
    }
  }

  public stepTick(measureMs?: number): HostTickOutput {
    if (measureMs !== undefined) {
      assertFinite(measureMs, 'measureMs');
      if (measureMs > STRUGGLING_THRESHOLD_MS) {
        this.slowTickStreak += 1;
        if (this.slowTickStreak >= STRUGGLING_SUSTAIN_TICKS) this.struggling = true;
      } else {
        this.slowTickStreak = 0;
      }
    }

    const inputs = new Map<number, number>();
    const latencies: SlotLatency[] = new Array<SlotLatency>(this.maxSlotCount);
    for (let i = 0; i < this.maxSlotCount; i++) {
      latencies[i] = { rewindTicks: 0, graceTicks: 0 };
    }

    const arena = getArenaSpec(this.world.config.arenaId);
    const botView = this.bots.size > 0
      ? buildBotView(
          this.world.tick,
          this.world.fighters,
          this.world.island,
          this.world.gadgets.worldGadgets,
          this.world.gadgets.projectiles,
          arena.blastZone,
          arena.chunks,
        )
      : null;

    for (const f of this.world.fighters) {
      if (f.slot === this.localSlot) {
        inputs.set(f.slot, this.localMask);
        continue;
      }
      const bot = this.bots.get(f.slot);
      if (bot) {
        const rng = this.botRngs.get(f.slot)!;
        inputs.set(f.slot, bot.decide(botView!, f.slot, rng));
        continue;
      }
      const popped = this.jitter.popInputForTick(f.slot, this.world.tick);
      inputs.set(f.slot, popped.mask);
      latencies[f.slot] = {
        rewindTicks: this.jitter.computeLagCompRewindTicks(f.slot),
        graceTicks: this.jitter.computeDefenderGraceTicks(f.slot),
      };
    }

    const events = this.world.step(inputs, latencies);
    const snapEvery = this.struggling ? this.strugglingSnapshotEvery : this.normalSnapshotEvery;
    const worldEvery = this.struggling ? this.strugglingWorldEverySnapshots : this.normalWorldEverySnapshots;
    const emitSnapshot = this.world.tick % snapEvery === 0;
    const fullKeyframe = this.world.tick % KEYFRAME_INTERVAL_TICKS === 0;

    let snapshotData: SnapshotData | null = null;
    let snapshotBytes: Uint8Array | null = null;
    let includeWorld = false;

    if (emitSnapshot) {
      this.snapshotCounter += 1;
      includeWorld = fullKeyframe || (this.snapshotCounter % worldEvery === 0);
      snapshotData = this.buildSnapshotData(includeWorld, fullKeyframe);
      snapshotBytes = encodeSnapshot(snapshotData, includeWorld);
    }

    const roundResult = this.world.getRoundResult();
    return {
      tick: this.world.tick,
      events,
      snapshotBytes,
      snapshotData,
      includeWorld,
      struggling: this.struggling,
      roundResult,
      finished: this.world.isFinished(),
    };
  }

  public buildSnapshotData(includeWorld: boolean, fullKeyframe: boolean): SnapshotData {
    const fighters: SnapshotFighter[] = this.world.fighters.map((f) => ({
      slot: f.slot,
      x: f.x,
      y: f.y,
      vx: f.vx + f.kbVx,
      vy: f.vy + f.kbVy,
      state: f.state,
      stateFrame: f.stateFrame,
      activeMove: f.activeMove,
      flags: f.flags,
      damage: f.damage,
      guardHp: f.guardHp,
      gilt: f.gilt,
      stocks: f.stocks,
      heldGadget: f.heldGadget,
      heldGadgetAmmo: f.heldGadgetAmmo,
      nestaSize: f.nestaSize,
      hitstopFrames: Math.min(15, f.hitstopFrames),
    }));

    const projectiles: SnapshotProjectile[] = this.world.gadgets.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
    }));

    const chunks: SnapshotChunk[] = [];
    const rubble: SnapshotRubble[] = [];
    const gadgets: SnapshotGadget[] = [];

    if (includeWorld) {
      if (fullKeyframe) {
        for (const ch of this.world.island.chunks) ch.restSent = false;
        for (const r of this.world.island.rubble) r.restSent = false;
      }

      for (const ch of this.world.island.chunks) {
        if (ch.resting && ch.restSent) continue;
        chunks.push({
          index: ch.index,
          x: ch.x,
          y: ch.y,
          angle: ch.angle,
          vx: ch.vx,
          vy: ch.vy,
          state: ch.state,
          resting: ch.resting,
        });
        if (ch.resting) ch.restSent = true;
      }

      const rubbleCap = this.struggling ? STRUGGLING_RUBBLE_CAP : this.world.island.rubble.length;
      for (const r of this.world.island.rubble) {
        if (rubble.length >= rubbleCap) break;
        if (r.resting && r.restSent) continue;
        rubble.push({
          id: r.id,
          x: r.x,
          y: r.y,
          angle: r.angle,
          vx: r.vx,
          vy: r.vy,
        });
        if (r.resting) r.restSent = true;
      }

      for (const g of this.world.gadgets.worldGadgets) {
        gadgets.push({
          id: g.id,
          gadgetId: g.gadgetId,
          x: g.x,
          y: g.y,
          angle: g.angle,
          vx: g.vx,
          vy: g.vy,
          state: g.state,
          ammo: g.ammo,
        });
      }
    }

    const lastAppliedInputTicks = this.jitter.getLastAppliedTicks(this.maxSlotCount);
    if (this.localSlot !== null && this.localSlot < lastAppliedInputTicks.length) {
      lastAppliedInputTicks[this.localSlot] = this.world.tick;
    }

    return {
      tick: this.world.tick,
      lastAppliedInputTicks,
      fighters,
      projectiles,
      chunks,
      rubble,
      gadgets,
      hasWorld: includeWorld,
    };
  }

  public dispose(): void {
    this.world.dispose();
  }
}

export async function runOneSecondBenchmark(): Promise<number> {
  await initPhysics();
  const benchWorld = new SimWorld({
    arenaId: ArenaId.Willow,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed: BENCHMARK_SEED,
    fighters: [
      { slot: 0, id: FighterId.Earl, team: TeamId.None },
      { slot: 1, id: FighterId.Grog, team: TeamId.None },
      { slot: 2, id: FighterId.Nesta, team: TeamId.None },
      { slot: 3, id: FighterId.Moss, team: TeamId.None },
    ],
  });
  const inputs: readonly number[] = [0x23, 0x47, 0x83, 0x27];
  const t0 = performance.now();
  try {
    for (let i = 0; i < BENCHMARK_TICKS; i++) {
      benchWorld.step(inputs);
    }
  } finally {
    benchWorld.dispose();
  }
  const elapsedMs = Math.max(0.001, performance.now() - t0);
  return Math.round((BENCHMARK_TICKS * 1000) / elapsedMs);
}
