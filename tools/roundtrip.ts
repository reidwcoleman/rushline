// Save/restore round trip for everything v3 adds: citizens, households, industries, airport, finance.
// node --experimental-transform-types tools/roundtrip.ts [seed]
import { Game, serialize, restore } from '../src/sim/game.ts';
import { growDemo, addFreight, addAirport } from '../src/dev.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 4);
const g = new Game(seed);
growDemo(g, 5, false);
addFreight(g);
const air = addAirport(g);
g.takeLoan(5000); g.setMaintenance(2); g.startResearch('bus');
const t0 = g.t;
while (g.t - t0 < DAY * 1.5) g.update(0.1);
const data = JSON.parse(JSON.stringify(serialize(g)));
const h = restore(data);
const sum = (x: Game) => ({
  pop: x.city.persons.length, hh: x.city.households.size, bld: x.city.buildings.size,
  air: [...x.city.buildings.values()].filter((b) => b.special === 'airport').map((b) => b.foot.length + ':' + b.rotFoot),
  ind: [...x.city.buildings.values()].filter((b) => b.special && ['farm', 'quarry', 'factory', 'terminal'].includes(b.special)).length,
  lines: x.transit.lines.map((l) => l.kind[0] + l.vehicles.length).join(','), loan: x.loan, maint: x.maint,
  friends: x.city.persons.reduce((a, p) => a + p.friends.length, 0),
  jobs: x.city.persons.filter((p) => p.work).length,
  names: x.city.persons.slice(0, 3).map((p) => p.first + ' ' + p.last + ' ' + p.age).join('; '),
});
console.log('before', JSON.stringify(sum(g)));
console.log('after ', JSON.stringify(sum(h)));
const t1 = h.t;
while (h.t - t1 < DAY) h.update(0.1);
console.log('ran a day after restore: pop', h.city.persons.length, 'money', Math.round(h.money), 'stab', h.stability.toFixed(0), 'air', air.at);
