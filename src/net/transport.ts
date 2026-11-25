import { ChannelKind, ConnectionState } from './enums';

export interface PeerDiagnostics {
  readonly peerId: string;
  readonly direct: boolean;
  readonly iceCandidateTypes: readonly string[];
  readonly unreliableOpen: boolean;
  readonly unreliableOrdered: boolean | null;
  readonly unreliableMaxRetransmits: number | null;
}

export interface TransportDiagnostics {
  readonly state: ConnectionState;
  readonly relaysOpen: number;
  readonly relaysTotal: number;
  readonly turnConfigured: boolean;
  readonly stunAnswered: boolean;
  readonly natHint: string;
  readonly peers: readonly PeerDiagnostics[];
  readonly errorDetail: string;
}

export type PacketHandler = (peerId: string, channel: ChannelKind, payload: Uint8Array) => void;
export type PeerEventHandler = (peerId: string) => void;
export type ConnectionErrorHandler = (state: ConnectionState, detail: string) => void;

export interface Transport {
  readonly selfId: string;
  send(peerId: string, channel: ChannelKind, payload: Uint8Array): void;
  broadcast(channel: ChannelKind, payload: Uint8Array): void;
  getPeerIds(): readonly string[];
  onPacket(handler: PacketHandler): () => void;
  onPeerJoin(handler: PeerEventHandler): () => void;
  onPeerLeave(handler: PeerEventHandler): () => void;
  onError(handler: ConnectionErrorHandler): () => void;
  getDiagnostics(): Promise<TransportDiagnostics>;
  close(): Promise<void>;
}
