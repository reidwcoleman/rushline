// Love, weddings, parties, wishes and orders over a few days of a grown town.
// node --experimental-transform-types tools/lives.ts [seed] [days]
import { Game, serialize, restore } from '../src/sim/game.ts';
import { growDemo } from '../src/dev.ts';
import { DAY } from '../src/sim/types.ts';

const seed = +(process.argv[2] ?? 4), days = +(process.argv[3] ?? 12);
const g = new Game(seed);
growDemo(g, 6, false);
const c = g.city, s = c.social;
const fail = (m: string) => { console.log('FAIL', m); process.exitCode = 1; };
const t0 = g.t;
let maxPar = 0;
while (g.t - t0 < DAY * days && !g.over) {
  g.update(0.1); g.stability = 100;
  for (const b of c.buildings.values()) if (b.partyUntil > g.t) { let n = 0; for (const q of c.persons) if (q.at === b && q.phase === 'none') n++; maxPar = Math.max(maxPar, n); }
  if (((g.t / 0.1) | 0) % 50 === 0) check();
}
function check() {
  for (const p of c.persons) {
    if (p.dead) fail('dead in list');
    if (p.partner) {
      const m = c.personById.get(p.partner);
      if (!m) { /* cleaned at the next day */ } else if (m.partner !== p.id && m.partner !== 0) fail('one-sided partner');
    }
    if (p.orders.length > 14) fail('order pile-up');
    for (const o of p.orders) if (!c.buildings.has(o.dest.id)) fail('order to a removed building');
    if (p.hh.members.indexOf(p) < 0 || p.home.residents.indexOf(p) < 0) fail('household/home mismatch for ' + p.first);
    if (p.hh.home !== p.home) fail('household home differs from person home ' + p.first);
    if (!isFinite(p.mood)) fail('mood NaN');
  }
  for (const b of c.buildings.values()) if (b.kind === 'res' && b.residents.length > b.cap + 3) fail('home over capacity ' + b.residents.length + '/' + b.cap);
}
check();
const cp = s.couples();
console.log('day', g.day, 'pop', c.persons.length, 'dates', s.dates, 'engaged', s.engagements, 'weddings', s.weddings, 'breakups', s.breakups, 'parties', s.parties, 'wishes', s.wishes, 'couples', JSON.stringify(cp), 'biggest crowd', maxPar);
console.log('with wish:', c.persons.filter((p) => p.wish).length, 'of', c.persons.length, ' feed sample:', c.feed.slice(-4).map((f) => f.text).join(' | '));
// orders by hand: send someone out and watch them go
const p = c.persons.find((q) => q.stage === 'adult' && q.phase === 'none' && q.state === 'home' && !q.orders.length);
if (p) {
  const acts = s.actionsFor(p);
  console.log('actions:', acts.map((a) => `${a.label}${a.ok ? '' : '(x)'}`).join(', '));
  const eat = acts.find((a) => a.id === 'eat' && a.ok);
  if (eat) {
    console.log(s.perform(p, 'eat'));
    let went = false, back = false;
    const t1 = g.t;
    while (g.t - t1 < DAY * 0.6) { g.update(0.1); g.stability = 100; if (p.state === 'leisure' && p.orders[0]?.ph === 2) went = true; if (went && p.state === 'home' && !p.orders.length) { back = true; break; } }
    console.log('went out', went, 'came home', back, 'state', p.state, 'activity', c.activityOf(p, 12));
    if (!went) fail('ordered citizen never arrived');
  }
}
// save and load keeps couples
const d = JSON.parse(JSON.stringify(serialize(g)));
const h = restore(d);
const cnt = (x: Game) => x.city.persons.filter((q) => q.bond).length;
console.log('bonded before/after save', cnt(g), cnt(h));
if (Math.abs(cnt(g) - cnt(h)) > 2) fail('bonds lost in save');
console.log(process.exitCode ? 'FAILED' : 'ok');
