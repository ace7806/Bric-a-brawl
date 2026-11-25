import { describe, expect, it } from 'vitest';
import {
  BandwidthCounter,
  decodeInputPacket,
  decodeReliableMessage,
  decodeSnapshot,
  encodeInputPacket,
  encodeReliableMessage,
  encodeSnapshot,
  peekUnreliableKind,
  qDmg,
  qPos,
  qRot,
  qVel,
  uqDmg,
  uqPos,
  uqRot,
  uqVel,
  type InputPacket,
  type ReliableNetMessage,
  type SnapshotData,
} from '@net/codec';
import {
  CLIENT_DOWN_BUDGET_BPS,
  CLIENT_UP_BUDGET_BPS,
  HOST_UP_BUDGET_BPS,
  PACKET_OVERHEAD_BYTES,
  PROTOCOL_VERSION,
} from '@net/config';
import {
  ByeReason,
  ChannelKind,
  ConnectionState,
  HostAction,
  NetMessageKind,
  NetsimProfileId,
  QuickPhraseId,
  RoomPhase,
  SlotStatus,
} from '@net/enums';
import { RoomSession, selectEmergencyHost } from '@net/session';
import { LoopbackNetwork } from '@net/transport/loopback';
import {
  ArenaId,
  ChunkState,
  FighterFlag,
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
} from '@sim/enums';
import { assertWithinBand } from '../support/asserts';

function buildSnapshot(
  fighterCount: number,
  projCount: number,
  chunkCount: number,
  rubbleCount: number,
  gadgetCount: number,
  hasWorld: boolean,
): SnapshotData {
  return {
    tick: 1234,
    lastAppliedInputTicks: Array.from({ length: fighterCount }, (_, i) => 1230 - i),
    fighters: Array.from({ length: fighterCount }, (_, slot) => ({
      slot,
      x: uqPos(qPos(-6.5 + slot * 1.8)),
      y: uqPos(qPos(1.25)),
      vx: uqVel(qVel(3.5 - slot * 0.5)),
      vy: uqVel(qVel(-1.25)),
      state: FighterState.Attack,
      stateFrame: 7,
      activeMove: MoveId.Sspec,
      flags: FighterFlag.FacingRight | FighterFlag.Grounded,
      damage: uqDmg(qDmg(42.3 + slot)),
      guardHp: 45,
      gilt: 35,
      stocks: 3,
      heldGadget: GadgetId.Bellows,
      heldGadgetAmmo: 4,
      nestaSize: NestaSize.Mid,
      hitstopFrames: 6,
    })),
    projectiles: Array.from({ length: projCount }, (_, i) => ({
      id: 10 + i,
      kind: ProjectileKind.SteamPuff,
      x: uqPos(qPos(-2 + i * 0.5)),
      y: uqPos(qPos(2.0)),
      vx: uqVel(qVel(7.0)),
      vy: uqVel(qVel(0.5)),
    })),
    chunks: hasWorld
      ? Array.from({ length: chunkCount }, (_, i) => ({
          index: i,
          x: uqPos(qPos(-5 + i * 2)),
          y: uqPos(qPos(-1.5)),
          angle: uqRot(qRot(0.35)),
          vx: uqVel(qVel(0.25)),
          vy: uqVel(qVel(-4.5)),
          state: ChunkState.Falling,
          resting: false,
        }))
      : [],
    rubble: hasWorld
      ? Array.from({ length: rubbleCount }, (_, i) => ({
          id: 20 + i,
          x: uqPos(qPos(-4 + i * 0.5)),
          y: uqPos(qPos(0.5)),
          angle: uqRot(qRot(1.1)),
          vx: uqVel(qVel(2.0)),
          vy: uqVel(qVel(-2.0)),
        }))
      : [],
    gadgets: hasWorld
      ? Array.from({ length: gadgetCount }, (_, i) => ({
          id: 30 + i,
          gadgetId: GadgetId.Cork,
          x: uqPos(qPos(-3 + i)),
          y: uqPos(qPos(0.25)),
          angle: uqRot(qRot(0.0)),
          vx: uqVel(qVel(0)),
          vy: uqVel(qVel(0)),
          state: WorldGadgetState.Grounded,
          ammo: 1,
        }))
      : [],
    hasWorld,
  };
}

