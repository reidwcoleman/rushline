// The Sims layer through the real UI: directing a citizen, send-somewhere, parties, wishes, and the Lots tool.
// node tools/simsui.mjs   (dev server on :5330)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto('http://localhost:5330/?seed=3&play=1&demo=5', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
await page.evaluate(() => { __hold(true); __view.fixedHour = 12; __game.money = 300000; __pump(60); });

// pick an adult who is home with friends
const pid = await page.evaluate(() => {
  const c = __game.city;
  const p = c.persons.find((q) => q.stage === 'adult' && q.phase === 'none' && q.state === 'home' && q.friends.length >= 2 && q.home.access >= 0) ?? c.persons.find((q) => q.stage === 'adult' && q.phase === 'none' && q.state === 'home');
  __app.selectPerson(p, true);
  __cam(p.home.x - 20 + 0.5, p.home.y - 20 + 0.5, 12, 0.7, 0.9); __pump(5);
  return p.id;
});
await page.waitForTimeout(200);
ok('citizen panel open', !!(await page.$('.side.citizen')));
const labels = await page.$$eval('.side.citizen .chips.acts .chip', (els) => els.map((e) => e.textContent));
ok('action chips shown', labels.length >= 5, labels.join(' | '));
ok('send somewhere chip', labels.some((l) => l.includes('Send somewhere')));
ok('mood chips shown', (await page.$$('.side.citizen .moodlets .chip')).length >= 1);
ok('free will line shown', !!(await page.$('.side.citizen .orders .free')));

// 1. a quick action
const eat = await page.$$('.side.citizen .chips.acts .chip');
for (const b of eat) { if ((await b.textContent()) === 'Eat out') { await b.click(); break; } }
await page.waitForTimeout(150);
const oc = await page.evaluate((id) => __game.city.personById.get(id).orders.length, pid);
ok('Eat out creates an order', oc === 1, String(oc));
ok('order shown in the panel', !!(await page.$('.side.citizen .orders .ord')));
await page.evaluate(() => __pump(1500, 1 / 30));
const st = await page.evaluate((id) => { const p = __game.city.personById.get(id); return { orders: p.orders.length, state: p.state, hunger: p.needs.hunger }; }, pid);
ok('they went, ate, and the order cleared', st.orders === 0, JSON.stringify(st));

// 2. send somewhere with a real click on a building
const target = await page.evaluate((id) => {
  const c = __game.city, p = c.personById.get(id);
  let best = null;
  for (const b of c.buildings.values()) if (b.kind === 'com' && !b.special && b.access >= 0 && b !== p.work) { const d = Math.hypot(b.x - p.home.x, b.y - p.home.y); if (d > 3 && (!best || d < best.d)) best = { b, d }; }
  __cam(p.home.x - 20 + 0.5, p.home.y - 20 + 0.5, 20, 0.7, 0.9); __pump(3);
  return best ? { tile: best.b.tile, name: best.b.name } : null;
}, pid);
await page.evaluate(() => { __app.tools.select('inspect'); });
await page.evaluate((id) => { __app.selectPerson(__game.city.personById.get(id), true); }, pid);
await page.waitForTimeout(150);
const sendBtn = (await page.$$('.side.citizen .chips.acts .chip.send'))[0];
await sendBtn.click(); await page.waitForTimeout(100);
ok('send mode on', await page.evaluate(() => __app.tools.sendFor !== null));
const sp = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), target.tile);
await page.mouse.move(sp[0], sp[1]); await page.waitForTimeout(80);
await page.mouse.click(sp[0], sp[1]); await page.waitForTimeout(200);
const o2 = await page.evaluate((id) => { const p = __game.city.personById.get(id); return { n: p.orders.length, label: p.orders[0]?.label, sendFor: __app.tools.sendFor }; }, pid);
ok('click on a building sends them', o2.n === 1 && o2.sendFor === null, JSON.stringify(o2));
await page.evaluate(() => __pump(900, 1 / 30));
ok('they arrived there', await page.evaluate(([id, name]) => { const p = __game.city.personById.get(id); return p.at?.name === name || p.orders.length === 0; }, [pid, target.name]));

