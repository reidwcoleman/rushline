// Road traffic: car-following on a tile grid, congestion measurement, rerouting.
import { N, DX, DY, tileX, tileY, tileIdx, wx, wz, type World } from './world.ts';
import { RoadRouter, freeSpeed } from './path.ts';
import type { Vehicle, Person, Carrier } from './types.ts';

const ACC = 3.0;
const BRAKE = 5.5;
export const CAR_LEN = 0.32;
export const BUS_LEN = 0.58;
const PAD = 0.06;

export const laneOffset = (kindMin: number, lane: number) => kindMin >= 3 ? (lane === 2 ? 0.27 : lane === 0 ? 0.17 : 0.36) : (lane === 2 ? (kindMin >= 2 ? 0.2 : 0.19) : kindMin >= 2 ? (lane === 0 ? 0.14 : 0.31) : 0.15);

/** Traffic signals are actuated: a road keeps green while cars are arriving and gives way once the other road has a queue. */
const SIG_MIN = 2.0, SIG_MAX = 10, SIG_AMBER = 0.6, SIG_ALLRED = 0.3;
interface Sig { axis: 0 | 1; ph: 0 | 1 | 2; t: number }
/** the circle a roundabout vehicle drives on, in tile units */
export const RAB_R = 0.3;

export class Traffic {
  vehicles: Vehicle[] = [];
  tileCars: Vehicle[][] = Array.from({ length: N * N }, () => []);
  cong = new Float32Array(N * N).fill(1);
  load = new Float32Array(N * N);
  router: RoadRouter;
  pending: Vehicle[] = [];
  speedMul = 1;
  clock = 0;
  sigs = new Map<number, Sig>();
  busLanes = false;
  nextId = 1;
  // callbacks
  onArrive: (v: Vehicle) => void = () => {};
  onStrand: (v: Vehicle) => void = () => {};
  onBusAtStop: (v: Vehicle) => void = () => {};
  // stats
  gridlock = 0;
  loadedTiles = 0;
  trafficIndex = 0;     // 0..1 average congestion on busy tiles
  carsMoving = 0;
  private ratioSum = new Float32Array(N * N);
  private cnt = new Uint8Array(N * N);
  private touched: number[] = [];
  private decayTimer = 0;
  private rerouteBudget = 0;
  private deg = new Uint8Array(N * N);
  private degVersion = -1;
  /** tiles that count as stop tiles for bus dwell */
  busStopTiles = new Set<number>();

  constructor(readonly world: World) {
    this.router = new RoadRouter(world, this.cong);
  }

  private refreshDeg() {
    const w = this.world;
    if (this.degVersion === w.version.roads) return;
    this.degVersion = w.version.roads;
    for (let t = 0; t < N * N; t++) this.deg[t] = w.degree(t);
    const live = new Set<number>();
    for (let t = 0; t < N * N; t++) if (w.ctl[t] === 1 && this.deg[t] >= 3 && w.surf(t)) { live.add(t); if (!this.sigs.has(t)) this.sigs.set(t, { axis: (t & 1) as 0 | 1, ph: 0, t: 0 }); }
    for (const t of [...this.sigs.keys()]) if (!live.has(t)) this.sigs.delete(t);
  }

  tileCap(t: number): number {
    this.refreshDeg();
    const r = this.world.road[t];
    if (r === 3 && !this.world.ramp[t]) return 12;
    if (this.deg[t] >= 3 && this.world.ctl[t] === 2) return 7;
    if (r >= 2) return 10;
    return this.deg[t] >= 3 ? 5 : 6;
  }

