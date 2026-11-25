import { assert, assertNever } from '../sim/assert';
import { ArenaId, ErrorCode, FighterId, MatchMode, TeamId } from '../sim/enums';
import {
  decodeReliableMessage,
  encodeReliableMessage,
  type ReliableNetMessage,
  type RoomRosterData,
  type RoomSettingsData,
  type RoomSlotData,
} from './codec';
import { BUILD_ID, PROTOCOL_VERSION } from './config';
import {
  ByeReason,
  ChannelKind,
  ConnectionState,
  HostAction,
  NetMessageKind,
  RoomPhase,
  SlotStatus,
} from './enums';
import type { Transport } from './transport';

export const MAX_FIGHTER_SLOTS = 8;
export const MAX_TOTAL_SLOTS = 10; // 8 fighter slots + up to 2 spectators

export interface HostCandidateMetric {
  readonly peerId: string;
  readonly slot: number;
  readonly directPeersReached: number;
  readonly benchScore: number;
  readonly medianRttMs: number;
}

export interface LocalProfile {
  readonly name: string;
  readonly fighterId: FighterId;
  readonly colourIndex: number;
}

export interface SessionEvents {
  onRosterChange?: (roster: RoomRosterData) => void;
  onStateChange?: (state: ConnectionState, reason?: ByeReason) => void;
  onHostChanged?: (newHostId: string, previousHostId: string) => void;
  onHostOffer?: (candidatePeerId: string) => void;
  onMessage?: (fromPeerId: string, msg: ReliableNetMessage) => void;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettingsData = {
  mode: MatchMode.FreeForAll,
  fragile: false,
  stocks: 3,
  enableTierB: true,
  enableTierC: true,
};

export function createInitialRoster(
  hostId: string,
  profile: LocalProfile,
  settings: RoomSettingsData = DEFAULT_ROOM_SETTINGS,
  arenaId: ArenaId = ArenaId.Willow,
  roundSeed = 1,
): RoomRosterData {
  return {
    version: 1,
    hostId,
    phase: RoomPhase.Lobby,
    arenaId,
    roundSeed,
    countdownTicks: 0,
    settings,
    slots: [
      {
        slot: 0,
        peerId: hostId,
        name: profile.name,
        fighterId: profile.fighterId,
        colourIndex: profile.colourIndex,
        team: TeamId.None,
        wins: 0,
        status: SlotStatus.Connected,
      },
    ],
  };
}

export function compareHostCandidates(a: HostCandidateMetric, b: HostCandidateMetric): number {
  if (a.directPeersReached !== b.directPeersReached) return b.directPeersReached - a.directPeersReached;
  if (a.benchScore !== b.benchScore) return b.benchScore - a.benchScore;
  if (a.medianRttMs !== b.medianRttMs) return a.medianRttMs - b.medianRttMs;
  return a.slot - b.slot;
}

export function selectBestHostCandidate(candidates: readonly HostCandidateMetric[]): HostCandidateMetric | null {
  if (candidates.length === 0) return null;
  let best = candidates[0] as HostCandidateMetric;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i] as HostCandidateMetric;
    if (compareHostCandidates(c, best) < 0) best = c;
  }
  return best;
}

export function selectEmergencyHost(
  slots: readonly RoomSlotData[],
  reachableByPeer: ReadonlyMap<string, ReadonlySet<string>>,
  departedHostId: string,
): RoomSlotData | null {
  const remaining = slots
    .filter((s) => s.peerId !== departedHostId && s.status !== SlotStatus.Bot)
    .sort((a, b) => a.slot - b.slot);
  if (remaining.length === 0) return null;
  const remainingIds = remaining.map((s) => s.peerId);
  for (const candidate of remaining) {
    const reachable = reachableByPeer.get(candidate.peerId);
    if (!reachable) continue;
    let reachesAll = true;
    for (const id of remainingIds) {
      if (id !== candidate.peerId && !reachable.has(id)) {
        reachesAll = false;
        break;
      }
    }
    if (reachesAll) return candidate;
  }
  return remaining[0] as RoomSlotData;
}

export class RoomSession {
  public readonly transport: Transport;
  private readonly profile: LocalProfile;
  private readonly events: SessionEvents;
  private readonly hostMetrics = new Map<string, HostCandidateMetric>();
  private readonly unsubs: (() => void)[] = [];
  public state: ConnectionState = ConnectionState.Connected;
  public byeReason: ByeReason | null = null;
  public roster: RoomRosterData;
  public benchScore = 1000;

