// The living city: buildings, people with daily schedules, mode choice, growth and upgrades.
import { N, DX, DY, tileIdx, tileX, tileY, inMap, wx, wz, type World } from './world.ts';
import { MODES } from './modes.ts';
import { FACILITY, NAME_PATTERNS, OUT_CAP, STOCK_CAP, CATCH, isIndustry, isSite, sellsIdx, room } from './industry.ts';
import { clamp, lerp, gauss, smoothstep } from './util.ts';
import {
  VENUES, rollVenue, venueName, venueLabel, firstName, lastName, rollTraits, rollLook, freshNeeds, composeAges, stageOf, isPupil, has, moodOf, feel,
  jobFor, careerTier, logLife, fullName, DISTRICT_NAMES,
} from './people.ts';
import type { Cargo } from './types.ts';
import { SPEED_STREET } from './path.ts';
import { WALK_SPEED } from './transit.ts';
import type { Traffic } from './traffic.ts';
import type { Transit } from './transit.ts';
import type { Ctx, Building, Person, Kind, Vehicle, Stop, Line, Special, Venue, Household, Stage } from './types.ts';
import { DAY, hourOf, dayOf } from './types.ts';

export interface Policies {
  toll: boolean;
  busLanes: boolean;
  stagger: boolean;
  remote: boolean;
  freeTransit: boolean;
}
export const defaultPolicies = (): Policies => ({ toll: false, busLanes: false, stagger: false, remote: false, freeTransit: false });

export const VARIANTS: Record<Kind, number[]> = { res: [6, 5, 5], com: [5, 5, 6], ind: [4, 4, 4] };
export const CAPS: Record<Kind, number[]> = { res: [5, 18, 52], com: [4, 14, 42], ind: [6, 16, 34] };

export interface Stats {
  pop: number;
  employed: number;
  unemployed: number;
  jobs: number;
  housing: number;
  sat: number;            // average satisfaction 0..1
  commute: number;        // average commute in game-seconds (EMA)
  car: number; transit: number; walk: number;   // trip shares over the last day (0..1)
  trips: number;
  demand: { r: number; c: number; i: number };
  buildings: number;
  levels: [number, number, number];
  stuck: number;
  adults: number; kids: number; seniors: number; pupils: number;
  mood: number;           // average mood of all citizens
  smog: number;           // 0 clean .. 1 choking
  schools: number; clinics: number;
}

export interface FeedItem { id: number; t: number; pid: number; text: string; tone: 'good' | 'info' | 'warn' | 'bad' }
export const SCHOOL_CAP = 70;
export const STAFF_CAP = { arena: 24, school: 14, clinic: 12, airport: 30, farm: FACILITY.farm.jobs, quarry: FACILITY.quarry.jobs, factory: FACILITY.factory.jobs, terminal: FACILITY.terminal.jobs };

export class City {
  buildings = new Map<number, Building>();
  persons: Person[] = [];
  nextB = 1;
  nextP = 1;
  stats: Stats = {
    pop: 0, employed: 0, unemployed: 0, jobs: 0, housing: 0, sat: 0.8, commute: 0, car: 0, transit: 0, walk: 0, trips: 0,
    demand: { r: 0.5, c: 0.4, i: 0.3 }, buildings: 0, levels: [0, 0, 0], stuck: 0,
    adults: 0, kids: 0, seniors: 0, pupils: 0, mood: 0.7, smog: 0, schools: 0, clinics: 0,
  };
  households = new Map<number, Household>();
  personById = new Map<number, Person>();
  /** every building that makes, takes or sells cargo */
  private sites: Building[] = [];
  private sitesDirty = true;
  importsDay = 0;           // units bought from outside today because local stock ran out
  soldLocal = 0;
  feed: FeedItem[] = [];
  wantFrac: Record<string, number> = {};
  private nextH = 1;
  private nextFeed = 1;
  private feedAt: Record<string, number> = {};
  private needsT = 0;
  policies: Policies = defaultPolicies();
  rain = false;
  growthBoost = 1;
  stability = 100;
  eventTile = -1;           // festival target
  eventUntil = 0;
  matchTile = -1;           // arena with a match on
  matchUntil = 0;
  // callbacks
  onFee: (amount: number, why: string) => void = () => {};
  // trip counters for mode share (per rolling window)
  private modeCount = [0, 0, 0, 0];
  private modeWindow = [1, 1, 1, 1];
  private growthT = 0;
  private upT = 0;
  private immT = 0;
  private statT = 0;
  private candDirty = true;
  private cand: number[] = [];
  private lastDay = 0;
  private tick = 0;
  private jobQueue: Building[] = [];
  carFees = 0;
  /** research generation of a mode (cleaner vehicles), set by the game */
  cleanLevel: (mode: import('./modes.ts').Mode) => number = () => 0;

  constructor(private ctx: Ctx, readonly traffic: Traffic, readonly transit: Transit) {
    traffic.onArrive = (v) => { if (v.person) this.arrive(v.person, v); };
    traffic.onStrand = (v) => { if (v.person) this.strand(v.person); };
  }

  get w(): World { return this.ctx.world; }

  // ---------------------------------------------------------------- buildings

