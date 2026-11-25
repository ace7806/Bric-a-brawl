import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLIENT_DOWN_BUDGET_BPS, CLIENT_UP_BUDGET_BPS, HOST_UP_BUDGET_BPS } from '../src/net/config';
import { NetsimProfileId } from '../src/net/enums';
import { assert, requireKey } from '../src/sim/assert';
import { ErrorCode } from '../src/sim/enums';
import { getGameData } from '../src/sim/data';
import { runNetsimScenario, type NetsimMetrics } from '../tests/support/netsim';

const PROFILE_MAP = new Map<string, NetsimProfileId>([
  ['lan', NetsimProfileId.Lan],
  ['typical', NetsimProfileId.Typical],
  ['far', NetsimProfileId.Far],
  ['limit', NetsimProfileId.Limit],
  ['wifi', NetsimProfileId.Wifi],
  ['awful', NetsimProfileId.Awful],
  ['stall', NetsimProfileId.Stall],
  ['churn', NetsimProfileId.Churn],
]);

const ALL_PROFILES: readonly NetsimProfileId[] = [
  NetsimProfileId.Lan,
  NetsimProfileId.Typical,
  NetsimProfileId.Far,
  NetsimProfileId.Limit,
  NetsimProfileId.Wifi,
  NetsimProfileId.Awful,
  NetsimProfileId.Stall,
  NetsimProfileId.Churn,
];

interface CliArgs {
  readonly profiles: readonly NetsimProfileId[];
  readonly seed: number;
  readonly seconds: number;
  readonly outDir: string;
}

interface ProfileReport {
  readonly profile: string;
  readonly n1SnapshotMismatches: number;
  readonly n2WinnerAndKoAgreement: boolean;
  readonly n3InputLossRate: number;
  readonly n4PredErrorP95: number;
  readonly n5LargeCorrectionsPer10s: number;
  readonly n6ParrySuccessRate: number;
  readonly n7BlockedHitRate: number;
  readonly n8ClientDownKbps: number;
  readonly n8ClientUpKbps: number;
  readonly n8HostUpKbps: number;
  readonly n9HostTickP99Ms: number;
  readonly n10ChurnPassed: boolean | null;
  readonly n11Exceptions: number;
  readonly n11MaxBufferSize: number;
  readonly passed: boolean;
}

function parseCli(argv: readonly string[]): CliArgs {
  let profileRaw = 'all';
  let seed = 3;
  let seconds = 30;
  let outDir = 'evidence/M2';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile' && i + 1 < argv.length) profileRaw = argv[++i]!.toLowerCase();
    else if (a === '--seed' && i + 1 < argv.length) seed = Number(argv[++i]);
    else if (a === '--seconds' && i + 1 < argv.length) seconds = Number(argv[++i]);
    else if (a === '--out' && i + 1 < argv.length) outDir = argv[++i]!;
  }
  assert(Number.isInteger(seed), ErrorCode.InvariantViolation, `Invalid --seed ${seed}`);
  assert(Number.isFinite(seconds) && seconds > 0, ErrorCode.InvariantViolation, `Invalid --seconds ${seconds}`);
  const profiles = profileRaw === 'all' ? ALL_PROFILES : [requireKey(PROFILE_MAP, profileRaw, '--profile')];
  return { profiles, seed, seconds, outDir };
}

function toProfileReport(m: NetsimMetrics): ProfileReport {
  const isLimit = m.profileId === NetsimProfileId.Limit || m.profileId === NetsimProfileId.Far || m.profileId === NetsimProfileId.Wifi;
  const isAwfulOrStall = m.profileId === NetsimProfileId.Awful || m.profileId === NetsimProfileId.Stall;
  const isChurn = m.profileId === NetsimProfileId.Churn;

  const n2Pass = m.koOrderAgreement && m.winnerAgreement;
  const n3Pass = isAwfulOrStall || isChurn || m.profileId === NetsimProfileId.Wifi ? m.inputLossRate <= 0.005 : m.inputLossRate === 0;
  const n4Pass = isAwfulOrStall || isChurn ? true : m.predictionErrorP95 <= (isLimit ? 0.35 : 0.15);
  const n5Pass = isAwfulOrStall || isChurn ? true : m.largeCorrectionsPer10s <= (isLimit ? 3 : 1);
  const n6Pass = isAwfulOrStall || isChurn ? true : m.parryBotSuccessRate >= (isLimit ? 0.7 : 0.9);
  const n7Pass = isAwfulOrStall || isChurn ? true : m.blockBotFailRate <= (isLimit ? 0.05 : 0.001);
  const n8Pass =
    m.clientDownBps <= CLIENT_DOWN_BUDGET_BPS &&
    m.clientUpBps <= CLIENT_UP_BUDGET_BPS &&
    m.hostUpBps <= HOST_UP_BUDGET_BPS;
  const n9Pass = m.hostTickP99Ms < 4.0;
  const n10Passed = isChurn ? m.churnLateJoinIsTeaspoon && m.churnRecoveryMs < 5000 && m.churnScoresIntact : null;
  const n11Pass = m.exceptions === 0 && m.maxBufferEntries <= 256;

  return {
    profile: NetsimProfileId[m.profileId],
    n1SnapshotMismatches: m.desyncMismatches,
    n2WinnerAndKoAgreement: n2Pass,
    n3InputLossRate: Number(m.inputLossRate.toFixed(5)),
    n4PredErrorP95: Number(m.predictionErrorP95.toFixed(4)),
    n5LargeCorrectionsPer10s: Number(m.largeCorrectionsPer10s.toFixed(2)),
    n6ParrySuccessRate: Number(m.parryBotSuccessRate.toFixed(3)),
    n7BlockedHitRate: Number(m.blockBotFailRate.toFixed(3)),
    n8ClientDownKbps: Number((m.clientDownBps / 1000).toFixed(2)),
    n8ClientUpKbps: Number((m.clientUpBps / 1000).toFixed(2)),
    n8HostUpKbps: Number((m.hostUpBps / 1000).toFixed(2)),
    n9HostTickP99Ms: Number(m.hostTickP99Ms.toFixed(3)),
    n10ChurnPassed: n10Passed,
    n11Exceptions: m.exceptions,
    n11MaxBufferSize: m.maxBufferEntries,
    passed:
      m.desyncMismatches === 0 &&
      n2Pass &&
      n3Pass &&
      n4Pass &&
      n5Pass &&
      n6Pass &&
      n7Pass &&
      n8Pass &&
      n9Pass &&
      (n10Passed ?? true) &&
      n11Pass,
  };
}

