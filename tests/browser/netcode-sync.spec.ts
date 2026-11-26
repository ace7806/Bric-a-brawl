import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { extname, normalize, relative, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { RoomPhase } from '@net/enums';
import { FighterId } from '@sim/enums';
import { ScreenId } from '@client/enums';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIR = resolve(ROOT, 'dist');
const EVIDENCE_DIR = resolve(ROOT, 'evidence/netcode');
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

interface DebugFighter {
  slot: number;
  id: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: number;
  activeMove: number;
  damage: number;
  stocks: number;
}

interface DebugSnapshot {
  ready: boolean;
  screen: ScreenId;
  phase: RoomPhase;
  tick: number;
  matchEpoch: number;
  localSlot: number;
  isHost: boolean;
  roomCode: string;
  peerCount: number;
  snapshotsReceived: number;
  maxSnapshotGapMs: number;
  fightersState: DebugFighter[];
}

interface TransportDiag {
  state: number;
  relaysOpen: number;
  relaysTotal: number;
  peers: Array<{
    peerId: string;
    direct: boolean;
    iceCandidateTypes: string[];
    unreliableOpen: boolean;
    unreliableOrdered: boolean | null;
    unreliableMaxRetransmits: number | null;
  }>;
  errorDetail: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function startStaticServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  assert(existsSync(resolve(DIST_DIR, 'index.html')), `Missing ${resolve(DIST_DIR, 'index.html')} — run npm run build first`);
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

async function readDebug(page: Page): Promise<DebugSnapshot> {
  const snap = await page.evaluate(() => {
    const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
    if (!d) return null;
    return {
      ready: d.ready,
      screen: d.screen,
      phase: d.phase,
      tick: d.tick,
      matchEpoch: d.matchEpoch,
      localSlot: d.localSlot,
      isHost: d.isHost,
      roomCode: d.roomCode,
      peerCount: d.peerCount,
      snapshotsReceived: d.snapshotsReceived,
      maxSnapshotGapMs: d.maxSnapshotGapMs,
      fightersState: d.fightersState,
    };
  });
  assert(snap !== null, 'window.__bbDebug is missing');
  return snap;
}

async function readDiag(page: Page): Promise<TransportDiag | null> {
  return page.evaluate(async () => {
    const d = (window as unknown as { __bbDebug?: { getTransportDiagnostics?: () => Promise<TransportDiag | null> } }).__bbDebug;
    return d?.getTransportDiagnostics ? d.getTransportDiagnostics() : null;
  });
}

async function waitForReady(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __bbDebug?: { ready?: boolean } }).__bbDebug?.ready),
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
}

async function waitForFrames(page: Page, count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
  }
}

async function holdKey(page: Page, code: string, durationMs: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(durationMs);
  await waitForFrames(page, 2);
  await page.keyboard.up(code);
}