describe('net codec quantisation, byte budgets, round-trips & RoomSession', () => {
  it('enforces quantisation precision (1/64 u pos, 1/8 u/s vel, 1/256 turn rot, 0.1% dmg)', () => {
    expect(Math.abs(uqPos(qPos(3.14159)) - 3.14159)).toBeLessThanOrEqual(1 / 128 + 1e-9);
    expect(Math.abs(uqVel(qVel(-17.63)) - -17.63)).toBeLessThanOrEqual(1 / 16 + 1e-9);
    expect(Math.abs(uqRot(qRot(1.2345)) - 1.2345)).toBeLessThanOrEqual(Math.PI / 256 + 1e-9);
    expect(uqDmg(qDmg(87.4))).toBeCloseTo(87.4, 6);
    expect(uqRot(qRot(2 * Math.PI))).toBeCloseTo(0, 6);
  });

  it('meets MASTER_DESIGN 7.3.4 & 7.3.7 msgpackr byte sizes and bandwidth budgets', () => {
    const inputBytes = encodeInputPacket({ tick: 500, masks: [0x0143, 0x0043, 0x0003, 0x0000], lastSnapshotTick: 498 });
    expect(inputBytes.byteLength).toBeLessThanOrEqual(20);

    const fightersOnly = encodeSnapshot(buildSnapshot(8, 4, 0, 0, 0, false), false);
    const typicalWorld = encodeSnapshot(buildSnapshot(8, 4, 2, 6, 3, true), true);
    const worstWorld = encodeSnapshot(buildSnapshot(8, 12, 6, 16, 8, true), true);

    expect(fightersOnly.byteLength).toBeLessThanOrEqual(280);
    expect(typicalWorld.byteLength).toBeLessThanOrEqual(440);
    expect(worstWorld.byteLength).toBeLessThanOrEqual(800);

    // Bandwidth check over 2s window: 30 Hz snapshots (15 fighters-only + 15 world), 60 Hz inputs, 7 clients for host
    const clientBw = new BandwidthCounter(2000);
    const hostBw = new BandwidthCounter(2000);
    for (let tick = 0; tick < 120; tick++) {
      const tMs = (tick * 1000) / 60;
      clientBw.recordUp(inputBytes.byteLength, tMs);
      if (tick % 2 === 0) {
        const snapLen = tick % 4 === 0 ? worstWorld.byteLength : fightersOnly.byteLength;
        clientBw.recordDown(snapLen, tMs);
        for (let c = 0; c < 7; c++) hostBw.recordUp(snapLen, tMs);
      }
    }
    const cRep = clientBw.report();
    const hRep = hostBw.report();
    assertWithinBand(cRep.downBytesPerSec, 1, CLIENT_DOWN_BUDGET_BPS, 'client worst-case down B/s');
    assertWithinBand(cRep.upBytesPerSec, 1, CLIENT_UP_BUDGET_BPS, 'client up B/s');
    assertWithinBand(hRep.upBytesPerSec, 1, HOST_UP_BUDGET_BPS, 'host 7-client worst-case up B/s');
    expect(PACKET_OVERHEAD_BYTES).toBe(85);
  });

  it('round-trips InputPacket, SnapshotData (with & without world), and all ReliableNetMessage kinds with zero mismatch', () => {
    const pkt: InputPacket = { tick: 999, masks: [0x1204, 0x0043, 0x0003, 0], lastSnapshotTick: 995 };
    const pktBytes = encodeInputPacket(pkt);
    expect(peekUnreliableKind(pktBytes)).toBe(NetMessageKind.Input);
    expect(decodeInputPacket(pktBytes)).toEqual(pkt);

    for (const hasWorld of [false, true]) {
      const snap = buildSnapshot(4, 2, 2, 3, 2, hasWorld);
      const bytes = encodeSnapshot(snap, hasWorld);
      expect(peekUnreliableKind(bytes)).toBe(NetMessageKind.Snapshot);
      const decoded = decodeSnapshot(bytes);
      expect(decoded).toEqual(snap);
      expect(decoded.fighters[0]?.activeMove).toBe(MoveId.Sspec);
    }

    const messages: ReliableNetMessage[] = [
      { kind: NetMessageKind.Hello, protocolVersion: PROTOCOL_VERSION, buildId: '0.1.0', name: 'Earl', fighterId: FighterId.Earl, colourIndex: 0 },
      { kind: NetMessageKind.Bye, reason: ByeReason.VersionMismatch },
      {
        kind: NetMessageKind.Roster,
        roster: {
          version: 3,
          hostId: 'p0',
          phase: RoomPhase.Round,
          arenaId: ArenaId.Willow,
          roundSeed: 42,
          countdownTicks: 0,
          settings: { mode: MatchMode.Teams, fragile: true, stocks: 3, enableTierB: true, enableTierC: false },
          slots: [
            { slot: 0, peerId: 'p0', name: 'A', fighterId: FighterId.Earl, colourIndex: 0, team: TeamId.Cobalt, wins: 2, status: SlotStatus.Ready },
          ],
        },
      },
      { kind: NetMessageKind.Events, events: [{ tick: 55, kind: SimEventKind.Ko, a: 1, b: 0, c: 0, d: 0 }] },
      { kind: NetMessageKind.Say, slot: 0, phraseId: QuickPhraseId.Sold, tick: 60 },
      { kind: NetMessageKind.Host, action: HostAction.Offer, fromPeerId: 'p0', targetPeerId: 'p1', directPeersReached: 3, benchScore: 950, medianRttMs: 24 },
      { kind: NetMessageKind.Perf, frameTimeP95Ms: 8.5, qualityTier: 1, snapshotLossRate: 0.01 },
    ];
    for (const msg of messages) {
      expect(decodeReliableMessage(encodeReliableMessage(msg))).toEqual(msg);
    }
  });

  it('rejects mismatched PROTOCOL_VERSION with ByeReason.VersionMismatch -> ConnectionState.VersionMismatch (M5.5)', () => {
    const net = new LoopbackNetwork(NetsimProfileId.Lan, 1);
    const tHost = net.createPeer('host');
    const tClient = net.createPeer('client');
    const host = new RoomSession(tHost, true, { name: 'Host', fighterId: FighterId.Earl, colourIndex: 0 });
    const client = new RoomSession(tClient, false, { name: 'Bad', fighterId: FighterId.Moss, colourIndex: 1 });

    tClient.send(
      'host',
      ChannelKind.Reliable,
      encodeReliableMessage({
        kind: NetMessageKind.Hello,
        protocolVersion: PROTOCOL_VERSION + 99,
        buildId: '0.1.0',
        name: 'Bad',
        fighterId: FighterId.Moss,
        colourIndex: 1,
      }),
    );
    net.advanceMs(50);

    expect(host.state).toBe(ConnectionState.VersionMismatch);
    expect(client.state).toBe(ConnectionState.VersionMismatch);
    expect(client.byeReason).toBe(ByeReason.VersionMismatch);
    host.destroy();
    client.destroy();
  });

  it('assigns late joiners SlotStatus.Spectating during an active round and promotes them in Lobby', () => {
    const net = new LoopbackNetwork(NetsimProfileId.Lan, 2);
    const tHost = net.createPeer('host');
    const host = new RoomSession(tHost, true, { name: 'Host', fighterId: FighterId.Earl, colourIndex: 0 });
    host.setPhase(RoomPhase.Round, 7, ArenaId.HighTea);

    const tLate = net.createPeer('late');
    const late = new RoomSession(tLate, false, { name: 'Late', fighterId: FighterId.Grog, colourIndex: 2 });
    net.advanceMs(50);

    const lateSlot = host.roster.slots.find((s) => s.peerId === 'late');
    expect(lateSlot?.status).toBe(SlotStatus.Spectating);
    expect(lateSlot?.slot).toBeGreaterThanOrEqual(8);

    host.setPhase(RoomPhase.Lobby);
    net.advanceMs(50);
    expect(late.roster.slots.find((s) => s.peerId === 'late')?.status).toBe(SlotStatus.Connected);
    host.destroy();
    late.destroy();
  });

  it('preserves scores and elects lowest-slot peer reaching all remaining peers to RoomPhase.Lobby on host disconnect (N10)', () => {
    const net = new LoopbackNetwork(NetsimProfileId.Lan, 3);
    const tHost = net.createPeer('p0');
    const tP1 = net.createPeer('p1');
    const tP2 = net.createPeer('p2');
    const host = new RoomSession(tHost, true, { name: 'P0', fighterId: FighterId.Earl, colourIndex: 0 });
    const s1 = new RoomSession(tP1, false, { name: 'P1', fighterId: FighterId.Grog, colourIndex: 1 });
    const s2 = new RoomSession(tP2, false, { name: 'P2', fighterId: FighterId.Nesta, colourIndex: 2 });
    net.advanceMs(50);

    host.awardWin(1);
    host.awardWin(2);
    host.setPhase(RoomPhase.Round);
    net.advanceMs(50);

    // Pure selector test: slot 1 missing p2, so slot 2 (lowest slot reaching all) wins
    const chosen = selectEmergencyHost(
      host.roster.slots,
      new Map([
        ['p1', new Set(['p1'])],
        ['p2', new Set(['p1', 'p2'])],
      ]),
      'p0',
    );
    expect(chosen?.peerId).toBe('p2');

    // Live disconnect of host p0 -> p1 (slot 1, reaches all) takes over & preserves wins
    net.disconnectPeer('p0');
    net.advanceMs(50);

    expect(s1.isHost).toBe(true);
    expect(s2.roster.hostId).toBe('p1');
    expect(s1.roster.phase).toBe(RoomPhase.Lobby);
    expect(s2.roster.phase).toBe(RoomPhase.Lobby);
    expect(s2.roster.slots.find((s) => s.peerId === 'p1')?.wins).toBe(1);
    expect(s2.roster.slots.find((s) => s.peerId === 'p2')?.wins).toBe(1);
    s1.destroy();
    s2.destroy();
  });
});
