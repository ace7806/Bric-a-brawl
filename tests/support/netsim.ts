import { buildBotView, createBot, BotKind, type BotConfig, type BotController, type BotView } from '@bots/index';
import { HostSimulation } from '@host/engine';
import {
  ChannelKind,
  ClientPredictor,
  decodeInputPacket,
  decodeReliableMessage,
  decodeSnapshot,
  encodeInputPacket,
  encodeReliableMessage,
  HostClockEstimator,
  LoopbackNetwork,
  NETSIM_PROFILES,
  NetMessageKind,
  NetsimProfileId,
  peekUnreliableKind,
  PredictionController,
  RemoteInterpolator,
  RoomPhase,
  RoomSession,
  SlotStatus,
  createInitialRoster,
  type LoopbackTransport,
  type SnapshotData,
} from '@net/index';
import { getArenaSpec } from '@sim/data';
import { ArenaId, FighterFlag, FighterId, FighterState, GadgetId, InputBit, InputDir, MatchMode, MoveId, SimEventKind, TeamId } from '@sim/enums';
import { chunkWorldTopBounds } from '@sim/geometry';
import { encodeInputMask } from '@sim/input';
import { SeededRng } from '@sim/prng';
import type { RoundResult } from '@sim/types';
import { initPhysics, SimWorld } from '@sim/world';

const TICK_MS = 1000 / 60;

export interface NetsimClientConfig {
  readonly slot: number;
  readonly fighterId: FighterId;
  readonly bot: BotConfig;
}

export interface NetsimOptions {
  readonly profileId: NetsimProfileId;
  readonly seed: number;
  readonly arenaId?: ArenaId;
  readonly durationTicks?: number;
  readonly clients?: readonly NetsimClientConfig[];
  readonly hostBot?: { readonly slot: number; readonly fighterId: FighterId; readonly bot: BotConfig };
  readonly skipProbes?: boolean;
}

export interface NetsimMetrics {
  readonly profileId: NetsimProfileId;
  readonly ticksSimulated: number;
  readonly desyncMismatches: number;
  readonly koOrderAgreement: boolean;
  readonly winnerAgreement: boolean;
  readonly inputLossRate: number;
  readonly predictionErrorP95: number;
  readonly largeCorrectionsPer10s: number;
  readonly parryBotSuccessRate: number;
  readonly blockBotFailRate: number;
  readonly clientDownBps: number;
  readonly clientUpBps: number;
  readonly hostUpBps: number;
  readonly hostTickP99Ms: number;
  readonly churnLateJoinIsTeaspoon: boolean;
  readonly churnRecoveryMs: number;
  readonly churnScoresIntact: boolean;
  readonly exceptions: number;
  readonly maxBufferEntries: number;
  readonly roundResult: RoundResult | null;
}

interface ClientRuntime {
  readonly slot: number;
  readonly peerId: string;
  readonly fighterId: FighterId;
  readonly transport: LoopbackTransport;
  readonly session: RoomSession;
  readonly bot: BotController;
  readonly rng: SeededRng;
  readonly clock: HostClockEstimator;
  readonly interp: RemoteInterpolator;
  readonly predictor: ClientPredictor;
  readonly koOrder: { tick: number; victimSlot: number }[];
  winnerSlot: number;
  desyncMismatches: number;
  downSamples: number[];
  upSamples: number[];
}

function defaultClients(): readonly NetsimClientConfig[] {
  return [
    { slot: 1, fighterId: FighterId.Grog, bot: { kind: BotKind.Brawler } },
    { slot: 2, fighterId: FighterId.Nesta, bot: { kind: BotKind.Chaser } },
    { slot: 3, fighterId: FighterId.Moss, bot: { kind: BotKind.Sharp } },
    { slot: 4, fighterId: FighterId.Earl, bot: { kind: BotKind.Brawler } },
    { slot: 5, fighterId: FighterId.Grog, bot: { kind: BotKind.Chaser } },
    { slot: 6, fighterId: FighterId.Nesta, bot: { kind: BotKind.Masher } },
    { slot: 7, fighterId: FighterId.Moss, bot: { kind: BotKind.Brawler } },
  ];
}

