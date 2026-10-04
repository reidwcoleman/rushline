// Road network mesh: sidewalks, asphalt with rounded junctions, lane markings, bridges. One merged mesh, vertex coloured.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, mix3, shade3 } from './gfx.ts';
import { N, DX, DY, tileIdx, wx, wz, inMap, type World } from '../sim/world.ts';

const SIDEWALK = lin(0xd9d3c6);
const SIDEWALK_B = lin(0xcfc8ba);
const ASPHALT = lin(0x3a4050);
const ASPHALT_B = lin(0x353b4a);
const WHITE = lin(0xf3f0e6);
const YELLOW = lin(0xf2c14e);
const CONCRETE = lin(0xc7c3b8);
const RAIL = lin(0xeae6dc);
const SHOULDER = lin(0x8d897f);
const BARRIER = lin(0xb9b6ac);
const CURB = lin(0xcfcabd);
const GRASS = lin(0x6b9a54);
const BUSH = lin(0x4f8442);
const GREEN_SIGN = lin(0x1f7a52);

const Y_SIDE = 0.011, Y_ASPH = 0.016, Y_MARK = 0.0195;

export class Roads {
  mesh: THREE.Mesh;
  bridgeMesh: THREE.Mesh;
  private asphalt = new Map<number, number[]>();
  private baseColors: Float32Array = new Float32Array(0);
  private overlay = 0;

