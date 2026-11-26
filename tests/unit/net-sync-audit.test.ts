import { beforeAll, describe, expect, it } from 'vitest';
import { HostSimulation } from '@host/engine';
import {
  decodeInputPacket,
  decodeSnapshot,
  encodeInputPacket,
  encodeSnapshot,
  qDmg,
  qPos,
  qVel,
  uqDmg,
  uqPos,
  uqVel,
  type InputPacket,
  type SnapshotData,
  type SnapshotFighter,
} from '@net/codec';
import { ChannelKind, NetsimProfileId, RoomPhase } from '@net/enums';
import { ClientPredictor } from '@net/predictor';
import { RoomSession } from '@net/session';
import { HostClockEstimator, InputJitterBuffer, RemoteInterpolator } from '@net/sync';
import { LoopbackNetwork } from '@net/transport/loopback';
import {
  ArenaId,
  FighterFlag,
  FighterId,
  FighterState,
  GadgetId,
  InputDir,
  MatchMode,
  MoveId,
  NestaSize,
  TeamId,
} from '@sim/enums';
import { encodeInputMask } from '@sim/input';
import { initPhysics } from '@sim/world';

function makeFighter(slot: number, x: number, y = 0): SnapshotFighter {
  return {
    slot,
    x: uqPos(qPos(x)),
    y: uqPos(qPos(y)),
    vx: uqVel(qVel(0)),
    vy: uqVel(qVel(0)),
    state: FighterState.Idle,
    stateFrame: 0,
    activeMove: MoveId.None,
    flags: FighterFlag.FacingRight | FighterFlag.Grounded,
    damage: uqDmg(qDmg(0)),
    guardHp: 50,
    gilt: 0,
    stocks: 3,
    heldGadget: GadgetId.None,
    heldGadgetAmmo: 0,
    nestaSize: NestaSize.Mid,
    hitstopFrames: 0,
  };
}

function makeSnap(tick: number, fighters: readonly SnapshotFighter[], lastApplied: readonly number[] = [], epoch = 0): SnapshotData {
  return {
    tick,
    epoch,
    lastAppliedInputTicks: lastApplied.length > 0 ? lastApplied : [-1, -1, -1, -1, -1, -1, -1, -1],
    fighters,
    projectiles: [],
    chunks: [],
    rubble: [],
    gadgets: [],
    hasWorld: false,
  };
}

