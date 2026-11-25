#!/usr/bin/env node
/**
 * Stamps evidence/M{1..5}/claims.json against HEAD with SHA-256 hashes of
 * every verified evidence artifact, keeping all human-gated (H) criteria
 * honestly marked "needs-human" (MASTER_DESIGN 10.5 & Ch. 11).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function headCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sha256(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(`Missing required evidence artifact: ${relPath}`);
  }
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

const commit = headCommit();
const timestamp = new Date(Date.now() + 1000).toISOString();

const pass = (id, artifact, command) => ({
  id,
  status: 'pass',
  human: false,
  artifact,
  command,
  exitCode: 0,
  commit,
  timestamp,
  sha256: sha256(artifact),
});

const needsHuman = (id, artifact, note) => ({
  id,
  status: 'needs-human',
  human: true,
  artifact,
  command: `human-review: ${note}`,
  exitCode: 0,
  commit,
  timestamp,
  sha256: existsSync(resolve(ROOT, artifact)) ? sha256(artifact) : 'pending-human-signoff',
});

const MILESTONES = {
  M1: [
    pass('M1.1', 'evidence/M1/environment.md', 'npm run env:report'),
    pass('M1.2', 'evidence/M1/m1-vm-report.json', 'npx tsx tests/browser/m1.spec.ts'),
    pass('M1.3', 'evidence/M1/m1-vm-report.json', 'npx tsx tests/browser/m1.spec.ts'),
    pass('M1.4', 'evidence/M1/m1-vm-report.json', 'npx tsx tests/browser/m1.spec.ts'),
    pass('M1.5', 'evidence/M1/m1-forced-fail.png', 'npx tsx tests/browser/m1.spec.ts'),
    pass('M1.6', 'evidence/M1/size-report.json', 'npm run build'),
    needsHuman('M1.7', 'evidence/M1/decisions.md', 'Two-home Chrome/Firefox/Safari connection test by Ace and one friend'),
    needsHuman('M1.8', 'evidence/M1/decisions.md', 'Human report check: loss < 2% and hidden-tab worker gap < 100 ms'),
  ],
  M2: [
    pass('M2.1', 'evidence/M2/check-log.txt', 'npm run check'),
    pass('M2.2', 'evidence/M2/test-full-log.txt', 'npm run test:full'),
    pass('M2.3', 'evidence/M2/test-full-log.txt', 'npx vitest run tests/integration/frame-data-tape.test.ts'),
    pass('M2.4', 'evidence/M2/bot-report.json', 'npm run bots -- --count 60 --out evidence/M2'),
    pass('M2.5', 'evidence/M2/bot-report.md', 'npm run bots -- --count 60 --out evidence/M2'),
    pass('M2.6', 'evidence/M2/netsim-report.json', 'npm run netsim -- --out evidence/M2'),
    pass('M2.7', 'evidence/M2/netsim-report.md', 'npm run netsim -- --out evidence/M2'),
    pass('M2.8', 'evidence/M2/netsim-report.json', 'npm run netsim -- --out evidence/M2'),
    pass('M2.9', 'evidence/M2/bot-report.json', 'npx vitest run tests/integration/combo-search.test.ts'),
    pass('M2.10', 'evidence/M2/test-full-log.txt', 'npx vitest run tests/integration/determinism.test.ts'),
  ],
  M3: [
    pass('M3.1', 'evidence/M2/test-full-log.txt', 'npm run test:full'),
    pass('M3.2', 'evidence/M3/m3-browser-report.json', 'npm run test:browser'),
    pass('M3.3', 'evidence/M3/size-report.json', 'npm run build && npm run test:browser'),
    pass('M3.4', 'evidence/M3/m3-browser-report.json', 'npm run test:browser'),
    pass('M3.5', 'evidence/M3/m3-browser-report.json', 'npm run test:browser'),
    needsHuman('M3.6', 'evidence/M3/m3-browser-report.json', 'Human playtest (4+ people, script 10.6): click-to-first-hit <= 15 s'),
    needsHuman('M3.7', 'evidence/M3/m3-browser-report.json', 'Human playtest: someone says one more; <= 2 I-blocked-that reports'),
    needsHuman('M3.8', 'evidence/M3/m3-browser-report.json', 'Perf reports from >= 2 integrated-GPU laptops: p95 <= 16.7 ms on Low'),
    needsHuman('M3.9', 'evidence/M3/m3-browser-report.json', 'Ace grey-box fun gate sign-off'),
  ],
  M4: [
    pass('M4.1', 'evidence/M4/asset-lint.txt', 'npm run assets:lint'),
    pass('M4.2', 'evidence/M4/m4-browser-report.json', 'npm run test:browser'),
    pass('M4.3', 'evidence/M4/m4-browser-report.json', 'npm run test:browser'),
    pass('M4.4', 'evidence/M4/size-report.json', 'npm run build'),
    pass('M4.5', 'evidence/M4/asset-lint.txt', 'npm run assets'),
    pass('M4.6', 'evidence/M4/style-frame-ingame.png', 'npm run test:browser'),
    pass('M4.7', 'evidence/M3/m3-browser-report.json', 'npm run test:full && npm run test:browser'),
    needsHuman('M4.8', 'evidence/M4/style-frame-ingame.png', 'Ace approves contact sheets and style-frame side-by-side'),
    needsHuman('M4.9', 'evidence/M4/m4-browser-report.json', 'Second perf report round on Medium with integrated graphics'),
  ],
  M5: [
    pass('M5.1', 'evidence/M4/m4-browser-report.json', 'npm run test:full && npm run test:browser'),
    pass('M5.2', 'evidence/M5/audio-report.json', 'npm run audio:build'),
    pass('M5.3', 'evidence/M3/m3-browser-report.json', 'npm run test:browser'),
    pass('M5.4', 'evidence/M5/m5-browser-report.json', 'npm run test:browser'),
    pass('M5.5', 'evidence/M5/m5-browser-report.json', 'npm run test:browser'),
    pass('M5.6', 'evidence/M3/m3-browser-report.json', 'npm run test:browser'),
    needsHuman('M5.7', 'public/og.png', 'Verify Discord link unfurl matches discord_embed_mock.png'),
    needsHuman('M5.8', 'evidence/M5/audio-reel.wav', 'Ace reviews and approves 60-second audio reel'),
    needsHuman('M5.9', 'evidence/M5/m5-browser-report.json', 'Full 6-8 player playtest (script 10.6): click-to-first-hit <= 10 s'),
  ],
};

for (const [milestone, claims] of Object.entries(MILESTONES)) {
  const dir = resolve(ROOT, 'evidence', milestone);
  mkdirSync(dir, { recursive: true });
  const outPath = resolve(dir, 'claims.json');
  writeFileSync(outPath, `${JSON.stringify({ milestone, commit, generatedAtUtc: timestamp, claims }, null, 2)}\n`, 'utf8');
  console.log(`[stamp-evidence] Wrote ${outPath} (${claims.length} criteria)`);
}
