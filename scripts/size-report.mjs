#!/usr/bin/env node
/**
 * Dist bundle & payload budget reporter (M1.6 <= 150 KB gzip, M3.3 <= 2.5 MB gzip, M4.4 <= 5 MB gzip).
 * Inspects dist/ after `vite build`, prints a markdown table, writes dist/size-report.json,
 * and fails (exit 1) if any applicable budget is exceeded.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST_DIR = resolve(ROOT, 'dist');

const BUDGET_M1_GZIP = 150 * 1024;
const BUDGET_FIRST_PLAYABLE_GZIP = Math.floor(2.5 * 1024 * 1024);
const BUDGET_TOTAL_DIST_GZIP = 5 * 1024 * 1024;
const ASSET_EXTS = new Set(['.js', '.mjs', '.css', '.html', '.wasm']);
const FIRST_PLAYABLE_CHUNK_NAMES = ['main', 'rapier', 'three', 'trystero', 'msgpackr'];

function walkDist(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkDist(full));
    else out.push(full);
  }
  return out;
}

function measureFile(filePath) {
  const buf = readFileSync(filePath);
  const gz = gzipSync(buf, { level: 9 });
  return { rawBytes: buf.byteLength, gzipBytes: gz.byteLength };
}

function extractHtmlAssets(htmlPath, byRelPath) {
  if (!existsSync(htmlPath)) return null;
  const htmlRel = relative(DIST_DIR, htmlPath).replace(/\\/g, '/');
  const html = readFileSync(htmlPath, 'utf8');
  const referenced = new Set([htmlRel]);
  const attrRe = /(?:src|href)=["']([^"']+)["']/g;
  for (const m of html.matchAll(attrRe)) {
    const cleaned = m[1].replace(/^\.\//, '').replace(/^\//, '').split(/[?#]/)[0];
    if (byRelPath.has(cleaned)) referenced.add(cleaned);
  }
  // Also follow static JS module imports inside referenced JS chunks (e.g. modulepreload or chunk imports)
  const queue = [...referenced];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (!cur.endsWith('.js') && !cur.endsWith('.mjs')) continue;
    const js = readFileSync(resolve(DIST_DIR, cur), 'utf8');
    const importRe = /["']\.\/([^"']+\.(?:js|mjs|wasm))["']/g;
    for (const m of js.matchAll(importRe)) {
      const target = resolve(resolve(DIST_DIR, cur), '..', m[1]);
      const rel = relative(DIST_DIR, target).replace(/\\/g, '/');
      if (byRelPath.has(rel) && !referenced.has(rel)) {
        referenced.add(rel);
        queue.push(rel);
      }
    }
  }
  return [...referenced].sort();
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function main() {
  if (!existsSync(DIST_DIR)) {
    console.error(`[size-report] FAILED: dist/ directory not found at ${DIST_DIR}. Run vite build first.`);
    process.exit(1);
  }

  const allFiles = walkDist(DIST_DIR);
  const measured = [];
  const byRel = new Map();

  let totalRaw = 0;
  let totalGzip = 0;

  for (const f of allFiles) {
    const rel = relative(DIST_DIR, f).replace(/\\/g, '/');
    if (rel === 'size-report.json') continue;
    const sizes = measureFile(f);
    totalRaw += sizes.rawBytes;
    totalGzip += sizes.gzipBytes;

    const ext = extname(f).toLowerCase();
    if (ASSET_EXTS.has(ext)) {
      const entry = { path: rel, ext, ...sizes };
      measured.push(entry);
      byRel.set(rel, entry);
    }
  }

  measured.sort((a, b) => b.gzipBytes - a.gzipBytes);

  // M1 bundle: m1.html + its referenced assets
  const m1Refs = extractHtmlAssets(resolve(DIST_DIR, 'm1.html'), byRel);
  const m1Summary = m1Refs
    ? {
        files: m1Refs,
        rawBytes: m1Refs.reduce((s, r) => s + byRel.get(r).rawBytes, 0),
        gzipBytes: m1Refs.reduce((s, r) => s + byRel.get(r).gzipBytes, 0),
        budgetGzipBytes: BUDGET_M1_GZIP,
      }
    : null;

  // Main first-playable: index.html + main + rapier + three + trystero + msgpackr + css
  const indexHtmlPath = resolve(DIST_DIR, 'index.html');
  const indexRefs = extractHtmlAssets(indexHtmlPath, byRel);
  let mainSummary = null;
  if (indexRefs) {
    const fpSet = new Set(indexRefs);
    for (const [rel, entry] of byRel) {
      if (entry.ext === '.css') fpSet.add(rel);
      if (entry.ext === '.wasm' && rel.includes('rapier')) fpSet.add(rel);
      if (entry.ext === '.js' && FIRST_PLAYABLE_CHUNK_NAMES.some((n) => rel.includes(`/${n}-`) || rel.startsWith(`${n}-`))) {
        fpSet.add(rel);
      }
    }
    const fpFiles = [...fpSet].filter((r) => byRel.has(r)).sort();
    mainSummary = {
      files: fpFiles,
      rawBytes: fpFiles.reduce((s, r) => s + byRel.get(r).rawBytes, 0),
      gzipBytes: fpFiles.reduce((s, r) => s + byRel.get(r).gzipBytes, 0),
      budgetGzipBytes: BUDGET_FIRST_PLAYABLE_GZIP,
    };
  }

  const failures = [];
  if (m1Summary && m1Summary.gzipBytes > BUDGET_M1_GZIP) {
    failures.push(`M1 bundle ${fmtKb(m1Summary.gzipBytes)} gzip exceeds M1.6 budget ${fmtKb(BUDGET_M1_GZIP)}`);
  }
  if (mainSummary && mainSummary.gzipBytes > BUDGET_FIRST_PLAYABLE_GZIP) {
    failures.push(
      `Main first-playable ${fmtKb(mainSummary.gzipBytes)} gzip exceeds M3.3 budget ${fmtKb(BUDGET_FIRST_PLAYABLE_GZIP)}`,
    );
  }
  if (totalGzip > BUDGET_TOTAL_DIST_GZIP) {
    failures.push(`Total dist/ ${fmtKb(totalGzip)} gzip exceeds M4.4 budget ${fmtKb(BUDGET_TOTAL_DIST_GZIP)}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    assets: measured,
    m1Bundle: m1Summary,
    firstPlayable: mainSummary,
    totalDist: { rawBytes: totalRaw, gzipBytes: totalGzip, budgetGzipBytes: BUDGET_TOTAL_DIST_GZIP },
    passed: failures.length === 0,
    failures,
  };
  writeFileSync(resolve(DIST_DIR, 'size-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('| Asset | Raw | Gzip |');
  console.log('|---|---:|---:|');
  for (const a of measured) {
    console.log(`| \`${a.path}\` | ${fmtKb(a.rawBytes)} | ${fmtKb(a.gzipBytes)} |`);
  }
  console.log('');
  console.log('| Summary | Raw | Gzip | Budget (gzip) | Status |');
  console.log('|---|---:|---:|---:|---|');
  if (m1Summary) {
    const ok = m1Summary.gzipBytes <= BUDGET_M1_GZIP;
    console.log(`| M1 (\`m1.html\`) | ${fmtKb(m1Summary.rawBytes)} | ${fmtKb(m1Summary.gzipBytes)} | ${fmtKb(BUDGET_M1_GZIP)} | ${ok ? 'PASS' : 'FAIL'} |`);
  }
  if (mainSummary) {
    const ok = mainSummary.gzipBytes <= BUDGET_FIRST_PLAYABLE_GZIP;
    console.log(`| First-Playable (\`index.html\`) | ${fmtKb(mainSummary.rawBytes)} | ${fmtKb(mainSummary.gzipBytes)} | ${fmtKb(BUDGET_FIRST_PLAYABLE_GZIP)} | ${ok ? 'PASS' : 'FAIL'} |`);
  }
  const totalOk = totalGzip <= BUDGET_TOTAL_DIST_GZIP;
  console.log(`| Total \`dist/\` | ${fmtKb(totalRaw)} | ${fmtKb(totalGzip)} | ${fmtKb(BUDGET_TOTAL_DIST_GZIP)} | ${totalOk ? 'PASS' : 'FAIL'} |`);

  if (failures.length > 0) {
    console.error('\n[size-report] BUDGET EXCEEDED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
