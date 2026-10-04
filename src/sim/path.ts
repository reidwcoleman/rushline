// Routing: A* over the road grid (congestion aware) and over free ground for elevated track.
import { MinHeap } from './util.ts';
import { N, DX, DY, tileIdx, tileX, tileY, inMap, type World } from './world.ts';
import { isSolidCode } from './modes.ts';

export const SPEED_STREET = 1.9;   // tiles per second, free flow
export const SPEED_AVENUE = 2.7;

export const freeSpeed = (kind: number) => (kind >= 2 ? SPEED_AVENUE : SPEED_STREET);

export class RoadRouter {
  private g = new Float32Array(N * N);
  private came = new Int32Array(N * N);
  private stamp = new Int32Array(N * N);
  private cur = 0;
  private heap = new MinHeap();

  /** cong[i] in (0,1]: recent speed ratio on tile i (1 = free flow) */
  constructor(private world: World, readonly cong: Float32Array) {}

  /**
   * Tile path from `from` to `to` inclusive, or null. `cost` receives the estimated travel seconds.
   * Honours blocked tiles (accidents) by treating them as very expensive.
   */
  find(from: number, to: number, out?: { cost: number }): number[] | null {
    const w = this.world;
    if (from < 0 || to < 0 || !w.road[from] || !w.road[to]) return null;
    if (from === to) { if (out) out.cost = 0.5; return [from]; }
    this.cur++;
    const cur = this.cur, g = this.g, came = this.came, stamp = this.stamp, heap = this.heap;
    heap.clear();
    const tx = tileX(to), ty = tileY(to);
    g[from] = 0; stamp[from] = cur; came[from] = -1;
    heap.push(0, from);
    const H = 1 / SPEED_AVENUE;
    let found = false;
    let guard = 0;
    while (heap.size && guard++ < 6000) {
      const c = heap.pop();
      const cg = g[c];
      if (c === to) { found = true; break; }
      const cx = tileX(c), cy = tileY(c);
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!inMap(nx, ny)) continue;
        const n = tileIdx(nx, ny);
        const rk = w.road[n];
        if (!rk) continue;
        let step = 1 / (freeSpeed(rk) * Math.max(0.12, this.cong[n]));
        if (w.blocked[n] > 0) step += 40;
        const ng = cg + step;
        if (stamp[n] !== cur || ng < g[n]) {
          stamp[n] = cur; g[n] = ng; came[n] = c;
          heap.push(ng + (Math.abs(nx - tx) + Math.abs(ny - ty)) * H, n);
        }
      }
    }
    if (!found) return null;
    const path: number[] = [];
    for (let c = to; c !== -1; c = came[c]) path.push(c);
    path.reverse();
    if (out) out.cost = g[to];
    return path;
  }
}

/** Elevated-track router: 4-neighbour A* with a turn penalty; avoids buildings and other lines' track. */
export class TrackRouter {
  private g = new Float32Array(N * N * 4);
  private came = new Int32Array(N * N * 4);
  private stamp = new Int32Array(N * N * 4);
  private cur = 0;
  private heap = new MinHeap();
  constructor(private world: World) {}

  passable(i: number, lineId: number, goal: number): boolean {
    const w = this.world;
    if (i === goal) return w.bld[i] < 0 && !w.water[i] && w.rail[i] !== 0 ? w.rail[i] === lineId + 1 || isSolidCode(w.stopKind[i]) : w.bld[i] < 0 && !w.water[i];
    if (!w.isUnlocked(i)) return false;
    if (w.bld[i] >= 0) return false;
    if (isSolidCode(w.stopKind[i])) return false; // other stations are not drive-through
    const r = w.rail[i];
    if (r !== 0 && r !== lineId + 1) return false;
    return true;
  }

