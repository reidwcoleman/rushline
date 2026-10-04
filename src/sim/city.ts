// The living city: buildings, people with daily schedules, mode choice, growth and upgrades.
import { N, DX, DY, tileIdx, tileX, tileY, inMap, type World } from './world.ts';
import { clamp, lerp, gauss, smoothstep } from './util.ts';
import { SPEED_STREET } from './path.ts';
import { WALK_SPEED } from './transit.ts';
import type { Traffic } from './traffic.ts';
import type { Transit } from './transit.ts';
import type { Ctx, Building, Person, Kind, Vehicle, Stop, Line } from './types.ts';
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
}

export class City {
  buildings = new Map<number, Building>();
  persons: Person[] = [];
  nextB = 1;
  nextP = 1;
  stats: Stats = {
    pop: 0, employed: 0, unemployed: 0, jobs: 0, housing: 0, sat: 0.8, commute: 0, car: 0, transit: 0, walk: 0, trips: 0,
    demand: { r: 0.5, c: 0.4, i: 0.3 }, buildings: 0, levels: [0, 0, 0], stuck: 0,
  };
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

  addBuilding(x: number, y: number, kind: Kind, level = 1, special?: 'arena'): Building {
    const w = this.w;
    const tile = tileIdx(x, y);
    const rf = this.roadFor({ x, y });
    const variants = VARIANTS[kind][level - 1];
    const b: Building = {
      id: this.nextB++, x, y, tile, kind, level, variant: Math.floor(this.ctx.rand() * variants),
      rot: rf.dir >= 0 ? rf.dir : 0, born: this.ctx.t, cap: CAPS[kind][level - 1], residents: [], workers: [], visitors: 0,
      access: rf.tile, accessAll: rf.all, land: 0.3, happy: 0.8, lastLevel: this.ctx.t, cutoff: 0, glow: 0, special,
    };
    if (special === 'arena') { b.cap = 24; b.variant = 0; }
    this.buildings.set(b.id, b);
    w.bld[tile] = b.id;
    if (w.tree[tile]) { w.tree[tile] = 0; this.ctx.emit('treesChanged'); }
    this.candDirty = true;
    this.ctx.emit('bldAdd', b);
    return b;
  }

  removeBuilding(b: Building, reason = 'bulldozed') {
    this.buildings.delete(b.id);
    this.w.bld[b.tile] = -1;
    // residents leave, workers lose their jobs
    for (const p of [...b.residents]) this.removePerson(p);
    for (const p of [...b.workers]) { p.work = null; }
    // people currently visiting/travelling to this place
    for (const p of this.persons) {
      if (p.tripTo === b) p.tripTo = p.home;
      if (p.work === b) p.work = null;
      if (p.at === b) { p.at = p.home; if (p.phase === 'none') p.state = 'home'; }
      if (p.tripFrom === b) p.tripFrom = p.home;
    }
    this.candDirty = true;
    this.ctx.emit('bldRemove', { b, reason });
  }

  levelUp(b: Building) {
    if (b.level >= 3 || b.special) return;
    b.level++;
    b.cap = CAPS[b.kind][b.level - 1];
    b.variant = Math.floor(this.ctx.rand() * VARIANTS[b.kind][b.level - 1]);
    b.lastLevel = this.ctx.t;
    this.ctx.emit('bldLevel', b);
  }

  refreshAccess() {
    for (const b of this.buildings.values()) {
      const rf = this.roadFor(b);
      b.access = rf.tile;
      b.accessAll = rf.all;
      if (rf.dir >= 0 && rf.dir !== b.rot) { b.rot = rf.dir; this.ctx.emit('bldRot', b); }
    }
    this.candDirty = true;
  }

  // ---------------------------------------------------------------- persons

  createPerson(home: Building): Person {
    const r = this.ctx.rand;
    const sd = this.policies.stagger ? 1.9 : 0.8;
    const start = clamp(8.0 + gauss(r) * sd * 1.6, 5.3, 11);
    const p: Person = {
      id: this.nextP++, home, work: null, state: 'home', workStart: start - 1 / 12, workEnd: start + 8.2 + r() * 1.4,
      leisure: 0.3 + r() * 0.35, carBias: 0.8 + r() * 0.36, color: Math.floor(r() * 12),
      tripFrom: null, tripTo: null, tripStart: 0, tripIdeal: 10, tripMode: 0, nextState: 'home', legs: null, leg: 0, timer: 0, phase: 'none',
      stopRef: null, sat: 0.75, lastTrip: 0, dest: null, waitStart: 0, dead: false, leisureDone: 0, walkOutT: 0, planTime: 0,
      workDay: 0, leisureEnd: 0, remote: false, charged: false, at: home,
    };
    home.residents.push(p);
    this.persons.push(p);
    return p;
  }

