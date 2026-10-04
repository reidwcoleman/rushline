// The game: owns the world, traffic, transit and city; handles commands, money, events and the stability meter.
import { World, N, DX, DY, tileIdx, tileX, tileY, inMap, DN, DS, distIdx, wx, wz } from './world.ts';
import { Traffic } from './traffic.ts';
import { Transit } from './transit.ts';
import { MODES, MODE_ORDER, isSolidCode, isRoadMode, isCargoMode, type Mode } from './modes.ts';
import { CARGO_INFO, CARGO_LIST, FACILITY, isIndustry, room } from './industry.ts';
import { advise, autoLine, type Advice } from './advisor.ts';
import { City, defaultPolicies, type Policies } from './city.ts';
import { mulberry32, clamp, type Rng } from './util.ts';
import { CITY_NAMES } from './names.ts';
import { feel, moodOf, TRAITS } from './people.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { DAY, dayOf, hourOf, type Ctx, type Building, type Stop, type Line, type Person, type Household, type Carrier } from './types.ts';

export const COST = {
  arena: 6000, street: 12, avenue: 38, upgrade: 28, bridge: 60, park: 140, busStop: 80, bus: 200, station: 1000, track: 70, trackWater: 60, train: 900,
  bulldoze: 25, expandBus: 220, expandStation: 600,
};
export const UPKEEP = { street: 0.7, avenue: 1.8, park: 4, school: 22, clinic: 30, airport: 150 };
export const SERVICE = {
  school: { cost: 3800, unlock: 260, label: 'School', tag: 'Pupils walk or ride in every morning. Families want one close.' },
  clinic: { cost: 4800, unlock: 520, label: 'Clinic', tag: 'Keeps seniors healthy and comfortable. Check-ups send people across town.' },
  airport: { cost: 15000, unlock: 2200, label: 'Airport', tag: 'A runway and terminal on three tiles. Planes land all day; it pays for every flight and draws crowds.' },
} as const;
export type ServiceKind = keyof typeof SERVICE;

export const MAX_LINES = 14;
export const UNLOCK = { avenue: 200, policies: 350, metro: MODES.metro.unlock, tram: MODES.tram.unlock, ferry: MODES.ferry.unlock, gondola: MODES.gondola.unlock, arena: 1600, school: SERVICE.school.unlock, clinic: SERVICE.clinic.unlock, airport: SERVICE.airport.unlock, truck: MODES.truck.unlock, freight: MODES.freight.unlock };

export interface Cmd { ok: boolean; msg?: string; cost?: number }