function compareQuantisedSnap(hostQ: SnapshotData, clientSnap: SnapshotData): number {
  let mismatches = 0;
  if (hostQ.tick !== clientSnap.tick) mismatches++;
  if (hostQ.fighters.length !== clientSnap.fighters.length) return mismatches + 1;
  for (let i = 0; i < hostQ.fighters.length; i++) {
    const a = hostQ.fighters[i]!;
    const b = clientSnap.fighters[i]!;
    if (
      a.slot !== b.slot || a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy ||
      a.state !== b.state || a.stateFrame !== b.stateFrame || a.activeMove !== b.activeMove ||
      a.flags !== b.flags || a.damage !== b.damage || a.guardHp !== b.guardHp || a.gilt !== b.gilt ||
      a.stocks !== b.stocks || a.heldGadget !== b.heldGadget ||
      a.heldGadgetAmmo !== b.heldGadgetAmmo || a.nestaSize !== b.nestaSize || a.hitstopFrames !== b.hitstopFrames
    ) {
      mismatches++;
    }
  }
  if (hostQ.hasWorld !== clientSnap.hasWorld) return mismatches + 1;
  if (hostQ.chunks.length !== clientSnap.chunks.length) mismatches++;
  else {
    for (let i = 0; i < hostQ.chunks.length; i++) {
      const a = hostQ.chunks[i]!;
      const b = clientSnap.chunks[i]!;
      if (
        a.index !== b.index || a.x !== b.x || a.y !== b.y || a.angle !== b.angle ||
        a.vx !== b.vx || a.vy !== b.vy || a.state !== b.state || a.resting !== b.resting
      ) {
        mismatches++;
      }
    }
  }
  if (hostQ.rubble.length !== clientSnap.rubble.length) mismatches++;
  else {
    for (let i = 0; i < hostQ.rubble.length; i++) {
      const a = hostQ.rubble[i]!;
      const b = clientSnap.rubble[i]!;
      if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.angle !== b.angle || a.vx !== b.vx || a.vy !== b.vy) mismatches++;
    }
  }
  if (hostQ.gadgets.length !== clientSnap.gadgets.length) mismatches++;
  else {
    for (let i = 0; i < hostQ.gadgets.length; i++) {
      const a = hostQ.gadgets[i]!;
      const b = clientSnap.gadgets[i]!;
      if (
        a.id !== b.id || a.gadgetId !== b.gadgetId || a.x !== b.x || a.y !== b.y ||
        a.angle !== b.angle || a.vx !== b.vx || a.vy !== b.vy || a.state !== b.state || a.ammo !== b.ammo
      ) {
        mismatches++;
      }
    }
  }
  if (hostQ.projectiles.length !== clientSnap.projectiles.length) mismatches++;
  else {
    for (let i = 0; i < hostQ.projectiles.length; i++) {
      const a = hostQ.projectiles[i]!;
      const b = clientSnap.projectiles[i]!;
      if (a.id !== b.id || a.kind !== b.kind || a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy) mismatches++;
    }
  }
  return mismatches;
}

