import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import wordsData from '@data/words.json';
import { RoomPhase } from '@net/enums';
import { QualityTier, ScreenId } from '@client/enums';
import type { FrameStats, PerfReport } from '@client/quality';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = resolve(ROOT, 'dist');
const EVIDENCE_DIR = resolve(ROOT, 'evidence/M3');
const CHROME_PATH = '/usr/bin/google-chrome';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

interface DebugState {
  ready: boolean;
  firstLobbyFrameMs: number | null;
  screen: ScreenId;
  phase: RoomPhase;
  tick: number;
  peerCount: number;
  snapshotsReceived: number;
  maxSnapshotGapMs: number;
  lastSnapshotArrivalMs: number | null;
  frameStats: FrameStats;
  renderStats: { drawCalls: number; triangles: number; gpu: string };
  vfxStats: { chips: number; dust: number; impactActive: boolean };
  qualityTier: QualityTier;
  reduceFlashes?: boolean;
  impactCountInWindow?: number;
  resetSnapshotGap?: () => void;
  setReduceFlashes?: (reduce: boolean) => void;
  startRoundNow: () => void;
  getPerfReportJson: () => PerfReport | string;
}

interface SampledFrame {
  elapsedSec: number;
  tick: number;
  drawCalls: number;
  triangles: number;
  chips: number;
  dust: number;
  p95Ms: number;
  scriptP95Ms: number;
  impactActive: boolean;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function uniqueThreeWordRoom(tag: string): string {
  const [w0, w1, w2] = wordsData.roomWords;
  assert(w0 && w1 && w2, 'words.json missing roomWords lists');
  const pick = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)]!;
  return `${pick(w0)}-${pick(w1)}-${pick(w2)}-${tag}-${Date.now().toString(36).slice(-4)}`;
}

function startStaticServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  assert(existsSync(resolve(DIST_DIR, 'index.html')), `Missing ${resolve(DIST_DIR, 'index.html')} — run build first`);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const rawPath = (req.url ?? '/').split('?')[0] ?? '/';
    const cleaned = normalize(rawPath === '/' ? '/index.html' : rawPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = resolve(DIST_DIR, `.${cleaned.startsWith('/') ? cleaned : `/${cleaned}`}`);
    const rel = relative(DIST_DIR, filePath);
    if (rel.startsWith('..') || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (!addr) return rej(new Error('Failed to bind ephemeral port'));
      res({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((cRes, cRej) => server.close((e) => (e ? cRej(e) : cRes()))),
      });
    });
  });
}

