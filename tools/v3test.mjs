// End-to-end of the v3 features with real pointer and keyboard input.
// node tools/v3test.mjs   (dev server on :5330)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=3&play=1&demo=3', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
await page.evaluate(() => { __hold(true); __view.fixedHour = 11; __game.bestPop = Math.max(__game.bestPop, 1000); __game.updateUnlocksForTest?.(); __game.money = 100000; __game.unlocked.truck = true; __game.unlocked.school = true; __game.unlocked.airport = true; __pump(120); });

// 1. click a citizen on the map
const target = await page.evaluate(() => {
  __cam(0, 0, 14, 0.7, 0.9); __pump(30);
  const dots = [...__view.citizens.dots].filter((x) => x.kind !== 'wait').sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const d = dots[0];
  if (!d) return null;
  const v = new (__view.rig.camera.position.constructor)(d.x, 0.05, d.z);
  const p = __view.rig.toScreen(v);
  return { x: p.x, y: p.y, id: d.p.id };
});
if (target) {
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(150);
  const sel = await page.evaluate(() => __app.tools.selection);
  ok('click selects a citizen', sel?.type === 'person', JSON.stringify(sel));
  ok('citizen panel shown', !!(await page.$('.side.citizen')));
  await page.click('.side.citizen .actions .btn.primary');
  await page.waitForTimeout(100);
  ok('follow on', await page.evaluate(() => __view.follow === true));
  await page.evaluate(() => __pump(40));
  await page.keyboard.press('Escape');
}
// 2. directory and company panels by key
await page.evaluate(() => { __app.tools.setSelection(null); __app.stopFollow(); });
await page.keyboard.press('c'); await page.waitForTimeout(100);
ok('directory opens (C)', !!(await page.$('.side .tabs')) && (await page.textContent('.side h3')) === 'Citizens');
await page.keyboard.press('b'); await page.waitForTimeout(100);
ok('company opens (B)', (await page.textContent('.side h3')) === 'Company');
const tabs = await page.$$('.side .tabs .tab');
await tabs[4].click(); await page.waitForTimeout(100);
const accept = await page.$('.job .btn.primary');
if (accept) { await accept.click(); await page.waitForTimeout(100); ok('contract accepted', await page.evaluate(() => __game.contracts.some((c) => c.state === 'active'))); } else ok('contract offers exist', false);
await (await page.$$('.side .tabs .tab'))[3].click(); await page.waitForTimeout(100);
const rs = await page.$('.rcard .btn.primary');
if (rs) { await rs.click(); ok('research started', await page.evaluate(() => !!__game.project)); }
await page.evaluate(() => __app.panels.close());

// 3. freight line with real clicks
const spots = await page.evaluate(() => {
  const g = __game;
  const farm = g.city.cargoSites().find((b) => b.special === 'farm');
  const term = g.city.cargoSites().find((b) => b.special === 'terminal');
  const near = (b) => { let best = -1, bd = 99; for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) { const t = y * 40 + x; if (x < 0 || y < 0 || x > 39 || y > 39) continue; if (g.spotCheck('truck', t)) continue; if (g.roadDegree(t) >= 3) continue; const d = Math.hypot(x - b.x, y - b.y); if (d < bd) { bd = d; best = t; } } return best; };
  return [near(farm), near(term)];
});
await page.keyboard.press('4'); await page.waitForTimeout(100);
const grp = await page.$$('.grpseg .tab');
await grp[1].click(); await page.waitForTimeout(100);
const chips = await page.$$('.mode-row .mchip');
ok('freight chips shown', chips.length === 2, String(chips.length));
const pts = [];
for (const t of spots) pts.push(await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), t));
// each click needs the camera to see the tile; frame both
await page.evaluate((t) => { const [a, b] = t; __cam(((a % 40) + (b % 40)) / 2 - 20 + 0.5, (Math.floor(a / 40) + Math.floor(b / 40)) / 2 - 20 + 0.5, 22, 0.7, 0.9); __pump(5); }, spots);
const pts2 = [];
for (const t of spots) pts2.push(await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), t));
for (const p of pts2) { await page.mouse.click(p[0], p[1]); await page.waitForTimeout(120); }
await page.keyboard.press('Enter'); await page.waitForTimeout(150);
const made = await page.evaluate(() => __game.transit.lines.filter((l) => l.kind === 'truck').length);
ok('truck line built with clicks', made >= 1, String(made));
await page.evaluate(() => { __game.transit.lines.filter((l) => l.kind === 'truck').forEach((l) => { __game.addVehicle(l); }); __pump(900); });
const hauled = await page.evaluate(() => __game.transit.lines.filter((l) => l.kind === 'truck').reduce((a, l) => a + l.hauled, 0));
ok('trucks hauled cargo', hauled > 0, hauled.toFixed(0));

// 4. school via the service tool
await page.evaluate(() => __app.tools.select('inspect'));
await page.keyboard.press('8'); await page.waitForTimeout(100);
const empties = await page.evaluate(() => { const g = __game, w = g.world; for (let i = 0; i < 1600; i++) { if (w.isUnlocked(i) && !w.water[i] && w.isEmpty(i) && !w.rail[i] && g.city.roadFor({ x: i % 40, y: Math.floor(i / 40) }).tile >= 0) return i; } return -1; });
await page.evaluate((t) => { __cam((t % 40) - 20 + 0.5, Math.floor(t / 40) - 20 + 0.5, 16, 0.7, 0.9); __pump(4); }, empties);
const sp = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), empties);
await page.mouse.click(sp[0], sp[1]); await page.waitForTimeout(150);
ok('school built', await page.evaluate(() => [...__game.city.buildings.values()].some((b) => b.special === 'school')));
await page.evaluate(() => { __pump(600); });
const pupils = await page.evaluate(() => __game.city.stats.pupils);
ok('pupils enrolled', pupils > 0, String(pupils));
await page.screenshot({ path: 'shots/v3test.png' });
console.log(logs.length ? [...new Set(logs)].slice(0, 8).join('\n') : 'no console errors');
await browser.close();
