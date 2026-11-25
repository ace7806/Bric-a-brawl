import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const runAll = process.argv.includes('--all');
const specs = runAll
  ? ['tests/browser/m1.spec.ts', 'tests/browser/m3.spec.ts', 'tests/browser/m4-m5.spec.ts']
  : ['tests/browser/m3.spec.ts', 'tests/browser/m4-m5.spec.ts'];

for (const spec of specs) {
  console.log(`[browser:run] Running ${spec}...`);
  execFileSync('npx', ['tsx', resolve(ROOT, spec)], { cwd: ROOT, stdio: 'inherit' });
}
