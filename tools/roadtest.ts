// Highways, interchanges, signals and roundabouts: build them, drive on them, save and load them.
// node --experimental-transform-types tools/roadtest.ts [seed]
import { Game, serialize, restore } from '../src/sim/game.ts';
import { growDemo } from '../src/dev.ts';
import { N, tileIdx, tileX, tileY, wx, wz } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 4);
const policy = process.argv[3] ?? 'mixed';   // plain | rab | sig | mixed
const g = new Game(seed);
growDemo(g, 6, false);
const w = g.world;
g.unlocked.highway = true; g.unlocked.junction = true; g.money = 1e7;
const fail = (m: string) => { console.log('FAIL', m); process.exitCode = 1; };

// 1. a highway along the longest run of open ground that crosses streets without running along one
let best: number[] = [];
let bestScore = -1;
for (let y = 0; y < N; y++) {
  let run: number[] = [];
  const flush = () => { const par = run.filter((t) => w.road[t] && w.surf(t - 1) && w.surf(t + 1)).length; const sc = run.length - par * 6; if (run.length > 12 && sc > bestScore) { bestScore = sc; best = run; } run = []; };
  for (let x = 0; x < N; x++) {
    const t = tileIdx(x, y);
    const okTile = w.isUnlocked(t) && w.bld[t] < 0 && !w.park[t] && w.stop[t] < 0 && !w.rail[t];
    if (okTile) run.push(t); else flush();
  }
  flush();
}
console.log('corridor', best.length, 'tiles at row', tileY(best[0]));
const before = best.filter((t) => w.road[t]).length;
const NOHW = process.env.HW === '0';
const r = NOHW ? { ok: true, cost: 0 } : g.buildRoad(best, 3);
if (!NOHW) for (const q of [0.25, 0.5, 0.75]) { const t = best[Math.floor(best.length * q)]; const rr = g.setJunction(t, 'ramp'); if (!rr.ok) console.log('ramp', rr.msg); }
if (!r.ok) fail('buildRoad highway: ' + r.msg);
const hw = NOHW ? [] : best.filter((t) => w.road[t] === 3);
const ramps = hw.filter((t) => w.ramp[t]);
console.log('highway tiles', hw.length, 'interchange tiles', ramps.length, 'crossed roads', before, 'cost', r.cost);
if (!NOHW && hw.length !== best.length) fail('not every tile became highway');
const over = hw.filter((t) => w.under[t]).length;
console.log('overpasses', over);
if (!NOHW && before > 2 && over === 0) fail('crossing streets should become overpasses');

