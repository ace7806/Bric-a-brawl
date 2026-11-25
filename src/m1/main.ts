import wordsData from '../../data/words.json';
import { BUILD_ID, PROTOCOL_VERSION } from '../net/config';
import { ChannelKind, ConnectionState } from '../net/enums';
import type { Transport, TransportDiagnostics } from '../net/transport';
import { createTrysteroTransport } from '../net/transport/trystero';
import { assert, assertNever, requireDefined } from '../sim/assert';
import { ErrorCode } from '../sim/enums';

const DEFAULT_TRAFFIC_SEC = 60;
const DEFAULT_HIDDEN_SEC = 30;
const DIAG_POLL_MS = 500;
const CLIENT_RATE_HZ = 60;
const HOST_RATE_HZ = 30;
const CLIENT_PACKET_BYTES = 16;
const HOST_PACKET_BYTES = 400;

const enum TrafficMsgKind {
  Data = 1,
  Ack = 2,
}

interface TrafficStats {
  role: 'client-sender' | 'host-sender' | 'none';
  durationSec: number;
  running: boolean;
  completed: boolean;
  sent: number;
  received: number;
  expectedRemoteSeq: number;
  remoteReceived: number;
  reordered: number;
  lossPct: number;
  rttMedianMs: number | null;
  rttP95Ms: number | null;
  jitterMs: number;
}

interface HiddenTabStats {
  durationSec: number;
  running: boolean;
  completed: boolean;
  workerLongestGapMs: number;
  mainLongestGapMs: number;
  workerTicks: number;
  mainTicks: number;
}

interface M1Report {
  buildId: string;
  protocolVersion: number;
  roomCode: string;
  forceFail: boolean;
  selfId: string;
  timeToFirstPeerMs: number | null;
  diagnostics: TransportDiagnostics | null;
  diagnosticsLine: string;
  traffic: TrafficStats;
  hiddenTab: HiddenTabStats;
  timestampUtc: string;
}