  public constructor(
    transport: Transport,
    isHost: boolean,
    profile: LocalProfile,
    events: SessionEvents = {},
    initialRoster?: RoomRosterData,
  ) {
    this.transport = transport;
    this.profile = profile;
    this.events = events;
    this.roster = isHost
      ? (initialRoster ?? createInitialRoster(transport.selfId, profile))
      : {
          version: 0,
          hostId: '',
          phase: RoomPhase.Lobby,
          arenaId: ArenaId.Willow,
          roundSeed: 1,
          countdownTicks: 0,
          settings: DEFAULT_ROOM_SETTINGS,
          slots: [],
        };

    this.unsubs.push(
      transport.onPacket((peerId, channel, payload) => this.handlePacket(peerId, channel, payload)),
      transport.onPeerJoin((peerId) => this.handlePeerJoin(peerId)),
      transport.onPeerLeave((peerId) => this.handlePeerLeave(peerId)),
      transport.onError((state) => this.setState(state)),
    );
    for (const existingPeerId of transport.getPeerIds()) {
      this.handlePeerJoin(existingPeerId);
    }
  }

  public get isHost(): boolean {
    return this.roster.hostId === this.transport.selfId;
  }

  public destroy(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs.length = 0;
  }

  public sendHello(peerId: string): void {
    this.sendReliable(peerId, {
      kind: NetMessageKind.Hello,
      protocolVersion: PROTOCOL_VERSION,
      buildId: BUILD_ID,
      name: this.profile.name,
      fighterId: this.profile.fighterId,
      colourIndex: this.profile.colourIndex,
    });
  }

  public broadcastHello(): void {
    this.broadcastReliable({
      kind: NetMessageKind.Hello,
      protocolVersion: PROTOCOL_VERSION,
      buildId: BUILD_ID,
      name: this.profile.name,
      fighterId: this.profile.fighterId,
      colourIndex: this.profile.colourIndex,
    });
  }

  public setPhase(phase: RoomPhase, roundSeed?: number, arenaId?: ArenaId): void {
    assert(this.isHost, ErrorCode.InvariantViolation, 'Only host can mutate phase');
    let nextSlots = this.roster.slots;
    if (phase === RoomPhase.Lobby || phase === RoomPhase.Countdown) {
      nextSlots = this.promoteSpectators(nextSlots);
    }
    this.commitRoster({
      ...this.roster,
      phase,
      arenaId: arenaId ?? this.roster.arenaId,
      roundSeed: roundSeed ?? this.roster.roundSeed,
      slots: nextSlots,
    });
  }

  public awardWin(winnerSlot: number): void {
    assert(this.isHost, ErrorCode.InvariantViolation, 'Only host can award wins');
    const nextSlots = this.roster.slots.map((s) =>
      s.slot === winnerSlot ? { ...s, wins: s.wins + 1 } : s,
    );
    this.commitRoster({ ...this.roster, slots: nextSlots });
  }

  public reportHostMetric(medianRttMs: number): void {
    const slotEntry = this.roster.slots.find((s) => s.peerId === this.transport.selfId);
    const slot = slotEntry ? slotEntry.slot : MAX_TOTAL_SLOTS;
    const directPeersReached = this.transport.getPeerIds().length;
    const metric: HostCandidateMetric = {
      peerId: this.transport.selfId,
      slot,
      directPeersReached,
      benchScore: this.benchScore,
      medianRttMs: Math.round(medianRttMs),
    };
    this.hostMetrics.set(this.transport.selfId, metric);
    this.broadcastReliable({
      kind: NetMessageKind.Host,
      action: HostAction.BenchReport,
      fromPeerId: this.transport.selfId,
      targetPeerId: '',
      directPeersReached: metric.directPeersReached,
      benchScore: metric.benchScore,
      medianRttMs: metric.medianRttMs,
    });
  }

  public proposeBestHostBetweenRounds(): string | null {
    assert(this.isHost, ErrorCode.InvariantViolation, 'Only host proposes handover');
    const candidates: HostCandidateMetric[] = [];
    for (const s of this.roster.slots) {
      if (s.status === SlotStatus.Bot) continue;
      const m = this.hostMetrics.get(s.peerId);
      if (m) candidates.push({ ...m, slot: s.slot });
    }
    const best = selectBestHostCandidate(candidates);
    if (!best || best.peerId === this.roster.hostId) return null;
    this.broadcastReliable({
      kind: NetMessageKind.Host,
      action: HostAction.Offer,
      fromPeerId: this.transport.selfId,
      targetPeerId: best.peerId,
      directPeersReached: best.directPeersReached,
      benchScore: best.benchScore,
      medianRttMs: best.medianRttMs,
    });
    this.events.onHostOffer?.(best.peerId);
    return best.peerId;
  }

