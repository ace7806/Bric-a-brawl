import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, normalize, relative, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = resolve(ROOT, 'dist');
const EVIDENCE_DIR = resolve(ROOT, 'evidence/M1');
const CHROME_PATH = '/usr/bin/google-chrome';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

interface PeerReport {
  peerId: string;
  direct: boolean;
  iceCandidateTypes: string[];
  unreliableOpen: boolean;
  unreliableOrdered: boolean | null;
  unreliableMaxRetransmits: number | null;
}

interface DiagnosticsReport {
  state: number;
  relaysOpen: number;
  relaysTotal: number;
  turnConfigured: boolean;
  stunAnswered: boolean;
  natHint: string;
  peers: PeerReport[];
  errorDetail: string;
}

interface TrafficReport {
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

interface M1Report {
  buildId: string;
  protocolVersion: number;
  roomCode: string;
  forceFail: boolean;
  selfId: string;
  timeToFirstPeerMs: number | null;
  diagnostics: DiagnosticsReport | null;
  diagnosticsLine: string;
  traffic: TrafficReport;
  timestampUtc: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function uniqueRoom(tag: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `m1-${tag}-${Date.now().toString(36)}-${rand}`;
}

function median(values: readonly number[]): number {
  assert(values.length > 0, 'median requires at least one value');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function startStaticServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  assert(existsSync(resolve(DIST_DIR, 'm1.html')), `Missing ${resolve(DIST_DIR, 'm1.html')} — run build first`);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    const cleaned = normalize(rawPath === '/' ? '/m1.html' : rawPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(DIST_DIR, `.${cleaned.startsWith('/') ? cleaned : `/${cleaned}`}`);
    const rel = relative(DIST_DIR, filePath);
    if (rel.startsWith('..') || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) {
        rejectPromise(new Error('Failed to bind ephemeral port'));
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}

async function getReport(page: Page): Promise<M1Report | null> {
  return page.evaluate(() => (window as unknown as { __m1Report?: M1Report }).__m1Report ?? null);
}

async function waitForUnreliablePeer(page: Page, timeoutMs: number): Promise<M1Report> {
  const handle = await page.waitForFunction(
    () => {
      const r = (window as unknown as { __m1Report?: M1Report }).__m1Report;
      if (!r || !r.diagnostics || r.diagnostics.peers.length === 0) return null;
      const p = r.diagnostics.peers[0];
      if (!p || !p.unreliableOpen) return null;
      return r;
    },
    undefined,
    { timeout: timeoutMs, polling: 150 },
  );
  return (await handle.jsonValue()) as M1Report;
}

async function waitForTrafficComplete(page: Page, timeoutMs: number): Promise<M1Report> {
  const handle = await page.waitForFunction(
    () => {
      const r = (window as unknown as { __m1Report?: M1Report }).__m1Report;
      return r && r.traffic.completed ? r : null;
    },
    undefined,
    { timeout: timeoutMs, polling: 200 },
  );
  return (await handle.jsonValue()) as M1Report;
}

function attachPageLogs(page: Page, label: string, errors: string[]): void {
  page.on('pageerror', (err) => errors.push(`${label} pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${label} console.error: ${msg.text()}`);
  });
}

async function runM12AndM14(browser: Browser, baseUrl: string) {
  const room = uniqueRoom('pair');
  const url = `${baseUrl}/m1.html?room=${encodeURIComponent(room)}&autojoin=1&trafficSec=4&hiddenSec=2`;
  const errors: string[] = [];

  const ctxA: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const ctxB: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    attachPageLogs(pageA, 'peerA', errors);
    attachPageLogs(pageB, 'peerB', errors);

    await Promise.all([pageA.goto(url, { waitUntil: 'domcontentloaded' }), pageB.goto(url, { waitUntil: 'domcontentloaded' })]);

    const [joinReportA, joinReportB] = await Promise.all([
      waitForUnreliablePeer(pageA, 20_000),
      waitForUnreliablePeer(pageB, 20_000),
    ]);

    const peerA = joinReportA.diagnostics!.peers[0]!;
    const peerB = joinReportB.diagnostics!.peers[0]!;
    assert(peerA.peerId === joinReportB.selfId, `peerA saw ${peerA.peerId}, expected ${joinReportB.selfId}`);
    assert(peerB.peerId === joinReportA.selfId, `peerB saw ${peerB.peerId}, expected ${joinReportA.selfId}`);

    for (const [tag, p] of [
      ['peerA', peerA],
      ['peerB', peerB],
    ] as const) {
      assert(p.unreliableOpen === true, `${tag}: unreliableOpen expected true, got ${String(p.unreliableOpen)}`);
      assert(p.unreliableOrdered === false, `${tag}: unreliableOrdered expected false, got ${String(p.unreliableOrdered)}`);
      assert(p.unreliableMaxRetransmits === 0, `${tag}: unreliableMaxRetransmits expected 0, got ${String(p.unreliableMaxRetransmits)}`);
    }

    // Trigger traffic test on the designated sender (m1.ts assigns role = selfId < peerId ? 'client-sender' : 'host-sender')
    await pageA.click('#btn-traffic');
    const finalA = await waitForTrafficComplete(pageA, 15_000);
    const finalB = await getReport(pageB);
    assert(finalB !== null, 'peerB __m1Report missing after traffic test');

    assert(finalA.traffic.sent > 0, `peerA sent=${finalA.traffic.sent}, expected > 0`);
    assert(finalB.traffic.received > 0, `peerB received=${finalB.traffic.received}, expected > 0`);
    assert(finalA.traffic.lossPct < 50, `peerA lossPct=${finalA.traffic.lossPct.toFixed(2)}% >= 50%`);

    await pageA.screenshot({ path: resolve(EVIDENCE_DIR, 'm1-two-peers.png'), fullPage: true });

    return {
      passed: true,
      roomCode: room,
      peerA: {
        selfId: finalA.selfId,
        timeToFirstPeerMs: finalA.timeToFirstPeerMs,
        relaysOpen: finalA.diagnostics?.relaysOpen ?? 0,
        peer: peerA,
        traffic: finalA.traffic,
      },
      peerB: {
        selfId: finalB.selfId,
        timeToFirstPeerMs: finalB.timeToFirstPeerMs,
        relaysOpen: finalB.diagnostics?.relaysOpen ?? 0,
        peer: peerB,
        traffic: finalB.traffic,
      },
      pageErrors: errors,
    };
  } finally {
    await Promise.allSettled([ctxA.close(), ctxB.close()]);
  }
}

async function runM13JoinTrials(browser: Browser, baseUrl: string, trialCount = 10) {
  const trials: Array<{ trial: number; roomCode: string; loadToPeerMs: number; peerReportedMs: number | null }> = [];

  for (let i = 1; i <= trialCount; i++) {
    const room = uniqueRoom(`t${i}`);
    const url = `${baseUrl}/m1.html?room=${encodeURIComponent(room)}&autojoin=1`;
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      const t0 = performance.now();
      await Promise.all([pageA.goto(url, { waitUntil: 'domcontentloaded' }), pageB.goto(url, { waitUntil: 'domcontentloaded' })]);
      const [repA, repB] = await Promise.all([
        waitForUnreliablePeer(pageA, 12_000),
        waitForUnreliablePeer(pageB, 12_000),
      ]);
      const elapsedMs = performance.now() - t0;
      const reportedMs =
        repA.timeToFirstPeerMs !== null && repB.timeToFirstPeerMs !== null
          ? Math.max(repA.timeToFirstPeerMs, repB.timeToFirstPeerMs)
          : repA.timeToFirstPeerMs ?? repB.timeToFirstPeerMs;
      trials.push({
        trial: i,
        roomCode: room,
        loadToPeerMs: Number(elapsedMs.toFixed(1)),
        peerReportedMs: reportedMs !== null ? Number(reportedMs.toFixed(1)) : null,
      });
    } finally {
      await Promise.allSettled([ctxA.close(), ctxB.close()]);
    }
  }

