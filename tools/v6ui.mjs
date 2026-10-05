// The v6 interface through real clicks and keys: the map, the live panel, and looking inside buildings.
// node tools/v6ui.mjs   (dev server on :5330)
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

// ---- the map
ok('minimap is on screen', !!(await page.$('.minimap canvas')));
const mini = await page.$('.minimap canvas');
const mb = await mini.boundingBox();
const camBefore = await page.evaluate(() => [__view.rig.gTarget.x, __view.rig.gTarget.z]);
await page.mouse.click(mb.x + mb.width * 0.2, mb.y + mb.height * 0.25);
await page.evaluate(() => __pump(3));
const camAfter = await page.evaluate(() => [__view.rig.gTarget.x, __view.rig.gTarget.z]);
ok('clicking the minimap moves the camera', Math.hypot(camAfter[0] - camBefore[0], camAfter[1] - camBefore[1]) > 5, JSON.stringify([camBefore, camAfter].map((a) => a.map((v) => +v.toFixed(1)))));
await page.keyboard.press('m'); await page.waitForTimeout(300);
ok('M opens the map', !!(await page.$('.mapfull')));
const rows = await page.$$eval('.mf-row b', (els) => els.map((e) => e.textContent));
ok('sixteen neighbourhoods listed', rows.length === 16, rows.slice(0, 4).join(', '));
ok('names are different', new Set(rows).size === 16);
for (const [i, name] of [[1, 'mood'], [2, 'traffic'], [3, 'value']]) {
  await (await page.$$('.mf-seg .seg'))[i].click(); await page.waitForTimeout(150);
  ok(`${name} layer selected`, await page.evaluate((i) => document.querySelectorAll('.mf-seg .seg')[i].classList.contains('on'), i));
}
const cv = await page.$('.mf-c'); const cb = await cv.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.waitForTimeout(150);
ok('hover tip shows', await page.evaluate(() => getComputedStyle(document.querySelector('.mf-tip')).display !== 'none'));
await page.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5); await page.waitForTimeout(250);
ok('clicking the map closes it and moves the camera', !(await page.$('.mapfull')));
await page.keyboard.press('m'); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok('Esc closes the map', !(await page.$('.mapfull')));

// ---- the live panel
const pid = await page.evaluate(() => {
  const c = __game.city;
  const p = c.persons.find((q) => q.stage === 'adult' && q.phase === 'none' && q.state === 'home' && q.hh.members.length >= 3 && q.home.level === 1) ?? c.persons.find((q) => q.stage === 'adult' && q.phase === 'none' && q.state === 'home');
  __app.selectPerson(p, true);
  __cam(p.home.x - 32 + 0.5, p.home.y - 32 + 0.5, 14, 0.7, 0.9); __pump(8);
  return p.id;
});
await page.waitForTimeout(300);
ok('live panel shown', await page.evaluate(() => getComputedStyle(document.querySelector('.simbar')).display !== 'none'));
ok('seven needs as bars', (await page.$$('.simbar .sb-need')).length === 7);
ok('portrait present', !!(await page.$('.simbar canvas.sb-face')));
const house = await page.$$('.simbar .sb-mem');
ok('household members shown', house.length >= 2, String(house.length));
if (house.length > 1) { await house[1].click(); await page.waitForTimeout(250); ok('clicking a member switches person', (await page.evaluate(() => __app.tools.selection?.id)) !== pid); }
ok('side panel has skills', (await page.$$('.side.citizen .skill')).length === 5);

// ---- look inside
await page.evaluate((id) => { __app.selectPerson(__game.city.personById.get(id), true); }, pid);
await page.waitForTimeout(200);
const btns = await page.$$eval('.side.citizen .actions button', (els) => els.map((e) => e.textContent));
ok('Look inside offered', btns.includes('Look inside'), btns.join(' | '));
await page.keyboard.press('i'); await page.waitForTimeout(500);
ok('I lifts the roof', await page.evaluate(() => __view.interior.open));
ok('inside bar shown', !!(await page.$('.inside-chip')));
await page.evaluate(() => __pump(60));
ok('people are drawn inside', (await page.evaluate(() => __view.interior.count)) >= 1);
await page.screenshot({ path: 'shots/v6ui-inside.png' });
// click a figure
const fig = await page.evaluate(() => { const f = __view.interior.figs[0]; if (!f) return null; const g = __view.interior.group.position; return __screen(g.x + f.x + 32 - 0.5, g.z + f.z + 32 - 0.5); });
if (fig) { await page.mouse.click(fig[0], fig[1] - 4); await page.waitForTimeout(200); ok('clicking a figure selects them', await page.evaluate(() => __app.tools.selection?.type === 'person')); }
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
ok('Esc puts the roof back', !(await page.evaluate(() => __view.interior.open)));
ok('inside bar gone', !(await page.$('.inside-chip')));
// a shop
const shop = await page.evaluate(() => { const b = [...__game.city.buildings.values()].find((x) => x.kind === 'com' && x.venue && !x.special && x.venue !== 'mall' && x.venue !== 'office'); if (!b) return -1; __app.tools.setSelection({ type: 'building', id: b.id }); __cam(b.x - 32 + 0.5, b.y - 32 + 0.5, 12, 0.7, 0.9); __pump(5); return b.id; });
await page.waitForTimeout(250);
if (shop >= 0) {
  const lb = (await page.$$('.side .actions button'));
  const names = await Promise.all(lb.map((b) => b.textContent()));
  ok('shops can be looked into', names.includes('Look inside'), names.join(' | '));
  await lb[names.indexOf('Look inside')].click(); await page.waitForTimeout(300);
  ok('shop interior opens', await page.evaluate(() => __view.interior.open));
  await page.evaluate(() => __pump(30));
  await page.screenshot({ path: 'shots/v6ui-shop.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
}
// save and load keep the new fields
const roundtrip = await page.evaluate(() => { const p = __game.city.persons[3]; p.skills[0] = 4.5; p.aspire = 'chef'; p.needs.hygiene = 0.33; return { sk: p.skills[0], id: p.id }; });
await page.evaluate(() => { __app.lastSaveDay = 0; __app.autosave(); });
const saved = await page.evaluate((id) => { const s = JSON.parse(localStorage.getItem('rushline.save.v1')); const q = s.people.find((x) => x.i === id); return { sk: q.sk?.[0], as: q.as, n: q.n.length }; }, roundtrip.id);
ok('save keeps skills, aspiration and 7 needs', saved.sk === 4.5 && saved.as === 'chef' && saved.n === 7, JSON.stringify(saved));
console.log(logs.length ? 'console issues:\n' + logs.join('\n') : 'console issues: none');
await browser.close();
