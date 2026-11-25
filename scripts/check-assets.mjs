#!/usr/bin/env node
/**
 * M4.1 art & asset budget linter (ART_BIBLE 4.9).
 * Verifies matcap dimensions, fighter GLB budgets/SHA-256, silhouette IoU <= 0.60,
 * gadget tri counts <= 800, banned pack absence, and GlazeMaterial shader parity uniforms.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ASSETS = resolve(ROOT, 'public/assets');
const BANNED_RE = /\b(kenney|quaternius|poly\.pizza|mixamo|sketchfab)\b/i;
const FIGHTERS = ['earl', 'grog', 'nesta', 'moss'];
const REQUIRED_UNIFORMS = ['uMatcap', 'uPalette', 'uCrack', 'uGilt', 'uFlash', 'uMatte', 'uSpeckle'];

const errors = [];
const fail = (msg) => errors.push(msg);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// 1. Check manifest & every public/assets file
const manifestPath = resolve(ASSETS, 'assets.manifest.json');
if (!existsSync(manifestPath)) fail('Missing public/assets/assets.manifest.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
if (BANNED_RE.test(manifestRaw)) fail('Banned asset pack string in assets.manifest.json');
const manifest = JSON.parse(manifestRaw);
const byFile = new Map(manifest.assets.map((a) => [a.file, a]));

for (const fname of readdirSync(ASSETS)) {
  if (fname === 'assets.manifest.json') continue;
  const full = resolve(ASSETS, fname);
  const buf = readFileSync(full);
  if (BANNED_RE.test(fname)) fail(`Banned pack name in filename: ${fname}`);
  if (fname.endsWith('.json') && BANNED_RE.test(buf.toString('utf8'))) fail(`Banned pack string in ${fname}`);
  const entry = byFile.get(fname);
  if (!entry) {
    fail(`Unlisted file in public/assets/: ${fname}`);
    continue;
  }
  if (entry.bytes !== buf.length) fail(`${fname}: bytes mismatch (${buf.length} vs manifest ${entry.bytes})`);
  const digest = sha256(buf);
  if (entry.sha256 !== digest) fail(`${fname}: sha256 mismatch (${digest} vs manifest ${entry.sha256})`);
}

// 2. Verify matcap_packed.png is 256x256 PNG
const matcapPath = resolve(ASSETS, 'matcap_packed.png');
if (!existsSync(matcapPath)) {
  fail('Missing matcap_packed.png');
} else {
  const png = readFileSync(matcapPath);
  const sig = png.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') fail('matcap_packed.png is not a valid PNG');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (w !== 256 || h !== 256) fail(`matcap_packed.png must be 256x256, got ${w}x${h}`);
}

// 3. Verify fighter GLB + JSON budgets
const fighterStats = {};
for (const name of FIGHTERS) {
  const glbEntry = byFile.get(`${name}.opt.glb`);
  const jsonPath = resolve(ASSETS, `${name}.json`);
  if (!glbEntry || !existsSync(resolve(ASSETS, `${name}.opt.glb`)) || !existsSync(jsonPath)) {
    fail(`Missing fighter files for ${name}`);
    continue;
  }
  const meta = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const parts = meta.bones.length;
  if (meta.triangles > 6500) fail(`${name}: triangles ${meta.triangles} > 6500`);
  if (parts < 3 || parts > 12) fail(`${name}: parts ${parts} outside [3..12]`);
  if (glbEntry.bytes > 150000) fail(`${name}.opt.glb: bytes ${glbEntry.bytes} > 150000`);
  fighterStats[name] = { triangles: meta.triangles, parts, bytes: glbEntry.bytes };
}

// 4. Verify silhouette IoU <= 0.60
const iouData = JSON.parse(readFileSync(resolve(ASSETS, 'silhouette_iou.json'), 'utf8'));
for (const [pair, val] of Object.entries(iouData.after)) {
  if (val > 0.6) fail(`silhouette_iou ${pair} = ${val} > 0.60`);
}

// 5. Verify gadget tri counts <= 800
const triCounts = JSON.parse(readFileSync(resolve(ASSETS, 'tri_counts.json'), 'utf8'));
for (const [key, val] of Object.entries(triCounts)) {
  if (key.startsWith('gadget_') && val.tris > 800) {
    fail(`${key}: tris ${val.tris} > 800`);
  }
}

// 6. Verify GlazeMaterial shader parity uniforms
const glazeSrc = readFileSync(resolve(ROOT, 'src/client/glaze-material.ts'), 'utf8');
for (const u of REQUIRED_UNIFORMS) {
  if (!glazeSrc.includes(u)) fail(`glaze-material.ts missing required uniform ${u}`);
}

if (errors.length > 0) {
  console.error('FAIL:', JSON.stringify({ errors }, null, 2));
  process.exit(1);
}

console.log(
  'PASS',
  JSON.stringify({
    matcap: '256x256',
    fighters: fighterStats,
    maxIoU: Math.max(...Object.values(iouData.after)),
    gadgetsChecked: Object.keys(triCounts).filter((k) => k.startsWith('gadget_')).length,
    uniformsVerified: REQUIRED_UNIFORMS.length,
  }),
);
