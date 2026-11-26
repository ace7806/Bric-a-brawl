import { describe, expect, it } from 'vitest';
import type { InputPacket, SnapshotData, SnapshotFighter } from '@net/codec';
import {
  HostClockEstimator,
  InputJitterBuffer,
  PredictionController,
  RemoteInterpolator,
  unwrap16,
} from '@net/sync';
import { getGameData } from '@sim/data';
import {
  ChunkState,
  FighterFlag,
  FighterState,
  GadgetId,
  InputBit,
  InputDir,
  MoveId,
  NestaSize,
  ProjectileKind,
  WorldGadgetState,
} from '@sim/enums';
import { assertWithinBand } from '../support/asserts';
import { mask, tape } from '../support/inputs';

function makeSnapFighter(
  slot: number,
  x: number,
  y: number,
  state = FighterState.Idle,
  stateFrame = 0,
  activeMove = MoveId.None,
): SnapshotFighter {
  return {
    slot,
    x,
    y,
    vx: 0,
    vy: 0,
    state,
    stateFrame,
    activeMove,
    flags: FighterFlag.FacingRight | FighterFlag.Grounded,
    damage: 0,
    guardHp: 50,
    gilt: 0,
    stocks: 3,
    heldGadget: GadgetId.None,
    heldGadgetAmmo: 0,
    nestaSize: NestaSize.Mid,
    hitstopFrames: 0,
  };
}

function packetFromSeq(seq: readonly number[], tick: number, lastSnapshotTick = 0): InputPacket {
  const m = (t: number): number => (t >= 0 && t < seq.length ? (seq[t] as number) : 0);
  return {
    tick: tick & 0xffff,
    masks: [m(tick), m(tick - 1), m(tick - 2), m(tick - 3)],
    lastSnapshotTick: lastSnapshotTick & 0xffff,
    epoch: 0,
  };
}

describe('unwrap16', () => {
  it.each([
    [65535, 65535, 65535],
    [0, 65535, 65536],
    [5, 65534, 65541],
    [65535, 65536, 65535],
    [65530, 65540, 65530],
    [2, 131070, 131074],
    [65534, 131073, 131070],
  ])('unwraps wrapped16=%i around refTick=%i -> %i', (wrapped16, refTick, expected) => {
    expect(unwrap16(wrapped16, refTick)).toBe(expected);
  });
});