  /** a vehicle waiting to enter junction tile `next` from `t` yields to anything crossing inside it */
  private crossConflict(v: Vehicle, t: number, next: number): boolean {
    if (this.deg[next] < 3 || this.world.ctl[next] || this.world.under[next]) return false;
    const horiz = tileY(next) === tileY(t);
    const arr = this.tileCars[next];
    for (let k = 0; k < arr.length; k++) {
      const u = arr[k];
      if (u === v || u.dead || u.i === 0 || u.s > 0.64 || u.s < 0.38) continue;
      const pu = u.path[u.i - 1];
      if (pu === t) continue;
      const uh = tileY(pu) === tileY(next);
      if (uh !== horiz) return true;
    }
    return false;
  }

  /** a car about to enter a roundabout from tile t gives way to traffic already circling near that entrance */
  private ringBusy(v: Vehicle, t: number, next: number): boolean {
    const w = this.world;
    if (w.ctl[next] !== 2 || this.deg[next] < 3) return false;
    const ex = (wx(tileX(t)) + wx(tileX(next))) / 2, ez = (wz(tileY(t)) + wz(tileY(next))) / 2;
    const arr = this.tileCars[next];
    for (let k = 0; k < arr.length; k++) {
      const u = arr[k];
      if (u === v || u.dead || (u.i > 0 && u.path[u.i - 1] === t)) continue;
      if (Math.hypot(u.x - ex, u.z - ez) < 0.4) return true;
    }
    return false;
  }

  /** a red (or amber, or all-red) light for a vehicle about to enter junction tile `next` from `t` */
  private redFor(t: number, next: number): boolean {
    if (this.world.ctl[next] !== 1 || this.deg[next] < 3) return false;
    const axis = tileY(next) === tileY(t) ? 0 : 1;
    return this.sigState(next, axis) !== 1;
  }

  /** 0 red, 1 green, 2 amber for traffic arriving along an axis (0 east-west, 1 north-south) */
  sigState(tile: number, axis: 0 | 1): 0 | 1 | 2 {
    const s = this.sigs.get(tile);
    if (!s) return 1;
    if (s.axis !== axis) return 0;
    return s.ph === 0 ? 1 : s.ph === 1 ? 2 : 0;
  }

  private stepSignals(dt: number) {
    const w = this.world;
    for (const [t, s] of this.sigs) {
      s.t += dt;
      if (s.ph === 1) { if (s.t >= SIG_AMBER) { s.ph = 2; s.t = 0; } continue; }
      if (s.ph === 2) { if (s.t >= SIG_ALLRED) { s.axis = (1 - s.axis) as 0 | 1; s.ph = 0; s.t = 0; } continue; }
      // green: count the cars lined up to enter from each road
      const dem = [0, 0];
      for (let d = 0; d < 4; d++) {
        const nx = tileX(t) + DX[d], ny = tileY(t) + DY[d];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const n = tileIdx(nx, ny);
        if (!w.linked(t, n)) continue;
        for (const u of this.tileCars[n]) if (!u.dead && u.i + 1 < u.path.length && u.path[u.i + 1] === t) dem[d & 1]++;
      }
      const cur = dem[s.axis], oth = dem[1 - s.axis];
      if (oth > 0 && (s.t >= SIG_MAX || (s.t >= SIG_MIN && cur === 0))) { s.ph = 1; s.t = 0; }
    }
  }

  spawn(kind: 0 | 1, path: number[], color: number, person: Person | null, carrier: Carrier | null, now: number): Vehicle {
    const v: Vehicle = {
      id: this.nextId++, kind, path, i: 0, s: 0.5, speed: 0, lane: 0,
      len: kind === 0 ? CAR_LEN : BUS_LEN, color, x: 0, z: 0, ang: 0, blocked: 0,
      person, carrier, dwell: 0, dead: false, reroute: 2 + Math.random() * 3, spawnedAt: now,
      shape: (Math.random() * 4) | 0, holdTile: -1, stuck: 0, ghost: 0,
    };
    v.lane = this.laneFor(v, path[0], -1, false);
    this.pose(v);
    if (this.spawnClear(path[0], v)) this.place(v);
    else { v.holdTile = path[0]; this.pending.push(v); }
    return v;
  }

