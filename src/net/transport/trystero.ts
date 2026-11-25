import { joinRoom, getRelaySockets } from 'trystero';
import type { Room, RoomError, TurnServerConfig as TrysteroTurnConfig } from 'trystero';
import {
  APP_ID,
  NOSTR_RELAYS,
  STUN_SERVERS,
  TURN_CONFIG,
  UNRELIABLE_CHANNEL_ID,
  UNRELIABLE_CHANNEL_LABEL,
} from '../config';
import { ChannelKind, ConnectionState } from '../enums';
import type {
  ConnectionErrorHandler,
  PacketHandler,
  PeerDiagnostics,
  PeerEventHandler,
  Transport,
  TransportDiagnostics,
} from '../transport';
import { assert, assertNever, InvariantError } from '../../sim/assert';
import { ErrorCode } from '../../sim/enums';

export interface TrysteroTransportOptions {
  readonly roomCode: string;
  readonly forceFail?: boolean;
  readonly relayUrls?: readonly string[];
  readonly stunServers?: readonly RTCIceServer[];
  readonly probeNatOnStart?: boolean;
}

interface UnreliableState {
  channel: RTCDataChannel | null;
  open: boolean;
  ordered: boolean | null;
  maxRetransmits: number | null;
}

interface NatProbeResult {
  readonly stunAnswered: boolean;
  readonly natHint: string;
}

const RELAY_CHECK_TIMEOUT_MS = 6000;
const NAT_PROBE_TIMEOUT_MS = 3500;
const RELAY_REDUNDANCY = 5;

function parseCandidateType(candidateStr: string): string | null {
  const match = /\btyp\s+(host|srflx|prflx|relay)\b/.exec(candidateStr);
  return match?.[1] ?? null;
}

function parseSrflxPort(candidateStr: string): { address: string; port: number } | null {
  if (!/\btyp\s+srflx\b/.test(candidateStr)) return null;
  const parts = candidateStr.trim().split(/\s+/);
  // candidate:<foundation> <component> <protocol> <priority> <ip> <port> typ srflx ...
  if (parts.length < 8) return null;
  const address = parts[4];
  const portRaw = parts[5];
  if (address === undefined || portRaw === undefined) return null;
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) return null;
  return { address, port };
}

async function gatherSrflxFromServer(server: RTCIceServer): Promise<{ address: string; port: number } | null> {
  if (typeof RTCPeerConnection === 'undefined') return null;
  const pc = new RTCPeerConnection({ iceServers: [server] });
  pc.createDataChannel('nat-probe');
  return new Promise((resolve) => {
    let settled = false;
    let found: { address: string; port: number } | null = null;
    const finish = (result: { address: string; port: number } | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.onicecandidate = null;
      pc.onicegatheringstatechange = null;
      pc.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(found), NAT_PROBE_TIMEOUT_MS);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) {
        finish(found);
        return;
      }
      const parsed = parseSrflxPort(ev.candidate.candidate);
      if (parsed) {
        found = parsed;
        finish(found);
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') finish(found);
    };
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(null));
  });
}

export async function probeNatHint(
  stunServers: readonly RTCIceServer[] = STUN_SERVERS,
): Promise<NatProbeResult> {
  if (typeof RTCPeerConnection === 'undefined' || stunServers.length === 0) {
    return { stunAnswered: false, natHint: 'unavailable' };
  }
  const results = await Promise.all(stunServers.slice(0, 2).map((s) => gatherSrflxFromServer(s)));
  const first = results[0] ?? null;
  const second = results[1] ?? null;
  if (!first && !second) {
    return { stunAnswered: false, natHint: 'no-stun-response' };
  }
  if (first && second) {
    if (first.port === second.port && first.address === second.address) {
      return {
        stunAnswered: true,
        natHint: `endpoint-independent (port ${first.port})`,
      };
    }
    return {
      stunAnswered: true,
      natHint: `symmetric-likely (ports ${first.port} vs ${second.port})`,
    };
  }
  const single = first ?? second;
  assert(single !== null, ErrorCode.InvariantViolation, 'expected at least one STUN result');
  return {
    stunAnswered: true,
    natHint: `single-stun-only (port ${single.port})`,
  };
}

