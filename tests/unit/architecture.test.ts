import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('architecture import boundaries and zero-fallback discipline', () => {
  const simFiles = collectTsFiles('src/sim');

  it('keeps src/sim/ completely free of DOM, three.js, timers, Date, Math.random, and outer layers', () => {
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\bMath\.random\b/,
      /\bDate\b/,
      /\bperformance\.now\b/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /\brequestAnimationFrame\b/,
      /from\s+['"]three/,
      /from\s+['"]trystero/,
      /from\s+['"]@(net|host|bots|client)\//,
    ];
    for (const file of simFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const re of forbidden) {
        expect(src, `${relative('.', file)} must not match ${re}`).not.toMatch(re);
      }
    }
  });

  it('forbids silent empty catch blocks and banned asset pack names across src/', () => {
    const allSrc = collectTsFiles('src');
    const silentCatch = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
    const bannedPacks = /\b(kenney|quaternius|kaykit|synty|mixamo)\b/i;
    for (const file of allSrc) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${relative('.', file)} has silent catch block`).not.toMatch(silentCatch);
      expect(src, `${relative('.', file)} references banned asset pack`).not.toMatch(bannedPacks);
    }
  });

  it('keeps net/ (outside transport/trystero.ts) free of Trystero, DOM, and three.js', () => {
    const netFiles = collectTsFiles('src/net').filter((f) => !f.endsWith('trystero.ts'));
    for (const file of netFiles) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${relative('.', file)} must not import trystero`).not.toMatch(/from\s+['"]trystero/);
      expect(src, `${relative('.', file)} must not import three`).not.toMatch(/from\s+['"]three/);
      expect(src, `${relative('.', file)} must not touch document`).not.toMatch(/\bdocument\b/);
    }
  });
});