  roadFor(b: { x: number; y: number }): { tile: number; dir: number; all: number[] } {
    const w = this.w;
    let best = -1, bd = -1, bk = 0;
    const all: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = b.x + DX[d], ny = b.y + DY[d];
      if (!inMap(nx, ny)) continue;
      const t = tileIdx(nx, ny);
      if (w.road[t]) all.push(t);
      if (w.road[t] && (w.road[t] > bk || best < 0)) { best = t; bd = d; bk = w.road[t]; }
    }
    return { tile: best, dir: bd, all };
  }

  addBuilding(x: number, y: number, kind: Kind, level = 1, special?: Special, foot: number[] = [], rotFoot = 0): Building {
    const w = this.w;
    const tile = tileIdx(x, y);
    const rf = this.roadFor({ x, y });
    const variants = VARIANTS[kind][level - 1];
    const rand = this.ctx.rand;
    const fac = isIndustry(special);
    const venue: Venue | null = kind === 'com' ? ((special as Venue | undefined) ?? rollVenue(rand, level)) : null;
    const b: Building = {
      id: this.nextB++, x, y, tile, kind, level, variant: Math.floor(rand() * variants),
      rot: rf.dir >= 0 ? rf.dir : 0, born: this.ctx.t, cap: CAPS[kind][level - 1], residents: [], workers: [], visitors: 0,
      access: rf.tile, accessAll: rf.all, land: 0.3, happy: 0.8, lastLevel: this.ctx.t, cutoff: 0, glow: 0, special,
      venue, name: kind === 'res' ? '' : fac ? facilityName(rand, special as keyof typeof NAME_PATTERNS) : venueName(rand, venue ?? 'ind'), guests: [], students: [], park: 0, clinic: 0,
      out: [0, 0, 0], stock: kind === 'com' && venue && sellsIdx({ kind, venue } as Building) >= 0 ? [8, 0, 8] : [0, 0, 0], eff: 1, made: 0, picked: 0,
      foot, rotFoot,
    };
    if (foot.length) { const acc = this.roadForFoot(foot); b.access = acc.tile; b.accessAll = acc.all; b.rot = rotFoot; }
    if (special) { b.cap = STAFF_CAP[special]; b.variant = 0; }
    this.buildings.set(b.id, b);
    w.bld[tile] = b.id;
    for (const t of foot) { w.bld[t] = b.id; if (w.tree[t]) w.tree[t] = 0; }
    if (w.tree[tile]) { w.tree[tile] = 0; this.ctx.emit('treesChanged'); }
    this.candDirty = true;
    this.sitesDirty = true;
    this.ctx.emit('bldAdd', b);
    return b;
  }

  removeBuilding(b: Building, reason = 'bulldozed') {
    this.buildings.delete(b.id);
    this.w.bld[b.tile] = -1;
    for (const t of b.foot) this.w.bld[t] = -1;
    // residents leave, workers lose their jobs
    for (const p of [...b.residents]) this.removePerson(p);
    const lost = [...b.workers, ...b.students];
    for (const p of this.persons) {
      if (p.tripTo === b) p.tripTo = p.home;
      if (p.work === b) { p.work = null; p.student = false; p.title = ''; p.wage = 0; }
      if (p.at === b) { p.at = p.home; if (p.phase === 'none') p.state = 'home'; }
      if (p.tripFrom === b) p.tripFrom = p.home;
    }
    b.workers.length = 0; b.students.length = 0; b.guests.length = 0; b.visitors = 0;
    if (b.kind !== 'res' && lost.length) {
      for (const p of lost.slice(0, 6)) logLife(p, this.ctx.t, `Lost ${p.stage === 'adult' ? 'their job' : 'their school'} when ${b.name || 'the workplace'} closed.`);
      this.pushFeed(lost[0], `${b.name || 'A workplace'} closed. ${lost.length} ${lost.length === 1 ? 'person lost' : 'people lost'} their ${b.special === 'school' ? 'school' : 'job'}.`, 'warn', 'closed');
    }
    this.candDirty = true;
    this.sitesDirty = true;
    this.ctx.emit('bldRemove', { b, reason });
  }

  levelUp(b: Building) {
    if (b.level >= 3 || b.special) return;
    b.level++;
    b.cap = CAPS[b.kind][b.level - 1];
    b.variant = Math.floor(this.ctx.rand() * VARIANTS[b.kind][b.level - 1]);
    b.lastLevel = this.ctx.t;
    // redevelopment: a corner cafe can become an office block
    if (b.kind === 'com' && this.ctx.rand() < 0.75) { b.venue = rollVenue(this.ctx.rand, b.level); b.name = venueName(this.ctx.rand, b.venue); this.sitesDirty = true; if (sellsIdx(b) >= 0) { b.stock[0] = Math.max(b.stock[0], 6); b.stock[2] = Math.max(b.stock[2], 6); } }
    else if (b.kind === 'ind') b.name = venueName(this.ctx.rand, 'ind');
    if (b.kind !== 'res') for (const p of b.workers) this.refreshJob(p);
    this.ctx.emit('bldLevel', b);
  }

  /** roads touching any tile of a large building */
  roadForFoot(foot: number[]): { tile: number; all: number[] } {
    const w = this.w, set = new Set(foot);
    const all: number[] = [];
    for (const t of foot) for (let d = 0; d < 4; d++) {
      const nx = tileX(t) + DX[d], ny = tileY(t) + DY[d];
      if (!inMap(nx, ny)) continue;
      const n = tileIdx(nx, ny);
      if (!set.has(n) && w.road[n] && !all.includes(n)) all.push(n);
    }
    return { tile: all.length ? all[0] : -1, all };
  }

  refreshAccess() {
    for (const b of this.buildings.values()) {
      if (b.foot.length) { const acc = this.roadForFoot(b.foot); b.access = acc.tile; b.accessAll = acc.all; continue; }
      const rf = this.roadFor(b);
      b.access = rf.tile;
      b.accessAll = rf.all;
      if (rf.dir >= 0 && rf.dir !== b.rot) { b.rot = rf.dir; this.ctx.emit('bldRot', b); }
    }
    this.candDirty = true;
  }

  // ---------------------------------------------------------------- persons

  /** one citizen; households and jobs are arranged by the callers */
  createPerson(home: Building, spec: { age?: number; hh?: Household; first?: string; last?: string } = {}): Person {
    const r = this.ctx.rand;
    const age = spec.age ?? 22 + Math.floor(r() * 38);
    const stage = stageOf(age);
    const hh = spec.hh ?? this.newHousehold(home, spec.last);
    const traits = rollTraits(r);
    const sd = this.policies.stagger ? 1.9 : 0.8;
    const start = clamp(8.0 + gauss(r) * sd * 1.6 + (traits.includes('early') ? -1.3 : 0) + (traits.includes('night') ? 1.5 : 0), 5.3, 11.5);
    const p: Person = {
      id: this.nextP++, home, work: null, state: 'home', workStart: start - 1 / 12, workEnd: start + 8.2 + r() * 1.4,
      leisure: 0.3 + r() * 0.35, carBias: 0.8 + r() * 0.36, color: Math.floor(r() * 12),
      tripFrom: null, tripTo: null, tripStart: 0, tripIdeal: 10, tripMode: 0, nextState: 'home', legs: null, leg: 0, timer: 0, phase: 'none',
      stopRef: null, sat: 0.75, lastTrip: 0, dest: null, waitStart: 0, dead: false, leisureDone: 0, walkOutT: 0, planTime: 0,
      workDay: 0, leisureEnd: 0, remote: false, charged: false, at: home,
      first: spec.first ?? firstName(r), last: hh.last, age, stage, hh, traits, needs: freshNeeds(r), mood: 0.7, look: rollLook(r),
      title: '', wage: 0, xp: stage === 'adult' ? Math.floor(r() * 10) : 0, wallet: 20 + Math.floor(r() * 120), friends: [], log: [], ride: null, walk: null,
      student: false, thought: '', born: this.ctx.t, car: null,
    };
    if (has(p, 'driver')) p.carBias *= 0.82;
    if (has(p, 'green')) p.carBias *= 1.25;
    if (has(p, 'sporty')) p.carBias *= 1.08;
    p.mood = moodOf(p);
    hh.members.push(p);
    home.residents.push(p);
    this.persons.push(p);
    this.personById.set(p.id, p);
    return p;
  }

  newHousehold(home: Building, last?: string): Household {
    const hh: Household = { id: this.nextH++, last: last ?? lastName(this.ctx.rand), members: [], home };
    this.households.set(hh.id, hh);
    return hh;
  }

  /** a family moves in: ages, names and the first job or school place */
  createHousehold(home: Building, size: number, announce = true): Household {
    const ages = composeAges(this.ctx.rand, size);
    const hh = this.newHousehold(home);
    const ps = ages.map((age) => this.createPerson(home, { age, hh }));
    for (const p of ps) this.occupy(p);
    if (announce && ps.length) {
      const label = ps.length === 1 ? `${fullName(ps[0])} moved` : `The ${hh.last} family (${ps.length}) moved`;
      this.pushFeed(ps[0], `${label} into ${this.addressOf(home)}.`, 'info', 'movein', 4);
    }
    for (const p of ps) logLife(p, this.ctx.t, `Moved into ${this.addressOf(home)}.`);
    return hh;
  }

  /** move in about n people as a few households (used for the starting town) */
  fillHome(b: Building, n: number) {
    let left = Math.min(n, b.cap - b.residents.length);
    while (left > 0) {
      const x = this.ctx.rand();
      const size = Math.min(left, x < 0.3 ? 1 : x < 0.62 ? 2 : x < 0.86 ? 3 : 4);
      this.createHousehold(b, size, false);
      left -= size;
    }
  }

  removePerson(p: Person, why = '') {
    if (p.dead) return;
    p.dead = true;
    this.personById.delete(p.id);
    const h = p.home;
    const k = h.residents.indexOf(p);
    if (k >= 0) h.residents.splice(k, 1);
    const hh = p.hh;
    const hk = hh.members.indexOf(p);
    if (hk >= 0) hh.members.splice(hk, 1);
    if (!hh.members.length) this.households.delete(hh.id);
    if (p.work) {
      const j = p.work.workers.indexOf(p); if (j >= 0) p.work.workers.splice(j, 1);
      const j2 = p.work.students.indexOf(p); if (j2 >= 0) p.work.students.splice(j2, 1);
    }
    if (p.at) { const j = p.at.guests.indexOf(p); if (j >= 0) { p.at.guests.splice(j, 1); p.at.visitors = p.at.guests.length; } }
    if (p.stopRef) { const q = p.stopRef.queue; const j = q.indexOf(p); if (j >= 0) q.splice(j, 1); }
    if (p.ride) { const j = p.ride.passengers.indexOf(p); if (j >= 0) p.ride.passengers.splice(j, 1); p.ride = null; }
    else for (const l of this.transit.lines) for (const c of l.vehicles) { const j = c.passengers.indexOf(p); if (j >= 0) c.passengers.splice(j, 1); }
    // a driving person: kill the car
    if (p.car) this.traffic.kill(p.car);
    else for (const v of this.traffic.vehicles) if (v.person === p) { this.traffic.kill(v); break; }
    const i = this.persons.indexOf(p);
    if (i >= 0) { this.persons[i] = this.persons[this.persons.length - 1]; this.persons.pop(); }
    void why;
  }

  removeHousehold(hh: Household) {
    for (const m of [...hh.members]) this.removePerson(m);
  }

  // ---------------------------------------------------------------- careers and school

  /** give a person what suits their age: school for pupils, a job for adults */
  occupy(p: Person) {
    if (p.stage === 'adult') this.assignJob(p);
    else if (isPupil(p)) this.assignSchool(p);
  }

  refreshJob(p: Person) {
    if (!p.work || p.student) return;
    const j = jobFor(p.work, p.xp, p);
    p.title = j.title; p.wage = j.wage;
  }

  /** find a job for an unemployed adult; prefers nearby but spreads across the city */
  assignJob(p: Person): boolean {
    if (p.stage !== 'adult' || p.work) return false;
    let bestB: Building | null = null, bestS = -1;
    for (const b of this.buildings.values()) {
      if (b.kind === 'res' || b.workers.length >= b.cap) continue;
      if (b.access < 0) continue;
      const d = Math.hypot(b.x - p.home.x, b.y - p.home.y);
      const s = (this.ctx.rand() + 0.15) / (d + 7);
      if (s > bestS) { bestS = s; bestB = b; }
    }
    if (!bestB) return false;
    p.work = bestB;
    bestB.workers.push(p);
    p.student = false;
    this.refreshJob(p);
    logLife(p, this.ctx.t, `Started work as ${p.title.toLowerCase()} at ${bestB.name}.`);
    return true;
  }

  assignSchool(p: Person): boolean {
    if (!isPupil(p) || p.work) return false;
    let best: Building | null = null, bd = 18;
    for (const b of this.buildings.values()) {
      if (b.special !== 'school' || b.students.length >= SCHOOL_CAP || b.access < 0) continue;
      const d = Math.hypot(b.x - p.home.x, b.y - p.home.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return false;
    p.work = best; best.students.push(p); p.student = true; p.title = 'Student'; p.wage = 0;
    p.workStart = 7.8 + this.ctx.rand() * 0.5; p.workEnd = 15.0 + this.ctx.rand() * 0.6;
    logLife(p, this.ctx.t, `Started at ${best.name}.`);
    return true;
  }

  leaveWork(p: Person) {
    if (!p.work) return;
    const w = p.work;
    const j = w.workers.indexOf(p); if (j >= 0) w.workers.splice(j, 1);
    const j2 = w.students.indexOf(p); if (j2 >= 0) w.students.splice(j2, 1);
    p.work = null; p.student = false; p.title = ''; p.wage = 0;
  }

  /** the nearest clinic within reach, 0..1 */
  clinicCover(b: { x: number; y: number }): number {
    let best = 0;
    for (const c of this.buildings.values()) if (c.special === 'clinic') best = Math.max(best, 1 - Math.hypot(c.x - b.x, c.y - b.y) / 14);
    return clamp(best);
  }
  schoolCover(b: { x: number; y: number }): number {
    let best = 0;
    for (const c of this.buildings.values()) if (c.special === 'school' && c.students.length < SCHOOL_CAP) best = Math.max(best, 1 - Math.hypot(c.x - b.x, c.y - b.y) / 18);
    return clamp(best);
  }

  addressOf(b: Building): string {
    const dn = DISTRICT_NAMES[Math.floor(b.y / 10) * 4 + Math.floor(b.x / 10)] ?? 'Town';
    return `${1 + ((b.x * 7 + b.y * 13) % 96)} ${dn}`;
  }
  districtOf(b: { x: number; y: number }): string { return DISTRICT_NAMES[Math.floor(b.y / 10) * 4 + Math.floor(b.x / 10)] ?? 'Town'; }

  // ---------------------------------------------------------------- feed

  pushFeed(p: Person | null, text: string, tone: FeedItem['tone'] = 'info', kind = '', minGap = 0) {
    const t = this.ctx.t;
    if (minGap > 0 && kind) { const last = this.feedAt[kind] ?? -999; if (t - last < minGap) return; this.feedAt[kind] = t; }
    const it: FeedItem = { id: this.nextFeed++, t, pid: p ? p.id : 0, text, tone };
    this.feed.push(it);
    if (this.feed.length > 80) this.feed.shift();
    this.ctx.emit('life', it);
  }

  // ---------------------------------------------------------------- trips

  private idealTime(from: Building, to: Building): number {
    const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    return 5 + dist / SPEED_STREET;
  }

  /** begin a walking leg that the renderer can draw */
  setWalk(p: Person, x0: number, z0: number, x1: number, z1: number, dur: number) {
    p.walk = { x0, z0, x1, z1, t0: this.ctx.t, dur: Math.max(1, dur), path: null, pi: 0 };
  }
  private bpos(b: Building) { return { x: wx(b.x), z: wz(b.y) }; }

  startTrip(p: Person, from: Building, to: Building, nextState: Person['nextState'], midState: Person['state']) {
    const ctx = this.ctx, w = this.w;
    p.tripFrom = from; p.tripTo = to; p.tripStart = ctx.t; p.nextState = nextState;
    p.state = midState;
    p.charged = false;
    p.ride = null; p.car = null;
    if (p.at && p.at.guests.length) { const gi = p.at.guests.indexOf(p); if (gi >= 0) { p.at.guests.splice(gi, 1); p.at.visitors = p.at.guests.length; } }
    const dist = Math.hypot(from.x - to.x, from.y - to.y);
    p.tripIdeal = Math.max(8, this.idealTime(from, to));
    const pol = this.policies;
    // options
    let carCost = Infinity, carPath: number[] | null = null;
    if (from.access >= 0 && to.access >= 0) {
      const out = { cost: 0 };
      // use the quietest driveway out and any driveway in
      let oa = from.access, bestN = 99;
      for (const a of from.accessAll) { const n = this.traffic.tileCars[a].length + this.traffic.pending.length * 0; if (n < bestN) { bestN = n; oa = a; } }
      const da = to.accessAll[(this.ctx.rand() * to.accessAll.length) | 0] ?? to.access;
      carPath = this.traffic.router.find(oa, da, out);
      if (carPath) {
        // parking is scarce downtown
        carCost = out.cost + 4 + 20 * Math.pow(1 - w.centre[to.tile], 1.4);
        if (pol.toll && (w.centre[from.tile] < 0.32 || w.centre[to.tile] < 0.32)) carCost += 22;
        if (this.rain) carCost *= 1.1;
        carCost *= p.carBias;
        // the car queue at the origin counts too
        const pend = this.traffic.tileCars[carPath[0]].length;
        carCost += pend > 4 ? (pend - 4) * 2 : 0;
      }
    }
    let trCost = Infinity;
    let plan = null;
    if (dist > 2.5) {
      plan = this.transit.plan(from, to);
      if (plan) {
        trCost = plan.time + (plan.firstStop.queue.length > plan.firstStop.cap * 1.15 ? 70 : plan.firstStop.queue.length > plan.firstStop.cap * 0.8 ? 25 : 0);
        // ticket prices above or below the standard fare tilt the choice
        let fareDiff = 0;
        for (const lg of plan.legs) fareDiff += MODES[lg.line.kind].fare * (lg.line.fareMul - 1);
        trCost += fareDiff * 60 * (has(p, 'thrifty') ? 1.9 : 1) * (p.wallet < 20 ? 1.4 : 1);
        if (pol.freeTransit) trCost *= 0.8;
        if (this.rain) trCost *= 0.92;
      }
    }
    const walkCost = dist <= 6.5 ? (dist / WALK_SPEED) * 1.1 : Infinity;
    let mode: 1 | 2 | 3 | 4 = 4;
    if (carCost <= trCost && carCost <= walkCost && carCost < Infinity) mode = 1;
    else if (trCost <= walkCost && trCost < Infinity) mode = 2;
    else if (walkCost < Infinity) mode = 3;
    p.tripMode = mode;
    this.modeCount[mode === 4 ? 3 : mode - 1]++;
    if (mode === 1) {
      p.phase = 'drive';
      const col = [0xe9ecef, 0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0x9775fa, 0x343a40, 0xf783ac, 0xff922b, 0x63e6be, 0xced4da, 0x5c7cfa][p.color % 12];
      p.car = this.traffic.spawn(0, carPath!, col, p, null, ctx.t);
    } else if (mode === 2 && plan) {
      p.legs = plan.legs; p.leg = 0; p.phase = 'walkIn'; p.timer = plan.walkIn; p.walkOutT = plan.walkOut;
      p.stopRef = plan.firstStop; p.planTime = plan.time;
      const a = this.bpos(from);
      this.setWalk(p, a.x, a.z, plan.firstStop.x, plan.firstStop.z, plan.walkIn);
    } else if (mode === 3) {
      p.phase = 'walk'; p.timer = walkCost;
      const a = this.bpos(from), c = this.bpos(to);
      this.setWalk(p, a.x, a.z, c.x, c.z, walkCost);
    } else {
      // stuck: no road, no transit and far away
      p.phase = 'walk'; p.timer = Math.min(160, (dist / WALK_SPEED) * 1.15);
      const a = this.bpos(from), c = this.bpos(to);
      this.setWalk(p, a.x, a.z, c.x, c.z, p.timer);
    }
  }

  arrive(p: Person, v?: Vehicle) {
    if (p.dead) return;
    const t = this.ctx.t;
    const elapsed = t - p.tripStart;
    const ratio = elapsed / p.tripIdeal;
    const s = 1 - clamp((ratio - 1.6) / 2.6);
    p.sat += (s - p.sat) * 0.42;
    p.phase = 'none';
    p.legs = null;
    p.stopRef = null;
    p.ride = null; p.car = null; p.walk = null;
    const dest = p.tripTo ?? p.home;
    p.state = p.nextState;
    p.at = dest;
    if (dest === p.home) p.state = 'home';
    else if (p.state === 'work' && p.work !== dest) p.state = 'work';
    p.lastTrip = elapsed;
    this.stats.commute += (elapsed - this.stats.commute) * 0.02;
    if (v && this.policies.toll && (this.w.centre[dest.tile] < 0.32 || (p.tripFrom && this.w.centre[p.tripFrom.tile] < 0.32))) {
      this.onFee(1.4, 'toll');
    }
    if (p.state === 'leisure') this.enterVenue(p, dest);
    if (p.state === 'work') p.workDay = dayOf(t);
    if (p.state === 'home' || p.state === 'work') { /* settled */ }
  }

  strand(p: Person) {
    if (p.dead) return;
    const from = p.tripFrom ?? p.home, to = p.tripTo ?? p.home;
    const dist = Math.hypot(from.x - to.x, from.y - to.y);
    const here = this.positionOf(p);
    p.phase = 'walk';
    p.tripMode = 4;
    p.stopRef = null;
    p.legs = null;
    p.ride = null; p.car = null;
    p.timer = 5 + Math.min(70, dist / WALK_SPEED * 0.55);
    const dst = this.bpos(to);
    this.setWalk(p, here.x, here.z, dst.x, dst.z, p.timer);
    this.stats.stuck++;
  }

  /** how much a person feels like going out right now (1 = typical) */
  private outDrive(p: Person): number {
    const n = p.needs;
    let d = 0.55 + (0.66 - n.fun) * 1.7 + (0.62 - n.social) * 0.8;
    if (n.energy < 0.22) d *= 0.4;
    if (has(p, 'home')) d *= 0.55;
    if (has(p, 'social')) d *= 1.4;
    if (has(p, 'night')) d *= 1.1;
    if (p.age >= 75) d *= 0.7;
    if (this.rain) d *= 0.8;
    return clamp(d, 0.15, 2.6);
  }

  private personTick(p: Person, dt: number, hour: number, day: number) {
    switch (p.phase) {
      case 'walkIn':
        p.timer -= dt;
        if (p.timer <= 0) {
          const s = p.stopRef!;
          if (!this.transit.stopById.has(s.id)) { this.strand(p); return; }
          p.phase = 'wait';
          p.waitStart = this.ctx.t;
          p.walk = null;
          s.queue.push(p);
        }
        return;
      case 'walkOut':
      case 'walk':
        p.timer -= dt;
        if (p.timer <= 0) this.arrive(p);
        return;
      case 'none': break;
      default: return;
    }
    // schedule
    const t = this.ctx.t;
    if (p.state === 'home') {
      if (p.work && p.workDay !== day && !p.remote && hour >= p.workStart && hour < p.workEnd - 2) {
        if (hour - p.workStart < 3) { this.startTrip(p, p.home, p.work, 'work', 'toWork'); p.workDay = day; }
      } else if (hour >= 10 && hour < 21.5 && p.leisureDone !== day && (!p.work || p.remote || hour > p.workEnd + 0.2) && p.needs.energy > 0.1 && this.ctx.rand() < dt * 0.02 * this.outDrive(p)) {
        this.leisureTrip(p, day);
      } else if (this.eventTile >= 0 && t < this.eventUntil && p.leisureDone !== day && this.ctx.rand() < dt * 0.005) {
        this.leisureTrip(p, day, true);
      } else if (this.matchTile >= 0 && t < this.matchUntil && p.leisureDone !== day && p.stage !== 'child' && this.ctx.rand() < dt * 0.012) {
        const arena = this.buildings.get(this.w.bld[this.matchTile]);
        if (arena) {
          p.leisureDone = day;
          p.leisureEnd = 21.5 + this.ctx.rand() * 0.7;
          this.startTrip(p, p.home, arena, 'leisure', 'toLeisure');
        }
      }
    } else if (p.state === 'work') {
      const from = p.at ?? p.work ?? p.home;
      if (hour >= p.workEnd || hour < 3 || !p.work) {
        if (p.leisureDone !== day && this.ctx.rand() < p.leisure * Math.min(1.5, this.outDrive(p)) && hour < 20 && from !== p.home) {
          p.leisureDone = day;
          const dest = this.pickLeisure(p);
          if (dest) { this.startTrip(p, from, dest, 'leisure', 'toLeisure'); p.leisureEnd = Math.min(23, hour + 1 + this.ctx.rand() * 1.8); return; }
        }
        if (from === p.home) { p.state = 'home'; return; }
        this.startTrip(p, from, p.home, 'home', 'toHome');
      }
    } else if (p.state === 'leisure') {
      if (hour >= p.leisureEnd || hour < 3) {
        const at = p.at ?? p.home;
        this.leaveVenue(p);
        if (at === p.home) { p.state = 'home'; return; }
        this.startTrip(p, at, p.home, 'home', 'toHome');
      }
    }
  }

  private leisureTrip(p: Person, day: number, event = false) {
    const dest = event && this.eventTile >= 0 ? this.buildings.get(this.w.bld[this.eventTile]) ?? this.pickLeisure(p) : this.pickLeisure(p);
    if (!dest) return;
    p.leisureDone = day;
    p.leisureEnd = Math.min(23, dayHour(this.ctx.t) + 1 + this.ctx.rand() * 1.8 + (has(p, 'night') ? 0.8 : 0));
    this.startTrip(p, p.home, dest, 'leisure', 'toLeisure');
  }

  /** choose where to go out: the place that fills what they are missing, near and busy with people they like */
  private pickLeisure(p: Person): Building | null {
    const hour = dayHour(this.ctx.t);
    const n = p.needs;
    const mealtime = (hour >= 11 && hour < 14.5) || (hour >= 17 && hour < 21.5);
    const wFun = (1 - n.fun) + 0.1, wSoc = (1 - n.social) * (has(p, 'social') ? 1.5 : 1) + 0.05;
    let wEat = (1 - n.hunger) * (mealtime ? 1.1 : 0.35) * (has(p, 'foodie') ? 1.6 : 1);
    if (hour >= 17 && hour < 20.5 && n.hunger < 0.7) wEat += 0.35;
    const mature = p.age >= 18;
    let best: Building | null = null, bs = -1;
    let count = 0;
    for (const b of this.buildings.values()) {
      if (b.kind !== 'com' || b.access < 0 || b.venue === 'office' || b.special === 'school') continue;
      if (b.special === 'clinic') continue;
      if (b.venue === 'bar' && !mature) continue;
      if ((++count & 1) === 0 && this.buildings.size > 20) continue;
      const v = VENUES[b.venue ?? 'shop'];
      let gain = v.fun * wFun + v.hunger * wEat + v.social * wSoc;
      if (has(p, 'sporty') && b.venue === 'gym') gain *= 2;
      if (b.special === 'airport') gain *= 1.5;
      if (b.guests.length && p.friends.length) { for (const g of b.guests) if (p.friends.includes(g.id)) { gain *= 1.5; break; } }
      const d = Math.hypot(b.x - p.home.x, b.y - p.home.y);
      const s = (this.ctx.rand() + 0.2) * (0.42 + gain) * (1 + b.level * 0.3) / Math.pow(d + 4, 1.4);
      if (s > bs) { bs = s; best = b; }
    }
    // seniors sometimes go for a check-up
    if (p.stage === 'senior' && this.ctx.rand() < 0.12) {
      for (const c of this.buildings.values()) if (c.special === 'clinic' && c.access >= 0 && Math.hypot(c.x - p.home.x, c.y - p.home.y) < 16) return c;
    }
    return best;
  }

  visits = 0;
  private enterVenue(p: Person, b: Building) {
    this.visits++;
    b.guests.push(p);
    b.visitors = b.guests.length;
    const v = VENUES[b.venue ?? 'shop'];
    const sIdx = sellsIdx(b);
    if (sIdx >= 0) {
      if (b.stock[sIdx] >= 0.3) { b.stock[sIdx] -= 0.3; this.soldLocal += 0.3; } else this.importsDay += 0.3;
    }
    if (b.special === 'clinic') { p.needs.comfort = clamp(p.needs.comfort + 0.12); logLife(p, this.ctx.t, `Had a check-up at ${b.name}.`); return; }
    this.onFee(b.special === 'arena' ? 3.2 : (this.policies.remote ? 0.6 : 0.9) * Math.max(0.6, v.price), b.special === 'arena' ? 'match' : 'shopping');
    // meet people
    if (b.guests.length > 1 && p.friends.length < 5) {
      const o = b.guests[Math.floor(this.ctx.rand() * (b.guests.length - 1))];
      if (o !== p && !o.dead && !p.friends.includes(o.id) && o.friends.length < 5 && this.ctx.rand() < (has(p, 'social') ? 0.3 : 0.1) * (has(p, 'home') ? 0.5 : 1)) {
        p.friends.push(o.id); o.friends.push(p.id);
        logLife(p, this.ctx.t, `Made a friend: ${fullName(o)}, at ${b.name}.`);
        logLife(o, this.ctx.t, `Made a friend: ${fullName(p)}, at ${b.name}.`);
        this.pushFeed(p, `${p.first} and ${o.first} became friends at ${b.name}.`, 'good', 'friend', 6);
      }
    }
  }
  private leaveVenue(p: Person) {
    const at = p.at;
    if (!at) return;
    const i = at.guests.indexOf(p);
    if (i >= 0) at.guests.splice(i, 1);
    at.visitors = at.guests.length;
  }

  // ---------------------------------------------------------------- industry and cargo

  /** every industry and cargo-selling shop, kept fresh when buildings change */
  cargoSites(): Building[] {
    if (this.sitesDirty) { this.sites = [...this.buildings.values()].filter(isSite); this.sitesDirty = false; }
    return this.sites;
  }
  sitesNear(x: number, z: number, r = CATCH): Building[] {
    const out: Building[] = [];
    for (const b of this.cargoSites()) if (Math.hypot(wx(b.x) - x, wz(b.y) - z) <= r) out.push(b);
    return out;
  }
  takeImports(): number { const n = this.importsDay; this.importsDay = 0; return n; }

  /** lay out the starting farm, quarry, factory and cargo terminal at the ends of the first streets */
  spawnIndustries(cx: number, cy: number) {
    const w = this.w;
    const wants: { kind: 'farm' | 'quarry' | 'factory' | 'terminal'; ax: number; ay: number }[] = [
      { kind: 'farm', ax: cx + 7, ay: cy }, { kind: 'quarry', ax: cx - 7, ay: cy }, { kind: 'factory', ax: cx, ay: cy + 7 }, { kind: 'terminal', ax: cx, ay: cy - 7 },
    ];
    for (const wnt of wants) {
      let best = -1, bd = 99;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = wnt.ax + dx, y = wnt.ay + dy;
        if (!inMap(x, y)) continue;
        const i = tileIdx(x, y);
        if (!w.buildable(i) || !w.isEmpty(i) || w.rail[i] !== 0) continue;
        const rf = this.roadFor({ x, y });
        if (rf.tile < 0) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0) continue;
      const b = this.addBuilding(tileX(best), tileY(best), 'ind', 2, wnt.kind);
      b.born = this.ctx.t - 400;
    }
  }

  /** once a second: farms grow, quarries dig, factories turn stone into goods */
  private industryTick(dt: number) {
    for (const b of this.cargoSites()) {
      if (!isIndustry(b.special) || b.special === 'terminal') continue;
      const F = FACILITY[b.special as 'farm' | 'quarry' | 'factory'];
      const staff = Math.min(1, 0.45 + b.workers.length / Math.max(1, b.cap) * 0.7);
      const rate = F.rate * b.eff * staff / DAY * dt;
      if (F.takes.length) {
        const take = Math.min(b.stock[F.takes[0]], rate, OUT_CAP - b.out[F.makes]);
        if (take > 0) { b.stock[F.takes[0]] -= take; b.out[F.makes] += take; b.made += take; }
      } else {
        const add = Math.min(rate, OUT_CAP - b.out[F.makes]);
        if (add > 0) { b.out[F.makes] += add; b.made += add; }
      }
    }
  }

  /** the daily review: facilities that get collected from grow, neglected ones shrink */
  private industryDay() {
    for (const b of this.cargoSites()) {
      if (!isIndustry(b.special) || b.special === 'terminal') continue;
      if (b.made > 2) {
        const ratio = b.picked / b.made;
        if (ratio > 0.65) b.eff = Math.min(1.9, b.eff + 0.1);
        else if (ratio < 0.15 && b.eff > 0.6) b.eff = Math.max(0.6, b.eff - 0.06);
      }
      b.made = 0; b.picked = 0;
    }
  }

  // ---------------------------------------------------------------- where a person is

  /** world position of a citizen right now; `inside` when they are in a building */
  positionOf(p: Person, out: { x: number; z: number; inside: boolean } = { x: 0, z: 0, inside: false }): { x: number; z: number; inside: boolean } {
    const t = this.ctx.t;
    out.inside = false;
    const seg = () => {
      const w = p.walk;
      if (!w) return false;
      const k = clamp((t - w.t0) / w.dur);
      out.x = lerp(w.x0, w.x1, k); out.z = lerp(w.z0, w.z1, k);
      return true;
    };
    switch (p.phase) {
      case 'drive':
        if (p.car && !p.car.dead) { out.x = p.car.x; out.z = p.car.z; return out; }
        break;
      case 'ride':
        if (p.ride) { const c = this.transit.carrierPos(p.ride); out.x = c.x; out.z = c.z; return out; }
        break;
      case 'wait':
        if (p.stopRef) { out.x = p.stopRef.x; out.z = p.stopRef.z; return out; }
        break;
      case 'walkIn': case 'walkOut': case 'walk':
        if (seg()) return out;
        break;
    }
    const b = p.at ?? p.home;
    out.x = wx(b.x); out.z = wz(b.y); out.inside = true;
    return out;
  }

  // ---------------------------------------------------------------- inner life

  private sleepWindow(p: Person, hour: number): boolean {
    if (has(p, 'night')) return hour >= 0.5 && hour < 8.0;
    if (has(p, 'early')) return hour >= 22 || hour < 5.5;
    return hour >= 23 || hour < 6.3;
  }

  /** one second of sim time of needs for everyone: hunger, energy, fun, social, comfort */
  private updateNeeds(dt: number) {
    const hrs = dt / (DAY / 24), hour = hourOf(this.ctx.t);
    const lunch = hour >= 12 && hour < 13.5;
    const meal = (hour >= 6.4 && hour < 8.6) || lunch || (hour >= 18 && hour < 20.2);
    for (const p of this.persons) {
      if (p.dead) continue;
      const n = p.needs;
      const idle = p.phase === 'none';
      const atHome = idle && p.state === 'home';
      const sleeping = atHome && this.sleepWindow(p, hour);
      const v = idle && p.state === 'leisure' && p.at && p.at.venue ? VENUES[p.at.venue] : null;
      const working = idle && p.state === 'work' && p.at === p.work;
      // energy
      n.energy += (sleeping ? 0.22 : -0.034) * hrs;
      // hunger
      let hg = sleeping ? -0.02 : has(p, 'foodie') ? -0.09 : -0.07;
      if (atHome && meal && !sleeping) hg += 0.95;
      else if (working && lunch) hg += 0.62;
      else if (v) hg += v.hunger;
      n.hunger += hg * hrs;
      // fun
      let fn = sleeping ? -0.005 : -0.032;
      if (atHome && !sleeping) fn += 0.03 * (1 + 1.5 * p.home.park);
      if (v) fn += v.fun + (has(p, 'foodie') ? v.hunger * 0.15 : 0);
      n.fun += fn * hrs;
      // social
      let sc = sleeping ? 0 : -0.03 * (has(p, 'home') ? 0.65 : has(p, 'social') ? 1.35 : 1);
      if (atHome && !sleeping) { let mates = 0; for (const m of p.hh.members) if (m !== p && m.phase === 'none' && m.state === 'home') mates++; sc += 0.04 * Math.min(2, mates); }
      else if (working) sc += 0.03;
      else if (v) { let fr = 1; for (let k = 0; k < p.at!.guests.length && k < 12; k++) if (p.friends.includes(p.at!.guests[k].id)) { fr = 1.4; break; } sc += v.social * fr * (p.at!.guests.length > 1 ? 1 : 0.5); }
      n.social += sc * hrs;
      // comfort drifts toward how their home, commute and finances feel
      const school = p.stage === 'child' || p.stage === 'teen' ? 0 : 0;
      const target = 0.4 + 0.42 * p.home.land + 0.2 * p.sat - 0.16 * this.stats.smog - (p.wallet < 0 ? 0.15 : 0) + 0.06 * p.home.clinic * (p.stage === 'senior' ? 2 : 1) + school;
      n.comfort += (clamp(target) - n.comfort) * Math.min(1, 0.15 * hrs);
      n.energy = clamp(n.energy); n.hunger = clamp(n.hunger); n.fun = clamp(n.fun); n.social = clamp(n.social); n.comfort = clamp(n.comfort);
      p.mood = moodOf(p);
    }
  }

  /** a new day: pay, promotions, birthdays, babies, goodbyes */
  private dayTick(day: number) {
    const r = this.ctx.rand, t = this.ctx.t;
    const rf = this.policies.remote ? 0.18 : 0.02;
    const list = [...this.persons];
    for (const p of list) {
      if (p.dead) continue;
      p.remote = p.stage === 'adult' && r() < rf;
      if (p.stage === 'adult') {
        const worked = p.work && !p.student && p.workDay >= day - 1;
        if (worked) {
          p.wallet += p.wage;
          p.xp += has(p, 'driven') ? 1.4 : 1;
          const j = jobFor(p.work!, p.xp, p);
          if (j.title !== p.title) {
            const was = p.title;
            p.title = j.title; p.wage = j.wage;
            if (was) { logLife(p, t, `Promoted to ${j.title.toLowerCase()}.`); this.pushFeed(p, `${fullName(p)} was promoted to ${j.title.toLowerCase()} at ${p.work!.name}.`, 'good', 'promo', 8); }
          } else p.wage = j.wage;
        } else if (!p.work) p.wallet += 3;
        p.wallet -= 5 + 9 * p.home.land;
      } else if (p.stage === 'senior') p.wallet += 6 - (5 + 5 * p.home.land);
      p.wallet = clamp(p.wallet, -80, 9999);
      if (p.wallet < 0 && p.wallet > -9 && r() < 0.3) logLife(p, t, 'Money is tight.');
      if ((day + p.id) % 3 === 0) this.birthday(p);
    }
    // jobless adults look again, pupils find places
    for (const p of this.persons) if (!p.work) this.occupy(p);
    // coworkers become friends
    for (let k = 0; k < 24 && this.persons.length > 4; k++) {
      const p = this.persons[Math.floor(r() * this.persons.length)];
      if (!p.work || p.student || p.friends.length >= 5) continue;
      const mates = p.work.workers;
      const o = mates[Math.floor(r() * mates.length)];
      if (o && o !== p && !p.friends.includes(o.id) && o.friends.length < 5 && r() < 0.35) {
        p.friends.push(o.id); o.friends.push(p.id);
        logLife(p, t, `Became friends with ${fullName(o)} from work.`);
        logLife(o, t, `Became friends with ${fullName(p)} from work.`);
      }
    }
    // babies
    for (const hh of [...this.households.values()]) {
      if ((day + hh.id) % 3 !== 0 || hh.members.length >= 5 || hh.home.residents.length >= hh.home.cap) continue;
      const parents = hh.members.filter((m) => m.stage === 'adult' && m.age >= 22 && m.age <= 42);
      if (parents.length < 2) continue;
      let mood = 0;
      for (const m of hh.members) mood += m.mood;
      if (mood / hh.members.length < 0.5 || r() > 0.13) continue;
      const baby = this.createPerson(hh.home, { age: 0, hh });
      logLife(baby, t, `Born in ${this.addressOf(hh.home)}.`);
      for (const q of parents) logLife(q, t, `Welcomed a baby: ${baby.first}.`);
      this.pushFeed(baby, `A baby, ${baby.first}, was born to the ${hh.last} family.`, 'good', 'birth', 5);
    }
  }

  private birthday(p: Person) {
    const r = this.ctx.rand, t = this.ctx.t;
    p.age++;
    const ns = stageOf(p.age);
    if (p.age === 5 && p.stage === 'child') { this.assignSchool(p); }
    if (ns !== p.stage) {
      const old = p.stage;
      p.stage = ns;
      if (old === 'teen' && ns === 'adult') {
        this.leaveWork(p);
        logLife(p, t, 'Turned 18.');
        this.assignJob(p);
        this.pushFeed(p, `${fullName(p)} turned 18${p.work ? ` and started work at ${p.work.name}` : ' and is looking for a first job'}.`, 'info', 'adult', 6);
      } else if (ns === 'teen') { logLife(p, t, 'Became a teenager.'); }
      else if (ns === 'senior') {
        if (p.work) this.leaveWork(p);
        logLife(p, t, 'Retired.');
        this.pushFeed(p, `${fullName(p)} retired at ${p.age}.`, 'info', 'retire', 8);
      }
    }
    if (p.age >= 60) {
      const hazard = 0.004 * Math.pow(1.12, p.age - 60) * (1 - 0.4 * p.home.clinic);
      if (r() < hazard) this.die(p);
    }
  }

  private die(p: Person) {
    const t = this.ctx.t;
    for (const m of p.hh.members) if (m !== p) { m.needs.comfort = clamp(m.needs.comfort - 0.18); m.needs.social = clamp(m.needs.social - 0.1); logLife(m, t, `${fullName(p)} passed away.`); }
    for (const f of p.friends) { const o = this.persons.find((q) => q.id === f); if (o) { o.friends = o.friends.filter((x) => x !== p.id); logLife(o, t, `${fullName(p)} passed away.`); } }
    this.pushFeed(p, `${fullName(p)}, ${p.age}, passed away.`, 'warn', 'death', 6);
    this.leaveVenue(p);
    this.leaveWork(p);
    this.removePerson(p, 'died');
  }

  // ---------------------------------------------------------------- what they think and want

  /** what a citizen is doing, in words */
  activityOf(p: Person, hour: number): string {
    const name = (b: Building | null) => (b ? (b.kind === 'res' ? (b === p.home ? 'home' : `the ${b.residents[0]?.last ?? ''} house`) : b.name) : 'somewhere');
    const dest = p.tripTo ? name(p.tripTo) : 'their destination';
    const verb = (st: Person['state']) => (st === 'toWork' ? (p.student ? 'school' : 'work') : st === 'toHome' ? 'home' : dest);
    const to = verb(p.state);
    const lineName = p.legs?.[p.leg]?.line.name ?? 'the line';
    switch (p.phase) {
      case 'drive': return `Driving ${to === 'home' ? 'home' : 'to ' + to}`;
      case 'ride': return `Riding ${lineName} ${to === 'home' ? 'home' : 'to ' + to}`;
      case 'wait': return `Waiting for ${lineName} at ${p.stopRef?.name ?? 'the stop'}`;
      case 'walkIn': return `Walking to ${p.stopRef?.name ?? 'the stop'}`;
      case 'walkOut': case 'walk': return `Walking ${to === 'home' ? 'home' : 'to ' + to}`;
    }
    if (p.state === 'work') return p.student ? `At ${p.work?.name ?? 'school'}` : p.at === p.work ? `Working at ${p.work?.name ?? 'work'}` : 'Between places';
    if (p.state === 'leisure') { const b = p.at; const v = b?.venue; return b ? `${v === 'cafe' ? 'Having a coffee' : v === 'diner' ? 'Eating out' : v === 'cinema' ? 'Watching a film' : v === 'bar' ? 'Out for a drink' : v === 'gym' ? 'Working out' : b.special === 'arena' ? 'At the match' : b.special === 'clinic' ? 'At the clinic' : b.special === 'airport' ? 'Watching the planes' : 'Shopping'} at ${b.name}` : 'Out'; }
    if (this.sleepWindow(p, hour)) return 'Sleeping';
    if (p.remote) return 'Working from home';
    if ((hour >= 6.4 && hour < 8.6) && hour < p.workStart + 1.2) return 'Having breakfast';
    if (hour >= 12 && hour < 13.5) return 'Having lunch';
    if (hour >= 18 && hour < 20.2) return 'Having dinner';
    if (p.stage === 'child' && p.age < 5) return 'Playing at home';
    return hour > 21 ? 'Winding down at home' : 'At home';
  }

  /** the thing on their mind */
  thoughtOf(p: Person): string {
    const n = p.needs;
    const lastWait = p.phase === 'wait' ? this.ctx.t - p.waitStart : 0;
    if (p.phase === 'wait' && lastWait > 40) return `Still waiting for ${p.legs?.[p.leg]?.line.name ?? 'the bus'}. ${Math.round(lastWait)} seconds now.`;
    if (p.phase === 'wait' && p.stopRef && p.stopRef.queue.length > p.stopRef.cap) return 'This stop is packed. Is anything coming?';
    if (p.phase === 'drive' && p.car && p.car.speed < 0.05 && p.car.stuck > 3) return 'Stuck in traffic again.';
    if (n.hunger < 0.22) return 'I am starving. Where can I get something to eat?';
    if (n.energy < 0.18 && p.state !== 'home') return 'I could fall asleep standing up.';
    if (n.fun < 0.2) return 'There is nothing to do around here.';
    if (n.social < 0.2) return 'I have not talked to anyone in days.';
    if (p.stage === 'adult' && !p.work) return 'I need a job. Nothing within reach is hiring.';
    if (p.work && p.lastTrip > 120) return 'That commute is too long. There has to be a better way.';
    if (p.wallet < 0) return 'Money is tight this week.';
    if (p.home.land < 0.28) return 'This neighbourhood has seen better days.';
    if (this.rain && p.phase !== 'none') return 'Of course it rains on my commute.';
    if (p.mood > 0.78) return has(p, 'sunny') ? 'Life is good. Really good.' : 'Not a bad day at all.';
    if (p.mood > 0.6) return p.state === 'leisure' ? 'Nice to get out for a bit.' : 'Getting by just fine.';
    if (p.mood > 0.42) return 'Could be better. Could be worse.';
    return 'I am so done with this city.';
  }

  wantsOf(p: Person): string[] {
    const out: string[] = [];
    const home = p.home;
    if (p.stage === 'adult' && !p.work) out.push('A job');
    if (isPupil(p) && !p.work) out.push('A school nearby');
    if (p.work && p.lastTrip > 105) out.push('A shorter commute');
    if (this.parkNear(home.x, home.y, 5) < 0.2 && p.needs.fun < 0.75) out.push('A park nearby');
    if (p.needs.hunger < 0.65 || has(p, 'foodie')) { let food = false; for (const b of this.buildings.values()) if (b.kind === 'com' && (b.venue === 'cafe' || b.venue === 'diner' || b.venue === 'mall') && Math.hypot(b.x - home.x, b.y - home.y) < 9) { food = true; break; } if (!food) out.push('Somewhere to eat nearby'); }
    if (p.stage === 'senior' && this.clinicCover(home) < 0.15) out.push('A clinic nearby');
    if (p.needs.social < 0.45 && this.transit.coverage(home.x, home.y) < 0.05) out.push('Transit near home');
    if (p.needs.fun < 0.45) out.push('Something fun to do');
    return out.slice(0, 3);
  }

  // ---------------------------------------------------------------- growth

  private candidates(): number[] {
    if (!this.candDirty) return this.cand;
    const w = this.w;
    const c: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (!w.buildable(i) || !w.isEmpty(i) || w.rail[i] !== 0) continue;
      let ok = false;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inMap(nx, ny) && w.road[tileIdx(nx, ny)]) { ok = true; break; }
      }
      if (ok) c.push(i);
    }
    this.cand = c;
    this.candDirty = false;
    return c;
  }

  markDirty() { this.candDirty = true; }

  parkNear(x: number, y: number, r = 4): number {
    const w = this.w;
    let n = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(N - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(N - 1, x + r); xx++) {
      if (w.park[tileIdx(xx, yy)] && Math.hypot(xx - x, yy - y) <= r) n++;
    }
    return clamp(n / 3);
  }

  landValue(b: Building): number {
    const w = this.w;
    const cov = this.transit.coverage(b.x, b.y);
    const park = this.parkNear(b.x, b.y, 4);
    let load = 0, cn = 0;
    for (let d = 0; d < 4; d++) {
      const nx = b.x + DX[d], ny = b.y + DY[d];
      if (inMap(nx, ny) && w.road[tileIdx(nx, ny)]) { load += this.traffic.load[tileIdx(nx, ny)]; cn++; }
    }
    load = cn ? load / cn : 0;
    let indNear = 0;
    if (b.kind === 'res') {
      for (let yy = Math.max(0, b.y - 3); yy <= Math.min(N - 1, b.y + 3); yy++) for (let xx = Math.max(0, b.x - 3); xx <= Math.min(N - 1, b.x + 3); xx++) {
        const bid = w.bld[tileIdx(xx, yy)];
        if (bid >= 0 && this.buildings.get(bid)?.kind === 'ind') indNear++;
      }
    }
    const lv = 0.28 + 0.34 * (1 - w.centre[b.tile]) + 0.3 * cov + 0.13 * park - 0.2 * load - Math.min(0.2, indNear * 0.04) + (b.happy - 0.6) * 0.12;
    b.land = clamp(lv);
    return b.land;
  }

  private amenT = 0;
  /** park and clinic reach for every home, refreshed a few times a minute */
  private refreshAmenities() {
    const clinics = [...this.buildings.values()].filter((c) => c.special === 'clinic');
    for (const b of this.buildings.values()) {
      if (b.kind !== 'res') continue;
      b.park = this.parkNear(b.x, b.y, 4);
      let best = 0;
      for (const c of clinics) best = Math.max(best, 1 - Math.hypot(c.x - b.x, c.y - b.y) / 14);
      b.clinic = clamp(best);
    }
  }

  updateStats() {
    const s = this.stats;
    if (this.amenT <= 0) { this.amenT = 3; this.refreshAmenities(); } else this.amenT--;
    let pop = 0, employed = 0, jobs = 0, housing = 0, comJ = 0, indJ = 0, satSum = 0, moodSum = 0;
    let adults = 0, kids = 0, seniors = 0, pupils = 0, schools = 0, clinics = 0;
    s.levels = [0, 0, 0];
    for (const b of this.buildings.values()) {
      s.levels[b.level - 1]++;
      if (b.kind === 'res') {
        housing += b.cap;
        let sat = 0;
        for (const p of b.residents) sat += feel(p);
        b.happy = b.residents.length ? sat / b.residents.length : 0.8;
        if (b.access < 0) b.cutoff += 1; else b.cutoff = 0;
      } else {
        jobs += b.cap;
        if (b.kind === 'com') comJ += b.cap; else indJ += b.cap;
        employed += b.workers.length;
        if (b.special === 'school') schools++;
        if (b.special === 'clinic') clinics++;
      }
    }
    for (const p of this.persons) {
      pop++; satSum += feel(p); moodSum += p.mood;
      if (p.stage === 'adult') adults++; else if (p.stage === 'senior') seniors++; else kids++;
      if (p.student) pupils++;
    }
    s.pop = pop; s.employed = employed; s.unemployed = Math.max(0, adults - employed);
    s.adults = adults; s.kids = kids; s.seniors = seniors; s.pupils = pupils; s.schools = schools; s.clinics = clinics;
    s.jobs = jobs; s.housing = housing; s.buildings = this.buildings.size;
    s.sat = pop ? satSum / pop : 0.8;
    s.mood = pop ? moodSum / pop : 0.7;
    // mode share over a decaying window
    const m = this.modeCount;
    for (let k = 0; k < 4; k++) { this.modeWindow[k] = this.modeWindow[k] * 0.9 + m[k]; m[k] = 0; }
    const tot = this.modeWindow[0] + this.modeWindow[1] + this.modeWindow[2] + this.modeWindow[3] + 1e-6;
    s.car = this.modeWindow[0] / tot; s.transit = this.modeWindow[1] / tot; s.walk = (this.modeWindow[2] + this.modeWindow[3]) / tot;
    s.trips = tot;
    // demand
    const wanted = Math.max(8, adults * 0.9);
    const jobRatio = jobs / wanted;
    const fill = housing > 0 ? pop / housing : 1;
    const dr = clamp(clamp((fill - 0.7) * 3) * 0.9 + clamp((jobRatio - 1) * 1.5) * 0.5 + 0.06);
    const dc = clamp(1 - comJ / (pop * 0.3 + 6)) * 0.85 + (jobRatio < 1 ? 0.2 : 0);
    const di = clamp(1 - indJ / (pop * 0.22 + 6)) * 0.8 * (jobRatio < 1.6 ? 1 : 0.4);
    s.demand = { r: dr, c: clamp(dc), i: di };
    // air: exhaust from traffic and industry, soaked up by parks
    {
      let emit = 0;
      for (const v of this.traffic.vehicles) {
        if (v.kind === 0) emit += 0.65;
        else { const k = v.carrier?.line.kind ?? 'bus'; emit += (k === 'truck' ? 2.2 : 1.1) * (1 - 0.16 * this.cleanLevel(k)); }
      }
      for (const b of this.buildings.values()) if (b.kind === 'ind') emit += b.special === 'factory' ? 3.5 : b.special ? 1.5 : 1.8;
      let parks = 0;
      const wd = this.w;
      for (let i = 0; i < N * N; i++) if (wd.park[i]) parks++;
      const tgt = clamp((emit - parks * 0.9) / (45 + pop / 18)) * 0.95;
      s.smog += (tgt - s.smog) * 0.12;
    }
    // what residents are asking for: a rolling sample
    if (pop > 8) {
      const cnt: Record<string, number> = {};
      const K = Math.min(36, pop);
      for (let k = 0; k < K; k++) { const p = this.persons[Math.floor(this.ctx.rand() * pop)]; for (const w of this.wantsOf(p)) cnt[w] = (cnt[w] ?? 0) + 1; }
      for (const key of new Set([...Object.keys(cnt), ...Object.keys(this.wantFrac)])) {
        const f = (this.wantFrac[key] ?? 0) * 0.94 + 0.06 * ((cnt[key] ?? 0) / K);
        if (f < 0.004) delete this.wantFrac[key]; else this.wantFrac[key] = f;
      }
    }
  }

  step(dt: number) {
    const t = this.ctx.t;
    const hour = hourOf(t), day = dayOf(t);
    this.tick++;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.dayTick(day);
      this.industryDay();
      this.ctx.emit('newDay', day);
    }
    // people
    const ps = this.persons;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.dead) continue;
      this.personTick(p, dt, hour, day);
    }
    // unemployed look for jobs
    this.jobQueue.length = 0;
    this.immT += dt;
    if (this.immT > 1.5) { this.immT = 0; this.migrate(); }
    this.growthT += dt;
    const interval = clamp(5.2 / (this.growthBoost * (0.35 + this.growthFactor())), 0.9, 12);
    if (this.growthT > interval) { this.growthT = 0; this.spawnBuilding(); }
    this.upT += dt;
    if (this.upT > 1.6) { this.upT = 0; this.upgradeStep(); }
    this.statT += dt;
    if (this.statT > 1) { this.statT = 0; this.updateStats(); }
    this.needsT += dt;
    if (this.needsT >= 1) { this.updateNeeds(this.needsT); this.industryTick(this.needsT); this.needsT = 0; }
  }

  /** 0..1.2: how strongly the city wants to grow right now */
  growthFactor(): number {
    const s = this.stats;
    const sat = clamp((s.sat - 0.2) / 0.6);
    const stab = clamp(this.stability / 60);
    return (0.45 + 0.55 * sat) * (0.4 + 0.6 * stab);
  }

  private spawnBuilding() {
    const s = this.stats;
    const cand = this.candidates();
    if (!cand.length) return;
    const dm = s.demand;
    // choose a zone
    const wR = 0.05 + dm.r, wC = 0.04 + dm.c * 0.8, wI = 0.03 + dm.i * 0.6;
    let r = this.ctx.rand() * (wR + wC + wI);
    const kind: Kind = r < wR ? 'res' : r < wR + wC ? 'com' : 'ind';
    // sample candidate tiles and score them
    const w = this.w;
    let bestI = -1, bestS = -1;
    for (let k = 0; k < 40; k++) {
      const i = cand[Math.floor(this.ctx.rand() * cand.length)];
      const x = tileX(i), y = tileY(i);
      let nb = 0, rd = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inMap(nx, ny)) { if (w.road[tileIdx(nx, ny)]) rd += w.road[tileIdx(nx, ny)]; if (w.bld[tileIdx(nx, ny)] >= 0) nb++; }
      }
      const c = w.centre[i], ind = w.industrial[i];
      let f: number;
      if (kind === 'res') f = 0.5 + smoothstep(0.1, 0.45, c) * (1 - smoothstep(0.7, 1.0, c)) * 0.8 + (1 - ind) * 0.4 + this.parkNear(x, y, 4) * 0.4;
      else if (kind === 'com') f = 0.3 + (1 - smoothstep(0.1, 0.7, c)) * 1.2 + rd * 0.12;
      else f = 0.2 + ind * 1.3 + smoothstep(0.35, 0.9, c) * 0.5;
      f *= 0.55 + nb * 0.25 + this.ctx.rand() * 0.5;
      if (f > bestS) { bestS = f; bestI = i; }
    }
    if (bestI < 0) return;
    this.addBuilding(tileX(bestI), tileY(bestI), kind, 1);
  }

  private upgradeStep() {
    const s = this.stats;
    const arr = [...this.buildings.values()];
    if (!arr.length) return;
    for (let k = 0; k < 4; k++) {
      const b = arr[Math.floor(this.ctx.rand() * arr.length)];
      if (b.level >= 3 || b.special || this.ctx.t - b.lastLevel < 55 || this.ctx.t - b.born < 25) continue;
      const lv = this.landValue(b);
      const need = b.level === 1 ? 0.5 : 0.7;
      const dm = b.kind === 'res' ? s.demand.r : b.kind === 'com' ? s.demand.c : s.demand.i;
      if (lv < need || (b.kind === 'res' && b.happy < 0.4) || dm < 0.08 + 0.05 * b.level) continue;
      if (b.level === 2) {
        // towers need transit within reach and a bit of civic pride
        if (this.transit.coverage(b.x, b.y) < 0.3 || dayOf(this.ctx.t) < 3) continue;
      }
      if (b.access < 0) continue;
      if (this.ctx.rand() < 0.5) this.levelUp(b);
    }
  }

  private migrate() {
    const s = this.stats;
    const att = this.growthFactor() * this.growthBoost;
    const rnd = this.ctx.rand;
    // households leave when it is truly miserable
    if (s.sat < 0.22 && this.persons.length > 20 && rnd() < 0.5) {
      const p = this.persons[Math.floor(rnd() * this.persons.length)];
      if (feel(p) < 0.3 && p.state === 'home' && p.phase === 'none') {
        this.pushFeed(p, `${p.hh.members.length > 1 ? `The ${p.hh.last} family` : fullName(p)} gave up on the city and left.`, 'bad', 'leave', 5);
        this.removeHousehold(p.hh);
        this.ctx.emit('emigrate');
      }
    }
    // move-ins
    const homes: Building[] = [];
    for (const b of this.buildings.values()) if (b.kind === 'res' && b.residents.length < b.cap && b.access >= 0) homes.push(b);
    if (homes.length) {
      const n = 1 + Math.floor(att * 3 * rnd());
      for (let k = 0; k < n; k++) {
        // favour places with good land value
        const b = homes[Math.floor(rnd() * homes.length)];
        if (b.residents.length >= b.cap) continue;
        if (b.land < 0.18 && rnd() < 0.7) continue;
        const free = b.cap - b.residents.length;
        const x = rnd();
        const size = Math.min(free, x < 0.34 ? 1 : x < 0.66 ? 2 : x < 0.86 ? 3 : 4);
        this.createHousehold(b, size);
        b.glow = 1;
      }
    }
    // jobless find work as vacancies appear
    let tries = 0;
    for (const p of this.persons) {
      if (!p.work && tries < 8 && (p.stage === 'adult' || isPupil(p))) { tries++; this.occupy(p); }
    }
  }
}

const NAME_WORDS_IND = ['Alder', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Grove', 'Harbor', 'Juniper', 'Kestrel', 'Linden', 'Maple', 'Orchard', 'Pine', 'Reed', 'Sable', 'Thistle', 'Vale', 'Willow', 'Amber', 'Copper', 'Heron', 'Jasper', 'Ridge', 'Summit', 'Crown', 'Meadow', 'Brook', 'Hollis', 'Fenwick', 'Larkin'];
function facilityName(r: () => number, kind: keyof typeof NAME_PATTERNS): string {
  const pats = NAME_PATTERNS[kind];
  return pats[Math.floor(r() * pats.length)].replace('{N}', NAME_WORDS_IND[Math.floor(r() * NAME_WORDS_IND.length)]);
}

function dayHour(t: number) { return hourOf(t); }

export { DAY };
export type { Stop, Line };
