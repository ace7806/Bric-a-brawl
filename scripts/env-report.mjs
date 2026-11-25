#!/usr/bin/env node
/**
 * M1.1 Environment Report generator -> evidence/M1/environment.md
 * Measures system resources, tool versions & disk footprints, and times a
 * trivial headless Chromium screenshot via playwright-core + /usr/bin/google-chrome.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_PATH = resolve(ROOT, 'evidence/M1/environment.md');
const CHROME_PATH = '/usr/bin/google-chrome';
const MIN_FREE_BYTES = 6 * 1024 * 1024 * 1024;

function run(cmd, args, cwd = ROOT) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function duSize(targetPath) {
  const real = realpathSync(targetPath);
  const out = run('du', ['-sh', real]);
  return out.split(/\s+/)[0];
}

function getFreeDiskBytes() {
  const out = run('df', ['-B1', '--output=avail', ROOT]);
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const val = Number(lines[lines.length - 1]);
  if (!Number.isFinite(val) || val <= 0) {
    throw new Error(`Failed to parse free disk bytes from df output: ${out}`);
  }
  return val;
}

async function benchmarkChromiumScreenshot() {
  const t0 = performance.now();
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.setContent(
      '<!doctype html><html><body style="margin:0;background:#1e3a5f;color:#faf6ec;font-family:sans-serif;display:grid;place-items:center;height:100vh"><h1>Bric-a-Brawl Env Check</h1></body></html>',
    );
    const shot = await page.screenshot({ type: 'png' });
    if (shot.byteLength < 100) {
      throw new Error(`Unexpectedly small screenshot buffer: ${shot.byteLength} bytes`);
    }
    return { elapsedMs: performance.now() - t0, bytes: shot.byteLength };
  } finally {
    await browser.close();
  }
}

async function main() {
  const timestamp = new Date().toISOString();
  const commit = run('git', ['rev-parse', 'HEAD']);
  const dfOut = run('df', ['-h', ROOT]);
  const freeOut = run('free', ['-m']);
  const freeBytes = getFreeDiskBytes();
  const freeGb = (freeBytes / (1024 ** 3)).toFixed(2);

  if (freeBytes < MIN_FREE_BYTES) {
    throw new Error(`M1.1 FAILED: Free disk ${freeGb} GB < 6.00 GB required`);
  }

  const nodeBin = process.execPath;
  const npmCli = realpathSync(run('which', ['npm']));
  const npmRoot = resolve(dirname(npmCli), '..');
  const pythonExec = run('python3', ['-c', 'import sys; print(sys.executable)']);
  const pythonPrefix = run('python3', ['-c', 'import sys; print(sys.prefix)']);
  const chromeRealDir = dirname(realpathSync(CHROME_PATH));

  const versions = {
    node: run(nodeBin, ['--version']),
    npm: run('npm', ['--version']),
    chrome: run(CHROME_PATH, ['--version']),
    python3: run('python3', ['--version']),
  };

  const sizes = {
    node: duSize(nodeBin),
    npm: duSize(npmRoot),
    nodeModules: duSize(resolve(ROOT, 'node_modules')),
    chrome: duSize(chromeRealDir),
    python3: duSize(pythonPrefix),
    pythonBin: duSize(pythonExec),
  };

  const bench = await benchmarkChromiumScreenshot();

  const md = [
    '# Bric-a-Brawl Environment Report (M1.1)',
    '',
    `- **UTC Timestamp:** ${timestamp}`,
    `- **Commit:** \`${commit}\``,
    `- **Free Disk Check:** ${freeGb} GB free (>= 6.00 GB required) — **PASS**`,
    '',
    '## Tool Versions & Disk Footprints',
    '',
    '| Tool / Artifact | Version | Path | Size (`du -sh`) |',
    '|---|---|---|---|',
    `| Node.js | ${versions.node} | \`${nodeBin}\` | ${sizes.node} |`,
    `| npm | ${versions.npm} | \`${npmRoot}\` | ${sizes.npm} |`,
    `| node_modules | — | \`${resolve(ROOT, 'node_modules')}\` | ${sizes.nodeModules} |`,
    `| Google Chrome | ${versions.chrome} | \`${chromeRealDir}\` | ${sizes.chrome} |`,
    `| Python 3 | ${versions.python3} | \`${pythonPrefix}\` (bin: \`${pythonExec}\`) | ${sizes.python3} (bin: ${sizes.pythonBin}) |`,
    '',
    '## Headless Chromium Screenshot Benchmark',
    '',
    `- **Executable:** \`${CHROME_PATH}\``,
    `- **Viewport:** 640x360`,
    `- **Total Launch + Render + PNG Screenshot Time:** ${bench.elapsedMs.toFixed(1)} ms`,
    `- **Screenshot Size:** ${bench.bytes} bytes`,
    '',
    '## Disk Space (`df -h`)',
    '',
    '```',
    dfOut,
    '```',
    '',
    '## Memory (`free -m`)',
    '',
    '```',
    freeOut,
    '```',
    '',
  ].join('\n');

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md, 'utf8');
  console.log(`[env-report] Wrote ${OUT_PATH} (free=${freeGb} GB, chromium=${bench.elapsedMs.toFixed(1)} ms)`);
}

main().catch((err) => {
  console.error('[env-report] FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