async function main(): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const server = await startStaticServer();
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const attachErr = (page: Page, label: string) => {
    page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${label}: ${msg.text()}`);
    });
  };

  let hostCtx: BrowserContext | null = null;
  let friendCtx: BrowserContext | null = null;

  try {
    hostCtx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    friendCtx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    const hostPage = await hostCtx.newPage();
    const friendPage = await friendCtx.newPage();
    attachErr(hostPage, 'host');
    attachErr(friendPage, 'friend');

    // 1. Host opens page and clicks "Open room"
    await hostPage.goto(`${server.baseUrl}/index.html?tier=low`, { waitUntil: 'domcontentloaded' });
    await waitForReady(hostPage);
    await hostPage.click('[data-action="open-room"]');
    await hostPage.waitForFunction(
      (lobbyScreen) => {
        const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
        return d && d.screen === lobbyScreen && d.isHost && d.matchEpoch >= 1 && d.tick >= 20;
      },
      ScreenId.Lobby,
      { timeout: 20_000, polling: 100 },
    );

    // Host moves around in Lobby BEFORE Friend joins so hostTick >> 0 (triggers stale-epoch race!)
    await holdKey(hostPage, 'KeyD', 900);
    await holdKey(hostPage, 'KeyA', 900);
    const hostPreJoin = await readDebug(hostPage);
    assert(hostPreJoin.tick >= 100, `Expected host tick >= 100 before friend join, got ${hostPreJoin.tick}`);
    const inviteUrl = hostPage.url();
    assert(inviteUrl.includes('#r='), `Expected invite URL with #r= hash, got ${inviteUrl}`);
    console.log(`[netcode-sync] Host opened ${hostPreJoin.roomCode} (tick=${hostPreJoin.tick}, epoch=${hostPreJoin.matchEpoch})`);

    // 2. Friend joins via exact invite URL (#r=code)
    await friendPage.goto(inviteUrl, { waitUntil: 'domcontentloaded' });
    await waitForReady(friendPage);

    // Wait for both peers to connect, enter same matchEpoch with 2 fighters, and stream snapshots
    await Promise.all([
      hostPage.waitForFunction(
        () => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          return d && d.peerCount >= 1 && d.fightersState.length === 2;
        },
        undefined,
        { timeout: 35_000, polling: 150 },
      ),
      friendPage.waitForFunction(
        () => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          return d && d.peerCount >= 1 && d.fightersState.length === 2 && d.snapshotsReceived >= 20;
        },
        undefined,
        { timeout: 35_000, polling: 150 },
      ),
    ]);

    const hostDiag = await readDiag(hostPage);
    const friendDiag = await readDiag(friendPage);
    assert(hostDiag?.peers[0]?.unreliableOpen === true, `Host unreliable channel not open: ${JSON.stringify(hostDiag)}`);
    assert(friendDiag?.peers[0]?.unreliableOpen === true, `Friend unreliable channel not open: ${JSON.stringify(friendDiag)}`);

    const [hostLobbyInit, friendLobbyInit] = await Promise.all([readDebug(hostPage), readDebug(friendPage)]);
    assert(
      hostLobbyInit.matchEpoch === friendLobbyInit.matchEpoch,
      `Epoch mismatch in Lobby: host=${hostLobbyInit.matchEpoch} friend=${friendLobbyInit.matchEpoch}`,
    );
    console.log(
      `[netcode-sync] Connected in Lobby! epoch=${hostLobbyInit.matchEpoch}, friendSnaps=${friendLobbyInit.snapshotsReceived}, friendTick=${friendLobbyInit.tick}`,
    );

    // 3. Bidirectional Lobby Movement Sync Test
    const hostSlot0Start = hostLobbyInit.fightersState.find((f) => f.slot === 0)!;
    const friendSlot1Start = hostLobbyInit.fightersState.find((f) => f.slot === 1)!;

    // Host runs right, Friend runs left simultaneously!
    await Promise.all([
      holdKey(hostPage, 'KeyD', 500),
      holdKey(friendPage, 'KeyA', 500),
    ]);
    // Settle so both SwiftShader tabs render fresh synced snapshots
    await Promise.all([hostPage.waitForTimeout(350), friendPage.waitForTimeout(350)]);
    await Promise.all([waitForFrames(hostPage, 2), waitForFrames(friendPage, 2)]);

    const [hostAfterMove, friendAfterMove] = await Promise.all([readDebug(hostPage), readDebug(friendPage)]);

    const h0OnHost = hostAfterMove.fightersState.find((f) => f.slot === 0)!;
    const h1OnHost = hostAfterMove.fightersState.find((f) => f.slot === 1)!;
    const h0OnFriend = friendAfterMove.fightersState.find((f) => f.slot === 0)!;
    const h1OnFriend = friendAfterMove.fightersState.find((f) => f.slot === 1)!;

    console.log(
      `[netcode-sync] Lobby move: slot0 host=${h0OnHost.x.toFixed(2)} friend=${h0OnFriend.x.toFixed(2)} (start=${hostSlot0Start.x.toFixed(2)}) | slot1 host=${h1OnHost.x.toFixed(2)} friend=${h1OnFriend.x.toFixed(2)} (start=${friendSlot1Start.x.toFixed(2)})`,
    );

    assert(h0OnHost.x - hostSlot0Start.x > 1.2, `Host slot 0 did not move right on Host (${hostSlot0Start.x} -> ${h0OnHost.x})`);
    assert(h0OnFriend.x - hostSlot0Start.x > 1.2, `Host slot 0 FROZEN on Friend (${hostSlot0Start.x} -> ${h0OnFriend.x})`);
    assert(Math.abs(h0OnHost.x - h0OnFriend.x) < 0.7, `Slot 0 X desync in Lobby: host=${h0OnHost.x} vs friend=${h0OnFriend.x}`);

    assert(friendSlot1Start.x - h1OnHost.x > 1.2, `Friend slot 1 FROZEN on Host (${friendSlot1Start.x} -> ${h1OnHost.x})`);
    assert(friendSlot1Start.x - h1OnFriend.x > 1.2, `Friend slot 1 did not move left on Friend (${friendSlot1Start.x} -> ${h1OnFriend.x})`);
    assert(Math.abs(h1OnHost.x - h1OnFriend.x) < 0.7, `Slot 1 X desync in Lobby: host=${h1OnHost.x} vs friend=${h1OnFriend.x}`);

    await hostPage.screenshot({ path: resolve(EVIDENCE_DIR, 'lobby-host.png') });
    await friendPage.screenshot({ path: resolve(EVIDENCE_DIR, 'lobby-friend.png') });

    // 4. Remote Client Fighter Switch Sync (Friend picks TIDE = FighterId.Nesta = 2)
    const epochBeforeSwitch = hostAfterMove.matchEpoch;
    await friendPage.click('[data-action="open-catalogue"]');
    await friendPage.waitForSelector(`[data-fighter="${FighterId.Nesta}"]`, { timeout: 5000 });
    await friendPage.click(`[data-fighter="${FighterId.Nesta}"]`);
    await friendPage.keyboard.press('Escape');

    await Promise.all([
      hostPage.waitForFunction(
        ({ prevEpoch, targetId }) => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          const f1 = d?.fightersState.find((f) => f.slot === 1);
          return Boolean(d && d.matchEpoch > prevEpoch && f1 && f1.id === targetId);
        },
        { prevEpoch: epochBeforeSwitch, targetId: FighterId.Nesta },
        { timeout: 10_000, polling: 100 },
      ),
      friendPage.waitForFunction(
        ({ prevEpoch, targetId }) => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          const f1 = d?.fightersState.find((f) => f.slot === 1);
          return Boolean(d && d.matchEpoch > prevEpoch && f1 && f1.id === targetId && d.snapshotsReceived >= 15);
        },
        { prevEpoch: epochBeforeSwitch, targetId: FighterId.Nesta },
        { timeout: 10_000, polling: 100 },
      ),
    ]);
    console.log('[netcode-sync] Remote client fighter switch -> TIDE synced on both peers!');

    // Verify movement STILL syncs after fighter-switch Saucer restart!
    const postSwitchHost = await readDebug(hostPage);
    const ps0Start = postSwitchHost.fightersState.find((f) => f.slot === 0)!.x;
    await holdKey(hostPage, 'KeyD', 450);
    await Promise.all([hostPage.waitForTimeout(350), friendPage.waitForTimeout(350)]);
    await Promise.all([waitForFrames(hostPage, 2), waitForFrames(friendPage, 2)]);
    const [psHostEnd, psFriendEnd] = await Promise.all([readDebug(hostPage), readDebug(friendPage)]);
    const ps0HostX = psHostEnd.fightersState.find((f) => f.slot === 0)!.x;
    const ps0FriendX = psFriendEnd.fightersState.find((f) => f.slot === 0)!.x;
    assert(ps0HostX - ps0Start > 1.0 && ps0FriendX - ps0Start > 1.0, `Post-switch Host frozen on Friend (${ps0Start} -> host ${ps0HostX}, friend ${ps0FriendX})`);
    assert(Math.abs(ps0HostX - ps0FriendX) < 0.7, `Post-switch desync: host=${ps0HostX} vs friend=${ps0FriendX}`);

    // 5. Start Round Transition & Live Combat Sync
    const epochBeforeRound = psHostEnd.matchEpoch;
    await hostPage.click('[data-action="start-match"]');

    await Promise.all([
      hostPage.waitForFunction(
        ({ roundPhase, hudScreen, prevEpoch }) => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          return Boolean(d && d.phase === roundPhase && d.screen === hudScreen && d.matchEpoch > prevEpoch);
        },
        { roundPhase: RoomPhase.Round, hudScreen: ScreenId.Hud, prevEpoch: epochBeforeRound },
        { timeout: 15_000, polling: 100 },
      ),
      friendPage.waitForFunction(
        ({ roundPhase, hudScreen, prevEpoch }) => {
          const d = (window as unknown as { __bbDebug?: DebugSnapshot }).__bbDebug;
          return Boolean(d && d.phase === roundPhase && d.screen === hudScreen && d.matchEpoch > prevEpoch && d.snapshotsReceived >= 20);
        },
        { roundPhase: RoomPhase.Round, hudScreen: ScreenId.Hud, prevEpoch: epochBeforeRound },
        { timeout: 15_000, polling: 100 },
      ),
    ]);

    const [roundHostInit, roundFriendInit] = await Promise.all([readDebug(hostPage), readDebug(friendPage)]);
    assert(
      roundHostInit.matchEpoch === roundFriendInit.matchEpoch,
      `Round epoch mismatch: host=${roundHostInit.matchEpoch} friend=${roundFriendInit.matchEpoch}`,
    );
    const r0Start = roundHostInit.fightersState.find((f) => f.slot === 0)!.x;
    const r1Start = roundHostInit.fightersState.find((f) => f.slot === 1)!.x;

    // Both players run toward center and throw attacks!
    await Promise.all([
      (async () => {
        await holdKey(hostPage, 'KeyD', 750);
        await holdKey(hostPage, 'KeyJ', 120);
        await hostPage.waitForTimeout(250);
        await holdKey(hostPage, 'KeyJ', 120);
      })(),
      (async () => {
        await holdKey(friendPage, 'KeyA', 750);
        await holdKey(friendPage, 'KeyJ', 120);
        await friendPage.waitForTimeout(250);
        await holdKey(friendPage, 'KeyJ', 120);
      })(),
    ]);

    await hostPage.screenshot({ path: resolve(EVIDENCE_DIR, 'round-host.png') });
    await friendPage.screenshot({ path: resolve(EVIDENCE_DIR, 'round-friend.png') });

    // Wait briefly for settle & interpolation catch-up on both tabs
    await Promise.all([hostPage.waitForTimeout(450), friendPage.waitForTimeout(450)]);
    await Promise.all([waitForFrames(hostPage, 2), waitForFrames(friendPage, 2)]);

    const [roundHostEnd, roundFriendEnd] = await Promise.all([readDebug(hostPage), readDebug(friendPage)]);

    const rh0 = roundHostEnd.fightersState.find((f) => f.slot === 0)!;
    const rh1 = roundHostEnd.fightersState.find((f) => f.slot === 1)!;
    const rf0 = roundFriendEnd.fightersState.find((f) => f.slot === 0)!;
    const rf1 = roundFriendEnd.fightersState.find((f) => f.slot === 1)!;

    console.log(
      `[netcode-sync] Round sync: snaps=${roundFriendEnd.snapshotsReceived} | slot0 host=(${rh0.x.toFixed(2)}, dmg=${rh0.damage.toFixed(1)}) friend=(${rf0.x.toFixed(2)}, dmg=${rf0.damage.toFixed(1)}) | slot1 host=(${rh1.x.toFixed(2)}, dmg=${rh1.damage.toFixed(1)}) friend=(${rf1.x.toFixed(2)}, dmg=${rf1.damage.toFixed(1)})`,
    );

    assert(roundFriendEnd.snapshotsReceived >= 40, `Expected >= 40 Round snapshots on Friend, got ${roundFriendEnd.snapshotsReceived}`);
    assert(Math.abs(rh0.x - r0Start) > 1.0, `Host slot 0 did not move in Round (${r0Start} -> ${rh0.x})`);
    assert(Math.abs(rh1.x - r1Start) > 1.0, `Friend slot 1 did not move on Host in Round (${r1Start} -> ${rh1.x})`);
    assert(Math.abs(rh0.x - rf0.x) < 0.7, `Round slot 0 X desync: host=${rh0.x} vs friend=${rf0.x}`);
    assert(Math.abs(rh1.x - rf1.x) < 0.7, `Round slot 1 X desync: host=${rh1.x} vs friend=${rf1.x}`);
    assert(Math.abs(rh0.damage - rf0.damage) < 1.0, `Round slot 0 damage desync: host=${rh0.damage} vs friend=${rf0.damage}`);
    assert(Math.abs(rh1.damage - rf1.damage) < 1.0, `Round slot 1 damage desync: host=${rh1.damage} vs friend=${rf1.damage}`);

    assert(pageErrors.length === 0, `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);

    const report = {
      generatedAtUtc: new Date().toISOString(),
      passed: true,
      roomCode: hostPreJoin.roomCode,
      hostTickBeforeJoin: hostPreJoin.tick,
      lobbySync: {
        epoch: hostLobbyInit.matchEpoch,
        slot0HostX: h0OnHost.x,
        slot0FriendX: h0OnFriend.x,
        slot1HostX: h1OnHost.x,
        slot1FriendX: h1OnFriend.x,
      },
      fighterSwitchSynced: true,
      roundSync: {
        epoch: roundHostEnd.matchEpoch,
        friendSnapshotsReceived: roundFriendEnd.snapshotsReceived,
        slot0HostX: rh0.x,
        slot0FriendX: rf0.x,
        slot1HostX: rh1.x,
        slot1FriendX: rf1.x,
        slot0Damage: rh0.damage,
        slot1Damage: rh1.damage,
      },
      diagnostics: { host: hostDiag, friend: friendDiag },
    };

    const reportPath = resolve(EVIDENCE_DIR, 'netcode-sync-report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[netcode-sync] PASS -> ${reportPath}`);
  } finally {
    await Promise.allSettled([hostCtx?.close(), friendCtx?.close(), browser.close(), server.close()]);
  }
}

main().catch((err) => {
  console.error('[netcode-sync] FAILED:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