function toTrysteroTurnConfig(): TrysteroTurnConfig[] {
  return TURN_CONFIG.map((t) => {
    const urls = typeof t.urls === 'string' ? t.urls : [...t.urls];
    const out: TrysteroTurnConfig = { urls };
    if (t.username !== undefined) out.username = t.username;
    if (t.credential !== undefined) out.credential = t.credential;
    return out;
  });
}

async function readPeerCandidateTypes(pc: RTCPeerConnection | null): Promise<string[]> {
  if (!pc || typeof pc.getStats !== 'function') return [];
  const report = await pc.getStats();
  const types = new Set<string>();
  const candidateTypeById = new Map<string, string>();
  const activePairCandidateIds = new Set<string>();

  report.forEach((stat) => {
    const rec = stat as Record<string, unknown>;
    if (rec['type'] === 'local-candidate' || rec['type'] === 'remote-candidate') {
      const cType = rec['candidateType'];
      const id = rec['id'];
      if (typeof cType === 'string') {
        types.add(cType);
        if (typeof id === 'string') candidateTypeById.set(id, cType);
      }
    } else if (rec['type'] === 'candidate-pair') {
      if (rec['nominated'] === true || rec['state'] === 'succeeded') {
        const localId = rec['localCandidateId'];
        const remoteId = rec['remoteCandidateId'];
        if (typeof localId === 'string') activePairCandidateIds.add(localId);
        if (typeof remoteId === 'string') activePairCandidateIds.add(remoteId);
      }
    }
  });

  if (activePairCandidateIds.size > 0) {
    const activeTypes = new Set<string>();
    for (const id of activePairCandidateIds) {
      const t = candidateTypeById.get(id);
      if (t !== undefined) activeTypes.add(t);
    }
    if (activeTypes.size > 0) return [...activeTypes].sort();
  }
  return [...types].sort();
}

