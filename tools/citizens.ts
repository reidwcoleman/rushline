// Citizen sanity: run a town for some days and report on the lives inside it.
// node --experimental-transform-types tools/citizens.ts [seed] [days]
import { Game } from '../src/sim/game.ts';
import { growDemo } from '../src/dev.ts';
import { DAY } from '../src/sim/types.ts';
import { VENUES } from '../src/sim/people.ts';

const seed = +(process.argv[2] ?? 3);
const days = +(process.argv[3] ?? 4);
const g = new Game(seed);
growDemo(g, +(process.argv[4] ?? 5), false);
g.money = 200000;
const c = g.city;
const report = (tag: string) => {
  const s = c.stats;
  const needs = { energy: 0, hunger: 0, fun: 0, social: 0, comfort: 0 };
  let nan = 0, bad = 0;
  for (const p of c.persons) {
    for (const k of Object.keys(needs) as (keyof typeof needs)[]) { needs[k] += p.needs[k]; if (!isFinite(p.needs[k]) || p.needs[k] < 0 || p.needs[k] > 1) nan++; }
    if (!isFinite(p.mood) || !isFinite(p.sat)) nan++;
    if (p.work && !(p.work.workers.includes(p) || p.work.students.includes(p))) bad++;
    if (p.hh.members.indexOf(p) < 0 || p.home.residents.indexOf(p) < 0) bad++;
  }
  const n = Math.max(1, c.persons.length);
  console.log(`${tag} d${g.day} h${g.hour.toFixed(0)} pop ${s.pop} (adult ${s.adults} kid ${s.kids} senior ${s.seniors} pupils ${s.pupils}) emp ${s.employed}/${s.adults} hh ${c.households.size} sat ${s.sat.toFixed(2)} mood ${s.mood.toFixed(2)} needs E${(needs.energy / n).toFixed(2)} H${(needs.hunger / n).toFixed(2)} F${(needs.fun / n).toFixed(2)} S${(needs.social / n).toFixed(2)} C${(needs.comfort / n).toFixed(2)} visits ${c.visits} stab ${g.stability.toFixed(0)} nan ${nan} bad ${bad}`);
};
report('start');
const every = +(process.env.EVERY ?? 0.5);
let nextRep = g.t + DAY * every;
const t0 = g.t;
while (g.t < t0 + DAY * days && !g.over) {
  g.update(0.1);
  if (g.t > nextRep) { nextRep = g.t + DAY * every; report('    '); g.money = 200000; }
}
console.log('--- feed');
for (const f of c.feed.slice(-14)) console.log(`  [${f.tone}] ${f.text}`);
const p = c.persons[Math.floor(c.persons.length / 3)];
console.log('--- sample', p.first, p.last, p.age, p.stage, p.title, p.wage, p.traits.join(','), 'mood', p.mood.toFixed(2));
console.log('   now:', c.activityOf(p, g.hour), '| thought:', c.thoughtOf(p), '| wants:', c.wantsOf(p).join(', '));
console.log('   log:', p.log.map((l) => l.text).join(' / '));
console.log('--- top wants', JSON.stringify(Object.entries(c.wantFrac).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)));
const venues: Record<string, number> = {};
for (const b of c.buildings.values()) if (b.kind === 'com') venues[b.venue ?? '?'] = (venues[b.venue ?? '?'] ?? 0) + 1;
console.log('venues', JSON.stringify(venues), Object.keys(VENUES).length);