declare global {
  interface Window {
    __m1Report?: M1Report;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  return requireDefined(node as T | null, `#${id}`);
}

const roomInput = el<HTMLInputElement>('room-input');
const btnNewCode = el<HTMLButtonElement>('btn-new-code');
const btnJoin = el<HTMLButtonElement>('btn-join');
const btnFail = el<HTMLButtonElement>('btn-fail');
const btnLeave = el<HTMLButtonElement>('btn-leave');
const btnCopy = el<HTMLButtonElement>('btn-copy');
const copyStatus = el<HTMLSpanElement>('copy-status');
const shareLinkEl = el<HTMLDivElement>('share-link');
const selfIdEl = el<HTMLDivElement>('self-id');
const connStateEl = el<HTMLDivElement>('conn-state');
const relayCountEl = el<HTMLDivElement>('relay-count');
const natHintEl = el<HTMLDivElement>('nat-hint');
const firstPeerMsEl = el<HTMLDivElement>('first-peer-ms');
const peersEmptyEl = el<HTMLDivElement>('peers-empty');
const peersTableEl = el<HTMLTableElement>('peers-table');
const peersBodyEl = el<HTMLTableSectionElement>('peers-body');

const btnTraffic = el<HTMLButtonElement>('btn-traffic');
const trafficStatusEl = el<HTMLSpanElement>('traffic-status');
const trafficRoleEl = el<HTMLDivElement>('traffic-role');
const trafficRttEl = el<HTMLDivElement>('traffic-rtt');
const trafficJitterEl = el<HTMLDivElement>('traffic-jitter');
const trafficLossEl = el<HTMLDivElement>('traffic-loss');
const trafficReorderEl = el<HTMLDivElement>('traffic-reorder');
const trafficCountsEl = el<HTMLDivElement>('traffic-counts');

const btnHidden = el<HTMLButtonElement>('btn-hidden');
const hiddenStatusEl = el<HTMLSpanElement>('hidden-status');
const workerGapEl = el<HTMLDivElement>('worker-gap');
const mainGapEl = el<HTMLDivElement>('main-gap');
const timerTicksEl = el<HTMLDivElement>('timer-ticks');

const errorScreenEl = el<HTMLElement>('error-screen');
const errorMetaEl = el<HTMLDivElement>('error-meta');
const errorHeadlineEl = el<HTMLHeadingElement>('error-headline');
const errorBodyEl = el<HTMLParagraphElement>('error-body');
const errorDiagTextEl = el<HTMLPreElement>('error-diag-text');
const btnErrorCopy = el<HTMLButtonElement>('btn-error-copy');
const btnErrorRetry = el<HTMLButtonElement>('btn-error-retry');
const btnErrorDismiss = el<HTMLButtonElement>('btn-error-dismiss');

function pickRandomWord(list: readonly string[]): string {
  assert(list.length > 0, ErrorCode.MissingRequiredEntry, 'roomWords column is empty');
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const idx = requireDefined(buf[0], 'crypto random uint32') % list.length;
  return requireDefined(list[idx], 'roomWord');
}

function generateRoomCode(): string {
  const cols = wordsData.roomWords;
  assert(cols.length === 3, ErrorCode.SchemaValidationFailed, 'words.json roomWords must have 3 lists');
  return `${pickRandomWord(cols[0] ?? [])}-${pickRandomWord(cols[1] ?? [])}-${pickRandomWord(cols[2] ?? [])}`;
}

function parsePositiveSec(raw: string | null, fallbackDefault: number): number {
  if (raw === null) return fallbackDefault;
  const parsed = Number(raw);
  assert(Number.isFinite(parsed) && parsed > 0, ErrorCode.SchemaValidationFailed, `Invalid duration seconds: ${raw}`);
  return parsed;
}

function parseInitialParams(): {
  roomCode: string;
  autoJoin: boolean;
  forceFail: boolean;
  trafficSec: number;
  hiddenSec: number;
  relays: string[] | null;
} {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '');
  const queryRoom = url.searchParams.get('room');
  const hashRoom = hashParams.get('r');
  const roomCode = (queryRoom ?? hashRoom ?? '').trim() || generateRoomCode();
  const autoJoin = url.searchParams.get('autojoin') === '1';
  const forceFail = url.searchParams.get('fail') === '1';
  const trafficSec = parsePositiveSec(url.searchParams.get('trafficSec'), DEFAULT_TRAFFIC_SEC);
  const hiddenSec = parsePositiveSec(url.searchParams.get('hiddenSec'), DEFAULT_HIDDEN_SEC);
  const relaysParam = url.searchParams.get('relays');
  const relays = relaysParam
    ? relaysParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : null;
  return { roomCode, autoJoin, forceFail, trafficSec, hiddenSec, relays };
}

const configParams = parseInitialParams();

let transport: Transport | null = null;
let diagTimer: ReturnType<typeof setInterval> | null = null;
let joinStartedAtMs = 0;
let firstPeerMs: number | null = null;
let currentForceFail = configParams.forceFail;
let lastDiagnostics: TransportDiagnostics | null = null;
let activeTrafficStop: (() => void) | null = null;
let activeHiddenStop: (() => void) | null = null;

const trafficStats: TrafficStats = {
  role: 'none',
  durationSec: configParams.trafficSec,
  running: false,
  completed: false,
  sent: 0,
  received: 0,
  expectedRemoteSeq: 0,
  remoteReceived: 0,
  reordered: 0,
  lossPct: 0,
  rttMedianMs: null,
  rttP95Ms: null,
  jitterMs: 0,
};

const hiddenStats: HiddenTabStats = {
  durationSec: configParams.hiddenSec,
  running: false,
  completed: false,
  workerLongestGapMs: 0,
  mainLongestGapMs: 0,
  workerTicks: 0,
  mainTicks: 0,
};

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Idle:
      return 'Idle';
    case ConnectionState.Signalling:
      return 'Signalling';
    case ConnectionState.Connected:
      return 'Connected';
    case ConnectionState.PeerFailed:
      return 'PeerFailed';
    case ConnectionState.RelayFailed:
      return 'RelayFailed';
    case ConnectionState.VersionMismatch:
      return 'VersionMismatch';
    default:
      return assertNever(state, 'ConnectionState');
  }
}