  private spawnClear(t: number, v: Vehicle): boolean {
    const arr = this.tileCars[t];
    if (arr.length >= this.tileCap(t)) return false;
    for (let k = 0; k < arr.length; k++) {
      const u = arr[k];
      if (u.lane === v.lane && Math.abs(u.s - 0.5) < (u.len + v.len) * 0.5 + 0.08) return false;
    }
    return true;
  }

  private place(v: Vehicle) {
    this.tileCars[v.path[v.i]].push(v);
    this.vehicles.push(v);
    v.holdTile = -1;
  }

  kill(v: Vehicle) {
    if (v.dead) return;
    v.dead = true;
    if (v.holdTile < 0) {
      const arr = this.tileCars[v.path[v.i]];
      const k = arr.indexOf(v);
      if (k >= 0) { arr[k] = arr[arr.length - 1]; arr.pop(); }
    } else {
      const k = this.pending.indexOf(v);
      if (k >= 0) this.pending.splice(k, 1);
    }
  }

  /** pose from path + progress; lane-offset Bezier through junctions */
  pose(v: Vehicle) {
    const w = this.world, p = v.path, i = v.i;
    const t = p[i], prev = i > 0 ? p[i - 1] : -1, next = i + 1 < p.length ? p[i + 1] : -1;
    const cx = wx(tileX(t)), cz = wz(tileY(t));
    let dix = 0, diz = 0, dox = 0, doz = 0;
    if (prev >= 0) { dix = tileX(t) - tileX(prev); diz = tileY(t) - tileY(prev); }
    if (next >= 0) { dox = tileX(next) - tileX(t); doz = tileY(next) - tileY(t); }
    if (prev < 0) { dix = dox; diz = doz; }
    if (next < 0) { dox = dix; doz = diz; }
    if (!dix && !diz && !dox && !doz) { dix = dox = 1; }
    const et = w.eff(t);
    const kIn = prev >= 0 ? Math.min(w.eff(prev), et) : et;
    const kOut = next >= 0 ? Math.min(w.eff(next), et) : et;
    const oIn = laneOffset(kIn, v.lane), oOut = laneOffset(kOut, v.lane);
    // right-hand traffic: right of (dx,dz) is (-dz,dx)
    const rix = -diz, riz = dix, rox = -doz, roz = dox;
    const ex = cx - dix * 0.5 + rix * oIn;
    const ez = cz - diz * 0.5 + riz * oIn;
    const xx = next >= 0 ? cx + dox * 0.5 + rox * oOut : cx + rix * oIn;
    const xz = next >= 0 ? cz + doz * 0.5 + roz * oOut : cz + riz * oIn;
    const s = v.s;
    if (w.ctl[t] === 2 && prev >= 0 && next >= 0 && this.deg[t] >= 3) { this.poseRing(v, cx, cz, dix, diz, dox, doz, ex, ez, xx, xz, s); return; }
    if (dix === dox && diz === doz) {
      v.x = ex + (xx - ex) * s; v.z = ez + (xz - ez) * s;
      v.ang = Math.atan2(doz, dox);
    } else {
      const qx = cx + rix * oIn + rox * oOut, qz = cz + riz * oIn + roz * oOut;
      const u = 1 - s;
      v.x = u * u * ex + 2 * u * s * qx + s * s * xx;
      v.z = u * u * ez + 2 * u * s * qz + s * s * xz;
      const tx = 2 * u * (qx - ex) + 2 * s * (xx - qx), tz = 2 * u * (qz - ez) + 2 * s * (xz - qz);
      v.ang = Math.atan2(tz, tx);
    }
  }

