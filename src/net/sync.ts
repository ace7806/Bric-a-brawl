import { SnapshotInterpolation } from '@geckos.io/snapshot-interpolation';
import type { Entity } from '@geckos.io/snapshot-interpolation/lib/types';
import { assert, assertFinite } from '../sim/assert';
import { getGameData } from '../sim/data';
import { ErrorCode, FighterState, GadgetId, MoveId, NestaSize } from '../sim/enums';
import {
  type InputPacket,
  qPos,
  qRot,
  type SnapshotChunk,
  type SnapshotData,
  type SnapshotFighter,
  type SnapshotGadget,
  type SnapshotProjectile,
  type SnapshotRubble,
  uqPos,
  uqRot,
} from './codec';

const INPUT_RING_SIZE = 64;
const INPUT_RING_MASK = INPUT_RING_SIZE - 1;
const EMPTY_TICK = -1;
const RTT_EMA_ALPHA = 0.2;
const CLOCK_EMA_ALPHA = 0.15;
const JITTER_EMA_ALPHA = 0.15;
const MAX_INTERP_DELAY_MS = 150;
const BLEND_FRAMES = 6;
const LARGE_CORRECTION_U = 0.5;
const ERROR_SAMPLE_CAP = 512;
const WORLD_VAULT_MAX = 120;

export function unwrap16(wrapped16: number, refTick: number): number {
  const w = wrapped16 & 0xffff;
  const refLow = refTick & 0xffff;
  let diff = w - refLow;
  if (diff > 32768) diff -= 65536;
  else if (diff < -32768) diff += 65536;
  return refTick + diff;
}

// ---------------------------------------------------------------- 1. Host Input Jitter Buffer

export interface PoppedInput {
  readonly mask: number;
  readonly inputTick: number;
  readonly lost: boolean;
}

export interface SlotLossStats {
  readonly inputsLost: number;
  readonly inputsTotal: number;
  readonly lossRate: number;
}

interface SlotJitterState {
  readonly ringTicks: Int32Array;
  readonly ringMasks: Uint16Array;
  lastAppliedTick: number;
  lastMask: number;
  newestReceivedTick: number;
  firstArrivalHostTick: number;
  rttTicks: number;
  hasRttSample: boolean;
  inputsLost: number;
  inputsTotal: number;
}

function createSlotState(): SlotJitterState {
  const ringTicks = new Int32Array(INPUT_RING_SIZE);
  ringTicks.fill(EMPTY_TICK);
  return {
    ringTicks,
    ringMasks: new Uint16Array(INPUT_RING_SIZE),
    lastAppliedTick: EMPTY_TICK,
    lastMask: 0,
    newestReceivedTick: EMPTY_TICK,
    firstArrivalHostTick: EMPTY_TICK,
    rttTicks: 0,
    hasRttSample: false,
    inputsLost: 0,
    inputsTotal: 0,
  };
}

export class InputJitterBuffer {
  private readonly slots: SlotJitterState[];
  private readonly bufferTicks: number;
  private readonly redundancy: number;
  private readonly lagCompMaxTicks: number;
  private readonly defenderGraceMaxTicks: number;
  private readonly interpDelayTicks: number;

  public constructor() {
    const tuning = getGameData().tuning;
    const net = tuning.net;
    this.bufferTicks = net.hostInputJitterBufferTicks;
    this.redundancy = net.inputRedundancy;
    this.lagCompMaxTicks = net.lagCompMaxTicks;
    this.defenderGraceMaxTicks = net.defenderGraceMaxTicks;
    this.interpDelayTicks = (net.interpDelayMs / 1000) * tuning.tickRate;
    this.slots = Array.from({ length: net.maxPlayers }, () => createSlotState());
  }

  private slotAt(slot: number): SlotJitterState {
    assert(Number.isInteger(slot) && slot >= 0 && slot < this.slots.length, ErrorCode.IndexOutOfBounds, `Invalid slot ${slot}`);
    return this.slots[slot] as SlotJitterState;
  }