  const medianLoadToPeerMs = Number(median(trials.map((t) => t.loadToPeerMs)).toFixed(1));
  assert(medianLoadToPeerMs < 5000, `M1.3 median join time ${medianLoadToPeerMs} ms >= 5000 ms`);

  return {
    passed: true,
    trialCount,
    medianLoadToPeerMs,
    budgetMs: 5000,
    trials,
  };
}

async function runM15ForcedFail(browser: Browser, baseUrl: string) {
  const room = uniqueRoom('fail');
  const url = `${baseUrl}/m1.html?room=${encodeURIComponent(room)}&autojoin=1&fail=1`;
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([pageA.goto(url, { waitUntil: 'domcontentloaded' }), pageB.goto(url, { waitUntil: 'domcontentloaded' })]);

    // Two peers with iceTransportPolicy: 'relay' and no TURN will exchange SDP and emit peer-connect-failed (~23s Trystero answer/offer TTL, or faster if ICE transitions to failed)
    await pageA.waitForSelector('#error-screen:not([hidden])', { state: 'visible', timeout: 35_000 });
    const diagText = (await pageA.locator('#error-diag-text').textContent()) ?? '';
    const headline = (await pageA.locator('#error-headline').textContent()) ?? '';

    assert(diagText.includes('BB-ICE-FAILED'), `Expected BB-ICE-FAILED in #error-diag-text, got: ${diagText}`);
    assert(diagText.includes('turnConfigured: false'), `Expected turnConfigured: false in #error-diag-text, got: ${diagText}`);

    await pageA.screenshot({ path: resolve(EVIDENCE_DIR, 'm1-forced-fail.png'), fullPage: true });
    const report = await getReport(pageA);

    return {
      passed: true,
      roomCode: room,
      headline: headline.trim(),
      diagnosticsLine: diagText.trim(),
      turnConfigured: report?.diagnostics?.turnConfigured ?? false,
      state: report?.diagnostics?.state ?? null,
    };
  } finally {
    await Promise.allSettled([ctxA.close(), ctxB.close()]);
  }
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const m12AndM14 = await runM12AndM14(browser, server.baseUrl);
    const m13 = await runM13JoinTrials(browser, server.baseUrl, 10);
    const m15 = await runM15ForcedFail(browser, server.baseUrl);

