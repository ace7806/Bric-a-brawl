export interface TurnServerConfig {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

// TURN SLOT — add TURN server credentials here without modifying transport code (MASTER_DESIGN 7.3.9)
export const TURN_CONFIG: readonly TurnServerConfig[] = [];

export const STUN_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export const NOSTR_RELAYS: readonly string[] = [
  'wss://fanfares.nostr1.com',
  'wss://nostr.wine',
  'wss://no.str.cr',
  'wss://nos.lol',
  'wss://bucket.coracle.social',
];

export const PROTOCOL_VERSION = 1;
export const BUILD_ID = '0.1.0';
export const APP_ID = 'bric-a-brawl-v1';

export const UNRELIABLE_CHANNEL_LABEL = 'bb';
export const UNRELIABLE_CHANNEL_ID = 7;

export const PACKET_OVERHEAD_BYTES = 85;
export const CLIENT_DOWN_BUDGET_BPS = 20_000;
export const CLIENT_UP_BUDGET_BPS = 8_000;
export const HOST_UP_BUDGET_BPS = 150_000; // 1.2 Mbit/s