function buildDiagnosticsLine(diag: TransportDiagnostics | null): string {
  const relaysOpen = diag?.relaysOpen ?? 0;
  const relaysTotal = diag?.relaysTotal ?? 5;
  const stunText = diag?.stunAnswered ? `STUN answered (${diag.natHint})` : `STUN unanswered (${diag?.natHint ?? 'none'})`;
  const allCandidates = new Set<string>();
  let directCount = 0;
  const peerCount = diag?.peers.length ?? 0;
  for (const peer of diag?.peers ?? []) {
    if (peer.direct) directCount++;
    for (const c of peer.iceCandidateTypes) allCandidates.add(c);
  }
  const candText = allCandidates.size > 0 ? [...allCandidates].join(', ') : 'none';
  const turnText = String(diag?.turnConfigured ?? false);
  return [
    `BB-ICE-FAILED · build ${BUILD_ID} · protocol ${PROTOCOL_VERSION}`,
    `relays ${relaysOpen} of ${relaysTotal} reached · ${stunText} · candidates: ${candText}`,
    `peers ${directCount} of ${peerCount} direct · turnConfigured: ${turnText}`,
  ].join('\n');
}

function buildReport(): M1Report {
  return {
    buildId: BUILD_ID,
    protocolVersion: PROTOCOL_VERSION,
    roomCode: roomInput.value.trim(),
    forceFail: currentForceFail,
    selfId: transport?.selfId ?? '',
    timeToFirstPeerMs: firstPeerMs,
    diagnostics: lastDiagnostics,
    diagnosticsLine: buildDiagnosticsLine(lastDiagnostics),
    traffic: { ...trafficStats },
    hiddenTab: { ...hiddenStats },
    timestampUtc: new Date().toISOString(),
  };
}

function syncShareLink(): void {
  const code = roomInput.value.trim();
  const url = new URL(window.location.href);
  url.hash = code.length > 0 ? `r=${encodeURIComponent(code)}` : '';
  shareLinkEl.textContent = url.toString();
}

function percentile(sorted: readonly number[], p: number): number {
  assert(sorted.length > 0, ErrorCode.IndexOutOfBounds, 'percentile requires non-empty array');
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] as number;
}

function renderTraffic(): void {
  trafficRoleEl.textContent = trafficStats.role;
  trafficRttEl.textContent =
    trafficStats.rttMedianMs !== null && trafficStats.rttP95Ms !== null
      ? `${trafficStats.rttMedianMs.toFixed(1)} ms / ${trafficStats.rttP95Ms.toFixed(1)} ms`
      : '—';
  trafficJitterEl.textContent = `${trafficStats.jitterMs.toFixed(2)} ms`;
  trafficLossEl.textContent = `${trafficStats.lossPct.toFixed(2)}%`;
  trafficReorderEl.textContent = String(trafficStats.reordered);
  trafficCountsEl.textContent = `${trafficStats.sent} / ${trafficStats.received}`;
}

function renderHidden(): void {
  workerGapEl.textContent = hiddenStats.workerTicks > 0 ? `${hiddenStats.workerLongestGapMs.toFixed(1)} ms` : '—';
  mainGapEl.textContent = hiddenStats.mainTicks > 0 ? `${hiddenStats.mainLongestGapMs.toFixed(1)} ms` : '—';
  timerTicksEl.textContent = `${hiddenStats.workerTicks} / ${hiddenStats.mainTicks}`;
}

function renderDiagnostics(diag: TransportDiagnostics | null): void {
  lastDiagnostics = diag;
  if (!diag) {
    connStateEl.textContent = 'Idle';
    relayCountEl.textContent = '0 of 5';
    natHintEl.textContent = 'Pending';
    peersEmptyEl.hidden = false;
    peersTableEl.hidden = true;
    peersBodyEl.replaceChildren();
    btnTraffic.disabled = true;
  } else {
    connStateEl.textContent = connectionStateLabel(diag.state);
    relayCountEl.textContent = `${diag.relaysOpen} of ${diag.relaysTotal}`;
    natHintEl.textContent = diag.stunAnswered ? `STUN OK · ${diag.natHint}` : `No STUN · ${diag.natHint}`;
    firstPeerMsEl.textContent = firstPeerMs !== null ? `${Math.round(firstPeerMs)} ms` : '—';

    peersBodyEl.replaceChildren();
    if (diag.peers.length === 0) {
      peersEmptyEl.hidden = false;
      peersTableEl.hidden = true;
      btnTraffic.disabled = true;
    } else {
      peersEmptyEl.hidden = true;
      peersTableEl.hidden = false;
      const anyUnreliableOpen = diag.peers.some((p) => p.unreliableOpen);
      btnTraffic.disabled = trafficStats.running || !anyUnreliableOpen;

      for (const p of diag.peers) {
        const tr = document.createElement('tr');
        const cells = [
          p.peerId.slice(0, 10),
          p.direct ? 'direct' : 'indirect',
          p.iceCandidateTypes.length > 0 ? p.iceCandidateTypes.join(', ') : 'gathering',
          p.unreliableOpen ? 'open' : 'closed',
          p.unreliableOrdered === null ? '—' : String(p.unreliableOrdered),
          p.unreliableMaxRetransmits === null ? '—' : String(p.unreliableMaxRetransmits),
        ];
        for (const text of cells) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        }
        peersBodyEl.appendChild(tr);
      }
    }
  }
  window.__m1Report = buildReport();
}