// 2. linking rules
for (const t of hw) {
  if (w.ramp[t] || w.under[t]) continue;
  for (let d = 0; d < 4; d++) {
    const nx = tileX(t) + [1, 0, -1, 0][d], ny = tileY(t) + [0, 1, 0, -1][d];
    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
    const n = tileIdx(nx, ny);
    if (w.road[n] && w.road[n] < 3 && w.linked(t, n)) fail('sealed highway tile links to a street');
  }
}
// 3. a route that should take the highway
const surf = [...Array(N * N).keys()].filter((i) => w.surf(i));
let used = 0, tried = 0;
for (let k = 0; k < 400; k++) {
  const a = surf[(g.rand() * surf.length) | 0], b = surf[(g.rand() * surf.length) | 0];
  const p = g.traffic.router.find(a, b);
  if (!p) continue;
  tried++;
  if (p.some((t) => w.road[t] === 3)) used++;
  for (let i = 1; i < p.length; i++) {
    if (!w.linked(p[i - 1], p[i])) fail('route steps across an unlinked pair');
    if (Math.abs(tileX(p[i]) - tileX(p[i - 1])) + Math.abs(tileY(p[i]) - tileY(p[i - 1])) !== 1) fail('route has a gap');
    if (w.under[p[i]] && i + 1 < p.length) {
      const d1 = p[i] - p[i - 1], d2 = p[i + 1] - p[i];
      if (d1 !== d2) fail('route turns on an overpass');
    }
  }
}
console.log('routes using the highway', used, 'of', tried);
// 4. junction control on every eligible crossing, or only on the busiest ones after a day of watching traffic
let sig = 0, rab = 0, denied = 0;
const top = policy.startsWith('top');
const kindOf = policy.endsWith('sig') ? 1 : policy.endsWith('rab') ? 2 : 0;
const heat = new Float32Array(N * N);
if (top) {
  const tw = g.t;
  while (g.t - tw < DAY * 1.0 && !g.over) { g.update(0.1); g.stability = 100; for (let i = 0; i < N * N; i++) heat[i] += g.traffic.tileCars[i].length; }
}
const order = [...Array(N * N).keys()].filter((i) => w.surf(i) && w.degree(i) >= 3).sort((a, b) => heat[b] - heat[a]);
const pool = top ? order.slice(0, 14) : order;
for (const i of pool) {
  const want = policy === 'plain' ? 0 : top ? kindOf : policy === 'rab' ? 2 : policy === 'sig' ? 1 : (((tileX(i) >> 2) ^ (tileY(i) >> 2)) & 1) ? 1 : 2;
  if (want === 0) continue;
  const res = g.setJunction(i, want);
  if (res.ok) { if (want === 1) sig++; else rab++; } else denied++;
}
console.log('signals', sig, 'roundabouts', rab, 'denied', denied);
// 5. drive
let bad = 0, maxGrid = 0, moved = 0, arrived = 0, idx = 0, idxN = 0, gridSum = 0;
const oa = g.traffic.onArrive;
let tripSum = 0;
g.traffic.onArrive = (v) => { arrived++; tripSum += g.t - v.spawnedAt; oa(v); };
const t0 = g.t;
while (g.t - t0 < DAY * 2.5 && !g.over) {
  g.update(0.1);
  g.stability = 100;
  for (const v of g.traffic.vehicles) {
    if (v.dead) continue;
    const t = v.path[v.i];
    if (!Number.isFinite(v.x) || !Number.isFinite(v.z) || !Number.isFinite(v.ang)) { bad++; continue; }
    if (Math.hypot(v.x - wx(tileX(t)), v.z - wz(tileY(t))) > 0.95) bad++;
    if (!w.road[t]) bad++;
    if (v.speed > 0.5) moved++;
  }
  maxGrid = Math.max(maxGrid, g.traffic.gridlock);
  idx += g.traffic.trafficIndex; gridSum += g.traffic.gridlock; idxN++;
}
console.log(policy, NOHW ? 'no-highway' : 'highway', 'arrivals', arrived, 'mean trip s', (tripSum / Math.max(1, arrived)).toFixed(1), 'avg congestion', (idx / idxN).toFixed(3), 'avg gridlock tiles', (gridSum / idxN).toFixed(2));
console.log('bad poses', bad, 'max gridlock tiles', maxGrid, 'cars moving samples', moved, 'pop', g.pop, 'money', Math.round(g.money));
if (bad) fail('vehicles off their tiles or NaN');
// 6. save and load
const data = JSON.parse(JSON.stringify(serialize(g)));
const h = restore(data);
let diff = 0;
for (let i = 0; i < N * N; i++) if (g.world.road[i] !== h.world.road[i] || g.world.ramp[i] !== h.world.ramp[i] || g.world.ctl[i] !== h.world.ctl[i]) diff++;
console.log('save/load tile differences', diff);
if (diff) fail('save/load changed the road network');
// 7. bulldoze clears control
const someRab = [...Array(N * N).keys()].find((i) => w.ctl[i] === 2);
if (someRab !== undefined) { g.bulldoze(someRab); if (w.ctl[someRab] || w.road[someRab]) fail('bulldoze left control behind'); }
console.log(process.exitCode ? 'FAILED' : 'ok');