  public ingestPacket(slot: number, packet: InputPacket, hostTick: number): number {
    assert(Number.isInteger(hostTick), ErrorCode.InvariantViolation, `hostTick must be int: ${hostTick}`);
    assert(packet.masks.length === this.redundancy, ErrorCode.SchemaValidationFailed, 'InputPacket masks length mismatch');
    const s = this.slotAt(slot);
    // Unwrap client input sequence against this slot's own input clock, not hostTick,
    // so a client joining at tick 0 after hostTick > 32768 never wraps to 65536.
    const refTick = s.newestReceivedTick >= 0 ? s.newestReceivedTick : (packet.tick & 0xffff);
    const baseTick = unwrap16(packet.tick, refTick);
    for (let i = 0; i < this.redundancy; i++) {
      const t = baseTick - i;
      if (t < 0 || t <= s.lastAppliedTick) continue;
      const idx = t & INPUT_RING_MASK;
      if ((s.ringTicks[idx] as number) < t) {
        s.ringTicks[idx] = t;
        s.ringMasks[idx] = (packet.masks[i] as number) & 0xffff;
      }
      if (t > s.newestReceivedTick) s.newestReceivedTick = t;
    }
    if (s.firstArrivalHostTick < 0) s.firstArrivalHostTick = hostTick;
    const snapTick = unwrap16(packet.lastSnapshotTick, hostTick);
    const sampleRtt = Math.max(0, hostTick - snapTick);
    s.rttTicks = s.hasRttSample ? s.rttTicks * (1 - RTT_EMA_ALPHA) + sampleRtt * RTT_EMA_ALPHA : sampleRtt;
    s.hasRttSample = true;
    return baseTick;
  }

  public popInputForTick(slot: number, hostTick: number): PoppedInput {
    const s = this.slotAt(slot);
    if (s.newestReceivedTick < 0) {
      return { mask: 0, inputTick: EMPTY_TICK, lost: false };
    }
    if (s.lastAppliedTick < 0) {
      const ready =
        s.newestReceivedTick >= this.bufferTicks ||
        hostTick - s.firstArrivalHostTick >= this.bufferTicks;
      if (!ready) return { mask: 0, inputTick: EMPTY_TICK, lost: false };
      let startTick = Math.max(0, s.newestReceivedTick - this.bufferTicks);
      while (startTick > 0 && (s.ringTicks[(startTick - 1) & INPUT_RING_MASK] as number) === startTick - 1) {
        startTick -= 1;
      }
      s.lastAppliedTick = startTick - 1;
    }

    let nextTick = s.lastAppliedTick + 1;
    const stallGap = s.newestReceivedTick - nextTick;
    if (stallGap >= INPUT_RING_SIZE / 2) {
      const targetTick = Math.max(nextTick, s.newestReceivedTick - this.redundancy + 1);
      for (let t = nextTick; t < targetTick; t++) {
        const idx = t & INPUT_RING_MASK;
        if ((s.ringTicks[idx] as number) !== t) s.inputsLost += 1;
        s.inputsTotal += 1;
      }
      s.lastAppliedTick = targetTick - 1;
      nextTick = targetTick;
    }

    const idx = nextTick & INPUT_RING_MASK;
    if ((s.ringTicks[idx] as number) === nextTick) {
      const mask = s.ringMasks[idx] as number;
      s.lastAppliedTick = nextTick;
      s.lastMask = mask;
      s.inputsTotal += 1;
      return { mask, inputTick: nextTick, lost: false };
    }

    if (s.newestReceivedTick - nextTick >= this.redundancy) {
      s.lastAppliedTick = nextTick;
      s.inputsTotal += 1;
      s.inputsLost += 1;
      return { mask: s.lastMask, inputTick: nextTick, lost: true };
    }

    return { mask: s.lastMask, inputTick: s.lastAppliedTick, lost: false };
  }

  public getClientRttTicks(slot: number): number {
    return this.slotAt(slot).rttTicks;
  }

  public getClientOneWayTicks(slot: number): number {
    return this.slotAt(slot).rttTicks * 0.5;
  }

