// Random-command fuzz: node --experimental-transform-types tools/fuzz.ts [seed] [days]
import { Game } from '../src/sim/game.ts';
import { N, tileIdx, DX, DY, inMap } from '../src/sim/world.ts';
import { DAY } from '../src/sim/types.ts';
import { MODE_ORDER, type Mode } from '../src/sim/modes.ts';

const seed = +(process.argv[2] ?? 1);
const days = +(process.argv[3] ?? 12);
const gentle = process.argv[4] === 'gentle';
const g = new Game(seed);
const w = g.world;
g.money = 1e7;
for (const k of ['tram', 'ferry', 'gondola', 'metro', 'truck', 'freight'] as const) g.unlocked[k] = true;
const R = () => g.rand();
let ops = 0;
function randTile() { return Math.floor(R() * N * N); }
function randRoad() { for (let k = 0; k < 200; k++) { const t = randTile(); if (w.road[t]) return t; } return -1; }
function randShore() { for (let k = 0; k < 300; k++) { const t = randTile(); if (w.shore[t]) return t; } return randTile(); }
function randNearSite(wantRoad: boolean) {
  const sites = g.city.cargoSites();
  if (!sites.length) return randTile();
  for (let k = 0; k < 40; k++) {
    const b = sites[(R() * sites.length) | 0];
    const x = Math.max(0, Math.min(N - 1, b.x + ((R() * 7) | 0) - 3)), y = Math.max(0, Math.min(N - 1, b.y + ((R() * 7) | 0) - 3));
    const t = tileIdx(x, y);
    if (!g.spotCheck(wantRoad ? 'truck' : 'freight', t)) return t;
  }
  return randTile();
}
function randSpot(m: Mode) { return m === 'bus' || m === 'tram' ? randRoad() : m === 'truck' ? randNearSite(true) : m === 'freight' ? randNearSite(false) : m === 'ferry' ? randShore() : randTile(); }
const FUZZ_MODES: Mode[] = [...MODE_ORDER.slice(1), 'truck', 'freight'];
function act() {
  ops++;
  (globalThis as any).__lastop = 'start';
  let r = R();
  if (gentle && r > 0.36 && r < 0.48) r = 0.5; // fewer bulldozes
  if (gentle && r > 0.74 && r < 0.78) r = 0.6; // fewer line deletions
  if (gentle && r > 0.90) r = 0.55; // fewer stop demolitions
  if (r < 0.28) {
    // random road run
    const t = randTile(); const x = t % N, y = (t / N) | 0; const d = (R() * 4) | 0; const len = 2 + ((R() * 8) | 0);
    const tiles: number[] = [];
    for (let k = 0; k < len; k++) { const nx = x + DX[d] * k, ny = y + DY[d] * k; if (!inMap(nx, ny)) break; tiles.push(tileIdx(nx, ny)); }
    g.buildRoad(tiles, R() < 0.2 ? 2 : 1);
  } else if (r < 0.36) g.bulldoze(randTile());
  else if (r < 0.41) g.bulldoze(randRoad() >= 0 ? randRoad() : 0);
  else if (r < 0.48) { for (const d of w.districts) if (!d.unlocked) { g.unlockDistrict(d.index); break; } }
  else if (r < 0.58) { const a = randRoad(), b = randRoad(), c = randRoad(); if (a >= 0 && b >= 0 && c >= 0) g.createBusLine([a, b, c].filter((v, i, arr) => arr.indexOf(v) === i)); }
  else if (r < 0.64) { const m = FUZZ_MODES[(R() * FUZZ_MODES.length) | 0]; const a = randSpot(m), b = randSpot(m); if (a >= 0 && b >= 0) { const ts = R() < 0.4 ? [a, b, randSpot(m)].filter((v, i, arr) => v >= 0 && arr.indexOf(v) === i) : [a, b]; g.createLine(m, ts); } }
  else if (r < 0.70) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.addVehicle(l); }
  else if (r < 0.74) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.removeVehicle(l); }
  else if (r < 0.77) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.deleteLine(l); }
  else if (r < 0.80) { const s = g.transit.stops[(R() * g.transit.stops.length) | 0]; if (s) g.expandStop(s); }
  else if (r < 0.84) g.placePark(randTile());
  else if (r < 0.87) { const keys = ['toll', 'busLanes', 'stagger', 'remote', 'freeTransit'] as const; g.setPolicy(keys[(R() * 5) | 0], R() < 0.5); }
  else if (r < 0.90) { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) g.extendLine(l, randSpot(l.kind)); }
  else if (r < 0.93) g.bulldoze(w.stop[randTile()] >= 0 ? randTile() : randTile());
  else { const l = g.transit.lines[(R() * g.transit.lines.length) | 0]; if (l) { const s = l.stops[(R() * l.stops.length) | 0]; g.bulldoze(s.tile); } }
}
function check() {
  for (const v of g.traffic.vehicles) {
    if (!isFinite(v.x) || !isFinite(v.z) || !isFinite(v.ang)) throw new Error('NaN vehicle ' + v.id);
    if (v.i < 0 || v.i >= v.path.length) throw new Error('bad path index');
    if (!w.road[v.path[v.i]] && !v.dead) throw new Error(`vehicle ${v.id} on a non-road tile ${v.path[v.i]}`);
  }
  for (const [id, b] of g.city.buildings) if (w.bld[b.tile] !== id) throw new Error('building map mismatch');
  for (const p of g.city.persons) if (!p.home || p.home.residents.indexOf(p) < 0) throw new Error('person not in home');
  for (const s of g.transit.stops) if (w.stop[s.tile] !== s.id) throw new Error('stop map mismatch');
  for (const l of g.transit.lines) for (const s of l.stops) if (!g.transit.stopById.has(s.id)) throw new Error('line has dead stop');
  for (const l of g.transit.lines) {
    if (l.kind === 'bus' || l.kind === 'truck') continue;
    if (!l.poly || l.stopIdx.length !== l.stops.length || l.stopDist.length !== l.stops.length) throw new Error(`line ${l.name} geometry mismatch`);
    for (let k = 1; k < l.stopDist.length; k++) if (l.stopDist[k] < l.stopDist[k - 1] - 1e-6) throw new Error(`line ${l.name} stops out of order`);
    for (const c of l.vehicles) { if (!isFinite(c.d) || c.d < -0.01 || c.d > l.poly.length + 0.01) throw new Error(`carrier off its line ${l.name} d=${c.d} len=${l.poly.length}`); if (!isFinite(c.speed)) throw new Error('carrier NaN speed'); }
  }
  for (const p of g.city.persons) {
    if (p.dead) throw new Error('dead person in list');
    if (!g.city.personById.has(p.id)) throw new Error('person index mismatch');
    if (p.hh.members.indexOf(p) < 0) throw new Error('person not in household');
    for (const k of ['energy', 'hunger', 'fun', 'social', 'comfort'] as const) if (!(p.needs[k] >= 0 && p.needs[k] <= 1)) throw new Error('need out of range ' + k + ' ' + p.needs[k]);
    if (!isFinite(p.mood) || !isFinite(p.wallet) || !isFinite(p.sat)) throw new Error('person NaN');
    if (p.work && p.work.workers.indexOf(p) < 0 && p.work.students.indexOf(p) < 0) throw new Error('person not on staff list of ' + p.work.name);
    if (p.phase === 'ride' && (!p.ride || p.ride.passengers.indexOf(p) < 0)) throw new Error('rider not in a vehicle');
    if (p.stage === 'senior' && p.work && !p.work.special) throw new Error('retired person still has a job');
    const pos = g.city.positionOf(p);
    if (!isFinite(pos.x) || !isFinite(pos.z)) throw new Error('person position NaN');
  }
  for (const b of g.city.buildings.values()) { if (b.guests.some((q) => q.dead)) throw new Error('dead guest'); for (const q of b.residents) if (q.home !== b) throw new Error('resident home mismatch'); }
  for (const l of g.transit.lines) for (const c of l.vehicles) { if (!(c.cond >= 0 && c.cond <= 1.0001)) throw new Error('bad vehicle condition ' + c.cond); }
  if (g.loan < 0 || !isFinite(g.money)) throw new Error('bad money/loan');
  for (const b of g.city.buildings.values()) for (let i = 0; i < 3; i++) if (!(b.out[i] >= -1e-6 && b.stock[i] >= -1e-6) || !isFinite(b.out[i]) || !isFinite(b.stock[i])) throw new Error('bad cargo on ' + b.name);
  for (const l of g.transit.lines) for (const c of l.vehicles) if (c.load && (!(c.load.qty >= 0) || c.load.qty > c.cap + 0.01)) throw new Error('bad load ' + (c.load?.qty));
  for (const p of g.city.persons) if ((p.phase === 'wait') && p.stopRef && !g.transit.stopById.has(p.stopRef.id)) throw new Error('person waiting at a removed stop');
  for (let i = 0; i < N * N; i++) { const c = g.traffic.tileCars[i]; for (const v of c) if (v.dead) throw new Error('dead car in tile list'); }
}
const dt = 0.1;
const end = g.t + days * DAY;
let nextOp = g.t;
const t0 = Date.now();
try {
  while (g.t < end && !g.over) {
    if (process.env.WALL && Date.now() - t0 > +process.env.WALL * 1000) break;
    g.update(dt);
    g.stability = 100;
    if (g.t > nextOp) { nextOp = g.t + 0.8; for (let k = 0; k < 3; k++) { (globalThis as any).__last = ops; act(); } }
    if (process.env.PROG && ((g.t / dt) | 0) % 200 === 0) (await import('node:fs')).appendFileSync('/tmp/fuzz.log', `t ${g.t.toFixed(0)} ops ${ops} veh ${g.traffic.vehicles.length} last ${(globalThis as any).__lastop}\n`);
    if (((g.t / dt) | 0) % 40 === 0) check();
  }
  check();
  console.log(`ok seed ${seed}: ${ops} ops, day ${g.day}, pop ${g.pop}, lines ${g.transit.lines.length}, stops ${g.transit.stops.length}, ${(Date.now() - t0) / 1000}s`);
} catch (e) {
  console.log(`FAIL seed ${seed} at day ${g.day}: ${(e as Error).stack}`);
  process.exit(1);
}