export interface DayBook { day: number; inc: Record<string, number>; exp: Record<string, number> }
export const RESEARCH_COST = [2600, 6200, 14500];
export const RESEARCH_DAYS = [1.6, 2.6, 4];
export const MODE_RESEARCH_MUL: Record<Mode, number> = { bus: 1, tram: 1.3, metro: 1.8, ferry: 1.2, gondola: 1.1, truck: 1.1, freight: 1.7 };
export const FARE_STEPS = [0, 0.5, 1, 1.5, 2.2];
export const researchCost = (mode: Mode, lvl: number) => Math.round(RESEARCH_COST[lvl] * MODE_RESEARCH_MUL[mode]);
export interface Contract {
  id: number; kind: 'haul' | 'ride' | 'export';
  title: string; desc: string;
  target: number; progress: number; reward: number;
  cargo?: number; mode?: Mode;
  state: 'offer' | 'active' | 'done' | 'failed';
  until: number;          // offers vanish, active contracts expire
  last: number;           // for deltas
}
export const loanLimit = (bestPop: number) => Math.min(90000, Math.round((3000 + bestPop * 9) / 500) * 500);

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
  book: DayBook = { day: 1, inc: {}, exp: {} };
  bookHist: DayBook[] = [];
  loan = 0;
  maint = 1;                       // 0 skimp, 1 standard, 2 thorough
  autoRenew = false;
  research: Record<Mode, number> = { bus: 0, tram: 0, metro: 0, ferry: 0, gondola: 0, truck: 0, freight: 0 };
  project: { mode: Mode; lvl: number; done: number; start: number } | null = null;
  breakdowns = 0;
  achieved = new Set<string>();
  everBorrowed = false;
  private achT = 0;
  flightAt = new Map<number, number>();
  flights = 0;
  contracts: Contract[] = [];
  contractsDone = 0;
  private nextContract = 1;
  delivered = [0, 0, 0];
  exported = 0;
  private lastBreak = -999;
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
  unlocked = { avenue: false, policies: false, metro: false, tram: false, ferry: false, gondola: false, arena: false, school: false, clinic: false, airport: false, truck: false, freight: false };
  match: { tile: number; start: number; end: number; announced: boolean; started: boolean } | null = null;
  nextMatchDay = 0;

  diff = 0;           // 0 relaxed, 1 standard, 2 rush
  /** assistants: buy vehicles for crowded lines, and surface one-click advice */
  autoFleet = true;
  advisorOn = true;
  advice: Advice[] = [];
  dismissed = new Set<string>();
  private adviceT = 0;
  private fleetT = 0;
  private renewT = 0;
  autopilotLog = 0;

  constructor(seed = 1, opts: { start?: boolean; diff?: number } = {}) {
    this.seed = seed;
    this.diff = opts.diff ?? 0;
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
      maint: () => this.maint,
      level: (m) => this.research[m] ?? 0,
      spend: (a, why) => this.spend(a, why),
      breakdown: (c, x, z) => this.onBreakdown(c, x, z),
      sites: (x, z) => this.city.sitesNear(x, z),
      cargoPay: (a, _l, idx, q, term) => { this.earn(a, 'cargo'); this.delivered[idx] += q; if (term) this.exported += q; },
    };
    this.city.onFee = (a, why) => this.earn(a, why);
    this.city.cleanLevel = (m) => this.research[m] ?? 0;
    this.money = [14000, 9500, 6500][this.diff];
    this.city.growthBoost = [0.72, 0.92, 1.25][this.diff];
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
      this.city.fillHome(b, n);
    }
    for (const p of this.city.persons) this.city.occupy(p);
    this.city.spawnIndustries(cx, cy);
    for (const p of this.city.persons) if (!p.work) this.city.occupy(p);
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
      this.closeBooks();
      this.daysSurvived = d - 1;
      this.emit('dayEnd', d);
    }
  }

  // ---------------------------------------------------------------- company

  private closeBooks() {
    // the day's interest, lines settle their day, then a fresh page
    if (this.loan > 0) this.spend(Math.round(this.loan * 0.007), 'interest');
    this.offerContracts();
    const imp = this.city.takeImports();
    if (imp > 0.5) this.spend(imp * 0.55, 'imports');
    for (const l of this.transit.lines) {
      l.hist.push({ rev: l.dayRev, cost: l.dayCost });
      if (l.hist.length > 7) l.hist.shift();
      l.dayRev = 0; l.dayCost = 0;
    }
    this.bookHist.push(this.book);
    if (this.bookHist.length > 30) this.bookHist.shift();
    this.book = { day: this.day, inc: {}, exp: {} };
    // research
    const pr = this.project;
    if (pr && this.t >= pr.done) {
      this.research[pr.mode] = pr.lvl + 1;
      this.project = null;
      this.toast(`${MODES[pr.mode].label} research finished: ${MODES[pr.mode].models[pr.lvl + 1]}. New ${MODES[pr.mode].vehicles} are bigger and more reliable.`, 'good');
      this.emit('sfx', 'unlock');
      this.emit('research', pr.mode);
    }
  }

  /** what the whole operation is worth */
  assets(): number {
    let a = 0;
    for (const l of this.transit.lines) {
      const m = MODES[l.kind];
      for (const c of l.vehicles) a += this.transit.vehicleCost(l) * 0.5 * (0.4 + 0.6 * c.cond);
      a += (l.kind === 'gondola' ? this.transit.lineLength(l) : l.tiles.length) * m.trackCost * 0.5;
    }
    for (const s of this.transit.stops) a += MODES[s.kind].stopCost * 0.6;
    return a;
  }
  netWorth() { return this.money - this.loan + this.assets(); }
  loanLimit() { return loanLimit(this.bestPop); }

  takeLoan(amount: number): Cmd {
    const room = this.loanLimit() - this.loan;
    if (room < 500) return { ok: false, msg: 'The bank will not lend you more right now.' };
    const a = Math.min(amount, room);
    this.loan += a; this.money += a; this.everBorrowed = true;
    this.emit('sfx', 'unlock');
    return { ok: true, cost: a };
  }
  repayLoan(amount: number): Cmd {
    const a = Math.min(amount, this.loan, Math.max(0, this.money));
    if (a < 1) return { ok: false, msg: this.loan ? 'Not enough cash to repay.' : 'No loan to repay.' };
    this.loan -= a; this.money -= a;
    this.emit('sfx', 'click');
    return { ok: true, cost: a };
  }

  setFare(line: Line, mul: number): Cmd {
    line.fareMul = mul;
    this.emit('linesChanged');
    this.emit('sfx', 'click');
    return { ok: true };
  }
  setMaintenance(level: number) { this.maint = Math.max(0, Math.min(2, level)); this.emit('sfx', 'click'); this.emit('policy', 'maint'); }

  startResearch(mode: Mode): Cmd {
    if (this.project) return { ok: false, msg: 'The lab is already working on something.' };
    const lvl = this.research[mode];
    if (lvl >= 3) return { ok: false, msg: `${MODES[mode].label} is fully researched.` };
    if (this.bestPop < 300) return { ok: false, msg: 'Research opens at 300 residents.' };
    const cost = researchCost(mode, lvl);
    if (this.money < cost) return { ok: false, msg: 'Not enough money. Need $' + cost.toLocaleString() + '.' };
    this.spend(cost, 'research');
    this.project = { mode, lvl, start: this.t, done: this.t + DAY * RESEARCH_DAYS[lvl] };
    this.emit('sfx', 'build');
    this.emit('research', mode);
    return { ok: true, cost };
  }

  renewCost(c: Carrier) { return Math.round(this.transit.vehicleCost(c.line) * 0.55); }
  renewVehicle(c: Carrier): Cmd {
    const cost = this.renewCost(c);
    if (this.money < cost) return { ok: false, msg: 'Not enough money.' };
    this.spend(cost, 'vehicles');
    this.transit.renew(c);
    this.emit('linesChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost };
  }
  /** swap every worn or old-model vehicle on a line for the current generation */
  renewLine(line: Line, onlyWorn = true): Cmd {
    let n = 0, total = 0;
    for (const c of line.vehicles) {
      const old = this.transit.ageDays(c) > MODES[line.kind].life || c.cond < 0.5 || c.lvl < this.research[line.kind];
      if (onlyWorn && !old) continue;
      const r = this.renewVehicle(c);
      if (!r.ok) break;
      n++; total += r.cost ?? 0;
    }
    return n ? { ok: true, cost: total, msg: `Renewed ${n} ${n === 1 ? MODES[line.kind].vehicle : MODES[line.kind].vehicles}.` } : { ok: false, msg: 'Nothing needs renewing.' };
  }

  private onBreakdown(c: Carrier, x: number, z: number) {
    this.breakdowns++;
    this.emit('breakdown', { x, z, kind: c.line.kind });
    if (this.t - this.lastBreak > DAY * 0.4) {
      this.lastBreak = this.t;
      this.toast(`A ${MODES[c.line.kind].vehicle} on ${c.line.name} broke down. Renew old ${MODES[c.line.kind].vehicles} or service them more.`, 'warn');
    }
  }

  // ---------------------------------------------------------------- contracts

  private contractSource(c: Contract): number {
    if (c.kind === 'haul') return this.delivered[c.cargo!];
    if (c.kind === 'export') return this.exported;
    let n = 0;
    for (const l of this.transit.lines) if (l.kind === c.mode) n += l.boardings;
    return n + this.retiredBoard[c.mode!];
  }
  retiredBoard: Record<Mode, number> = { bus: 0, tram: 0, metro: 0, ferry: 0, gondola: 0, truck: 0, freight: 0 };

  private offerContracts() {
    const t = this.t, r = this.rand;
    this.contracts = this.contracts.filter((c) => !(c.state === 'offer' && t > c.until) && !((c.state === 'done' || c.state === 'failed') && t > c.until));
    const offers = this.contracts.filter((c) => c.state === 'offer').length;
    if (offers >= 3 || this.bestPop < 250) return;
    const kinds: Contract['kind'][] = ['ride'];
    if (this.unlocked.truck) kinds.push('haul', 'haul', 'export');
    const k = kinds[Math.floor(r() * kinds.length)];
    const scale = 1 + this.bestPop / 3500;
    const id = this.nextContract++;
    const have = (m: Mode) => this.transit.lines.some((l) => l.kind === m);
    if (k === 'ride') {
      const modes = MODE_ORDER.filter((m) => m === 'bus' ? true : this.unlocked[m as keyof Game['unlocked']]);
      const mode = modes[Math.floor(r() * modes.length)];
      const target = Math.round((160 + r() * 260) * scale / 10) * 10;
      const reward = Math.round(target * MODES[mode].fare * 9 / 50) * 50 + 400;
      this.contracts.push({ id, kind: 'ride', mode, title: `Carry ${target} riders by ${MODES[mode].label.toLowerCase()}`, desc: have(mode) ? 'Every boarding on your lines counts.' : `You have no ${MODES[mode].label.toLowerCase()} line yet. Build one to take this.`, target, progress: 0, reward, state: 'offer', until: t + DAY * 3, last: 0 });
    } else if (k === 'haul') {
      const cargo = Math.floor(r() * 3);
      const target = Math.round((60 + r() * 100) * scale / 10) * 10;
      const reward = Math.round(target * CARGO_INFO[CARGO_LIST[cargo]].rate * 22 / 50) * 50 + 500;
      this.contracts.push({ id, kind: 'haul', cargo, title: `Deliver ${target} units of ${CARGO_INFO[CARGO_LIST[cargo]].label.toLowerCase()}`, desc: 'Count every unit that reaches a shop, a factory or the terminal.', target, progress: 0, reward, state: 'offer', until: t + DAY * 3, last: 0 });
    } else {
      const target = Math.round((50 + r() * 80) * scale / 10) * 10;
      const reward = Math.round(target * 1.15 * 22 / 50) * 50 + 600;
      this.contracts.push({ id, kind: 'export', title: `Export ${target} units through the terminal`, desc: 'Haul anything to a cargo terminal. It pays a premium.', target, progress: 0, reward, state: 'offer', until: t + DAY * 3, last: 0 });
    }
  }

  acceptContract(id: number): Cmd {
    const c = this.contracts.find((x) => x.id === id);
    if (!c || c.state !== 'offer') return { ok: false, msg: 'That offer is gone.' };
    if (this.contracts.filter((x) => x.state === 'active').length >= 3) return { ok: false, msg: 'You can run three contracts at a time.' };
    c.state = 'active'; c.until = this.t + DAY * (c.kind === 'ride' ? 5 : 4); c.last = this.contractSource(c); c.progress = 0;
    this.emit('sfx', 'click');
    return { ok: true };
  }
  declineContract(id: number) { this.contracts = this.contracts.filter((c) => c.id !== id); }

  /** planes: every airport sends and receives flights, more when the terminal is busy */
  private flightTick() {
    for (const b of this.city.buildings.values()) {
      if (b.special !== 'airport') continue;
      let at = this.flightAt.get(b.id);
      if (at === undefined) { at = this.t + 8; this.flightAt.set(b.id, at); }
      if (this.t < at) continue;
      const staff = Math.min(1, 0.4 + b.workers.length / b.cap * 0.6);
      const pax = Math.round((22 + b.guests.length * 2.6) * staff + this.rand() * 12);
      const arriving = this.flights % 2 === 0;
      this.flights++;
      this.earn(pax * 6.5, 'air');
      this.emit('flight', { id: b.id, pax, arriving, x: wx(b.x), z: wz(b.y), rot: b.rotFoot, foot: b.foot });
      this.flightAt.set(b.id, this.t + DAY / (5 + Math.min(5, b.guests.length / 5)) * (0.8 + this.rand() * 0.4));
    }
  }

  private achieveTick() {
    for (const a of ACHIEVEMENTS) {
      if (this.achieved.has(a.id) || !a.test(this)) continue;
      this.achieved.add(a.id);
      this.toast(`Achievement: ${a.title}. ${a.desc}`, 'good');
      this.emit('sfx', 'milestone');
      this.emit('achievement', a);
    }
  }

  private contractTick() {
    for (const c of this.contracts) {
      if (c.state !== 'active') continue;
      const src = this.contractSource(c);
      if (src > c.last) c.progress += src - c.last;
      c.last = src;
      if (c.progress >= c.target) {
        c.state = 'done'; c.until = this.t + DAY * 1.5;
        this.earn(c.reward, 'contracts'); this.contractsDone++;
        this.toast(`Contract complete: ${c.title}. +$${c.reward.toLocaleString()}`, 'good');
        this.emit('sfx', 'milestone'); this.emit('contract', c);
      } else if (this.t > c.until) {
        c.state = 'failed'; c.until = this.t + DAY * 1.5;
        this.toast(`Contract missed: ${c.title}. No penalty, but the client moved on.`, 'warn');
      }
    }
  }

  // ---------------------------------------------------------------- money

  earn(a: number, why = '') {
    this.money += a;
    this.dayIncome += a;
    if (why === 'fare') this.fareAcc += a;
    const cat = why === 'fare' ? 'fares' : why === 'toll' || why === 'shopping' || why === 'match' ? 'fees' : why === 'tax' ? 'taxes' : why || 'other';
    this.book.inc[cat] = (this.book.inc[cat] ?? 0) + a;
  }
  fareAcc = 0;
  spend(a: number, why = 'build') {
    this.money -= a;
    this.dayExpense += a;
    this.book.exp[why] = (this.book.exp[why] ?? 0) + a;
  }

  private economy(dt: number) {
    const s = this.city.stats;
    // taxes per second: employed residents pay full, others a little; unhappy people evade
    let tax = 0;
    const scale = 1 / (1 + s.pop / 5500);
    for (const p of this.city.persons) tax += (p.stage === 'adult' ? (p.work ? 0.0026 * p.wage : 0.008) : 0.004) * (0.55 + 0.45 * feel(p)) * scale;
    tax *= this.taxRate * (this.policies.remote ? 0.97 : 1);
    this.money += tax * dt; this.dayIncome += tax * dt;
    this.book.inc.taxes = (this.book.inc.taxes ?? 0) + tax * dt;
    // upkeep
    const w = this.world;
    let up = 0;
    for (let i = 0; i < N * N; i++) {
      if (w.road[i] === 1) up += UPKEEP.street;
      else if (w.road[i] === 2) up += UPKEEP.avenue;
      if (w.park[i]) up += UPKEEP.park;
    }
    for (const sp of this.transit.stops) up += MODES[sp.kind].upStop;
    const mf = [0.75, 1, 1.35][this.maint];
    for (const l of this.transit.lines) {
      const m = MODES[l.kind];
      const lc = (l.vehicles.length * m.upVeh * mf + (l.kind === 'gondola' ? this.transit.lineLength(l) : l.tiles.length) * m.upTrack) * (1 + 0.1 * this.research[l.kind]);
      l.dayCost += lc / DAY * dt;
      up += lc;
    }
    for (const b of this.city.buildings.values()) if (b.special === 'school') up += UPKEEP.school; else if (b.special === 'clinic') up += UPKEEP.clinic; else if (b.special === 'airport') up += UPKEEP.airport;
    if (this.policies.toll) up += 20;
    if (this.policies.busLanes) up += 30;
    if (this.policies.stagger) up += 25;
    if (this.policies.freeTransit) up += 0;
    if (this.policies.remote) up += 25;
    const perSec = up / DAY;
    this.money -= perSec * dt; this.dayExpense += perSec * dt;
    this.book.exp.upkeep = (this.book.exp.upkeep ?? 0) + perSec * dt;
    this.incomeRate += (tax + this.fareAcc / dt - this.incomeRate) * 0.1;
    this.fareAcc = 0;
    this.expenseRate += (perSec - this.expenseRate) * 0.1;
    void s;
    // goals
    if (this.goalIdx < GOALS.length && s.pop >= GOALS[this.goalIdx].pop) {
      const g = GOALS[this.goalIdx++];
      this.earn(g.reward, 'goals');
      this.toast(`${g.title}: ${g.pop.toLocaleString()} residents. +$${g.reward.toLocaleString()}`, 'good');
      this.emit('milestone', g);
    }
    if (s.pop > this.bestPop) this.bestPop = s.pop;
    this.contractTick();
    this.flightTick();
    this.achT += 1;
    if (this.achT >= 3) { this.achT = 0; this.achieveTick(); }
    this.updateUnlocks();
  }

  private updateUnlocks(silent = false) {
    const p = this.bestPop = Math.max(this.bestPop, this.city.stats.pop);
    const u = this.unlocked;
    if (!u.avenue && p >= UNLOCK.avenue) { u.avenue = true; if (!silent) { this.toast('Avenues unlocked: wider roads that carry twice the cars.', 'good'); this.emit('unlock', 'avenue'); } }
    if (!u.policies && p >= UNLOCK.policies) { u.policies = true; if (!silent) { this.toast('City policies unlocked.', 'good'); this.emit('unlock', 'policies'); } }
    if (!u.arena && p >= UNLOCK.arena) { u.arena = true; if (!silent) { this.toast('Arena unlocked: match days pack the streets and pay well.', 'good'); this.emit('unlock', 'arena'); } }
    for (const k of ['truck', 'freight'] as const) {
      if (!u[k] && p >= UNLOCK[k]) { u[k] = true; if (!silent) { this.toast(k === 'truck' ? 'Freight unlocked: haul food, stone and goods by truck for pay.' : 'Freight rail unlocked: long trains for heavy loads.', 'good'); this.emit('unlock', k); } }
    }
    if (!u.airport && p >= UNLOCK.airport) { u.airport = true; if (!silent) { this.toast('Airports unlocked: a runway, a terminal and planes overhead. Services tool, key 8.', 'good'); this.emit('unlock', 'airport'); } }
    for (const k of ['school', 'clinic'] as const) {
      if (!u[k] && p >= UNLOCK[k]) { u[k] = true; if (!silent) { this.toast(k === 'school' ? 'Schools unlocked: kids need somewhere to go every morning.' : 'Clinics unlocked: keep your seniors healthy.', 'good'); this.emit('unlock', k); } }
    }
    const unlockMsg: Record<string, string> = {
      tram: 'Trams unlocked: rails in the road median, never stuck in traffic.',
      ferry: 'Ferries unlocked: put piers on the shore and sail across the water.',
      gondola: 'Gondolas unlocked: cable cars that fly straight over everything.',
      metro: 'Metro unlocked: elevated trains that skip traffic.',
    };
    for (const k of ['tram', 'ferry', 'gondola', 'metro'] as const) {
      if (!u[k] && p >= UNLOCK[k]) { u[k] = true; if (!silent) { this.toast(unlockMsg[k], 'good'); this.emit('unlock', k); } }
    }
  }

  // ---------------------------------------------------------------- stability

  private stability_(dt: number) {
    const tr = this.traffic, ts = this.transit, st = this.city.stats;
    const size = (this.diff === 0 ? 8 : 6) + st.pop / (this.diff === 0 ? 85 : 100);
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
    const total = (1 - (1 - traffic * 0.95) * (1 - transit * 0.9) * (1 - unrest * 0.8) * (1 - debt)) * [0.78, 0.92, 1][this.diff];
    this.crisis = { traffic, transit, unrest, debt, total };
    const grace = (this.day < 4 ? 0.12 : this.day < 7 ? 0.4 : 1) * [0.42, 0.8, 1.25][this.diff];
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
    this.assist(t);
    if (t > this.nextRain) {
      this.rainUntil = t + DAY * (0.3 + this.rand() * 0.2);
      this.nextRain = this.rainUntil + DAY * (2.5 + this.rand() * 3);
      this.city.rain = true;
      this.emit('weather', 'rain');
      this.toast('Rain: roads are slower and more people want a ride.', 'info');
    }
    if (this.city.rain && t > this.rainUntil) { this.city.rain = false; this.emit('weather', 'clear'); }
    if (t > this.nextAccident && this.day >= 2) {
      this.nextAccident = t + DAY * (1.0 + this.rand() * 1.4) * [1.7, 1.2, 1][this.diff];
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

  /** assistants: auto-fleet and the advisor refresh */
  private assist(t: number) {
    if (this.autoFleet && t - this.fleetT > 5) {
      this.fleetT = t;
      let best: Line | null = null, bs = 0;
      for (const l of this.transit.lines) {
        if (l.vehicles.length >= this.transit.maxVehicles(l)) continue;
        let need = 0;
        for (const s of l.stops) need = Math.max(need, s.queue.length / s.cap);
        if (t - l.lastFull < 14) need = Math.max(need, 0.8);
        const cost = this.transit.vehicleCost(l);
        if (need > 0.72 && need > bs && this.money > cost + 1200) { bs = need; best = l; }
      }
      if (best) {
        const r = this.addVehicle(best);
        if (r.ok && t - this.autopilotLog > DAY * 0.25) { this.autopilotLog = t; this.toast(`Auto-fleet added a ${MODES[best.kind].vehicle} to ${best.name}.`, 'info'); }
      }
    }
    if (this.autoRenew && t - this.renewT > 6) {
      this.renewT = t;
      for (const l of this.transit.lines) {
        for (const c of l.vehicles) {
          const worn = this.transit.ageDays(c) > MODES[l.kind].life || c.cond < 0.3;
          if (worn && this.money > this.renewCost(c) + 2500) { this.renewVehicle(c); break; }
        }
      }
    }
    if (this.advisorOn && t - this.adviceT > 2) {
      this.adviceT = t;
      this.advice = advise(this, this.dismissed);
      this.emit('advice', this.advice);
    }
  }

  autoLine(mode: Mode) { const r = autoLine(this, mode); this.refreshAdvice(); return r; }
  refreshAdvice() { this.adviceT = this.t; this.advice = this.advisorOn ? advise(this, this.dismissed) : []; this.emit('advice', this.advice); }
  dismissAdvice(id: string) {
    this.dismissed.add(id);
    // an id comes back after a while in case the problem is still there
    setTimeout(() => this.dismissed.delete(id), 90000);
    this.advice = this.advice.filter((a) => a.id !== id);
    this.emit('advice', this.advice);
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
    if (isSolidCode(w.stopKind[i])) return 'station';
    if (w.water[i] && this.transit.boat[i] && w.road[i] === 0) return 'ferry';
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
      else { ok.push(r === 'exists'); if (r === 'locked') reason = 'Unlock this district first.'; else if (r === 'building') reason ??= 'A building is in the way.'; else if (r === 'park') reason ??= 'Remove the park first.'; else if (r === 'ferry') reason ??= 'A ferry route runs under here. Boats cannot pass a bridge.'; }
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

  /** where an airport would sit if its top-left corner were tile i: the footprint, its orientation and a road on a long side */
  planAirport(i: number, rotOnly = -1, needRoad = true): { ok: boolean; reason?: string; foot: number[]; x: number; y: number; rot: number } {
    const w = this.world;
    const x0 = tileX(i), y0 = tileY(i);
    const none = (reason: string) => ({ ok: false, reason, foot: [] as number[], x: x0, y: y0, rot: 1 });
    let lastReason = 'Needs open ground, three tiles by two, with a road along a long side.';
    // rot = direction of the road the terminal faces (0 E, 1 S, 2 W, 3 N)
    for (const rot of rotOnly >= 0 ? [rotOnly] : [1, 3, 0, 2]) {
      const wide = rot === 1 || rot === 3;
      const fw = wide ? 3 : 2, fd = wide ? 2 : 3;
      const foot: number[] = [];
      let bad = '';
      for (let dy = 0; dy < fd && !bad; dy++) for (let dx = 0; dx < fw; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (!inMap(x, y)) { bad = 'That is too close to the edge of the map.'; break; }
        const t = tileIdx(x, y);
        if (!w.isUnlocked(t)) { bad = 'Part of that is in land you have not bought.'; break; }
        if (w.water[t]) { bad = 'The runway cannot sit on water.'; break; }
        if (!w.isEmpty(t) || w.rail[t]) { bad = 'Something is in the way. An airport needs a clear 3 by 2 block.'; break; }
        foot.push(t);
      }
      if (bad) { lastReason = bad; continue; }
      // a road along the front edge
      const front: number[] = [];
      for (let k = 0; k < (wide ? fw : fd); k++) {
        const x = rot === 0 ? x0 + fw : rot === 2 ? x0 - 1 : x0 + k;
        const y = rot === 1 ? y0 + fd : rot === 3 ? y0 - 1 : y0 + k;
        if (inMap(x, y)) front.push(tileIdx(x, y));
      }
      if (needRoad && !front.some((t) => w.road[t])) { lastReason = 'The terminal side needs a road beside it.'; continue; }
      return { ok: true, foot, x: x0, y: y0, rot };
    }
    return none(lastReason);
  }

  placeService(kind: ServiceKind, i: number): Cmd {
    const w = this.world, def = SERVICE[kind];
    if (!this.unlocked[kind]) return { ok: false, msg: `${def.label}s unlock at ${def.unlock.toLocaleString()} residents.` };
    if (kind === 'airport') {
      if ([...this.city.buildings.values()].some((b) => b.special === 'airport')) return { ok: false, msg: 'One airport is plenty for this city.' };
      const pl = this.planAirport(i);
      if (!pl.ok) return { ok: false, msg: pl.reason };
      if (this.money < def.cost) return { ok: false, msg: 'Not enough money. Need $' + def.cost.toLocaleString() + '.' };
      this.spend(def.cost);
      const b = this.city.addBuilding(pl.x, pl.y, 'com', 3, 'airport', pl.foot, pl.rot);
      w.version.tiles++;
      for (const p of this.city.persons) if (!p.work) this.city.occupy(p);
      this.flightAt.set(b.id, this.t + 6);
      this.emit('sfx', 'build');
      this.toast(`${b.name} is open. Planes will start coming in. Connect it with roads and transit.`, 'good');
      return { ok: true, cost: def.cost };
    }
    if (!w.isUnlocked(i) || w.water[i] || !w.isEmpty(i) || w.rail[i]) return { ok: false, msg: 'Pick an empty tile.' };
    const rf = this.city.roadFor({ x: tileX(i), y: tileY(i) });
    if (rf.tile < 0) return { ok: false, msg: `A ${kind} needs a road beside it.` };
    if (this.money < def.cost) return { ok: false, msg: 'Not enough money. Need $' + def.cost.toLocaleString() + '.' };
    this.spend(def.cost);
    const b = this.city.addBuilding(tileX(i), tileY(i), 'com', 2, kind);
    w.version.tiles++;
    for (const p of this.city.persons) if (!p.work) this.city.occupy(p);
    this.emit('sfx', 'build');
    this.toast(kind === 'school' ? `${b.name} is open. Pupils nearby will enrol tomorrow.` : `${b.name} is open. Seniors can book check-ups.`, 'good');
    return { ok: true, cost: def.cost };
  }

  bulldoze(i: number): Cmd {
    const w = this.world;
    if (!w.isUnlocked(i)) return { ok: false, msg: 'Locked.' };
    if (w.bld[i] >= 0) {
      if (this.money < COST.bulldoze) return { ok: false, msg: 'Not enough money.' };
      const b = this.city.buildings.get(w.bld[i])!;
      this.spend(COST.bulldoze);
      if (b.special) w.version.tiles++;
      this.city.removeBuilding(b);
      this.emit('sfx', 'demolish');
      return { ok: true, cost: COST.bulldoze };
    }
    if (w.stop[i] >= 0) {
      const s = this.transit.stopById.get(w.stop[i])!;
      if (MODES[s.kind].solid) {
        const n = s.lines.length;
        this.transit.removeStop(s);
        this.emit('sfx', 'demolish');
        return { ok: true, msg: n ? `${MODES[s.kind].stopWord[0].toUpperCase()}${MODES[s.kind].stopWord.slice(1)} and its lines removed.` : 'Removed.' };
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
      for (const l of [...this.transit.lines]) if (l.kind === 'tram' && l.tiles.includes(i)) { this.transit.deleteLine(l); this.toast(`${l.name} lost its rails with the road.`, 'warn'); }
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

  /** why a stop of this mode cannot go on tile t, or null when it can */
  spotCheck(mode: Mode, t: number): string | null {
    const w = this.world, m = MODES[mode];
    if (!w.isUnlocked(t)) return 'Unlock that district first.';
    if (w.stop[t] >= 0) return w.stopKind[t] === m.stopCode ? null : 'That tile already has a different kind of stop.';
    switch (mode) {
      case 'bus': case 'tram': return w.road[t] ? null : 'Stops go on roads.';
      case 'truck': {
        if (!w.road[t]) return 'Yards go on roads, right beside an industry or shop.';
        const near = this.city.sitesNear(wx(tileX(t)), wz(tileY(t)));
        return near.length ? null : 'No industry or shop within reach. Put the yard beside a farm, quarry, factory, terminal or shop.';
      }
      case 'freight': {
        if (w.water[t] || w.bld[t] >= 0 || w.road[t] || w.park[t]) return 'Depots need open ground.';
        const near = this.city.sitesNear(wx(tileX(t)), wz(tileY(t)));
        return near.some((b) => isIndustry(b.special)) ? null : 'No industry within reach. Put the depot beside a farm, quarry, factory or terminal.';
      }
      case 'metro': return w.water[t] || w.bld[t] >= 0 ? 'Stations need open ground or a road.' : null;
      case 'ferry':
        if (w.water[t]) return 'Piers go on the shore, not in the water.';
        if (!w.shore[t]) return 'A pier has to touch the water.';
        return w.isEmpty(t) ? null : 'That spot is taken. Piers need a free shoreline tile.';
      case 'gondola':
        if (w.water[t] || w.bld[t] >= 0 || w.road[t] || w.park[t]) return 'Cable stations need open ground.';
        return null;
    }
  }

  quoteBus(tiles: number[]): { cost: number; ok: boolean; reason?: string } {
    const w = this.world;
    let cost = COST.bus;
    for (const t of tiles) {
      if (!w.road[t]) return { cost, ok: false, reason: 'Stops go on roads.' };
      if (w.stop[t] < 0) cost += COST.busStop;
      else if (w.stopKind[t] !== MODES.bus.stopCode) return { cost, ok: false, reason: 'That tile already has a different kind of stop.' };
    }
    for (let k = 0; k + 1 < tiles.length; k++) {
      if (tiles[k] === tiles[k + 1]) return { cost, ok: false, reason: 'Pick a different stop.' };
      if (!this.traffic.router.find(tiles[k], tiles[k + 1])) return { cost, ok: false, reason: 'Those stops are not connected by road.' };
    }
    return { cost, ok: true };
  }

  /** what a route of any mode would cost and lay down, for previews and quotes */
  quoteLine(mode: Mode, tiles: number[]): { cost: number; ok: boolean; reason?: string; track: number[]; widen: number[] } {
    const w = this.world, m = MODES[mode];
    if (mode === 'bus') { const q = this.quoteBus(tiles); return { ...q, track: [], widen: [] }; }
    if (mode === 'truck') {
      let cost = m.baseCost;
      for (const t of tiles) {
        const why = this.spotCheck(mode, t);
        if (why) return { cost, ok: false, reason: why, track: [], widen: [] };
        if (w.stop[t] < 0) cost += m.stopCost;
      }
      for (let k = 0; k + 1 < tiles.length; k++) {
        if (tiles[k] === tiles[k + 1]) return { cost, ok: false, reason: 'Pick a different yard.', track: [], widen: [] };
        if (!this.traffic.router.find(tiles[k], tiles[k + 1])) return { cost, ok: false, reason: 'Those yards are not connected by road.', track: [], widen: [] };
      }
      const flow = this.cargoFlow(tiles);
      if (!flow.ok) return { cost, ok: false, reason: flow.reason, track: [], widen: [] };
      return { cost, ok: true, track: [], widen: [] };
    }
    let cost = m.baseCost;
    const widen: number[] = [];
    for (const t of tiles) {
      const why = this.spotCheck(mode, t);
      if (why) return { cost, ok: false, reason: why, track: [], widen };
      if (w.stop[t] < 0) cost += m.stopCost;
    }
    const plan = this.transit.planTrack(mode, tiles, this.transit.nextLineId);
    if (!plan.ok) return { cost, ok: false, reason: plan.reason, track: plan.tiles, widen };
    if (mode === 'freight') {
      const flow = this.cargoFlow(tiles);
      if (!flow.ok) return { cost, ok: false, reason: flow.reason, track: plan.tiles, widen };
      for (const t of plan.tiles) { if (isSolidCode(w.stopKind[t]) && !tiles.includes(t)) continue; cost += m.trackCost + (w.water[t] ? COST.trackWater : 0); }
      return { cost: Math.round(cost), ok: true, track: plan.tiles, widen };
    }
    if (mode === 'metro') {
      for (const t of plan.tiles) {
        if (w.stopKind[t] === 2 && !tiles.includes(t)) continue;
        cost += COST.track + (w.water[t] ? COST.trackWater : 0);
      }
    } else if (mode === 'tram') {
      const seen = new Set<number>();
      for (const t of plan.tiles) {
        if (seen.has(t)) continue;
        seen.add(t);
        cost += m.trackCost;
        if (w.road[t] === 1) { cost += COST.upgrade; widen.push(t); }
      }
    } else if (mode === 'ferry') {
      cost += plan.tiles.length * m.trackCost;
    } else {
      for (let k = 1; k < plan.tiles.length; k++) cost += Math.hypot(tileX(plan.tiles[k]) - tileX(plan.tiles[k - 1]), tileY(plan.tiles[k]) - tileY(plan.tiles[k - 1])) * m.trackCost;
      cost = Math.round(cost);
    }
    return { cost, ok: true, track: plan.tiles, widen };
  }

  /** does a route with these stops actually have something to haul and someone to take it? */
  cargoFlow(tiles: number[]): { ok: boolean; reason?: string; types: number[] } {
    const sites = tiles.map((t) => this.city.sitesNear(wx(tileX(t)), wz(tileY(t))));
    const types: number[] = [];
    for (let i = 0; i < sites.length; i++) {
      for (const p of sites[i]) {
        if (!isIndustry(p.special) || p.special === 'terminal') continue;
        const F = FACILITY[p.special as 'farm' | 'quarry' | 'factory'];
        if (F.makes < 0) continue;
        for (let j = 0; j < sites.length; j++) if (j !== i && sites[j].some((q) => q !== p && room(q, F.makes) > 0)) { if (!types.includes(F.makes)) types.push(F.makes); }
      }
    }
    if (!types.length) return { ok: false, reason: 'Nothing to haul on this route. Link a farm, quarry or factory to a place that buys what it makes (shops, a factory, or the terminal).', types };
    return { ok: true, types };
  }

  createBusLine(tiles: number[]): Cmd & { line?: Line } { return this.createLine('bus', tiles); }

  createLine(mode: Mode, tiles: number[]): Cmd & { line?: Line } {
    const m = MODES[mode];
    if (mode !== 'bus' && !this.unlocked[mode as keyof Game['unlocked']]) return { ok: false, msg: `${m.label} unlocks at ${m.unlock} residents.` };
    if (tiles.length < 2) return { ok: false, msg: `A line needs at least two ${m.stopWord}s.` };
    if (this.transit.lines.length >= MAX_LINES) return { ok: false, msg: `That is the most lines the network can run (${MAX_LINES}). Delete one first.` };
    const q = this.quoteLine(mode, tiles);
    if (!q.ok) return { ok: false, msg: q.reason };
    if (q.cost > this.money) return { ok: false, msg: 'Not enough money. Need $' + Math.ceil(q.cost).toLocaleString() + '.' };
    const line = this.transit.createLine(mode, tiles);
    if (!line) return { ok: false, msg: isRoadMode(mode) ? 'Could not route that line.' : 'No room for that route.' };
    if (q.widen.length) this.widenRoads(q.widen);
    this.spend(q.cost);
    this.emit('sfx', 'line');
    return { ok: true, cost: q.cost, line };
  }

  /** tram rails need a median: streets along the route become avenues */
  widenRoads(tiles: number[]) {
    const w = this.world;
    for (const t of tiles) if (w.road[t] === 1) w.road[t] = 2;
    w.version.roads++;
    this.city.refreshAccess();
    this.emit('roadsChanged');
  }

  /** what adding one more stop to a line would cost and lay down */
  quoteExtend(line: Line, tile: number): { cost: number; ok: boolean; reason?: string; track: number[]; widen: number[] } {
    const m = MODES[line.kind], w = this.world;
    const why = this.spotCheck(line.kind, tile);
    if (why) return { cost: 0, ok: false, reason: why, track: [], widen: [] };
    let cost = w.stop[tile] < 0 ? m.stopCost : 0;
    if (line.stops.includes(this.transit.stopAt(tile) as any)) return { cost: 0, ok: false, reason: 'That stop is already on this line.', track: [], widen: [] };
    if (isRoadMode(line.kind)) {
      const last = line.stops[line.stops.length - 1].tile;
      const path = this.traffic.router.find(last, tile);
      return { cost, ok: !!path, reason: path ? undefined : 'Those stops are not connected by road.', track: path ?? [], widen: [] };
    }
    const plan = this.transit.planExtension(line, tile);
    if (!plan.ok) return { cost, ok: false, reason: plan.reason, track: plan.tiles, widen: [] };
    if (plan.tiles.length < 2) return { cost, ok: false, reason: 'Too close to the last stop.', track: plan.tiles, widen: [] };
    const widen: number[] = [];
    const seen = new Set<number>();
    for (const t of plan.tiles.slice(1)) {
      if (line.kind === 'tram') { if (!seen.has(t)) { seen.add(t); cost += m.trackCost; if (w.road[t] === 1) { cost += COST.upgrade; widen.push(t); } } }
      else if (line.kind === 'metro') cost += COST.track + (w.water[t] ? COST.trackWater : 0);
      else if (line.kind === 'freight') cost += m.trackCost + (w.water[t] ? COST.trackWater : 0);
      else if (line.kind === 'ferry') cost += m.trackCost;
    }
    if (line.kind === 'gondola') { const lt = line.stops[line.stops.length - 1].tile; cost += Math.round(Math.hypot(tileX(tile) - tileX(lt), tileY(tile) - tileY(lt)) * m.trackCost); }
    return { cost, ok: true, track: plan.tiles, widen };
  }

  /** extend a line by one stop; charges for it */
  extendLine(line: Line, tile: number): Cmd {
    const q = this.quoteExtend(line, tile);
    if (!q.ok) return { ok: false, msg: q.reason };
    if (q.cost > this.money) return { ok: false, msg: 'Not enough money. Need $' + Math.ceil(q.cost).toLocaleString() + '.' };
    const r = this.transit.extendLine(line, tile);
    if (!r.ok) return { ok: false, msg: r.reason };
    if (q.widen.length) this.widenRoads(q.widen);
    this.spend(q.cost);
    this.emit('sfx', 'line');
    return { ok: true, cost: q.cost };
  }

  /** extra stops worth placing between two stops so a long hop still serves the blocks in between */
  autoStops(mode: Mode, a: number, b: number): number[] {
    if (mode === 'ferry' || mode === 'gondola' || isCargoMode(mode)) return [];
    const w = this.world;
    let path: number[] | null = null;
    if (mode === 'metro') path = this.transit.trackRouter.find(a, b, this.transit.nextLineId, -1, new Set());
    else path = this.traffic.router.find(a, b);
    if (!path || path.length < 2) return [];
    const spacing = mode === 'bus' ? 6 : mode === 'tram' ? 7 : 9;
    const n = Math.floor(path.length / spacing);
    if (n < 1) return [];
    const out: number[] = [];
    for (let i = 1; i <= n; i++) {
      const nominal = Math.round((path.length * i) / (n + 1));
      let pick = -1;
      for (const o of [0, 1, -1, 2, -2]) {
        const idx = nominal + o;
        if (idx <= 1 || idx >= path.length - 2) continue;
        const t = path[idx];
        if (this.spotCheck(mode, t)) continue;
        if (w.stop[t] >= 0) continue;
        if (mode === 'metro' && (w.road[t] || w.water[t] || w.bld[t] >= 0 || w.park[t])) continue;
        if (mode !== 'metro' && this.roadDegree(t) >= 3) continue; // not in the middle of a junction
        pick = t; break;
      }
      if (pick >= 0 && !out.includes(pick)) out.push(pick);
    }
    return out;
  }

  roadDegree(t: number): number {
    const w = this.world;
    let n = 0;
    for (let d = 0; d < 4; d++) { const nx = tileX(t) + DX[d], ny = tileY(t) + DY[d]; if (inMap(nx, ny) && w.road[tileIdx(nx, ny)]) n++; }
    return n;
  }

  /** the tiles a metro route would occupy, for previews and quotes */
  quoteMetro(tiles: number[]): { cost: number; ok: boolean; reason?: string; track: number[] } {
    const q = this.quoteLine('metro', tiles);
    return { cost: q.cost, ok: q.ok, reason: q.reason, track: q.track };
  }

  createMetroLine(tiles: number[]): Cmd & { line?: Line } { return this.createLine('metro', tiles); }

  addVehicle(line: Line): Cmd {
    const c = this.transit.vehicleCost(line);
    if (line.vehicles.length >= this.transit.maxVehicles(line)) return { ok: false, msg: 'This line is at its vehicle limit.' };
    if (this.money < c) return { ok: false, msg: 'Not enough money.' };
    if (!this.transit.addVehicle(line)) return { ok: false, msg: 'No room.' };
    this.spend(c, 'vehicles');
    this.emit('linesChanged');
    this.emit('sfx', 'build');
    return { ok: true, cost: c };
  }
  removeVehicle(line: Line): Cmd {
    if (!this.transit.removeVehicle(line)) return { ok: false, msg: 'A line needs at least one vehicle.' };
    this.earn(this.transit.vehicleCost(line) * 0.5, 'refund');
    this.emit('linesChanged');
    return { ok: true };
  }
  deleteLine(line: Line): Cmd {
    const m = MODES[line.kind];
    this.retiredBoard[line.kind] += line.boardings;
    const refund = Math.round(60 + (line.kind === 'gondola' ? this.transit.lineLength(line) : line.tiles.length) * m.trackCost * 0.3 + line.vehicles.length * m.vehCost * 0.4);
    this.transit.deleteLine(line);
    this.earn(refund, 'refund');
    this.emit('sfx', 'demolish');
    return { ok: true, cost: -refund };
  }
  expandStop(s: Stop): Cmd {
    const c = MODES[s.kind].expandCost;
    if (s.cap >= MODES[s.kind].stopMax) return { ok: false, msg: 'Fully expanded.' };
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

  stopCatchment(kind: Mode) { return MODES[kind].walkR; }

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
  buildings: (number | string)[][]; stops: [number, number, string, number][]; people?: PersonSave[]; lines: { kind: Mode; tiles: number[]; color: number; name: string; veh: number; fare?: number }[];
  daysSurvived: number; dayIncome: number; peak: number; diff?: number;
  fin?: { loan: number; maint: number; autoRenew: boolean; research: Record<string, number>; contracts?: Contract[]; done?: number; ach?: string[]; borrowed?: boolean };
}

export interface PersonSave { i: number; b: number; h: number; f: string; l: string; a: number; t: string[]; n: number[]; x: number; wl: number; k: number; fr: number[]; w: number; bt: number }

// save order: bus 0 and metro 1 match the first save format
const SAVE_MODES: Mode[] = ['bus', 'metro', 'tram', 'ferry', 'gondola', 'truck', 'freight'];

export function serialize(g: Game): SaveData {
  const w = g.world;
  const roads: number[] = [], parks: number[] = [];
  for (let i = 0; i < N * N; i++) { if (w.road[i]) roads.push(i, w.road[i]); if (w.park[i]) parks.push(i); }
  const code = { res: 0, com: 1, ind: 2 } as const;
  const blist = [...g.city.buildings.values()];
  const bIndex = new Map(blist.map((b, i) => [b.id, i] as const));
  const sp = { arena: 3, school: 4, clinic: 5, farm: 6, quarry: 7, factory: 8, terminal: 9, airport: 10 } as const;
  const buildings = blist.map((b) => [b.x, b.y, b.special ? sp[b.special] : code[b.kind], b.level, b.variant, b.rot, b.residents.length, b.venue ?? '', b.name, ...b.out.map((v) => Math.round(v * 10) / 10), ...b.stock.map((v) => Math.round(v * 10) / 10), Math.round(b.eff * 100) / 100, b.rotFoot]);
  const people: PersonSave[] = g.city.persons.map((p) => ({
    i: p.id, b: bIndex.get(p.home.id) ?? 0, h: p.hh.id, f: p.first, l: p.last, a: p.age, t: p.traits,
    n: [p.needs.energy, p.needs.hunger, p.needs.fun, p.needs.social, p.needs.comfort].map((v) => Math.round(v * 100) / 100),
    x: Math.round(p.xp * 10) / 10, wl: Math.round(p.wallet), k: p.look, fr: p.friends, w: p.work ? bIndex.get(p.work.id) ?? -1 : -1, bt: Math.round(p.born),
  }));
  const stops = g.transit.stops.map((s) => [s.tile, SAVE_MODES.indexOf(s.kind), s.name, s.cap] as [number, number, string, number]);
  const lines = g.transit.lines.map((l) => ({ kind: l.kind, tiles: l.stops.map((s) => s.tile), color: l.color, name: l.name, veh: l.vehicles.length, fare: l.fareMul }));
  return {
    v: 1, seed: g.seed, t: g.t, money: g.money, name: g.name, stability: g.stability, goalIdx: g.goalIdx, bestPop: g.bestPop,
    policies: { ...g.policies }, districts: w.districts.filter((d) => d.unlocked).map((d) => d.index), roads, parks, buildings, stops, lines, people,
    daysSurvived: g.daysSurvived, dayIncome: g.dayIncome, peak: g.peakTraffic, diff: g.diff,
    fin: { loan: g.loan, maint: g.maint, autoRenew: g.autoRenew, research: { ...g.research }, contracts: g.contracts.filter((c) => c.state === 'active' || c.state === 'offer'), done: g.contractsDone, ach: [...g.achieved], borrowed: g.everBorrowed },
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
  const blist: Building[] = [];
  for (const row of d.buildings) {
    const [x, y, k, level, variant, rot, res, venue, name, o0, o1, o2, s0, s1, s2, eff, rotFoot] = row as [number, number, number, number, number, number, number, string, string, number, number, number, number, number, number, number, number];
    const special = k === 3 ? 'arena' : k === 4 ? 'school' : k === 5 ? 'clinic' : k === 6 ? 'farm' : k === 7 ? 'quarry' : k === 8 ? 'factory' : k === 9 ? 'terminal' : k === 10 ? 'airport' : undefined;
    const pl = special === 'airport' ? g.planAirport(tileIdx(x, y), rotFoot ?? 1, false) : null;
    const b = special ? g.city.addBuilding(x, y, k >= 6 && k <= 9 ? 'ind' : 'com', special === 'arena' || special === 'airport' ? 3 : 2, special, pl?.ok ? pl.foot : [], rotFoot ?? 1) : g.city.addBuilding(x, y, kinds[k], level);
    if (o0 !== undefined) { b.out = [o0, o1, o2]; b.stock = [s0, s1, s2]; b.eff = eff || 1; }
    b.variant = variant; b.rot = rot; b.born = d.t - 200; b.lastLevel = d.t - 100;
    if (venue && !special) b.venue = venue as Building['venue'];
    if (name) b.name = name;
    blist.push(b);
    if (!d.people) g.city.fillHome(b, res);
  }
  if (d.people) {
    const hhs = new Map<number, Household>();
    const byOld = new Map<number, Person>();
    const traitOk = new Set(Object.keys(TRAITS));
    for (const ps of d.people) {
      const home = blist[ps.b];
      if (!home) continue;
      let hh = hhs.get(ps.h);
      if (!hh) { hh = g.city.newHousehold(home, ps.l); hhs.set(ps.h, hh); }
      const p = g.city.createPerson(home, { age: ps.a, hh, first: ps.f });
      p.traits = ps.t.filter((t) => traitOk.has(t)) as Person['traits'];
      [p.needs.energy, p.needs.hunger, p.needs.fun, p.needs.social, p.needs.comfort] = ps.n;
      p.xp = ps.x; p.wallet = ps.wl; p.look = ps.k; p.born = ps.bt;
      p.mood = moodOf(p);
      byOld.set(ps.i, p);
      const wb = ps.w >= 0 ? blist[ps.w] : null;
      if (wb && wb.kind !== 'res') {
        p.work = wb;
        if (wb.special === 'school') { wb.students.push(p); p.student = true; p.title = 'Student'; p.workStart = 7.8 + g.rand() * 0.5; p.workEnd = 15 + g.rand() * 0.6; }
        else { wb.workers.push(p); g.city.refreshJob(p); }
      }
    }
    for (const ps of d.people) { const p = byOld.get(ps.i); if (p) p.friends = ps.fr.map((f) => byOld.get(f)?.id).filter((x): x is number => x !== undefined); }
  }
  for (const p of g.city.persons) g.city.occupy(p);
  if (d.fin) { g.loan = d.fin.loan; g.maint = d.fin.maint; g.autoRenew = d.fin.autoRenew; Object.assign(g.research, d.fin.research); g.contracts = (d.fin.contracts ?? []).map((c) => ({ ...c, last: 0 })); g.contractsDone = d.fin.done ?? 0; g.achieved = new Set(d.fin.ach ?? []); g.everBorrowed = !!d.fin.borrowed; for (const c of g.contracts) if (c.state === 'active') c.last = 0; }
  for (const [tile, k, name, cap] of d.stops) { const s = g.transit.addStop(tile, SAVE_MODES[k] ?? 'bus', name); s.cap = cap; }
  for (const l of d.lines) {
    const line = g.transit.createLine(l.kind, l.tiles);
    if (!line) continue;
    line.color = l.color; line.name = l.name; line.fareMul = l.fare ?? 1;
    while (line.vehicles.length < l.veh) if (!g.transit.addVehicle(line)) break;
  }
  g.city.updateStats();
  g.unlocked.avenue = g.unlocked.policies = g.unlocked.metro = g.unlocked.tram = g.unlocked.ferry = g.unlocked.gondola = g.unlocked.arena = g.unlocked.school = g.unlocked.clinic = g.unlocked.airport = g.unlocked.truck = g.unlocked.freight = false;
  (g as any).updateUnlocks(true);
  g.daysSurvived = d.daysSurvived;
  g.emit('roadsChanged');
  return g;
}