  removePerson(p: Person) {
    p.dead = true;
    const h = p.home;
    const k = h.residents.indexOf(p);
    if (k >= 0) h.residents.splice(k, 1);
    if (p.work) { const j = p.work.workers.indexOf(p); if (j >= 0) p.work.workers.splice(j, 1); }
    if (p.stopRef) { const q = p.stopRef.queue; const j = q.indexOf(p); if (j >= 0) q.splice(j, 1); }
    for (const l of this.transit.lines) for (const c of l.vehicles) { const j = c.passengers.indexOf(p); if (j >= 0) c.passengers.splice(j, 1); }
    // a driving person: kill the car
    for (const v of this.traffic.vehicles) if (v.person === p) { this.traffic.kill(v); break; }
    const i = this.persons.indexOf(p);
    if (i >= 0) { this.persons[i] = this.persons[this.persons.length - 1]; this.persons.pop(); }
  }

  /** find a job for an unemployed person; prefers nearby but spreads across the city */
  assignJob(p: Person): boolean {
    let bestB: Building | null = null, bestS = -1;
    let seen = 0;
    for (const b of this.buildings.values()) {
      if (b.kind === 'res' || b.workers.length >= b.cap) continue;
      if (b.access < 0) continue;
      seen++;
      const d = Math.hypot(b.x - p.home.x, b.y - p.home.y);
      const s = (this.ctx.rand() + 0.15) / (d + 7);
      if (s > bestS) { bestS = s; bestB = b; }
    }
    if (!bestB) return false;
    p.work = bestB;
    bestB.workers.push(p);
    return true;
  }

  // ---------------------------------------------------------------- trips

  private idealTime(from: Building, to: Building): number {
    const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    return 5 + dist / SPEED_STREET;
  }

  startTrip(p: Person, from: Building, to: Building, nextState: Person['nextState'], midState: Person['state']) {
    const ctx = this.ctx, w = this.w;
    p.tripFrom = from; p.tripTo = to; p.tripStart = ctx.t; p.nextState = nextState;
    p.state = midState;
    p.charged = false;
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
      this.traffic.spawn(0, carPath!, col, p, null, ctx.t);
    } else if (mode === 2 && plan) {
      p.legs = plan.legs; p.leg = 0; p.phase = 'walkIn'; p.timer = plan.walkIn; p.walkOutT = plan.walkOut;
      p.stopRef = plan.firstStop; p.planTime = plan.time;
    } else if (mode === 3) {
      p.phase = 'walk'; p.timer = walkCost;
    } else {
      // stuck: no road, no transit and far away
      p.phase = 'walk'; p.timer = Math.min(160, (dist / WALK_SPEED) * 1.15);
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
    if (p.state === 'leisure') {
      dest.visitors++;
      this.onFee(dest.special === 'arena' ? 3.2 : this.policies.remote ? 0.6 : 0.9, dest.special === 'arena' ? 'match' : 'shopping');
    }
    if (p.state === 'work') p.workDay = dayOf(t);
    if (p.state === 'home' || p.state === 'work') { /* settled */ }
  }

