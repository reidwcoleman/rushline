// The game: owns the world, traffic, transit and city; handles commands, money, events and the stability meter.
import { World, N, DX, DY, tileIdx, tileX, tileY, inMap, DN, DS, distIdx } from './world.ts';
import { Traffic } from './traffic.ts';
import { Transit, WALK_R_BUS, WALK_R_METRO } from './transit.ts';
import { City, defaultPolicies, type Policies } from './city.ts';
import { mulberry32, clamp, type Rng } from './util.ts';
import { CITY_NAMES } from './names.ts';
import { DAY, dayOf, hourOf, type Ctx, type Building, type Stop, type Line } from './types.ts';

export const COST = {
  arena: 6000, street: 12, avenue: 38, upgrade: 28, bridge: 60, park: 140, busStop: 80, bus: 200, station: 1000, track: 70, trackWater: 60, train: 900,
  bulldoze: 25, expandBus: 220, expandStation: 600,
};
export const UPKEEP = { street: 0.7, avenue: 1.8, park: 4, busStop: 3, bus: 16, station: 55, track: 3, train: 70 };

export const MAX_LINES = 14;
export const UNLOCK = { avenue: 200, policies: 350, metro: 600, arena: 1600 };

export interface Cmd { ok: boolean; msg?: string; cost?: number }

export interface Goal { pop: number; reward: number; title: string }
export const GOALS: Goal[] = [
  { pop: 250, reward: 1500, title: 'Settlement' },
  { pop: 500, reward: 2500, title: 'Small town' },
  { pop: 900, reward: 3500, title: 'Town' },
  { pop: 1500, reward: 5000, title: 'Large town' },
  { pop: 2500, reward: 7500, title: 'Small city' },
  { pop: 4000, reward: 10000, title: 'City' },
  { pop: 6000, reward: 15000, title: 'Large city' },
  { pop: 9000, reward: 25000, title: 'Metropolis' },
  { pop: 13000, reward: 40000, title: 'Megacity' },
];

type Listener = (data: any) => void;

export class Game {
  readonly seed: number;
  world: World;
  traffic: Traffic;
  transit: Transit;
  city: City;
  ctx: Ctx;
  rand: Rng;
  private listeners = new Map<string, Listener[]>();
  t = 0;
  speed = 1;
  money = 6500;
  name: string;
  policies: Policies = defaultPolicies();
  over = false;
  overReason = '';
  // accounting
  dayIncome = 0;
  dayExpense = 0;
  lastIncome = 0;
  lastExpense = 0;
  taxRate = 1;
  incomeRate = 0;      // per second, smoothed
  expenseRate = 0;
  // stability
  stability = 100;
  crisis = { traffic: 0, transit: 0, unrest: 0, debt: 0, total: 0 };
  warned = { traffic: 0, transit: 0, unrest: 0 };
  // goals
  goalIdx = 0;
  bestPop = 0;
  // events
  rainUntil = 0;
  nextRain = 0;
  nextAccident = 0;
  nextFestival = 0;
  festival: { tile: number; until: number } | null = null;
  peakTraffic = 0;
  // history for charts
  history: { pop: number; sat: number; traffic: number }[] = [];
  private histT = 0;
  private slow = 0;
  private econT = 0;
  private stabT = 0;
  lastDay = 1;
  daysSurvived = 0;
  unlocked = { avenue: false, policies: false, metro: false, arena: false };
  match: { tile: number; start: number; end: number; announced: boolean; started: boolean } | null = null;
  nextMatchDay = 0;

  diff = 1;           // 0 relaxed, 1 standard, 2 rush

  constructor(seed = 1, opts: { start?: boolean; diff?: number } = {}) {
    this.seed = seed;
    this.diff = opts.diff ?? 1;
    this.rand = mulberry32(seed * 31 + 7);
    this.name = CITY_NAMES[seed % CITY_NAMES.length];
    this.world = new World(seed);
    this.ctx = { world: this.world, t: 0, rand: this.rand, emit: (type, data) => this.emit(type, data) };
    this.traffic = new Traffic(this.world);
    this.transit = new Transit(this.ctx, this.traffic);
    this.city = new City(this.ctx, this.traffic, this.transit);
    this.city.policies = this.policies;
    this.transit.hooks = {
      arrive: (p) => this.city.arrive(p),
      strand: (p) => this.city.strand(p),
      fare: (a) => this.earn(a, 'fare'),
      toast: (m, tone) => this.toast(m, tone),
      free: () => this.policies.freeTransit,
    };
    this.city.onFee = (a, why) => this.earn(a, why);
    if (this.diff === 0) this.money = 9000;
    if (this.diff === 2) this.money = 5200;
    this.city.growthBoost = [0.75, 1, 1.3][this.diff];
    this.t = DAY * 0.27;     // early morning of day 1
    this.ctx.t = this.t;
    this.nextRain = this.t + DAY * (2.2 + this.rand() * 2);
    this.nextAccident = this.t + DAY * 1.5;
    this.nextFestival = this.t + DAY * 5;
    if (opts.start !== false) this.seedTown();
  }