  /** returns tile list from..to inclusive, or null. */
  find(from: number, to: number, lineId: number, firstDir = -1, blocked?: Set<number>): number[] | null {
    const w = this.world;
    if (from === to) return [from];
    this.cur++;
    const cur = this.cur, g = this.g, came = this.came, stamp = this.stamp, heap = this.heap;
    heap.clear();
    const tx = tileX(to), ty = tileY(to);
    for (let d = 0; d < 4; d++) {
      if (firstDir >= 0 && d !== firstDir) continue;
      const s = from * 4 + d;
      g[s] = 0; stamp[s] = cur; came[s] = -1;
      heap.push(0, s);
    }
    let goalState = -1;
    let guard = 0;
    while (heap.size && guard++ < 30000) {
      const s = heap.pop();
      const t = s >> 2, dir = s & 3;
      if (t === to) { goalState = s; break; }
      const cg = g[s];
      const cx = tileX(t), cy = tileY(t);
      for (let d = 0; d < 4; d++) {
        if (((d + 2) & 3) === dir) continue; // no reversing
        const nx = cx + DX[d], ny = cy + DY[d];
        if (!inMap(nx, ny)) continue;
        const n = tileIdx(nx, ny);
        if (blocked && n !== to && blocked.has(n)) continue;
        if (n !== to && !this.passable(n, lineId, to)) continue;
        if (n === to && (w.bld[n] >= 0 || w.water[n])) continue;
        let step = w.road[n] ? 0.85 : w.water[n] ? 1.35 : w.park[n] ? 1.1 : 1.0;
        if (w.tree[n] && !w.road[n]) step += 0.05;
        if (d !== dir && t !== from) step += 0.55;
        else if (d !== dir) step += 0.15;
        const ns = n * 4 + d;
        const ng = cg + step;
        if (stamp[ns] !== cur || ng < g[ns]) {
          stamp[ns] = cur; g[ns] = ng; came[ns] = s;
          heap.push(ng + (Math.abs(nx - tx) + Math.abs(ny - ty)) * 0.85, ns);
        }
      }
    }
    if (goalState < 0) return null;
    const path: number[] = [];
    for (let s = goalState; s !== -1; s = came[s]) path.push(s >> 2);
    path.reverse();
    return path;
  }
}

/** Boat router: 8-neighbour A* over water tiles between two shore piers. Returns [pier, ...water, pier]. */
export class WaterRouter {
  private g = new Float32Array(N * N);
  private came = new Int32Array(N * N);
  private stamp = new Int32Array(N * N);
  private cur = 0;
  private heap = new MinHeap();
  constructor(private world: World) {}

  private touches(t: number, pier: number) {
    const x = tileX(t), y = tileY(t), px = tileX(pier), py = tileY(pier);
    return Math.abs(x - px) + Math.abs(y - py) === 1;
  }

  /** water tiles from a berth next to `from` (or the fixed `start` berth) to a berth next to `to` */
  find(from: number, to: number, start = -1): number[] | null {
    const w = this.world;
    if (from === to) return null;
    this.cur++;
    const cur = this.cur, g = this.g, came = this.came, stamp = this.stamp, heap = this.heap;
    heap.clear();
    const tx = tileX(to), ty = tileY(to);
    const h = (x: number, y: number) => Math.hypot(x - tx, y - ty);
    if (start >= 0) {
      g[start] = 0; stamp[start] = cur; came[start] = -1;
      heap.push(h(tileX(start), tileY(start)), start);
    } else {
      for (let d = 0; d < 4; d++) {
        const nx = tileX(from) + DX[d], ny = tileY(from) + DY[d];
        if (!inMap(nx, ny)) continue;
        const n = tileIdx(nx, ny);
        if (!w.water[n] || w.road[n]) continue;
        g[n] = 0; stamp[n] = cur; came[n] = -1;
        heap.push(h(nx, ny), n);
      }
    }
    let goal = -1, guard = 0;
    while (heap.size && guard++ < 6000) {
      const c = heap.pop();
      if (this.touches(c, to)) { goal = c; break; }
      const cx = tileX(c), cy = tileY(c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!inMap(nx, ny)) continue;
        const n = tileIdx(nx, ny);
        if (!w.water[n] || w.road[n]) continue;   // low bridges block boats
        if (dx && dy && (!w.water[tileIdx(cx + dx, cy)] || !w.water[tileIdx(cx, cy + dy)] || w.road[tileIdx(cx + dx, cy)] || w.road[tileIdx(cx, cy + dy)])) continue; // no corner cutting
        const ng = g[c] + (dx && dy ? 1.414 : 1);
        if (stamp[n] !== cur || ng < g[n]) { stamp[n] = cur; g[n] = ng; came[n] = c; heap.push(ng + h(nx, ny), n); }
      }
    }
    if (goal < 0) return null;
    const path: number[] = [];
    for (let c = goal; c !== -1; c = came[c]) path.push(c);
    path.reverse();
    return path;
  }
}

