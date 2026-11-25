import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, normalize, relative, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ScreenId } from '@client/enums';
import { FighterId, FighterState, MoveId } from '@sim/enums';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = resolve(ROOT, 'dist');
const OUT_DIR = resolve(ROOT, 'evidence/combat-feel');
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function startStaticServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  assert(existsSync(resolve(DIST_DIR, 'index.html')), 'Missing dist/index.html — run npm run build first');
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

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__bbDebug?.ready === true, undefined, { timeout: 20_000, polling: 50 });
}

interface FilmstripSpec {
  readonly slug: string;
  readonly title: string;
  readonly attackerId: FighterId;
  readonly defenderId: FighterId;
  readonly moveId: MoveId;
}

const FILMSTRIPS: readonly FilmstripSpec[] = [
  { slug: 'filmstrip-earl-fheavy', title: 'EARL — Lid Crash (Forward Heavy) vs Grog', attackerId: FighterId.Earl, defenderId: FighterId.Grog, moveId: MoveId.Fheavy },
  { slug: 'filmstrip-grog-fheavy', title: 'GROG — Horn Gore (Forward Heavy) vs Earl', attackerId: FighterId.Grog, defenderId: FighterId.Earl, moveId: MoveId.Fheavy },
  { slug: 'filmstrip-nesta-jab3', title: 'NESTA — Combo Finisher (Jab 3) vs Moss', attackerId: FighterId.Nesta, defenderId: FighterId.Moss, moveId: MoveId.Jab3 },
  { slug: 'filmstrip-moss-ftilt', title: 'MOSS — Rod Slash (Forward Tilt) vs Nesta', attackerId: FighterId.Moss, defenderId: FighterId.Nesta, moveId: MoveId.Ftilt },
];

const PHASES: readonly { readonly key: 'windup' | 'active' | 'impact' | 'launch'; readonly label: string }[] = [
  { key: 'windup', label: '1. WINDUP (Coil)' },
  { key: 'active', label: '2. ACTIVE (Snap + Slash Arc)' },
  { key: 'impact', label: '3. IMPACT (Hitstop + Flash + Sparks)' },
  { key: 'launch', label: '4. LAUNCH (Tumble + Smoke)' },
];

async function captureFilmstrips(browser: Browser, baseUrl: string) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 340 } });
  const composeCtx = await browser.newContext({ viewport: { width: 1920, height: 396 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const captured: string[] = [];
  let maxDrawCalls = 0;
  let maxTriangles = 0;

  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`${baseUrl}/index.html?styleframe=1`, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);

    const composePage = await composeCtx.newPage();
    for (const strip of FILMSTRIPS) {
      const panelDataUrls: string[] = [];
      for (const ph of PHASES) {
        await page.evaluate(
          ({ attackerId, defenderId, moveId, phase }) => {
            window.__bbDebug!.renderCombatShowcase({ attackerId, defenderId, moveId, phase });
          },
          { attackerId: strip.attackerId, defenderId: strip.defenderId, moveId: strip.moveId, phase: ph.key },
        );
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
        const stats = await page.evaluate(() => ({
          render: window.__bbDebug!.renderStats,
          vfx: window.__bbDebug!.vfxStats,
        }));
        maxDrawCalls = Math.max(maxDrawCalls, stats.render.drawCalls);
        maxTriangles = Math.max(maxTriangles, stats.render.triangles);

        if (ph.key === 'active') {
          assert(stats.vfx.slashes >= 1, `${strip.slug} active phase must show visible 3D slash arc`);
        }
        if (ph.key === 'impact') {
          assert(stats.vfx.sparks >= 6, `${strip.slug} impact phase must show burst hit sparks (got ${stats.vfx.sparks})`);
          assert(stats.vfx.chips >= 6, `${strip.slug} impact phase must show ceramic hit chips (got ${stats.vfx.chips})`);
        }

        const pngBuf = await page.screenshot();
        panelDataUrls.push(`data:image/png;base64,${pngBuf.toString('base64')}`);
      }

      // Stitch 4 labeled panels horizontally into a crisp 1920x396 evaluation contact sheet
      await composePage.setContent(`
        <!doctype html>
        <html>
          <body style="margin:0;background:#1A1A1D;font-family:system-ui,sans-serif;color:#FAF6EE;">
            <div style="height:40px;display:flex;align-items:center;padding:0 16px;font-weight:700;font-size:16px;letter-spacing:.04em;border-bottom:2px solid #D4A13E;">
              ${strip.title}
            </div>
            <div style="display:flex;width:1920px;height:356px;">
              ${panelDataUrls
                .map(
                  (url, i) => `
                  <div style="position:relative;width:480px;height:356px;border-right:2px solid #35353B;box-sizing:border-box;">
                    <img src="${url}" style="width:480px;height:340px;display:block;object-fit:cover;" />
                    <div style="position:absolute;left:10px;bottom:18px;background:rgba(20,20,24,0.82);color:#FAF6EE;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:700;border-left:3px solid #D4A13E;">
                      ${PHASES[i]!.label}
                    </div>
                  </div>`,
                )
                .join('')}
            </div>
          </body>
        </html>
      `);
      const outPath = resolve(OUT_DIR, `${strip.slug}.png`);
      await composePage.screenshot({ path: outPath });
      captured.push(`evidence/combat-feel/${strip.slug}.png`);
    }

    assert(pageErrors.length === 0, `Filmstrip pageErrors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Filmstrip consoleErrors: ${consoleErrors.join(' | ')}`);
    return { captured, maxDrawCalls, maxTriangles };
  } finally {
    await ctx.close();
    await composeCtx.close();
  }
}

