#!/usr/bin/env node
/**
 * Heavy-job lock + RAM watchdog wrapper (MASTER_DESIGN 8.3 & 8.4).
 * Ensures only one heavy job runs at a time via flock /tmp/bb-heavy.lock
 * and refuses to start when available memory is below 1536 MB.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MIN_AVAIL_MB = 1536;
const LOCK_FILE = '/tmp/bb-heavy.lock';

function readAvailableMemoryMb() {
  const info = readFileSync('/proc/meminfo', 'utf8');
  const match = info.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) throw new Error('Unable to parse MemAvailable from /proc/meminfo');
  return Math.floor(Number(match[1]) / 1024);
}

const job = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!job) {
  console.error('Usage: node scripts/heavy.mjs <job> [...args]');
  process.exit(2);
}

const JOB_COMMANDS = {
  check: [
    ['npx', ['tsc', '--noEmit']],
    ['node', ['scripts/check-arch.mjs']],
    ['node', ['scripts/check-data-parity.mjs']],
    ['node', ['scripts/check-assets.mjs']],
    ['npx', ['vitest', 'run', 'tests/unit', 'tests/integration/frame-data-tape.test.ts', 'tests/integration/pillars.test.ts', 'tests/integration/gadgets.test.ts', 'tests/integration/determinism.test.ts']],
  ],
  'test:integration': [
    ['npx', ['vitest', 'run', 'tests/integration']],
  ],
  'test:full': [
    ['npx', ['tsc', '--noEmit']],
    ['node', ['scripts/check-arch.mjs']],
    ['node', ['scripts/check-data-parity.mjs']],
    ['node', ['scripts/check-assets.mjs']],
    ['npx', ['vitest', 'run']],
  ],
  'test:browser': [
    ['npx', ['tsx', 'tests/browser/run.ts']],
  ],
  build: [
    ['npx', ['vite', 'build']],
    ['node', ['scripts/size-report.mjs']],
  ],
  bots: [
    ['npx', ['tsx', 'scripts/run-bots.ts']],
  ],
  netsim: [
    ['npx', ['tsx', 'scripts/run-netsim.ts']],
  ],
  'svg:dump': [
    ['npx', ['tsx', 'scripts/dump-svg.ts']],
  ],
  assets: [
    ['node', ['scripts/check-assets.mjs']],
    ['npx', ['tsx', 'scripts/build-audio.ts']],
  ],
};

if (!(job in JOB_COMMANDS)) {
  console.error(`Unknown heavy job: ${job}`);
  process.exit(2);
}

if (process.env.BB_HEAVY_LOCKED !== '1') {
  const res = spawnSync('flock', [LOCK_FILE, process.execPath, process.argv[1], job, ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, BB_HEAVY_LOCKED: '1' },
  });
  process.exit(res.status ?? 1);
}

const availMb = readAvailableMemoryMb();
console.log(`[heavy:${job}] MemAvailable=${availMb} MB (min=${MIN_AVAIL_MB} MB)`);
if (availMb < MIN_AVAIL_MB) {
  console.error(`[heavy:${job}] ABORT: Available memory ${availMb} MB < ${MIN_AVAIL_MB} MB`);
  process.exit(1);
}

const t0 = performance.now();
for (const [cmd, args] of JOB_COMMANDS[job]) {
  const fullArgs = JOB_COMMANDS[job].length === 1 ? [...args, ...extraArgs] : args;
  console.log(`[heavy:${job}] $ ${cmd} ${fullArgs.join(' ')}`);
  execFileSync(cmd, fullArgs, { stdio: 'inherit' });
}
const elapsedSec = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`[heavy:${job}] Completed in ${elapsedSec}s`);
