// Bus and metro: stops, lines, vehicles, boarding, and the multimodal trip planner.
import { N, tileX, tileY, wx, wz } from './world.ts';
import { TrackRouter, smoothTilePath } from './path.ts';
import { MinHeap } from './util.ts';
import { STOP_NAMES, STOP_SUFFIX_BUS, STOP_SUFFIX_METRO, LINE_COLORS } from './names.ts';
import type { Traffic } from './traffic.ts';
import type { Ctx, Stop, Line, Carrier, Person, Leg, Vehicle, Building } from './types.ts';

export const BUS_CAP = 30;
export const TRAIN_CAP = 120;
export const BUS_STOP_CAP = 18;
export const STATION_CAP = 50;
export const WALK_SPEED = 0.5;       // tiles per second
export const WALK_R_BUS = 3.4;
export const WALK_R_METRO = 5.2;
export const TRAIN_SPEED = 2.9;
const TRAIN_ACC = 1.5, TRAIN_DEC = 2.1;

export interface TransitHooks {
  arrive(p: Person): void;
  strand(p: Person): void;
  fare(amount: number, line: Line): void;
  toast(msg: string, tone: 'info' | 'warn' | 'bad' | 'good'): void;
  free(): boolean;
}

interface GNode { line: Line; k: number; stop: Stop; wait: number }

export interface PlanResult { legs: Leg[]; time: number; walkIn: number; walkOut: number; firstStop: Stop }

export class Transit {
  stops: Stop[] = [];
  lines: Line[] = [];
  stopById = new Map<number, Stop>();
  lineById = new Map<number, Line>();
  trackRouter: TrackRouter;
  private nextStop = 1;
  private nextLine = 1;
  get nextLineId() { return this.nextLine; }
  private nextCar = 1;
  private colorIdx = 0;
  private usedNames = new Set<string>();
  private segTimer = 0;
  hooks!: TransitHooks;
  /** summary stats */
  overcrowded = 0;      // number of stops currently over capacity
  worstOver = 0;        // longest overcrowding in seconds
  waiting = 0;
  riding = 0;

  constructor(private ctx: Ctx, private traffic: Traffic) {
    this.trackRouter = new TrackRouter(ctx.world);
    traffic.onBusAtStop = (v) => this.busAtStop(v);
  }

  // ---------------------------------------------------------------- stops

  private freshName(kind: 'bus' | 'metro'): string {
    for (let k = 0; k < 80; k++) {
      const base = STOP_NAMES[Math.floor(this.ctx.rand() * STOP_NAMES.length)];
      const suf = kind === 'bus' ? STOP_SUFFIX_BUS[Math.floor(this.ctx.rand() * STOP_SUFFIX_BUS.length)] : STOP_SUFFIX_METRO[Math.floor(this.ctx.rand() * STOP_SUFFIX_METRO.length)];
      const name = kind === 'bus' ? `${base} ${suf}` : `${base} ${suf}`;
      if (!this.usedNames.has(name)) { this.usedNames.add(name); return name; }
    }
    return 'Stop ' + this.nextStop;
  }

  addStop(tile: number, kind: 'bus' | 'metro', name?: string): Stop {
    const w = this.ctx.world;
    const ex = w.stop[tile];
    if (ex >= 0) return this.stopById.get(ex)!;
    const s: Stop = {
      id: this.nextStop++, tile, kind, name: name ?? this.freshName(kind),
      x: wx(tileX(tile)), z: wz(tileY(tile)), lines: [], queue: [],
      cap: kind === 'bus' ? BUS_STOP_CAP : STATION_CAP, over: 0, pulse: 0, lastBoard: 0, boardings: 0,
    };
    this.stops.push(s);
    this.stopById.set(s.id, s);
    w.stop[tile] = s.id;
    w.stopKind[tile] = kind === 'bus' ? 1 : 2;
    this.usedNames.add(s.name);
    this.ctx.emit('stopsChanged');
    return s;
  }