describe('InputJitterBuffer', () => {
  const seq = tape()
    .tap(InputDir.Right)
    .tap(InputDir.Left, InputBit.Attack)
    .tap(InputDir.Up, InputBit.Jump)
    .tap(InputDir.Down, InputBit.Guard)
    .tap(InputDir.UpRight, InputBit.Heavy)
    .tap(InputDir.DownLeft, InputBit.Special)
    .tap(InputDir.Right, InputBit.Grab)
    .tap(InputDir.Left, InputBit.Use)
    .motion236(true, InputBit.Special)
    .motion623(true, InputBit.Special)
    .hold(2, InputDir.DownRight, InputBit.Tilt)
    .build();

  it('enforces 2-tick buffer startup, sequential ordering, and lastAppliedTick progression', () => {
    const buf = new InputJitterBuffer();
    expect(buf.popInputForTick(0, 0)).toEqual({ mask: 0, inputTick: -1, lost: false });
    expect(buf.getLastAppliedTicks(2)).toEqual([-1, -1]);

    buf.ingestPacket(0, packetFromSeq(seq, 0), 0);
    expect(buf.popInputForTick(0, 0).inputTick).toBe(-1);

    buf.ingestPacket(0, packetFromSeq(seq, 1), 1);
    expect(buf.popInputForTick(0, 1).inputTick).toBe(-1);

    // Out-of-order arrival: tick 3 before tick 2; buffer primes at newest >= 2 and pops in strict order
    buf.ingestPacket(0, packetFromSeq(seq, 3), 2);
    expect(buf.popInputForTick(0, 2)).toEqual({ mask: seq[0], inputTick: 0, lost: false });
    buf.ingestPacket(0, packetFromSeq(seq, 2), 3);

    for (let t = 1; t <= 3; t++) {
      expect(buf.popInputForTick(0, t + 2)).toEqual({ mask: seq[t], inputTick: t, lost: false });
    }
    expect(buf.getLastAppliedTicks(1)).toEqual([3]);
  });

  it.each([
    { dropCount: 3, expectedLost: 0 },
    { dropCount: 4, expectedLost: 1 },
  ])('4x redundancy: dropping $dropCount consecutive packets loses $expectedLost input(s) (N3)', ({ dropCount, expectedLost }) => {
    const buf = new InputJitterBuffer();
    const dropStart = 3;
    const dropEnd = dropStart + dropCount - 1;
    const popped = new Map<number, { mask: number; lost: boolean }>();

    for (let hostTick = 0; hostTick < seq.length + dropCount + 2; hostTick++) {
      if (hostTick < seq.length && (hostTick < dropStart || hostTick > dropEnd)) {
        buf.ingestPacket(0, packetFromSeq(seq, hostTick), hostTick);
      }
      const res = buf.popInputForTick(0, hostTick);
      if (res.inputTick >= 0 && !popped.has(res.inputTick)) {
        popped.set(res.inputTick, { mask: res.mask, lost: res.lost });
      }
    }

    expect(buf.getLossStats(0).inputsLost).toBe(expectedLost);
    expect(buf.getLossStats().inputsLost).toBe(expectedLost);
    expect(buf.getLastAppliedTicks(1)[0]).toBe(seq.length - 1);
    for (let t = 0; t < seq.length; t++) {
      const entry = popped.get(t);
      expect(entry).toBeDefined();
      if (t === dropStart && expectedLost === 1) expect(entry?.lost).toBe(true);
      else expect(entry).toEqual({ mask: seq[t], lost: false });
    }
  });

  it('tracks client RTT EMA and caps lag-comp rewind (Rule 1) & defender grace (Rule 3)', () => {
    const net = getGameData().tuning.net;
    expect(net.lagCompMaxTicks).toBe(8);
    expect(net.defenderGraceMaxTicks).toBe(3);

    const buf = new InputJitterBuffer();
    buf.ingestPacket(0, packetFromSeq(seq, 0, 6), 10);
    expect(buf.getClientRttTicks(0)).toBe(4);
    expect(buf.getClientOneWayTicks(0)).toBe(2);

    buf.ingestPacket(0, packetFromSeq(seq, 1, 2), 11);
    expect(buf.getClientRttTicks(0)).toBeCloseTo(4 * 0.8 + 9 * 0.2, 6); // 5.0
    expect(buf.computeLagCompRewindTicks(0)).toBe(8); // min(8, round(5 + 3.96))
    expect(buf.computeDefenderGraceTicks(0)).toBe(3); // min(3, ceil(2.5))

    buf.ingestPacket(1, packetFromSeq(seq, 0, 8), 10); // rtt = 2
    expect(buf.computeLagCompRewindTicks(1)).toBe(6); // round(2 + 3.96)
    expect(buf.computeDefenderGraceTicks(1)).toBe(1);

    buf.ingestPacket(2, packetFromSeq(seq, 0, 0), 30); // rtt = 30 -> clamped
    expect(buf.computeLagCompRewindTicks(2)).toBe(8);
    expect(buf.computeDefenderGraceTicks(2)).toBe(3);
  });

  it('maintains bounded ring memory and zero loss across 10,000 ticks (N11)', () => {
    const buf = new InputJitterBuffer();
    const total = 10_000;
    let lastPopMask = 0;
    for (let t = 0; t < total + 2; t++) {
      if (t < total) {
        const m = (t * 257) & 0xffff;
        const m1 = t >= 1 ? ((t - 1) * 257) & 0xffff : 0;
        const m2 = t >= 2 ? ((t - 2) * 257) & 0xffff : 0;
        const m3 = t >= 3 ? ((t - 3) * 257) & 0xffff : 0;
        buf.ingestPacket(0, { tick: t & 0xffff, masks: [m, m1, m2, m3], lastSnapshotTick: t & 0xffff, epoch: 0 }, t);
      }
      const res = buf.popInputForTick(0, t);
      if (res.inputTick >= 0) lastPopMask = res.mask;
    }

    expect(buf.getLastAppliedTicks(1)[0]).toBe(total - 1);
    expect(lastPopMask).toBe(((total - 1) * 257) & 0xffff);
    expect(buf.getLossStats(0)).toEqual({ inputsLost: 0, inputsTotal: total, lossRate: 0 });
  });
});

