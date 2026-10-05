// Headless balance harness: node --experimental-transform-types tools/simtest.ts [seed] [days] [mode]
import { Game } from '../src/sim/game.ts';
import { N, tileIdx, DX, DY, inMap } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 3);
const days = +(process.argv[3] ?? 6);
const mode = process.argv[4] ?? 'none';
const g = new Game(seed);
const w = g.world;
const log: string[] = [];
g.on('toast', (t: any) => log.push(`d${g.day} ${g.hour.toFixed(1)}h  ${t.msg}`));

function randomRoadExtension() {
  // extend from a random road tile in a straight line
  for (let tries = 0; tries < 50; tries++) {
    const i = Math.floor(g.rand() * N * N);
    if (!w.road[i]) continue;
    const x = i % N, y = (i / N) | 0;
    const d = Math.floor(g.rand() * 4);
    const len = 4 + Math.floor(g.rand() * 5);
    const tiles: number[] = [];
    for (let k = 1; k <= len; k++) {
      const nx = x + DX[d] * k, ny = y + DY[d] * k;
      if (!inMap(nx, ny)) break;
      const t = tileIdx(nx, ny);
      if (w.water[t] || w.bld[t] >= 0 || !w.isUnlocked(t)) break;
      tiles.push(t);
    }
    if (tiles.length >= 2) { g.buildRoad(tiles, 1); return; }
  }
}
function busLine() {
  const roads: number[] = [];
  for (let i = 0; i < N * N; i++) if (w.road[i] && w.stop[i] < 0) roads.push(i);
  if (roads.length < 20) return;
  for (let tries = 0; tries < 30; tries++) {
    const pts = [0, 1, 2, 3].map(() => roads[Math.floor(g.rand() * roads.length)]);
    const r = g.createBusLine(pts);
    if (r.ok) return;
  }
}