  public transferHost(newHostId: string): void {
    assert(this.isHost, ErrorCode.InvariantViolation, 'Only current host can transfer host');
    const prevHostId = this.roster.hostId;
    const nextRoster: RoomRosterData = {
      ...this.roster,
      version: this.roster.version + 1,
      hostId: newHostId,
      phase: RoomPhase.Lobby,
      slots: this.promoteSpectators(this.roster.slots),
    };
    this.roster = nextRoster;
    this.broadcastReliable({ kind: NetMessageKind.Roster, roster: nextRoster });
    this.broadcastReliable({
      kind: NetMessageKind.Host,
      action: HostAction.Take,
      fromPeerId: prevHostId,
      targetPeerId: newHostId,
      directPeersReached: this.transport.getPeerIds().length,
      benchScore: this.benchScore,
      medianRttMs: 0,
    });
    this.events.onRosterChange?.(nextRoster);
    this.events.onHostChanged?.(newHostId, prevHostId);
  }

  public sendReliable(peerId: string, msg: ReliableNetMessage): void {
    this.transport.send(peerId, ChannelKind.Reliable, encodeReliableMessage(msg));
  }

  public broadcastReliable(msg: ReliableNetMessage): void {
    this.transport.broadcast(ChannelKind.Reliable, encodeReliableMessage(msg));
  }

  private handlePeerJoin(peerId: string): void {
    this.sendHello(peerId);
    if (this.isHost && this.roster.version > 0) {
      this.sendReliable(peerId, { kind: NetMessageKind.Roster, roster: this.roster });
    }
  }

  private handlePeerLeave(peerId: string): void {
    this.hostMetrics.delete(peerId);
    if (peerId === this.roster.hostId) {
      this.handleHostDisconnect(peerId);
      return;
    }
    if (this.isHost) {
      const nextSlots = this.roster.slots.filter((s) => s.peerId !== peerId);
      if (nextSlots.length !== this.roster.slots.length) {
        this.commitRoster({ ...this.roster, slots: nextSlots });
      }
    }
  }

  private handleHostDisconnect(departedHostId: string): void {
    const remainingSlots = this.promoteSpectators(
      this.roster.slots.filter((s) => s.peerId !== departedHostId),
    );
    const connected = new Set<string>(this.transport.getPeerIds());
    connected.add(this.transport.selfId);
    const reachableByPeer = new Map<string, Set<string>>();
    for (const s of remainingSlots) {
      if (s.status === SlotStatus.Bot) continue;
      if (s.peerId === this.transport.selfId) {
        reachableByPeer.set(s.peerId, connected);
        continue;
      }
      if (!connected.has(s.peerId)) continue;
      const metric = this.hostMetrics.get(s.peerId);
      const minNeeded = remainingSlots.filter((r) => r.status !== SlotStatus.Bot).length - 1;
      if (metric && metric.directPeersReached < minNeeded) continue;
      const assumed = new Set<string>();
      for (const r of remainingSlots) {
        if (r.status !== SlotStatus.Bot && connected.has(r.peerId)) assumed.add(r.peerId);
      }
      reachableByPeer.set(s.peerId, assumed);
    }
    const chosen = selectEmergencyHost(remainingSlots, reachableByPeer, departedHostId);
    if (!chosen) return;
    const nextRoster: RoomRosterData = {
      ...this.roster,
      version: this.roster.version + 1,
      hostId: chosen.peerId,
      phase: RoomPhase.Lobby,
      slots: remainingSlots,
    };
    this.roster = nextRoster;
    if (chosen.peerId === this.transport.selfId) {
      this.broadcastReliable({ kind: NetMessageKind.Roster, roster: nextRoster });
      this.broadcastReliable({
        kind: NetMessageKind.Host,
        action: HostAction.Take,
        fromPeerId: departedHostId,
        targetPeerId: chosen.peerId,
        directPeersReached: this.transport.getPeerIds().length,
        benchScore: this.benchScore,
        medianRttMs: 0,
      });
    }
    this.events.onRosterChange?.(nextRoster);
    this.events.onHostChanged?.(chosen.peerId, departedHostId);
  }

  private handlePacket(peerId: string, channel: ChannelKind, payload: Uint8Array): void {
    if (channel !== ChannelKind.Reliable) return;
    const msg = decodeReliableMessage(payload);
    switch (msg.kind) {
      case NetMessageKind.Hello:
        this.handleHello(peerId, msg);
        break;
      case NetMessageKind.Bye:
        this.byeReason = msg.reason;
        this.setState(
          msg.reason === ByeReason.VersionMismatch ? ConnectionState.VersionMismatch : ConnectionState.PeerFailed,
          msg.reason,
        );
        break;
      case NetMessageKind.Roster:
        if (msg.roster.version >= this.roster.version) {
          const prevHost = this.roster.hostId;
          this.roster = msg.roster;
          this.events.onRosterChange?.(msg.roster);
          if (prevHost && prevHost !== msg.roster.hostId) {
            this.events.onHostChanged?.(msg.roster.hostId, prevHost);
          }
        }
        break;
      case NetMessageKind.Host:
        this.handleHostMessage(peerId, msg);
        break;
      case NetMessageKind.Events:
      case NetMessageKind.Say:
      case NetMessageKind.Perf:
        break;
      default:
        assertNever(msg, 'RoomSession.handlePacket');
    }
    this.events.onMessage?.(peerId, msg);
  }