function attachPageErrors(page: Page, label: string, pageErrors: string[], consoleErrors: string[]): void {
  page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${label}: ${msg.text()}`);
  });
}

async function getDebug(page: Page): Promise<DebugState | null> {
  return page.evaluate(() => (window as unknown as { __bbDebug?: DebugState }).__bbDebug ?? null);
}

async function waitForDebugReady(page: Page, timeoutMs: number): Promise<DebugState> {
  const handle = await page.waitForFunction(
    () => {
      const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
      return d && d.ready === true ? d : null;
    },
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  return (await handle.jsonValue()) as DebugState;
}

async function runStaticOgCheck(baseUrl: string) {
  const res = await fetch(`${baseUrl}/index.html`);
  assert(res.ok, `GET /index.html failed with ${res.status}`);
  const html = await res.text();
  const requiredTags = [
    /<meta\s+property=["']og:title["']\s+content=["']BRIC-A-BRAWL["']/i,
    /<meta\s+property=["']og:description["']\s+content=["'][^"']+["']/i,
    /<meta\s+property=["']og:image["']\s+content=["'][^"']*og\.png["']/i,
  ];
  for (const re of requiredTags) {
    assert(re.test(html), `M5.3 static OG check failed: missing tag matching ${re}`);
  }
  const ogDistPath = resolve(DIST_DIR, 'og.png');
  assert(existsSync(ogDistPath), `Missing ${ogDistPath}`);
  const ogBytes = statSync(ogDistPath).size;
  assert(ogBytes > 0 && ogBytes < 300 * 1024, `og.png size ${ogBytes} bytes must be < 300 KB`);
  const ogRes = await fetch(`${baseUrl}/og.png`);
  assert(ogRes.ok, `GET /og.png failed with ${ogRes.status}`);
  return { passed: true, ogBytes, budgetBytes: 300 * 1024 };
}

async function runM32AndM33Smoke(browser: Browser, baseUrl: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    const page = await ctx.newPage();
    attachPageErrors(page, 'smoke', pageErrors, consoleErrors);

    const url = `${baseUrl}/index.html?mode=smoke&bots=7&tier=low&arena=willow`;
    const navT0 = performance.now();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const readyDbg = await waitForDebugReady(page, 15_000);
    const navToReadyMs = performance.now() - navT0;
    let firstLobbyFrameMs = readyDbg.firstLobbyFrameMs ?? navToReadyMs;
    assert(
      firstLobbyFrameMs <= 4000,
      `M3.3 firstLobbyFrameMs=${firstLobbyFrameMs.toFixed(1)} ms exceeded 4000 ms`,
    );

    if (readyDbg.screen === ScreenId.Lobby) {
      await page.screenshot({ path: resolve(EVIDENCE_DIR, 'm3-lobby.png') });
    } else {
      const lobbyPage = await ctx.newPage();
      attachPageErrors(lobbyPage, 'lobby-capture', pageErrors, consoleErrors);
      const lobbyUrl = `${baseUrl}/index.html?room=${encodeURIComponent(uniqueThreeWordRoom('lobby'))}&autojoin=1&role=host`;
      const l0 = performance.now();
      await lobbyPage.goto(lobbyUrl, { waitUntil: 'domcontentloaded' });
      const lobbyHandle = await lobbyPage.waitForFunction(
        (lobbyScreen) => {
          const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
          return d && d.ready === true && d.screen === lobbyScreen ? d : null;
        },
        ScreenId.Lobby,
        { timeout: 15_000, polling: 100 },
      );
      const lobbyDbg = (await lobbyHandle.jsonValue()) as DebugState;
      const lobbyMs = lobbyDbg.firstLobbyFrameMs ?? (performance.now() - l0);
      firstLobbyFrameMs = Math.max(firstLobbyFrameMs, lobbyMs);
      assert(lobbyMs <= 6000, `M3.3 concurrent lobby frame time ${lobbyMs.toFixed(1)} ms exceeded 6000 ms`);
      await lobbyPage.screenshot({ path: resolve(EVIDENCE_DIR, 'm3-lobby.png') });
      await lobbyPage.close();
    }

    // Start round if still in Lobby
    await page.evaluate((roundPhase) => {
      const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
      if (d && d.phase !== roundPhase) d.startRoundNow();
    }, RoomPhase.Round);
    await page.waitForFunction(
      ({ roundPhase, hudScreen }) => {
        const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
        return d && d.phase === roundPhase && d.screen === hudScreen;
      },
      { roundPhase: RoomPhase.Round, hudScreen: ScreenId.Hud },
      { timeout: 10_000, polling: 100 },
    );

    const samples: SampledFrame[] = [];
    let midShotTaken = false;
    let lastCallShotTaken = false;
    let reduceFlashesVerified = false;

    for (let sec = 1; sec <= 20; sec++) {
      await page.waitForTimeout(1000);
      const dbg = await getDebug(page);
      assert(dbg !== null, 'window.__bbDebug missing during smoke loop');
      assert(dbg.qualityTier === QualityTier.Low, `Expected QualityTier.Low (0), got ${dbg.qualityTier}`);
      assert(dbg.renderStats.drawCalls <= 70, `Low drawCalls=${dbg.renderStats.drawCalls} > 70 at t=${sec}s`);
      assert(dbg.renderStats.triangles <= 115_000, `Low triangles=${dbg.renderStats.triangles} > 115000 at t=${sec}s`);
      assert(dbg.vfxStats.chips <= 100, `Low chips=${dbg.vfxStats.chips} > 100 at t=${sec}s`);
      assert(dbg.vfxStats.dust <= 80, `Low dust=${dbg.vfxStats.dust} > 80 at t=${sec}s`);

      samples.push({
        elapsedSec: sec,
        tick: dbg.tick,
        drawCalls: dbg.renderStats.drawCalls,
        triangles: dbg.renderStats.triangles,
        chips: dbg.vfxStats.chips,
        dust: dbg.vfxStats.dust,
        p95Ms: dbg.frameStats.p95Ms,
        scriptP95Ms: dbg.frameStats.scriptP95Ms,
        impactActive: dbg.vfxStats.impactActive,
      });

      if (!midShotTaken && sec >= 8) {
        await page.screenshot({ path: resolve(EVIDENCE_DIR, 'm3-midmatch.png') });
        midShotTaken = true;
      }
      if (sec === 12) {
        // M5.6 reduce-flashes check: enable reduceFlashes and verify .impact-frame.active.border-only has transparent background
        const check = await page.evaluate(() => {
          const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
          d?.setReduceFlashes?.(true);
          const impactEl = document.querySelector('.impact-frame');
          if (!impactEl) return { hasEl: false, bg: '', boxShadow: '' };
          const wasActive = impactEl.classList.contains('active');
          const wasBorder = impactEl.classList.contains('border-only');
          impactEl.classList.add('active', 'border-only');
          const style = getComputedStyle(impactEl);
          const bg = style.backgroundColor;
          const boxShadow = style.boxShadow;
          if (!wasActive) impactEl.classList.remove('active');
          if (!wasBorder) impactEl.classList.remove('border-only');
          return { hasEl: true, bg, boxShadow };
        });
        assert(check.hasEl, 'M5.6: .impact-frame element missing');
        assert(
          check.bg === 'rgba(0, 0, 0, 0)' || check.bg === 'transparent',
          `M5.6: expected transparent background with border-only, got ${check.bg}`,
        );
        assert(check.boxShadow !== 'none', 'M5.6: expected border-only box-shadow pulse');
        reduceFlashesVerified = true;
      }
      if (!lastCallShotTaken && sec >= 18) {
        await page.screenshot({ path: resolve(EVIDENCE_DIR, 'm3-lastcall.png') });
        lastCallShotTaken = true;
      }
    }

    const finalDbg = await getDebug(page);
    assert(finalDbg !== null, 'Final __bbDebug missing');
    assert(pageErrors.length === 0, `Uncaught pageerrors in smoke: ${pageErrors.join(' | ')}`);
    const maxDrawCalls = Math.max(...samples.map((s) => s.drawCalls));
    const maxTriangles = Math.max(...samples.map((s) => s.triangles));
    const maxChips = Math.max(...samples.map((s) => s.chips));
    const maxDust = Math.max(...samples.map((s) => s.dust));
    const p95Ms = finalDbg.frameStats.p95Ms;
    const scriptP95Ms = finalDbg.frameStats.scriptP95Ms;
    assert(scriptP95Ms <= 20, `M3.2 scriptP95Ms=${scriptP95Ms} ms exceeded 20 ms software-skinned budget`);
    assert(p95Ms <= 400, `software p95Ms=${p95Ms} ms unreasonably high (> 400 ms)`);

    return {
      passed: true,
      firstLobbyFrameMs: Number(firstLobbyFrameMs.toFixed(1)),
      navToReadyMs: Number(navToReadyMs.toFixed(1)),
      gpu: finalDbg.renderStats.gpu,
      frameStats: finalDbg.frameStats,
      maxDrawCalls,
      maxTriangles,
      maxChips,
      maxDust,
      reduceFlashesVerified,
      samples,
      pageErrors,
      consoleErrors,
      screenshots: ['evidence/M3/m3-lobby.png', 'evidence/M3/m3-midmatch.png', 'evidence/M3/m3-lastcall.png'],
    };
  } finally {
    await ctx.close();
  }
}

function allocateFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as AddressInfo | null;
      if (!addr) { s.close(); rej(new Error('Failed to allocate CDP port')); return; }
      const port = addr.port;
      s.close(() => res(port));
    });
  });
}

interface RawHostTab {
  evalJson<T>(expr: string): Promise<T>;
  hideBySwitchingTab(): Promise<void>;
  close(): Promise<void>;
}

async function launchRealHostChrome(url: string): Promise<RawHostTab> {
  const port = await allocateFreePort();
  const profileDir = join(tmpdir(), `bb-host-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const proc: ChildProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=640,360',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      url,
    ],
    { stdio: 'ignore' },
  );

  // Wait for CDP endpoint and initial host tab
  let tabWsUrl = '';
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) {
        const tabs = (await r.json()) as Array<{ id: string; type: string; webSocketDebuggerUrl?: string }>;
        const pageTab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTab?.webSocketDebuggerUrl) {
          tabWsUrl = pageTab.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {
      // Chrome still starting CDP listener
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  assert(tabWsUrl.length > 0, 'Failed to connect to raw Chrome CDP for M3.5 host tab');

  const ws = new WebSocket(tabWsUrl);
  await new Promise<void>((res, rej) => {
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', (e) => rej(new Error(`CDP WebSocket error: ${String(e)}`)), { once: true });
  });

  let nextId = 1;
  const send = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise((res, rej) => {
      const id = nextId++;
      const onMsg = (ev: MessageEvent) => {
        const parsed = JSON.parse(String(ev.data)) as { id?: number; result?: T; error?: { message?: string } };
        if (parsed.id !== id) return;
        ws.removeEventListener('message', onMsg);
        if (parsed.error) rej(new Error(parsed.error.message ?? 'CDP error'));
        else res(parsed.result as T);
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });

  return {
    async evalJson<T>(expr: string): Promise<T> {
      const r = await send<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', {
        expression: `(${expr})`,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(`Host eval error: ${r.exceptionDetails.text ?? 'unknown'}`);
      return r.result?.value as T;
    },
    async hideBySwitchingTab(): Promise<void> {
      const t2Res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      assert(t2Res.ok, `Failed to open foreground tab via CDP /json/new: ${t2Res.status}`);
      const t2 = (await t2Res.json()) as { id: string };
      const actRes = await fetch(`http://127.0.0.1:${port}/json/activate/${t2.id}`);
      assert(actRes.ok, `Failed to activate foreground tab via CDP: ${actRes.status}`);
      await new Promise((r) => setTimeout(r, 350));
    },
    async close(): Promise<void> {
      ws.close();
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (proc.exitCode === null) proc.kill('SIGKILL');
      rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

async function runM34AndM35Trystero(browser: Browser, baseUrl: string) {
  const room = uniqueThreeWordRoom('m3');
  const hostUrl = `${baseUrl}/index.html?room=${encodeURIComponent(room)}&autojoin=1&role=host&startRound=1`;
  const clientUrl = `${baseUrl}/index.html?room=${encodeURIComponent(room)}&autojoin=1&role=client`;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const hostChrome = await launchRealHostChrome(hostUrl);
  const ctxClient = await browser.newContext({ viewport: { width: 640, height: 360 } });
  try {
    const clientPage = await ctxClient.newPage();
    attachPageErrors(clientPage, 'client', pageErrors, consoleErrors);

    await clientPage.goto(clientUrl, { waitUntil: 'domcontentloaded' });
    await waitForDebugReady(clientPage, 25_000);

    // Wait for both peers to connect and client to enter live Round and receive initial snapshots
    await clientPage.waitForFunction(
      (roundPhase) => {
        const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
        return d && d.peerCount >= 1 && d.phase === roundPhase && d.snapshotsReceived >= 10;
      },
      RoomPhase.Round,
      { timeout: 35_000, polling: 150 },
    );

    // 10 s visible phase
    await clientPage.waitForTimeout(10_000);
    const visibleDbg = await getDebug(clientPage);
    assert(visibleDbg !== null && visibleDbg.snapshotsReceived > 30, 'Client not streaming snapshots during visible phase');

    // Install main-thread 50 ms probe on Host tab to verify real Chrome 1 Hz background-tab throttling
    await hostChrome.evalJson<boolean>(
      `(() => { window.__mtProbe = { last: performance.now(), maxGapMs: 0, ticks: 0 }; window.__mtId = setInterval(() => { const now = performance.now(); window.__mtProbe.maxGapMs = Math.max(window.__mtProbe.maxGapMs, now - window.__mtProbe.last); window.__mtProbe.last = now; window.__mtProbe.ticks++; }, 50); return true; })()`,
    );

    // Reset gap tracker right before hiding host tab for 20 s
    await clientPage.evaluate(() => {
      const d = (window as unknown as { __bbDebug?: DebugState }).__bbDebug;
      d?.resetSnapshotGap?.();
    });

    await hostChrome.hideBySwitchingTab();
    const hostVis = await hostChrome.evalJson<string>('document.visibilityState');
    assert(hostVis === 'hidden', `Expected hostPage.visibilityState === 'hidden', got '${hostVis}'`);

    const snapBeforeHidden = visibleDbg.snapshotsReceived;
    await clientPage.waitForTimeout(20_000);

    const afterHiddenDbg = await getDebug(clientPage);
    assert(afterHiddenDbg !== null, 'Client __bbDebug missing after 20 s hidden host test');
    const hostProbe = await hostChrome.evalJson<{ maxGapMs: number; ticks: number; tick: number }>(
      `(() => { clearInterval(window.__mtId); return { maxGapMs: window.__mtProbe.maxGapMs, ticks: window.__mtProbe.ticks, tick: window.__bbDebug ? window.__bbDebug.tick : -1 }; })()`,
    );
    assert(pageErrors.length === 0, `Uncaught pageerrors in M3.4/M3.5: ${pageErrors.join(' | ')}`);

    const hiddenSnapshotsDelta = afterHiddenDbg.snapshotsReceived - snapBeforeHidden;
    assert(
      hostProbe.maxGapMs >= 500,
      `Expected real Chrome background throttling on host main thread (maxGapMs >= 500 ms), got ${hostProbe.maxGapMs.toFixed(1)} ms`,
    );
    assert(
      afterHiddenDbg.snapshotsReceived > 300,
      `M3.4/M3.5 snapshotsReceived=${afterHiddenDbg.snapshotsReceived} <= 300`,
    );
    assert(
      afterHiddenDbg.maxSnapshotGapMs <= 150,
      `M3.5 maxSnapshotGapMs=${afterHiddenDbg.maxSnapshotGapMs.toFixed(1)} ms > 150 ms`,
    );

    return {
      passed: true,
      roomCode: room,
      hostVisibilityWhileHidden: hostVis,
      hostMainThreadMaxGapMs: Number(hostProbe.maxGapMs.toFixed(1)),
      hostMainThreadTicksIn20s: hostProbe.ticks,
      clientSnapshotsBeforeHidden: snapBeforeHidden,
      clientSnapshotsTotal: afterHiddenDbg.snapshotsReceived,
      clientSnapshotsDuringHidden20s: hiddenSnapshotsDelta,
      maxSnapshotGapMs: Number(afterHiddenDbg.maxSnapshotGapMs.toFixed(1)),
      hostTickAtEnd: hostProbe.tick,
      clientTickAtEnd: afterHiddenDbg.tick,
      pageErrors,
      consoleErrors,
    };
  } finally {
    await Promise.allSettled([ctxClient.close(), hostChrome.close()]);
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
    const m53Og = await runStaticOgCheck(server.baseUrl);
    const m32AndM33 = await runM32AndM33Smoke(browser, server.baseUrl);
    const m34AndM35 = await runM34AndM35Trystero(browser, server.baseUrl);

    const report = {
      generatedAtUtc: new Date().toISOString(),
      passed: m53Og.passed && m32AndM33.passed && m34AndM35.passed,
      m3_2_smoke: {
        passed: m32AndM33.passed,
        maxDrawCalls: m32AndM33.maxDrawCalls,
        maxTriangles: m32AndM33.maxTriangles,
        maxChips: m32AndM33.maxChips,
        maxDust: m32AndM33.maxDust,
        frameStats: m32AndM33.frameStats,
        gpu: m32AndM33.gpu,
        screenshots: m32AndM33.screenshots,
      },
      m3_3_lobbyLoad: {
        passed: m32AndM33.firstLobbyFrameMs <= 4000,
        firstLobbyFrameMs: m32AndM33.firstLobbyFrameMs,
        navToReadyMs: m32AndM33.navToReadyMs,
        budgetMs: 4000,
      },
      m3_4_and_m3_5_trysteroHiddenHost: m34AndM35,
      m5_3_staticOg: m53Og,
      m5_6_reduceFlashes: {
        passed: m32AndM33.reduceFlashesVerified,
      },
      smokeSamples: m32AndM33.samples,
    };

    const reportPath = resolve(EVIDENCE_DIR, 'm3-browser-report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      `[m3.spec] PASS -> ${reportPath} (lobby=${m32AndM33.firstLobbyFrameMs}ms, drawCallsMax=${m32AndM33.maxDrawCalls}, p95=${m32AndM33.frameStats.p95Ms}ms, scriptP95=${m32AndM33.frameStats.scriptP95Ms}ms, snaps=${m34AndM35.clientSnapshotsTotal}, maxGap=${m34AndM35.maxSnapshotGapMs}ms)`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[m3.spec] FAILED:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