  public getLastAppliedTicks(slotCount: number): number[] {
    assert(
      Number.isInteger(slotCount) && slotCount >= 0 && slotCount <= this.slots.length,
      ErrorCode.IndexOutOfBounds,
      `Invalid slotCount ${slotCount}`,
    );
    const out: number[] = [];
    for (let i = 0; i < slotCount; i++) {
      out.push((this.slots[i] as SlotJitterState).lastAppliedTick);
    }
    return out;
  }

  public computeLagCompRewindTicks(attackerSlot: number): number {
    const rtt = this.getClientRttTicks(attackerSlot);
    return Math.min(this.lagCompMaxTicks, Math.round(rtt + this.interpDelayTicks));
  }

  public computeDefenderGraceTicks(defenderSlot: number): number {
    return Math.min(this.defenderGraceMaxTicks, Math.ceil(this.getClientOneWayTicks(defenderSlot)));
  }

  public getLossStats(slot?: number): SlotLossStats {
    if (slot !== undefined) {
      const s = this.slotAt(slot);
      return {
        inputsLost: s.inputsLost,
        inputsTotal: s.inputsTotal,
        lossRate: s.inputsTotal > 0 ? s.inputsLost / s.inputsTotal : 0,
      };
    }
    let inputsLost = 0;
    let inputsTotal = 0;
    for (const s of this.slots) {
      inputsLost += s.inputsLost;
      inputsTotal += s.inputsTotal;
    }
    return { inputsLost, inputsTotal, lossRate: inputsTotal > 0 ? inputsLost / inputsTotal : 0 };
  }
}

// ---------------------------------------------------------------- 2. Host Clock Estimator

export class HostClockEstimator {
  private readonly tickMs: number;
  private readonly minInterpMs: number;
  private initialized = false;
  private estimatedTick = 0;
  private lastUpdateMs = 0;
  private lastSnapTick = 0;
  private lastSnapArrivalMs = 0;
  private jitterMs = 0;

  public constructor() {
    const tuning = getGameData().tuning;
    this.tickMs = 1000 / tuning.tickRate;
    this.minInterpMs = tuning.net.interpDelayMs;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public onSnapshot(snapTick: number, arrivalMs: number, oneWayMs = 0): void {
    assert(Number.isInteger(snapTick) && snapTick >= 0, ErrorCode.InvariantViolation, `Invalid snapTick ${snapTick}`);
    assertFinite(arrivalMs, 'arrivalMs');
    assertFinite(oneWayMs, 'oneWayMs');
    const hostNowTick = snapTick + Math.max(0, oneWayMs) / this.tickMs;
    if (!this.initialized) {
      this.initialized = true;
      this.estimatedTick = hostNowTick;
      this.lastUpdateMs = arrivalMs;
      this.lastSnapTick = snapTick;
      this.lastSnapArrivalMs = arrivalMs;
      this.jitterMs = 0;
      return;
    }
    if (snapTick <= this.lastSnapTick) return;

    const expectedDtMs = (snapTick - this.lastSnapTick) * this.tickMs;
    const actualDtMs = arrivalMs - this.lastSnapArrivalMs;
    const deltaJitter = Math.abs(actualDtMs - expectedDtMs);
    this.jitterMs = this.jitterMs * (1 - JITTER_EMA_ALPHA) + deltaJitter * JITTER_EMA_ALPHA;

    const predicted = this.estimatedTick + Math.max(0, arrivalMs - this.lastUpdateMs) / this.tickMs;
    const err = hostNowTick - predicted;
    this.estimatedTick = Math.abs(err) > 15 ? hostNowTick : predicted + err * CLOCK_EMA_ALPHA;
    this.lastUpdateMs = arrivalMs;
    this.lastSnapTick = snapTick;
    this.lastSnapArrivalMs = arrivalMs;
  }

  public estimateHostTick(nowMs: number): number {
    assertFinite(nowMs, 'nowMs');
    if (!this.initialized) return 0;
    return this.estimatedTick + Math.max(0, nowMs - this.lastUpdateMs) / this.tickMs;
  }

  public getJitterMs(): number {
    return this.jitterMs;
  }

  public getInterpDelayMs(): number {
    return Math.max(this.minInterpMs, Math.min(MAX_INTERP_DELAY_MS, this.minInterpMs + 2 * this.jitterMs));
  }
}

// ---------------------------------------------------------------- 3. Remote Snapshot Interpolator

export interface InterpolatedFighter {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly state: FighterState;
  readonly stateFrame: number;
  readonly activeMove: MoveId;
  readonly moveFrame: number;
  readonly flags: number;
  readonly damage: number;
  readonly guardHp: number;
  readonly gilt: number;
  readonly stocks: number;
  readonly heldGadget: GadgetId;
  readonly heldGadgetAmmo: number;
  readonly nestaSize: NestaSize;
  readonly hitstopFrames: number;
}

export interface InterpolatedWorldState {
  readonly tick: number;
  readonly interpDelayMs: number;
  readonly fighters: readonly InterpolatedFighter[];
  readonly projectiles: readonly SnapshotProjectile[];
  readonly chunks: readonly SnapshotChunk[];
  readonly rubble: readonly SnapshotRubble[];
  readonly gadgets: readonly SnapshotGadget[];
}

function numProp(entity: Entity, key: string): number {
  const val = entity[key];
  assert(typeof val === 'number' && Number.isFinite(val), ErrorCode.NonFiniteNumber, `Interpolated ${key} invalid`);
  return val;
}

function indexById<T>(items: readonly T[], getId: (item: T) => number): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of items) map.set(getId(item), item);
  return map;
}