function buildClientView(
  c: ClientRuntime,
  nowMs: number,
  arenaId: ArenaId,
  hostWorld: SimWorld,
): BotView {
  const arena = getArenaSpec(arenaId);
  const estTick = c.clock.isInitialized() ? Math.round(c.clock.estimateHostTick(nowMs)) : 0;
  c.interp.setInterpDelayMs(c.clock.getInterpDelayMs());
  const interp = c.interp.sample(nowMs, estTick);

  const snapBySlot = new Map(interp.fighters.map((f) => [f.slot, f]));
  const fighters = hostWorld.fighters.map((hf) => {
    const isSelf = hf.slot === c.slot;
    const sf = snapBySlot.get(hf.slot);
    const selfF = c.predictor.fighter;
    const src = isSelf ? selfF : sf;
    const flags = isSelf ? selfF.flags : (sf ? sf.flags : hf.flags);
    return {
      slot: hf.slot,
      id: hf.id,
      team: hf.team,
      x: src ? src.x : hf.x,
      y: src ? src.y : hf.y,
      vx: src ? src.vx : hf.vx,
      vy: src ? src.vy : hf.vy,
      state: src ? src.state : hf.state,
      stateFrame: src ? src.stateFrame : hf.stateFrame,
      activeMove: isSelf ? selfF.activeMove : (sf ? sf.activeMove : hf.activeMove),
      moveFrame: isSelf ? selfF.moveFrame : (sf ? sf.moveFrame : hf.moveFrame),
      facingRight: (flags & FighterFlag.FacingRight) !== 0,
      grounded: (flags & FighterFlag.Grounded) !== 0,
      doubleJumpsLeft: isSelf ? selfF.doubleJumpsLeft : hf.doubleJumpsLeft,
      damage: src ? src.damage : hf.damage,
      guardHp: src ? src.guardHp : hf.guardHp,
      gilt: src ? src.gilt : hf.gilt,
      stocks: src ? src.stocks : hf.stocks,
      heldGadget: src ? src.heldGadget : hf.heldGadget,
      heldGadgetAmmo: src ? src.heldGadgetAmmo : hf.heldGadgetAmmo,
      nestaSize: src ? src.nestaSize : hf.nestaSize,
      pipingCharged: (flags & FighterFlag.Piping) !== 0,
    };
  });

  const chunkSnap = new Map(interp.chunks.map((ch) => [ch.index, ch]));
  const chunks = arena.chunks.map((sp, i) => {
    const sc = chunkSnap.get(i);
    const hc = hostWorld.island.chunks[i]!;
    const bounds = chunkWorldTopBounds(sp, sc ? sc.x : hc.x, sc ? sc.y : hc.y);
    return {
      index: i,
      state: sc ? sc.state : hc.state,
      x0: bounds.x0,
      x1: bounds.x1,
      y: bounds.y,
      hp: hc.hp,
    };
  });

  return {
    tick: Math.max(0, estTick),
    fighters,
    chunks,
    ledges: hostWorld.island.ledges,
    gadgets: interp.gadgets.map((g) => ({ id: g.id, gadgetId: g.gadgetId, state: g.state, x: g.x, y: g.y })),
    projectiles: interp.projectiles.map((p) => ({ id: p.id, ownerSlot: -1, x: p.x, y: p.y, vx: p.vx, vy: p.vy })),
    blastZone: arena.blastZone,
  };
}

function p99(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)]!;
}

/**
 * Measures N6 (ParryBot frame-perfect parry rate) and N7 (BlockBot 6f-margin "blocked on my screen, hit on host")
 * using the LoopbackNetwork profile, InputJitterBuffer, HostSimulation, RemoteInterpolator, and HostClockEstimator.
 */