// 3. a party
await page.evaluate((id) => { const p = __game.city.personById.get(id); __game.city.social.cancel(p); __app.selectPerson(p, true); __pump(5); }, pid);
await page.waitForTimeout(150);
const partyChip = (await page.$$('.side.citizen .chips.acts .chip')).find(async () => true);
const chips2 = await page.$$('.side.citizen .chips.acts .chip');
for (const b of chips2) { if ((await b.textContent()) === 'Throw a party') { await b.click(); break; } }
await page.waitForTimeout(150);
const pa = await page.evaluate((id) => { const c = __game.city; const p = c.personById.get(id); return { active: c.social.active.size, host: p.orders[0]?.kind }; }, pid);
ok('party started', pa.active >= 1 && pa.host === 'host', JSON.stringify(pa));
await page.evaluate((id) => { const p = __game.city.personById.get(id); __cam(p.home.x - 20 + 0.5, p.home.y - 20 + 0.5, 9, 0.7, 0.8); __pump(400, 1 / 30); }, pid);
await page.screenshot({ path: 'shots/simsui_party.png' });
await page.evaluate((id) => { __app.selectPerson(__game.city.personById.get(id), true); __pump(3); }, pid);
await page.waitForTimeout(200);
await page.screenshot({ path: 'shots/simsui_panel.png' });

// 4. Lots tool
await page.evaluate(() => { __app.tools.select('inspect'); __app.tools.setSelection(null); });
await page.keyboard.press('v'); await page.waitForTimeout(150);
ok('V opens the Lots tool', await page.evaluate(() => __app.tools.tool) === 'lots');
const lc = await page.$$('.context .mode-row .mchip');
ok('lot chips shown', lc.length === 10, String(lc.length));
await lc[3].click(); await page.waitForTimeout(80); // cafe
ok('cafe chosen', await page.evaluate(() => __app.tools.lot) === 'cafe');
const spot = await page.evaluate(() => {
  const g = __game, w = g.world;
  const cands = [...Array(1600).keys()].filter((i) => g.lotCheck('cafe', i) === null).sort((a, b) => Math.hypot((a % 40) - 20, ((a / 40) | 0) - 20) - Math.hypot((b % 40) - 20, ((b / 40) | 0) - 20));
  const t = cands[0];
  __cam((t % 40) - 20 + 0.5, Math.floor(t / 40) - 20 + 0.5, 12, 0.7, 0.9); __pump(3);
  return { t, n: g.city.buildings.size, money: g.money };
});
const lp = await page.evaluate((t) => __screen(t % 40, Math.floor(t / 40)), spot.t);
await page.mouse.move(lp[0], lp[1]); await page.waitForTimeout(80);
await page.mouse.click(lp[0], lp[1]); await page.waitForTimeout(200);
const after = await page.evaluate(() => ({ n: __game.city.buildings.size, money: __game.money }));
ok('cafe built', after.n === spot.n + 1 && after.money < spot.money, JSON.stringify({ spot, after }));
await page.evaluate(() => __app.tools.select('inspect'));
// rename it
await page.evaluate((t) => __app.tools.setSelection({ type: 'building', id: __game.world.bld[t] }), spot.t);
await page.waitForTimeout(200);
const inp = await page.$('.side input.rename');
ok('building has a rename field', !!inp);
if (inp) { await inp.fill('Reid\'s Corner Cafe'); await inp.press('Enter'); await page.waitForTimeout(100); ok('renamed', await page.evaluate((t) => __game.city.buildings.get(__game.world.bld[t]).name, spot.t) === "Reid's Corner Cafe"); }

await page.evaluate(() => { __cam(0, 0, 26, 0.7, 0.9); __pump(900, 1 / 30); });
ok('sim still healthy', await page.evaluate(() => !__game.over));
console.log('console issues:', logs.length ? logs.join('\n') : 'none');
await browser.close();
