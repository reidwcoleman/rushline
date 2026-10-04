// Real-loop fps: node tools/fps.mjs [--url "/?demo=12&play=1"] [--secs 5] [--w 1600 --h 900]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +opt('w', 1600), height: +opt('h', 900) }, deviceScaleFactor: +opt('dpr', 2) });
page.setDefaultTimeout(300000);
const logs = [];
page.on('console', (m) => { if (['error'].includes(m.type())) logs.push(m.text().slice(0, 200)); });
await page.goto(`http://localhost:5330${opt('url', '/?demo=12&play=1')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
for (const q of opt('quality', 'medium,high,ultra').split(',')) {
  const r = await page.evaluate(async ([q, secs]) => {
    const R = window.__view.renderer;
    R.adaptive = false; R.setQuality(q);
    window.__cam(0, 0, +(window.__camDist || 34), 0.7, 0.9);
    await new Promise((res) => setTimeout(res, 1200));
    let n = 0; const t0 = performance.now();
    const dts = []; let last = t0;
    await new Promise((res) => { const f = (t) => { n++; dts.push(t - last); last = t; if (t - t0 < secs * 1000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    dts.sort((a, b) => a - b);
    const g = window.__game;
    return { q, px: `${R.gl.domElement.width}x${R.gl.domElement.height}`, fps: +(n / secs).toFixed(1), p50: +dts[Math.floor(dts.length * 0.5)].toFixed(1), p90: +dts[Math.floor(dts.length * 0.9)].toFixed(1), pop: g.city.stats.pop, cars: g.traffic.vehicles.length, calls: R.gl.info.render.calls, tris: R.gl.info.render.triangles };
  }, [q, +opt('secs', 4)]);
  console.log(JSON.stringify(r));
}
for (const l of logs.slice(0, 5)) console.log(l);
await browser.close();