  removeStop(s: Stop) {
    this.invalidateGraph();
    for (const l of [...s.lines]) this.deleteLine(l, true);
    for (const p of s.queue) this.hooks.strand(p);
    s.queue.length = 0;
    const w = this.ctx.world;
    w.stop[s.tile] = -1;
    w.stopKind[s.tile] = 0;
    this.stops.splice(this.stops.indexOf(s), 1);
    this.stopById.delete(s.id);
    this.usedNames.delete(s.name);
    this.ctx.emit('stopsChanged');
  }

  stopAt(tile: number): Stop | null {
    const id = this.ctx.world.stop[tile];
    return id >= 0 ? this.stopById.get(id) ?? null : null;
  }

  // ---------------------------------------------------------------- lines

  nextColor(): number {
    return LINE_COLORS[this.colorIdx++ % LINE_COLORS.length];
  }

  /** a straight compile of a metro route; null + reason when no track can be laid */
  planMetro(stationTiles: number[], lineId: number): { tiles: number[]; ok: boolean; reason?: string } {
    const used = new Set<number>();
    const full: number[] = [];
    for (let k = 0; k + 1 < stationTiles.length; k++) {
      const a = stationTiles[k], b = stationTiles[k + 1];
      if (a === b) return { tiles: full, ok: false, reason: 'Pick a different spot for the next station.' };
      const seg = this.trackRouter.find(a, b, lineId, -1, used);
      if (!seg) return { tiles: full, ok: false, reason: 'No room for track there. Buildings block it, and lines can only cross at a shared station.' };
      for (const t of seg) used.add(t);
      if (full.length) seg.shift();
      full.push(...seg);
    }
    return { tiles: full, ok: true };
  }

  createBusLine(tiles: number[]): Line | null {
    if (tiles.length < 2) return null;
    const stops = tiles.map((t) => this.addStop(t, 'bus'));
    // routes must be drivable
    for (let k = 0; k + 1 < stops.length; k++) if (!this.traffic.router.find(stops[k].tile, stops[k + 1].tile)) return null;
    const line = this.makeLine('bus', stops);
    this.refreshSegTimes(line);
    this.addVehicle(line);
    this.ctx.emit('linesChanged');
    return line;
  }

  createMetroLine(tiles: number[]): Line | null {
    if (tiles.length < 2) return null;
    const id = this.nextLine;
    const plan = this.planMetro(tiles, id);
    if (!plan.ok) return null;
    const stops = tiles.map((t) => this.addStop(t, 'metro'));
    const line = this.makeLine('metro', stops);
    this.buildTrack(line, plan.tiles);
    this.addVehicle(line);
    this.ctx.emit('linesChanged');
    return line;
  }

  private makeLine(kind: 'bus' | 'metro', stops: Stop[]): Line {
    const line: Line = {
      id: this.nextLine++, kind, name: '', color: this.nextColor(), stops, vehicles: [], tiles: [], poly: null, stopDist: [],
      boardings: 0, income: 0, riders: 0, deleted: false, created: this.ctx.t, loops: 0, segTime: [], broken: false, lastFull: -99,
    };
    line.name = (kind === 'bus' ? 'Bus ' : 'Metro ') + line.id;
    for (const s of stops) if (!s.lines.includes(line)) s.lines.push(line);
    this.lines.push(line);
    this.lineById.set(line.id, line);
    this.invalidateGraph();
    return line;
  }

  private buildTrack(line: Line, tiles: number[]) {
    const w = this.ctx.world;
    line.tiles = tiles;
    const { poly, tileDist } = smoothTilePath(tiles, (x) => wx(x), (y) => wz(y));
    line.poly = poly;
    line.stopDist = line.stops.map((s) => {
      const k = tiles.indexOf(s.tile);
      return tileDist[Math.max(0, k)];
    });
    for (const t of tiles) if (w.stopKind[t] !== 2) w.rail[t] = line.id + 1;
    line.segTime = [];
    for (let k = 0; k + 1 < line.stops.length; k++) line.segTime.push((line.stopDist[k + 1] - line.stopDist[k]) / (TRAIN_SPEED * 0.8) + 5);
    this.ctx.world.version.tiles++;
  }

