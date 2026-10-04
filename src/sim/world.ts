// The map: terrain height function (shared with the renderer), tile layers, districts.
import { Noise2, mulberry32, smoothstep, clamp, type Rng } from './util.ts';

export const N = 40;            // playable tiles per side
export const DS = 10;           // district size in tiles
export const DN = N / DS;       // districts per side (4)
export const HALF = N / 2;      // world units from centre to edge of the playable square
export const WATER_LEVEL = -0.12;

// directions: 0 E(+x) 1 S(+z) 2 W(-x) 3 N(-z)
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export const tileIdx = (x: number, y: number) => y * N + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
export const tileX = (i: number) => i % N;
export const tileY = (i: number) => (i / N) | 0;
/** world x/z of a tile centre (1 tile = 1 world unit) */
export const wx = (x: number) => x - HALF + 0.5;
export const wz = (y: number) => y - HALF + 0.5;
export const distIdx = (i: number) => {
  const x = i % N, y = (i / N) | 0;
  const dx = Math.floor(x / DS), dy = Math.floor(y / DS);
  return dy * DN + dx;
};

export interface River { pts: [number, number][]; width: number[] }

export class Terrain {
  noise: Noise2;
  noise2: Noise2;
  rivers: River[] = [];
  lake: { x: number; z: number; rx: number; rz: number; rot: number } | null = null;
  coast: number[] = [];

  constructor(readonly seed: number) {
    const r = mulberry32(seed * 7919 + 13);
    this.noise = new Noise2(seed);
    this.noise2 = new Noise2(seed + 101);
    // coastline radius by angle
    for (let i = 0; i < 64; i++) this.coast.push(0);
    this.makeRiver(r);
  }

  private makeRiver(r: Rng) {
    // a river crosses the island on a random diagonal-ish line, offset from the centre
    const ang = r() * Math.PI * 2;
    const dirx = Math.cos(ang), dirz = Math.sin(ang);
    const nx = -dirz, nz = dirx;
    const offset = (r() < 0.5 ? -1 : 1) * (6.5 + r() * 4.5);
    const pts: [number, number][] = [];
    const width: number[] = [];
    const seg = 14;
    const amp = 3.5 + r() * 2.5;
    const ph = r() * 6.28;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg - 0.5) * 120;
      const bend = Math.sin(i * 0.9 + ph) * amp + Math.sin(i * 0.37 + ph * 2) * amp * 0.6;
      pts.push([dirx * t + nx * (offset + bend), dirz * t + nz * (offset + bend)]);
      width.push(1.15 + 0.35 * Math.sin(i * 0.6 + ph) + 0.12 * i / seg);
    }
    this.rivers.push({ pts, width });
    // a small lake on the other side of the centre
    const la = ang + Math.PI * (r() < 0.5 ? 0.5 : -0.5) + (r() - 0.5) * 0.6;
    const dist = 8 + r() * 5;
    this.lake = { x: Math.cos(la) * dist + nx * -offset * 0.4, z: Math.sin(la) * dist + nz * -offset * 0.4, rx: 2.6 + r() * 1.4, rz: 2.0 + r() * 1.2, rot: r() * 3 };
    // keep the lake out of the central 8x8
    const lk = this.lake;
    if (Math.hypot(lk.x, lk.z) < 11) { const s = 11 / Math.max(0.1, Math.hypot(lk.x, lk.z)); lk.x *= s; lk.z *= s; }
  }

  /** distance to the river and its half-width at the nearest point */
  riverField(x: number, z: number): { d: number; w: number } {
    let best = 1e9, bw = 1;
    for (const rv of this.rivers) {
      for (let i = 0; i < rv.pts.length - 1; i++) {
        const [ax, az] = rv.pts[i], [bx, bz] = rv.pts[i + 1];
        const abx = bx - ax, abz = bz - az;
        const t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz));
        const px = ax + abx * t, pz = az + abz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < best) { best = d; bw = rv.width[i] * (1 - t) + rv.width[i + 1] * t; }
      }
    }
    return { d: best, w: bw };
  }

  lakeField(x: number, z: number): number {
    const l = this.lake;
    if (!l) return 1e9;
    const c = Math.cos(l.rot), s = Math.sin(l.rot);
    const dx = x - l.x, dz = z - l.z;
    const u = (dx * c + dz * s) / l.rx, v = (-dx * s + dz * c) / l.rz;
    // wobble the shoreline a bit
    const wob = 1 + 0.18 * this.noise2.get(x * 0.35, z * 0.35);
    return Math.hypot(u, v) / wob;
  }

  /** island coast radius at an angle */
  coastR(x: number, z: number): number {
    const a = Math.atan2(z, x);
    return 40 + 4.5 * this.noise.fbm(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3 + 3, 3) + 2.5 * this.noise2.get(Math.cos(a) * 3.1, Math.sin(a) * 3.1);
  }

  /** terrain height in world units. 0 = flat building ground. */
  height(x: number, z: number): number {
    const sq = Math.max(Math.abs(x), Math.abs(z));
    const flat = 1 - smoothstep(HALF + 0.5, HALF + 7, sq);
    // rolling hills + a couple of bigger ridges outside the playable square
    const n = this.noise.fbm(x * 0.07 + 11, z * 0.07 + 5, 4) * 0.5 + 0.5;
    const ridge = 1 - Math.abs(this.noise2.fbm(x * 0.045 + 3, z * 0.045 + 9, 3));
    let h = (n * 2.6 + ridge * ridge * 3.4) * (1 - flat);
    // tiny undulation inside so the ground is not a perfect plane (under 0.02: invisible under buildings)
    h += flat * 0.0;
    // coast: slope down to the sea
    const r = Math.hypot(x, z);
    const cr = this.coastR(x, z);
    const shore = smoothstep(cr - 9, cr + 1.5, r);
    h = h * (1 - shore * 0.85) - shore * 2.4 - smoothstep(cr + 0, cr + 14, r) * 4;
    // beach plateau near the water line so the sand reads
    // rivers + lake carve
    const rf = this.riverField(x, z);
    const bank = smoothstep(rf.w + 1.1, rf.w * 0.35, rf.d);
    const lk = this.lakeField(x, z);
    const lbank = smoothstep(1.35, 0.55, lk);
    const carve = Math.max(bank, lbank);
    h = h * (1 - carve) + carve * -0.62 * (1 - 0.0);
    // keep a slight lip at the bank so water sits below the grass
    return h;
  }

  isWaterAt(x: number, z: number): boolean {
    return this.height(x, z) < WATER_LEVEL + 0.02;
  }
}

