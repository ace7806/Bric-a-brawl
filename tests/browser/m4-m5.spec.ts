import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, normalize, relative, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { DebugApi } from '@client/app';
import { QualityTier, ScreenId } from '@client/enums';
import { RoomPhase } from '@net/enums';
import { ArenaId, FighterId } from '@sim/enums';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = resolve(ROOT, 'dist');
const M4_DIR = resolve(ROOT, 'evidence/M4');
const M5_DIR = resolve(ROOT, 'evidence/M5');
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

const FIGHTER_SHOWCASES: readonly { readonly id: FighterId; readonly slug: string }[] = [
  { id: FighterId.Earl, slug: 'earl' },
  { id: FighterId.Grog, slug: 'grog' },
  { id: FighterId.Nesta, slug: 'nesta' },
  { id: FighterId.Moss, slug: 'moss' },
];

const ARENA_SHOWCASES: readonly { readonly id: ArenaId; readonly slug: string }[] = [
  { id: ArenaId.Willow, slug: 'willow' },
  { id: ArenaId.HighTea, slug: 'hightea' },
  { id: ArenaId.MendedBowl, slug: 'mendedbowl' },
  { id: ArenaId.Saucer, slug: 'saucer' },
];

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10] as const;

interface DebugSnapshot {
  ready: boolean;
  screen: ScreenId;
  phase: RoomPhase;
  tick: number;
  qualityTier: QualityTier;
  renderStats: { drawCalls: number; triangles: number; gpu: string };
  vfxStats: { chips: number; dust: number; impactActive: boolean };
  frameStats: DebugApi['frameStats'];
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
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

async function waitForDebugReady(page: Page, timeoutMs = 20_000): Promise<DebugSnapshot> {
  const handle = await page.waitForFunction(
    () => {
      const d = window.__bbDebug;
      if (!d || d.ready !== true) return null;
      return {
        ready: d.ready,
        screen: d.screen,
        phase: d.phase,
        tick: d.tick,
        qualityTier: d.qualityTier,
        renderStats: d.renderStats,
        vfxStats: d.vfxStats,
        frameStats: d.frameStats,
      };
    },
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  return (await handle.jsonValue()) as DebugSnapshot;
}

async function readDebug(page: Page): Promise<DebugSnapshot> {
  const snap = await page.evaluate(() => {
    const d = window.__bbDebug;
    if (!d) return null;
    return {
      ready: d.ready,
      screen: d.screen,
      phase: d.phase,
      tick: d.tick,
      qualityTier: d.qualityTier,
      renderStats: d.renderStats,
      vfxStats: d.vfxStats,
      frameStats: d.frameStats,
    };
  });
  assert(snap !== null, 'window.__bbDebug missing');
  return snap;
}

async function flushTwoRafs(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))),
  );
}

async function waitForScreen(page: Page, target: ScreenId, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    (s) => window.__bbDebug !== undefined && window.__bbDebug.ready === true && window.__bbDebug.screen === s,
    target,
    { timeout: timeoutMs, polling: 100 },
  );
  await page.waitForSelector(`[data-screen="${target}"]`, { state: 'visible', timeout: 5_000 });
}