  deleteLine(line: Line, silent = false) {
    if (line.deleted) return;
    line.deleted = true;
    for (const c of [...line.vehicles]) this.removeCarrier(c);
    for (const s of line.stops) {
      s.lines = s.lines.filter((l) => l !== line);
      for (let k = s.queue.length - 1; k >= 0; k--) {
        const p = s.queue[k];
        if (p.legs && p.legs[p.leg]?.line === line) { s.queue.splice(k, 1); this.hooks.strand(p); }
      }
    }
    const w = this.ctx.world;
    for (const t of line.tiles) if (w.rail[t] === line.id + 1) w.rail[t] = 0;
    this.lines.splice(this.lines.indexOf(line), 1);
    this.lineById.delete(line.id);
    this.invalidateGraph();
    // orphan bus stops disappear with their last line; metro stations stay (they were paid for)
    for (const s of [...new Set(line.stops)]) if (s.kind === 'bus' && s.lines.length === 0) {
      w.stop[s.tile] = -1; w.stopKind[s.tile] = 0;
      for (const p of s.queue) this.hooks.strand(p);
      this.stops.splice(this.stops.indexOf(s), 1);
      this.stopById.delete(s.id);
      this.usedNames.delete(s.name);
    }
    this.ctx.world.version.tiles++;
    if (!silent) this.ctx.emit('linesChanged');
    this.ctx.emit('stopsChanged');
  }

  /** append a stop to the end of a bus line */
  extendBus(line: Line, tile: number): boolean {
    const last = line.stops[line.stops.length - 1];
    const s = this.addStop(tile, 'bus');
    if (s === last || line.stops.includes(s)) return false;
    if (!this.traffic.router.find(last.tile, s.tile)) return false;
    line.stops.push(s);
    s.lines.push(line);
    this.invalidateGraph();
    this.refreshSegTimes(line);
    this.ctx.emit('linesChanged');
    return true;
  }

  extendMetro(line: Line, tile: number): { ok: boolean; reason?: string } {
    const lastT = line.stops[line.stops.length - 1].tile;
    if (lastT === tile) return { ok: false, reason: 'Already the end of this line.' };
    const planRes = this.planMetro([lastT, tile], line.id);
    if (!planRes.ok) return planRes;
    // drop trains, lay track, restart
    const n = line.vehicles.length;
    for (const c of [...line.vehicles]) this.removeCarrier(c);
    const s = this.addStop(tile, 'metro');
    line.stops.push(s);
    if (!s.lines.includes(line)) s.lines.push(line);
    const tiles = line.tiles.concat(planRes.tiles.slice(1));
    this.buildTrack(line, tiles);
    this.invalidateGraph();
    for (let k = 0; k < Math.max(1, n); k++) this.addVehicle(line);
    this.ctx.emit('linesChanged');
    return { ok: true };
  }

  vehicleCost(line: Line) { return line.kind === 'bus' ? 200 : 900; }
  maxVehicles(line: Line) { return line.kind === 'bus' ? 10 : 8; }

  addVehicle(line: Line): Carrier | null {
    if (line.vehicles.length >= this.maxVehicles(line)) return null;
    const c: Carrier = {
      id: this.nextCar++, line, dir: 1, target: 1, passengers: [], cap: line.kind === 'bus' ? BUS_CAP : TRAIN_CAP,
      state: 'run', dwell: 0, veh: null, d: 0, speed: 0, off: 0.1, age: 0, wait: 0,
    };
    const n = line.vehicles.length;
    if (line.kind === 'bus') {
      // stagger starts over the stops so they do not bunch up
      const startIdx = Math.min(line.stops.length - 2, Math.floor((n * line.stops.length) / Math.max(2, n + 1)) % Math.max(1, line.stops.length - 1));
      c.target = Math.min(line.stops.length - 1, startIdx + 1);
      c.dir = 1;
      this.startBusPath(c, line.stops[startIdx].tile);
    } else {
      const startIdx = Math.min(line.stops.length - 2, n % Math.max(1, line.stops.length - 1));
      c.d = line.stopDist[startIdx];
      c.target = startIdx + 1;
      c.dir = n % 2 === 1 && line.stops.length > 2 ? 1 : 1;
      c.state = 'dwell';
      c.dwell = 1 + n * 0.5;
    }
    line.vehicles.push(c);
    this.invalidateGraph();
    this.ctx.emit('carrierAdded', c);
    return c;
  }