  strand(p: Person) {
    if (p.dead) return;
    const from = p.tripFrom ?? p.home, to = p.tripTo ?? p.home;
    const dist = Math.hypot(from.x - to.x, from.y - to.y);
    p.phase = 'walk';
    p.tripMode = 4;
    p.stopRef = null;
    p.legs = null;
    p.timer = 5 + Math.min(70, dist / WALK_SPEED * 0.55);
    this.stats.stuck++;
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
      } else if (hour >= 10 && hour < 21.5 && p.leisureDone !== day && (!p.work || p.remote || hour > p.workEnd + 0.2) && this.ctx.rand() < dt * 0.02) {
        this.leisureTrip(p, day);
      } else if (this.eventTile >= 0 && t < this.eventUntil && p.leisureDone !== day && this.ctx.rand() < dt * 0.005) {
        this.leisureTrip(p, day, true);
      } else if (this.matchTile >= 0 && t < this.matchUntil && p.leisureDone !== day && this.ctx.rand() < dt * 0.012) {
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
        if (p.leisureDone !== day && this.ctx.rand() < p.leisure && hour < 20 && from !== p.home) {
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
        if (at.visitors > 0) at.visitors--;
        if (at === p.home) { p.state = 'home'; return; }
        this.startTrip(p, at, p.home, 'home', 'toHome');
      }
    }
  }

  private leisureTrip(p: Person, day: number, event = false) {
    const dest = event && this.eventTile >= 0 ? this.buildings.get(this.w.bld[this.eventTile]) ?? this.pickLeisure(p) : this.pickLeisure(p);
    if (!dest) return;
    p.leisureDone = day;
    p.leisureEnd = Math.min(23, dayHour(this.ctx.t) + 1 + this.ctx.rand() * 1.8);
    this.startTrip(p, p.home, dest, 'leisure', 'toLeisure');
  }

  private pickLeisure(p: Person): Building | null {
    let best: Building | null = null, bs = -1;
    let n = 0;
    for (const b of this.buildings.values()) {
      if (b.kind !== 'com' || b.access < 0) continue;
      if ((++n & 1) === 0 && this.buildings.size > 20) continue;
      const d = Math.hypot(b.x - p.home.x, b.y - p.home.y);
      const s = (this.ctx.rand() + 0.2) * (1 + b.level * 0.5) / (d + 5);
      if (s > bs) { bs = s; best = b; }
    }
    return best;
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

  updateStats() {
    const s = this.stats;
    let pop = 0, employed = 0, jobs = 0, housing = 0, comJ = 0, indJ = 0, satSum = 0;
    s.levels = [0, 0, 0];
    for (const b of this.buildings.values()) {
      s.levels[b.level - 1]++;
      if (b.kind === 'res') {
        housing += b.cap;
        let sat = 0;
        for (const p of b.residents) sat += p.sat;
        b.happy = b.residents.length ? sat / b.residents.length : 0.8;
        if (b.access < 0) b.cutoff += 1; else b.cutoff = 0;
      } else {
        jobs += b.cap;
        if (b.kind === 'com') comJ += b.cap; else indJ += b.cap;
        employed += b.workers.length;
      }
    }
    for (const p of this.persons) { pop++; satSum += p.sat; }
    s.pop = pop; s.employed = employed; s.unemployed = Math.max(0, Math.round(pop * 0.52) - employed);
    s.jobs = jobs; s.housing = housing; s.buildings = this.buildings.size;
    s.sat = pop ? satSum / pop : 0.8;
    // mode share over a decaying window
    const m = this.modeCount;
    for (let k = 0; k < 4; k++) { this.modeWindow[k] = this.modeWindow[k] * 0.9 + m[k]; m[k] = 0; }
    const tot = this.modeWindow[0] + this.modeWindow[1] + this.modeWindow[2] + this.modeWindow[3] + 1e-6;
    s.car = this.modeWindow[0] / tot; s.transit = this.modeWindow[1] / tot; s.walk = (this.modeWindow[2] + this.modeWindow[3]) / tot;
    s.trips = tot;
    // demand
    const wanted = Math.max(8, pop * 0.52);
    const jobRatio = jobs / wanted;
    const fill = housing > 0 ? pop / housing : 1;
    const dr = clamp(clamp((fill - 0.7) * 3) * 0.9 + clamp((jobRatio - 1) * 1.5) * 0.5 + 0.06);
    const dc = clamp(1 - comJ / (pop * 0.3 + 6)) * 0.85 + (jobRatio < 1 ? 0.2 : 0);
    const di = clamp(1 - indJ / (pop * 0.22 + 6)) * 0.8 * (jobRatio < 1.6 ? 1 : 0.4);
    s.demand = { r: dr, c: clamp(dc), i: di };
  }

  step(dt: number) {
    const t = this.ctx.t;
    const hour = hourOf(t), day = dayOf(t);
    this.tick++;
    if (day !== this.lastDay) {
      this.lastDay = day;
      // fresh day: decide who works from home
      const rf = this.policies.remote ? 0.18 : 0.02;
      for (const p of this.persons) p.remote = this.ctx.rand() < rf;
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
    // people leave when it is truly miserable
    if (s.sat < 0.22 && this.persons.length > 20 && rnd() < 0.5) {
      const p = this.persons[Math.floor(rnd() * this.persons.length)];
      if (p.sat < 0.3 && p.state === 'home' && p.phase === 'none') { this.removePerson(p); this.ctx.emit('emigrate'); }
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
        const batch = Math.min(free, 1 + Math.floor(rnd() * 3));
        for (let q = 0; q < batch; q++) {
          const p = this.createPerson(b);
          this.assignJob(p);
        }
        b.glow = 1;
      }
    }
    // jobless find work as vacancies appear
    let tries = 0;
    for (const p of this.persons) {
      if (!p.work && tries < 8) { tries++; this.assignJob(p); }
    }
  }
}

function dayHour(t: number) { return hourOf(t); }

export { DAY };
export type { Stop, Line };
