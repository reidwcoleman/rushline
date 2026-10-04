// Random commands against the live page (sim + renderer + UI panels) for N rounds; reports console errors.
import { chromium } from 'playwright-core';
const rounds = +(process.argv[2] ?? 150);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.stack.slice(0, 600)));
await page.goto('http://localhost:5330/?seed=9&play=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const res = await page.evaluate(async (rounds) => {
  __hold(true);
  const g = __game, w = g.world, app = __app;
  g.money = 5e6;
  for (const k of ['tram', 'ferry', 'gondola', 'metro']) g.unlocked[k] = true;
  const R = () => g.rand();
  const N = 40;
  const randTile = () => Math.floor(R() * N * N);
  const randRoad = () => { for (let k = 0; k < 200; k++) { const t = randTile(); if (w.road[t]) return t; } return -1; };
  const keys = ['toll', 'busLanes', 'stagger', 'remote', 'freeTransit'];
  let n = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 4; k++) {
      const x = R();
      n++;
      if (x < 0.25) { const t = randTile(); const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][(R() * 4) | 0]; const tiles = []; for (let i = 0; i < 2 + ((R() * 8) | 0); i++) { const tx = (t % N) + d[0] * i, ty = Math.floor(t / N) + d[1] * i; if (tx < 0 || ty < 0 || tx >= N || ty >= N) break; tiles.push(ty * N + tx); } g.buildRoad(tiles, R() < 0.15 ? 2 : 1); }
      else if (x < 0.32) g.bulldoze(randTile());
      else if (x < 0.38) { for (const d of w.districts) if (!d.unlocked) { g.unlockDistrict(d.index); break; } }
      else if (x < 0.5) { const a = randRoad(), b = randRoad(), c = randRoad(); if (a >= 0 && b >= 0 && c >= 0 && a !== b && b !== c) g.createBusLine([a, b, c]); }
      else if (x < 0.56) { const m = ['metro', 'tram', 'ferry', 'gondola'][(R() * 4) | 0]; const shore = () => { for (let k = 0; k < 300; k++) { const t = randTile(); if (w.shore[t]) return t; } return randTile(); }; const pick = () => (m === 'tram' ? randRoad() : m === 'ferry' ? shore() : randTile()); const a = pick(), b = pick(); if (a >= 0 && b >= 0) g.createLine(m, [a, b]); app.tools.setMode(['bus', 'tram', 'metro', 'ferry', 'gondola'][(R() * 5) | 0]); g.refreshAdvice(); }
      else if (x < 0.62) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.addVehicle(l); }
      else if (x < 0.65) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.deleteLine(l); }
      else if (x < 0.7) g.placePark(randTile());
      else if (x < 0.73) g.placeArena(randTile());
      else if (x < 0.76) g.setPolicy(keys[(R() * 5) | 0], R() < 0.5);
      else if (x < 0.8) { const s = g.transit.stops[(R() * g.transit.stops.length) | 0]; if (s) g.expandStop(s); }
      else if (x < 0.84) { const s = g.transit.stops[(R() * g.transit.stops.length) | 0]; if (s) g.bulldoze(s.tile); }
      else if (x < 0.9) { // UI selection churn
        const kinds = ['building', 'stop', 'road', 'line'];
        const kd = kinds[(R() * 4) | 0];
        if (kd === 'building') { const b = [...g.city.buildings.values()][(R() * g.city.buildings.size) | 0]; if (b) app.tools.setSelection({ type: 'building', id: b.id }); }
        else if (kd === 'stop') { const s = g.transit.stops[(R() * g.transit.stops.length) | 0]; if (s) app.tools.setSelection({ type: 'stop', id: s.id }); }
        else if (kd === 'road') { const t = randRoad(); if (t >= 0) app.tools.setSelection({ type: 'road', tile: t }); }
        else { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) app.tools.setSelection({ type: 'line', id: l.id }); }
      }
      else if (x < 0.94) { app.hud.setOverlay(['none', 'traffic', 'transit', 'happy'][(R() * 4) | 0], true); }
      else { app.panels.toggle(R() < 0.5 ? 'lines' : 'policies'); }
    }
    g.stability = 100;
    g.speed = 4; __pump(14, 0.1);
    __cam((R() - 0.5) * 20, (R() - 0.5) * 20, 14 + R() * 40, R() * 6, 0.5 + R() * 0.7);
  }
  return { ops: n, day: g.day, pop: g.city.stats.pop, bld: g.city.buildings.size, lines: g.transit.lines.length, veh: g.traffic.vehicles.length };
}, rounds);
console.log(JSON.stringify(res));
await page.evaluate(() => { __app.hud.setOverlay('none', true); __app.panels.close(); __view.fixedHour = 12; __cam(0, 0, 40, 0.7, 0.9); __pump(4); });
await page.screenshot({ path: 'shots/bfuzz.png' });
const uniq = [...new Set(logs)];
console.log(uniq.length ? uniq.slice(0, 12).join('\n') : 'no console errors');
await browser.close();