  private startBusPath(c: Carrier, fromTile: number): boolean {
    const line = c.line;
    const to = line.stops[c.target].tile;
    const path = fromTile === to ? [fromTile] : this.traffic.router.find(fromTile, to);
    if (!path) { line.broken = true; return false; }
    line.broken = false;
    const v = this.traffic.spawn(1, path, line.color, null, c, this.ctx.t);
    c.veh = v;
    return true;
  }

  removeVehicle(line: Line): boolean {
    const c = line.vehicles[line.vehicles.length - 1];
    if (!c || line.vehicles.length <= 1) return false;
    this.removeCarrier(c);
    return true;
  }

  private removeCarrier(c: Carrier) {
    for (const p of c.passengers) this.hooks.strand(p);
    c.passengers.length = 0;
    if (c.veh) this.traffic.kill(c.veh);
    c.veh = null;
    const k = c.line.vehicles.indexOf(c);
    if (k >= 0) c.line.vehicles.splice(k, 1);
    this.invalidateGraph();
    this.ctx.emit('carrierRemoved', c);
  }

  refreshSegTimes(line: Line) {
    if (line.kind !== 'bus') return;
    const out = { cost: 0 };
    const seg: number[] = [];
    for (let k = 0; k + 1 < line.stops.length; k++) {
      const p = this.traffic.router.find(line.stops[k].tile, line.stops[k + 1].tile, out);
      seg.push(p ? out.cost / 0.88 + 3.2 : 120);
    }
    line.segTime = seg;
  }

  headway(line: Line): number {
    const n = line.vehicles.length;
    if (n === 0) return Infinity;
    let cycle = 0;
    for (const s of line.segTime) cycle += s;
    return (cycle * 2 + 8) / n;
  }

  // ---------------------------------------------------------------- buses

  private busAtStop(v: Vehicle) {
    const c = v.carrier;
    if (!c || c.line.deleted) { this.traffic.kill(v); return; }
    const line = c.line;
    if (c.state === 'wait') {
      c.state = 'run';
      this.nextBusLeg(c, v, false);
      return;
    }
    const stop = line.stops[c.target];
    if (!stop) { this.traffic.kill(v); c.veh = null; return; }
    const moved = this.serve(c, stop);
    v.dwell = 1.0 + 0.11 * moved;
    this.nextBusLeg(c, v, true);
  }

  private nextBusLeg(c: Carrier, v: Vehicle, flip: boolean) {
    const line = c.line;
    if (flip) {
      const T = c.target;
      const out = T >= line.stops.length - 1 ? -1 : T <= 0 ? 1 : c.dir;
      c.dir = out as 1 | -1;
      c.target = T + out;
    }
    const cur = v.path[v.path.length - 1];
    const to = line.stops[c.target].tile;
    const np = cur === to ? [cur] : this.traffic.router.find(cur, to);
    if (!np) { line.broken = true; c.state = 'wait'; v.dwell = Math.max(v.dwell, 3); return; }
    line.broken = false;
    // the bus stays in its tile; the new path starts there
    v.path = np;
    v.i = 0;
    v.s = 0.5;
    v.speed = 0;
    if (np.length === 1) v.dwell = Math.max(v.dwell, 0.5);
  }

  // ---------------------------------------------------------------- boarding