function showErrorScreen(state: ConnectionState, detail: string, diag: TransportDiagnostics | null): void {
  errorMetaEl.textContent = `Room ${roomInput.value.trim()} · ${connectionStateLabel(state)}`;
  if (state === ConnectionState.RelayFailed) {
    errorHeadlineEl.textContent = "Can't reach the lobby service.";
    errorBodyEl.textContent = `No signaling relay answered (${detail}). Check your connection or firewall and try again.`;
  } else {
    errorHeadlineEl.textContent = "You and the host can't shake hands.";
    errorBodyEl.textContent =
      "Your network and the host's network both refuse direct connections, so the two of you can't reach each other. Nobody did anything wrong, and this game has no relay server to go through.";
  }
  errorDiagTextEl.textContent = buildDiagnosticsLine(diag);
  errorScreenEl.hidden = false;
}

async function copyText(text: string, statusTarget: HTMLElement): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    statusTarget.textContent = 'Copied';
    setTimeout(() => {
      statusTarget.textContent = '';
    }, 2000);
  }
}

async function refreshDiagnostics(): Promise<void> {
  if (!transport) return;
  const diag = await transport.getDiagnostics();
  renderDiagnostics(diag);
  if (diag.state === ConnectionState.PeerFailed || diag.state === ConnectionState.RelayFailed) {
    showErrorScreen(diag.state, diag.errorDetail, diag);
  }
}

async function leaveRoom(): Promise<void> {
  activeTrafficStop?.();
  activeHiddenStop?.();
  if (diagTimer !== null) {
    clearInterval(diagTimer);
    diagTimer = null;
  }
  if (transport) {
    const current = transport;
    transport = null;
    await current.close();
  }
  firstPeerMs = null;
  firstPeerMsEl.textContent = '—';
  selfIdEl.textContent = '—';
  btnJoin.disabled = false;
  btnFail.disabled = false;
  btnLeave.disabled = true;
  renderDiagnostics(null);
}

async function joinSelectedRoom(forceFail: boolean): Promise<void> {
  await leaveRoom();
  const code = roomInput.value.trim();
  if (code.length === 0) return;

  currentForceFail = forceFail;
  errorScreenEl.hidden = true;
  syncShareLink();
  window.location.hash = `r=${encodeURIComponent(code)}`;

  btnJoin.disabled = true;
  btnFail.disabled = true;
  btnLeave.disabled = false;
  connStateEl.textContent = 'Signalling';
  joinStartedAtMs = performance.now();

  const opts = {
    roomCode: code,
    forceFail,
    ...(configParams.relays ? { relayUrls: configParams.relays } : {}),
  };

  const t = await createTrysteroTransport(opts);
  transport = t;
  selfIdEl.textContent = t.selfId;

  t.onPeerJoin(() => {
    if (firstPeerMs === null) {
      firstPeerMs = performance.now() - joinStartedAtMs;
    }
    void refreshDiagnostics();
  });

  t.onPeerLeave(() => {
    void refreshDiagnostics();
  });

  t.onError((state, detail) => {
    void t.getDiagnostics().then((diag) => {
      renderDiagnostics(diag);
      showErrorScreen(state, detail, diag);
    });
  });

  t.onPacket((peerId, channel, payload) => {
    if (channel !== ChannelKind.Unreliable || payload.byteLength < 10) return;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const kind = view.getUint8(0);
    const seq = view.getUint32(2, true);
    const sentAt = view.getFloat32(6, true);
    if (kind === TrafficMsgKind.Data) {
      trafficStats.received++;
      if (seq < trafficStats.expectedRemoteSeq) {
        trafficStats.reordered++;
      } else {
        trafficStats.expectedRemoteSeq = seq + 1;
      }
      trafficStats.remoteReceived = Math.max(trafficStats.remoteReceived, seq + 1);
      const ack = new Uint8Array(10);
      const ackView = new DataView(ack.buffer);
      ackView.setUint8(0, TrafficMsgKind.Ack);
      ackView.setUint32(2, seq, true);
      ackView.setFloat32(6, sentAt, true);
      t.send(peerId, ChannelKind.Unreliable, ack);
      renderTraffic();
      window.__m1Report = buildReport();
    }
  });

  await refreshDiagnostics();
  diagTimer = setInterval(() => {
    void refreshDiagnostics();
  }, DIAG_POLL_MS);
}

