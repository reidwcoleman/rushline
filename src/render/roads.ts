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

const Y_SIDE = 0.011, Y_ASPH = 0.016, Y_MARK = 0.0195;

export class Roads {
  mesh: THREE.Mesh;
  bridgeMesh: THREE.Mesh;
  private asphalt = new Map<number, [number, number]>();
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

  /** flat polygon (convex) with winding fixed to face up */
  private poly(b: MeshBuilder, pts: number[][], y: number, c: number[]) {
    // fan triangulation; every triangle is wound individually so it faces up whatever the polygon's orientation
    const ids = pts.map((p) => b.vert(p[0], y, p[1], 0, 1, 0, c));
    for (let i = 1; i + 1 < ids.length; i++) {
      const A = pts[0], B = pts[i], C = pts[i + 1];
      const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      if (Math.abs(ny) < 1e-9) continue;
      if (ny > 0) b.tri(ids[0], ids[i], ids[i + 1]); else b.tri(ids[0], ids[i + 1], ids[i]);
    }
  }

  rebuild() {
    const w = this.world;
    const b = new MeshBuilder();
    const bb = new MeshBuilder();
    this.asphalt.clear();
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      const i = tileIdx(tx, ty);
      const kind = w.road[i];
      if (!kind) continue;
      const bridge = w.water[i] === 1;
      const cx = wx(tx), cz = wz(ty);
      const conn: boolean[] = [];
      const hwArm: number[] = [];
      let n = 0;
      for (let d = 0; d < 4; d++) {
        const nx = tx + DX[d], ny = ty + DY[d];
        const nk = inMap(nx, ny) ? w.road[tileIdx(nx, ny)] : 0;
        conn.push(nk > 0);
        hwArm.push(kind === 2 && nk === 2 ? 0.42 : 0.3);
        if (nk) n++;
      }
      const hwC = kind === 2 ? 0.42 : 0.3;
      const yoff = bridge ? 0.022 : 0;
      const tone = ((tx * 7 + ty * 13) % 5) * 0.012;
      // sidewalk slab
      const sw = shade3(((tx + ty) & 1) ? SIDEWALK : SIDEWALK_B, 1 - tone * 0.5);
      if (!bridge) b.floor(cx, Y_SIDE, cz, 1, 1, sw);
      // asphalt
      const asph = shade3(((tx + ty) & 1) ? ASPHALT : ASPHALT_B, 1 - tone);
      const v0 = b.count;
      const yA = Y_ASPH + yoff;
      const sq = [[cx - hwC, cz - hwC], [cx + hwC, cz - hwC], [cx + hwC, cz + hwC], [cx - hwC, cz + hwC]];
      if (n === 0) {
        // cul-de-sac disc
        const pts: number[][] = [];
        for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; pts.push([cx + Math.cos(a) * hwC * 1.1, cz + Math.sin(a) * hwC * 1.1]); }
        this.poly(b, pts, yA, asph);
      } else {
        this.poly(b, sq, yA, asph);
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
      this.asphalt.set(i, [v0, b.count]);
      // ---- markings
      const yM = Y_MARK + yoff;
      const dash = (x0: number, z0: number, dx: number, dz: number, len: number, wd: number, c: number[]) => {
        // rectangle starting at (x0,z0) extending len along (dx,dz), width wd
        const px = -dz, pz = dx;
        this.poly(b, [[x0 + px * wd / 2, z0 + pz * wd / 2], [x0 + dx * len + px * wd / 2, z0 + dz * len + pz * wd / 2], [x0 + dx * len - px * wd / 2, z0 + dz * len - pz * wd / 2], [x0 - px * wd / 2, z0 - pz * wd / 2]], yM, c);
      };
      for (let d = 0; d < 4; d++) {
        if (!conn[d]) continue;
        const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
        const avenue = hwArm[d] > 0.35;
        const startR = n >= 3 ? 0.42 : n === 1 ? 0.12 : 0.0;
        if (avenue) {
          // double yellow centre line
          dash(cx + ex * Math.max(0.1, startR - 0.04), cz + ez * Math.max(0.1, startR - 0.04), ex, ez, 0.5 - Math.max(0.1, startR - 0.04), 0.014, YELLOW);
          for (const s of [-1, 1]) dash(cx + ex * 0.1 + px * s * 0.02, cz + ez * 0.1 + pz * s * 0.02, ex, ez, 0.4, 0.008, YELLOW);
          // lane dividers
          if (n < 3 || true) for (const s of [-1, 1]) for (const t0 of [0.18, 0.36]) {
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
      if (n === 2 && !(conn[0] && conn[2]) && !(conn[1] && conn[3])) {
        // corner: a short curved centre guide is overkill; a dot at the apex reads fine
      }
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
    for (const [tile, [a, e]] of this.asphalt) {
      const c = cong[tile];
      const l = load[tile];
      // congestion 0 (jam) .. 1 (free): use the worse of speed loss and density
      const bad = Math.max(1 - c, Math.max(0, l - 0.55) * 0.9);
      let rgb: number[];
      if (l < 0.02 && c > 0.97) rgb = dim;
      else if (bad < 0.5) rgb = mix3(g, y, bad / 0.5);
      else rgb = mix3(y, r, Math.min(1, (bad - 0.5) / 0.4));
      for (let v = a; v < e; v++) { arr[v * 3] = rgb[0]; arr[v * 3 + 1] = rgb[1]; arr[v * 3 + 2] = rgb[2]; }
    }
    col.needsUpdate = true;
    this.overlay = 1;
  }
}
