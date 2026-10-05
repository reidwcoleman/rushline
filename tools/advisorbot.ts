// A casual player who only lays streets and presses the advisor's button. Shows how far the helpers carry someone.
// node --experimental-transform-types tools/advisorbot.ts [seed] [days] [diff]
import { Game } from '../src/sim/game.ts';
import { N, tileIdx } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 8);
const days = +(process.argv[3] ?? 25);
const diff = +(process.argv[4] ?? 0);
const g = new Game(seed, { diff });
const w = g.world;
const log: string[] = [];
g.on('toast', (t: any) => log.push(`d${g.day} ${g.hour.toFixed(0)}h ${t.msg}`));
let cx = 32, cy = 32;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const t = tileIdx(x, y); if (w.road[t] === 2 && w.road[tileIdx(x + 1, y)] === 2 && w.road[tileIdx(x, y + 1)] === 2 && w.road[tileIdx(x - 1, y)] === 2 && w.road[tileIdx(x, y - 1)] === 2) { cx = x; cy = y; } }
function gridStep() {
  const cand: { tiles: number[]; d: number }[] = [];
  for (let k = -24; k <= 24; k += 4) {
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
  for (const c of cand) if (g.buildRoad(c.tiles, 1).ok) return;
}
let nextAct = g.t + DAY * 0.25;
let acts = 0, fails = 0;
let lastReport = -1;
const wall = Date.now();
const endT = g.t + days * DAY;
while (g.t < endT && !g.over) {
  g.update(0.05);
  if (g.t > nextAct) {
    nextAct = g.t + DAY * 0.2;
    gridStep();
    for (let k = 0; k < 2; k++) {
      g.refreshAdvice();
      const a = g.advice.find((x) => x.act);
      if (!a) break;
      const r = a.act!();
      if (r.ok) acts++; else { fails++; g.dismissed.add(a.id); }
    }
    for (const d of w.districts) if (!d.unlocked && g.money > d.cost + 3000 && g.pop > 500) { if (g.unlockDistrict(d.index).ok) break; }
  }
  const q = Math.floor(g.t / (DAY / 2));
  if (q !== lastReport) {
    lastReport = q;
    const s = g.city.stats, tr = g.traffic;
    console.log(`d${String(g.day).padStart(2)} ${g.hour.toFixed(0).padStart(2)}h pop ${String(s.pop).padStart(5)} cars ${String(tr.vehicles.length).padStart(4)} grid ${String(tr.gridlock).padStart(3)} stab ${g.stability.toFixed(0).padStart(3)} $${String(Math.round(g.money)).padStart(6)} lines ${g.transit.lines.length} (${g.transit.lines.map((l) => l.kind[0]).join('')}) wait ${g.transit.waiting} acts ${acts}/${fails}`);
  }
}
console.log(log.slice(-8).join('\n'));
console.log(`done in ${((Date.now() - wall) / 1000).toFixed(1)}s day ${g.day} pop ${g.pop} over=${g.over} ${g.overReason}`);