  /** counter-clockwise lap of a roundabout: in along the entry arm, round the island, out along the exit arm */
  private poseRing(v: Vehicle, cx: number, cz: number, dix: number, diz: number, dox: number, doz: number, ex: number, ez: number, xx: number, xz: number, s: number) {
    const R = RAB_R + (v.lane === 1 ? 0.06 : 0) * (this.world.eff(v.path[v.i]) >= 2 ? 1 : 0);
    const a0 = Math.atan2(-diz, -dix), a1 = Math.atan2(doz, dox);
    let sweep = a0 - a1;
    while (sweep <= 0.01) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
    const k = 0.2;
    const at = (f: number, out: number[]) => {
      if (f < k) {
        const u = f / k, rx = cx + Math.cos(a0) * R, rz = cz + Math.sin(a0) * R;
        out[0] = ex + (rx - ex) * u; out[1] = ez + (rz - ez) * u;
      } else if (f > 1 - k) {
        const u = (f - (1 - k)) / k, rx = cx + Math.cos(a1) * R, rz = cz + Math.sin(a1) * R;
        out[0] = rx + (xx - rx) * u; out[1] = rz + (xz - rz) * u;
      } else {
        const a = a0 - sweep * ((f - k) / (1 - 2 * k));
        out[0] = cx + Math.cos(a) * R; out[1] = cz + Math.sin(a) * R;
      }
    };
    const p = this._p, q = this._q;
    at(s, p);
    at(Math.min(1, s + 0.02), q);
    let hx = q[0] - p[0], hz = q[1] - p[1];
    if (s > 0.98) { at(s - 0.02, p); hx = q[0] - p[0]; hz = q[1] - p[1]; at(s, p); }
    v.x = p[0]; v.z = p[1];
    v.ang = Math.atan2(hz, hx);
  }
  private _p = [0, 0];
  private _q = [0, 0];