async function main(): Promise<void> {
  const args = parseCli(process.argv.slice(2));
  const hz = getGameData().tuning.tickRate;
  const wallT0 = performance.now();
  const reports: ProfileReport[] = [];

  // Warm up V8 JIT + Rapier WASM so profile 0 (Lan) measures steady-state N9 tick p99
  await runNetsimScenario({ profileId: NetsimProfileId.Lan, seed: 999, durationTicks: 300 });

  for (let i = 0; i < args.profiles.length; i++) {
    const profileId = args.profiles[i]!;
    const durationTicks = profileId === NetsimProfileId.Churn ? Math.max(5400, Math.round(args.seconds * hz)) : Math.round(args.seconds * hz);
    const metrics = await runNetsimScenario({ profileId, seed: args.seed + i * 17, durationTicks });
    reports.push(toProfileReport(metrics));
  }

  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const outAbs = resolve(args.outDir);
  mkdirSync(outAbs, { recursive: true });

  const json = {
    meta: {
      commit,
      command: `npm run netsim -- ${process.argv.slice(2).join(' ')}`.trim(),
      seed: args.seed,
      seconds: args.seconds,
      wallSec: Number(((performance.now() - wallT0) / 1000).toFixed(2)),
      timestamp: new Date().toISOString(),
    },
    allPassed: reports.every((r) => r.passed),
    profiles: reports,
  };
  writeFileSync(resolve(outAbs, 'netsim-report.json'), JSON.stringify(json, null, 2), 'utf8');

  const sections: string[] = [
    '# Netsim Report (N1-N11)',
    '',
    `- **Commit:** \`${commit}\``,
    `- **Seed / Duration:** ${args.seed} / ${args.seconds} s per profile`,
    `- **Overall:** ${json.allPassed ? 'PASS' : 'FAIL'}`,
    '',
  ];
  for (const r of reports) {
    sections.push(
      `## Profile: ${r.profile} (${r.passed ? 'PASS' : 'FAIL'})`,
      '',
      '| Assertion | Metric | Measured |',
      '|---|---|---|',
      `| N1 | Snapshot mismatches | ${r.n1SnapshotMismatches} |`,
      `| N2 | KO & winner agreement | ${r.n2WinnerAndKoAgreement} |`,
      `| N3 | Input loss rate | ${(r.n3InputLossRate * 100).toFixed(3)}% |`,
      `| N4 | Own-fighter pred err p95 | ${r.n4PredErrorP95} u |`,
      `| N5 | Large corrections / 10s | ${r.n5LargeCorrectionsPer10s} |`,
      `| N6 | ParryBot success | ${(r.n6ParrySuccessRate * 100).toFixed(1)}% |`,
      `| N7 | BlockBot hit-through | ${(r.n7BlockedHitRate * 100).toFixed(1)}% |`,
      `| N8 | BW client down / up / host up | ${r.n8ClientDownKbps} / ${r.n8ClientUpKbps} / ${r.n8HostUpKbps} kB/s |`,
      `| N9 | Host tick p99 | ${r.n9HostTickP99Ms} ms |`,
      `| N10 | Churn migration <5s | ${r.n10ChurnPassed === null ? '—' : r.n10ChurnPassed} |`,
      `| N11 | Exceptions / max unacked | ${r.n11Exceptions} / ${r.n11MaxBufferSize} |`,
      '',
    );
  }
  writeFileSync(resolve(outAbs, 'netsim-report.md'), sections.join('\n'), 'utf8');
  console.log(`[run-netsim] Wrote ${resolve(outAbs, 'netsim-report.json')} and netsim-report.md (allPassed=${json.allPassed})`);
  if (!json.allPassed) {
    const failed = reports.filter((r) => !r.passed).map((r) => r.profile);
    console.error(`[run-netsim] FAILED profiles: ${failed.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