  // ---------------------------------------------------------------- events

  on(type: string, fn: Listener) {
    let a = this.listeners.get(type);
    if (!a) this.listeners.set(type, (a = []));
    a.push(fn);
    return () => { a!.splice(a!.indexOf(fn), 1); };
  }
  emit(type: string, data?: unknown) {
    const a = this.listeners.get(type);
    if (a) for (const f of a) f(data);
  }
  toast(msg: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info') {
    this.emit('toast', { msg, tone });
  }

  get hour() { return hourOf(this.t); }
  get day() { return dayOf(this.t); }
  get pop() { return this.city.stats.pop; }

  // ---------------------------------------------------------------- start

  private seedTown() {
    const w = this.world;
    // find a centre where a plus-shaped main street is mostly dry
    let best = { x: 20, y: 20, wet: 99 };
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const cx = 20 + dx, cy = 20 + dy;
      let wet = 0;
      for (let k = -7; k <= 7; k++) {
        if (w.water[tileIdx(cx + k, cy)]) wet++;
        if (w.water[tileIdx(cx, cy + k)]) wet++;
      }
      if (wet < best.wet) best = { x: cx, y: cy, wet };
    }
    const { x: cx, y: cy } = best;
    const lay = (x: number, y: number, k = 1) => {
      if (!inMap(x, y)) return;
      const i = tileIdx(x, y);
      if (w.isUnlocked(i)) { w.road[i] = k; w.tree[i] = 0; }
    };
    for (let k = -7; k <= 7; k++) { lay(cx + k, cy, k > -3 && k < 3 ? 2 : 1); lay(cx, cy + k, k > -3 && k < 3 ? 2 : 1); }
    // a small block grid around the centre
    for (let k = -5; k <= 5; k++) { lay(cx + k, cy - 4); lay(cx + k, cy + 4); lay(cx - 4, cy + k); lay(cx + 4, cy + k); }
    this.unlocked.avenue = false;
    w.version.roads++;
    this.city.refreshAccess();
    // houses and a few shops
    const spots: number[] = [];
    for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) {
      if (!inMap(x, y)) continue;
      const i = tileIdx(x, y);
      if (!w.buildable(i) || !w.isEmpty(i)) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inMap(nx, ny) && w.road[tileIdx(nx, ny)]) { spots.push(i); break; }
      }
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    let r = 0, c = 0, ind = 0;
    for (const i of spots) {
      if (r + c + ind >= 22) break;
      const x = tileX(i), y = tileY(i);
      const cen = Math.hypot(x - cx, y - cy);
      let kind: 'res' | 'com' | 'ind' = 'res';
      if (cen < 3.2 && c < 5) { kind = 'com'; c++; }
      else if (cen > 5 && ind < 3) { kind = 'ind'; ind++; }
      else r++;
      this.city.addBuilding(x, y, kind, kind === 'com' && cen < 2.2 && c < 3 ? 2 : 1);
    }
    // move people in
    for (const b of this.city.buildings.values()) {
      if (b.kind !== 'res') continue;
      const n = Math.max(2, Math.floor(b.cap * (0.6 + this.rand() * 0.4)));
      for (let k = 0; k < n; k++) this.city.createPerson(b);
    }
    for (const p of this.city.persons) this.city.assignJob(p);
    this.city.updateStats();
    this.updateUnlocks(true);
    this.emit('roadsChanged');
  }

  // ---------------------------------------------------------------- loop

  update(realDt: number) {
    if (this.over || this.speed === 0) return;
    let sim = Math.min(realDt, 0.1) * this.speed;
    while (sim > 1e-6) {
      const dt = Math.min(sim, 0.08);
      sim -= dt;
      this.step(dt);
    }
  }

  step(dt: number) {
    this.t += dt;
    this.ctx.t = this.t;
    const w = this.world;
    // accidents clear
    for (let i = 0; i < N * N; i++) if (w.blocked[i] > 0) { w.blocked[i] -= dt; if (w.blocked[i] <= 0) { w.blocked[i] = 0; this.emit('accidentClear', i); } }
    this.traffic.step(dt, (this.t < this.rainUntil ? 0.84 : 1) * (this.policies.busLanes ? 1 : 1));
    this.transit.step(dt);
    this.city.stability = this.stability;
    this.city.step(dt);
    this.econT += dt;
    if (this.econT >= 1) { this.economy(this.econT); this.econT = 0; }
    this.stabT += dt;
    if (this.stabT >= 1) { this.stability_(this.stabT); this.stabT = 0; }
    this.slow += dt;
    if (this.slow > 2) { this.slow = 0; this.events(); }
    this.histT += dt;
    if (this.histT > DAY / 24) {
      this.histT = 0;
      const s = this.city.stats;
      this.history.push({ pop: s.pop, sat: s.sat, traffic: this.traffic.trafficIndex });
      if (this.history.length > 200) this.history.shift();
    }
    const d = this.day;
    if (d !== this.lastDay) {
      this.lastDay = d;
      this.lastIncome = this.dayIncome; this.lastExpense = this.dayExpense;
      this.dayIncome = 0; this.dayExpense = 0;
      this.daysSurvived = d - 1;
      this.emit('dayEnd', d);
    }
  }

  // ---------------------------------------------------------------- money

  earn(a: number, why = '') {
    this.money += a;
    this.dayIncome += a;
    if (why === 'fare') this.fareAcc += a;
  }
  fareAcc = 0;
  spend(a: number) {
    this.money -= a;
    this.dayExpense += a;
  }

  private economy(dt: number) {
    const s = this.city.stats;
    // taxes per second: employed residents pay full, others a little; unhappy people evade
    let tax = 0;
    const scale = 1 / (1 + s.pop / 5500);
    for (const p of this.city.persons) tax += (p.work ? 0.036 : 0.008) * (0.55 + 0.45 * p.sat) * scale;
    tax *= this.taxRate * (this.policies.remote ? 0.97 : 1);
    this.money += tax * dt; this.dayIncome += tax * dt;
    // upkeep
    const w = this.world;
    let up = 0;
    for (let i = 0; i < N * N; i++) {
      if (w.road[i] === 1) up += UPKEEP.street;
      else if (w.road[i] === 2) up += UPKEEP.avenue;
      if (w.park[i]) up += UPKEEP.park;
    }
    for (const sp of this.transit.stops) up += sp.kind === 'bus' ? UPKEEP.busStop : UPKEEP.station;
    for (const l of this.transit.lines) {
      up += l.kind === 'bus' ? l.vehicles.length * UPKEEP.bus : l.vehicles.length * UPKEEP.train + l.tiles.length * UPKEEP.track;
    }
    if (this.policies.toll) up += 20;
    if (this.policies.busLanes) up += 30;
    if (this.policies.stagger) up += 25;
    if (this.policies.freeTransit) up += 0;
    if (this.policies.remote) up += 25;
    const perSec = up / DAY;
    this.money -= perSec * dt; this.dayExpense += perSec * dt;
    this.incomeRate += (tax + this.fareAcc / dt - this.incomeRate) * 0.1;
    this.fareAcc = 0;
    this.expenseRate += (perSec - this.expenseRate) * 0.1;
    void s;
    // goals
    if (this.goalIdx < GOALS.length && s.pop >= GOALS[this.goalIdx].pop) {
      const g = GOALS[this.goalIdx++];
      this.earn(g.reward);
      this.toast(`${g.title}: ${g.pop.toLocaleString()} residents. +$${g.reward.toLocaleString()}`, 'good');
      this.emit('milestone', g);
    }
    if (s.pop > this.bestPop) this.bestPop = s.pop;
    this.updateUnlocks();
  }

  private updateUnlocks(silent = false) {
    const p = this.bestPop = Math.max(this.bestPop, this.city.stats.pop);
    const u = this.unlocked;
    if (!u.avenue && p >= UNLOCK.avenue) { u.avenue = true; if (!silent) { this.toast('Avenues unlocked: wider roads that carry twice the cars.', 'good'); this.emit('unlock', 'avenue'); } }
    if (!u.policies && p >= UNLOCK.policies) { u.policies = true; if (!silent) { this.toast('City policies unlocked.', 'good'); this.emit('unlock', 'policies'); } }
    if (!u.arena && p >= UNLOCK.arena) { u.arena = true; if (!silent) { this.toast('Arena unlocked: match days pack the streets and pay well.', 'good'); this.emit('unlock', 'arena'); } }
    if (!u.metro && p >= UNLOCK.metro) { u.metro = true; if (!silent) { this.toast('Metro unlocked: elevated trains that skip traffic.', 'good'); this.emit('unlock', 'metro'); } }
  }

  // ---------------------------------------------------------------- stability

  private stability_(dt: number) {
    const tr = this.traffic, ts = this.transit, st = this.city.stats;
    const size = 5 + st.pop / 110;
    const jam = clamp(tr.gridlock / size);
    const slow = clamp((tr.trafficIndex - 0.45) / 0.4) * clamp(tr.loadedTiles / 12);
    const rawTraffic = Math.max(jam, slow * 0.9);
    const rawTransit = clamp(ts.overcrowded * 0.28 + ts.worstOver / 26 * 0.6);
    const rawUnrest = st.pop > 60 ? clamp((0.58 - st.sat) / 0.38) : 0;
    const debt = this.money < 0 ? clamp(-this.money / 2500) : 0;
    // smooth over ~10 s so a single bad minute does not count the same as a sustained one
    const a = 1 - Math.exp(-dt / 9);
    const cr = this.crisis;
    const traffic = cr.traffic + (rawTraffic - cr.traffic) * a;
    const transit = cr.transit + (rawTransit - cr.transit) * a;
    const unrest = cr.unrest + (rawUnrest - cr.unrest) * a;
    const total = 1 - (1 - traffic * 0.95) * (1 - transit * 0.9) * (1 - unrest * 0.8) * (1 - debt);
    this.crisis = { traffic, transit, unrest, debt, total };
    const grace = (this.day < 3 ? 0.25 : this.day < 5 ? 0.6 : 1) * [0.6, 1, 1.35][this.diff];
    let d: number;
    if (total > 0.33) d = -(total - 0.33) * 0.8 * grace;
    else d = (0.33 - total) * 1.1;
    this.stability = clamp(this.stability + d * dt, 0, 100);
    if (this.peakTraffic < traffic) this.peakTraffic = traffic;
    // warnings, at most one per category per ~half day
    const w = this.warned, t = this.t;
    if (traffic > 0.55 && t - w.traffic > DAY * 0.45) { w.traffic = t; this.toast('Gridlock is spreading. Add a road, an avenue or transit before it chokes the city.', 'bad'); this.emit('sfx', 'alert'); }
    if (transit > 0.45 && t - w.transit > DAY * 0.45) { w.transit = t; this.toast('A stop is overcrowded. Add vehicles or another line.', 'bad'); this.emit('sfx', 'alert'); }
    if (unrest > 0.5 && t - w.unrest > DAY * 0.6) { w.unrest = t; this.toast('Residents are fed up with their commutes and are starting to leave.', 'warn'); }
    this.city.stability = this.stability;
    if (this.stability <= 0 && !this.over) {
      this.over = true;
      this.overReason = traffic >= transit && traffic >= unrest ? 'Gridlock brought the city to a halt.' : transit >= unrest ? 'The transit system collapsed under the crowds.' : 'Residents gave up on the city.';
      this.emit('gameOver', { reason: this.overReason, days: this.day, pop: st.pop, best: this.bestPop });
    }
  }

  // ---------------------------------------------------------------- random events

  private events() {
    const t = this.t, w = this.world;
    if (t > this.nextRain) {
      this.rainUntil = t + DAY * (0.3 + this.rand() * 0.2);
      this.nextRain = this.rainUntil + DAY * (2.5 + this.rand() * 3);
      this.city.rain = true;
      this.emit('weather', 'rain');
      this.toast('Rain: roads are slower and more people want a ride.', 'info');
    }
    if (this.city.rain && t > this.rainUntil) { this.city.rain = false; this.emit('weather', 'clear'); }
    if (t > this.nextAccident && this.day >= 2) {
      this.nextAccident = t + DAY * (1.0 + this.rand() * 1.4);
      // choose a loaded road tile
      let best = -1, bl = 0.15;
      for (let k = 0; k < 60; k++) {
        const i = Math.floor(this.rand() * N * N);
        if (w.road[i] && !w.stop[i] && this.traffic.load[i] > bl) { bl = this.traffic.load[i]; best = i; }
      }
      if (best >= 0) {
        w.blocked[best] = 22 + this.rand() * 14;
        this.emit('accident', best);
        this.toast('Accident on a busy road. Traffic is rerouting.', 'warn');
        this.emit('sfx', 'alert');
      }
    }
    if (this.day >= 5 && t > this.nextFestival) {
      this.nextFestival = t + DAY * (4 + this.rand() * 3);
      const coms = [...this.city.buildings.values()].filter((b) => b.kind === 'com' && b.level >= 2);
      if (coms.length) {
        const b = coms[Math.floor(this.rand() * coms.length)];
        this.city.eventTile = b.tile;
        this.city.eventUntil = t + DAY * 0.28;
        this.festival = { tile: b.tile, until: this.city.eventUntil };
        this.emit('festival', b);
        this.toast('Street festival starting. Expect a crowd heading there.', 'info');
      }
    }
    // arena match days
    const arena = [...this.city.buildings.values()].find((b) => b.special === 'arena');
    if (arena) {
      const dayStart = Math.floor(t / DAY) * DAY;
      if (!this.match && this.day >= this.nextMatchDay && hourOf(t) >= 9 && hourOf(t) < 14.5) {
        this.match = { tile: arena.tile, start: dayStart + DAY * (18 / 24), end: dayStart + DAY * (19.6 / 24), announced: false, started: false };
        this.toast('Match day at the arena tonight. Crowds will head over from about 18:00.', 'info');
        this.match.announced = true;
      }
      const m = this.match;
      if (m) {
        if (!m.started && t >= m.start - DAY * 0.02) { m.started = true; this.city.matchTile = m.tile; this.city.matchUntil = m.end; this.emit('match', arena); this.toast('Kick-off soon. Thousands are on their way.', 'warn'); this.emit('sfx', 'alert'); }
        if (t > m.end + DAY * 0.2) { this.match = null; this.city.matchTile = -1; this.nextMatchDay = this.day + 2 + (this.rand() < 0.5 ? 1 : 0); this.emit('matchEnd'); }
      }
    } else if (this.match) { this.match = null; this.city.matchTile = -1; }
    if (this.festival && t > this.festival.until) { this.festival = null; this.city.eventTile = -1; this.emit('festivalEnd'); }
  }

  // ---------------------------------------------------------------- commands: roads, parks, bulldoze

  roadTileCost(i: number, level: number): number {
    const w = this.world;
    const cur = w.road[i];
    if (cur >= level) return 0;
    let c = cur === 0 ? (level === 2 ? COST.avenue : COST.street) : COST.upgrade;
    if (cur === 0 && w.water[i]) c += COST.bridge;
    return c;
  }

  canRoad(i: number, level: number): string | null {
    const w = this.world;
    if (!w.isUnlocked(i)) return 'locked';
    if (w.bld[i] >= 0) return 'building';
    if (w.park[i]) return 'park';
    if (w.stopKind[i] === 2) return 'station';
    if (w.road[i] >= level) return 'exists';
    return null;
  }

  previewRoad(tiles: number[], level: 1 | 2): { ok: boolean[]; cost: number; reason?: string } {
    const ok: boolean[] = [];
    let cost = 0;
    let reason: string | undefined;
    for (const i of tiles) {
      const r = this.canRoad(i, level);
      if (r === null) { ok.push(true); cost += this.roadTileCost(i, level); }
      else { ok.push(r === 'exists'); if (r === 'locked') reason = 'Unlock this district first.'; else if (r === 'building') reason ??= 'A building is in the way.'; else if (r === 'park') reason ??= 'Remove the park first.'; }
    }
    return { ok, cost, reason };
  }

  buildRoad(tiles: number[], level: 1 | 2): Cmd {
    if (level === 2 && !this.unlocked.avenue) return { ok: false, msg: 'Avenues unlock at ' + UNLOCK.avenue + ' residents.' };
    const w = this.world;
    const todo: number[] = [];
    let cost = 0;
    for (const i of tiles) if (this.canRoad(i, level) === null) { todo.push(i); cost += this.roadTileCost(i, level); }
    if (!todo.length) return { ok: false, msg: 'Nothing to build there.' };
    if (cost > this.money) return { ok: false, msg: 'Not enough money. Need $' + Math.ceil(cost) + '.', cost };
    for (const i of todo) {
      w.road[i] = Math.max(w.road[i], level);
      if (w.tree[i]) { w.tree[i] = 0; }
    }
    this.spend(cost);
    w.version.roads++;
    this.city.refreshAccess();
    this.emit('treesChanged');
    this.emit('roadsChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost };
  }

  placePark(i: number): Cmd {
    const w = this.world;
    if (!w.isUnlocked(i)) return { ok: false, msg: 'Unlock this district first.' };
    if (w.water[i] || !w.isEmpty(i) || w.rail[i]) return { ok: false, msg: 'That spot is taken.' };
    if (this.money < COST.park) return { ok: false, msg: 'Not enough money.' };
    w.park[i] = 1;
    w.tree[i] = 0;
    this.spend(COST.park);
    w.version.tiles++;
    this.city.markDirty();
    this.emit('parkChanged', i);
    this.emit('treesChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost: COST.park };
  }

  placeArena(i: number): Cmd {
    const w = this.world;
    if (!this.unlocked.arena) return { ok: false, msg: `The arena unlocks at ${UNLOCK.arena.toLocaleString()} residents.` };
    if ([...this.city.buildings.values()].some((b) => b.special === 'arena')) return { ok: false, msg: 'The city already has an arena.' };
    if (!w.isUnlocked(i) || w.water[i] || !w.isEmpty(i) || w.rail[i]) return { ok: false, msg: 'Pick an empty tile.' };
    const rf = this.city.roadFor({ x: tileX(i), y: tileY(i) });
    if (rf.tile < 0) return { ok: false, msg: 'The arena needs a road beside it.' };
    if (this.money < COST.arena) return { ok: false, msg: 'Not enough money.' };
    this.spend(COST.arena);
    this.city.addBuilding(tileX(i), tileY(i), 'com', 3, 'arena');
    w.version.tiles++;
    this.nextMatchDay = this.day + 1;
    this.emit('sfx', 'build');
    this.toast('Arena open. Match days draw big crowds, so get the transit ready.', 'good');
    return { ok: true, cost: COST.arena };
  }

  bulldoze(i: number): Cmd {
    const w = this.world;
    if (!w.isUnlocked(i)) return { ok: false, msg: 'Locked.' };
    if (w.bld[i] >= 0) {
      if (this.money < COST.bulldoze) return { ok: false, msg: 'Not enough money.' };
      const b = this.city.buildings.get(w.bld[i])!;
      this.spend(COST.bulldoze);
      this.city.removeBuilding(b);
      this.emit('sfx', 'demolish');
      return { ok: true, cost: COST.bulldoze };
    }
    if (w.stop[i] >= 0) {
      const s = this.transit.stopById.get(w.stop[i])!;
      if (s.kind === 'metro') {
        const n = s.lines.length;
        this.transit.removeStop(s);
        this.emit('sfx', 'demolish');
        return { ok: true, msg: n ? 'Station and its lines removed.' : 'Station removed.' };
      }
      this.transit.removeStop(s);
      this.emit('sfx', 'demolish');
      return { ok: true };
    }
    if (w.park[i]) {
      w.park[i] = 0;
      w.version.tiles++;
      this.emit('parkChanged', i);
      this.city.markDirty();
      this.emit('sfx', 'demolish');
      return { ok: true };
    }
    if (w.road[i]) {
      w.road[i] = 0;
      w.version.roads++;
      this.traffic.tileRemoved(i);
      this.city.refreshAccess();
      this.emit('roadsChanged');
      this.emit('sfx', 'demolish');
      return { ok: true };
    }
    return { ok: false, msg: 'Nothing here.' };
  }

  unlockDistrict(d: number): Cmd {
    const info = this.world.districts[d];
    if (info.unlocked) return { ok: false, msg: 'Already yours.' };
    if (this.money < info.cost) return { ok: false, msg: 'Not enough money. Need $' + info.cost.toLocaleString() + '.' };
    // must touch an unlocked district
    let touches = false;
    for (let k = 0; k < 4; k++) {
      const c = info.col + DX[k], r = info.row + DY[k];
      if (c >= 0 && r >= 0 && c < DN && r < DN && this.world.districts[r * DN + c].unlocked) touches = true;
    }
    if (!touches) return { ok: false, msg: 'Expand next to land you already own.' };
    this.spend(info.cost);
    this.world.setUnlocked(d, true);
    this.city.markDirty();
    this.emit('unlock', 'district');
    this.emit('districtUnlocked', d);
    this.emit('sfx', 'unlock');
    this.toast('New land opened up. The city will start building there.', 'good');
    return { ok: true, cost: info.cost };
  }

  // ---------------------------------------------------------------- commands: transit

  quoteBus(tiles: number[]): { cost: number; ok: boolean; reason?: string } {
    const w = this.world;
    let cost = COST.bus;
    for (const t of tiles) {
      if (!w.road[t]) return { cost, ok: false, reason: 'Stops go on roads.' };
      if (w.stop[t] < 0) cost += COST.busStop;
      else if (w.stopKind[t] === 2) return { cost, ok: false, reason: 'That is a metro station.' };
    }
    for (let k = 0; k + 1 < tiles.length; k++) {
      if (tiles[k] === tiles[k + 1]) return { cost, ok: false, reason: 'Pick a different stop.' };
      if (!this.traffic.router.find(tiles[k], tiles[k + 1])) return { cost, ok: false, reason: 'Those stops are not connected by road.' };
    }
    return { cost, ok: true };
  }

  createBusLine(tiles: number[]): Cmd & { line?: Line } {
    if (tiles.length < 2) return { ok: false, msg: 'A line needs at least two stops.' };
    if (this.transit.lines.length >= MAX_LINES) return { ok: false, msg: `That is the most lines the network can run (${MAX_LINES}). Delete one first.` };
    const q = this.quoteBus(tiles);
    if (!q.ok) return { ok: false, msg: q.reason };
    if (q.cost > this.money) return { ok: false, msg: 'Not enough money. Need $' + q.cost + '.' };
    const line = this.transit.createBusLine(tiles);
    if (!line) return { ok: false, msg: 'Could not route that line.' };
    this.spend(q.cost);
    this.emit('sfx', 'line');
    return { ok: true, cost: q.cost, line };
  }

  /** the tiles a metro route would occupy, for previews and quotes */
  quoteMetro(tiles: number[]): { cost: number; ok: boolean; reason?: string; track: number[] } {
    const w = this.world;
    let cost = COST.train;
    for (const t of tiles) {
      if (w.water[t] || w.bld[t] >= 0) return { cost, ok: false, reason: 'Stations need open ground or a road.', track: [] };
      if (!w.isUnlocked(t)) return { cost, ok: false, reason: 'Unlock that district first.', track: [] };
      if (w.stopKind[t] === 1) return { cost, ok: false, reason: 'That tile has a bus stop.', track: [] };
      if (w.stop[t] < 0) cost += COST.station;
    }
    const plan = this.transit.planMetro(tiles, this.transit.nextLineId);
    if (!plan.ok) return { cost, ok: false, reason: plan.reason, track: plan.tiles };
    for (const t of plan.tiles) {
      if (w.stopKind[t] === 2 && !tiles.includes(t)) continue;
      cost += COST.track + (w.water[t] ? COST.trackWater : 0);
    }
    return { cost, ok: true, track: plan.tiles };
  }

  createMetroLine(tiles: number[]): Cmd & { line?: Line } {
    if (!this.unlocked.metro) return { ok: false, msg: 'Metro unlocks at ' + UNLOCK.metro + ' residents.' };
    if (tiles.length < 2) return { ok: false, msg: 'A line needs at least two stations.' };
    if (this.transit.lines.length >= MAX_LINES) return { ok: false, msg: `That is the most lines the network can run (${MAX_LINES}). Delete one first.` };
    const q = this.quoteMetro(tiles);
    if (!q.ok) return { ok: false, msg: q.reason };
    if (q.cost > this.money) return { ok: false, msg: 'Not enough money. Need $' + q.cost.toLocaleString() + '.' };
    const line = this.transit.createMetroLine(tiles);
    if (!line) return { ok: false, msg: 'No room for that track.' };
    this.spend(q.cost);
    this.emit('sfx', 'line');
    return { ok: true, cost: q.cost, line };
  }

  addVehicle(line: Line): Cmd {
    const c = this.transit.vehicleCost(line);
    if (line.vehicles.length >= this.transit.maxVehicles(line)) return { ok: false, msg: 'This line is at its vehicle limit.' };
    if (this.money < c) return { ok: false, msg: 'Not enough money.' };
    if (!this.transit.addVehicle(line)) return { ok: false, msg: 'No room.' };
    this.spend(c);
    this.emit('linesChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost: c };
  }
  removeVehicle(line: Line): Cmd {
    if (!this.transit.removeVehicle(line)) return { ok: false, msg: 'A line needs at least one vehicle.' };
    this.earn(this.transit.vehicleCost(line) * 0.5);
    this.emit('linesChanged');
    return { ok: true };
  }
  deleteLine(line: Line): Cmd {
    const refund = Math.round((line.kind === 'bus' ? 90 : 500) + line.vehicles.length * this.transit.vehicleCost(line) * 0.4);
    this.transit.deleteLine(line);
    this.earn(refund);
    this.emit('sfx', 'demolish');
    return { ok: true, cost: -refund };
  }
  expandStop(s: Stop): Cmd {
    const c = s.kind === 'bus' ? COST.expandBus : COST.expandStation;
    if (s.cap >= (s.kind === 'bus' ? 48 : 150)) return { ok: false, msg: 'Fully expanded.' };
    if (this.money < c) return { ok: false, msg: 'Not enough money.' };
    this.spend(c);
    s.cap = Math.round(s.cap * 1.5);
    this.emit('stopsChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost: c };
  }

  setPolicy(k: keyof Policies, v: boolean): Cmd {
    if (!this.unlocked.policies) return { ok: false, msg: 'Policies unlock at ' + UNLOCK.policies + ' residents.' };
    this.policies[k] = v;
    this.city.policies = this.policies;
    if (k === 'stagger') {
      // re-roll everyone's start time
      const sd = v ? 1.9 : 0.8;
      for (const p of this.city.persons) {
        const start = clamp(8.0 + (this.rand() + this.rand() + this.rand() - 1.5) / 1.5 * sd * 1.6, 5.3, 11);
        p.workStart = start - 1 / 12; p.workEnd = start + 8.2 + this.rand() * 1.4;
      }
    }
    if (k === 'busLanes') this.traffic.busLanes = v;
    this.emit('policy', k);
    this.emit('sfx', 'click');
    return { ok: true };
  }

  // ---------------------------------------------------------------- queries

  stopCatchment(kind: 'bus' | 'metro') { return kind === 'bus' ? WALK_R_BUS : WALK_R_METRO; }

  buildingAt(i: number): Building | null {
    const id = this.world.bld[i];
    return id >= 0 ? this.city.buildings.get(id) ?? null : null;
  }
  districtOf(i: number) { return distIdx(i); }
  districtSize() { return DS; }
}

// ------------------------------------------------------------------ save / load

export interface SaveData {
  v: 1; seed: number; t: number; money: number; name: string; stability: number; goalIdx: number; bestPop: number;
  policies: Policies; districts: number[]; roads: number[]; parks: number[];
  buildings: number[][]; stops: [number, number, string, number][]; lines: { kind: 'bus' | 'metro'; tiles: number[]; color: number; name: string; veh: number }[];
  daysSurvived: number; dayIncome: number; peak: number; diff?: number;
}

export function serialize(g: Game): SaveData {
  const w = g.world;
  const roads: number[] = [], parks: number[] = [];
  for (let i = 0; i < N * N; i++) { if (w.road[i]) roads.push(i, w.road[i]); if (w.park[i]) parks.push(i); }
  const code = { res: 0, com: 1, ind: 2 } as const;
  const buildings = [...g.city.buildings.values()].map((b) => [b.x, b.y, b.special ? 3 : code[b.kind], b.level, b.variant, b.rot, b.residents.length]);
  const stops = g.transit.stops.map((s) => [s.tile, s.kind === 'bus' ? 0 : 1, s.name, s.cap] as [number, number, string, number]);
  const lines = g.transit.lines.map((l) => ({ kind: l.kind, tiles: l.stops.map((s) => s.tile), color: l.color, name: l.name, veh: l.vehicles.length }));
  return {
    v: 1, seed: g.seed, t: g.t, money: g.money, name: g.name, stability: g.stability, goalIdx: g.goalIdx, bestPop: g.bestPop,
    policies: { ...g.policies }, districts: w.districts.filter((d) => d.unlocked).map((d) => d.index), roads, parks, buildings, stops, lines,
    daysSurvived: g.daysSurvived, dayIncome: g.dayIncome, peak: g.peakTraffic, diff: g.diff,
  };
}

export function restore(d: SaveData): Game {
  const g = new Game(d.seed, { start: false, diff: d.diff ?? 1 });
  const w = g.world;
  g.t = d.t; g.ctx.t = d.t; g.money = d.money; g.name = d.name; g.stability = d.stability; g.goalIdx = d.goalIdx; g.bestPop = d.bestPop;
  g.lastDay = dayOf(d.t);
  Object.assign(g.policies, d.policies);
  g.traffic.busLanes = !!g.policies.busLanes;
  for (const dist of w.districts) w.setUnlocked(dist.index, d.districts.includes(dist.index));
  for (let k = 0; k < d.roads.length; k += 2) { w.road[d.roads[k]] = d.roads[k + 1]; w.tree[d.roads[k]] = 0; }
  for (const p of d.parks) { w.park[p] = 1; w.tree[p] = 0; }
  w.version.roads++;
  g.city.refreshAccess();
  const kinds = ['res', 'com', 'ind'] as const;
  for (const [x, y, k, level, variant, rot, res] of d.buildings) {
    const b = k === 3 ? g.city.addBuilding(x, y, 'com', 3, 'arena') : g.city.addBuilding(x, y, kinds[k], level);
    b.variant = variant; b.rot = rot; b.born = d.t - 200; b.lastLevel = d.t - 100;
    for (let i = 0; i < res; i++) g.city.createPerson(b);
  }
  for (const p of g.city.persons) g.city.assignJob(p);
  for (const [tile, k, name, cap] of d.stops) { const s = g.transit.addStop(tile, k === 0 ? 'bus' : 'metro', name); s.cap = cap; }
  for (const l of d.lines) {
    const line = l.kind === 'bus' ? g.transit.createBusLine(l.tiles) : g.transit.createMetroLine(l.tiles);
    if (!line) continue;
    line.color = l.color; line.name = l.name;
    while (line.vehicles.length < l.veh) if (!g.transit.addVehicle(line)) break;
  }
  g.city.updateStats();
  g.unlocked.avenue = g.unlocked.policies = g.unlocked.metro = g.unlocked.arena = false;
  (g as any).updateUnlocks(true);
  g.daysSurvived = d.daysSurvived;
  g.emit('roadsChanged');
  return g;
}