  /** unload and load at a stop; returns people moved */
  serve(c: Carrier, stop: Stop): number {
    const line = c.line;
    const i = line.stops.indexOf(stop);
    const t = this.ctx.t;
    let moved = 0;
    // alight
    for (let k = c.passengers.length - 1; k >= 0; k--) {
      const p = c.passengers[k];
      const leg = p.legs?.[p.leg];
      if (!leg || leg.line !== line || leg.to !== i) continue;
      c.passengers.splice(k, 1);
      moved++;
      p.leg++;
      if (p.legs && p.leg < p.legs.length) {
        p.phase = 'wait'; p.stopRef = stop; p.waitStart = t;
        stop.queue.push(p);
      } else {
        p.phase = 'walkOut'; p.timer = p.walkOutT; p.stopRef = null;
      }
    }
    // outgoing direction after a possible turnaround
    const out = i >= line.stops.length - 1 ? -1 : i <= 0 ? 1 : c.dir;
    let denied = 0;
    const q = stop.queue;
    for (let k = 0; k < q.length; k++) {
      const p = q[k];
      const leg = p.legs?.[p.leg];
      if (!leg || leg.line !== line || leg.from !== i || Math.sign(leg.to - leg.from) !== out) continue;
      if (c.passengers.length >= c.cap) { denied++; continue; }
      q.splice(k, 1); k--;
      c.passengers.push(p);
      p.phase = 'ride'; p.stopRef = null;
      moved++;
      const fare = this.hooks.free() ? 0 : line.kind === 'bus' ? 0.35 : 0.6;
      line.boardings++;
      stop.boardings++;
      if (fare > 0) { line.income += fare; this.hooks.fare(fare, line); }
    }
    if (denied > 0) line.lastFull = t;
    line.riders += (c.passengers.length - line.riders) * 0.05;
    c.dir = out as 1 | -1;
    return moved;
  }

  // ---------------------------------------------------------------- trains + stops

  step(dt: number) {
    const t = this.ctx.t;
    // trains
    for (const line of this.lines) {
      if (line.kind !== 'metro' || !line.poly) continue;
      for (const c of line.vehicles) this.stepTrain(c, line, dt);
    }
    // buses whose vehicle died (road removed) restart from the first stop
    for (const line of this.lines) {
      if (line.kind !== 'bus') continue;
      for (const c of line.vehicles) {
        if (c.veh && c.veh.dead) {
          for (const p of c.passengers) this.hooks.strand(p);
          c.passengers.length = 0;
          c.veh = null;
          c.state = 'run';
          c.dir = 1; c.target = 1;
          if (!this.startBusPath(c, line.stops[0].tile)) c.state = 'wait';
        } else if (!c.veh && line.stops.length > 1) {
          c.age += dt;
          if (c.age > 3) { c.age = 0; c.target = Math.min(c.target, line.stops.length - 1); this.startBusPath(c, line.stops[Math.max(0, c.target - c.dir)].tile); }
        }
      }
    }
    // stops: overcrowding + impatience
    let over = 0, worst = 0, waiting = 0;
    for (const s of this.stops) {
      const n = s.queue.length;
      waiting += n;
      if (n > s.cap) { s.over += dt; over++; } else s.over = Math.max(0, s.over - dt * 1.5);
      if (s.over > worst) worst = s.over;
      for (let k = n - 1; k >= 0; k--) {
        const p = s.queue[k];
        if (t - p.waitStart > 85) { s.queue.splice(k, 1); this.hooks.strand(p); }
      }
    }
    this.overcrowded = over;
    this.worstOver = worst;
    this.waiting = waiting;
    let riding = 0;
    for (const l of this.lines) for (const c of l.vehicles) riding += c.passengers.length;
    this.riding = riding;
    this.segTimer += dt;
    if (this.segTimer > 12) {
      this.segTimer = 0;
      for (const l of this.lines) if (l.kind === 'bus') this.refreshSegTimes(l);
    }
  }