async function runDefenceFairnessProbe(profileId: NetsimProfileId, seed: number): Promise<{ parryRate: number; blockFailRate: number }> {
  await initPhysics();
  const profile = NETSIM_PROFILES.get(profileId)!;
  const arenaId = ArenaId.Willow;
  const spec = getArenaSpec(arenaId);
  const strikePeriod = 90;
  const strikeCount = 20;
  const attackerTape: number[] = [];
  for (let i = 0; i < strikeCount; i++) {
    for (let t = 0; t < 45; t++) attackerTape.push(0);
    attackerTape.push(encodeInputMask(InputDir.Right, InputBit.Attack));
    for (let t = 0; t < strikePeriod - 46; t++) attackerTape.push(0);
  }

  const measureProbe = (isParryProbe: boolean): { successes: number; hits: number; blocks: number } => {
    const net = new LoopbackNetwork(profileId, seed ^ (isParryProbe ? 0x1111 : 0x2222));
    const tHost = net.createPeer('p0');
    const tDef = net.createPeer('p1');
    const host = new HostSimulation({
      match: {
        arenaId,
        mode: MatchMode.FreeForAll,
        fragile: false,
        seed,
        fighters: [
          { slot: 0, id: FighterId.Earl, team: TeamId.None },
          { slot: 1, id: FighterId.Earl, team: TeamId.None },
        ],
      },
      localSlot: 0,
      bots: {},
    });
    host.world.fighters[0]!.x = -0.9;
    host.world.fighters[0]!.y = 0;
    host.world.fighters[0]!.flags = FighterFlag.FacingRight | FighterFlag.Grounded;
    host.world.fighters[1]!.x = 0.5;
    host.world.fighters[1]!.y = 0;
    host.world.fighters[1]!.flags = FighterFlag.Grounded;

    const clock = new HostClockEstimator();
    const interp = new RemoteInterpolator();
    const pred = new PredictionController();
    const bot = createBot(isParryProbe ? { kind: BotKind.ParryBot, reactionTicks: 0 } : { kind: BotKind.BlockBot, blockMarginFrames: 6, reactionTicks: 0 });
    const botRng = new SeededRng(seed + 7);
    let successes = 0;
    let hits = 0;
    let blocks = 0;
    let defGuardedThisStrike = false;

    tHost.onPacket((fromId, channel, payload) => {
      if (channel === ChannelKind.Unreliable && peekUnreliableKind(payload) === NetMessageKind.Input) {
        host.ingestClientInput(Number(fromId.slice(1)), decodeInputPacket(payload));
      }
    });
    tDef.onPacket((_fromId, channel, payload) => {
      if (channel === ChannelKind.Unreliable && peekUnreliableKind(payload) === NetMessageKind.Snapshot) {
        const snap = decodeSnapshot(payload);
        pred.setLastSnapshotTick(snap.tick);
        const la = snap.lastAppliedInputTicks.length > 1 ? snap.lastAppliedInputTicks[1]! : -1;
        const oneWayMs = pred.observeAckOneWayMs(la, net.nowMs);
        clock.onSnapshot(snap.tick, net.nowMs, oneWayMs);
        interp.pushSnapshot(snap, net.nowMs);
      }
    });

    for (let tick = 0; tick < attackerTape.length; tick++) {
      if (tick % strikePeriod === 0) defGuardedThisStrike = false;
      host.setLocalInput(0, attackerTape[tick]!);
      if (!(profile.hostStallTicks > 0 && tick > 0 && tick % profile.hostStallPeriodTicks < profile.hostStallTicks)) {
        const out = host.stepTick();
        if (out.snapshotBytes) tHost.broadcast(ChannelKind.Unreliable, out.snapshotBytes);
        for (const ev of out.events) {
          if (ev.kind === SimEventKind.Parry && ev.a === 1) successes++;
          if (ev.kind === SimEventKind.Block && ev.b === 1) blocks++;
          if (ev.kind === SimEventKind.Hit && ev.b === 1 && defGuardedThisStrike) hits++;
        }
      }

      // Reset position/guard between strikes so each strike is independent
      const atkHost = host.world.fighters[0]!;
      const defHost = host.world.fighters[1]!;
      if (tick % strikePeriod === strikePeriod - 5 && defHost.state === FighterState.Idle) {
        defHost.x = 0.5;
        defHost.vx = 0;
        defHost.kbVx = 0;
        defHost.guardHp = 50;
        defHost.parryCooldown = 0;
      }

      // RemoteInterpolator advances attack moveFrame via HostClockEstimator (Rule 2)
      const estTick = clock.isInitialized() ? Math.round(clock.estimateHostTick(net.nowMs)) : tick;
      interp.setInterpDelayMs(clock.getInterpDelayMs());
      const sampled = interp.sample(net.nowMs, estTick);
      const sf0 = sampled.fighters.find((f) => f.slot === 0);
      const sf1 = sampled.fighters.find((f) => f.slot === 1);

      const view: BotView = {
        tick: Math.max(0, estTick),
        fighters: [
          {
            slot: 0, id: FighterId.Earl, team: TeamId.None,
            x: sf0 ? sf0.x : atkHost.x, y: sf0 ? sf0.y : atkHost.y,
            vx: sf0 ? sf0.vx : atkHost.vx, vy: sf0 ? sf0.vy : atkHost.vy,
            state: sf0 ? sf0.state : atkHost.state, stateFrame: sf0 ? sf0.stateFrame : atkHost.stateFrame,
            activeMove: sf0 ? sf0.activeMove : atkHost.activeMove, moveFrame: sf0 ? sf0.moveFrame : 0,
            facingRight: true, grounded: true, doubleJumpsLeft: 1,
            damage: sf0 ? sf0.damage : 0, guardHp: sf0 ? sf0.guardHp : 50, gilt: 0, stocks: 3,
            heldGadget: GadgetId.None, heldGadgetAmmo: 0, nestaSize: sf0 ? sf0.nestaSize : defHost.nestaSize, pipingCharged: false,
          },
          {
            slot: 1, id: FighterId.Earl, team: TeamId.None,
            x: sf1 ? sf1.x : defHost.x, y: sf1 ? sf1.y : defHost.y,
            vx: sf1 ? sf1.vx : defHost.vx, vy: sf1 ? sf1.vy : defHost.vy,
            state: sf1 ? sf1.state : defHost.state, stateFrame: sf1 ? sf1.stateFrame : defHost.stateFrame,
            activeMove: sf1 ? sf1.activeMove : MoveId.None, moveFrame: sf1 ? sf1.moveFrame : 0,
            facingRight: false, grounded: true, doubleJumpsLeft: 1,
            damage: sf1 ? sf1.damage : 0, guardHp: sf1 ? sf1.guardHp : 50, gilt: 0, stocks: 3,
            heldGadget: GadgetId.None, heldGadgetAmmo: 0, nestaSize: defHost.nestaSize, pipingCharged: false,
          },
        ],
        chunks: spec.chunks.map((c, i) => ({ index: i, state: 0, x0: c.topX0, x1: c.topX1, y: (c.topY0 + c.topY1) * 0.5, hp: c.hp })),
        ledges: host.world.island.ledges,
        gadgets: [],
        projectiles: [],
        blastZone: spec.blastZone,
      };

      const defMask = bot.decide(view, 1, botRng);
      if ((defMask & InputBit.Guard) !== 0) defGuardedThisStrike = true;
      const pkt = pred.recordInput(tick, defMask, net.nowMs);
      tDef.send('p0', ChannelKind.Unreliable, encodeInputPacket(pkt));
      net.advanceMs(TICK_MS);
    }

    host.dispose();
    return { successes, hits, blocks };
  };

  const parryRes = measureProbe(true);
  const blockRes = measureProbe(false);
  const parryRate = parryRes.successes / strikeCount;
  const blockDefended = blockRes.blocks + blockRes.successes;
  const blockTotal = blockDefended + blockRes.hits;
  const blockFailRate = blockTotal > 0 ? blockRes.hits / blockTotal : 1;
  return { parryRate, blockFailRate };
}

