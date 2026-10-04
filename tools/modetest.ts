// New transport modes: build one of each on a grown city and check they carry people.
// node --experimental-transform-types tools/modetest.ts [seed] [days]
import { Game } from '../src/sim/game.ts';
import { growDemo } from '../src/dev.ts';
import { N, tileIdx, tileX, tileY } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';
import { MODES, type Mode } from '../src/sim/modes.ts';

const seed = +(process.argv[2] ?? 8);
const days = +(process.argv[3] ?? 2);
const g = new Game(seed);
growDemo(g, 7, false);
g.money = 500000;
for (const k of ['tram', 'ferry', 'gondola', 'metro'] as const) g.unlocked[k] = true;
const w = g.world;
console.log(`seed ${seed}: pop ${g.pop}, lines ${g.transit.lines.length}`);

function tryBuild(mode: Mode, cands: number[][]) {
  for (const c of cands) {
    const q = g.quoteLine(mode, c);
    if (!q.ok) continue;
    const r = g.createLine(mode, c);
    if (r.ok) { console.log(`  ${mode}: built ${c.length} stops, cost ${Math.round(r.cost!)}, widen ${q.widen.length}, track ${q.track.length}`); return r.line!; }
    console.log(`  ${mode}: create failed ${r.msg}`);
  }
  console.log(`  ${mode}: no route found`);
  return null;
}
const rnd = (() => { let a = 12345; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const roads: number[] = []; const shore: number[] = []; const open: number[] = [];
for (let i = 0; i < N * N; i++) {
  if (w.road[i] && w.stop[i] < 0) roads.push(i);
  if (w.shore[i] && w.isEmpty(i) && w.isUnlocked(i)) shore.push(i);
  if (!w.road[i] && !w.water[i] && w.bld[i] < 0 && !w.park[i] && w.stop[i] < 0 && w.isUnlocked(i)) open.push(i);
}
const dist = (a: number, b: number) => Math.hypot(tileX(a) - tileX(b), tileY(a) - tileY(b));
const blds = [...g.city.buildings.values()];
const near = (t: number, r: number) => blds.reduce((n, b) => n + (Math.hypot(b.x - tileX(t), b.y - tileY(t)) < r ? b.cap : 0), 0);
const pairs = (arr: number[], lo: number, hi: number, n = 600) => {
  const out: { p: number[]; sc: number }[] = [];
  for (let k = 0; k < n; k++) { const a = arr[(rnd() * arr.length) | 0], b = arr[(rnd() * arr.length) | 0]; const d = dist(a, b); if (d >= lo && d <= hi) out.push({ p: [a, b], sc: near(a, 4) * near(b, 4) }); }
  return out.sort((x, y) => y.sc - x.sc).slice(0, 12).map((o) => o.p);
};
const tram = tryBuild('tram', pairs(roads, 8, 20));
const ferry = tryBuild('ferry', pairs(shore, 6, 24));
const gondola = tryBuild('gondola', pairs(open, 6, 16));
const lines = [tram, ferry, gondola].filter(Boolean) as NonNullable<typeof tram>[];
for (const l of lines) { g.addVehicle(l); g.addVehicle(l); }
let next = 0;
const t0 = g.t;
while (g.t - t0 < DAY * days && !g.over) {
  g.update(0.1); g.stability = 100;
  if (g.t > next) { next = g.t + DAY * 0.5; g.money = 500000; }
}
for (const l of lines) {
  const m = MODES[l.kind];
  console.log(`  ${l.name}: ${l.vehicles.length} ${m.vehicles}, stops ${l.stops.length}, boardings ${l.boardings}, income ${l.income.toFixed(0)}, riders ${l.riders.toFixed(1)}, broken ${l.broken}, len ${g.transit.lineLength(l).toFixed(1)}`);
}
console.log(`pop ${g.pop}, stability ${g.stability.toFixed(0)}, stranded ${g.city.stats.stuck}`);
// save round trip
import { serialize, restore } from '../src/sim/game.ts';
const g2 = restore(JSON.parse(JSON.stringify(serialize(g))));
console.log(`restore: ${g2.transit.lines.length}/${g.transit.lines.length} lines, kinds ${g2.transit.lines.map((l) => l.kind).join(',')}`);