  step(dt: number, speedMul: number) {
    const w = this.world;
    this.refreshDeg();
    this.clock += dt;
    this.stepSignals(dt);
    this.speedMul = speedMul;
    this.rerouteBudget = 5;
    // admit pending spawns
    if (this.pending.length) {
      for (let k = this.pending.length - 1; k >= 0; k--) {
        const v = this.pending[k];
        const t = v.path[0];
        if (this.spawnClear(t, v)) {
          this.pending.splice(k, 1);
          this.place(v);
        }
      }
    }
    const list = this.vehicles;
    const touched = this.touched;
    let moving = 0;
    for (let k = 0; k < list.length; k++) {
      const v = list[k];
      if (v.dead) continue;
      const path = v.path, i = v.i;
      const t = path[i];
      const last = i === path.length - 1;
      const next = last ? -1 : path[i + 1];
      const kind = w.eff(t);
      // dwell (bus at a stop)
      if (v.dwell > 0) {
        v.dwell -= dt;
        v.speed = 0;
        if (this.cnt[t]++ === 0) touched.push(t);
        this.ratioSum[t] += 0.6;
        continue;
      }
      let vmax = freeSpeed(kind) * speedMul * (v.kind === 1 ? (this.busLanes ? 1 : 0.88) : this.busLanes ? 0.93 : 1);
      if (w.blocked[t] > 0) vmax *= 0.25;
      if (w.ctl[t] === 2 && this.deg[t] >= 3) vmax *= 0.9;
      // gap to the nearest leader
      let margin = 9;
      const ghost = v.ghost > 0;
      if (ghost) v.ghost -= dt;
      const cars = this.tileCars[t];
      const myLane = v.lane;
      if (!ghost && w.ctl[t] === 2 && this.deg[t] >= 3) {
        // inside a roundabout everyone shares the ring: keep clear of whatever is ahead
        const ca = Math.cos(v.ang), sa = Math.sin(v.ang);
        for (let c = 0; c < cars.length; c++) {
          const u = cars[c];
          if (u === v || u.dead) continue;
          const dx = u.x - v.x, dz = u.z - v.z;
          const along = dx * ca + dz * sa;
          if (along <= 0.001 || Math.abs(-dx * sa + dz * ca) > 0.14) continue;
          const gap = along - (v.len + u.len) * 0.5 - PAD;
          if (gap < margin) margin = gap;
        }
      }
      for (let c = 0; c < cars.length && !ghost; c++) {
        const u = cars[c];
        if (u === v || u.lane !== myLane || u.dead) continue;
        const ue = u.i + 1 < u.path.length ? u.path[u.i + 1] : -1;
        if (ue !== next || u.s <= v.s) continue;
        const gap = u.s - v.s - (v.len + u.len) * 0.5 - PAD;
        if (gap < margin) margin = gap;
      }
      let nextLane = 0;
      let gated = false, onRed = false;
      if (next >= 0 && v.s > 0.5) {
        onRed = this.redFor(t, next);
        if (!ghost && (onRed || this.ringBusy(v, t, next) || this.tileCars[next].length >= this.tileCap(next) || w.blocked[next] > 0 || this.crossConflict(v, t, next)) && v.blocked < 18) {
          gated = true;
          const m = 0.955 - v.s;
          if (m < margin) margin = m;
        }
      }
      if (next >= 0) {
        nextLane = this.laneFor(v, next, t, true);
        const nc = this.tileCars[next];
        for (let c = 0; c < nc.length && !ghost; c++) {
          const u = nc[c];
          if (u.lane !== nextLane || u.dead) continue;
          if (u.i === 0 || u.path[u.i - 1] !== t) continue;
          const gap = 1 - v.s + u.s - (v.len + u.len) * 0.5 - PAD;
          if (gap < margin) margin = gap;
        }
      } else if (v.kind === 1) {
        // bus stops mid tile
        const m = 0.5 - v.s;
        if (m < margin) margin = m;
      }
      if (margin < 0) margin = 0;
      const allowed = Math.sqrt(2 * BRAKE * margin) * 1.0;
      const target = vmax < allowed ? vmax : allowed;
      if (v.speed > target) v.speed = Math.max(target, v.speed - 7.5 * dt);
      else v.speed = Math.min(target, v.speed + ACC * dt);
      let ds = v.speed * dt;
      if (ds > margin) ds = margin;
      v.s += ds;
      if (v.speed > 0.2) moving++;
      if (v.speed < 0.05 && !last) {
        v.stuck += dt;
        if (v.stuck > 11) { v.ghost = 2.2; v.stuck = 0; }
      } else if (v.speed > 0.3) v.stuck = 0;
      if (this.cnt[t]++ === 0) touched.push(t);
      this.ratioSum[t] += onRed && v.s > 0.85 ? 1 : v.speed / freeSpeed(kind);
      // arrival
      if (last) {
        if (v.s >= (v.kind === 1 ? 0.49 : 0.5)) {
          v.s = Math.min(v.s, 0.5);
          if (v.kind === 0) { this.kill(v); this.onArrive(v); }
          else if (v.speed < 0.15) { v.speed = 0; this.onBusAtStop(v); }
        }
        continue;
      }
      if (v.s >= 0.95 && gated) { v.blocked += onRed ? dt * 0.3 : dt; if (v.blocked > 1.5 && v.reroute <= 0 && this.rerouteBudget > 0) this.reroute(v); }
      if (v.s >= 1) {
        const free = (ghost && this.tileCars[next].length < this.tileCap(next) * 2) || (!gated && this.tileCars[next].length < this.tileCap(next) && (w.blocked[next] <= 0 || v.blocked > 18));
        if (free) {
          const arr = this.tileCars[t];
          const idx = arr.indexOf(v);
          if (idx >= 0) { arr[idx] = arr[arr.length - 1]; arr.pop(); }
          this.tileCars[next].push(v);
          v.i = i + 1;
          v.s -= 1;
          v.lane = this.laneFor(v, next, t, false);
          v.blocked = 0;
        } else {
          v.s = 0.9999;
          v.speed = 0;
          v.blocked += dt;
          if (v.blocked > 1.5 && v.reroute <= 0 && this.rerouteBudget > 0) this.reroute(v);
        }
      }
      if (v.reroute > 0) v.reroute -= dt;
      else if (this.rerouteBudget > 0 && !last && (w.blocked[next] > 0 || (path.length - i > 5 && w.blocked[path[Math.min(path.length - 1, i + 3)]] > 0))) this.reroute(v);
    }
    // compact dead
    let wcur = 0;
    for (let k = 0; k < list.length; k++) if (!list[k].dead) list[wcur++] = list[k];
    list.length = wcur;
    // congestion update
    const a = 1 - Math.exp(-dt / 2.2);
    let loaded = 0, grid = 0, tot = 0, sum = 0;
    for (let k = 0; k < touched.length; k++) {
      const t = touched[k];
      const c = this.cnt[t];
      const raw = this.ratioSum[t] / c;
      this.cong[t] += (raw - this.cong[t]) * a;
      this.load[t] += (Math.min(1.2, c / 4.5) - this.load[t]) * a;
      if (c >= 2) { loaded++; tot += c; sum += (1 - this.cong[t]) * c; if (this.cong[t] < 0.22 && c >= 3) grid++; }
      this.cnt[t] = 0;
      this.ratioSum[t] = 0;
    }
    touched.length = 0;
    this.decayTimer += dt;
    if (this.decayTimer > 0.4) {
      const ad = 1 - Math.exp(-this.decayTimer / 5);
      this.decayTimer = 0;
      for (let t = 0; t < N * N; t++) {
        if (this.cong[t] < 0.999 && this.tileCars[t].length === 0) this.cong[t] += (1 - this.cong[t]) * ad;
        if (this.load[t] > 0.001 && this.tileCars[t].length === 0) this.load[t] *= 1 - ad;
      }
    }
    this.gridlock = grid;
    this.loadedTiles = loaded;
    this.trafficIndex = tot > 0 ? sum / tot : 0;
    this.carsMoving = moving;
    for (const v of list) this.pose(v);
  }