  private stepTrain(c: Carrier, line: Line, dt: number) {
    c.age += dt;
    const poly = line.poly!;
    if (c.state === 'dwell') {
      c.dwell -= dt;
      c.speed = 0;
      if (c.dwell <= 0) {
        c.state = 'run';
        c.off = 0.1 * c.dir;
      }
      return;
    }
    const dir = c.dir;
    const tgtD = line.stopDist[c.target];
    const left = (tgtD - c.d) * dir;
    // block spacing
    let vlim = TRAIN_SPEED;
    for (const o of line.vehicles) {
      if (o === c || o.dir !== dir) continue;
      const gap = (o.d - c.d) * dir;
      if (gap > 0 && gap < 1.9) {
        const lim = o.state === 'dwell' ? Math.sqrt(2 * TRAIN_DEC * Math.max(0, gap - 0.75)) : Math.max(0, (gap - 0.7) * 2.2);
        if (lim < vlim) vlim = lim;
      }
    }
    const brake = Math.sqrt(2 * TRAIN_DEC * Math.max(0, left));
    const target = Math.min(vlim, brake + 0.12);
    if (c.speed > target) c.speed = Math.max(target, c.speed - TRAIN_DEC * 1.6 * dt);
    else c.speed = Math.min(target, c.speed + TRAIN_ACC * dt);
    c.d += dir * Math.min(c.speed * dt, Math.max(0, left));
    if (left <= 0.02 || (left < 0.08 && c.speed < 0.2)) {
      c.d = tgtD;
      c.speed = 0;
      const stop = line.stops[c.target];
      const moved = this.serve(c, stop);
      const T = c.target;
      c.target = T + c.dir;
      c.state = 'dwell';
      c.dwell = 2.4 + 0.07 * moved;
      c.off = 0.1 * c.dir;
      if (T <= 0 || T >= line.stops.length - 1) line.loops++;
    }
  }

  // ---------------------------------------------------------------- planner

  // cached graph of (line, stop-index) nodes; rebuilt about once a second because headways drift
  private graph: { nodes: GNode[]; base: Map<Line, number>; built: number; cost: Float32Array; prev: Int32Array; seen: Int32Array; stamp: number } | null = null;
  private planCache = new Map<number, { t: number; r: PlanResult | null }>();
  private heap = new MinHeap();

  invalidateGraph() { this.graph = null; this.planCache.clear(); }

  private getGraph() {
    const t = this.ctx.t;
    if (this.graph && t - this.graph.built < 1.2) return this.graph;
    const nodes: GNode[] = [];
    const base = new Map<Line, number>();
    for (const l of this.lines) {
      if (l.vehicles.length === 0 || l.broken || l.stops.length < 2) continue;
      const hw = this.headway(l);
      base.set(l, nodes.length);
      for (let k = 0; k < l.stops.length; k++) nodes.push({ line: l, k, stop: l.stops[k], wait: Math.min(100, hw * 0.5) });
    }
    const n = nodes.length;
    const old = this.graph;
    this.graph = { nodes, base, built: t, cost: new Float32Array(n), prev: new Int32Array(n), seen: new Int32Array(n), stamp: old ? old.stamp + 1 : 1 };
    if (old && old.stamp > 1e9) this.graph.stamp = 1;
    this.planCache.clear();
    return this.graph;
  }

  /** best multimodal plan from building a to building b, or null */
  plan(a: Building, b: Building): PlanResult | null {
    if (this.lines.length === 0) return null;
    const key = a.id * 100003 + b.id;
    const hit = this.planCache.get(key);
    if (hit && this.ctx.t - hit.t < 2) return hit.r;
    const r = this.planUncached(a, b);
    this.planCache.set(key, { t: this.ctx.t, r });
    if (this.planCache.size > 3000) this.planCache.clear();
    return r;
  }

