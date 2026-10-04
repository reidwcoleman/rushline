// Highways, interchanges, signals and roundabouts through the real UI: keys, chips, drags and clicks.
// node tools/roadui.mjs   (dev server on :5330)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=3&play=1&demo=3', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
await page.evaluate(() => { __hold(true); __view.fixedHour = 11; __game.unlocked.highway = true; __game.unlocked.junction = true; __game.money = 200000; __pump(30); __app.hud.refreshTools(); });

// toolbar: one Roads button, a Junctions button, chips for the road types
const nTools = await page.$$eval('.toolbar .tool', (els) => els.length);
ok('toolbar has roads and junction buttons', nTools >= 11, String(nTools));
await page.keyboard.press('9'); await page.waitForTimeout(150);
ok('key 9 picks the highway tool', await page.evaluate(() => __app.tools.tool) === 'highway');
const chips = await page.$$('.context .mode-row .mchip');
ok('road type chips shown (street, avenue, highway)', chips.length === 3, String(chips.length));
ok('highway chip is on', await page.evaluate(() => document.querySelector('.context .mchip.on span')?.textContent) === 'Highway');
await page.keyboard.press('2'); await page.waitForTimeout(100);
ok('key 2 switches to street', await page.evaluate(() => __app.tools.tool) === 'road');
await (await page.$$('.context .mode-row .mchip'))[2].click(); await page.waitForTimeout(100);
ok('clicking the highway chip switches tool', await page.evaluate(() => __app.tools.tool) === 'highway');

// find a free row stretch and drag a highway across it
const run = await page.evaluate(() => {
  const w = __game.world; let best = null;
  for (let y = 6; y < 34; y++) {
    let start = -1;
    for (let x = 4; x <= 36; x++) {
      const t = y * 40 + x;
      const free = w.isUnlocked(t) && w.bld[t] < 0 && !w.park[t] && w.stop[t] < 0 && !w.water[t] && !w.rail[t];
      if (free) { if (start < 0) start = x; } else { if (start >= 0 && x - start >= 14 && (!best || x - start > best.len)) best = { y, x0: start, len: x - start }; start = -1; }
    }
    if (start >= 0 && 37 - start >= 14 && (!best || 37 - start > best.len)) best = { y, x0: start, len: 37 - start };
  }
  return best;
});
ok('found open ground for a highway', !!run, JSON.stringify(run));
const a = run.y * 40 + run.x0, b = run.y * 40 + run.x0 + Math.min(18, run.len - 1);
await page.evaluate(([a, b]) => { __cam(((a % 40) + (b % 40)) / 2 - 20 + 0.5, Math.floor(a / 40) - 20 + 0.5, 30, 0.7, 0.9); __pump(5); }, [a, b]);
const pa = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), a);
const pb = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), b);
const before = await page.evaluate(() => ({ money: __game.money, hw: __game.world.road.filter((r) => r === 3).length }));
await page.mouse.move(pa[0], pa[1]); await page.mouse.down();
await page.mouse.move((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, { steps: 6 }); await page.mouse.move(pb[0], pb[1], { steps: 6 });
await page.waitForTimeout(200);
const quote = await page.evaluate(() => __app.tools.quote);
ok('drag shows a quote', !!quote && quote.cost > 0, JSON.stringify(quote));
await page.screenshot({ path: 'shots/roadui_drag.png' });
await page.mouse.up(); await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ money: __game.money, hw: __game.world.road.filter((r) => r === 3).length, over: __game.world.under.filter((u) => u).length, ramp: __game.world.ramp.filter((u) => u).length }));
ok('highway built', after.hw - before.hw >= 10, JSON.stringify({ before, after }));
ok('it cost money', after.money < before.money);

// junction tool: roundabout on a busy junction, signals on another, interchange on the highway
await page.keyboard.press('0'); await page.waitForTimeout(150);
ok('key 0 picks the junction tool', await page.evaluate(() => __app.tools.tool) === 'junction');
ok('junction chips shown', (await page.$$('.context .mode-row .mchip')).length === 4);
const jn = await page.evaluate(() => { const w = __game.world; return [...Array(1600).keys()].filter((i) => w.surf(i) && w.degree(i) >= 3).sort((x, y) => Math.hypot((x % 40) - 20, ((x / 40) | 0) - 20) - Math.hypot((y % 40) - 20, ((y / 40) | 0) - 20)); });
const clickTile = async (t, dist = 14) => {
  await page.evaluate(([t, dist]) => { __cam((t % 40) - 20 + 0.5, Math.floor(t / 40) - 20 + 0.5, dist, 0.7, 0.9); __pump(3); }, [t, dist]);
  const p = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), t);
  await page.mouse.move(p[0], p[1]); await page.waitForTimeout(80); await page.mouse.click(p[0], p[1]); await page.waitForTimeout(150);
};
// default junction mode is the roundabout
await clickTile(jn[2]);
ok('roundabout placed', await page.evaluate((t) => __game.world.ctl[t], jn[2]) === 2);
await (await page.$$('.context .mode-row .mchip'))[1].click(); await page.waitForTimeout(100);
ok('signals chip selected', await page.evaluate(() => __app.tools.jmode) === 'signals');
await clickTile(jn[6]);
ok('signals placed', await page.evaluate((t) => __game.world.ctl[t], jn[6]) === 1);
await (await page.$$('.context .mode-row .mchip'))[2].click(); await page.waitForTimeout(100);
const hwTile = await page.evaluate(() => { const w = __game.world; return [...Array(1600).keys()].find((i) => w.road[i] === 3 && !w.ramp[i] && __game.nextToSurface(i) && !w.under[i]) ?? [...Array(1600).keys()].find((i) => w.under[i]); });
if (hwTile !== undefined) { await clickTile(hwTile); ok('interchange placed', await page.evaluate((t) => __game.world.ramp[t], hwTile) === 1); }
// refuse on a street
await page.evaluate(() => __app.tools.setJMode('roundabout'));
const toastsBefore = await page.$$eval('.toast', (e) => e.length);
const street = await page.evaluate(() => { const w = __game.world; return [...Array(1600).keys()].find((i) => w.road[i] === 1 && w.degree(i) === 2); });
await clickTile(street);
ok('roundabout refused on a plain street', await page.evaluate((t) => __game.world.ctl[t], street) === 0);

// inspect a roundabout: panel with controls
await page.keyboard.press('1'); await page.waitForTimeout(100);
await clickTile(jn[2], 10);
const title = await page.evaluate(() => document.querySelector('.side h3')?.textContent);
ok('inspect shows Roundabout panel', title === 'Roundabout', String(title));
const btns = await page.$$eval('.side .actions .btn', (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent));
ok('panel offers signals and plain', btns.some((t) => t.startsWith('Signals')) && btns.some((t) => t.startsWith('Plain')), btns.join('|'));
await page.evaluate(() => { __app.tools.setSelection(null); });

// run the sim and look
await page.evaluate(() => { __cam(0, 0, 26, 0.7, 0.9); __pump(900); });
const sim = await page.evaluate(() => ({ cars: __game.traffic.vehicles.length, grid: __game.traffic.gridlock, over: __game.over }));
ok('traffic runs after the build', sim.cars > 0 && !sim.over, JSON.stringify(sim));
await page.screenshot({ path: 'shots/roadui_final.png' });
console.log('console issues:', logs.length ? logs.join('\n') : 'none');
await browser.close();