  /** height and pitch of a vehicle riding a highway deck; zero everywhere else, and for a street passing under an overpass */
  lift(v: Vehicle, out: { y: number; pitch: number }) {
    const w = this.world;
    out.y = 0; out.pitch = 0;
    const t = v.path[v.i];
    if (w.road[t] !== 3) return;
    w.ensureElev();
    const prev = v.i > 0 ? v.path[v.i - 1] : -1, next = v.i + 1 < v.path.length ? v.path[v.i + 1] : -1;
    if (w.under[t]) {
      const ref = prev >= 0 ? prev : next;
      if (ref < 0) return;
      const ax = (ref % N) !== (t % N) ? 0 : 1;
      if (ax !== w.hwAxis(t)) return;
    }
    const e = w.elev[t];
    const eIn = prev >= 0 && w.road[prev] === 3 ? (w.elev[prev] + e) / 2 : e;
    const eOut = next >= 0 && w.road[next] === 3 ? (w.elev[next] + e) / 2 : e;
    if (v.s < 0.5) { out.y = eIn + (e - eIn) * (v.s * 2); out.pitch = Math.atan((e - eIn) / 0.5); }
    else { out.y = e + (eOut - e) * ((v.s - 0.5) * 2); out.pitch = Math.atan((eOut - e) / 0.5); }
  }

  /** which lane a vehicle uses on tile n (cur = tile it comes from, -1 none) */
  private laneFor(v: Vehicle, n: number, cur: number, predict: boolean): number {
    if (v.kind === 1 && this.busLanes) return 2;
    if (this.world.eff(n) < 2) return 0;
    if (cur >= 0 && this.world.eff(cur) >= 2 && v.lane < 2) return v.lane;
    return predict ? (v.id & 1) : this.pickLane(n, v);
  }

