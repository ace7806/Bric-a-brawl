import { assert, requireKey } from '../../sim/assert';
import { ErrorCode } from '../../sim/enums';
import { SeededRng } from '../../sim/prng';
import { BandwidthCounter, type BandwidthReport } from '../codec';
import { ChannelKind, ConnectionState, NetsimProfileId } from '../enums';
import type {
  ConnectionErrorHandler,
  PacketHandler,
  PeerEventHandler,
  Transport,
  TransportDiagnostics,
} from '../transport';

export interface NetsimProfileSpec {
  readonly id: NetsimProfileId;
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly lossRate: number;
  readonly burstLossLength: number;
  readonly reorderRate: number;
  readonly duplicateRate: number;
  readonly hostStallTicks: number;
  readonly hostStallPeriodTicks: number;
}

export const NETSIM_PROFILES: ReadonlyMap<NetsimProfileId, NetsimProfileSpec> = new Map([
  [NetsimProfileId.Lan, { id: NetsimProfileId.Lan, rttMs: 4, jitterMs: 1, lossRate: 0, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Typical, { id: NetsimProfileId.Typical, rttMs: 40, jitterMs: 5, lossRate: 0.01, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Far, { id: NetsimProfileId.Far, rttMs: 90, jitterMs: 12, lossRate: 0.02, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Limit, { id: NetsimProfileId.Limit, rttMs: 150, jitterMs: 20, lossRate: 0.02, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Wifi, { id: NetsimProfileId.Wifi, rttMs: 50, jitterMs: 30, lossRate: 0.05, burstLossLength: 3, reorderRate: 0.02, duplicateRate: 0.01, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Awful, { id: NetsimProfileId.Awful, rttMs: 250, jitterMs: 40, lossRate: 0.08, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
  [NetsimProfileId.Stall, { id: NetsimProfileId.Stall, rttMs: 40, jitterMs: 5, lossRate: 0.01, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 30, hostStallPeriodTicks: 600 }],
  [NetsimProfileId.Churn, { id: NetsimProfileId.Churn, rttMs: 40, jitterMs: 5, lossRate: 0.01, burstLossLength: 1, reorderRate: 0, duplicateRate: 0, hostStallTicks: 0, hostStallPeriodTicks: 0 }],
]);

interface InFlightPacket {
  readonly deliverAtMs: number;
  readonly seq: number;
  readonly fromId: string;
  readonly toId: string;
  readonly channel: ChannelKind;
  readonly payload: Uint8Array;
}

interface LinkState {
  burstDropRemaining: number;
  reliableLastDeliverAtMs: number;
}

export class LoopbackTransport implements Transport {
  public readonly selfId: string;
  private readonly hub: LoopbackNetwork;
  private readonly packetHandlers = new Set<PacketHandler>();
  private readonly joinHandlers = new Set<PeerEventHandler>();
  private readonly leaveHandlers = new Set<PeerEventHandler>();
  private readonly errorHandlers = new Set<ConnectionErrorHandler>();
  private readonly peers = new Set<string>();
  public readonly bandwidth = new BandwidthCounter();
  private closed = false;

  public constructor(hub: LoopbackNetwork, selfId: string) {
    this.hub = hub;
    this.selfId = selfId;
  }

  public send(peerId: string, channel: ChannelKind, payload: Uint8Array): void {
    assert(!this.closed, ErrorCode.TransportError, `Peer ${this.selfId} transport is closed`);
    if (!this.peers.has(peerId)) return;
    this.hub.enqueue(this.selfId, peerId, channel, payload);
  }

  public broadcast(channel: ChannelKind, payload: Uint8Array): void {
    assert(!this.closed, ErrorCode.TransportError, `Peer ${this.selfId} transport is closed`);
    for (const peerId of this.peers) {
      this.hub.enqueue(this.selfId, peerId, channel, payload);
    }
  }

  public getPeerIds(): readonly string[] {
    return Array.from(this.peers);
  }

  public onPacket(handler: PacketHandler): () => void {
    this.packetHandlers.add(handler);
    return () => this.packetHandlers.delete(handler);
  }

  public onPeerJoin(handler: PeerEventHandler): () => void {
    this.joinHandlers.add(handler);
    return () => this.joinHandlers.delete(handler);
  }

  public onPeerLeave(handler: PeerEventHandler): () => void {
    this.leaveHandlers.add(handler);
    return () => this.leaveHandlers.delete(handler);
  }

  public onError(handler: ConnectionErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  public getBandwidthReport(): BandwidthReport {
    this.bandwidth.advanceTo(this.hub.nowMs);
    return this.bandwidth.report();
  }

  public async getDiagnostics(): Promise<TransportDiagnostics> {
    return {
      state: this.closed ? ConnectionState.Idle : ConnectionState.Connected,
      relaysOpen: 1,
      relaysTotal: 1,
      turnConfigured: false,
      stunAnswered: true,
      natHint: 'loopback',
      peers: Array.from(this.peers).map((peerId) => ({
        peerId,
        direct: true,
        iceCandidateTypes: ['host'],
        unreliableOpen: true,
        unreliableOrdered: false,
        unreliableMaxRetransmits: 0,
      })),
      errorDetail: '',
    };
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.hub.disconnectPeer(this.selfId);
  }

  public _addPeer(peerId: string): void {
    if (this.closed || this.peers.has(peerId)) return;
    this.peers.add(peerId);
    for (const h of this.joinHandlers) h(peerId);
  }

  public _removePeer(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    for (const h of this.leaveHandlers) h(peerId);
  }

  public _deliver(fromId: string, channel: ChannelKind, payload: Uint8Array): void {
    if (this.closed || !this.peers.has(fromId)) return;
    this.bandwidth.recordDown(payload.byteLength, this.hub.nowMs);
    for (const h of this.packetHandlers) h(fromId, channel, payload);
  }

  public _emitError(state: ConnectionState, detail: string): void {
    for (const h of this.errorHandlers) h(state, detail);
  }
}

export class LoopbackNetwork {
  public readonly profile: NetsimProfileSpec;
  private readonly rng: SeededRng;
  private readonly peers = new Map<string, LoopbackTransport>();
  private readonly links = new Map<string, LinkState>();
  private readonly queue: InFlightPacket[] = [];
  private nextSeq = 1;
  public nowMs = 0;

  public constructor(profileId: NetsimProfileId, seed: number) {
    this.profile = requireKey(NETSIM_PROFILES, profileId, 'NETSIM_PROFILES');
    this.rng = new SeededRng(seed);
  }

  public createPeer(peerId: string): LoopbackTransport {
    assert(!this.peers.has(peerId), ErrorCode.TransportError, `Duplicate peerId: ${peerId}`);
    const transport = new LoopbackTransport(this, peerId);
    const existing = Array.from(this.peers.values());
    this.peers.set(peerId, transport);
    for (const other of existing) {
      other._addPeer(peerId);
      transport._addPeer(other.selfId);
    }
    return transport;
  }

  public addPeer(peerId: string): LoopbackTransport {
    return this.createPeer(peerId);
  }

  public disconnectPeer(peerId: string): void {
    const leaving = this.peers.get(peerId);
    if (!leaving) return;
    this.peers.delete(peerId);
    for (const other of this.peers.values()) {
      leaving._removePeer(other.selfId);
      other._removePeer(peerId);
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const pkt = this.queue[i] as InFlightPacket;
      if (pkt.fromId === peerId || pkt.toId === peerId) this.queue.splice(i, 1);
    }
  }

  public getPeer(peerId: string): LoopbackTransport {
    return requireKey(this.peers, peerId, 'LoopbackNetwork.peers');
  }

  public enqueue(fromId: string, toId: string, channel: ChannelKind, payload: Uint8Array): void {
    const sender = this.peers.get(fromId);
    if (!sender || !this.peers.has(toId)) return;
    const copy = payload.slice();
    sender.bandwidth.recordUp(copy.byteLength, this.nowMs);

    const linkKey = `${fromId}->${toId}`;
    let link = this.links.get(linkKey);
    if (!link) {
      link = { burstDropRemaining: 0, reliableLastDeliverAtMs: this.nowMs };
      this.links.set(linkKey, link);
    }

    const baseOneWay = this.profile.rttMs * 0.5;
    const jitter = this.profile.jitterMs > 0 ? (this.rng.next() * 2 - 1) * this.profile.jitterMs : 0;
    const rawLatency = Math.max(0.5, baseOneWay + jitter);

    if (channel === ChannelKind.Reliable) {
      // Simulate SCTP retransmit delay if dropped on the wire, preserving strict per-link order.
      const droppedOnce = this.rng.next() < this.profile.lossRate;
      const retransmitDelay = droppedOnce ? this.profile.rttMs : 0;
      const deliverAtMs = Math.max(link.reliableLastDeliverAtMs + 0.001, this.nowMs + rawLatency + retransmitDelay);
      link.reliableLastDeliverAtMs = deliverAtMs;
      this.queue.push({ deliverAtMs, seq: this.nextSeq++, fromId, toId, channel, payload: copy });
      return;
    }

    if (link.burstDropRemaining > 0) {
      link.burstDropRemaining -= 1;
      return;
    }
    if (this.profile.lossRate > 0) {
      const triggerRate = this.profile.lossRate / Math.max(1, this.profile.burstLossLength);
      if (this.rng.next() < triggerRate) {
        link.burstDropRemaining = Math.max(0, this.profile.burstLossLength - 1);
        return;
      }
    }

    const reorderDelay = this.rng.next() < this.profile.reorderRate ? this.profile.jitterMs + 8 : 0;
    const deliverAtMs = this.nowMs + rawLatency + reorderDelay;
    this.queue.push({ deliverAtMs, seq: this.nextSeq++, fromId, toId, channel, payload: copy });

    if (this.rng.next() < this.profile.duplicateRate) {
      this.queue.push({
        deliverAtMs: deliverAtMs + 1 + this.rng.next() * 4,
        seq: this.nextSeq++,
        fromId,
        toId,
        channel,
        payload: copy.slice(),
      });
    }
  }

  public advanceMs(dtMs: number): void {
    assert(dtMs >= 0, ErrorCode.InvariantViolation, `dtMs must be >= 0, got ${dtMs}`);
    const targetMs = this.nowMs + dtMs;
    while (this.queue.length > 0) {
      this.queue.sort((a, b) => (a.deliverAtMs !== b.deliverAtMs ? a.deliverAtMs - b.deliverAtMs : a.seq - b.seq));
      const next = this.queue[0] as InFlightPacket;
      if (next.deliverAtMs > targetMs) break;
      this.queue.shift();
      this.nowMs = next.deliverAtMs;
      const target = this.peers.get(next.toId);
      if (target) target._deliver(next.fromId, next.channel, next.payload);
    }
    this.nowMs = targetMs;
  }
}