    const summary = {
      generatedAtUtc: new Date().toISOString(),
      passed: m12AndM14.passed && m13.passed && m15.passed,
      m1_2_twoPeers: {
        passed: m12AndM14.passed,
        roomCode: m12AndM14.roomCode,
        peerA: { selfId: m12AndM14.peerA.selfId, timeToFirstPeerMs: m12AndM14.peerA.timeToFirstPeerMs, relaysOpen: m12AndM14.peerA.relaysOpen },
        peerB: { selfId: m12AndM14.peerB.selfId, timeToFirstPeerMs: m12AndM14.peerB.timeToFirstPeerMs, relaysOpen: m12AndM14.peerB.relaysOpen },
        screenshot: 'evidence/M1/m1-two-peers.png',
      },
      m1_3_joinLatency: m13,
      m1_4_unreliableTraffic: {
        passed: m12AndM14.passed,
        peerAUnreliable: m12AndM14.peerA.peer,
        peerBUnreliable: m12AndM14.peerB.peer,
        senderTraffic: m12AndM14.peerA.traffic,
        receiverTraffic: m12AndM14.peerB.traffic,
      },
      m1_5_forcedIceFail: {
        ...m15,
        screenshot: 'evidence/M1/m1-forced-fail.png',
      },
    };

    const reportPath = resolve(EVIDENCE_DIR, 'm1-vm-report.json');
    writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    console.log(`[m1.spec] PASS -> ${reportPath} (medianJoin=${m13.medianLoadToPeerMs}ms, loss=${m12AndM14.peerA.traffic.lossPct.toFixed(2)}%, recv=${m12AndM14.peerB.traffic.received})`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[m1.spec] FAILED:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
