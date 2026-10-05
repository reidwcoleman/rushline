// End-to-end: title -> play -> build a road -> bus line, using only real pointer/keyboard input.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=7', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'shots/pt_title.png' });
await page.click('text=Play');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shots/pt_play.png' });
const at = async (tx, ty) => page.evaluate(([x, y]) => __screen(x, y), [tx, ty]);
const info = await page.evaluate(() => { const w = __game.world; const roads = []; for (let i = 0; i < 4096; i++) if (w.road[i]) roads.push(i); return { roads: roads.length, pop: __game.city.stats.pop, money: __game.money }; });
console.log('start', info);
// find an east-west road row with an end, extend it
const ext = await page.evaluate(() => { const w = __game.world; for (let y = 14; y < 50; y++) for (let x = 14; x < 50; x++) { const i = y * 64 + x; if (w.road[i] && !w.road[i + 1] && w.road[i - 1] && w.isUnlocked(i + 5) && !w.water[i + 5] && !w.water[i + 1]) return [x, y]; } return null; });
console.log('extend from', ext);
await page.keyboard.press('Digit2');
const [sx, sy] = await at(ext[0] + 1, ext[1]);
const [ex, ey] = await at(ext[0] + 6, ext[1]);
await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 6 }); await page.mouse.move(ex, ey, { steps: 6 });
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/pt_roadpreview.png' });
await page.mouse.up();
await page.waitForTimeout(400);
console.log('roads after', await page.evaluate(() => { const w = __game.world; let n = 0; for (let i = 0; i < 4096; i++) if (w.road[i]) n++; return n; }), 'money', await page.evaluate(() => Math.round(__game.money)));
// bus line
await page.keyboard.press('Digit4');
const stops = await page.evaluate(() => { const w = __game.world; for (let y = 18; y < 46; y++) { const xs = []; for (let x = 10; x < 54; x++) if (w.road[y * 64 + x] && w.stopKind[y * 64 + x] === 0) xs.push(x); const run = []; for (const x of xs) { if (!run.length || x - run[run.length - 1] >= 3) run.push(x); } if (run.length >= 3) return run.slice(0, 3).map((x) => [x, y]); } return []; });
console.log('stops', stops);
for (const [tx, ty] of stops) { const [x, y] = await at(tx, ty); await page.mouse.move(x, y); await page.waitForTimeout(80); await page.mouse.click(x, y); await page.waitForTimeout(120); }
await page.screenshot({ path: 'shots/pt_busdraft.png' });
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
console.log('lines', await page.evaluate(() => __game.transit.lines.length));
await page.screenshot({ path: 'shots/pt_busline.png' });
// speed up and wait
await page.keyboard.press('Equal'); await page.keyboard.press('Equal');
await page.waitForTimeout(8000);
await page.screenshot({ path: 'shots/pt_later.png' });
console.log('end', await page.evaluate(() => ({ day: __game.day, pop: __game.city.stats.pop, stab: Math.round(__game.stability), fps: Math.round(__app.fps) })));
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