async function runM43HighTierBudget(browser: Browser, baseUrl: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const page = await ctx.newPage();
    attachPageErrors(page, 'm4.3-high', pageErrors, consoleErrors);
    await page.goto(`${baseUrl}/index.html?mode=smoke&bots=7&tier=high&arena=willow`, { waitUntil: 'domcontentloaded' });
    await waitForDebugReady(page, 25_000);
    await page.waitForFunction(
      ({ roundPhase, hudScreen }) => {
        const d = window.__bbDebug;
        return d !== undefined && d.phase === roundPhase && d.screen === hudScreen;
      },
      { roundPhase: RoomPhase.Round, hudScreen: ScreenId.Hud },
      { timeout: 10_000, polling: 100 },
    );

    let drawCallsMax = 0;
    let trianglesMax = 0;
    let chipsMax = 0;
    let dustMax = 0;
    let lastTick = 0;
    let gpu = '';
    const sampleCount = 40; // 40 * 250 ms = 10 s

    for (let i = 1; i <= sampleCount; i++) {
      await page.waitForTimeout(250);
      const dbg = await readDebug(page);
      assert(dbg.qualityTier === QualityTier.High, `Expected QualityTier.High (2), got ${dbg.qualityTier}`);
      drawCallsMax = Math.max(drawCallsMax, dbg.renderStats.drawCalls);
      trianglesMax = Math.max(trianglesMax, dbg.renderStats.triangles);
      chipsMax = Math.max(chipsMax, dbg.vfxStats.chips);
      dustMax = Math.max(dustMax, dbg.vfxStats.dust);
      lastTick = dbg.tick;
      gpu = dbg.renderStats.gpu;

      if (i === 20) {
        await page.screenshot({ path: resolve(M5_DIR, 'screen-hud.png') });
      }
    }

    assert(pageErrors.length === 0, `M4.3 pageErrors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `M4.3 consoleErrors: ${consoleErrors.join(' | ')}`);
    assert(lastTick > 0, `M4.3 expected sim ticks > 0, got ${lastTick}`);
    assert(drawCallsMax > 0 && drawCallsMax <= 90, `M4.3 High drawCallsMax=${drawCallsMax} outside (0, 90]`);
    assert(trianglesMax > 0 && trianglesMax <= 110_000, `M4.3 High trianglesMax=${trianglesMax} outside (0, 110000]`);

    return {
      passed: true,
      tier: QualityTier.High,
      arena: ArenaId.Willow,
      viewport: '1280x720',
      durationSec: 10,
      sampleCount,
      drawCallsMax,
      trianglesMax,
      chipsMax,
      dustMax,
      budgets: { maxDrawCalls: 90, maxTriangles: 110_000 },
      lastTick,
      gpu,
      hudScreenshot: 'evidence/M5/screen-hud.png',
      pageErrors,
      consoleErrors,
    };
  } finally {
    await ctx.close();
  }
}

async function runM46AndShowcases(browser: Browser, baseUrl: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let styleFrameStats = { drawCalls: 0, triangles: 0, gpu: '' };

  const hdCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const arenas: Array<{ id: ArenaId; slug: string; artifact: string; drawCalls: number; triangles: number }> = [];
  try {
    const page = await hdCtx.newPage();
    attachPageErrors(page, 'm4.6-hd', pageErrors, consoleErrors);

    await page.goto(`${baseUrl}/index.html?styleframe=1`, { waitUntil: 'domcontentloaded' });
    await waitForDebugReady(page, 20_000);
    await flushTwoRafs(page);
    const sfDbg = await readDebug(page);
    styleFrameStats = sfDbg.renderStats;
    await page.screenshot({ path: resolve(M4_DIR, 'style-frame-ingame.png') });

    for (const entry of ARENA_SHOWCASES) {
      await page.goto(`${baseUrl}/index.html?showcase=arena:${entry.id}`, { waitUntil: 'domcontentloaded' });
      await waitForDebugReady(page, 20_000);
      await flushTwoRafs(page);
      const dbg = await readDebug(page);
      const artifact = `evidence/M4/arena-${entry.slug}.png`;
      await page.screenshot({ path: resolve(ROOT, artifact) });
      arenas.push({
        id: entry.id,
        slug: entry.slug,
        artifact,
        drawCalls: dbg.renderStats.drawCalls,
        triangles: dbg.renderStats.triangles,
      });
    }
  } finally {
    await hdCtx.close();
  }

  const sqCtx = await browser.newContext({ viewport: { width: 800, height: 800 } });
  const fighters: Array<{ id: FighterId; slug: string; artifact: string; drawCalls: number; triangles: number }> = [];
  try {
    const page = await sqCtx.newPage();
    attachPageErrors(page, 'm4.6-fighter', pageErrors, consoleErrors);
    for (const entry of FIGHTER_SHOWCASES) {
      await page.goto(`${baseUrl}/index.html?showcase=fighter:${entry.id}`, { waitUntil: 'domcontentloaded' });
      await waitForDebugReady(page, 20_000);
      await flushTwoRafs(page);
      const dbg = await readDebug(page);
      const artifact = `evidence/M4/closeup-${entry.slug}.png`;
      await page.screenshot({ path: resolve(ROOT, artifact) });
      fighters.push({
        id: entry.id,
        slug: entry.slug,
        artifact,
        drawCalls: dbg.renderStats.drawCalls,
        triangles: dbg.renderStats.triangles,
      });
    }
  } finally {
    await sqCtx.close();
  }

  assert(pageErrors.length === 0, `M4.6 pageErrors: ${pageErrors.join(' | ')}`);
  assert(consoleErrors.length === 0, `M4.6 consoleErrors: ${consoleErrors.join(' | ')}`);

  return {
    styleFrame: {
      passed: true,
      artifact: 'evidence/M4/style-frame-ingame.png',
      viewport: '1280x720',
      ...styleFrameStats,
    },
    showcases: {
      passed: true,
      fighters,
      arenas,
    },
  };
}

async function runM5UiClipboardAndMismatch(browser: Browser, baseUrl: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

  try {
    const page = await ctx.newPage();
    attachPageErrors(page, 'm5-ui', pageErrors, consoleErrors);

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForDebugReady(page, 20_000);
    await waitForScreen(page, ScreenId.Title);
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-title.png') });

    await page.click('[data-action="open-room"]');
    await waitForScreen(page, ScreenId.Lobby, 20_000);
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-lobby.png') });

    await page.click('[data-action="copy-invite"]');
    await page.waitForFunction(() => document.body.innerText.includes('Copied invite link.'), undefined, { timeout: 5_000 });
    const inviteText = await page.evaluate(() => navigator.clipboard.readText());
    assert(inviteText.includes('#r='), `M5.4 expected clipboard invite text to include '#r=', got '${inviteText}'`);

    await page.click('[data-action="open-catalogue"]');
    await waitForScreen(page, ScreenId.CharSelect);
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-catalogue.png') });

    await page.evaluate(() => window.__bbDebug!.showResultsDemo());
    await waitForScreen(page, ScreenId.Results);
    await page.waitForFunction(
      () => {
        const img = document.querySelector<HTMLImageElement>('img[alt="Match capture"]');
        return img !== null && img.src.length > 0 && img.complete && img.naturalWidth > 0;
      },
      undefined,
      { timeout: 10_000, polling: 100 },
    );
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-results.png') });

    await page.click('[data-action="copy-photo"]');
    await page.waitForFunction(() => document.body.innerText.includes('Copied!'), undefined, { timeout: 5_000 });
    const pngBytes = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('image/png')) {
          const blob = await it.getType('image/png');
          const buf = new Uint8Array(await blob.arrayBuffer());
          return Array.from(buf.slice(0, 24));
        }
      }
      return null;
    });
    assert(pngBytes !== null && pngBytes.length === 24, 'M5.4 expected non-null 24-byte PNG header from clipboard');
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      assert(pngBytes[i] === PNG_MAGIC[i], `M5.4 PNG magic mismatch at byte ${i}: ${pngBytes[i]} !== ${PNG_MAGIC[i]}`);
    }
    assert(
      pngBytes[12] === 73 && pngBytes[13] === 72 && pngBytes[14] === 68 && pngBytes[15] === 82,
      'M5.4 expected IHDR chunk at bytes 12..15',
    );
    const pngWidth = ((pngBytes[16]! << 24) | (pngBytes[17]! << 16) | (pngBytes[18]! << 8) | pngBytes[19]!) >>> 0;
    const pngHeight = ((pngBytes[20]! << 24) | (pngBytes[21]! << 16) | (pngBytes[22]! << 8) | pngBytes[23]!) >>> 0;
    assert(pngWidth === 1200 && pngHeight === 630, `M5.4 expected PNG IHDR 1200x630, got ${pngWidth}x${pngHeight}`);

    await page.evaluate(() => window.__bbDebug!.showVersionMismatchDemo());
    await waitForScreen(page, ScreenId.ConnectionError);
    const errText = await page.locator(`[data-screen="${ScreenId.ConnectionError}"]`).innerText();
    assert(errText.includes('This room is on a newer build. Refresh.'), 'M5.5 missing newer build headline');
    assert(errText.includes('BB-VERSION-MISMATCH'), 'M5.5 missing BB-VERSION-MISMATCH diagnostic code');
    const refreshBtn = page.locator('button', { hasText: 'Refresh build' });
    assert((await refreshBtn.count()) >= 1 && (await refreshBtn.first().isVisible()), 'M5.5 missing visible "Refresh build" button');
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-connection-error.png') });

    assert(pageErrors.length === 0, `M5 pageErrors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `M5 consoleErrors: ${consoleErrors.join(' | ')}`);

    return {
      m5_4_clipboard: {
        passed: true,
        inviteText,
        inviteContainsRoomHash: true,
        pngMagicOk: true,
        pngWidth,
        pngHeight,
      },
      m5_5_versionMismatch: {
        passed: true,
        headlineFound: true,
        codeFound: true,
        refreshButtonFound: true,
      },
      screensCaptured: [
        'evidence/M5/screen-hud.png',
        'evidence/M5/screen-title.png',
        'evidence/M5/screen-lobby.png',
        'evidence/M5/screen-catalogue.png',
        'evidence/M5/screen-results.png',
        'evidence/M5/screen-connection-error.png',
      ],
      pageErrors,
      consoleErrors,
    };
  } finally {
    await ctx.close();
  }
}

