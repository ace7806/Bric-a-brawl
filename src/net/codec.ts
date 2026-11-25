import { Packr } from 'msgpackr';
import { assert, assertFinite, assertNever, InvariantError } from '../sim/assert';
import {
  ArenaId,
  ChunkState,
  ErrorCode,
  FighterId,
  FighterState,
  GadgetId,
  MatchMode,
  MoveId,
  NestaSize,
  ProjectileKind,
  SimEventKind,
  TeamId,
  WorldGadgetState,
} from '../sim/enums';
import type { SimEvent } from '../sim/types';
import { PACKET_OVERHEAD_BYTES } from './config';
import {
  ByeReason,
  HostAction,
  NetMessageKind,
  QuickPhraseId,
  RoomPhase,
  SlotStatus,
} from './enums';

export const POS_SCALE = 64;
export const VEL_SCALE = 8;
export const ROT_SCALE = 256 / (2 * Math.PI);
export const DMG_SCALE = 10;

const packr = new Packr({ useRecords: false, variableMapSize: true });

export interface InputPacket {
  readonly tick: number;
  readonly masks: readonly [number, number, number, number];
  readonly lastSnapshotTick: number;
}

export interface SnapshotFighter {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly state: FighterState;
  readonly stateFrame: number;
  readonly activeMove: MoveId;
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

export interface SnapshotProjectile {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface SnapshotChunk {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly state: ChunkState;
  readonly resting: boolean;
}

export interface SnapshotRubble {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
}

export interface SnapshotGadget {
  readonly id: number;
  readonly gadgetId: GadgetId;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly state: WorldGadgetState;
  readonly ammo: number;
}

export interface SnapshotData {
  readonly tick: number;
  readonly lastAppliedInputTicks: readonly number[];
  readonly fighters: readonly SnapshotFighter[];
  readonly projectiles: readonly SnapshotProjectile[];
  readonly chunks: readonly SnapshotChunk[];
  readonly rubble: readonly SnapshotRubble[];
  readonly gadgets: readonly SnapshotGadget[];
  readonly hasWorld: boolean;
}

export interface RoomSlotData {
  readonly slot: number;
  readonly peerId: string;
  readonly name: string;
  readonly fighterId: FighterId;
  readonly colourIndex: number;
  readonly team: TeamId;
  readonly wins: number;
  readonly status: SlotStatus;
}

export interface RoomSettingsData {
  readonly mode: MatchMode;
  readonly fragile: boolean;
  readonly stocks: number;
  readonly enableTierB: boolean;
  readonly enableTierC: boolean;
}

export interface RoomRosterData {
  readonly version: number;
  readonly hostId: string;
  readonly phase: RoomPhase;
  readonly arenaId: ArenaId;
  readonly roundSeed: number;
  readonly countdownTicks: number;
  readonly settings: RoomSettingsData;
  readonly slots: readonly RoomSlotData[];
}

export type ReliableNetMessage =
  | {
      readonly kind: NetMessageKind.Hello;
      readonly protocolVersion: number;
      readonly buildId: string;
      readonly name: string;
      readonly fighterId: FighterId;
      readonly colourIndex: number;
    }
  | {
      readonly kind: NetMessageKind.Bye;
      readonly reason: ByeReason;
    }
  | {
      readonly kind: NetMessageKind.Roster;
      readonly roster: RoomRosterData;
    }
  | {
      readonly kind: NetMessageKind.Events;
      readonly events: readonly SimEvent[];
    }
  | {
      readonly kind: NetMessageKind.Say;
      readonly slot: number;
      readonly phraseId: QuickPhraseId;
      readonly tick: number;
    }
  | {
      readonly kind: NetMessageKind.Host;
      readonly action: HostAction;
      readonly fromPeerId: string;
      readonly targetPeerId: string;
      readonly directPeersReached: number;
      readonly benchScore: number;
      readonly medianRttMs: number;
    }
  | {
      readonly kind: NetMessageKind.Perf;
      readonly frameTimeP95Ms: number;
      readonly qualityTier: number;
      readonly snapshotLossRate: number;
    };

export const qPos = (v: number): number => Math.round(assertFinite(v, 'pos') * POS_SCALE);
export const uqPos = (q: number): number => q / POS_SCALE;
export const qVel = (v: number): number => Math.round(assertFinite(v, 'vel') * VEL_SCALE);
export const uqVel = (q: number): number => q / VEL_SCALE;
export const qRot = (rad: number): number => Math.round(assertFinite(rad, 'rot') * ROT_SCALE) & 255;
export const uqRot = (q: number): number => (q & 255) / ROT_SCALE;
export const qDmg = (pct: number): number => Math.round(assertFinite(pct, 'dmg') * DMG_SCALE);
export const uqDmg = (q: number): number => q / DMG_SCALE;

function packBytes(value: unknown): Uint8Array {
  const packed = packr.pack(value);
  return new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
}

function asArray(val: unknown, label: string): unknown[] {
  assert(Array.isArray(val), ErrorCode.SchemaValidationFailed, `${label} must be array`);
  return val;
}

function asInt(val: unknown, label: string): number {
  assert(typeof val === 'number' && Number.isInteger(val), ErrorCode.SchemaValidationFailed, `${label} must be int`);
  return val;
}

function asStr(val: unknown, label: string): string {
  assert(typeof val === 'string', ErrorCode.SchemaValidationFailed, `${label} must be string`);
  return val;
}

function asBool(val: unknown, label: string): boolean {
  assert(typeof val === 'boolean', ErrorCode.SchemaValidationFailed, `${label} must be boolean`);
  return val;
}

export function peekUnreliableKind(bytes: Uint8Array): NetMessageKind {
  const arr = asArray(packr.unpack(bytes), 'unreliable packet');
  assert(arr.length >= 1, ErrorCode.SchemaValidationFailed, 'empty unreliable packet');
  const kind = asInt(arr[0], 'unreliable.kind');
  if (kind === NetMessageKind.Input || kind === NetMessageKind.Snapshot) return kind;
  throw new InvariantError(ErrorCode.InvalidEnumValue, `Unexpected unreliable kind: ${kind}`);
}

export function encodeInputPacket(pkt: InputPacket): Uint8Array {
  return packBytes([
    NetMessageKind.Input,
    pkt.tick & 0xffff,
    pkt.masks[0] & 0xffff,
    pkt.masks[1] & 0xffff,
    pkt.masks[2] & 0xffff,
    pkt.masks[3] & 0xffff,
    pkt.lastSnapshotTick & 0xffff,
  ]);
}

export function decodeInputPacket(bytes: Uint8Array): InputPacket {
  const arr = asArray(packr.unpack(bytes), 'inputPacket');
  assert(arr.length === 7, ErrorCode.SchemaValidationFailed, `inputPacket len=${arr.length}`);
  assert(asInt(arr[0], 'input.kind') === NetMessageKind.Input, ErrorCode.InvalidEnumValue, 'expected Input kind');
  return {
    tick: asInt(arr[1], 'input.tick'),
    masks: [
      asInt(arr[2], 'input.m0'),
      asInt(arr[3], 'input.m1'),
      asInt(arr[4], 'input.m2'),
      asInt(arr[5], 'input.m3'),
    ],
    lastSnapshotTick: asInt(arr[6], 'input.lastSnapshotTick'),
  };
}

export function encodeSnapshot(snap: SnapshotData, includeWorld: boolean): Uint8Array {
  const fighters = snap.fighters.map((f) => [
    qPos(f.x),
    qPos(f.y),
    qVel(f.vx),
    qVel(f.vy),
    f.state | 0,
    f.stateFrame | 0,
    f.flags | 0,
    qDmg(f.damage),
    Math.round(assertFinite(f.guardHp, 'guardHp')),
    Math.round(assertFinite(f.gilt, 'gilt')),
    ((f.stocks & 0x0f) << 4) | (f.heldGadget & 0x0f),
    (f.nestaSize & 0x03) |
      ((f.heldGadgetAmmo & 0x0f) << 2) |
      ((f.activeMove & 0x3f) << 6) |
      ((Math.min(15, Math.max(0, f.hitstopFrames | 0)) & 0x0f) << 12),
  ]);
  const projectiles = snap.projectiles.map((p) => [
    p.id | 0,
    p.kind | 0,
    qPos(p.x),
    qPos(p.y),
    qVel(p.vx),
    qVel(p.vy),
  ]);
  const root: unknown[] = [
    NetMessageKind.Snapshot,
    snap.tick | 0,
    snap.lastAppliedInputTicks.map((t) => t | 0),
    fighters,
    projectiles,
  ];
  if (includeWorld) {
    root.push(
      snap.chunks.map((c) => [
        c.index | 0,
        qPos(c.x),
        qPos(c.y),
        qRot(c.angle),
        qVel(c.vx),
        qVel(c.vy),
        (c.state & 0x07) | (c.resting ? 8 : 0),
      ]),
      snap.rubble.map((r) => [
        r.id | 0,
        qPos(r.x),
        qPos(r.y),
        qRot(r.angle),
        qVel(r.vx),
        qVel(r.vy),
      ]),
      snap.gadgets.map((g) => [
        g.id | 0,
        g.gadgetId | 0,
        qPos(g.x),
        qPos(g.y),
        qRot(g.angle),
        qVel(g.vx),
        qVel(g.vy),
        (g.state & 0x07) | ((g.ammo & 0x1f) << 3),
      ]),
    );
  }
  return packBytes(root);
}

export function decodeSnapshot(bytes: Uint8Array): SnapshotData {
  const arr = asArray(packr.unpack(bytes), 'snapshot');
  assert(arr.length === 5 || arr.length === 8, ErrorCode.SchemaValidationFailed, `snapshot len=${arr.length}`);
  assert(asInt(arr[0], 'snap.kind') === NetMessageKind.Snapshot, ErrorCode.InvalidEnumValue, 'expected Snapshot kind');
  const tick = asInt(arr[1], 'snap.tick');
  const lastAppliedInputTicks = asArray(arr[2], 'snap.lastInputs').map((v, i) => asInt(v, `lastInput[${i}]`));
  const fighters = asArray(arr[3], 'snap.fighters').map((raw, slot) => {
    const f = asArray(raw, `fighter[${slot}]`);
    assert(f.length === 12, ErrorCode.SchemaValidationFailed, `fighter[${slot}] len=${f.length}`);
    const stocksGadget = asInt(f[10], 'fighter.stocksGadget');
    const extra = asInt(f[11], 'fighter.extra');
    const activeMoveRaw = (extra >> 6) & 0x3f;
    assert(
      activeMoveRaw >= MoveId.None && activeMoveRaw <= MoveId.Getup,
      ErrorCode.InvalidEnumValue,
      `Invalid activeMove: ${activeMoveRaw}`,
    );
    return {
      slot,
      x: uqPos(asInt(f[0], 'fighter.x')),
      y: uqPos(asInt(f[1], 'fighter.y')),
      vx: uqVel(asInt(f[2], 'fighter.vx')),
      vy: uqVel(asInt(f[3], 'fighter.vy')),
      state: asInt(f[4], 'fighter.state') as FighterState,
      stateFrame: asInt(f[5], 'fighter.stateFrame'),
      activeMove: activeMoveRaw as MoveId,
      flags: asInt(f[6], 'fighter.flags'),
      damage: uqDmg(asInt(f[7], 'fighter.damage')),
      guardHp: asInt(f[8], 'fighter.guardHp'),
      gilt: asInt(f[9], 'fighter.gilt'),
      stocks: (stocksGadget >> 4) & 0x0f,
      heldGadget: (stocksGadget & 0x0f) as GadgetId,
      nestaSize: (extra & 0x03) as NestaSize,
      heldGadgetAmmo: (extra >> 2) & 0x0f,
      hitstopFrames: (extra >> 12) & 0x0f,
    };
  });
  const projectiles = asArray(arr[4], 'snap.projectiles').map((raw, i) => {
    const p = asArray(raw, `proj[${i}]`);
    assert(p.length === 6, ErrorCode.SchemaValidationFailed, `proj[${i}] len=${p.length}`);
    return {
      id: asInt(p[0], 'proj.id'),
      kind: asInt(p[1], 'proj.kind') as ProjectileKind,
      x: uqPos(asInt(p[2], 'proj.x')),
      y: uqPos(asInt(p[3], 'proj.y')),
      vx: uqVel(asInt(p[4], 'proj.vx')),
      vy: uqVel(asInt(p[5], 'proj.vy')),
    };
  });
  const hasWorld = arr.length === 8;
  const chunks: SnapshotChunk[] = hasWorld
    ? asArray(arr[5], 'snap.chunks').map((raw, i) => {
        const c = asArray(raw, `chunk[${i}]`);
        assert(c.length === 7, ErrorCode.SchemaValidationFailed, `chunk[${i}] len=${c.length}`);
        const stateBits = asInt(c[6], 'chunk.state');
        return {
          index: asInt(c[0], 'chunk.index'),
          x: uqPos(asInt(c[1], 'chunk.x')),
          y: uqPos(asInt(c[2], 'chunk.y')),
          angle: uqRot(asInt(c[3], 'chunk.angle')),
          vx: uqVel(asInt(c[4], 'chunk.vx')),
          vy: uqVel(asInt(c[5], 'chunk.vy')),
          state: (stateBits & 0x07) as ChunkState,
          resting: (stateBits & 8) !== 0,
        };
      })
    : [];
  const rubble: SnapshotRubble[] = hasWorld
    ? asArray(arr[6], 'snap.rubble').map((raw, i) => {
        const r = asArray(raw, `rubble[${i}]`);
        assert(r.length === 6, ErrorCode.SchemaValidationFailed, `rubble[${i}] len=${r.length}`);
        return {
          id: asInt(r[0], 'rubble.id'),
          x: uqPos(asInt(r[1], 'rubble.x')),
          y: uqPos(asInt(r[2], 'rubble.y')),
          angle: uqRot(asInt(r[3], 'rubble.angle')),
          vx: uqVel(asInt(r[4], 'rubble.vx')),
          vy: uqVel(asInt(r[5], 'rubble.vy')),
        };
      })
    : [];
  const gadgets: SnapshotGadget[] = hasWorld
    ? asArray(arr[7], 'snap.gadgets').map((raw, i) => {
        const g = asArray(raw, `gadget[${i}]`);
        assert(g.length === 8, ErrorCode.SchemaValidationFailed, `gadget[${i}] len=${g.length}`);
        const stateAmmo = asInt(g[7], 'gadget.stateAmmo');
        return {
          id: asInt(g[0], 'gadget.id'),
          gadgetId: asInt(g[1], 'gadget.gadgetId') as GadgetId,
          x: uqPos(asInt(g[2], 'gadget.x')),
          y: uqPos(asInt(g[3], 'gadget.y')),
          angle: uqRot(asInt(g[4], 'gadget.angle')),
          vx: uqVel(asInt(g[5], 'gadget.vx')),
          vy: uqVel(asInt(g[6], 'gadget.vy')),
          state: (stateAmmo & 0x07) as WorldGadgetState,
          ammo: (stateAmmo >> 3) & 0x1f,
        };
      })
    : [];
  return { tick, lastAppliedInputTicks, fighters, projectiles, chunks, rubble, gadgets, hasWorld };
}

export function encodeReliableMessage(msg: ReliableNetMessage): Uint8Array {
  switch (msg.kind) {
    case NetMessageKind.Hello:
      return packBytes([msg.kind, msg.protocolVersion, msg.buildId, msg.name, msg.fighterId, msg.colourIndex]);
    case NetMessageKind.Bye:
      return packBytes([msg.kind, msg.reason]);
    case NetMessageKind.Roster: {
      const r = msg.roster;
      const s = r.settings;
      return packBytes([
        msg.kind,
        r.version,
        r.hostId,
        r.phase,
        r.arenaId,
        r.roundSeed,
        r.countdownTicks,
        [s.mode, s.fragile, s.stocks, s.enableTierB, s.enableTierC],
        r.slots.map((sl) => [sl.slot, sl.peerId, sl.name, sl.fighterId, sl.colourIndex, sl.team, sl.wins, sl.status]),
      ]);
    }
    case NetMessageKind.Events:
      return packBytes([msg.kind, msg.events.map((e) => [e.tick, e.kind, e.a, e.b, e.c, e.d])]);
    case NetMessageKind.Say:
      return packBytes([msg.kind, msg.slot, msg.phraseId, msg.tick]);
    case NetMessageKind.Host:
      return packBytes([
        msg.kind,
        msg.action,
        msg.fromPeerId,
        msg.targetPeerId,
        msg.directPeersReached,
        msg.benchScore,
        msg.medianRttMs,
      ]);
    case NetMessageKind.Perf:
      return packBytes([msg.kind, msg.frameTimeP95Ms, msg.qualityTier, msg.snapshotLossRate]);
    default:
      return assertNever(msg, 'encodeReliableMessage');
  }
}

export function decodeReliableMessage(bytes: Uint8Array): ReliableNetMessage {
  const arr = asArray(packr.unpack(bytes), 'reliableMsg');
  assert(arr.length >= 2, ErrorCode.SchemaValidationFailed, `reliableMsg len=${arr.length}`);
  const kind = asInt(arr[0], 'msg.kind') as Exclude<NetMessageKind, NetMessageKind.Input | NetMessageKind.Snapshot>;
  switch (kind) {
    case NetMessageKind.Hello:
      assert(arr.length === 6, ErrorCode.SchemaValidationFailed, 'Hello len');
      return {
        kind,
        protocolVersion: asInt(arr[1], 'hello.ver'),
        buildId: asStr(arr[2], 'hello.build'),
        name: asStr(arr[3], 'hello.name'),
        fighterId: asInt(arr[4], 'hello.fighter') as FighterId,
        colourIndex: asInt(arr[5], 'hello.colour'),
      };
    case NetMessageKind.Bye:
      assert(arr.length === 2, ErrorCode.SchemaValidationFailed, 'Bye len');
      return { kind, reason: asInt(arr[1], 'bye.reason') as ByeReason };
    case NetMessageKind.Roster: {
      assert(arr.length === 9, ErrorCode.SchemaValidationFailed, 'Roster len');
      const setArr = asArray(arr[7], 'roster.settings');
      assert(setArr.length === 5, ErrorCode.SchemaValidationFailed, 'roster.settings len');
      const slots = asArray(arr[8], 'roster.slots').map((raw, i) => {
        const s = asArray(raw, `slot[${i}]`);
        assert(s.length === 8, ErrorCode.SchemaValidationFailed, `slot[${i}] len`);
        return {
          slot: asInt(s[0], 'slot.idx'),
          peerId: asStr(s[1], 'slot.peerId'),
          name: asStr(s[2], 'slot.name'),
          fighterId: asInt(s[3], 'slot.fighter') as FighterId,
          colourIndex: asInt(s[4], 'slot.colour'),
          team: asInt(s[5], 'slot.team') as TeamId,
          wins: asInt(s[6], 'slot.wins'),
          status: asInt(s[7], 'slot.status') as SlotStatus,
        };
      });
      return {
        kind,
        roster: {
          version: asInt(arr[1], 'roster.ver'),
          hostId: asStr(arr[2], 'roster.hostId'),
          phase: asInt(arr[3], 'roster.phase') as RoomPhase,
          arenaId: asInt(arr[4], 'roster.arenaId') as ArenaId,
          roundSeed: asInt(arr[5], 'roster.roundSeed'),
          countdownTicks: asInt(arr[6], 'roster.countdownTicks'),
          settings: {
            mode: asInt(setArr[0], 'set.mode') as MatchMode,
            fragile: asBool(setArr[1], 'set.fragile'),
            stocks: asInt(setArr[2], 'set.stocks'),
            enableTierB: asBool(setArr[3], 'set.tierB'),
            enableTierC: asBool(setArr[4], 'set.tierC'),
          },
          slots,
        },
      };
    }
    case NetMessageKind.Events: {
      assert(arr.length === 2, ErrorCode.SchemaValidationFailed, 'Events len');
      const events = asArray(arr[1], 'events').map((raw, i) => {
        const e = asArray(raw, `ev[${i}]`);
        assert(e.length === 6, ErrorCode.SchemaValidationFailed, `ev[${i}] len`);
        return {
          tick: asInt(e[0], 'ev.tick'),
          kind: asInt(e[1], 'ev.kind') as SimEventKind,
          a: asInt(e[2], 'ev.a'),
          b: asInt(e[3], 'ev.b'),
          c: asInt(e[4], 'ev.c'),
          d: asInt(e[5], 'ev.d'),
        };
      });
      return { kind, events };
    }
    case NetMessageKind.Say:
      assert(arr.length === 4, ErrorCode.SchemaValidationFailed, 'Say len');
      return {
        kind,
        slot: asInt(arr[1], 'say.slot'),
        phraseId: asInt(arr[2], 'say.phrase') as QuickPhraseId,
        tick: asInt(arr[3], 'say.tick'),
      };
    case NetMessageKind.Host:
      assert(arr.length === 7, ErrorCode.SchemaValidationFailed, 'Host len');
      return {
        kind,
        action: asInt(arr[1], 'host.action') as HostAction,
        fromPeerId: asStr(arr[2], 'host.from'),
        targetPeerId: asStr(arr[3], 'host.target'),
        directPeersReached: asInt(arr[4], 'host.reached'),
        benchScore: asInt(arr[5], 'host.bench'),
        medianRttMs: asInt(arr[6], 'host.rtt'),
      };
    case NetMessageKind.Perf:
      assert(arr.length === 4, ErrorCode.SchemaValidationFailed, 'Perf len');
      return {
        kind,
        frameTimeP95Ms: assertFinite(Number(arr[1]), 'perf.p95'),
        qualityTier: asInt(arr[2], 'perf.tier'),
        snapshotLossRate: assertFinite(Number(arr[3]), 'perf.loss'),
      };
    default:
      return assertNever(kind, 'decodeReliableMessage');
  }
}

export interface BandwidthReport {
  readonly downBytesPerSec: number;
  readonly upBytesPerSec: number;
  readonly packetsDown: number;
  readonly packetsUp: number;
  readonly payloadDownBytesPerSec: number;
  readonly payloadUpBytesPerSec: number;
}

interface Sample {
  readonly timeMs: number;
  readonly bytes: number;
}

export class BandwidthCounter {
  private readonly windowMs: number;
  private readonly down: Sample[] = [];
  private readonly up: Sample[] = [];
  private nowMs = 0;
  private totalPacketsDown = 0;
  private totalPacketsUp = 0;