describe('Netcode audit — TDD regression suite', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('Bug #1: encodeSnapshot/decodeSnapshot preserves sparse non-contiguous fighter slots [0, 2, 5]', () => {
    const snap = makeSnap(42, [makeFighter(0, -3.5), makeFighter(2, 1.25), makeFighter(5, 4.75)], [42, -1, 40, -1, -1, 39], 3);
    const bytes = encodeSnapshot(snap, false);
    const decoded = decodeSnapshot(bytes);

    expect(decoded.epoch).toBe(3);
    expect(decoded.fighters.map((f) => f.slot)).toEqual([0, 2, 5]);
    expect(decoded.fighters.find((f) => f.slot === 2)?.x).toBeCloseTo(1.25, 4);
    expect(decoded.fighters.find((f) => f.slot === 5)?.x).toBeCloseTo(4.75, 4);
  });

  it('Bug #2A: stale high-tick snapshot from previous match epoch must not freeze RemoteInterpolator or HostClockEstimator', () => {
    const interp = new RemoteInterpolator();
    const clock = new HostClockEstimator();

    const staleOldEpoch = decodeSnapshot(encodeSnapshot(makeSnap(1800, [makeFighter(0, -5)], [1800], 1), false));
    const newEpochSnap1 = decodeSnapshot(encodeSnapshot(makeSnap(2, [makeFighter(0, -1), makeFighter(1, 2)], [2, 0], 2), false));
    const newEpochSnap2 = decodeSnapshot(encodeSnapshot(makeSnap(4, [makeFighter(0, 1), makeFighter(1, 2)], [4, 2], 2), false));
    const newEpochSnap3 = decodeSnapshot(encodeSnapshot(makeSnap(6, [makeFighter(0, 3), makeFighter(1, 2)], [6, 4], 2), false));

    expect(staleOldEpoch.epoch).toBe(1);
    expect(newEpochSnap1.epoch).toBe(2);

    const expectedEpoch = 2;
    const feed = (s: SnapshotData, tMs: number) => {
      if (s.epoch !== expectedEpoch) return;
      clock.onSnapshot(s.tick, tMs);
      interp.pushSnapshot(s, tMs);
    };

    feed(staleOldEpoch, 1000);
    feed(newEpochSnap1, 1033);
    feed(newEpochSnap2, 1066);
    feed(newEpochSnap3, 1100);

    const sampled = interp.sample(1180, clock.estimateHostTick(1180));
    expect(sampled.tick).toBe(6);
    expect(sampled.fighters.find((f) => f.slot === 0)?.x).toBeCloseTo(3, 1);
    expect(sampled.fighters.find((f) => f.slot === 1)?.x).toBeCloseTo(2, 1);
  });

  it('Bug #2B: stale high-tick InputPacket from previous match epoch must not freeze remote fighter on HostSimulation', () => {
    const host = new HostSimulation({
      match: {
        arenaId: ArenaId.Saucer,
        mode: MatchMode.Practice,
        fragile: false,
        seed: 11,
        fighters: [
          { slot: 0, id: FighterId.Earl, team: TeamId.None },
          { slot: 1, id: FighterId.Grog, team: TeamId.None },
        ],
      },
      localSlot: 0,
      bots: {},
      matchEpoch: 2,
    });

    try {
      const startX = host.world.fighters.find((f) => f.slot === 1)!.x;
      const stalePktBytes = encodeInputPacket({
        tick: 1800,
        masks: [0, 0, 0, 0],
        lastSnapshotTick: 1798,
        epoch: 1,
      });
      const stalePkt = decodeInputPacket(stalePktBytes);
      expect(stalePkt.epoch).toBe(1);
      host.ingestClientInput(1, stalePkt);

      const moveRight = encodeInputMask(InputDir.Right, 0);
      for (let t = 0; t < 60; t++) {
        const pktBytes = encodeInputPacket({
          tick: t,
          masks: [moveRight, t >= 1 ? moveRight : 0, t >= 2 ? moveRight : 0, t >= 3 ? moveRight : 0],
          lastSnapshotTick: Math.max(0, t - 2),
          epoch: 2,
        });
        host.ingestClientInput(1, decodeInputPacket(pktBytes));
        host.stepTick();
      }

      const endX = host.world.fighters.find((f) => f.slot === 1)!.x;
      expect(endX - startX).toBeGreaterThan(2.0);
      expect(host.jitter.getLastAppliedTicks(2)[1]).toBeGreaterThanOrEqual(50);
    } finally {
      host.dispose();
    }
  });

  it('Bug #6B: InputJitterBuffer unwraps fresh client ticks (0, 1, 2...) accurately even when hostTick > 35,000', () => {
    const buf = new InputJitterBuffer();
    const moveRight = encodeInputMask(InputDir.Right, 0);
    const highHostTick = 40_000;

    for (let clientTick = 0; clientTick < 10; clientTick++) {
      const pkt: InputPacket = {
        tick: clientTick & 0xffff,
        masks: [moveRight, clientTick >= 1 ? moveRight : 0, clientTick >= 2 ? moveRight : 0, clientTick >= 3 ? moveRight : 0],
        lastSnapshotTick: (highHostTick + clientTick - 2) & 0xffff,
        epoch: 1,
      };
      buf.ingestPacket(1, pkt, highHostTick + clientTick);
      buf.popInputForTick(1, highHostTick + clientTick);
    }

    const lastApplied = buf.getLastAppliedTicks(2)[1]!;
    expect(lastApplied).toBeGreaterThanOrEqual(5);
    expect(lastApplied).toBeLessThan(20);
  });

  it('Bug #4: remote client updating fighter/colour via RoomSession.updateProfile syncs to Host and back and bumps matchEpoch', () => {
    const net = new LoopbackNetwork(NetsimProfileId.Lan, 42);
    const tHost = net.createPeer('host');
    const tClient = net.createPeer('friend');

    const host = new RoomSession(tHost, true, { name: 'Host', fighterId: FighterId.Earl, colourIndex: 0 });
    // Join with colliding colourIndex: 0 -> Host auto-assigns distinct colourIndex: 1
    const client = new RoomSession(tClient, false, { name: 'Friend', fighterId: FighterId.Grog, colourIndex: 0 });
    net.advanceMs(50);

    const epochBefore = host.roster.matchEpoch;
    expect(host.roster.slots.find((s) => s.peerId === 'friend')?.fighterId).toBe(FighterId.Grog);
    expect(host.roster.slots.find((s) => s.peerId === 'friend')?.colourIndex).toBe(1);
    expect(client.roster.slots.find((s) => s.peerId === 'friend')?.colourIndex).toBe(1);

    client.updateProfile({ fighterId: FighterId.Nesta });
    net.advanceMs(50);
    // Preserves host-assigned distinct colourIndex (1) when switching fighter only
    expect(host.roster.slots.find((s) => s.peerId === 'friend')?.fighterId).toBe(FighterId.Nesta);
    expect(host.roster.slots.find((s) => s.peerId === 'friend')?.colourIndex).toBe(1);
    expect(host.roster.matchEpoch).toBeGreaterThan(epochBefore);

    client.updateProfile({ colourIndex: 4 });
    net.advanceMs(50);

    expect(host.roster.slots.find((s) => s.peerId === 'friend')?.colourIndex).toBe(4);
    expect(client.roster.slots.find((s) => s.peerId === 'friend')?.fighterId).toBe(FighterId.Nesta);
    expect(client.roster.slots.find((s) => s.peerId === 'friend')?.colourIndex).toBe(4);
    expect(client.roster.matchEpoch).toBe(host.roster.matchEpoch);

    host.destroy();
    client.destroy();
  });

  it('Bug #7: HostSimulation safely ignores InputPackets from spectator or non-active slots without throwing', () => {
    const host = new HostSimulation({
      match: {
        arenaId: ArenaId.Willow,
        mode: MatchMode.FreeForAll,
        fragile: false,
        seed: 7,
        fighters: [
          { slot: 0, id: FighterId.Earl, team: TeamId.None },
          { slot: 1, id: FighterId.Grog, team: TeamId.None },
        ],
      },
      localSlot: 0,
      bots: {},
      matchEpoch: 1,
    });

    try {
      const pkt: InputPacket = { tick: 1, masks: [0, 0, 0, 0], lastSnapshotTick: 0, epoch: 1 };
      expect(() => host.ingestClientInput(8, pkt)).not.toThrow();
      expect(() => host.ingestClientInput(3, pkt)).not.toThrow();
      expect(() => host.stepTick()).not.toThrow();
    } finally {
      host.dispose();
    }
  });

  it('Bug #8: encodeSnapshot returns isolated ArrayBuffers so transferring one snapshot never aliases or corrupts another', () => {
    const s1 = makeSnap(10, [makeFighter(0, -2.5)], [], 1);
    const s2 = makeSnap(12, [makeFighter(0, 3.75)], [], 1);
    const b1 = encodeSnapshot(s1, false);
    const b2 = encodeSnapshot(s2, false);

    expect(b1.buffer).not.toBe(b2.buffer);
    expect(decodeSnapshot(b1).tick).toBe(10);
    expect(decodeSnapshot(b2).tick).toBe(12);
  });

  it('End-to-end WiFi Lobby->FriendJoin->StartRound sync: neither Host nor Friend freezes across epoch transitions', () => {
    const net = new LoopbackNetwork(NetsimProfileId.Wifi, 123);
    const tHost = net.createPeer('host');
    const hostSession = new RoomSession(tHost, true, { name: 'Host', fighterId: FighterId.Earl, colourIndex: 0 });

    let hostSim = new HostSimulation({
      match: {
        arenaId: ArenaId.Saucer,
        mode: MatchMode.Practice,
        fragile: false,
        seed: 1,
        fighters: [{ slot: 0, id: FighterId.Earl, team: TeamId.None }],
      },
      localSlot: 0,
      bots: {},
      matchEpoch: hostSession.roster.matchEpoch,
    });

    const moveRight = encodeInputMask(InputDir.Right, 0);
    const moveLeft = encodeInputMask(InputDir.Left, 0);
    for (let t = 0; t < 180; t++) {
      hostSim.setLocalInput(0, t % 60 < 30 ? moveRight : moveLeft);
      hostSim.stepTick();
      net.advanceMs(1000 / 60);
    }

    const tFriend = net.createPeer('friend');
    const friendState: {
      epoch: number;
      clock: HostClockEstimator;
      interp: RemoteInterpolator;
      predictor: ClientPredictor | null;
      inputTick: number;
    } = {
      epoch: 0,
      clock: new HostClockEstimator(),
      interp: new RemoteInterpolator(),
      predictor: null,
      inputTick: 0,
    };

    const resetFriendForRoster = (roster: typeof hostSession.roster) => {
      if (roster.matchEpoch === friendState.epoch && friendState.predictor !== null) return;
      friendState.epoch = roster.matchEpoch;
      friendState.clock = new HostClockEstimator();
      friendState.interp = new RemoteInterpolator();
      friendState.predictor?.dispose();
      friendState.predictor = null;
      friendState.inputTick = 0;
      const arenaId = roster.phase === RoomPhase.Round ? roster.arenaId : ArenaId.Saucer;
      const selfEntry = roster.slots.find((s) => s.peerId === 'friend');
      if (selfEntry) {
        friendState.predictor = new ClientPredictor(
          {
            arenaId,
            mode: roster.phase === RoomPhase.Round ? roster.settings.mode : MatchMode.Practice,
            fragile: roster.settings.fragile,
            seed: roster.roundSeed,
            fighters: roster.slots.map((s) => ({ slot: s.slot, id: s.fighterId, team: s.team })),
          },
          selfEntry.slot,
          roster.matchEpoch,
        );
      }
    };

    const friendSession = new RoomSession(
      tFriend,
      false,
      { name: 'Friend', fighterId: FighterId.Grog, colourIndex: 1 },
      { onRosterChange: (r) => resetFriendForRoster(r) },
    );

    tFriend.onPacket((_from, ch, payload) => {
      if (ch !== ChannelKind.Unreliable) return;
      const snap = decodeSnapshot(payload);
      if (snap.epoch !== (friendState.epoch & 0xffff)) return;
      const oneWay = friendState.predictor ? friendState.predictor.observeAckOneWayMs(snap, net.nowMs) : 0;
      friendState.clock.onSnapshot(snap.tick, net.nowMs, oneWay);
      friendState.interp.pushSnapshot(snap, net.nowMs);
      friendState.interp.setInterpDelayMs(friendState.clock.getInterpDelayMs());
      friendState.predictor?.reconcileSnapshot(snap);
    });

    tHost.onPacket((fromId, ch, payload) => {
      if (ch !== ChannelKind.Unreliable) return;
      const slot = hostSession.roster.slots.find((s) => s.peerId === fromId)?.slot;
      if (slot !== undefined && slot !== 0) {
        hostSim.ingestClientInput(slot, decodeInputPacket(payload));
      }
    });

    // Emit stale old-epoch snapshots right as Friend connects (simulating async worker race)
    for (let i = 0; i < 6; i++) {
      const out = hostSim.stepTick();
      if (out.snapshotBytes) tHost.broadcast(ChannelKind.Unreliable, out.snapshotBytes);
      net.advanceMs(1000 / 60);
    }

    net.advanceMs(150);
    expect(hostSession.roster.slots.length).toBe(2);

    // Host restarts Saucer matching the roster's bumped matchEpoch
    hostSim.dispose();
    hostSim = new HostSimulation({
      match: {
        arenaId: ArenaId.Saucer,
        mode: MatchMode.Practice,
        fragile: false,
        seed: hostSession.roster.roundSeed,
        fighters: hostSession.roster.slots.map((s) => ({ slot: s.slot, id: s.fighterId, team: s.team })),
      },
      localSlot: 0,
      bots: {},
      matchEpoch: hostSession.roster.matchEpoch,
    });

    const hostStartX = hostSim.world.fighters.find((f) => f.slot === 0)!.x;
    const friendStartXOnHost = hostSim.world.fighters.find((f) => f.slot === 1)!.x;

    // Move for 75 ticks, then settle for 20 ticks so RemoteInterpolator catches up past interpDelayMs
    for (let t = 0; t < 95; t++) {
      const moving = t < 75;
      hostSim.setLocalInput(0, moving ? moveRight : 0);
      const out = hostSim.stepTick();
      if (out.snapshotBytes) tHost.broadcast(ChannelKind.Unreliable, out.snapshotBytes);

      if (friendState.predictor) {
        const pkt = friendState.predictor.predictTick(friendState.inputTick++, moving ? moveLeft : 0, net.nowMs);
        tFriend.send('host', ChannelKind.Unreliable, encodeInputPacket(pkt));
      }
      net.advanceMs(1000 / 60);
    }

    const hostActualX = hostSim.world.fighters.find((f) => f.slot === 0)!.x;
    const friendActualX = hostSim.world.fighters.find((f) => f.slot === 1)!.x;
    const sampledOnFriend = friendState.interp.sample(net.nowMs, friendState.clock.estimateHostTick(net.nowMs));
    const hostSeenByFriend = sampledOnFriend.fighters.find((f) => f.slot === 0);

    expect(hostActualX - hostStartX).toBeGreaterThan(2.0);
    expect(friendStartXOnHost - friendActualX).toBeGreaterThan(2.0);
    expect(hostSeenByFriend).toBeDefined();
    expect(Math.abs(hostSeenByFriend!.x - hostActualX)).toBeLessThan(0.35);

    // Transition to Round while Lobby snapshots & inputs are STILL in flight!
    hostSim.dispose();
    hostSession.setPhase(RoomPhase.Round, 3, ArenaId.Willow);
    hostSim = new HostSimulation({
      match: {
        arenaId: ArenaId.Willow,
        mode: MatchMode.FreeForAll,
        fragile: false,
        seed: hostSession.roster.roundSeed,
        fighters: hostSession.roster.slots.map((s) => ({ slot: s.slot, id: s.fighterId, team: s.team })),
      },
      localSlot: 0,
      bots: {},
      matchEpoch: hostSession.roster.matchEpoch,
    });

    const roundHostStart = hostSim.world.fighters.find((f) => f.slot === 0)!.x;
    const roundFriendStart = hostSim.world.fighters.find((f) => f.slot === 1)!.x;

    for (let t = 0; t < 95; t++) {
      const moving = t < 75;
      hostSim.setLocalInput(0, moving ? moveRight : 0);
      const out = hostSim.stepTick();
      if (out.snapshotBytes) tHost.broadcast(ChannelKind.Unreliable, out.snapshotBytes);

      if (friendState.predictor) {
        const pkt = friendState.predictor.predictTick(friendState.inputTick++, moving ? moveLeft : 0, net.nowMs);
        tFriend.send('host', ChannelKind.Unreliable, encodeInputPacket(pkt));
      }
      net.advanceMs(1000 / 60);
    }

    const roundHostEnd = hostSim.world.fighters.find((f) => f.slot === 0)!.x;
    const roundFriendEnd = hostSim.world.fighters.find((f) => f.slot === 1)!.x;
    const roundSampled = friendState.interp.sample(net.nowMs, friendState.clock.estimateHostTick(net.nowMs));
    const roundHostSeenByFriend = roundSampled.fighters.find((f) => f.slot === 0);

    expect(roundHostEnd - roundHostStart).toBeGreaterThan(2.0);
    expect(roundFriendStart - roundFriendEnd).toBeGreaterThan(2.0);
    expect(roundHostSeenByFriend).toBeDefined();
    expect(Math.abs(roundHostSeenByFriend!.x - roundHostEnd)).toBeLessThan(0.35);

    friendState.predictor?.dispose();
    friendSession.destroy();
    hostSession.destroy();
    hostSim.dispose();
  });

  it('Sparse-slot [0, 2] full HostSimulation + ClientPredictor + RemoteInterpolator sync works end-to-end when slot 1 is vacant', () => {
    const matchConfig = {
      arenaId: ArenaId.Saucer,
      mode: MatchMode.Practice,
      fragile: false,
      seed: 19,
      fighters: [
        { slot: 0, id: FighterId.Earl, team: TeamId.None },
        { slot: 2, id: FighterId.Moss, team: TeamId.None },
      ],
    };
    const host = new HostSimulation({ match: matchConfig, localSlot: 0, bots: {}, matchEpoch: 5 });
    const pred = new ClientPredictor(matchConfig, 2, 5);
    const clock = new HostClockEstimator();
    const interp = new RemoteInterpolator();

    try {
      const moveRight = encodeInputMask(InputDir.Right, 0);
      const moveLeft = encodeInputMask(InputDir.Left, 0);
      const start0 = host.world.fighters.find((f) => f.slot === 0)!.x;
      const start2 = host.world.fighters.find((f) => f.slot === 2)!.x;

      for (let t = 0; t < 80; t++) {
        const nowMs = t * (1000 / 60);
        const moving = t < 60;
        host.setLocalInput(0, moving ? moveRight : 0);
        const pkt = pred.predictTick(t, moving ? moveLeft : 0, nowMs);
        host.ingestClientInput(2, decodeInputPacket(encodeInputPacket(pkt)));
        const out = host.stepTick();
        if (out.snapshotBytes) {
          const snap = decodeSnapshot(out.snapshotBytes);
          const oneWay = pred.observeAckOneWayMs(snap, nowMs);
          clock.onSnapshot(snap.tick, nowMs, oneWay);
          interp.pushSnapshot(snap, nowMs);
          pred.reconcileSnapshot(snap);
        }
      }

      const host0 = host.world.fighters.find((f) => f.slot === 0)!.x;
      const host2 = host.world.fighters.find((f) => f.slot === 2)!.x;
      const sampled = interp.sample(80 * (1000 / 60), clock.estimateHostTick(80 * (1000 / 60)));
      const seen0 = sampled.fighters.find((f) => f.slot === 0);
      const seen2 = sampled.fighters.find((f) => f.slot === 2);

      expect(host0 - start0).toBeGreaterThan(2.0);
      expect(start2 - host2).toBeGreaterThan(2.0);
      expect(seen0).toBeDefined();
      expect(seen2).toBeDefined();
      expect(Math.abs(seen0!.x - host0)).toBeLessThan(0.25);
      expect(Math.abs(pred.fighter.x - host2)).toBeLessThan(0.25);
      expect(host.jitter.getLastAppliedTicks(3)[2]).toBeGreaterThanOrEqual(70);
    } finally {
      pred.dispose();
      host.dispose();
    }
  });
});
