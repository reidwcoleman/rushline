// Freight: build truck and rail lines between the starting industries and check cargo flows and pays.
// node --experimental-transform-types tools/freighttest.ts [seed] [days]
import { Game } from '../src/sim/game.ts';
import { growDemo } from '../src/dev.ts';
import { N, tileIdx, tileX, tileY, wx, wz } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';
import { FACILITY, isIndustry, sellsIdx } from '../src/sim/industry.ts';

const seed = +(process.argv[2] ?? 3);
const days = +(process.argv[3] ?? 3);
const g = new Game(seed);
growDemo(g, 6, false);
g.money = 400000; g.unlocked.truck = true; g.unlocked.freight = true;
const w = g.world, c = g.city;
const sites = c.cargoSites();
const ind = sites.filter((b) => isIndustry(b.special));
console.log('industries:', ind.map((b) => `${b.special}@${b.x},${b.y} ${b.name} access ${b.access}`).join(' | '));
const yardNear = (b: { x: number; y: number }, mode: 'truck' | 'freight') => {
  let best = -1, bd = 99;
  for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const t = tileIdx(x, y);
    if (g.spotCheck(mode, t)) continue;
    if (mode === 'truck' && g.roadDegree(t) >= 3) continue;
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
};
const farm = ind.find((b) => b.special === 'farm')!, quarry = ind.find((b) => b.special === 'quarry')!, fac = ind.find((b) => b.special === 'factory')!, term = ind.find((b) => b.special === 'terminal')!;
const shops = sites.filter((b) => sellsIdx(b) >= 0).sort((a, b) => Math.hypot(a.x - farm.x, a.y - farm.y) - Math.hypot(b.x - farm.x, b.y - farm.y));
console.log('shops', shops.length, 'nearest', shops[0]?.name);
const lines: ReturnType<typeof g.createLine>[] = [];
function tryLine(label: string, mode: 'truck' | 'freight', bs: { x: number; y: number }[]) {
  const tiles = bs.map((b) => yardNear(b, mode));
  if (tiles.some((t) => t < 0)) { console.log(label, 'no yard spot', tiles); return null; }
  const q = g.quoteLine(mode, tiles);
  if (!q.ok) { console.log(label, 'quote failed:', q.reason); return null; }
  const r = g.createLine(mode, tiles);
  console.log(label, r.ok ? `built ${tiles.length} yards for $${Math.round(r.cost!)}` : 'fail ' + r.msg);
  return r.ok ? r.line! : null;
}
const l1 = tryLine('farm->shop', 'truck', [farm, shops[0]]);
const l2 = tryLine('quarry->factory', 'truck', [quarry, fac]);
const l3 = tryLine('factory->terminal', 'truck', [fac, term]);
const l4 = tryLine('farm->terminal rail', 'freight', [farm, term]);
for (const l of [l1, l2, l3, l4]) if (l) { g.addVehicle(l); g.addVehicle(l); }
const t0 = g.t;
let next = 0;
while (g.t - t0 < DAY * days && !g.over) {
  g.update(0.1); g.stability = 100;
  if (g.t > next) { next = g.t + DAY * 0.5; g.money = 400000; }
}
for (const l of [l1, l2, l3, l4]) if (l) console.log(`  ${l.name} ${l.kind}: vehicles ${l.vehicles.length} hauled ${l.hauled.toFixed(0)} income $${l.income.toFixed(0)} broken ${l.broken} loads ${l.vehicles.map((v) => v.load ? v.load.qty.toFixed(0) : '-').join(',')}`);
for (const b of ind) console.log(`  ${b.name} (${b.special}) out ${b.out.map((v) => v.toFixed(0)).join('/')} stock ${b.stock.map((v) => v.toFixed(0)).join('/')} eff ${b.eff.toFixed(2)} staff ${b.workers.length}/${b.cap}`);
console.log('imports/day units', c.importsDay.toFixed(1), 'soldLocal', c.soldLocal.toFixed(1), 'cargo income', JSON.stringify(g.bookHist.map((h) => Math.round(h.inc.cargo ?? 0))));
console.log('wx check', wx(farm.x), wz(farm.y), FACILITY.farm.rate);