  private planUncached(a: Building, b: Building): PlanResult | null {
    const G = this.getGraph();
    const { nodes, base } = G;
    if (!nodes.length) return null;
    const ax = a.x + 0.5 - N / 2, ay = a.y + 0.5 - N / 2, bx = b.x + 0.5 - N / 2, by = b.y + 0.5 - N / 2;
    const stamp = ++G.stamp;
    const { cost, prev, seen } = G;
    const heap = this.heap;
    heap.clear();
    // walking cost to the destination per stop
    const endWalk = new Map<Stop, number>();
    let any = false;
    for (const s of this.stops) {
      if (!s.lines.length) continue;
      const R = s.kind === 'metro' ? WALK_R_METRO : WALK_R_BUS;
      const d0 = Math.hypot(s.x - ax, s.z - ay);
      if (d0 <= R) {
        for (const l of s.lines) {
          const bs = base.get(l);
          if (bs === undefined) continue;
          const k = l.stops.indexOf(s);
          if (k < 0 || !nodes[bs + k]) continue;
          const id = bs + k;
          const c = d0 / WALK_SPEED + nodes[id].wait;
          if (seen[id] !== stamp || c < cost[id]) { seen[id] = stamp; cost[id] = c; prev[id] = -1; heap.push(c, id); any = true; }
        }
      }
      const d1 = Math.hypot(s.x - bx, s.z - by);
      if (d1 <= R) endWalk.set(s, d1 / WALK_SPEED);
    }
    if (!any || !endWalk.size) return null;
    let best = -1, bestT = Infinity, wOut = 0;
    const closed = new Set<number>();
    while (heap.size) {
      const id = heap.pop();
      const c = heap.lastKey;
      if (closed.has(id) || c > cost[id] + 1e-4) continue;
      if (c >= bestT) break;
      closed.add(id);
      const nd = nodes[id];
      const ew = endWalk.get(nd.stop);
      if (ew !== undefined && c + ew < bestT) { bestT = c + ew; best = id; wOut = ew; }
      const l = nd.line, bs = base.get(l)!;
      const relax = (n2: number, c2: number) => {
        if (seen[n2] !== stamp || c2 < cost[n2]) { seen[n2] = stamp; cost[n2] = c2; prev[n2] = id; heap.push(c2, n2); }
      };
      if (nd.k + 1 < l.stops.length && nodes[bs + nd.k + 1]) relax(bs + nd.k + 1, c + (l.segTime[nd.k] ?? 20));
      if (nd.k > 0 && nodes[bs + nd.k - 1]) relax(bs + nd.k - 1, c + (l.segTime[nd.k - 1] ?? 20));
      for (const l2 of nd.stop.lines) {
        if (l2 === l) continue;
        const b2 = base.get(l2);
        if (b2 === undefined) continue;
        const k2 = l2.stops.indexOf(nd.stop);
        if (k2 < 0 || !nodes[b2 + k2]) continue;
        relax(b2 + k2, c + 14 + nodes[b2 + k2].wait);
      }
    }
    if (best < 0) return null;
    const chain: number[] = [];
    for (let n = best; n >= 0; n = prev[n]) chain.push(n);
    chain.reverse();
    const legs: Leg[] = [];
    let cur: Leg | null = null;
    for (const n of chain) {
      const nd = nodes[n];
      if (cur && cur.line === nd.line) cur.to = nd.k;
      else { if (cur) legs.push(cur); cur = { line: nd.line, from: nd.k, to: nd.k }; }
    }
    if (cur) legs.push(cur);
    const real = legs.filter((l) => l.from !== l.to);
    if (!real.length) return null;
    const first = nodes[chain[0]];
    const walkIn = Math.hypot(first.stop.x - ax, first.stop.z - ay) / WALK_SPEED;
    return { legs: real, time: bestT, walkIn, walkOut: wOut, firstStop: real[0].line.stops[real[0].from] };
  }

  /** 0..1 how well a tile is served by transit */
  coverage(x: number, y: number): number {
    let best = 0;
    const cx = x + 0.5 - N / 2, cz = y + 0.5 - N / 2;
    for (const s of this.stops) {
      if (!s.lines.length) continue;
      const R = s.kind === 'metro' ? WALK_R_METRO : WALK_R_BUS;
      const d = Math.hypot(s.x - cx, s.z - cz);
      if (d < R) {
        const v = (1 - d / R) * 0.6 + 0.4;
        const w = s.kind === 'metro' ? v : v * 0.7;
        if (w > best) best = w;
      }
    }
    return best;
  }
}