function startTrafficTest(): void {
  if (!transport || trafficStats.running) return;
  const peers = transport.getPeerIds();
  const targetPeer = peers[0];
  if (!targetPeer) return;

  const isClientSender = transport.selfId < targetPeer;
  const rateHz = isClientSender ? CLIENT_RATE_HZ : HOST_RATE_HZ;
  const payloadBytes = isClientSender ? CLIENT_PACKET_BYTES : HOST_PACKET_BYTES;
  const intervalMs = 1000 / rateHz;

  trafficStats.role = isClientSender ? 'client-sender' : 'host-sender';
  trafficStats.durationSec = configParams.trafficSec;
  trafficStats.running = true;
  trafficStats.completed = false;
  trafficStats.sent = 0;
  trafficStats.received = 0;
  trafficStats.expectedRemoteSeq = 0;
  trafficStats.remoteReceived = 0;
  trafficStats.reordered = 0;
  trafficStats.lossPct = 0;
  trafficStats.rttMedianMs = null;
  trafficStats.rttP95Ms = null;
  trafficStats.jitterMs = 0;

  const rtts: number[] = [];
  let prevTransit: number | null = null;
  let jitter = 0;
  let ackCount = 0;
  let seq = 0;
  const packet = new Uint8Array(payloadBytes);
  const packetView = new DataView(packet.buffer);
  packetView.setUint8(0, TrafficMsgKind.Data);

  const unsubAck = transport.onPacket((_peerId, channel, payload) => {
    if (channel !== ChannelKind.Unreliable || payload.byteLength < 10) return;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (view.getUint8(0) !== TrafficMsgKind.Ack) return;
    const sentAt = view.getFloat32(6, true);
    const now = performance.now();
    const rtt = Math.max(0, now - sentAt);
    rtts.push(rtt);
    ackCount++;
    if (prevTransit !== null) {
      const d = Math.abs(rtt - prevTransit);
      jitter += (d - jitter) / 16;
    }
    prevTransit = rtt;
    trafficStats.jitterMs = jitter;
    if (trafficStats.sent > 0) {
      trafficStats.lossPct = Math.max(0, ((trafficStats.sent - ackCount) / trafficStats.sent) * 100);
    }
    const sorted = [...rtts].sort((a, b) => a - b);
    trafficStats.rttMedianMs = percentile(sorted, 0.5);
    trafficStats.rttP95Ms = percentile(sorted, 0.95);
    renderTraffic();
    window.__m1Report = buildReport();
  });

  btnTraffic.disabled = true;
  const startMs = performance.now();
  const durationMs = configParams.trafficSec * 1000;
  trafficStatusEl.textContent = `Running (${configParams.trafficSec}s)...`;

  const stop = (completed: boolean): void => {
    clearInterval(sendTimer);
    unsubAck();
    trafficStats.running = false;
    trafficStats.completed = completed;
    if (trafficStats.sent > 0) {
      trafficStats.lossPct = Math.max(0, ((trafficStats.sent - ackCount) / trafficStats.sent) * 100);
    }
    trafficStatusEl.textContent = completed ? 'Complete' : 'Stopped';
    btnTraffic.disabled = (transport?.getPeerIds().length ?? 0) === 0;
    renderTraffic();
    window.__m1Report = buildReport();
    activeTrafficStop = null;
  };

  activeTrafficStop = () => stop(false);

  const sendTimer = setInterval(() => {
    if (!transport) {
      stop(false);
      return;
    }
    const elapsed = performance.now() - startMs;
    if (elapsed >= durationMs) {
      stop(true);
      return;
    }
    packetView.setUint32(2, seq++, true);
    packetView.setFloat32(6, performance.now(), true);
    transport.send(targetPeer, ChannelKind.Unreliable, packet);
    trafficStats.sent++;
    if (trafficStats.sent % 10 === 0) {
      renderTraffic();
      window.__m1Report = buildReport();
    }
  }, intervalMs);
}

