// Regenerate the PNGs in ../png from the HTML pages in this folder.
// Needs: `npm i puppeteer-core` and a system Chrome/Chromium (set CHROME=/path/to/chrome if not /usr/bin/google-chrome).
// Usage: node shoot.mjs            (all pages)   |   node shoot.mjs ui_hud   (pages whose name contains the argument)
// shoot.mjs - screenshots every mock-up page to ../png with headless Chrome. One browser, one page at a time.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, '..', 'png'); fs.mkdirSync(out, { recursive: true });
const want = process.argv.slice(2);
const pages = ['pages_ui.json', 'pages_sheets.json'].filter(f => fs.existsSync(path.join(here, f))).flatMap(f => JSON.parse(fs.readFileSync(path.join(here, f))));
const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files', '--disable-dev-shm-usage'] });
for (const p of pages) {
  if (want.length && !want.some(w => p.name.includes(w))) continue;
  const pg = await b.newPage(); await pg.setViewport({ width: p.w, height: p.h, deviceScaleFactor: 1 });
  await pg.goto('file://' + path.join(here, p.name + '.html'), { waitUntil: 'networkidle0' });
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: path.join(out, p.name + '.png') }); await pg.close(); console.log('shot', p.name);
}
await b.close();