export class RemoteInterpolator {
  private readonly tickRate: number;
  private readonly minInterpMs: number;
  private readonly fighterSi: SnapshotInterpolation;
  private readonly worldSi: SnapshotInterpolation;
  private readonly worldSnaps = new Map<string, SnapshotData>();
  private latestSnap: SnapshotData | null = null;
  private latestArrivalMs = 0;
  private latestWorldSnap: SnapshotData | null = null;

  public constructor(minInterpMsOverride?: number) {
    const tuning = getGameData().tuning;
    this.tickRate = tuning.tickRate;
    this.minInterpMs = minInterpMsOverride !== undefined ? Math.max(0, minInterpMsOverride) : tuning.net.interpDelayMs;
    this.fighterSi = new SnapshotInterpolation(tuning.net.snapshotHz);
    this.fighterSi.interpolationBuffer.set(this.minInterpMs);
    this.fighterSi.vault.setMaxSize(WORLD_VAULT_MAX);
    this.worldSi = new SnapshotInterpolation(tuning.net.snapshotHz);
    this.worldSi.interpolationBuffer.set(this.minInterpMs);
    this.worldSi.vault.setMaxSize(WORLD_VAULT_MAX);
  }

  public setInterpDelayMs(ms: number): void {
    assertFinite(ms, 'interpDelayMs');
    const clamped = Math.max(this.minInterpMs, Math.min(MAX_INTERP_DELAY_MS, ms));
    this.fighterSi.interpolationBuffer.set(clamped);
    this.worldSi.interpolationBuffer.set(clamped);
  }

  public getInterpDelayMs(): number {
    return this.fighterSi.interpolationBuffer.get();
  }

  public pushSnapshot(snap: SnapshotData, arrivalMs: number): void {
    assertFinite(arrivalMs, 'arrivalMs');
    if (this.latestSnap !== null && snap.tick <= this.latestSnap.tick) return;

    this.latestSnap = snap;
    this.latestArrivalMs = arrivalMs;
    this.fighterSi.vault.add({
      id: String(snap.tick),
      time: arrivalMs,
      state: snap.fighters.map((f) => ({ id: String(f.slot), x: uqPos(qPos(f.x)), y: uqPos(qPos(f.y)) })),
    });

    if (snap.hasWorld) {
      this.latestWorldSnap = snap;
      const wId = String(snap.tick);
      this.worldSnaps.set(wId, snap);
      if (this.worldSnaps.size > WORLD_VAULT_MAX) {
        const oldestKey = this.worldSnaps.keys().next().value;
        if (oldestKey !== undefined) this.worldSnaps.delete(oldestKey);
      }
      this.worldSi.vault.add({
        id: wId,
        time: arrivalMs,
        state: {
          chunks: snap.chunks.map((c) => ({ id: String(c.index), x: uqPos(qPos(c.x)), y: uqPos(qPos(c.y)), r: uqRot(qRot(c.angle)) })),
          rubble: snap.rubble.map((r) => ({ id: String(r.id), x: uqPos(qPos(r.x)), y: uqPos(qPos(r.y)), r: uqRot(qRot(r.angle)) })),
          gadgets: snap.gadgets.map((g) => ({ id: String(g.id), x: uqPos(qPos(g.x)), y: uqPos(qPos(g.y)), r: uqRot(qRot(g.angle)) })),
        },
      });
    }
  }

