#!/usr/bin/env node
/**
 * Static architecture & engineering discipline linter for Bric-a-Brawl.
 * Scans TypeScript sources in src/ and assets in public/ for import boundaries,
 * determinism violations, banned asset packs, and silent catch blocks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = resolve(ROOT, 'src');
const PUBLIC_DIR = resolve(ROOT, 'public');

const BANNED_PACK_RE = /\b(kenney|quaternius|kaykit|synty|mixamo)\b/i;
const BANNED_PACK_PATH_RE = /(kenney|quaternius|kaykit|synty|mixamo)/i;
const EMPTY_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;

const SIM_FORBIDDEN_IDENTS = [
  ['window', /\bwindow\b/],
  ['document', /\bdocument\b/],
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['requestAnimationFrame', /\brequestAnimationFrame\b/],
  ['Date', /\bDate\b/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
];

function walkFiles(dir, predicate) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return out;
    throw err;
  }
  for (const ent of entries) {
    const full = resolve(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full, predicate));
    } else if (!predicate || predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strips // and /* *\/ comments while preserving string/template literals.
 * If stripStrings is true, replaces string/template contents with spaces too
 * (preserving newlines so line numbers remain accurate).
 */
function stripSource(src, stripStrings) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += stripStrings ? ' ' : ch;
      i++;
      while (i < n) {
        const c = src[i];
        if (c === '\\') {
          out += stripStrings ? (src[i + 1] === '\n' ? '\n' : ' ') : src.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (quote === '`' && c === '$' && src[i + 1] === '{') {
          // Keep template expression delimiters so code inside ${...} is preserved when stripStrings=false
          out += stripStrings ? '  ' : '${';
          i += 2;
          continue;
        }
        if (c === quote) {
          out += stripStrings ? ' ' : c;
          i++;
          break;
        }
        out += stripStrings ? (c === '\n' ? '\n' : ' ') : c;
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function extractImports(codeNoComments) {
  const specs = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of codeNoComments.matchAll(re)) {
      specs.push(m[1]);
    }
  }
  return specs;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function isPkg(spec, pkgName) {
  return spec === pkgName || spec.startsWith(`${pkgName}/`);
}

function resolvesInside(fromFile, spec, targetDir) {
  if (!spec.startsWith('.')) return false;
  const resolved = resolve(dirname(fromFile), spec);
  const rel = relative(targetDir, resolved);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

function main() {
  const violations = [];
  const add = (file, msg) => violations.push(`${relative(ROOT, file)}: ${msg}`);

  const tsFiles = walkFiles(SRC_DIR, (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  for (const file of tsFiles) {
    const rel = relative(SRC_DIR, file).replace(/\\/g, '/');
    const raw = readFileSync(file, 'utf8');
    const noComments = stripSource(raw, false);
    const codeOnly = stripSource(raw, true);
    const imports = extractImports(noComments);

    // 1. Silent catch blocks everywhere in src/
    for (const m of noComments.matchAll(EMPTY_CATCH_RE)) {
      add(file, `line ${lineOf(noComments, m.index)}: silent empty catch block`);
    }

    // 2. Banned asset pack names in src/
    if (BANNED_PACK_PATH_RE.test(rel)) {
      add(file, `banned asset pack name in path`);
    }
    const packMatch = raw.match(BANNED_PACK_RE);
    if (packMatch) {
      add(file, `banned asset pack reference "${packMatch[0]}"`);
    }

    // 3. Layer boundary checks
    if (rel.startsWith('sim/')) {
      for (const spec of imports) {
        if (isPkg(spec, 'three') || isPkg(spec, 'trystero')) {
          add(file, `src/sim/ must not import "${spec}"`);
        }
        for (const forbidden of ['@net/', '@host/', '@bots/', '@client/']) {
          if (spec.startsWith(forbidden)) {
            add(file, `src/sim/ must not import "${spec}"`);
          }
        }
        for (const layer of ['net', 'host', 'bots', 'client']) {
          if (resolvesInside(file, spec, resolve(SRC_DIR, layer))) {
            add(file, `src/sim/ must not import "${spec}" (crosses into src/${layer}/)`);
          }
        }
      }
      for (const [label, re] of SIM_FORBIDDEN_IDENTS) {
        const m = codeOnly.match(re);
        if (m && m.index !== undefined) {
          add(file, `line ${lineOf(codeOnly, m.index)}: src/sim/ must not reference "${label}"`);
        }
      }
    } else if (rel.startsWith('net/') && rel !== 'net/transport/trystero.ts') {
      for (const spec of imports) {
        if (isPkg(spec, 'trystero') || isPkg(spec, 'three')) {
          add(file, `src/net/ (outside trystero.ts) must not import "${spec}"`);
        }
      }
      for (const [label, re] of [['window', /\bwindow\b/], ['document', /\bdocument\b/]]) {
        const m = codeOnly.match(re);
        if (m && m.index !== undefined) {
          add(file, `line ${lineOf(codeOnly, m.index)}: src/net/ must not reference "${label}"`);
        }
      }
    } else if (rel.startsWith('host/')) {
      for (const spec of imports) {
        if (isPkg(spec, 'three')) {
          add(file, `src/host/ must not import "${spec}"`);
        }
      }
      for (const [label, re] of [['window', /\bwindow\b/], ['document', /\bdocument\b/]]) {
        const m = codeOnly.match(re);
        if (m && m.index !== undefined) {
          add(file, `line ${lineOf(codeOnly, m.index)}: src/host/ must not reference "${label}"`);
        }
      }
    } else if (rel.startsWith('bots/')) {
      for (const spec of imports) {
        const okSim = spec.startsWith('@sim/');
        const okRel = spec.startsWith('./') && resolvesInside(file, spec, resolve(SRC_DIR, 'bots'));
        if (!okSim && !okRel) {
          add(file, `src/bots/ may only import @sim/* or relative ./* inside src/bots/ (found "${spec}")`);
        }
      }
    }
  }

  // 4. Banned asset pack names anywhere in public/
  const publicFiles = walkFiles(PUBLIC_DIR);
  for (const file of publicFiles) {
    const rel = relative(PUBLIC_DIR, file).replace(/\\/g, '/');
    if (BANNED_PACK_PATH_RE.test(rel)) {
      add(file, `banned asset pack name in public/ path`);
    }
    if (statSync(file).size <= 10 * 1024 * 1024) {
      const content = readFileSync(file, 'utf8');
      const m = content.match(BANNED_PACK_RE);
      if (m) {
        add(file, `banned asset pack string "${m[0]}" in public/ file`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[check-arch] FAILED (${violations.length} violation${violations.length === 1 ? '' : 's'}):`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log(`[check-arch] PASS (${tsFiles.length} TS files, ${publicFiles.length} public files checked)`);
}

main();
