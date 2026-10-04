// Road traffic: car-following on a tile grid, congestion measurement, rerouting.
import { N, DX, DY, tileX, tileY, tileIdx, wx, wz, type World } from './world.ts';
import { RoadRouter, freeSpeed } from './path.ts';
import type { Vehicle, Person, Carrier } from './types.ts';

const ACC = 3.0;
const BRAKE = 5.5;
export const CAR_LEN = 0.32;
export const BUS_LEN = 0.58;
const PAD = 0.06;

export const laneOffset = (kindMin: number, lane: number) => (lane === 2 ? (kindMin >= 2 ? 0.2 : 0.19) : kindMin >= 2 ? (lane === 0 ? 0.14 : 0.31) : 0.15);

export class Traffic {
  vehicles: Vehicle[] = [];
  tileCars: Vehicle[][] = Array.from({ length: N * N }, () => []);
  cong = new Float32Array(N * N).fill(1);
  load = new Float32Array(N * N);
  router: RoadRouter;
  pending: Vehicle[] = [];
  speedMul = 1;
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
    for (let t = 0; t < N * N; t++) {
      let deg = 0;
      if (w.road[t]) {
        const x = tileX(t), y = tileY(t);
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (nx >= 0 && ny >= 0 && nx < N && ny < N && w.road[tileIdx(nx, ny)]) deg++;
        }
      }
      this.deg[t] = deg;
    }
  }

  tileCap(t: number): number {
    this.refreshDeg();
    if (this.world.road[t] >= 2) return 10;
    return this.deg[t] >= 3 ? 5 : 6;
  }

  /** a vehicle waiting to enter junction tile `next` from `t` yields to anything crossing inside it */
  private crossConflict(v: Vehicle, t: number, next: number): boolean {
    if (this.deg[next] < 3) return false;
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
    const kIn = prev >= 0 ? Math.min(w.road[prev], w.road[t]) : w.road[t];
    const kOut = next >= 0 ? Math.min(w.road[next], w.road[t]) : w.road[t];
    const oIn = laneOffset(kIn, v.lane), oOut = laneOffset(kOut, v.lane);
    // right-hand traffic: right of (dx,dz) is (-dz,dx)
    const rix = -diz, riz = dix, rox = -doz, roz = dox;
    const ex = cx - dix * 0.5 + rix * oIn;
    const ez = cz - diz * 0.5 + riz * oIn;
    const xx = next >= 0 ? cx + dox * 0.5 + rox * oOut : cx + rix * oIn;
    const xz = next >= 0 ? cz + doz * 0.5 + roz * oOut : cz + riz * oIn;
    const s = v.s;
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

  step(dt: number, speedMul: number) {
    const w = this.world;
    this.refreshDeg();
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
      const kind = w.road[t];
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
      // gap to the nearest leader
      let margin = 9;
      const ghost = v.ghost > 0;
      if (ghost) v.ghost -= dt;
      const cars = this.tileCars[t];
      const myLane = v.lane;
      for (let c = 0; c < cars.length && !ghost; c++) {
        const u = cars[c];
        if (u === v || u.lane !== myLane || u.dead) continue;
        const ue = u.i + 1 < u.path.length ? u.path[u.i + 1] : -1;
        if (ue !== next || u.s <= v.s) continue;
        const gap = u.s - v.s - (v.len + u.len) * 0.5 - PAD;
        if (gap < margin) margin = gap;
      }
      let nextLane = 0;
      let gated = false;
      if (next >= 0 && v.s > 0.5) {
        if (!ghost && (this.tileCars[next].length >= this.tileCap(next) || w.blocked[next] > 0 || this.crossConflict(v, t, next)) && v.blocked < 18) {
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
      this.ratioSum[t] += v.speed / freeSpeed(kind);
      // arrival
      if (last) {
        if (v.s >= (v.kind === 1 ? 0.49 : 0.5)) {
          v.s = Math.min(v.s, 0.5);
          if (v.kind === 0) { this.kill(v); this.onArrive(v); }
          else if (v.speed < 0.15) { v.speed = 0; this.onBusAtStop(v); }
        }
        continue;
      }
      if (v.s >= 0.95 && gated) { v.blocked += dt; if (v.blocked > 1.5 && v.reroute <= 0 && this.rerouteBudget > 0) this.reroute(v); }
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

  /** which lane a vehicle uses on tile n (cur = tile it comes from, -1 none) */
  private laneFor(v: Vehicle, n: number, cur: number, predict: boolean): number {
    if (v.kind === 1 && this.busLanes) return 2;
    if (this.world.road[n] < 2) return 0;
    if (cur >= 0 && this.world.road[cur] >= 2 && v.lane < 2) return v.lane;
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
    const from = v.i + 1 < v.path.length ? v.path[v.i + 1] : -1;
    if (from < 0) return false;
    const dest = v.path[v.path.length - 1];
    if (from === dest) return false;
    const np = this.router.find(from, dest);
    if (!np) return false;
    // do not accept a path through a blocked tile if the old one was not worse
    v.path = v.path.slice(0, v.i + 1).concat(np);
    return true;
  }

  /** a road tile was removed or changed: fix every vehicle that still plans to pass it */
  tileRemoved(tile: number) {
    for (const v of [...this.vehicles, ...this.pending]) {
      if (v.dead) continue;
      let hit = false;
      for (let k = v.i; k < v.path.length; k++) if (v.path[k] === tile) { hit = true; break; }
      if (!hit) continue;
      if (v.path[v.i] === tile) { this.kill(v); this.onStrand(v); continue; }
      // try to replan from the current tile
      const np = this.router.find(v.path[v.i], v.path[v.path.length - 1]);
      if (np && !np.includes(tile)) {
        v.path = np;
        v.i = 0;
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