export interface DistrictInfo {
  index: number;
  col: number;
  row: number;
  unlocked: boolean;
  cost: number;
  landTiles: number;
}

export class World {
  terrain: Terrain;
  water = new Uint8Array(N * N);       // 1 = water
  shore = new Uint8Array(N * N);       // 1 = land next to water
  road = new Uint8Array(N * N);        // 0 none, 1 street, 2 avenue, 3 highway
  ramp = new Uint8Array(N * N);        // 1 = highway tile that joins the roads around it (an interchange)
  ctl = new Uint8Array(N * N);         // junction control: 0 priority, 1 signals, 2 roundabout
  under = new Uint8Array(N * N);       // highway tile with a street beneath it: class of that street | (highway axis << 2), 0 none
  elev = new Float32Array(N * N);      // height of the highway deck at a tile centre
  private elevVer = -1;
  park = new Uint8Array(N * N);        // 1 = park
  rail = new Uint8Array(N * N);        // line id + 1 of track passing over (0 none)
  bld = new Int32Array(N * N).fill(-1);
  stop = new Int32Array(N * N).fill(-1);
  stopKind = new Uint8Array(N * N);    // 0 none, 1 bus stop, 2 metro station
  tree = new Uint8Array(N * N);        // 1 = trees on this tile (cleared when developed)
  blocked = new Float32Array(N * N);   // seconds an accident blocks this road tile
  unlocked = new Uint8Array(DN * DN);
  districts: DistrictInfo[] = [];
  /** 0 downtown .. 1 outskirts, for zoning character */
  centre: Float32Array = new Float32Array(N * N);
  industrial: Float32Array = new Float32Array(N * N);
  version = { roads: 0, tiles: 0, lock: 0 };