  constructor(readonly world: World, readonly scene: THREE.Scene) {
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), { cloud: true, grain: 0.16, wet: true });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    const bmat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), { cloud: true, wet: true });
    this.bridgeMesh = new THREE.Mesh(new THREE.BufferGeometry(), bmat);
    this.bridgeMesh.castShadow = true;
    this.bridgeMesh.receiveShadow = true;
    scene.add(this.bridgeMesh);
  }

  /** flat polygon (convex) with winding fixed to face up; y may be a function of position for sloped decks */
  private poly(b: MeshBuilder, pts: number[][], y: number | ((x: number, z: number) => number), c: number[]) {
    // fan triangulation; every triangle is wound individually so it faces up whatever the polygon's orientation
    const ids = pts.map((p) => b.vert(p[0], typeof y === 'number' ? y : y(p[0], p[1]), p[1], 0, 1, 0, c));
    for (let i = 1; i + 1 < ids.length; i++) {
      const A = pts[0], B = pts[i], C = pts[i + 1];
      const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      if (Math.abs(ny) < 1e-9) continue;
      if (ny > 0) b.tri(ids[0], ids[i], ids[i + 1]); else b.tri(ids[0], ids[i + 1], ids[i]);
    }
  }

  /** a barrier run, cut into short pieces so it follows a sloped deck */
  private rail(b: MeshBuilder, x: number, z: number, alongX: boolean, len: number, thick: number, h: number, yM: number | ((x: number, z: number) => number)) {
    const pieces = Math.max(1, Math.round(len / 0.0625));
    const pl = len / pieces;
    for (let k = 0; k < pieces; k++) {
      const off = -len / 2 + pl * (k + 0.5);
      const px = alongX ? x + off : x, pz = alongX ? z : z + off;
      const y0 = typeof yM === 'number' ? yM : yM(px, pz);
      b.box(px, y0, pz, alongX ? pl : thick, h, alongX ? thick : pl, BARRIER);
    }
  }

  /** lane lines, barriers and the box junction of a highway or interchange tile */
  private hwyMarks(b: MeshBuilder, cx: number, cz: number, conn: boolean[], nbKind: number[], ramp: boolean, yM: number | ((x: number, z: number) => number), dash: (x0: number, z0: number, dx: number, dz: number, len: number, wd: number, c: number[]) => void) {
    let hwArms = 0;
    for (let d = 0; d < 4; d++) if (conn[d] && nbKind[d] === 3) hwArms++;
    for (let d = 0; d < 4; d++) {
      if (!conn[d] || nbKind[d] !== 3) continue;
      const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
      // solid edge lines, dashed lane line between the two lanes of each direction
      for (const sd of [-1, 1]) {
        dash(cx + ex * 0.0 + px * sd * 0.425, cz + ez * 0.0 + pz * sd * 0.425, ex, ez, 0.5, 0.012, WHITE);
        for (const t0 of [0.03, 0.27]) dash(cx + ex * t0 + px * sd * 0.265, cz + ez * t0 + pz * sd * 0.265, ex, ez, 0.17, 0.01, WHITE);
      }
      if (!ramp && hwArms <= 2) this.rail(b, cx + ex * 0.25, cz + ez * 0.25, ex !== 0, 0.5, 0.05, 0.034, yM);
      if (!ramp) for (const sd of [-1, 1]) this.rail(b, cx + ex * 0.25 + px * sd * 0.475, cz + ez * 0.25 + pz * sd * 0.475, ex !== 0, 0.5, 0.016, 0.022, yM);
    }
    if (hwArms <= 2 && !ramp) {
      // a closed end or a bend: cap the median so it reads as a solid barrier
      this.rail(b, cx, cz, true, 0.05, 0.05, 0.034, yM);
    }
    if (ramp) {
      // box junction: where the highway lets traffic on and off
      const m = 0.3;
      for (const sd of [-1, 1]) { dash(cx - m, cz + sd * m, 1, 0, 2 * m, 0.012, WHITE); dash(cx + sd * m, cz - m, 0, 1, 2 * m, 0.012, WHITE); }
      for (const sg of [-1, 1]) {
        const x0 = cx - m, z0 = cz - sg * m, len = Math.SQRT2 * 2 * m, ang = Math.atan2(sg * 2 * m, 2 * m);
        dash(x0, z0, Math.cos(ang), Math.sin(ang), len, 0.01, YELLOW);
      }
    }
  }

  /** island, yield lines and splitters of a roundabout */
  private rabMarks(b: MeshBuilder, cx: number, cz: number, conn: boolean[], hwArm: number[], yM: number, dash: (x0: number, z0: number, dx: number, dz: number, len: number, wd: number, c: number[]) => void) {
    const ring = (r: number, y: number, c: number[], k = 28) => {
      const pts: number[][] = [];
      for (let q = 0; q < k; q++) { const a = (q / k) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
      this.poly(b, pts, y, c);
    };
    ring(0.215, yM + 0.002, CURB);
    ring(0.185, yM + 0.004, GRASS);
    b.blob(cx, yM + 0.02, cz, 0.075, 0.065, 0.075, BUSH, 7, 4);
    b.blob(cx + 0.06, yM + 0.012, cz - 0.04, 0.04, 0.035, 0.04, mix3(BUSH, GRASS, 0.4), 6, 3);
    for (let d = 0; d < 4; d++) {
      if (!conn[d]) continue;
      const h = hwArm[d];
      const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
      // splitter island in the arm's centre and a yield line on the way in
      dash(cx + ex * 0.4, cz + ez * 0.4, ex, ez, 0.1, 0.07, CURB);
      dash(cx + ex * 0.395 - px * h * 0.5, cz + ez * 0.395 - pz * h * 0.5, ex, ez, 0.018, h * 0.78, WHITE);
    }
  }


  /** which neighbours a layer of tile i drives on to, and their road class. `layer`: 0 the road as it lies, 1 the street beneath an overpass, 2 the highway over it */
  private arms(i: number, layer: 0 | 1 | 2) {
    const w = this.world, tx = i % N, ty = (i / N) | 0;
    const conn: boolean[] = [], nbKind: number[] = [];
    const ax = w.hwAxis(i);
    let n = 0;
    for (let d = 0; d < 4; d++) {
      const nx = tx + DX[d], ny = ty + DY[d];
      const ni = inMap(nx, ny) ? tileIdx(nx, ny) : -1;
      let nk = 0;
      if (ni >= 0 && w.road[ni]) {
        if (layer === 0) {
          if (w.linked(i, ni)) nk = w.road[ni] === 3 && w.under[ni] ? (w.road[i] === 3 ? 3 : w.under[ni] & 3) : w.road[ni];
        } else if (layer === 1) {
          if ((d & 1) !== ax) {
            const r = w.road[ni];
            if (r < 3) nk = r; else if (w.ramp[ni]) nk = 2; else if (w.under[ni] && w.hwAxis(ni) === ax) nk = w.under[ni] & 3;
          }
        } else if ((d & 1) === ax && w.road[ni] === 3 && w.linked(i, ni)) nk = 3;
      }
      conn.push(nk > 0); nbKind.push(nk);
      if (nk) n++;
    }
    return { conn, nbKind, n };
  }

  /** deck height at a point of highway tile i: tile centre height, eased to the neighbours at each edge */
  private deckFn(i: number): (x: number, z: number) => number {
    const w = this.world;
    const e = w.elev[i];
    if (e <= 0 && !this.slopedAround(i)) return () => 0;
    const edge = (d: number) => {
      const nx = (i % N) + DX[d], ny = ((i / N) | 0) + DY[d];
      if (!inMap(nx, ny)) return e;
      const n = tileIdx(nx, ny);
      return w.road[n] === 3 && w.linked(i, n) ? (e + w.elev[n]) / 2 : e;
    };
    const eE = edge(0), eS = edge(1), eW = edge(2), eN = edge(3);
    const cx = wx(i % N), cz = wz((i / N) | 0);
    return (x: number, z: number) => {
      const dx = x - cx, dz = z - cz;
      const ex = dx >= 0 ? (eE - e) * (dx / 0.5) : (eW - e) * (-dx / 0.5);
      const ez = dz >= 0 ? (eS - e) * (dz / 0.5) : (eN - e) * (-dz / 0.5);
      return e + ex + ez;
    };
  }
  private slopedAround(i: number) {
    const w = this.world;
    for (let d = 0; d < 4; d++) {
      const nx = (i % N) + DX[d], ny = ((i / N) | 0) + DY[d];
      if (inMap(nx, ny) && w.elev[tileIdx(nx, ny)] > 0) return true;
    }
    return false;
  }

  /** one layer of one tile: sidewalk or shoulder, asphalt, markings. Returns the vertex range of the asphalt. */
  private layer(b: MeshBuilder, i: number, kind: number, conn: boolean[], nbKind: number[], n: number, bridge: boolean, yf: (x: number, z: number) => number, ctlOn: boolean): [number, number] {
    const w = this.world;
    const tx = i % N, ty = (i / N) | 0;
    const cx = wx(tx), cz = wz(ty);
    const hwArm = nbKind.map((nk) => (kind === 3 ? (nk === 3 ? 0.45 : nk === 2 ? 0.42 : 0.3) : (kind === 2 && nk >= 2 ? 0.42 : 0.3)));
    const hwy = kind === 3;
    const rab = ctlOn && !hwy && w.ctl[i] === 2 && n >= 3;
    const sig = ctlOn && !hwy && w.ctl[i] === 1 && n >= 3;
    const ramp = hwy && w.ramp[i] === 1;
    const hwC = hwy ? 0.45 : kind === 2 ? 0.42 : 0.3;
    const yoff = bridge ? 0.022 : 0;
    const tone = ((tx * 7 + ty * 13) % 5) * 0.012;
    const Y = (base: number) => (x: number, z: number) => base + yoff + yf(x, z);
    const yS = Y(Y_SIDE), yA = Y(Y_ASPH), yM = Y(Y_MARK);
    // sidewalk slab, or the gravel shoulder of a highway
    const sw = shade3(((tx + ty) & 1) ? SIDEWALK : SIDEWALK_B, 1 - tone * 0.5);
    if (!bridge) {
      if (hwy) this.poly(b, [[cx - 0.5, cz - 0.5], [cx + 0.5, cz - 0.5], [cx + 0.5, cz + 0.5], [cx - 0.5, cz + 0.5]], yS, shade3(SHOULDER, 1 - tone * 0.5));
      else b.floor(cx, Y_SIDE, cz, 1, 1, sw);
    }
    const asph = shade3(((tx + ty) & 1) ? ASPHALT : ASPHALT_B, 1 - tone);
    const v0 = b.count;
    const sq = [[cx - hwC, cz - hwC], [cx + hwC, cz - hwC], [cx + hwC, cz + hwC], [cx - hwC, cz + hwC]];
    if (rab) {
      const pts: number[][] = [];
      for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; pts.push([cx + Math.cos(a) * 0.46, cz + Math.sin(a) * 0.46]); }
      this.poly(b, pts, yA, asph);
      for (let d = 0; d < 4; d++) {
        if (!conn[d]) continue;
        const h = hwArm[d];
        const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
        const sx = cx + ex * 0.32, sz = cz + ez * 0.32, fx = cx + ex * 0.5, fz = cz + ez * 0.5;
        this.poly(b, [[sx + px * h, sz + pz * h], [fx + px * h, fz + pz * h], [fx - px * h, fz - pz * h], [sx - px * h, sz - pz * h]], yA, asph);
      }
    } else if (n === 0) {
      // cul-de-sac disc
      const pts: number[][] = [];
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; pts.push([cx + Math.cos(a) * hwC * 1.1, cz + Math.sin(a) * hwC * 1.1]); }
      this.poly(b, pts, yA, asph);
    } else {
      this.poly(b, sq, yA, ramp ? shade3(asph, 1.18) : asph);
      for (let d = 0; d < 4; d++) {
        if (!conn[d]) continue;
        const h = hwArm[d];
        const ex = DX[d], ez = DY[d];            // arm direction
        const px = -ez, pz = ex;                  // perpendicular
        const sx = cx + ex * hwC, sz = cz + ez * hwC;
        const fx = cx + ex * 0.5, fz = cz + ez * 0.5;
        // arm from the centre square edge to the tile edge, width 2h (use hwC at the near side for continuity)
        this.poly(b, [[sx + px * hwC, sz + pz * hwC], [fx + px * h, fz + pz * h], [fx - px * h, fz - pz * h], [sx - px * hwC, sz - pz * hwC]], yA, asph);
      }
      // rounded junction corners between adjacent connected arms
      for (let d = 0; d < 4; d++) {
        const d2 = (d + 1) & 3;
        if (!conn[d] || !conn[d2]) continue;
        const r = 0.17;
        const ax = DX[d], az = DY[d], bx = DX[d2], bz = DY[d2];
        // corner point of the centre square toward both arms
        const hx = cx + (ax + bx) * hwC, hz = cz + (az + bz) * hwC;
        // arc centre is r further along both arm directions
        const ox = hx + (ax + bx) * r, oz = hz + (az + bz) * r;
        const pts: number[][] = [[hx, hz]];
        // arc from point on arm a's edge to point on arm b's edge
        const s0x = ox - bx * r, s0z = oz - bz * r; // point on the edge line along arm a (offset back along b)
        const s1x = ox - ax * r, s1z = oz - az * r;
        const a0 = Math.atan2(s0z - oz, s0x - ox), a1 = Math.atan2(s1z - oz, s1x - ox);
        let da = a1 - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const steps = 6;
        for (let k = 0; k <= steps; k++) { const a = a0 + (da * k) / steps; pts.push([ox + Math.cos(a) * r, oz + Math.sin(a) * r]); }
        this.poly(b, pts, yA, asph);
      }
    }
    const range: [number, number] = [v0, b.count];
    // ---- markings
    const dash = (x0: number, z0: number, dx: number, dz: number, len: number, wd: number, c: number[]) => {
      // rectangle starting at (x0,z0) extending len along (dx,dz), width wd
      const px = -dz, pz = dx;
      this.poly(b, [[x0 + px * wd / 2, z0 + pz * wd / 2], [x0 + dx * len + px * wd / 2, z0 + dz * len + pz * wd / 2], [x0 + dx * len - px * wd / 2, z0 + dz * len - pz * wd / 2], [x0 - px * wd / 2, z0 - pz * wd / 2]], yM, c);
    };
    if (hwy) this.hwyMarks(b, cx, cz, conn, nbKind, ramp, yM, dash);
    if (rab) this.rabMarks(b, cx, cz, conn, hwArm, Y_MARK + yoff, dash);
    if (sig) for (let d = 0; d < 4; d++) {
      if (!conn[d]) continue;
      const ex = DX[d], ez = DY[d], px = -ez, pz = ex, h = hwArm[d];
      // stop line across the half of the arm that drives into the junction
      dash(cx + ex * 0.455 - px * h * 0.5, cz + ez * 0.455 - pz * h * 0.5, ex, ez, 0.02, h * 0.92, WHITE);
    }
    if (!hwy && !rab) for (let d = 0; d < 4; d++) {
      if (!conn[d]) continue;
      const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
      const avenue = hwArm[d] > 0.35;
      const startR = n >= 3 ? 0.42 : n === 1 ? 0.12 : 0.0;
      if (avenue) {
        // double yellow centre line
        dash(cx + ex * Math.max(0.1, startR - 0.04), cz + ez * Math.max(0.1, startR - 0.04), ex, ez, 0.5 - Math.max(0.1, startR - 0.04), 0.014, YELLOW);
        for (const s of [-1, 1]) dash(cx + ex * 0.1 + px * s * 0.02, cz + ez * 0.1 + pz * s * 0.02, ex, ez, 0.4, 0.008, YELLOW);
        // lane dividers
        for (const s of [-1, 1]) for (const t0 of [0.18, 0.36]) {
          if (t0 + 0.1 > 0.5 || (n >= 3 && t0 < 0.4)) continue;
          dash(cx + ex * t0 + px * s * 0.225, cz + ez * t0 + pz * s * 0.225, ex, ez, 0.09, 0.012, WHITE);
        }
      } else {
        // dashed centre line, skipped in the junction box
        const t0s = n >= 3 ? [0.46] : n === 1 ? [0.16, 0.34] : [0.04, 0.22, 0.4];
        for (const t0 of t0s) {
          const len = Math.min(0.09, 0.5 - t0);
          if (len > 0.02) dash(cx + ex * t0, cz + ez * t0, ex, ez, len, 0.014, WHITE);
        }
      }
      // zebra crossing at T and X junctions
      if (n >= 3) {
        const hw = hwArm[d];
        const t0 = hwC + 0.04;
        const cnt = hw > 0.35 ? 9 : 7;
        for (let k = 0; k < cnt; k++) {
          const off = ((k + 0.5) / cnt - 0.5) * (hw * 2 - 0.06);
          dash(cx + ex * t0 + px * off, cz + ez * t0 + pz * off, ex, ez, 0.06, 0.016, WHITE);
        }
      }
    }
    return range;
  }

  /** walls or piers that hold a raised deck up */
  private support(bb: MeshBuilder, i: number, conn: boolean[], yf: (x: number, z: number) => number) {
    const w = this.world;
    const cx = wx(i % N), cz = wz((i / N) | 0);
    if (w.under[i]) {
      const H = w.elev[i];
      // a slab with a pier at each corner, clear of the street running beneath
      bb.box(cx, H - 0.14, cz, 0.98, 0.07, 0.98, CONCRETE, { bottom: true });
      const cls = w.under[i] & 3;
      const o = cls === 2 ? 0.46 : 0.4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb.cyl(cx + sx * o, 0, cz + sz * o, 0.05, 0.045, H - 0.1, mix3(CONCRETE, [0.5, 0.5, 0.5], 0.25), 8);
      return;
    }
    for (let d = 0; d < 4; d++) {
      if (conn[d]) continue;
      const ex = DX[d], ez = DY[d];
      // a wall along the open edge, its top following the deck
      const wx0 = cx + ex * 0.495, wz0 = cz + ez * 0.495;
      let prev = -1;
      for (let k = 0; k <= 8; k++) {
        const t = -0.5 + k * 0.125;
        const px = wx0 + (-ez) * t, pz = wz0 + ex * t;
        const h = Math.max(0, yf(px, pz) - 0.002);
        const c = bb.vert(px, 0, pz, ex, 0, ez, CONCRETE);
        bb.vert(px, h, pz, ex, 0, ez, CONCRETE);
        bb.vert(px, 0, pz, -ex, 0, -ez, CONCRETE);
        bb.vert(px, h, pz, -ex, 0, -ez, CONCRETE);
        if (prev >= 0) {
          bb.quad(prev, prev + 1, c + 1, c);
          bb.quad(prev + 2, c + 2, c + 3, prev + 3);
        }
        prev = c;
      }
    }
  }

  rebuild() {
    const w = this.world;
    w.ensureElev();
    const b = new MeshBuilder();
    const bb = new MeshBuilder();
    this.asphalt.clear();
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      const i = tileIdx(tx, ty);
      const kind = w.road[i];
      if (!kind) continue;
      const bridge = w.water[i] === 1;
      const cx = wx(tx), cz = wz(ty);
      const ranges: number[] = [];
      let conn: boolean[];
      if (w.under[i]) {
        // street on the ground, highway above it
        const g = this.arms(i, 1);
        const r1 = this.layer(b, i, w.under[i] & 3, g.conn, g.nbKind, g.n, bridge, () => 0, false);
        const dk = this.arms(i, 2);
        const yf = this.deckFn(i);
        const r2 = this.layer(b, i, 3, dk.conn, dk.nbKind, dk.n, false, yf, false);
        ranges.push(r1[0], r1[1], r2[0], r2[1]);
        this.support(bb, i, dk.conn, yf);
        conn = g.conn.map((c, d) => c || dk.conn[d]);
      } else {
        const a = this.arms(i, 0);
        conn = a.conn;
        const yf = kind === 3 ? this.deckFn(i) : () => 0;
        const r = this.layer(b, i, kind, a.conn, a.nbKind, a.n, bridge, yf, true);
        ranges.push(r[0], r[1]);
        if (kind === 3 && !bridge) this.support(bb, i, a.conn, yf);
      }
      this.asphalt.set(i, ranges);
      // ---- bridge deck and rails
      if (bridge) {
        bb.box(cx, -0.095, cz, 1.0, 0.115, 1.0, CONCRETE, { bottom: true });
        // side rails where the deck edge is open
        for (let d = 0; d < 4; d++) {
          if (conn[d]) continue;
          const ex = DX[d], ez = DY[d];
          const rx = cx + ex * 0.47, rz = cz + ez * 0.47;
          const lw = ex !== 0 ? 0.03 : 0.96, ld = ez !== 0 ? 0.03 : 0.96;
          bb.box(rx, 0.02, rz, lw, 0.07, ld, RAIL);
        }
        // piers
        bb.cyl(cx, -0.5, cz, 0.07, 0.06, 0.4, mix3(CONCRETE, [0.5, 0.5, 0.5], 0.3), 8);
        bb.box(cx, -0.14, cz, 0.5, 0.05, 0.14, CONCRETE);
      }
    }
    this.mesh.geometry.dispose();
    this.bridgeMesh.geometry.dispose();
    this.mesh.geometry = b.count ? b.geometry() : new THREE.BufferGeometry();
    this.bridgeMesh.geometry = bb.count ? bb.geometry() : new THREE.BufferGeometry();
    const colAttr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    this.baseColors = colAttr ? new Float32Array(colAttr.array as Float32Array) : new Float32Array(0);
    this.overlay = -1;
  }

  /** mode 0: normal. 1: colour the asphalt by congestion (cong: 0..1 speed ratio, load: density) */
  setOverlay(mode: number, cong: Float32Array, load: Float32Array) {
    const geo = this.mesh.geometry;
    const col = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col) return;
    if (mode === 0) {
      if (this.overlay !== 0) { (col.array as Float32Array).set(this.baseColors); col.needsUpdate = true; this.overlay = 0; }
      return;
    }
    const arr = col.array as Float32Array;
    const g = lin(0x34d399), y = lin(0xfacc15), r = lin(0xef4444), dim = lin(0x4b5563);
    for (const [tile, ranges] of this.asphalt) {
      const c = cong[tile];
      const l = load[tile];
      // congestion 0 (jam) .. 1 (free): use the worse of speed loss and density
      const bad = Math.max(1 - c, Math.max(0, l - 0.55) * 0.9);
      let rgb: number[];
      if (l < 0.02 && c > 0.97) rgb = dim;
      else if (bad < 0.5) rgb = mix3(g, y, bad / 0.5);
      else rgb = mix3(y, r, Math.min(1, (bad - 0.5) / 0.4));
      for (let r = 0; r < ranges.length; r += 2) for (let v = ranges[r]; v < ranges[r + 1]; v++) { arr[v * 3] = rgb[0]; arr[v * 3 + 1] = rgb[1]; arr[v * 3 + 2] = rgb[2]; }
    }
    col.needsUpdate = true;
    this.overlay = 1;
  }
}