  public sample(nowMs: number, estimatedHostTick: number): InterpolatedWorldState {
    assertFinite(nowMs, 'nowMs');
    assertFinite(estimatedHostTick, 'estimatedHostTick');
    const interpDelayMs = this.getInterpDelayMs();
    if (this.latestSnap === null) {
      return { tick: 0, interpDelayMs, fighters: [], projectiles: [], chunks: [], rubble: [], gadgets: [] };
    }

    const renderTimeMs = nowMs - interpDelayMs;
    const latest = this.latestSnap;
    const deltaTicks = Math.max(0, Math.round(estimatedHostTick - latest.tick));

    const interpFighterPos = new Map<number, { x: number; y: number }>();
    if (interpDelayMs > 0) {
      const fShots = this.fighterSi.vault.get(renderTimeMs);
      if (fShots && fShots.older && fShots.newer) {
        const t0 = fShots.newer.time;
        const t1 = fShots.older.time;
        const pct = t0 > t1 ? Math.max(0, Math.min(1, (renderTimeMs - t1) / (t0 - t1))) : 1;
        for (const e of this.fighterSi.interpolate(fShots.newer, fShots.older, pct, 'x y').state) {
          interpFighterPos.set(Number(e.id), { x: numProp(e, 'x'), y: numProp(e, 'y') });
        }
      } else if (renderTimeMs < this.latestArrivalMs) {
        const closest = this.fighterSi.vault.get(renderTimeMs, true);
        if (closest && Array.isArray(closest.state)) {
          for (const e of closest.state) {
            interpFighterPos.set(Number(e.id), { x: numProp(e, 'x'), y: numProp(e, 'y') });
          }
        }
      }
    }

    const fighters: InterpolatedFighter[] = latest.fighters.map((f) => {
      const pos = interpFighterPos.get(f.slot);
      const remainingHitstop = Math.max(0, f.hitstopFrames - deltaTicks);
      // Freeze pose frame while in hitstop so impact frames hold crisply like Smash
      const frameAdvance = f.hitstopFrames > 0 ? Math.max(0, deltaTicks - f.hitstopFrames) : deltaTicks;
      const advancedFrame = f.stateFrame + frameAdvance;
      return {
        slot: f.slot,
        x: pos ? pos.x : f.x,
        y: pos ? pos.y : f.y,
        vx: f.vx,
        vy: f.vy,
        state: f.state,
        stateFrame: advancedFrame,
        activeMove: f.activeMove,
        moveFrame: f.state === FighterState.Attack ? advancedFrame : 0,
        flags: f.flags,
        damage: f.damage,
        guardHp: f.guardHp,
        gilt: f.gilt,
        stocks: f.stocks,
        heldGadget: f.heldGadget,
        heldGadgetAmmo: f.heldGadgetAmmo,
        nestaSize: f.nestaSize,
        hitstopFrames: remainingHitstop,
      };
    });

    const dtSec = Math.max(0, (estimatedHostTick - latest.tick) / this.tickRate);
    const projectiles: SnapshotProjectile[] = latest.projectiles.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x + p.vx * dtSec,
      y: p.y + p.vy * dtSec,
      vx: p.vx,
      vy: p.vy,
    }));

    const { chunks, rubble, gadgets } = this.sampleWorld(renderTimeMs);
    return { tick: latest.tick, interpDelayMs, fighters, projectiles, chunks, rubble, gadgets };
  }

  private sampleWorld(renderTimeMs: number): {
    chunks: readonly SnapshotChunk[];
    rubble: readonly SnapshotRubble[];
    gadgets: readonly SnapshotGadget[];
  } {
    if (this.latestWorldSnap === null) return { chunks: [], rubble: [], gadgets: [] };
    const wShots = this.worldSi.vault.get(renderTimeMs);
    if (!wShots || !wShots.older || !wShots.newer) {
      const closest = this.worldSi.vault.get(renderTimeMs, true);
      if (closest) {
        const snap = this.worldSnaps.get(closest.id);
        assert(snap !== undefined, ErrorCode.MissingRequiredEntry, `Missing world snapshot ${closest.id}`);
        return { chunks: snap.chunks, rubble: snap.rubble, gadgets: snap.gadgets };
      }
      return { chunks: this.latestWorldSnap.chunks, rubble: this.latestWorldSnap.rubble, gadgets: this.latestWorldSnap.gadgets };
    }

    const t0 = wShots.newer.time;
    const t1 = wShots.older.time;
    const pct = t0 > t1 ? Math.max(0, Math.min(1, (renderTimeMs - t1) / (t0 - t1))) : 1;
    const meta = this.worldSnaps.get(wShots.newer.id);
    assert(meta !== undefined, ErrorCode.MissingRequiredEntry, `Missing world snapshot ${wShots.newer.id}`);
    const chunkMeta = indexById(meta.chunks, (c) => c.index);
    const rubbleMeta = indexById(meta.rubble, (r) => r.id);
    const gadgetMeta = indexById(meta.gadgets, (g) => g.id);

    const chunks = this.worldSi.interpolate(wShots.newer, wShots.older, pct, 'x y r(rad)', 'chunks').state.map((e) => {
      const index = Number(e.id);
      const m = chunkMeta.get(index);
      assert(m !== undefined, ErrorCode.MissingRequiredEntry, `Missing chunk meta ${index}`);
      return { index, x: numProp(e, 'x'), y: numProp(e, 'y'), angle: numProp(e, 'r'), vx: m.vx, vy: m.vy, state: m.state, resting: m.resting };
    });
    const rubble = this.worldSi.interpolate(wShots.newer, wShots.older, pct, 'x y r(rad)', 'rubble').state.map((e) => {
      const id = Number(e.id);
      const m = rubbleMeta.get(id);
      assert(m !== undefined, ErrorCode.MissingRequiredEntry, `Missing rubble meta ${id}`);
      return { id, x: numProp(e, 'x'), y: numProp(e, 'y'), angle: numProp(e, 'r'), vx: m.vx, vy: m.vy };
    });
    const gadgets = this.worldSi.interpolate(wShots.newer, wShots.older, pct, 'x y r(rad)', 'gadgets').state.map((e) => {
      const id = Number(e.id);
      const m = gadgetMeta.get(id);
      assert(m !== undefined, ErrorCode.MissingRequiredEntry, `Missing gadget meta ${id}`);
      return {
        id,
        gadgetId: m.gadgetId,
        x: numProp(e, 'x'),
        y: numProp(e, 'y'),
        angle: numProp(e, 'r'),
        vx: m.vx,
        vy: m.vy,
        state: m.state,
        ammo: m.ammo,
      };
    });
    return { chunks, rubble, gadgets };
  }
}