  constructor(readonly seed: number) {
    this.terrain = new Terrain(seed);
    const t = this.terrain;
    const r = mulberry32(seed + 5);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      const cx = wx(x), cz = wz(y);
      // a tile is water when its centre and most of its footprint are below water
      let wet = 0;
      for (const [ox, oz] of [[0, 0], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) if (t.isWaterAt(cx + ox, cz + oz)) wet++;
      this.water[i] = wet >= 3 ? 1 : 0;
      this.tree[i] = 0;
      // character maps
      const d = Math.hypot(cx - 1, cz - 1);
      this.centre[i] = clamp(d / 22);
      this.industrial[i] = clamp(0.5 * (t.noise2.fbm(cx * 0.09 + 20, cz * 0.09, 3) * 0.5 + 0.5) + 0.5 * smoothstep(8, 20, d));
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (this.water[i]) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (inMap(nx, ny) && this.water[tileIdx(nx, ny)]) { this.shore[i] = 1; break; }
      }
    }
    // trees: sparse forest on land, thicker away from the middle
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (this.water[i]) continue;
      const f = t.noise.fbm(wx(x) * 0.18 + 40, wz(y) * 0.18, 3) * 0.5 + 0.5;
      const p = 0.1 + 0.55 * smoothstep(0.45, 0.7, f) + 0.12 * this.centre[i];
      if (r() < p) this.tree[i] = 1;
    }
    // districts
    for (let i = 0; i < DN * DN; i++) {
      const col = i % DN, row = (i / DN) | 0;
      let land = 0;
      for (let y = row * DS; y < row * DS + DS; y++) for (let x = col * DS; x < col * DS + DS; x++) if (!this.water[tileIdx(x, y)]) land++;
      const ring = Math.max(Math.abs(col - 1.5), Math.abs(row - 1.5)); // 0.5 centre, 1.5 outer
      this.districts.push({ index: i, col, row, unlocked: false, cost: 0, landTiles: land });
      const corner = Math.abs(col - 1.5) > 1.4 && Math.abs(row - 1.5) > 1.4;
      this.districts[i].cost = ring < 1 ? 0 : corner ? 7500 : 4500;
    }
    for (const c of [5, 6, 9, 10]) this.setUnlocked(c, true);
  }

  setUnlocked(d: number, v: boolean) {
    this.unlocked[d] = v ? 1 : 0;
    this.districts[d].unlocked = v;
    this.version.lock++;
  }
  isUnlocked(i: number) { return this.unlocked[distIdx(i)] === 1; }

  /** buildable ground: land, unlocked */
  buildable(i: number) { return !this.water[i] && this.isUnlocked(i); }

  /** the road class a tile drives like: an interchange behaves as an avenue */
  eff(i: number): number { const r = this.road[i]; return r === 3 && this.ramp[i] ? 2 : r; }
  /** street or avenue: the roads buildings face and people walk beside */
  surf(i: number): boolean { const r = this.road[i]; return r === 1 || r === 2; }
  /** axis of travel between two adjacent tiles: 0 east-west, 1 north-south */
  private axisBetween(a: number, b: number): number { return (a % N) !== (b % N) ? 0 : 1; }
  /** an overpass: a highway tile with a street running beneath it. Axis of the highway on top, or -1 */
  hwAxis(i: number): number { return this.under[i] ? (this.under[i] >> 2) & 1 : -1; }
  /** a highway only meets other roads at an interchange; an overpass lets a street pass beneath */
  linked(a: number, b: number): boolean {
    const ra = this.road[a], rb = this.road[b];
    if (!ra || !rb) return false;
    if (ra === 3 && rb < 3) return this.ramp[a] === 1 || (this.under[a] > 0 && this.axisBetween(a, b) !== this.hwAxis(a));
    if (rb === 3 && ra < 3) return this.ramp[b] === 1 || (this.under[b] > 0 && this.axisBetween(a, b) !== this.hwAxis(b));
    if (ra === 3 && rb === 3) {
      if (this.ramp[a] || this.ramp[b]) return true;
      const ax = this.axisBetween(a, b);
      if (this.under[a] && ax !== this.hwAxis(a)) return false;
      if (this.under[b] && ax !== this.hwAxis(b)) return false;
    }
    return true;
  }
  /** raise the deck over overpasses and ease it down the highway on either side */
  ensureElev() {
    if (this.elevVer === this.version.roads) return;
    this.elevVer = this.version.roads;
    this.elev.fill(0);
    const H = 0.32, RAMP = 3;
    const q: number[] = [];
    for (let i = 0; i < N * N; i++) if (this.road[i] === 3 && this.under[i]) { this.elev[i] = H; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const e = this.elev[i] - H / RAMP;
      if (e <= 0.001) continue;
      const x = i % N, y = (i / N) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inMap(nx, ny)) continue;
        const n = tileIdx(nx, ny);
        if (this.road[n] !== 3 || this.ramp[n] || this.under[n] || !this.linked(i, n)) continue;
        if (this.elev[n] < e - 1e-4) { this.elev[n] = e; q.push(n); }
      }
    }
  }
  /** number of roads a vehicle on tile i can drive on to */
  degree(i: number): number {
    if (!this.road[i]) return 0;
    const x = i % N, y = (i / N) | 0;
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (inMap(nx, ny) && this.linked(i, tileIdx(nx, ny))) n++;
    }
    return n;
  }
  roadConn(x: number, y: number): number {
    let m = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (inMap(nx, ny) && this.road[tileIdx(nx, ny)]) m |= 1 << d;
    }
    return m;
  }
  isBridge(i: number) { return this.road[i] > 0 && this.water[i] === 1; }
  isEmpty(i: number) { return this.road[i] === 0 && this.park[i] === 0 && this.bld[i] < 0 && this.stop[i] < 0; }
}