async function runMobileTouchAndAudioCheck(browser: Browser, baseUrl: string) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await ctx.newPage();
    attachPageErrors(page, 'mobile-touch', pageErrors, consoleErrors);

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForDebugReady(page, 20_000);
    await waitForScreen(page, ScreenId.Title);

    // Open How to Play guide and verify it renders cleanly on mobile
    await page.tap('[data-action="open-guide"]');
    await page.waitForSelector('[data-modal="how-to-play"]', { state: 'visible', timeout: 5_000 });
    await page.tap('[data-modal="how-to-play"] button');
    await page.waitForSelector('[data-modal="how-to-play"]', { state: 'hidden', timeout: 5_000 });

    // Audio must unlock cleanly to 'running' after first tap
    await page.waitForFunction(() => window.__bbDebug?.audioState === 'running', undefined, { timeout: 5_000 });
    const audioState = await page.evaluate(() => window.__bbDebug!.audioState);
    assert(audioState === 'running', `Expected Web Audio running after tap, got ${audioState}`);

    // Tap Play solo -> Lobby with virtual touch controls visible
    await page.tap('[data-action="solo-practice"]');
    await waitForScreen(page, ScreenId.Lobby, 15_000);
    await page.waitForSelector('[data-touch-controls="true"]', { state: 'visible', timeout: 5_000 });
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-mobile-portrait.png') });

    // Start round via one-tap Start round button and verify touch attack button drives input mask
    await page.tap('[data-action="start-match"]');
    await waitForScreen(page, ScreenId.Hud, 15_000);
    await page.waitForSelector('[data-touch-controls="true"]', { state: 'visible', timeout: 5_000 });

    const hitBtn = page.locator('.tb-hit');
    const box = await hitBtn.boundingBox();
    assert(box !== null, 'Mobile Hit button boundingBox missing');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await flushTwoRafs(page);
    const activeMask = await page.evaluate(() => window.__bbDebug!.lastInputMask);
    await page.mouse.up();
    assert(activeMask !== 0, `Expected non-zero input mask while holding mobile Hit button, got ${activeMask}`);

    // Switch to mobile landscape (844x390) and capture live match HUD + touch controls
    await page.setViewportSize({ width: 844, height: 390 });
    await flushTwoRafs(page);
    await page.screenshot({ path: resolve(M5_DIR, 'screen-mobile-landscape.png') });

    assert(pageErrors.length === 0, `Mobile pageErrors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Mobile consoleErrors: ${consoleErrors.join(' | ')}`);

    return {
      passed: true,
      audioState,
      touchMaskActive: activeMask,
      screenshots: [
        'evidence/M5/screen-mobile-portrait.png',
        'evidence/M5/screen-mobile-landscape.png',
      ],
      pageErrors,
      consoleErrors,
    };
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(M4_DIR, { recursive: true });
  mkdirSync(M5_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const m43 = await runM43HighTierBudget(browser, server.baseUrl);
    const m46 = await runM46AndShowcases(browser, server.baseUrl);
    const m5 = await runM5UiClipboardAndMismatch(browser, server.baseUrl);
    const mobile = await runMobileTouchAndAudioCheck(browser, server.baseUrl);

    const m4Report = {
      generatedAtUtc: new Date().toISOString(),
      m4_3_highTier: m43,
      m4_6_styleFrame: m46.styleFrame,
      showcases: m46.showcases,
      allPassed: true,
    };
    const m5Report = {
      generatedAtUtc: new Date().toISOString(),
      ...m5,
      mobileTouchAndAudio: mobile,
      allPassed: true,
    };

    const m4Path = resolve(M4_DIR, 'm4-browser-report.json');
    const m5Path = resolve(M5_DIR, 'm5-browser-report.json');
    writeFileSync(m4Path, `${JSON.stringify(m4Report, null, 2)}\n`, 'utf8');
    writeFileSync(m5Path, `${JSON.stringify(m5Report, null, 2)}\n`, 'utf8');
    console.log(
      `[m4-m5.spec] PASS -> ${m4Path} & ${m5Path} (drawCallsMax=${m43.drawCallsMax}, trisMax=${m43.trianglesMax}, png=${m5.m5_4_clipboard.pngWidth}x${m5.m5_4_clipboard.pngHeight}, mobileAudio=${mobile.audioState})`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[m4-m5.spec] FAILED:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
