import { chromium } from 'playwright-core';
const W = +(process.argv[2] ?? 1600), H = +(process.argv[3] ?? 900), tag = process.argv[4] ?? 'd';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: W < 800, isMobile: W < 800 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=7&play=1&demo=6', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(() => { __hold(true); __view.fixedHour = 11.5; __cam(0, 0, 30, 0.7, 0.9); __pump(15); });
const shot = async (n) => { await page.evaluate(() => __pump(6)); await page.waitForTimeout(450); await page.screenshot({ path: `shots/${tag}_${n}.png` }); };
await shot('base');
// policies
await page.keyboard.press('KeyP'); await shot('policies');
await page.keyboard.press('KeyL'); await shot('lines');
// stop panel via selection
await page.evaluate(() => { const s = __game.transit.stops[0]; __app.tools.setSelection({ type: 'stop', id: s.id }); __view.rig.focus(s.x, s.z, 20); __view.rig.snap(); });
await shot('stop');
await page.evaluate(() => { const l = __game.transit.lines[0]; __app.tools.setSelection({ type: 'line', id: l.id }); });
await shot('line');
await page.evaluate(() => { __app.tools.setSelection(null); __app.hud.setOverlay('traffic'); __cam(0, 0, 36, 0.7, 0.9); });
await shot('traffic');
await page.evaluate(() => { __app.hud.setOverlay('transit'); });
await shot('transit');
await page.evaluate(() => { __app.hud.setOverlay('none'); __app.openPause(); });
await shot('pause');
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