describe('HostClockEstimator', () => {
  const tickMs = 1000 / 60;

  it('estimates host tick smoothly, ignores stale snapshots, and adapts interp delay within [66, 150] ms', () => {
    const est = new HostClockEstimator();
    expect(est.isInitialized()).toBe(false);
    expect(est.estimateHostTick(500)).toBe(0);
    expect(est.getInterpDelayMs()).toBe(66);

    est.onSnapshot(100, 1000);
    expect(est.isInitialized()).toBe(true);
    expect(est.estimateHostTick(1000)).toBe(100);
    expect(est.estimateHostTick(1000 + 3 * tickMs)).toBeCloseTo(103, 5);

    est.onSnapshot(99, 1020); // stale ignored
    expect(est.estimateHostTick(1000 + 3 * tickMs)).toBeCloseTo(103, 5);

    // Steady 30 Hz stream -> zero jitter, min 66 ms interp delay
    for (let i = 1; i <= 10; i++) est.onSnapshot(100 + i * 2, 1000 + i * 2 * tickMs);
    expect(est.getJitterMs()).toBeCloseTo(0, 6);
    expect(est.getInterpDelayMs()).toBeCloseTo(66, 6);

    // Alternating arrival jitter -> adaptive delay stays in [66, 150] and saturates at 150 under heavy jitter
    for (let i = 11; i <= 30; i++) {
      const jitter = i % 2 === 0 ? 25 : -25;
      est.onSnapshot(100 + i * 2, 1000 + i * 2 * tickMs + jitter);
      assertWithinBand(est.getInterpDelayMs(), 66, 150, 'moderate jitter interpDelayMs');
    }
    expect(est.getJitterMs()).toBeGreaterThan(10);
    expect(est.getInterpDelayMs()).toBeGreaterThan(66);

    for (let i = 31; i <= 70; i++) {
      est.onSnapshot(100 + i * 2, 1000 + i * 2 * tickMs + (i % 2 === 0 ? 200 : -200));
      assertWithinBand(est.getInterpDelayMs(), 66, 150, 'heavy jitter interpDelayMs');
    }
    expect(est.getInterpDelayMs()).toBe(150);

    // Large clock jump (> 15 ticks) snaps cleanly
    est.onSnapshot(500, 5000);
    expect(est.estimateHostTick(5000)).toBe(500);
  });
});

describe('RemoteInterpolator', () => {
  it('interpolates remote fighters/world in the past, advances stateFrame/moveFrame (Rule 2), and extrapolates projectiles', () => {
    const interp = new RemoteInterpolator();
    expect(interp.sample(1000, 10).fighters).toEqual([]);
    interp.setInterpDelayMs(20);
    expect(interp.getInterpDelayMs()).toBe(66);
    interp.setInterpDelayMs(300);
    expect(interp.getInterpDelayMs()).toBe(150);
    interp.setInterpDelayMs(66);

    const makeWorldSnap = (tick: number, f1x: number, f1y: number, stateFrame1: number, projX: number, chunkX: number): SnapshotData => ({
      tick,
      epoch: 0,
      lastAppliedInputTicks: [tick - 1, tick - 1],
      fighters: [
        makeSnapFighter(1, f1x, f1y, FighterState.Attack, stateFrame1, MoveId.Ftilt),
        makeSnapFighter(2, 5, 0, FighterState.Idle, 2, MoveId.None),
      ],
      projectiles: [{ id: 1, kind: ProjectileKind.SteamPuff, x: projX, y: 0.9, vx: 6, vy: -3 }],
      chunks: [{ index: 0, x: chunkX, y: 0, angle: 0, vx: 0, vy: 0, state: ChunkState.Falling, resting: false }],
      rubble: [{ id: 7, x: chunkX, y: 1, angle: 0, vx: 0, vy: 0 }],
      gadgets: [{ id: 3, gadgetId: GadgetId.Cork, x: chunkX, y: 0.5, angle: 0, vx: 0, vy: 0, state: WorldGadgetState.Grounded, ammo: 1 }],
      hasWorld: true,
    });

    interp.pushSnapshot(makeWorldSnap(100, 0, 0, 5, 2.0, 0), 1000);
    interp.pushSnapshot(makeWorldSnap(102, 4, 2, 7, 2.2, 2), 1040);
    interp.pushSnapshot(makeWorldSnap(101, 99, 99, 99, 99, 99), 1020); // stale tick ignored

    // nowMs = 1086 -> renderTimeMs = 1086 - 66 = 1020 (midpoint pct=0.5 between 1000 & 1040)
    // estimatedHostTick = 105 -> deltaTicks = 3, dtSec = 3/60 = 0.05 s
    const sampled = interp.sample(1086, 105);
    expect(sampled.tick).toBe(102);

    const f1 = sampled.fighters[0];
    const f2 = sampled.fighters[1];
    expect(f1?.x).toBeCloseTo(2, 2);
    expect(f1?.y).toBeCloseTo(1, 2);
    expect(f1?.stateFrame).toBe(10); // 7 + 3
    expect(f1?.activeMove).toBe(MoveId.Ftilt);
    expect(f1?.moveFrame).toBe(10); // Attack advances moveFrame
    expect(f2?.stateFrame).toBe(5); // 2 + 3
    expect(f2?.activeMove).toBe(MoveId.None);
    expect(f2?.moveFrame).toBe(0); // Idle keeps moveFrame 0

    const p0 = sampled.projectiles[0];
    expect(p0?.x).toBeCloseTo(2.2 + 6 * 0.05, 5);
    expect(p0?.y).toBeCloseTo(0.9 - 3 * 0.05, 5);
    expect(sampled.chunks[0]?.x).toBeCloseTo(1, 2);
  });
});