  private pickLane(n: number, v: Vehicle): number {
    const arr = this.tileCars[n];
    let a = 0, b = 0;
    for (const u of arr) { if (u.lane === 0) a++; else b++; }
    return a <= b ? 0 : 1;
  }

  /** replan the rest of the trip from the next tile on */
  reroute(v: Vehicle): boolean {
    this.rerouteBudget--;
    v.reroute = 4 + Math.random() * 3;
    // a route cannot start on an overpass: begin after it
    let k = v.i + 1;
    while (k < v.path.length && this.world.under[v.path[k]]) k++;
    if (k >= v.path.length) return false;
    const from = v.path[k];
    const dest = v.path[v.path.length - 1];
    if (from === dest) return false;
    const np = this.router.find(from, dest);
    if (!np) return false;
    // do not accept a path through a blocked tile if the old one was not worse
    v.path = v.path.slice(0, k).concat(np);
    return true;
  }

  /** can a vehicle go prev -> t -> next on this overpass? straight, and on the right level */
  private overpassOK(prev: number, t: number, next: number): boolean {
    const w = this.world;
    const ref = prev >= 0 ? prev : next;
    if (ref < 0) return true;
    const ax = (ref % N) !== (t % N) ? 0 : 1;
    if (prev >= 0 && next >= 0 && t - prev !== next - t) return false;
    if (ax === w.hwAxis(t)) return (prev < 0 || w.road[prev] === 3) && (next < 0 || w.road[next] === 3);
    return (prev < 0 || w.road[prev] < 3 || w.ramp[prev] === 1 || w.under[prev] > 0) && (next < 0 || w.road[next] < 3 || w.ramp[next] === 1 || w.under[next] > 0);
  }

  /** a tile became an overpass: vehicles that planned to turn on it or to use it on the wrong level must replan */
  tileChanged(tile: number) {
    for (const v of [...this.vehicles, ...this.pending]) {
      if (v.dead) continue;
      let k = -1;
      for (let q = v.i; q < v.path.length; q++) if (v.path[q] === tile) { k = q; break; }
      if (k < 0) continue;
      if (this.overpassOK(k > 0 ? v.path[k - 1] : -1, tile, k + 1 < v.path.length ? v.path[k + 1] : -1)) continue;
      if (k === v.i) { this.kill(v); this.onStrand(v); continue; }
      let j = v.i;
      while (j < v.path.length && (this.world.under[v.path[j]] || v.path[j] === tile)) j++;
      const np = j < v.path.length ? this.router.find(v.path[j], v.path[v.path.length - 1]) : null;
      if (np && j > k) { v.path = v.path.slice(0, j).concat(np); }
      else { this.kill(v); this.onStrand(v); }
    }
  }

  /** a road tile was removed or changed: fix every vehicle that still plans to pass it */
  tileRemoved(tile: number) {
    for (const v of [...this.vehicles, ...this.pending]) {
      if (v.dead) continue;
      let hit = false;
      for (let k = v.i; k < v.path.length; k++) if (v.path[k] === tile) { hit = true; break; }
      if (!hit) continue;
      if (v.path[v.i] === tile) { this.kill(v); this.onStrand(v); continue; }
      // try to replan from the current tile (or the first one past an overpass)
      let k = v.i;
      while (k < v.path.length && this.world.under[v.path[k]]) k++;
      const np = k < v.path.length ? this.router.find(v.path[k], v.path[v.path.length - 1]) : null;
      if (np && !np.includes(tile)) {
        v.path = v.path.slice(0, k).concat(np);
        v.s = Math.min(v.s, 0.9);
      } else { this.kill(v); this.onStrand(v); }
    }
  }

  reset() {
    for (const a of this.tileCars) a.length = 0;
    this.vehicles.length = 0;
    this.pending.length = 0;
    this.cong.fill(1);
    this.load.fill(0);
  }
}