  public constructor(windowMs = 2000) {
    assert(windowMs > 0, ErrorCode.InvariantViolation, 'windowMs must be > 0');
    this.windowMs = windowMs;
  }

  public recordDown(payloadBytes: number, timeMs: number): void {
    this.nowMs = Math.max(this.nowMs, timeMs);
    this.totalPacketsDown += 1;
    this.down.push({ timeMs, bytes: payloadBytes });
    this.prune(this.nowMs);
  }

  public recordUp(payloadBytes: number, timeMs: number): void {
    this.nowMs = Math.max(this.nowMs, timeMs);
    this.totalPacketsUp += 1;
    this.up.push({ timeMs, bytes: payloadBytes });
    this.prune(this.nowMs);
  }

  public advanceTo(timeMs: number): void {
    this.nowMs = Math.max(this.nowMs, timeMs);
    this.prune(this.nowMs);
  }

  public report(): BandwidthReport {
    this.prune(this.nowMs);
    const sec = this.windowMs / 1000;
    let payloadDown = 0;
    for (const s of this.down) payloadDown += s.bytes;
    let payloadUp = 0;
    for (const s of this.up) payloadUp += s.bytes;
    return {
      downBytesPerSec: (payloadDown + this.down.length * PACKET_OVERHEAD_BYTES) / sec,
      upBytesPerSec: (payloadUp + this.up.length * PACKET_OVERHEAD_BYTES) / sec,
      packetsDown: this.totalPacketsDown,
      packetsUp: this.totalPacketsUp,
      payloadDownBytesPerSec: payloadDown / sec,
      payloadUpBytesPerSec: payloadUp / sec,
    };
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.down.length > 0 && (this.down[0] as Sample).timeMs < cutoff) this.down.shift();
    while (this.up.length > 0 && (this.up[0] as Sample).timeMs < cutoff) this.up.shift();
  }
}