async function runLiveAttackResponsivenessCheck(browser: Browser, baseUrl: string) {
  // Compact viewport keeps SwiftShader rasterization fast so latency reflects input->sim->render responsiveness
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForReady(page);
    await page.click('[data-action="solo-practice"]');
    await page.waitForFunction(
      (s) =>
        window.__bbDebug?.screen === s &&
        window.__bbDebug.localFighterState !== null &&
        window.__bbDebug.snapshotsReceived >= 2,
      ScreenId.Lobby,
      { timeout: 15_000, polling: 50 },
    );
    // Remove default practice Chaser bot so it cannot interrupt our clean input-latency measurement
    await page.click('[data-action="remove-bot"]');
    await page.waitForFunction(
      (idleState) =>
        window.__bbDebug?.snapshotsReceived !== undefined &&
        window.__bbDebug.snapshotsReceived >= 2 &&
        window.__bbDebug.localFighterState?.state === idleState,
      FighterState.Idle,
      { timeout: 10_000, polling: 30 },
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    // Measure live keyboard Attack press -> Attack state latency & active slash arc generation!
    const t0 = performance.now();
    await page.keyboard.down('KeyJ');
    const res = await page.waitForFunction(
      (atkState) => {
        const lf = window.__bbDebug?.localFighterState;
        if (!lf) return null;
        if (lf.state === atkState) return { move: lf.activeMove, frame: lf.moveFrame, vfx: window.__bbDebug!.vfxStats };
        return null;
      },
      FighterState.Attack,
      { timeout: 2_000, polling: 16 },
    );
    const attackLatencyMs = Math.round(performance.now() - t0);
    const attackInfo = (await res.jsonValue()) as { move: MoveId; frame: number; vfx: { slashes: number } };
    await page.keyboard.up('KeyJ');

    // Wait a few frames for swing active frame and verify slash arc fired in live gameplay
    let maxLiveSlashes = attackInfo.vfx.slashes;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(20);
      const sl = await page.evaluate(() => window.__bbDebug!.vfxStats.slashes);
      if (sl > maxLiveSlashes) maxLiveSlashes = sl;
    }

    // Wait back to Idle before testing Heavy Smash charge + release on KeyK
    await page.waitForFunction(
      (idleState) => window.__bbDebug?.localFighterState?.state === idleState,
      FighterState.Idle,
      { timeout: 2_000, polling: 20 },
    );

    // Also test Heavy Smash charge + release on KeyK
    await page.keyboard.down('KeyK');
    await page.waitForFunction(
      (chState) => window.__bbDebug?.localFighterState?.state === chState,
      FighterState.ChargingHeavy,
      { timeout: 1_500, polling: 16 },
    );
    await page.waitForTimeout(120);
    await page.keyboard.up('KeyK');
    await page.waitForFunction(
      (atkState) => window.__bbDebug?.localFighterState?.state === atkState,
      FighterState.Attack,
      { timeout: 1_500, polling: 16 },
    );

    assert(pageErrors.length === 0, `Live combat pageErrors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Live combat consoleErrors: ${consoleErrors.join(' | ')}`);
    assert(attackLatencyMs <= 350, `Expected crisp local attack latency under SwiftShader, got ${attackLatencyMs}ms`);
    assert(maxLiveSlashes >= 1, `Expected live attack to spawn 3D slash arc (maxLiveSlashes=${maxLiveSlashes})`);

    return {
      passed: true,
      attackLatencyMs,
      attackMove: attackInfo.move,
      maxLiveSlashes,
      heavyChargeAndReleaseVerified: true,
    };
  } finally {
    await ctx.close();
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  try {
    const filmstrips = await captureFilmstrips(browser, server.baseUrl);
    const live = await runLiveAttackResponsivenessCheck(browser, server.baseUrl);

    const report = {
      generatedAtUtc: new Date().toISOString(),
      allPassed: true,
      live,
      filmstrips,
    };
    const reportPath = resolve(OUT_DIR, 'combat-feel-report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(
      `[combat-feel.spec] PASS -> ${reportPath} (attackLatencyMs=${live.attackLatencyMs}ms, liveSlashes=${live.maxLiveSlashes}, maxDrawCalls=${filmstrips.maxDrawCalls}, filmstrips=${filmstrips.captured.length})`,
    );
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('[combat-feel.spec] FAILED:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