describe('PredictionController', () => {
  it('emits 4-mask redundant InputPackets with 16-bit tick wrapping', () => {
    const pred = new PredictionController();
    pred.setLastSnapshotTick(65538);
    pred.setLastSnapshotTick(100); // monotonic: stays 65538
    expect(pred.getLastSnapshotTick()).toBe(65538);

    const seq = tape().tap(InputDir.Right).tap(InputDir.Left, InputBit.Jump).tap(InputDir.Up).tap(InputDir.Down).tap(InputDir.Right, InputBit.Attack).build();
    const packets = seq.map((m, t) => pred.recordInput(t, m));
    expect(packets[0]).toEqual({ tick: 0, masks: [seq[0], 0, 0, 0], lastSnapshotTick: 2, epoch: 0 });
    expect(packets[4]).toEqual({ tick: 4, masks: [seq[4], seq[3], seq[2], seq[1]], lastSnapshotTick: 2, epoch: 0 });
  });

  it('drops acked inputs, replays unacked inputs, blends < 0.5 u over 6 frames, and snaps >= 0.5 u (N4/N5)', () => {
    const pred = new PredictionController();
    const mRight = mask(InputDir.Right);
    for (let t = 10; t <= 13; t++) {
      pred.recordInput(t, mRight);
      pred.recordPredictedState(t, (t - 9) * 0.25, 0);
    }

    const replayStep = (s: SnapshotFighter, m: number): SnapshotFighter => ({
      ...s,
      x: s.x + ((m & InputBit.DirMask) === InputDir.Right ? 0.25 : 0),
    });

    // Ack up to tick 11 -> replays ticks 12 & 13 -> replayed x = 0.5 + 0.5 = 1.0
    // predictedNow = 1.3 -> discrepancy = 0.3 u (< 0.5 u) -> smooth 6-frame blend, 0 large corrections
    const small = pred.reconcile(makeSnapFighter(0, 0.5, 0), 11, { x: 1.3, y: 0 }, replayStep);
    expect(small.replayedCount).toBe(2);
    expect(pred.getUnackedCount()).toBe(2);
    expect(small.snapped).toBe(false);
    expect(small.discrepancy).toBeCloseTo(0.3, 6);
    expect(small.predictionError).toBeCloseTo(0, 6);
    expect(pred.getLargeCorrectionCount()).toBe(0);
    expect(pred.getVisualOffset().x).toBeCloseTo(0.3, 6);

    for (let f = 5; f >= 0; f--) {
      pred.stepVisualOffset();
      expect(pred.getVisualOffset().x).toBeCloseTo(0.3 * (f / 6), 6);
    }
    expect(pred.getVisualOffset()).toEqual({ x: 0, y: 0 });

    // Large error >= 0.5 u -> snaps immediately & increments largeCorrectionCount
    const large = pred.reconcile(makeSnapFighter(0, 0.5, 0), 11, { x: 1.5, y: 0 }, replayStep);
    expect(large.snapped).toBe(true);
    expect(large.discrepancy).toBeCloseTo(0.5, 6);
    expect(pred.getLargeCorrectionCount()).toBe(1);
    expect(pred.getVisualOffset()).toEqual({ x: 0, y: 0 });
    expect(pred.getPredictionErrorP95()).toBeCloseTo(0, 6);
  });
});