export async function createTrysteroTransport(options: TrysteroTransportOptions): Promise<Transport> {
  const roomCode = options.roomCode.trim();
  assert(roomCode.length > 0, ErrorCode.TransportError, 'roomCode must be non-empty');

  const forceFail = options.forceFail === true;
  const relayUrls = options.relayUrls ? [...options.relayUrls] : [...NOSTR_RELAYS];
  assert(relayUrls.length > 0, ErrorCode.TransportError, 'relayUrls must be non-empty');
  const stunServers = options.stunServers ? [...options.stunServers] : [...STUN_SERVERS];
  const turnConfig = toTrysteroTurnConfig();

  const packetHandlers = new Set<PacketHandler>();
  const peerJoinHandlers = new Set<PeerEventHandler>();
  const peerLeaveHandlers = new Set<PeerEventHandler>();
  const errorHandlers = new Set<ConnectionErrorHandler>();

  const peerIds = new Set<string>();
  const unreliableByPeer = new Map<string, UnreliableState>();
  const peerCandidateTypesSeen = new Map<string, Set<string>>();

  let closed = false;
  let state: ConnectionState = ConnectionState.Signalling;
  let errorDetail = '';
  let natProbe: NatProbeResult = { stunAnswered: false, natHint: 'probing' };

  const natProbePromise =
    options.probeNatOnStart === false
      ? Promise.resolve<NatProbeResult>({ stunAnswered: false, natHint: 'skipped' })
      : probeNatHint(stunServers).then((res) => {
          natProbe = res;
          return res;
        });

  const emitError = (nextState: ConnectionState, detail: string): void => {
    state = nextState;
    errorDetail = detail;
    for (const handler of errorHandlers) {
      handler(nextState, detail);
    }
  };

  const room: Room = joinRoom(
    {
      appId: APP_ID,
      password: roomCode,
      relayConfig: {
        urls: relayUrls,
        redundancy: Math.min(RELAY_REDUNDANCY, relayUrls.length),
      },
      rtcConfig: {
        iceServers: stunServers,
        iceTransportPolicy: forceFail ? 'relay' : 'all',
      },
      turnConfig,
    },
    roomCode,
  );

  const relAction = room.makeAction<Uint8Array>('rel');
  const unsubRelMessage = relAction.onMessage((data, ctx) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (const handler of packetHandlers) {
      handler(ctx.peerId, ChannelKind.Reliable, bytes);
    }
  });

  const attachUnreliableChannel = (peerId: string): void => {
    const peerInfo = room.getPeers()[peerId];
    const pc = peerInfo?.connection ?? null;
    if (!pc) {
      unreliableByPeer.set(peerId, {
        channel: null,
        open: false,
        ordered: null,
        maxRetransmits: null,
      });
      return;
    }

    const existing = unreliableByPeer.get(peerId);
    if (existing?.channel) return;

    const seenCandidates = peerCandidateTypesSeen.get(peerId) ?? new Set<string>();
    peerCandidateTypesSeen.set(peerId, seenCandidates);
    pc.addEventListener('icecandidate', (ev) => {
      if (!ev.candidate) return;
      const t = parseCandidateType(ev.candidate.candidate);
      if (t !== null) seenCandidates.add(t);
    });

    const channel = pc.createDataChannel(UNRELIABLE_CHANNEL_LABEL, {
      negotiated: true,
      id: UNRELIABLE_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
    channel.binaryType = 'arraybuffer';

    const entry: UnreliableState = {
      channel,
      open: channel.readyState === 'open',
      ordered: channel.ordered,
      maxRetransmits: channel.maxRetransmits,
    };
    unreliableByPeer.set(peerId, entry);

    channel.onopen = () => {
      entry.open = true;
      entry.ordered = channel.ordered;
      entry.maxRetransmits = channel.maxRetransmits;
    };
    channel.onclose = () => {
      entry.open = false;
    };
    channel.onerror = () => {
      entry.open = false;
    };
    channel.onmessage = (ev) => {
      const raw = ev.data;
      let bytes: Uint8Array;
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw);
      } else if (ArrayBuffer.isView(raw)) {
        bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
      } else {
        throw new InvariantError(ErrorCode.TransportError, 'Unexpected non-binary unreliable datachannel payload');
      }
      for (const handler of packetHandlers) {
        handler(peerId, ChannelKind.Unreliable, bytes);
      }
    };
  };

  const unsubPeerJoin = room.onPeerJoin(({ peerId }) => {
    peerIds.add(peerId);
    state = ConnectionState.Connected;
    attachUnreliableChannel(peerId);
    for (const handler of peerJoinHandlers) {
      handler(peerId);
    }
  });

  const unsubPeerLeave = room.onPeerLeave(({ peerId }) => {
    peerIds.delete(peerId);
    const entry = unreliableByPeer.get(peerId);
    if (entry?.channel && entry.channel.readyState !== 'closed') {
      entry.channel.close();
    }
    unreliableByPeer.delete(peerId);
    peerCandidateTypesSeen.delete(peerId);
    if (peerIds.size === 0 && state === ConnectionState.Connected) {
      state = ConnectionState.Signalling;
    }
    for (const handler of peerLeaveHandlers) {
      handler(peerId);
    }
  });

  const handleRoomError = (err: RoomError): void => {
    if (closed) return;
    switch (err.code) {
      case 'relay-failed':
        emitError(ConnectionState.RelayFailed, err.message);
        break;
      case 'peer-connect-failed':
        emitError(ConnectionState.PeerFailed, err.message);
        break;
      case 'room-full':
      case 'banned':
      case 'identity-failed':
      case 'plugin-failed':
      case 'decrypt-failed':
      case 'handshake-failed':
      case 'peer-error':
        emitError(ConnectionState.PeerFailed, `${err.code}: ${err.message}`);
        break;
      default:
        assertNever(err, 'RoomError');
    }
  };

  const unsubError = room.onError(handleRoomError);

  const relayWatchTimer = setTimeout(() => {
    if (closed || state !== ConnectionState.Signalling || peerIds.size > 0) return;
    const sockets = getRelaySockets();
    let openCount = 0;
    for (const ws of Object.values(sockets)) {
      if (ws.readyState === WebSocket.OPEN) openCount++;
    }
    if (openCount === 0) {
      emitError(ConnectionState.RelayFailed, 'No signaling relay opened within 6 seconds');
    }
  }, RELAY_CHECK_TIMEOUT_MS);

  const selfInfo = await room.getSelf();
  const selfId = selfInfo.peerId;
  assert(selfId.length > 0, ErrorCode.TransportError, 'Trystero getSelf returned empty peerId');

  // Attach to any peers that connected while getSelf() was resolving.
  for (const existingPeerId of Object.keys(room.getPeers())) {
    if (!peerIds.has(existingPeerId)) {
      peerIds.add(existingPeerId);
      state = ConnectionState.Connected;
      attachUnreliableChannel(existingPeerId);
    }
  }

  const send = (peerId: string, channel: ChannelKind, payload: Uint8Array): void => {
    if (closed) return;
    switch (channel) {
      case ChannelKind.Reliable:
        void relAction.send(payload, { target: peerId }).catch((err: unknown) => {
          if (!closed) {
            const msg = err instanceof Error ? err.message : String(err);
            emitError(ConnectionState.PeerFailed, `Reliable send failed (${peerId}): ${msg}`);
          }
        });
        break;
      case ChannelKind.Unreliable: {
        // ZERO FALLBACKS: never route Unreliable over Reliable. Drop if not open.
        const entry = unreliableByPeer.get(peerId);
        if (!entry?.channel || entry.channel.readyState !== 'open') {
          if (entry) entry.open = false;
          return;
        }
        entry.open = true;
        entry.channel.send(new Uint8Array(payload));
        break;
      }
      default:
        assertNever(channel, 'ChannelKind');
    }
  };

  const broadcast = (channel: ChannelKind, payload: Uint8Array): void => {
    for (const peerId of peerIds) {
      send(peerId, channel, payload);
    }
  };

  const getDiagnostics = async (): Promise<TransportDiagnostics> => {
    await natProbePromise.catch(() => undefined);
    const sockets = getRelaySockets();
    const socketValues = Object.values(sockets);
    const relaysOpen = socketValues.filter((ws) => ws.readyState === WebSocket.OPEN).length;
    const relaysTotal = relayUrls.length;

    const roomPeers = room.getPeers();
    const peerList: PeerDiagnostics[] = [];
    for (const peerId of peerIds) {
      const info = roomPeers[peerId];
      const pc = info?.connection ?? null;
      const statsTypes = await readPeerCandidateTypes(pc);
      const seenSet = peerCandidateTypesSeen.get(peerId);
      const mergedTypes = new Set<string>(statsTypes);
      if (seenSet) {
        for (const t of seenSet) mergedTypes.add(t);
      }

      const unreliable = unreliableByPeer.get(peerId);
      const isOpen = unreliable?.channel?.readyState === 'open';
      if (unreliable) unreliable.open = isOpen;

      peerList.push({
        peerId,
        direct: info?.direct ?? false,
        iceCandidateTypes: [...mergedTypes].sort(),
        unreliableOpen: isOpen,
        unreliableOrdered: unreliable?.ordered ?? null,
        unreliableMaxRetransmits: unreliable?.maxRetransmits ?? null,
      });
    }

    return {
      state,
      relaysOpen,
      relaysTotal,
      turnConfigured: turnConfig.length > 0,
      stunAnswered: natProbe.stunAnswered,
      natHint: natProbe.natHint,
      peers: peerList,
      errorDetail,
    };
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearTimeout(relayWatchTimer);
    unsubRelMessage();
    unsubPeerJoin();
    unsubPeerLeave();
    unsubError();
    for (const entry of unreliableByPeer.values()) {
      if (entry.channel && entry.channel.readyState !== 'closed') {
        entry.channel.close();
      }
    }
    unreliableByPeer.clear();
    peerCandidateTypesSeen.clear();
    peerIds.clear();
    packetHandlers.clear();
    peerJoinHandlers.clear();
    peerLeaveHandlers.clear();
    errorHandlers.clear();
    await room.leave();
  };

  return {
    selfId,
    send,
    broadcast,
    getPeerIds: () => [...peerIds],
    onPacket: (handler) => {
      packetHandlers.add(handler);
      return () => packetHandlers.delete(handler);
    },
    onPeerJoin: (handler) => {
      peerJoinHandlers.add(handler);
      return () => peerJoinHandlers.delete(handler);
    },
    onPeerLeave: (handler) => {
      peerLeaveHandlers.add(handler);
      return () => peerLeaveHandlers.delete(handler);
    },
    onError: (handler) => {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    getDiagnostics,
    close,
  };
}