// ---------------------------------------------------------------- 4. Client Prediction & Reconciliation

export enum ReconcileContext {
  Normal = 0,
  HostCombatEvent = 1,
  HostTeleport = 2,
}

export interface ReconcileResult {
  readonly state: SnapshotFighter;
  readonly predictionError: number;
  readonly discrepancy: number;
  readonly snapped: boolean;
  readonly replayedCount: number;
}

export class PredictionController {
  private readonly unackedTicks = new Int32Array(INPUT_RING_SIZE);
  private readonly unackedMasks = new Uint16Array(INPUT_RING_SIZE);
  private unackedHead = 0;
  private unackedCount = 0;

  private readonly recTicks = new Int32Array(INPUT_RING_SIZE);
  private readonly recMasks = new Uint16Array(INPUT_RING_SIZE);
  private readonly recSentAtMs = new Float64Array(INPUT_RING_SIZE);
  private readonly predTicks = new Int32Array(INPUT_RING_SIZE);
  private readonly predX = new Float64Array(INPUT_RING_SIZE);
  private readonly predY = new Float64Array(INPUT_RING_SIZE);

  private readonly errorSamples = new Float64Array(ERROR_SAMPLE_CAP);
  private errorSampleHead = 0;
  private errorSampleCount = 0;
  private lastPredictionError = 0;

