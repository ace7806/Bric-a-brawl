import type { InputPacket } from '@net/codec';
import { assertNever } from '@sim/assert';
import { getGameData } from '@sim/data';
import { ErrorCode } from '@sim/enums';
import type { RoundResult, SimEvent } from '@sim/types';
import { initPhysics } from '@sim/world';
import { HostSimulation, runOneSecondBenchmark, type HostEngineConfig } from './engine';

export enum HostWorkerCmd {
  Init = 0,
  StartMatch = 1,
  LocalInput = 2,
  ClientPacket = 3,
  StopMatch = 4,
  Benchmark = 5,
}

export enum HostWorkerEvent {
  Ready = 0,
  Tick = 1,
  BenchmarkResult = 2,
  Error = 3,
}

export type HostWorkerInbound =
  | { readonly cmd: HostWorkerCmd.Init }
  | { readonly cmd: HostWorkerCmd.StartMatch; readonly config: HostEngineConfig; readonly epoch: number }
  | { readonly cmd: HostWorkerCmd.LocalInput; readonly slot: number; readonly mask: number }
  | { readonly cmd: HostWorkerCmd.ClientPacket; readonly slot: number; readonly packet: InputPacket }
  | { readonly cmd: HostWorkerCmd.StopMatch }
  | { readonly cmd: HostWorkerCmd.Benchmark };

export type HostWorkerOutbound =
  | { readonly event: HostWorkerEvent.Ready }
  | {
      readonly event: HostWorkerEvent.Tick;
      readonly epoch: number;
      readonly tick: number;
      readonly snapshotBytes: Uint8Array | null;
      readonly localSnapshotBytes: Uint8Array | null;
      readonly includeWorld: boolean;
      readonly events: readonly SimEvent[];
      readonly roundResult: RoundResult | null;
      readonly struggling: boolean;
      readonly stalled: boolean;
    }
  | { readonly event: HostWorkerEvent.BenchmarkResult; readonly ticksPerSec: number }
  | { readonly event: HostWorkerEvent.Error; readonly code: ErrorCode; readonly message: string };

const TICK_INTERVAL_MS = 1000 / getGameData().tuning.tickRate;
const MAX_TICKS_PER_WAKE = 5;
const WAKE_INTERVAL_MS = 4;

let sim: HostSimulation | null = null;
let currentEpoch = 0;
let timerId: ReturnType<typeof setInterval> | null = null;
let lastWakeMs = 0;
let accumMs = 0;
let lastStepMs = 0;

function postEvent(msg: HostWorkerOutbound, transfer?: Transferable[]): void {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    if (transfer && transfer.length > 0) {
      self.postMessage(msg, { transfer });
    } else {
      self.postMessage(msg);
    }
  }
}

function stopLoop(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (sim !== null) {
    sim.dispose();
    sim = null;
  }
  accumMs = 0;
  lastStepMs = 0;
}

let stepping = false;
let msgQueue: Promise<void> = Promise.resolve();

function postError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err && typeof err === 'object' && 'code' in err && typeof err.code === 'number'
      ? (err.code as ErrorCode)
      : ErrorCode.InvariantViolation;
  postEvent({ event: HostWorkerEvent.Error, code, message });
}

function stepLoop(): void {
  if (!sim || stepping) return;
  stepping = true;
  try {
    const now = performance.now();
    const dt = Math.max(0, now - lastWakeMs);
    lastWakeMs = now;
    accumMs += dt;

    let ticksRun = 0;
    while (sim && accumMs >= TICK_INTERVAL_MS) {
      const t0 = performance.now();
      const out = sim.stepTick(lastStepMs);
      lastStepMs = performance.now() - t0;
      accumMs -= TICK_INTERVAL_MS;
      ticksRun += 1;

      const hitCap = ticksRun >= MAX_TICKS_PER_WAKE && accumMs >= TICK_INTERVAL_MS;
      if (hitCap) accumMs = 0;

      const bytes = out.snapshotBytes;
      const localBytes = out.localSnapshotBytes;
      const transfer: Transferable[] = [];
      if (bytes && bytes.buffer instanceof ArrayBuffer) transfer.push(bytes.buffer);
      if (localBytes && localBytes.buffer instanceof ArrayBuffer) transfer.push(localBytes.buffer);
      postEvent(
        {
          event: HostWorkerEvent.Tick,
          epoch: currentEpoch,
          tick: out.tick,
          snapshotBytes: bytes,
          localSnapshotBytes: localBytes,
          includeWorld: out.includeWorld,
          events: out.events,
          roundResult: out.roundResult,
          struggling: out.struggling,
          stalled: hitCap,
        },
        transfer.length > 0 ? transfer : undefined,
      );
      if (out.finished) {
        stopLoop();
        break;
      }
      if (hitCap) break;
    }
  } catch (err: unknown) {
    stopLoop();
    postError(err);
  } finally {
    stepping = false;
  }
}

async function handleMessage(msg: HostWorkerInbound): Promise<void> {
  switch (msg.cmd) {
    case HostWorkerCmd.Init:
      await initPhysics();
      postEvent({ event: HostWorkerEvent.Ready });
      return;
    case HostWorkerCmd.StartMatch:
      stopLoop();
      currentEpoch = msg.epoch;
      await initPhysics();
      stopLoop();
      sim = new HostSimulation(msg.config);
      lastWakeMs = performance.now();
      accumMs = 0;
      timerId = setInterval(stepLoop, WAKE_INTERVAL_MS);
      postEvent({ event: HostWorkerEvent.Ready });
      return;
    case HostWorkerCmd.LocalInput:
      if (sim) sim.setLocalInput(msg.slot, msg.mask);
      return;
    case HostWorkerCmd.ClientPacket:
      if (sim) sim.ingestClientInput(msg.slot, msg.packet);
      return;
    case HostWorkerCmd.StopMatch:
      stopLoop();
      return;
    case HostWorkerCmd.Benchmark: {
      const ticksPerSec = await runOneSecondBenchmark();
      postEvent({ event: HostWorkerEvent.BenchmarkResult, ticksPerSec });
      return;
    }
    default:
      return assertNever(msg, 'HostWorker.handleMessage');
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = (ev: MessageEvent<HostWorkerInbound>) => {
    const data = ev.data;
    msgQueue = msgQueue.then(() => handleMessage(data)).catch((err: unknown) => {
      stopLoop();
      postError(err);
    });
  };
}
