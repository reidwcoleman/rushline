// UI smoke test: node tools/uitest.mjs  (dev server must be running on :5330)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=7&play=1&demo=3', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(() => { __hold(true); __view.fixedHour = 11; __cam(0, 0, 26, 0.7, 0.9); __pump(10); });
const at = async (tx, ty) => page.evaluate(([x, y]) => __screen(x, y), [tx, ty]);
// bus tool: click three road tiles
const roads = await page.evaluate(() => { const w = __game.world; const out = []; for (let i = 0; i < 4096; i++) if (w.road[i] && w.stopKind[i] === 0 && w.bld[i] < 0) out.push(i); return out; });
const pick = (n) => roads[Math.floor((roads.length * n) % roads.length)];
await page.keyboard.press('Digit4');
const pts = [];
for (const i of [820, 830, 835]) {
  // choose connected road tiles along the main street
  pts.push(i);
}
const tiles = await page.evaluate(() => { const w = __game.world; const r = []; for (let x = 12; x <= 28; x += 4) { const t = 20 * 40 + x; if (w.road[t]) r.push(t); } return r; });
console.log('bus tiles', tiles);
for (const t of tiles) {
  const [x, y] = await at(t % 64, Math.floor(t / 64));
  await page.mouse.move(x, y); await page.waitForTimeout(40); await page.mouse.click(x, y);
}
await page.evaluate(() => __pump(3));
await page.screenshot({ path: 'shots/ui2.png' });
await page.keyboard.press('Enter');
await page.evaluate(() => __pump(40));
console.log('lines', await page.evaluate(() => __game.transit.lines.length));
await page.screenshot({ path: 'shots/ui3.png' });
// inspect a building
await page.keyboard.press('Digit1');
const bld = await page.evaluate(() => { const b = [...__game.city.buildings.values()].find((b) => b.kind === 'com' && b.level === 3) || [...__game.city.buildings.values()][5]; return [b.x, b.y]; });
const [bx, by] = await at(bld[0], bld[1]);
await page.mouse.click(bx, by);
await page.evaluate(() => __pump(5));
await page.screenshot({ path: 'shots/ui4.png' });
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
