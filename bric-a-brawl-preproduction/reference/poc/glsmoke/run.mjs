import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage']});
for(const w of [960,640,480,320]){ const p=await b.newPage(); await p.goto('http://127.0.0.1:8765/glsmoke/index.html?w='+w); await p.waitForFunction('window.__result',{timeout:120000}); console.log(JSON.stringify(await p.evaluate('window.__result'))); await p.close(); }
await b.close();