function startHiddenTabTest(): void {
  if (hiddenStats.running) return;
  hiddenStats.durationSec = configParams.hiddenSec;
  hiddenStats.running = true;
  hiddenStats.completed = false;
  hiddenStats.workerLongestGapMs = 0;
  hiddenStats.mainLongestGapMs = 0;
  hiddenStats.workerTicks = 0;
  hiddenStats.mainTicks = 0;
  btnHidden.disabled = true;
  hiddenStatusEl.textContent = `Running (${configParams.hiddenSec}s)...`;

  const worker = new Worker(new URL('./timerWorker.ts', import.meta.url), { type: 'module' });
  let lastMainMs = performance.now();
  let mainTimer: ReturnType<typeof setInterval> | null = null;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = (completed: boolean): void => {
    worker.postMessage({ type: 'stop' });
    worker.terminate();
    if (mainTimer !== null) clearInterval(mainTimer);
    if (endTimer !== null) clearTimeout(endTimer);
    hiddenStats.running = false;
    hiddenStats.completed = completed;
    btnHidden.disabled = false;
    hiddenStatusEl.textContent = completed ? 'Complete' : 'Stopped';
    renderHidden();
    window.__m1Report = buildReport();
    activeHiddenStop = null;
  };

  activeHiddenStop = () => stop(false);

  worker.onmessage = (ev: MessageEvent<{ now: number; deltaMs: number }>) => {
    hiddenStats.workerTicks++;
    if (ev.data.deltaMs > hiddenStats.workerLongestGapMs) {
      hiddenStats.workerLongestGapMs = ev.data.deltaMs;
    }
    renderHidden();
  };

  mainTimer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastMainMs;
    lastMainMs = now;
    hiddenStats.mainTicks++;
    if (gap > hiddenStats.mainLongestGapMs) {
      hiddenStats.mainLongestGapMs = gap;
    }
    renderHidden();
    window.__m1Report = buildReport();
  }, 16);

  worker.postMessage({ type: 'start' });
  endTimer = setTimeout(() => stop(true), configParams.hiddenSec * 1000);
}

roomInput.value = configParams.roomCode;
syncShareLink();
renderTraffic();
renderHidden();
window.__m1Report = buildReport();

btnNewCode.addEventListener('click', () => {
  roomInput.value = generateRoomCode();
  syncShareLink();
});

roomInput.addEventListener('input', syncShareLink);

btnJoin.addEventListener('click', () => {
  void joinSelectedRoom(false);
});

btnFail.addEventListener('click', () => {
  void joinSelectedRoom(true);
});

btnLeave.addEventListener('click', () => {
  void leaveRoom();
});

btnTraffic.addEventListener('click', startTrafficTest);
btnHidden.addEventListener('click', startHiddenTabTest);

btnCopy.addEventListener('click', () => {
  const json = JSON.stringify(buildReport(), null, 2);
  void copyText(json, copyStatus);
});

btnErrorCopy.addEventListener('click', () => {
  void copyText(errorDiagTextEl.textContent ?? '', copyStatus);
});

btnErrorRetry.addEventListener('click', () => {
  errorScreenEl.hidden = true;
  void joinSelectedRoom(false);
});

btnErrorDismiss.addEventListener('click', () => {
  errorScreenEl.hidden = true;
});

if (configParams.autoJoin) {
  void joinSelectedRoom(configParams.forceFail);
}
