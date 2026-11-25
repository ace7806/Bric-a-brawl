#!/usr/bin/env node
/**
 * Evidence verifier & SUMMARY.md generator (MASTER_DESIGN 10.5).
 * Usage: npm run evidence:verify M<n>
 * Reads evidence/M<n>/claims.json, validates schema, status rules, human sign-off rules,
 * artifact existence, SHA-256 integrity, and commit hash, then writes evidence/M<n>/SUMMARY.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const VALID_STATUSES = new Set(['pass', 'fail', 'needs-human']);
const REQUIRED_FIELDS = ['id', 'status', 'artifact', 'command', 'exitCode', 'commit', 'timestamp', 'sha256'];

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function getHeadCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function getCommitIsoTime(commit) {
  const out = execFileSync('git', ['show', '-s', '--format=%cI', commit], { cwd: ROOT, encoding: 'utf8' }).trim();
  const ms = Date.parse(out);
  if (!Number.isFinite(ms)) throw new Error(`Unable to parse git commit time for ${commit}: ${out}`);
  return ms;
}

function resolveArtifactPath(milestoneDir, artifactField) {
  if (typeof artifactField !== 'string' || artifactField.trim().length === 0) return null;
  const fromRoot = resolve(ROOT, artifactField);
  if (existsSync(fromRoot)) return fromRoot;
  const fromMilestone = resolve(milestoneDir, artifactField);
  if (existsSync(fromMilestone)) return fromMilestone;
  return fromRoot;
}

function main() {
  const milestone = process.argv[2];
  if (!milestone || !/^M\d+$/.test(milestone)) {
    console.error('Usage: node scripts/verify-evidence.mjs M<n> (e.g. M1)');
    process.exit(2);
  }

  const milestoneDir = resolve(ROOT, 'evidence', milestone);
  const claimsPath = resolve(milestoneDir, 'claims.json');
  if (!existsSync(claimsPath)) {
    console.error(`[verify-evidence] FAILED: Missing ${claimsPath}`);
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(claimsPath, 'utf8'));
  const claims = Array.isArray(parsed) ? parsed : parsed?.claims;
  if (!Array.isArray(claims) || claims.length === 0) {
    console.error(`[verify-evidence] FAILED: ${claimsPath} must be a non-empty array (or { claims: [...] })`);
    process.exit(1);
  }

  const headCommit = getHeadCommit();
  const errors = [];
  const rows = [];
  const seenIds = new Set();

  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    const tag = `claims[${i}]${c?.id ? ` (${c.id})` : ''}`;

    if (!c || typeof c !== 'object') {
      errors.push(`${tag}: claim entry must be an object`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in c) || c[field] === undefined || c[field] === null || c[field] === '') {
        errors.push(`${tag}: missing required field "${field}"`);
      }
    }

    if (typeof c.id !== 'string' || !c.id.startsWith(`${milestone}.`)) {
      errors.push(`${tag}: id must start with "${milestone}."`);
    } else if (seenIds.has(c.id)) {
      errors.push(`${tag}: duplicate claim id "${c.id}"`);
    } else {
      seenIds.add(c.id);
    }

    if (!VALID_STATUSES.has(c.status)) {
      errors.push(`${tag}: invalid status "${String(c.status)}" (expected pass | fail | needs-human)`);
    }

    if (typeof c.exitCode !== 'number' || !Number.isInteger(c.exitCode)) {
      errors.push(`${tag}: exitCode must be an integer`);
    } else if (c.status === 'pass' && c.exitCode !== 0) {
      errors.push(`${tag}: status is "pass" but exitCode is ${c.exitCode}`);
    }

    // Human-gated criteria cannot be marked pass unless explicitly signed off
    const isHuman = c.human === true;
    const signedOff = typeof c.signedOffBy === 'string' && c.signedOffBy.trim().length > 0 && c.signedOff === true;
    if (isHuman && c.status === 'pass' && !signedOff) {
      errors.push(`${tag}: human-gated criterion marked "pass" without explicit sign-off (signedOff: true, signedOffBy)`);
    }

    // Timestamp check
    const claimTsMs = Date.parse(c.timestamp);
    if (!Number.isFinite(claimTsMs)) {
      errors.push(`${tag}: invalid ISO timestamp "${String(c.timestamp)}"`);
    }

    // Commit verification against HEAD (or valid ancestor recorded commit if explicitly allowed? No: must match HEAD or recorded commit must exist & match)
    if (typeof c.commit === 'string' && c.commit.length > 0) {
      if (c.commit !== headCommit) {
        errors.push(`${tag}: commit "${c.commit}" does not match HEAD "${headCommit}"`);
      } else if (Number.isFinite(claimTsMs)) {
        const commitMs = getCommitIsoTime(c.commit);
        if (claimTsMs < commitMs) {
          errors.push(`${tag}: timestamp "${c.timestamp}" predates commit timestamp`);
        }
      }
    }

    // Artifact + SHA-256 check (always enforced for non-human claims, and also for human claims that are not needs-human)
    let actualHash = '—';
    const needsArtifactCheck = !isHuman || c.status === 'pass';
    if (needsArtifactCheck) {
      const artifactAbs = resolveArtifactPath(milestoneDir, c.artifact);
      if (!artifactAbs || !existsSync(artifactAbs)) {
        errors.push(`${tag}: artifact not found at "${String(c.artifact)}"`);
      } else {
        actualHash = sha256File(artifactAbs);
        if (typeof c.sha256 !== 'string' || c.sha256.toLowerCase() !== actualHash) {
          errors.push(`${tag}: sha256 mismatch for "${c.artifact}" (expected ${actualHash}, got ${c.sha256})`);
        }
      }
    }

    rows.push({
      id: String(c.id ?? '?'),
      status: String(c.status ?? '?'),
      human: isHuman ? 'yes' : 'no',
      artifact: String(c.artifact ?? ''),
      command: String(c.command ?? ''),
      exitCode: String(c.exitCode ?? ''),
      sha256Short: actualHash === '—' ? String(c.sha256 ?? '—').slice(0, 12) : actualHash.slice(0, 12),
      timestamp: String(c.timestamp ?? ''),
    });
  }

  const counts = {
    pass: claims.filter((c) => c?.status === 'pass').length,
    fail: claims.filter((c) => c?.status === 'fail').length,
    needsHuman: claims.filter((c) => c?.status === 'needs-human').length,
  };

  const summaryMd = [
    `# ${milestone} Evidence Summary`,
    '',
    `> Generated automatically by \`scripts/verify-evidence.mjs\` from \`evidence/${milestone}/claims.json\`. Do not edit by hand.`,
    '',
    `- **HEAD Commit:** \`${headCommit}\``,
    `- **Generated (UTC):** ${new Date().toISOString()}`,
    `- **Totals:** ${counts.pass} pass, ${counts.fail} fail, ${counts.needsHuman} needs-human (${claims.length} total)`,
    `- **Verification:** ${errors.length === 0 ? 'PASS' : `FAIL (${errors.length} discrepancies)`}`,
    '',
    '| ID | Status | Human | Command | Exit | Artifact | SHA-256 (12) | Timestamp |',
    '|---|---|---|---|---:|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.status} | ${r.human} | \`${r.command.replace(/\|/g, '\\|')}\` | ${r.exitCode} | \`${r.artifact}\` | \`${r.sha256Short}\` | ${r.timestamp} |`,
    ),
    '',
    ...(errors.length > 0 ? ['## Discrepancies', '', ...errors.map((e) => `- ${e}`), ''] : []),
  ].join('\n');

  const summaryPath = resolve(milestoneDir, 'SUMMARY.md');
  writeFileSync(summaryPath, summaryMd, 'utf8');

  if (errors.length > 0) {
    console.error(`[verify-evidence] FAILED for ${milestone} (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[verify-evidence] PASS for ${milestone} (${counts.pass} pass, ${counts.needsHuman} needs-human) -> ${summaryPath}`);
}

main();