  private lastSnapshotTick = 0;
  private visualOffsetX = 0;
  private visualOffsetY = 0;
  private blendFramesLeft = 0;
  private largeCorrectionCount = 0;
  private hostCombatSnapCount = 0;
  private oneWayMs = 0;
  private hasOneWaySample = false;

  public constructor() {
    this.unackedTicks.fill(EMPTY_TICK);
    this.recTicks.fill(EMPTY_TICK);
    this.recSentAtMs.fill(-1);
    this.predTicks.fill(EMPTY_TICK);
  }

  public setLastSnapshotTick(tick: number): void {
    assert(Number.isInteger(tick) && tick >= 0, ErrorCode.InvariantViolation, `Invalid snapshot tick ${tick}`);
    if (tick > this.lastSnapshotTick) this.lastSnapshotTick = tick;
  }

  public getLastSnapshotTick(): number {
    return this.lastSnapshotTick;
  }

  public getOneWayMs(): number {
    return this.oneWayMs;
  }

  public observeAckOneWayMs(lastAppliedTick: number, arrivalMs: number): number {
    if (lastAppliedTick >= 0) {
      const idx = lastAppliedTick & INPUT_RING_MASK;
      const sentMs = this.recSentAtMs[idx] as number;
      if ((this.recTicks[idx] as number) === lastAppliedTick && sentMs >= 0) {
        const { tuning } = getGameData();
        const hostDelayMs = (tuning.net.hostInputJitterBufferTicks + 0.5) * (1000 / tuning.tickRate);
        const sample = Math.max(0, (arrivalMs - sentMs - hostDelayMs) * 0.5);
        this.oneWayMs = this.hasOneWaySample ? this.oneWayMs * (1 - RTT_EMA_ALPHA) + sample * RTT_EMA_ALPHA : sample;
        this.hasOneWaySample = true;
      }
    }
    return this.oneWayMs;
  }

  public recordPredictedState(tick: number, x: number, y: number): void {
    assert(Number.isInteger(tick) && tick >= 0, ErrorCode.InvariantViolation, `Invalid pred tick ${tick}`);
    assertFinite(x, 'pred.x');
    assertFinite(y, 'pred.y');
    const idx = tick & INPUT_RING_MASK;
    this.predTicks[idx] = tick;
    this.predX[idx] = x;
    this.predY[idx] = y;
  }

  public recordInput(tick: number, mask: number, sentAtMs = -1, epoch = 0): InputPacket {
    assert(Number.isInteger(tick) && tick >= 0, ErrorCode.InvariantViolation, `Invalid input tick ${tick}`);
    const masked = mask & 0xffff;
    const rIdx = tick & INPUT_RING_MASK;
    this.recTicks[rIdx] = tick;
    this.recMasks[rIdx] = masked;
    this.recSentAtMs[rIdx] = sentAtMs;

    if (this.unackedCount === INPUT_RING_SIZE) {
      this.unackedHead = (this.unackedHead + 1) & INPUT_RING_MASK;
      this.unackedCount -= 1;
    }
    const writeIdx = (this.unackedHead + this.unackedCount) & INPUT_RING_MASK;
    this.unackedTicks[writeIdx] = tick;
    this.unackedMasks[writeIdx] = masked;
    this.unackedCount += 1;

    const m = (t: number): number =>
      t >= 0 && (this.recTicks[t & INPUT_RING_MASK] as number) === t
        ? (this.recMasks[t & INPUT_RING_MASK] as number)
        : 0;
    return {
      tick: tick & 0xffff,
      masks: [m(tick), m(tick - 1), m(tick - 2), m(tick - 3)],
      lastSnapshotTick: this.lastSnapshotTick & 0xffff,
      epoch: epoch & 0xffff,
    };
  }