const lines: number[][] = [];
function gridStep() {
  // lay one more grid line (every 4th row/col from the centre) inside unlocked districts
  const cx = 32, cy = 32;
  const cand: { tiles: number[]; lvl: 1 | 2; d: number }[] = [];
  for (let k = -32; k <= 32; k += 4) {
    const row: number[] = [], col: number[] = [];
    for (let i = 0; i < N; i++) {
      const rt = tileIdx(i, cy + k), ct = tileIdx(cx + k, i);
      if (cy + k >= 0 && cy + k < N && w.isUnlocked(rt) && !w.road[rt] && w.bld[rt] < 0 && !w.park[rt]) row.push(rt);
      if (cx + k >= 0 && cx + k < N && w.isUnlocked(ct) && !w.road[ct] && w.bld[ct] < 0 && !w.park[ct]) col.push(ct);
    }
    if (row.length) cand.push({ tiles: row, lvl: 1, d: Math.abs(k) });
    if (col.length) cand.push({ tiles: col, lvl: 1, d: Math.abs(k) });
  }
  cand.sort((a, b) => a.d - b.d);
  for (const c of cand) { const r = g.buildRoad(c.tiles, c.lvl); if (r.ok) return; }
}
function avenues() {
  const cy = 32, cx = 32;
  const row: number[] = [], col: number[] = [];
  for (let i = 0; i < N; i++) { row.push(tileIdx(i, cy)); col.push(tileIdx(cx, i)); }
  g.buildRoad(row.filter((t) => w.isUnlocked(t) && w.bld[t] < 0 && !w.park[t]), 2);
  g.buildRoad(col.filter((t) => w.isUnlocked(t) && w.bld[t] < 0 && !w.park[t]), 2);
}
function lineAlong(horizontal: boolean, k: number, lo: number, hi: number) {
  const tiles: number[] = [];
  for (let i = lo; i <= hi; i += 3) tiles.push(horizontal ? tileIdx(i, 32 + k) : tileIdx(32 + k, i));
  // keep a connected run of road tiles
  const ok: number[] = [];
  for (const t of tiles) { if (w.road[t] && w.stopKind[t] !== 2 && w.bld[t] < 0) ok.push(t); else if (ok.length >= 2) break; else ok.length = 0; }
  if (ok.length >= 2) g.createBusLine(ok);
}
function metroAcross(horizontal: boolean, k: number) {
  const tiles: number[] = [];
  for (let i = 6; i <= 58; i += 7) tiles.push(horizontal ? tileIdx(i, 32 + k) : tileIdx(32 + k, i));
  const ok = tiles.filter((t) => w.isUnlocked(t) && !w.water[t] && w.bld[t] < 0 && w.stopKind[t] !== 1);
  if (ok.length >= 2) { const r = g.createMetroLine(ok); if (!r.ok) console.log('metro fail', r.msg); }
}
let lastReport = -1;
const dt = 0.05;
const total = days * DAY;
const t0 = g.t;
let nextAct = g.t + DAY * 0.3;
const wall = Date.now();
while (g.t - t0 < total && !g.over) {
  g.update(dt);
  if (mode === 'grid' && g.t > nextAct) {
    nextAct = g.t + DAY * 0.15;
    for (let k = 0; k < 2; k++) gridStep();
    if (g.unlocked.avenue && g.money > 2000 && !(g as any).__av) { avenues(); (g as any).__av = true; }
    for (const d of w.districts) if (!d.unlocked && g.money > d.cost + 1500) { if (g.unlockDistrict(d.index).ok) break; }
    if (g.money > 1200 && g.transit.lines.filter((l) => l.kind === 'bus').length < 3 + Math.floor(g.day / 2)) {
      const k = [0, 0, -4, -4, 4, 4, -8, 8][g.transit.lines.length % 8];
      lineAlong(g.transit.lines.length % 2 === 0, k, 4, 36);
    }
    for (const l of g.transit.lines) if (g.money > 800 && l.vehicles.length < 2 + Math.floor(g.day / 2) && (l.kind === 'bus' ? true : l.riders > 20)) g.addVehicle(l);
    if (g.unlocked.metro && g.money > 7000 && g.transit.lines.filter((l) => l.kind === 'metro').length < 2) metroAcross(g.transit.lines.length % 2 === 0, g.transit.lines.length % 2 === 0 ? 0 : 0);
  }
  if (mode === 'ai' && g.t > nextAct) {
    nextAct = g.t + DAY * 0.25;
    for (let k = 0; k < 3; k++) randomRoadExtension();
    if (g.rand() < 0.5) busLine();
    // unlock a district if rich
    for (const d of w.districts) if (!d.unlocked && g.money > d.cost + 3000) { if (g.unlockDistrict(d.index).ok) break; }
  }
  const hr = Math.floor(g.t / (DAY / 6));
  if (hr !== lastReport) {
    lastReport = hr;
    const s = g.city.stats, tr = g.traffic;
    console.log(`d${g.day} ${g.hour.toFixed(0).padStart(2)}h pop ${String(s.pop).padStart(5)} bld ${String(s.buildings).padStart(3)} jobs ${String(s.jobs).padStart(4)} cars ${String(tr.vehicles.length).padStart(4)} pend ${tr.pending.length} grid ${String(tr.gridlock).padStart(3)} tIdx ${tr.trafficIndex.toFixed(2)} sat ${s.sat.toFixed(2)} stab ${g.stability.toFixed(0).padStart(3)} $${Math.round(g.money)} car/tr/wk ${(s.car * 100).toFixed(0)}/${(s.transit * 100).toFixed(0)}/${(s.walk * 100).toFixed(0)} wait ${g.transit.waiting} crisis ${g.crisis.total.toFixed(2)} dem ${s.demand.r.toFixed(2)}/${s.demand.c.toFixed(2)}/${s.demand.i.toFixed(2)}`);
  }
}
console.log(log.slice(-14).join('\n'));
console.log(`done in ${((Date.now() - wall) / 1000).toFixed(1)}s, over=${g.over} ${g.overReason}`);