  private handleHello(peerId: string, msg: Extract<ReliableNetMessage, { kind: NetMessageKind.Hello }>): void {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.sendReliable(peerId, { kind: NetMessageKind.Bye, reason: ByeReason.VersionMismatch });
      this.byeReason = ByeReason.VersionMismatch;
      this.setState(ConnectionState.VersionMismatch, ByeReason.VersionMismatch);
      return;
    }
    if (!this.isHost) return;
    if (this.roster.slots.some((s) => s.peerId === peerId)) return;
    const used = new Set(this.roster.slots.map((s) => s.slot));
    const isRoundActive = this.roster.phase === RoomPhase.Round || this.roster.phase === RoomPhase.Countdown;
    const minSlot = isRoundActive ? MAX_FIGHTER_SLOTS : 0;
    let freeSlot = -1;
    for (let i = minSlot; i < MAX_TOTAL_SLOTS; i++) {
      if (!used.has(i)) {
        freeSlot = i;
        break;
      }
    }
    if (freeSlot === -1) {
      this.sendReliable(peerId, { kind: NetMessageKind.Bye, reason: ByeReason.RoomFull });
      return;
    }
    const newSlot: RoomSlotData = {
      slot: freeSlot,
      peerId,
      name: msg.name,
      fighterId: msg.fighterId,
      colourIndex: msg.colourIndex,
      team: TeamId.None,
      wins: 0,
      status: isRoundActive ? SlotStatus.Spectating : SlotStatus.Connected,
    };
    this.commitRoster({ ...this.roster, slots: [...this.roster.slots, newSlot].sort((a, b) => a.slot - b.slot) });
  }

  private handleHostMessage(peerId: string, msg: Extract<ReliableNetMessage, { kind: NetMessageKind.Host }>): void {
    switch (msg.action) {
      case HostAction.BenchReport: {
        const slotEntry = this.roster.slots.find((s) => s.peerId === peerId);
        this.hostMetrics.set(peerId, {
          peerId,
          slot: slotEntry ? slotEntry.slot : MAX_TOTAL_SLOTS,
          directPeersReached: msg.directPeersReached,
          benchScore: msg.benchScore,
          medianRttMs: msg.medianRttMs,
        });
        break;
      }
      case HostAction.Offer:
        this.events.onHostOffer?.(msg.targetPeerId);
        if (msg.targetPeerId === this.transport.selfId && this.isHost) {
          this.transferHost(msg.targetPeerId);
        }
        break;
      case HostAction.Take:
        if (msg.targetPeerId && msg.targetPeerId !== this.roster.hostId) {
          const prev = this.roster.hostId;
          this.roster = {
            ...this.roster,
            version: this.roster.version + 1,
            hostId: msg.targetPeerId,
            phase: RoomPhase.Lobby,
            slots: this.promoteSpectators(this.roster.slots),
          };
          this.events.onRosterChange?.(this.roster);
          this.events.onHostChanged?.(msg.targetPeerId, prev);
        }
        break;
      case HostAction.RequestHost:
        break;
      default:
        assertNever(msg.action, 'RoomSession.handleHostMessage');
    }
  }

  private promoteSpectators(slots: readonly RoomSlotData[]): RoomSlotData[] {
    const usedFighterSlots = new Set(
      slots.filter((s) => s.status !== SlotStatus.Spectating && s.slot < MAX_FIGHTER_SLOTS).map((s) => s.slot),
    );
    return slots.map((s) => {
      if (s.status !== SlotStatus.Spectating) return s;
      for (let i = 0; i < MAX_FIGHTER_SLOTS; i++) {
        if (!usedFighterSlots.has(i)) {
          usedFighterSlots.add(i);
          return { ...s, slot: i, status: SlotStatus.Connected };
        }
      }
      return s;
    });
  }

  private commitRoster(next: RoomRosterData): void {
    const versioned: RoomRosterData = { ...next, version: this.roster.version + 1 };
    this.roster = versioned;
    this.broadcastReliable({ kind: NetMessageKind.Roster, roster: versioned });
    this.events.onRosterChange?.(versioned);
  }

  private setState(state: ConnectionState, reason?: ByeReason): void {
    if (this.state === state && reason === undefined) return;
    this.state = state;
    this.events.onStateChange?.(state, reason);
  }
}