  public reconcile(
    authoritative: SnapshotFighter,
    lastAppliedTick: number,
    predictedNow: { readonly x: number; readonly y: number },
    replayStep: (state: SnapshotFighter, mask: number, tick: number) => SnapshotFighter,
    context: ReconcileContext = ReconcileContext.Normal,
  ): ReconcileResult {
    assertFinite(predictedNow.x, 'predictedNow.x');
    assertFinite(predictedNow.y, 'predictedNow.y');

    let predictionError = 0;
    if (context === ReconcileContext.Normal && lastAppliedTick >= 0) {
      const pIdx = lastAppliedTick & INPUT_RING_MASK;
      if ((this.predTicks[pIdx] as number) === lastAppliedTick) {
        predictionError = Math.hypot(
          (this.predX[pIdx] as number) - authoritative.x,
          (this.predY[pIdx] as number) - authoritative.y,
        );
        this.lastPredictionError = predictionError;
        this.errorSamples[this.errorSampleHead] = predictionError;
        this.errorSampleHead = (this.errorSampleHead + 1) % ERROR_SAMPLE_CAP;
        if (this.errorSampleCount < ERROR_SAMPLE_CAP) this.errorSampleCount += 1;
      }
    }

    while (this.unackedCount > 0 && (this.unackedTicks[this.unackedHead] as number) <= lastAppliedTick) {
      this.unackedHead = (this.unackedHead + 1) & INPUT_RING_MASK;
      this.unackedCount -= 1;
    }

    let state = authoritative;
    for (let i = 0; i < this.unackedCount; i++) {
      const idx = (this.unackedHead + i) & INPUT_RING_MASK;
      const tick = this.unackedTicks[idx] as number;
      const mask = this.unackedMasks[idx] as number;
      state = replayStep(state, mask, tick);
      this.recordPredictedState(tick, state.x, state.y);
    }

    const dx = predictedNow.x - state.x;
    const dy = predictedNow.y - state.y;
    const discrepancy = context === ReconcileContext.HostTeleport ? 0 : Math.hypot(dx, dy);
    const snapped = context !== ReconcileContext.HostTeleport && discrepancy >= LARGE_CORRECTION_U;
    if (context === ReconcileContext.HostTeleport) {
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
      this.blendFramesLeft = 0;
    } else if (snapped) {
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
      this.blendFramesLeft = 0;
      if (context === ReconcileContext.HostCombatEvent) {
        this.hostCombatSnapCount += 1;
      } else {
        this.largeCorrectionCount += 1;
      }
    } else if (discrepancy > 0) {
      this.visualOffsetX = dx;
      this.visualOffsetY = dy;
      this.blendFramesLeft = BLEND_FRAMES;
    } else {
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
      this.blendFramesLeft = 0;
    }

    return { state, predictionError, discrepancy, snapped, replayedCount: this.unackedCount };
  }

  public stepVisualOffset(): void {
    if (this.blendFramesLeft <= 0) {
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
      return;
    }
    this.blendFramesLeft -= 1;
    if (this.blendFramesLeft === 0) {
      this.visualOffsetX = 0;
      this.visualOffsetY = 0;
    } else {
      const ratio = this.blendFramesLeft / (this.blendFramesLeft + 1);
      this.visualOffsetX *= ratio;
      this.visualOffsetY *= ratio;
    }
  }

  public getVisualOffset(): { readonly x: number; readonly y: number } {
    return { x: this.visualOffsetX, y: this.visualOffsetY };
  }

  public getLargeCorrectionCount(): number {
    return this.largeCorrectionCount;
  }

  public getHostCombatSnapCount(): number {
    return this.hostCombatSnapCount;
  }

  public getLastPredictionError(): number {
    return this.lastPredictionError;
  }

  public getPredictionErrorP95(): number {
    if (this.errorSampleCount === 0) return 0;
    const sorted = Array.from(this.errorSamples.subarray(0, this.errorSampleCount)).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[idx] as number;
  }

  public getUnackedCount(): number {
    return this.unackedCount;
  }
}
