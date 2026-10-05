// A reasonably competent scripted player, to check the game is survivable and paced well.
// node --experimental-transform-types tools/smart.ts [seed] [days] [skill 0..1]
import { Game } from '../src/sim/game.ts';
import { N, tileIdx } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 3);
const days = +(process.argv[3] ?? 20);
const skill = +(process.argv[4] ?? 1);
const g = new Game(seed);
const w = g.world;
const log: string[] = [];
g.on('toast', (t: any) => log.push(`d${g.day} ${g.hour.toFixed(0)}h ${t.msg}`));

// where the starting town sits
let cx = N / 2, cy = N / 2;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = tileIdx(x, y); if (w.road[t] === 2 && w.road[tileIdx(x + 1, y)] === 2 && w.road[tileIdx(x, y + 1)] === 2 && w.road[tileIdx(x - 1, y)] === 2 && w.road[tileIdx(x, y - 1)] === 2) { cx = x; cy = y; } }
const spacing = +(process.env.SPACING ?? 4);
function gridStep() {
  const cand: { tiles: number[]; d: number }[] = [];
  for (let k = -36; k <= 36; k += spacing) {
    const row: number[] = [], col: number[] = [];
    for (let i = 0; i < N; i++) {
      const y = cy + k, x = cx + k;
      if (y >= 0 && y < N) { const rt = tileIdx(i, y); if (w.isUnlocked(rt) && !w.road[rt] && w.bld[rt] < 0 && !w.park[rt]) row.push(rt); }
      if (x >= 0 && x < N) { const ct = tileIdx(x, i); if (w.isUnlocked(ct) && !w.road[ct] && w.bld[ct] < 0 && !w.park[ct]) col.push(ct); }
    }
    if (row.length) cand.push({ tiles: row, d: Math.abs(k) });
    if (col.length) cand.push({ tiles: col, d: Math.abs(k) });
  }
  cand.sort((a, b) => a.d - b.d);
  for (const c of cand) { if (g.buildRoad(c.tiles, 1).ok) return true; }
  return false;
}
const loadEma = new Float32Array(N * N);
function upgradeAvenues() {
  if (!g.unlocked.avenue) return;
  const list: number[] = [];
  for (let i = 0; i < N * N; i++) if (w.road[i] === 1 && loadEma[i] > 0.55) list.push(i);
  list.sort((a, b) => loadEma[b] - loadEma[a]);
  g.buildRoad(list.slice(0, 14), 2);
}
function lineAlong(horizontal: boolean, k: number, lo: number, hi: number, step = 3) {
  const tiles: number[] = [];
  for (let i = lo; i <= hi; i += step) tiles.push(horizontal ? tileIdx(i, cy + k) : tileIdx(cx + k, i));
  const ok: number[] = [];
  for (const t of tiles) { if (w.road[t] && w.stopKind[t] !== 2 && w.bld[t] < 0) ok.push(t); else if (ok.length >= 3) break; else ok.length = 0; }
  if (ok.length >= 3) g.createBusLine(ok);
}
function metroAcross(horizontal: boolean, k: number) {
  const tiles: number[] = [];
  for (let i = 3; i <= N - 3; i += 8) tiles.push(horizontal ? tileIdx(i, cy + k) : tileIdx(cx + k, i));
  const ok = tiles.filter((t) => w.isUnlocked(t) && !w.water[t] && w.bld[t] < 0 && w.stopKind[t] !== 1);
  if (ok.length >= 3) { const r = g.createMetroLine(ok); if (!r.ok) console.log('   metro fail', r.msg); }
}
let nextAct = g.t + DAY * 0.2;
let nextEma = g.t;
let busLinesMade = 0;
const plan: ((() => void) | null)[] = [];
let lastReport = -1;
const wall = Date.now();
const endT = g.t + days * DAY;
while (g.t < endT && !g.over) {
  g.update(0.05);
  if (process.env.DIAG && g.t > +process.env.DIAG * DAY) {
    const c = g.city;
    const cnt: Record<string, number> = {};
    for (const p of c.persons) { const k = `${p.state}/${p.phase}${p.student ? '/pupil' : ''}${p.stage === 'senior' ? '/sen' : ''}`; cnt[k] = (cnt[k] ?? 0) + 1; }
    console.log('DIAG day', g.day, 'hour', g.hour.toFixed(1), 'pop', c.persons.length, JSON.stringify(cnt));
    for (const s of g.transit.stops.filter((q) => q.queue.length > q.cap * 0.6)) console.log('  stop', s.name, s.kind, s.queue.length, '/', s.cap, 'lines', s.lines.map((l) => l.name).join(','));
    for (const l of g.transit.lines) console.log('  line', l.name, l.kind, 'veh', l.vehicles.length, 'board', l.boardings, 'broken', l.broken, 'riders', l.riders.toFixed(1));
    break;
  }
  if (g.t > nextEma) { nextEma = g.t + 1; for (let i = 0; i < N * N; i++) loadEma[i] += (g.traffic.load[i] - loadEma[i]) * 0.1; }
  if (g.t > nextAct) {
    nextAct = g.t + DAY * (0.25 / Math.max(0.2, skill));
    gridStep(); if (g.rand() < 0.7) gridStep();
    if (g.pop > 300) {
      if (g.rand() < 0.5 * skill) upgradeAvenues();
      // bus lines in a lattice near the centre
      const wantBus = Math.floor(2 + g.pop / 450);
      if (g.transit.lines.filter((l) => l.kind === 'bus').length < Math.min(10, wantBus) && g.money > 900) {
        const ks = [0, 0, -4, -4, 4, 4, -8, 8, -12, 12];
        const n = g.transit.lines.filter((l) => l.kind === 'bus').length;
        lineAlong(n % 2 === 0, ks[n % ks.length], 2, N - 2, 3);
      }
    }
    // service levels
    for (const l of g.transit.lines) {
      const waiting = l.stops.reduce((a, s) => a + s.queue.length, 0);
      if (l.vehicles.length < g.transit.maxVehicles(l) && (waiting > l.stops.length * 2.5 || (l.kind === 'bus' && l.vehicles.length < 2 + g.pop / 700)) && g.money > g.transit.vehicleCost(l) + 600) g.addVehicle(l);
      for (const s of l.stops) if (s.queue.length > s.cap * 0.9 && g.money > 1500) g.expandStop(s);
    }
    if (g.unlocked.metro && g.money > 7000) {
      const n = g.transit.lines.filter((l) => l.kind === 'metro').length;
      if (n < 4 && g.pop > 900 + n * 600) metroAcross(n % 2 === 0, [0, 0, 4, -4][n]);
    }
    if (g.unlocked.policies) {
      if (!g.policies.stagger && g.money > 1500) g.setPolicy('stagger', true);
      if (!g.policies.busLanes && g.transit.lines.length >= 4 && g.money > 3000) g.setPolicy('busLanes', true);
      if (!g.policies.toll && g.crisis.traffic > 0.4 && g.money > 3000) g.setPolicy('toll', true);
    }
    for (const d of w.districts) if (!d.unlocked && g.money > d.cost + 2500 && g.pop > 400) { if (g.unlockDistrict(d.index).ok) break; }
  }
  const hr = Math.floor(g.t / (DAY / 4));
  if (hr !== lastReport) {
    lastReport = hr;
    const s = g.city.stats, tr = g.traffic;
    console.log(`d${String(g.day).padStart(2)} ${g.hour.toFixed(0).padStart(2)}h pop ${String(s.pop).padStart(5)} bld ${String(s.buildings).padStart(3)} cars ${String(tr.vehicles.length).padStart(4)} pend ${String(tr.pending.length).padStart(3)} grid ${String(tr.gridlock).padStart(3)} stab ${g.stability.toFixed(0).padStart(3)} $${String(Math.round(g.money)).padStart(6)} car/tr/wk ${(s.car * 100).toFixed(0)}/${(s.transit * 100).toFixed(0)}/${(s.walk * 100).toFixed(0)} lines ${g.transit.lines.length} wait ${g.transit.waiting} crisis T${g.crisis.traffic.toFixed(2)} S${g.crisis.transit.toFixed(2)} U${g.crisis.unrest.toFixed(2)} sat ${s.sat.toFixed(2)}`);
  }
}
if (process.env.DUMP) {
  console.log('hour', g.hour.toFixed(1), 'veh', g.traffic.vehicles.length, 'pending', g.traffic.pending.length);
  for (let y = 4; y < N - 4; y++) { let row = ''; for (let x = 4; x < N - 4; x++) { const i = tileIdx(x, y); if (!w.road[i]) { row += w.water[i] ? '~' : w.bld[i] >= 0 ? '.' : ' '; continue; } const n = g.traffic.tileCars[i].length; row += n === 0 ? (w.road[i] === 2 ? '=' : '-') : n > 9 ? '#' : String(n); } console.log(row); }
  const po: Record<number, number> = {}; for (const v of g.traffic.pending) po[v.path[0]] = (po[v.path[0]] || 0) + 1;
  console.log('pending origins', Object.entries(po).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => `${(+t) % N},${Math.floor((+t) / N)}:${n}`).join(' '));
}
console.log(log.slice(-12).join('\n'));
console.log(`done in ${((Date.now() - wall) / 1000).toFixed(1)}s day ${g.day} pop ${g.pop} over=${g.over} ${g.overReason}`);
void busLinesMade; void plan;