/** A polyline with cumulative length, sampled by distance; used for tracks and previews. */
export class Poly {
  pts: number[] = [];   // x,z pairs
  cum: number[] = [0];
  get length() { return this.cum[this.cum.length - 1]; }
  get count() { return this.pts.length / 2; }
  add(x: number, z: number) {
    const n = this.pts.length;
    if (n >= 2) {
      const dx = x - this.pts[n - 2], dz = z - this.pts[n - 1];
      const d = Math.hypot(dx, dz);
      if (d < 1e-4) return;
      this.cum.push(this.cum[this.cum.length - 1] + d);
    }
    this.pts.push(x, z);
  }
  /** position and heading at distance d, offset o to the right of the forward direction */
  at(d: number, o = 0, out = { x: 0, z: 0, ang: 0 }) {
    const n = this.pts.length / 2;
    if (n < 2) { out.x = this.pts[0] ?? 0; out.z = this.pts[1] ?? 0; out.ang = 0; return out; }
    const L = this.cum[n - 1];
    d = d < 0 ? 0 : d > L ? L : d;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= d) lo = m; else hi = m;
    }
    const ax = this.pts[lo * 2], az = this.pts[lo * 2 + 1], bx = this.pts[hi * 2], bz = this.pts[hi * 2 + 1];
    const sl = this.cum[hi] - this.cum[lo];
    const t = sl > 0 ? (d - this.cum[lo]) / sl : 0;
    let dx = bx - ax, dz = bz - az;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    // smooth the heading across vertices a little
    out.x = ax + (bx - ax) * t + -dz * o;
    out.z = az + (bz - az) * t + dx * o;
    out.ang = Math.atan2(dz, dx);
    return out;
  }
}

/** Rounded polyline through a tile path (corners become quadratic arcs). `tileDist[k]` = distance at tile k's centre. */
export function smoothTilePath(tiles: number[], wxf: (x: number) => number, wzf: (y: number) => number): { poly: Poly; tileDist: number[] } {
  const poly = new Poly();
  const tileDist: number[] = [];
  const P = tiles.map((t) => [wxf(tileX(t)), wzf(tileY(t))] as [number, number]);
  const n = P.length;
  for (let k = 0; k < n; k++) {
    const [x, z] = P[k];
    if (k === 0) { poly.add(x, z); tileDist.push(0); continue; }
    if (k === n - 1) { poly.add(x, z); tileDist.push(poly.length); continue; }
    const [px, pz] = P[k - 1], [nx, nz] = P[k + 1];
    const d1x = x - px, d1z = z - pz, d2x = nx - x, d2z = nz - z;
    if (d1x === d2x && d1z === d2z) { poly.add(x, z); tileDist.push(poly.length); continue; }
    const ax = (px + x) / 2, az = (pz + z) / 2, bx = (x + nx) / 2, bz = (z + nz) / 2;
    const steps = 8;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      poly.add(u * u * ax + 2 * u * t * x + t * t * bx, u * u * az + 2 * u * t * z + t * t * bz);
      if (s === steps / 2) tileDist.push(poly.length);
    }
  }
  return { poly, tileDist };
}