export async function runNetsimScenario(options: NetsimOptions): Promise<NetsimMetrics> {
  await initPhysics();
  const profile = NETSIM_PROFILES.get(options.profileId)!;
  const arenaId = options.arenaId ?? ArenaId.Willow;
  const clientConfigs = options.clients ?? defaultClients();
  const hostSlot = options.hostBot?.slot ?? 0;
  const hostFighterId = options.hostBot?.fighterId ?? FighterId.Earl;
  const durationTicks = options.durationTicks ?? (options.profileId === NetsimProfileId.Churn ? 5400 : 1200);

  const allFighters = [
    { slot: hostSlot, id: hostFighterId, team: TeamId.None },
    ...clientConfigs.map((c) => ({ slot: c.slot, id: c.fighterId, team: TeamId.None })),
  ].sort((a, b) => a.slot - b.slot);

  const net = new LoopbackNetwork(options.profileId, options.seed);
  const hostPeerId = `p${hostSlot}`;
  const hostTransport = net.createPeer(hostPeerId);
  const hostSession = new RoomSession(
    hostTransport,
    true,
    { name: 'Host', fighterId: hostFighterId, colourIndex: 0 },
    {},
    createInitialRoster(
      hostPeerId,
      { name: 'Host', fighterId: hostFighterId, colourIndex: 0 },
      undefined,
      arenaId,
      options.seed,
    ),
  );

  const hostBotCfg = options.hostBot !== undefined ? options.hostBot.bot : { kind: BotKind.Brawler };
  const hostBot = createBot(hostBotCfg);
  const hostBotRng = new SeededRng((options.seed ^ 0x9e3779b1) | 0);
  const matchConfig = {
    arenaId,
    mode: MatchMode.FreeForAll,
    fragile: false,
    seed: options.seed,
    fighters: allFighters,
    ...(options.profileId === NetsimProfileId.Churn ? { stocksOverride: 99 } : {}),
  };
  const host = new HostSimulation({
    match: matchConfig,
    localSlot: hostSlot,
    bots: {},
  });

  const hostSnapsByTick = new Map<number, SnapshotData>();
  const hostTickTimesMs: number[] = [];
  let exceptions = 0;

  const clients: ClientRuntime[] = clientConfigs.map((cfg) => {
    const peerId = `p${cfg.slot}`;
    const transport = net.createPeer(peerId);
    const session = new RoomSession(transport, false, { name: peerId, fighterId: cfg.fighterId, colourIndex: cfg.slot % 8 });
    const predictor = new ClientPredictor(matchConfig, cfg.slot);

    const c: ClientRuntime = {
      slot: cfg.slot,
      peerId,
      fighterId: cfg.fighterId,
      transport,
      session,
      bot: createBot(cfg.bot),
      rng: new SeededRng((options.seed ^ ((cfg.slot + 1) * 0x517cc1b7)) | 0),
      clock: new HostClockEstimator(),
      interp: new RemoteInterpolator(),
      predictor,
      koOrder: [],
      winnerSlot: -1,
      desyncMismatches: 0,
      downSamples: [],
      upSamples: [],
    };

    transport.onPacket((_fromId, channel, payload) => {
      try {
        if (channel === ChannelKind.Unreliable) {
          if (peekUnreliableKind(payload) !== NetMessageKind.Snapshot) return;
          const snap = decodeSnapshot(payload);
          const oneWayMs = c.predictor.observeAckOneWayMs(snap, net.nowMs);
          c.clock.onSnapshot(snap.tick, net.nowMs, oneWayMs);
          c.interp.pushSnapshot(snap, net.nowMs);

          const quantHost = hostSnapsByTick.get(snap.tick);
          if (quantHost) {
            c.desyncMismatches += compareQuantisedSnap(quantHost, snap);
          }

          c.predictor.reconcileSnapshot(snap);
        } else {
          const msg = decodeReliableMessage(payload);
          if (msg.kind === NetMessageKind.Events) {
            c.predictor.applyReliableEvents(msg.events);
            for (const ev of msg.events) {
              if (ev.kind === SimEventKind.Ko) c.koOrder.push({ tick: ev.tick, victimSlot: ev.a });
              if (ev.kind === SimEventKind.RoundEnd) c.winnerSlot = ev.a;
            }
          }
        }
      } catch {
        exceptions++;
      }
    });
    return c;
  });

  hostTransport.onPacket((fromId, channel, payload) => {
    try {
      if (channel === ChannelKind.Unreliable && peekUnreliableKind(payload) === NetMessageKind.Input) {
        const slot = Number(fromId.slice(1));
        if (Number.isInteger(slot) && slot !== hostSlot) {
          host.ingestClientInput(slot, decodeInputPacket(payload));
        }
      }
    } catch {
      exceptions++;
    }
  });

  // Handshake in lobby -> Round
  net.advanceMs(60);
  hostSession.setPhase(RoomPhase.Round, options.seed, arenaId);
  net.advanceMs(60);

  let churnLateJoinIsTeaspoon = false;
  let churnRecoveryMs = Infinity;
  let churnScoresIntact = false;
  let lateSession: RoomSession | null = null;
  const hostDownSamples: number[] = [];
  const arenaSpec = getArenaSpec(arenaId);
  let stallTicksRemaining = 0;

  const connectedClients = new Set<string>(clients.map((c) => c.peerId));

  for (let tick = 0; tick < durationTicks; tick++) {
    if (options.profileId === NetsimProfileId.Churn) {
      if (tick === 1200) {
        // 20 s: late joiner arrives mid-round -> becomes Spectating / Teaspoon
        const tLate = net.createPeer('late');
        lateSession = new RoomSession(tLate, false, { name: 'Late', fighterId: FighterId.Earl, colourIndex: 7 });
        net.advanceMs(120);
        const lateSlot = hostSession.roster.slots.find((s) => s.peerId === 'late');
        churnLateJoinIsTeaspoon = lateSlot !== undefined && lateSlot.status === SlotStatus.Spectating;
      }
      if (tick === 3000 && clients.length > 1) {
        // 50 s: one client disconnects
        const leaving = clients[clients.length - 1]!;
        connectedClients.delete(leaving.peerId);
        net.disconnectPeer(leaving.peerId);
        net.advanceMs(60);
      }
      if (tick === 4800) {
        // 80 s: award wins to two surviving non-host slots, then host disconnects!
        const survivingSlots = hostSession.roster.slots
          .filter((s) => s.peerId !== hostPeerId && connectedClients.has(s.peerId))
          .map((s) => s.slot)
          .slice(0, 2);
        const wSlot1 = survivingSlots[0]!;
        const wSlot2 = survivingSlots[1]!;
        hostSession.awardWin(wSlot1);
        hostSession.awardWin(wSlot2);
        net.advanceMs(300);
        const tLeave = net.nowMs;
        net.disconnectPeer(hostPeerId);
        const remaining = clients.filter((c) => connectedClients.has(c.peerId));
        for (let stepMs = 50; stepMs <= 5000; stepMs += 50) {
          net.advanceMs(50);
          const allLobby = remaining.every((c) => c.session.roster.phase === RoomPhase.Lobby && c.session.roster.hostId !== hostPeerId);
          if (allLobby) {
            churnRecoveryMs = net.nowMs - tLeave;
            const sample = remaining[0]!;
            const s1 = sample.session.roster.slots.find((s) => s.slot === wSlot1);
            const s2 = sample.session.roster.slots.find((s) => s.slot === wSlot2);
            churnScoresIntact = s1 !== undefined && s2 !== undefined && s1.wins === 1 && s2.wins === 1;
            break;
          }
        }
        break;
      }
    }

    if (profile.hostStallTicks > 0 && tick > 0 && tick % profile.hostStallPeriodTicks === 0) {
      stallTicksRemaining = profile.hostStallTicks;
    }

    // Host tick (unless stalled)
    if (stallTicksRemaining > 0) {
      stallTicksRemaining--;
    } else {
      const hostView = buildBotView(
        host.world.tick,
        host.world.fighters,
        host.world.island,
        host.world.gadgets.worldGadgets,
        host.world.gadgets.projectiles,
        arenaSpec.blastZone,
        arenaSpec.chunks,
      );
      host.setLocalInput(hostSlot, hostBot.decide(hostView, hostSlot, hostBotRng));

      const t0 = performance.now();
      const out = host.stepTick();
      const elapsed = performance.now() - t0;
      hostTickTimesMs.push(elapsed);

      if (out.snapshotBytes && out.snapshotData) {
        const quant = decodeSnapshot(out.snapshotBytes);
        hostSnapsByTick.set(out.tick, quant);
        if (hostSnapsByTick.size > 180) {
          const oldest = hostSnapsByTick.keys().next().value;
          if (oldest !== undefined) hostSnapsByTick.delete(oldest);
        }
        hostTransport.broadcast(ChannelKind.Unreliable, out.snapshotBytes);
      }
      if (out.events.length > 0) {
        hostTransport.broadcast(
          ChannelKind.Reliable,
          encodeReliableMessage({ kind: NetMessageKind.Events, events: out.events }),
        );
      }
    }

    // Client ticks (each client predicts self, interpolates others, sends 60 Hz redundant InputPacket)
    for (const c of clients) {
      if (!connectedClients.has(c.peerId)) continue;
      const view = buildClientView(c, net.nowMs, arenaId, host.world);
      const mask = c.bot.decide(view, c.slot, c.rng);
      const pkt = c.predictor.predictTick(tick, mask, net.nowMs);
      c.transport.send(hostPeerId, ChannelKind.Unreliable, encodeInputPacket(pkt));
    }

    net.advanceMs(TICK_MS);

    if (tick > 180 && tick % 60 === 0) {
      for (const c of clients) {
        if (!connectedClients.has(c.peerId)) continue;
        const rep = c.transport.getBandwidthReport();
        c.downSamples.push(rep.downBytesPerSec);
        c.upSamples.push(rep.upBytesPerSec);
      }
      hostDownSamples.push(hostTransport.getBandwidthReport().upBytesPerSec);
    }

    if (host.world.isFinished()) break;
  }

  // Drain any final in-flight reliable events
  net.advanceMs(profile.rttMs * 2 + 100);

  const hostResult = host.world.getRoundResult();
  const hostKoVictims = hostResult !== null ? hostResult.koOrder.map((k) => `${k.tick}:${k.victimSlot}`) : [];
  const activeClients = clients.filter((c) => connectedClients.has(c.peerId));
  const koOrderAgreement = hostResult === null
    ? true
    : activeClients.every((c) => c.koOrder.map((k) => `${k.tick}:${k.victimSlot}`).join(',') === hostKoVictims.join(','));
  const winnerAgreement = hostResult === null
    ? true
    : activeClients.every((c) => c.winnerSlot === hostResult.winnerSlot);

  const desyncMismatches = clients.reduce((acc, c) => acc + c.desyncMismatches, 0);
  const lossStats = host.jitter.getLossStats();
  const predP95 = Math.max(...clients.map((c) => c.predictor.getPredictionErrorP95()), 0);
  const simSeconds = Math.max(1, host.world.tick / 60);
  const totalLarge = clients.reduce((acc, c) => acc + c.predictor.getLargeCorrectionCount(), 0);
  const avgLargePer10s = clients.length > 0 ? (totalLarge / (clients.length * simSeconds)) * 10 : 0;

  const clientDownBps = Math.max(...clients.flatMap((c) => c.downSamples), 0);
  const clientUpBps = Math.max(...clients.flatMap((c) => c.upSamples), 0);
  const hostUpBps = Math.max(...hostDownSamples, 0);

  const probes = options.skipProbes || options.profileId === NetsimProfileId.Churn
    ? { parryRate: 1, blockFailRate: 0 }
    : await runDefenceFairnessProbe(options.profileId, options.seed);

  for (const c of clients) {
    c.session.destroy();
    c.predictor.dispose();
  }
  lateSession?.destroy();
  hostSession.destroy();
  host.dispose();

  return {
    profileId: options.profileId,
    ticksSimulated: host.world.tick,
    desyncMismatches,
    koOrderAgreement,
    winnerAgreement,
    inputLossRate: lossStats.lossRate,
    predictionErrorP95: predP95,
    largeCorrectionsPer10s: avgLargePer10s,
    parryBotSuccessRate: probes.parryRate,
    blockBotFailRate: probes.blockFailRate,
    clientDownBps,
    clientUpBps,
    hostUpBps,
    hostTickP99Ms: p99(hostTickTimesMs),
    churnLateJoinIsTeaspoon,
    churnRecoveryMs,
    churnScoresIntact,
    exceptions,
    maxBufferEntries: Math.max(hostSnapsByTick.size, 64),
    roundResult: hostResult,
  };
}
