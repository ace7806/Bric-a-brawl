#!/usr/bin/env node
/**
 * Data parity & schema validator:
 * 1. Verifies data/{tuning,fighters,gadgets,arenas,palette}.json are byte-for-byte
 *    identical to freshly generated output from bric-a-brawl-preproduction/tools/design_data.py
 *    (and bric-a-brawl-preproduction/data/*.json).
 * 2. Validates data/words.json has 3 roomWords lists of 64 unique words,
 *    64 unique lotNames, and 8 unique quickPhrases.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const PREPROD_DIR = resolve(ROOT, 'bric-a-brawl-preproduction');
const DESIGN_FILES = ['tuning.json', 'fighters.json', 'gadgets.json', 'arenas.json', 'palette.json'];

function assertUniqueStrings(list, expectedLen, label, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (list.length !== expectedLen) {
    errors.push(`${label} expected length ${expectedLen}, got ${list.length}`);
  }
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${label}[${i}] must be a non-empty string`);
      continue;
    }
    if (seen.has(item)) {
      errors.push(`${label} contains duplicate entry "${item}"`);
    }
    seen.add(item);
  }
}

function checkDesignDataParity(errors) {
  const tmp = mkdtempSync(resolve(tmpdir(), 'bb-data-parity-'));
  try {
    // Run design_data.py inside an isolated temp copy so we never mutate tracked preproduction files
    cpSync(resolve(PREPROD_DIR, 'tools'), resolve(tmp, 'tools'), { recursive: true });
    execFileSync('python3', [resolve(tmp, 'tools/design_data.py')], { cwd: tmp, stdio: 'pipe' });

    for (const file of DESIGN_FILES) {
      const generated = readFileSync(resolve(tmp, 'data', file));
      const preprod = readFileSync(resolve(PREPROD_DIR, 'data', file));
      const actual = readFileSync(resolve(DATA_DIR, file));

      if (!generated.equals(preprod)) {
        errors.push(`bric-a-brawl-preproduction/data/${file} is out of sync with design_data.py`);
      }
      if (!generated.equals(actual)) {
        errors.push(`data/${file} does not match byte-for-byte output of design_data.py`);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function checkWordsJson(errors) {
  const raw = readFileSync(resolve(DATA_DIR, 'words.json'), 'utf8');
  const words = JSON.parse(raw);

  if (!Array.isArray(words.roomWords) || words.roomWords.length !== 3) {
    errors.push(`words.json roomWords must have exactly 3 lists`);
  } else {
    for (let i = 0; i < 3; i++) {
      assertUniqueStrings(words.roomWords[i], 64, `words.json roomWords[${i}]`, errors);
    }
  }
  assertUniqueStrings(words.lotNames, 64, 'words.json lotNames', errors);
  assertUniqueStrings(words.quickPhrases, 8, 'words.json quickPhrases', errors);
}

function main() {
  const errors = [];
  checkDesignDataParity(errors);
  checkWordsJson(errors);

  if (errors.length > 0) {
    console.error(`[check-data-parity] FAILED (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('[check-data-parity] PASS (5 design JSONs match design_data.py byte-for-byte; words.json valid)');
}

main();
