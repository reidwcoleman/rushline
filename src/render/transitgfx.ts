// Elevated viaducts, stations, bus shelters and the people waiting at them.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, shade3, mix3, instAttr, tmpObj, U } from './gfx.ts';
import { smoothTilePath } from '../sim/path.ts';
import { wx, wz, tileX, tileY, DX, DY, N, inMap, tileIdx, WATER_LEVEL, type World } from '../sim/world.ts';
import { MODES } from '../sim/modes.ts';
import type { Transit } from '../sim/transit.ts';
import type { Line, Stop } from '../sim/types.ts';
import { TRACK_Y } from './fleet.ts';

const CONCRETE = lin(0xd3cfc4);
const CONCRETE_D = lin(0xb6b2a7);
const STEEL = lin(0x4a515c);
const RAILC = lin(0x8d949e);
const GLASS = lin(0x27323e);
const PLAT = lin(0xe3dfd4);
const YELLOW = lin(0xf2c14e);

type Sec = { o: number; y: number; c: number[] };

/** extrude a cross-section along a polyline */
function extrude(b: MeshBuilder, samples: { x: number; z: number; ang: number; dy?: number }[], sec: Sec[], closeEnds = false) {
  for (let i = 0; i + 1 < samples.length; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    const l0x = -Math.sin(s0.ang), l0z = Math.cos(s0.ang), l1x = -Math.sin(s1.ang), l1z = Math.cos(s1.ang);
    for (let k = 0; k + 1 < sec.length; k++) {
      const a = sec[k], c = sec[k + 1];
      const dO = c.o - a.o, dY = c.y - a.y;
      const len = Math.hypot(dO, dY) || 1;
      const no = -dY / len, ny = dO / len;
      const col = k % 2 === 0 ? a.c : a.c;
      const p = (s: typeof s0, lx: number, lz: number, sc: Sec) => [s.x + lx * sc.o, sc.y + (s.dy ?? 0), s.z + lz * sc.o];
      const v00 = p(s0, l0x, l0z, a), v01 = p(s0, l0x, l0z, c), v10 = p(s1, l1x, l1z, a), v11 = p(s1, l1x, l1z, c);
      const nrm0 = [l0x * no, ny, l0z * no];
      // decide winding from the geometric normal
      const e1 = [v10[0] - v00[0], v10[1] - v00[1], v10[2] - v00[2]], e2 = [v01[0] - v00[0], v01[1] - v00[1], v01[2] - v00[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const flip = cr[0] * nrm0[0] + cr[1] * nrm0[1] + cr[2] * nrm0[2] < 0;
      const ia = b.vert(v00[0], v00[1], v00[2], nrm0[0], nrm0[1], nrm0[2], col);
      const ib = b.vert(v10[0], v10[1], v10[2], l1x * no, ny, l1z * no, col);
      const ic = b.vert(v11[0], v11[1], v11[2], l1x * no, ny, l1z * no, col);
      const id = b.vert(v01[0], v01[1], v01[2], nrm0[0], nrm0[1], nrm0[2], col);
      if (flip) b.quad(ia, id, ic, ib); else b.quad(ia, ib, ic, id);
    }
  }
  void closeEnds;
}

function viaduct(line: Line, world: World): THREE.BufferGeometry {
  const poly = line.poly!;
  const b = new MeshBuilder();
  b.paintW = 0;
  const L = poly.length;
  const step = 0.12;
  const samples: { x: number; z: number; ang: number }[] = [];
  const tmp = { x: 0, z: 0, ang: 0 };
  for (let d = 0; d <= L + 1e-6; d += step) {
    poly.at(Math.min(d, L), 0, tmp);
    samples.push({ ...tmp });
  }
  // end point exactly
  poly.at(L, 0, tmp);
  if (samples.length && Math.hypot(samples[samples.length - 1].x - tmp.x, samples[samples.length - 1].z - tmp.z) > 1e-3) samples.push({ ...tmp });
  // beam body
  const top = TRACK_Y, low = TRACK_Y - 0.1;
  extrude(b, samples, [
    { o: -0.1, y: low, c: CONCRETE_D },
    { o: -0.18, y: top - 0.01, c: CONCRETE_D },
    { o: -0.18, y: top + 0.012, c: CONCRETE },
    { o: 0.18, y: top + 0.012, c: CONCRETE },
    { o: 0.18, y: top - 0.01, c: CONCRETE_D },
    { o: 0.1, y: low, c: CONCRETE_D },
    { o: -0.1, y: low, c: shade3(CONCRETE_D, 0.6) },
  ]);
  // coloured fascia
  extrude(b, samples, [{ o: -0.1805, y: top - 0.03, c: line.color ? lin(line.color) : CONCRETE }, { o: -0.1805, y: top + 0.006, c: lin(line.color) }]);
  extrude(b, samples, [{ o: 0.1805, y: top + 0.006, c: lin(line.color) }, { o: 0.1805, y: top - 0.03, c: lin(line.color) }]);
  // rails
  for (const o of [-0.1, 0.1]) {
    extrude(b, samples, [{ o: o - 0.013, y: top + 0.012, c: RAILC }, { o: o - 0.008, y: top + 0.03, c: RAILC }, { o: o + 0.008, y: top + 0.03, c: RAILC }, { o: o + 0.013, y: top + 0.012, c: RAILC }]);
    extrude(b, samples, [{ o: o - 0.013, y: top + 0.012, c: shade3(RAILC, 0.7) }, { o: o + 0.013, y: top + 0.012, c: shade3(RAILC, 0.7) }]);
  }
  // sleepers
  for (let d = 0.05; d < L; d += 0.15) {
    poly.at(d, 0, tmp);
    const ca = Math.cos(tmp.ang), sa = Math.sin(tmp.ang);
    const px = -sa, pz = ca;
    const hw = 0.145, hl = 0.012;
    const y = top + 0.0125;
    const ids = [
      b.vert(tmp.x + px * hw + ca * hl, y, tmp.z + pz * hw + sa * hl, 0, 1, 0, STEEL), b.vert(tmp.x - px * hw + ca * hl, y, tmp.z - pz * hw + sa * hl, 0, 1, 0, STEEL),
      b.vert(tmp.x - px * hw - ca * hl, y, tmp.z - pz * hw - sa * hl, 0, 1, 0, STEEL), b.vert(tmp.x + px * hw - ca * hl, y, tmp.z + pz * hw - sa * hl, 0, 1, 0, STEEL),
    ];
    b.quad(ids[0], ids[3], ids[2], ids[1]);
  }
  // pylons at tile centres
  const { poly: p2, tileDist } = smoothTilePath(line.tiles, wx, wz);
  void p2;
  for (let k = 0; k < line.tiles.length; k++) {
    const t = line.tiles[k];
    if (world.stopKind[t] === 2) continue;
    poly.at(tileDist[k], 0, tmp);
    const water = world.water[t] === 1;
    const g = water ? -0.62 : 0.012;
    const h = low - g;
    b.cyl(tmp.x, g, tmp.z, 0.04, 0.034, h, CONCRETE, 8, { cap: false });
    // cap beam across the track
    const ca = Math.cos(tmp.ang), sa = Math.sin(tmp.ang);
    const cx = tmp.x, cz = tmp.z;
    // build a rotated box by emitting an extruded section over a tiny straight segment
    const seg = [{ x: cx - ca * 0.05, z: cz - sa * 0.05, ang: tmp.ang }, { x: cx + ca * 0.05, z: cz + sa * 0.05, ang: tmp.ang }];
    extrude(b, seg, [
      { o: -0.15, y: low, c: CONCRETE_D }, { o: -0.15, y: low + 0.045, c: CONCRETE }, { o: 0.15, y: low + 0.045, c: CONCRETE }, { o: 0.15, y: low, c: CONCRETE_D },
    ]);
    // buttress flare
    b.cyl(tmp.x, low - 0.06, tmp.z, 0.034, 0.06, 0.06, CONCRETE, 8, { cap: false });
  }
  return b.geometry();
}

function stationGeo(stop: Stop, ang: number, colors: number[]): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.paintW = 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // local (u along track, v lateral right) → world
  const P = (u: number, v: number) => [stop.x + ca * u - sa * v, stop.z + sa * u + ca * v];
  const boxL = (u: number, v: number, y0: number, lu: number, h: number, lv: number, c: number[], opts: { emit?: number } = {}) => {
    // oriented box via extrusion along the local u axis
    const [x0, z0] = P(u - lu / 2, v), [x1, z1] = P(u + lu / 2, v);
    extrude(b, [{ x: x0, z: z0, ang }, { x: x1, z: z1, ang }], [
      { o: v === 0 ? -lv / 2 : -lv / 2, y: y0, c }, { o: -lv / 2, y: y0 + h, c }, { o: lv / 2, y: y0 + h, c }, { o: lv / 2, y: y0, c },
    ]);
    // the lateral offset is handled by shifting the samples
    void opts;
  };
  void boxL;
  // helper that builds a lateral-offset box: shift sample points by v
  const slab = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, c: number[], top?: number[], emit = 0) => {
    const vc = (v0 + v1) / 2, hw = (v1 - v0) / 2;
    const [ax, az] = P(u0, vc), [bx, bz] = P(u1, vc);
    const sp = b.emitV; b.emitV = emit;
    extrude(b, [{ x: ax, z: az, ang }, { x: bx, z: bz, ang }], [
      { o: -hw, y: y0, c }, { o: -hw, y: y1, c }, { o: hw, y: y1, c: top ?? c }, { o: hw, y: y0, c },
    ]);
    // end caps
    for (const [u, flipN] of [[u0, -1], [u1, 1]] as [number, number][]) {
      const [px, pz] = P(u, vc);
      const n = [ca * flipN, 0, sa * flipN];
      const pl = [-sa, ca];
      const i0 = b.vert(px - pl[0] * hw, y0, pz - pl[1] * hw, n[0], n[1], n[2], c), i1 = b.vert(px + pl[0] * hw, y0, pz + pl[1] * hw, n[0], n[1], n[2], c);
      const i2 = b.vert(px + pl[0] * hw, y1, pz + pl[1] * hw, n[0], n[1], n[2], c), i3 = b.vert(px - pl[0] * hw, y1, pz - pl[1] * hw, n[0], n[1], n[2], c);
      if (flipN > 0) b.quad(i0, i1, i2, i3); else b.quad(i0, i3, i2, i1);
    }
    b.emitV = sp;
  };
  const accent = lin(colors[0] ?? 0xffb02e);
  // platforms (two sides)
  for (const s of [-1, 1]) {
    slab(-0.47, 0.47, s > 0 ? 0.16 : -0.34, s > 0 ? 0.34 : -0.16, TRACK_Y - 0.07, TRACK_Y + 0.03, PLAT, lin(0xece8de));
    // yellow safety edge
    slab(-0.47, 0.47, s > 0 ? 0.16 : -0.1613 - 0.012, s > 0 ? 0.1613 + 0.012 : -0.16, TRACK_Y + 0.03, TRACK_Y + 0.0315, YELLOW, YELLOW);
  }
  // canopy: posts + roof
  for (const u of [-0.4, 0, 0.4]) for (const v of [-0.3, 0.3]) slab(u - 0.008, u + 0.008, v - 0.008, v + 0.008, TRACK_Y + 0.03, TRACK_Y + 0.23, lin(0xcfd3d8), undefined);
  slab(-0.5, 0.5, -0.38, 0.38, TRACK_Y + 0.23, TRACK_Y + 0.245, lin(0xe9edf1), lin(0xf6f8fa));
  slab(-0.5, 0.5, -0.38, -0.34, TRACK_Y + 0.215, TRACK_Y + 0.25, accent, accent);
  slab(-0.5, 0.5, 0.34, 0.38, TRACK_Y + 0.215, TRACK_Y + 0.25, accent, accent);
  // wind screens (lit glass)
  for (const s of [-1, 1]) {
    slab(-0.3, -0.06, s * 0.325 - 0.003, s * 0.325 + 0.003, TRACK_Y + 0.03, TRACK_Y + 0.15, GLASS, GLASS, 0.8);
    slab(0.06, 0.3, s * 0.325 - 0.003, s * 0.325 + 0.003, TRACK_Y + 0.03, TRACK_Y + 0.15, GLASS, GLASS, 0.8);
  }
  // lamps under the canopy glow at night
  for (const u of [-0.3, 0, 0.3]) slab(u - 0.03, u + 0.03, -0.01, 0.01, TRACK_Y + 0.22, TRACK_Y + 0.23, lin(0xfff0c8), lin(0xfff0c8), 4);
  // stair/lift tower beside the road
  slab(-0.07, 0.11, 0.37, 0.5, 0.012, TRACK_Y + 0.02, lin(0xe7e3d8), lin(0xd0ccc0));
  slab(-0.07, 0.11, 0.368, 0.372, 0.1, TRACK_Y - 0.1, GLASS, GLASS, 0.5);
  slab(-0.075, 0.115, 0.365, 0.505, TRACK_Y + 0.02, TRACK_Y + 0.035, accent, accent);
  // station sign on a mast, glows
  slab(0.28, 0.4, 0.4, 0.46, TRACK_Y + 0.26, TRACK_Y + 0.33, accent, lin(0xffffff), 1.8);
  slab(0.335, 0.345, 0.428, 0.432, TRACK_Y + 0.03, TRACK_Y + 0.26, lin(0x9aa3ac), lin(0x9aa3ac));
  // staircases (diagonal quad ribbon) from the platform end down to the tower foot: a simple wedge
  const [wx0, wz0] = P(0.02, 0.43);
  void wx0; void wz0;
  return b.geometry();
}

function shelterGeo(colors: number[], alongX: boolean) {
  const b = new MeshBuilder();
  b.paintW = 0;
  const c0 = lin(colors[0] ?? 0xffb02e);
  const T = (x: number, z: number, w: number, d: number, y0: number, h: number, c: number[], em = 0) => {
    const [bx, bz, bw, bd] = alongX ? [x, z, w, d] : [z, x, d, w];
    b.box(bx, y0, bz, bw, h, bd, c, { emit: em });
  };
  T(0, 0, 0.26, 0.09, 0.012, 0.01, lin(0xcfcabe));          // base slab
  T(0, 0, 0.28, 0.1, 0.12, 0.012, c0);                        // roof (line colour)
  T(0, -0.04, 0.24, 0.006, 0.02, 0.1, lin(0x8fa7b5), 0.5);    // back glass
  T(-0.11, 0.04, 0.008, 0.008, 0.012, 0.11, lin(0x4a515c));
  T(0.11, 0.04, 0.008, 0.008, 0.012, 0.11, lin(0x4a515c));
  T(-0.04, 0.0, 0.1, 0.03, 0.02, 0.02, lin(0x7a5a3c));        // bench
  // sign pole + flag
  T(0.17, 0.04, 0.006, 0.006, 0.012, 0.2, lin(0x4a515c));
  for (let i = 0; i < Math.min(3, colors.length); i++) T(0.17, 0.04, 0.034, 0.012, 0.19 - i * 0.026, 0.022, lin(colors[i]), 1.4);
  return b.geometry();
}


// ------------------------------------------------------------------ tram: rails in the road median

function tramTrack(line: Line, world: World): THREE.BufferGeometry {
  const poly = line.poly!;
  const b = new MeshBuilder();
  b.paintW = 0;
  const L = poly.length;
  const samples: { x: number; z: number; ang: number; dy: number }[] = [];
  const tmp = { x: 0, z: 0, ang: 0 };
  const dyAt = (x: number, z: number) => { const tx = Math.floor(x + 20), ty = Math.floor(z + 20); return tx >= 0 && ty >= 0 && tx < N && ty < N && world.water[tileIdx(tx, ty)] === 1 ? 0.022 : 0; };
  for (let d = 0; d <= L + 1e-6; d += 0.1) { poly.at(Math.min(d, L), 0, tmp); samples.push({ ...tmp, dy: dyAt(tmp.x, tmp.z) }); }
  poly.at(L, 0, tmp);
  samples.push({ ...tmp, dy: dyAt(tmp.x, tmp.z) });
  const BED = lin(0xa9a498), CURB = lin(0xd2cec2), RAILC2 = lin(0xc9cfd6), GRASS = lin(0x6f9456);
  const y = 0.0212;
  extrude(b, samples, [{ o: -0.087, y, c: BED }, { o: 0.087, y, c: BED }]);
  for (const s of [-1, 1]) {
    extrude(b, samples, [{ o: s * 0.087, y, c: CURB }, { o: s * 0.087, y: y + 0.004, c: CURB }, { o: s * 0.093, y: y + 0.004, c: CURB }, { o: s * 0.093, y, c: CURB }]);
    // a strip of green between the two rails of each track
    extrude(b, samples, [{ o: s * 0.05 - 0.016, y: y + 0.0008, c: GRASS }, { o: s * 0.05 + 0.016, y: y + 0.0008, c: GRASS }]);
    for (const r of [-0.0225, 0.0225]) {
      const o = s * 0.05 + r;
      extrude(b, samples, [{ o: o - 0.005, y, c: RAILC2 }, { o: o - 0.003, y: y + 0.007, c: RAILC2 }, { o: o + 0.003, y: y + 0.007, c: RAILC2 }, { o: o + 0.005, y, c: RAILC2 }]);
    }
  }
  return b.geometry();
}

function tramShelterGeo(colors: number[], alongX: boolean) {
  const b = new MeshBuilder();
  b.paintW = 0;
  const c0 = lin(colors[0] ?? 0xff8a3d);
  const T = (x: number, z: number, w: number, d: number, y0: number, h: number, c: number[], em = 0) => {
    const [bx, bz, bw, bd] = alongX ? [x, z, w, d] : [z, x, d, w];
    b.box(bx, y0, bz, bw, h, bd, c, { emit: em });
  };
  T(0, 0, 0.42, 0.11, 0.012, 0.012, lin(0xcfcabe));                 // platform slab
  T(0, 0, 0.44, 0.12, 0.13, 0.014, c0);                               // roof in the line colour
  T(0, -0.045, 0.4, 0.006, 0.024, 0.106, lin(0x8fa7b5), 0.6);         // glass back
  for (const x of [-0.19, 0, 0.19]) T(x, 0.045, 0.008, 0.008, 0.024, 0.108, lin(0x4a515c));
  T(-0.1, 0.0, 0.14, 0.035, 0.024, 0.02, lin(0x7a5a3c));              // bench
  T(0.2, 0.05, 0.006, 0.006, 0.012, 0.24, lin(0x4a515c));             // sign pole
  T(0.2, 0.05, 0.05, 0.012, 0.23, 0.05, c0, 1.8);                      // line-coloured sign
  T(0.2, 0.05, 0.028, 0.014, 0.241, 0.028, lin(0xffffff), 2.2);
  return b.geometry();
}

// ------------------------------------------------------------------ ferry piers

function pierGeo(dx: number, dz: number, colors: number[]) {
  const b = new MeshBuilder();
  b.paintW = 0;
  const DECK = lin(0x9c7a55), DECK2 = lin(0x8a6a49), POST = lin(0x5e4630), WHITE2 = lin(0xf3f1ea), ACC = lin(colors[0] ?? 0x35c9d6);
  const ang = Math.atan2(dz, dx);
  const yd = 0.05;
  // local frame: +x toward the water, z lateral. built then rotated into place.
  const slab = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, c: number[], em = 0) => b.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, c, { emit: em });
  // boardwalk on the land tile + the stem over the water
  slab(-0.46, 0.8, -0.085, 0.085, yd - 0.012, yd, DECK);
  for (let x = -0.44; x < 0.8; x += 0.075) slab(x, x + 0.058, -0.088, 0.088, yd, yd + 0.003, DECK2);
  // the T-head along the water
  slab(0.7, 0.86, -0.34, 0.34, yd - 0.012, yd, DECK);
  for (let z = -0.33; z < 0.33; z += 0.075) slab(0.71, 0.85, z, z + 0.058, yd, yd + 0.003, DECK2);
  // posts down into the water
  for (const x of [0.62, 0.74]) for (const z of [-0.08, 0.08]) b.cyl(x, -0.5, z, 0.012, 0.012, 0.5 + yd, POST, 6);
  for (const z of [-0.33, -0.17, 0, 0.17, 0.33]) for (const x of [0.72, 0.85]) b.cyl(x, -0.5, z, 0.011, 0.011, 0.5 + yd + 0.012, POST, 6);
  // ticket pavilion on the land end
  slab(-0.36, -0.12, -0.2, -0.04, 0.0, 0.1, WHITE2);
  slab(-0.38, -0.1, -0.215, -0.025, 0.1, 0.112, ACC);
  slab(-0.355, -0.125, -0.201, -0.199, 0.045, 0.085, lin(0x27323e), 0.9);
  // lamp posts that glow at night
  for (const [x, z] of [[0.3, 0.1], [0.3, -0.1], [0.78, 0.3], [0.78, -0.3]] as [number, number][]) {
    b.cyl(x, yd, z, 0.005, 0.005, 0.15, lin(0x3a4048), 6);
    slab(x - 0.012, x + 0.012, z - 0.012, z + 0.012, yd + 0.15, yd + 0.165, lin(0xfff0c8), 4);
  }
  // bollards and a sign mast with the line colour
  for (const z of [-0.3, -0.1, 0.1, 0.3]) b.cyl(0.84, yd, z, 0.008, 0.008, 0.02, lin(0x2f353d), 6);
  slab(0.0, 0.01, 0.12, 0.13, yd, yd + 0.28, lin(0x4a515c));
  slab(-0.04, 0.05, 0.1, 0.15, yd + 0.24, yd + 0.29, ACC, 1.8);
  const g = b.geometry();
  g.rotateY(-ang);
  return g;
}

// ------------------------------------------------------------------ gondola: stations, pylons, cables

function gondolaStationGeo(ang: number, colors: number[]) {
  const b = new MeshBuilder();
  b.paintW = 0;
  const ACC = lin(colors[0] ?? 0xa77bff), WALL = lin(0xeceae3), DARK = lin(0x2a3039), CONC = lin(0xcfcbc0), STEEL = lin(0x9aa3ac), GLS = lin(0x27323e);
  const box = (x: number, z: number, w: number, d: number, y0: number, h: number, c: number[], em = 0) => b.box(x, y0, z, w, h, d, c, { emit: em });
  // x runs along the cable, z across it. A raised platform whose floor sits where the cabins stop.
  box(0, 0, 0.64, 0.46, 0.43, 0.022, CONC);                                      // platform slab
  box(0, 0.231, 0.64, 0.012, 0.43, 0.026, ACC); box(0, -0.231, 0.64, 0.012, 0.43, 0.026, ACC);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.25, 0, sz * 0.17, 0.032, 0.026, 0.43, CONC, 8);
  box(0, 0, 0.5, 0.3, 0.0, 0.03, CONC);                                           // footing
  // canopy
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * 0.29, sz * 0.2, 0.01, 0.01, 0.452, 0.27, STEEL);
  box(0, 0, 0.7, 0.52, 0.722, 0.02, ACC);
  box(0, 0, 0.66, 0.46, 0.712, 0.01, lin(0xf2f0ea));
  for (const x of [-0.14, 0.14]) box(x, 0, 0.05, 0.3, 0.7, 0.012, lin(0xfff0c8), 4);   // lights under the canopy
  // glass screens on both long sides with a gap for the cabins to pass through
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) box(sx * 0.18, sz * 0.2, 0.2, 0.006, 0.452, 0.2, GLS, 0.7);
  // drive machinery in the middle of the cable line
  box(0, 0, 0.08, 0.12, 0.64, 0.05, DARK);
  box(0, 0, 0.05, 0.05, 0.61, 0.03, STEEL);
  // stair + lift tower beside the platform
  box(0.2, -0.36, 0.1, 0.1, 0, 0.5, WALL);
  box(0.2, -0.36, 0.102, 0.102, 0.12, 0.2, GLS, 0.9);
  box(0.2, -0.36, 0.118, 0.118, 0.5, 0.025, ACC);
  box(0.2, -0.28, 0.04, 0.1, 0.43, 0.022, CONC);                                  // bridge from the tower to the platform
  // sign mast that glows
  box(-0.34, 0.3, 0.01, 0.01, 0, 0.62, STEEL);
  box(-0.34, 0.3, 0.012, 0.075, 0.6, 0.075, ACC, 1.8);
  // aviation light on the canopy
  box(0.24, 0.16, 0.01, 0.01, 0.742, 0.05, STEEL);
  box(0.24, 0.16, 0.014, 0.014, 0.79, 0.014, lin(0xff4b4b), 3.5);
  const g = b.geometry();
  g.rotateY(-ang);
  return g;
}

function pylonGeo(x: number, z: number, ang: number, top: number, groundY: number, color: number) {
  const b = new MeshBuilder();
  b.paintW = 0;
  const STEEL2 = lin(0xb7bec6), DARKS = lin(0x39414a), CONC = lin(0xcfcbc0);
  const h = Math.max(0.2, top - groundY);
  const spread = Math.min(0.1, 0.045 + h * 0.012);
  // local frame: x along the cable, z across it. Two legs lean together into a cross arm.
  const leg = (sz: number) => {
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps;
      const zs = spread * (1 - t0 * 0.72) * sz, ze = spread * (1 - t1 * 0.72) * sz;
      const y0 = groundY + h * t0, y1 = groundY + h * t1;
      const mz = (zs + ze) / 2, my = (y0 + y1) / 2;
      const len = Math.hypot(ze - zs, y1 - y0);
      // a thin box tilted to follow the leg (approximated by a cylinder segment with a slight taper)
      b.cyl(0, y0, mz, 0.011 * (1 - t0 * 0.35), 0.011 * (1 - t1 * 0.35), y1 - y0, STEEL2, 5);
      void my; void len;
    }
  };
  leg(1); leg(-1);
  // cross braces and a base block
  const braces = Math.max(2, Math.round(h / 0.7));
  for (let i = 1; i <= braces; i++) {
    const t = i / (braces + 1);
    const w = spread * (1 - t * 0.72) * 2;
    b.box(0, groundY + h * t, 0, 0.007, 0.007, w, STEEL2);
  }
  b.box(0, groundY, 0, 0.12, 0.022, spread * 2 + 0.05, CONC);
  // cross arm with sheave assemblies
  b.box(0, top - 0.024, 0, 0.016, 0.014, 0.16, STEEL2);
  for (const s of [-1, 1]) {
    b.box(0, top - 0.008, s * MODES.gondola.lane, 0.03, 0.018, 0.016, DARKS);
    b.paintW = 1; b.box(0, top - 0.03, s * MODES.gondola.lane, 0.012, 0.008, 0.012, lin(color)); b.paintW = 0;
  }
  b.box(0, top + 0.002, 0, 0.012, 0.01, 0.012, lin(0xff4b4b), { emit: 2.5 } as any);
  const g = b.geometry();
  g.rotateY(-ang);
  g.translate(x, 0, z);
  return [g];
}

/** a thin four-sided cable following (x, y, z) samples */
function cableTube(b: MeshBuilder, pts: { x: number; y: number; z: number }[], r: number, c: number[]) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], d = pts[i + 1];
    const dx = d.x - a.x, dz = d.z - a.z, dl = Math.hypot(dx, dz) || 1;
    const px = -dz / dl, pz = dx / dl;
    const corners = [[0, r], [px * r, 0], [0, -r], [-px * r, 0]];
    void corners;
    const ring = (p: typeof a) => [
      [p.x + px * r, p.y, p.z + pz * r], [p.x, p.y + r, p.z], [p.x - px * r, p.y, p.z - pz * r], [p.x, p.y - r, p.z],
    ];
    const r0 = ring(a), r1 = ring(d);
    const norms = [[px, 0, pz], [0, 1, 0], [-px, 0, -pz], [0, -1, 0]];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) & 3;
      const n = norms[k];
      const i0 = b.vert(r0[k][0], r0[k][1], r0[k][2], n[0], n[1], n[2], c), i1 = b.vert(r1[k][0], r1[k][1], r1[k][2], n[0], n[1], n[2], c);
      const i2 = b.vert(r1[k2][0], r1[k2][1], r1[k2][2], n[0], n[1], n[2], c), i3 = b.vert(r0[k2][0], r0[k2][1], r0[k2][2], n[0], n[1], n[2], c);
      b.quad(i0, i3, i2, i1);
      b.quad(i0, i1, i2, i3);
    }
  }
}

function personGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.cyl(0, 0, 0, 0.013, 0.011, 0.04, lin(0xffffff), 6, { cap: false });
  b.paintW = 0;
  b.blob(0, 0.052, 0, 0.012, 0.013, 0.012, lin(0xf0c8a0), 5, 3);
  return b.geometry();
}

const PEOPLE = [0xe65f5c, 0x4f8fdb, 0xf2b84b, 0x58b88a, 0x9c6fdb, 0xe87bb1, 0xf08a46, 0x45b5c4, 0x8bc34a, 0xd96a6a, 0x6c7ae0, 0xc9a45a].map((h) => new THREE.Color(h));

export class TransitGfx {
  group = new THREE.Group();
  private viaducts = new Map<number, THREE.Mesh>();
  private stations = new Map<number, THREE.Mesh>();
  private shelters = new Map<number, THREE.Mesh>();
  private trams = new Map<number, THREE.Mesh>();
  private piers = new Map<number, THREE.Mesh>();
  private cableMeshes: THREE.Mesh[] = [];
  private gondolaStations = new Map<number, THREE.Mesh>();
  private mat: THREE.MeshStandardMaterial;
  private tramMat: THREE.MeshStandardMaterial;
  private crowd: THREE.InstancedMesh;
  private crowdTint: THREE.InstancedBufferAttribute;
  /** height of the tallest thing at a world point (buildings), so cable cars clear the skyline */
  clearance: (x: number, z: number) => number = () => 0;
  private cable = new Map<number, { ys: Float32Array; step: number }>();

  constructor(scene: THREE.Scene, readonly world: World, readonly transit: Transit) {
    this.mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }), { paint: false, emit: true, cloud: true });
    this.tramMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { paint: false, cloud: true, wet: true });
    const g = personGeo();
    this.crowdTint = instAttr(2400, 3, 1);
    g.setAttribute('aTint', this.crowdTint);
    const pm = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { paint: true });
    this.crowd = new THREE.InstancedMesh(g, pm, 2400);
    this.crowd.count = 0;
    this.crowd.frustumCulled = false;
    this.crowd.castShadow = true;
    this.group.add(this.crowd);
    scene.add(this.group);
  }

  /** world-space height of a cable car's cable at distance d along its line */
  cableY(line: Line, d: number): number {
    const c = this.cable.get(line.id);
    if (!c) return 0.9;
    const f = Math.max(0, d / c.step), i = Math.min(c.ys.length - 2, Math.floor(f));
    const t = Math.min(1, f - i);
    return c.ys[i] * (1 - t) + c.ys[Math.min(c.ys.length - 1, i + 1)] * t;
  }

  private heading(l: Line, k: number) {
    const tmp = { x: 0, z: 0, ang: 0 };
    const d = l.stopDist[k];
    // at an intermediate stop use the incoming direction so the station faces the cable it receives
    l.poly!.at(Math.max(0, d - (k > 0 ? 0.05 : 0)), 0, tmp);
    if (k === 0) l.poly!.at(d + 0.05, 0, tmp);
    return tmp.ang;
  }

  /** towers and cable heights: straight spans between pylons that are raised until they clear the skyline */
  private towers(line: Line) {
    const poly = line.poly!;
    const tmp = { x: 0, z: 0, ang: 0 };
    const STATION = 0.6;
    type Node = { d: number; y: number; fixed: boolean };
    const nodes: Node[] = [];
    for (let k = 0; k < line.stops.length; k++) {
      nodes.push({ d: line.stopDist[k], y: STATION, fixed: true });
      if (k + 1 >= line.stops.length) break;
      const d0 = line.stopDist[k], d1 = line.stopDist[k + 1];
      const hops = Math.max(1, Math.round((d1 - d0) / 3.8));
      for (let h = 1; h < hops; h++) {
        const nominal = d0 + ((d1 - d0) * h) / hops;
        let best = nominal, bestScore = 1e9;
        for (let o = -1.3; o <= 1.3; o += 0.325) {
          const dd = nominal + o;
          if (dd < d0 + 1.3 || dd > d1 - 1.3) continue;
          poly.at(dd, 0, tmp);
          const tx = Math.floor(tmp.x + 20), ty = Math.floor(tmp.z + 20);
          const idx = tx >= 0 && ty >= 0 && tx < N && ty < N ? tileIdx(tx, ty) : -1;
          const penalty = idx >= 0 ? (this.world.bld[idx] >= 0 ? 10 : this.world.road[idx] ? 1.5 : this.world.water[idx] ? 2 : 0) : 5;
          const score = penalty + Math.abs(o) * 0.1;
          if (score < bestScore) { bestScore = score; best = dd; }
        }
        nodes.push({ d: best, y: 0.9, fixed: false });
      }
    }
    const need = (d: number) => {
      poly.at(d, 0, tmp);
      let h = 0;
      for (const [ox, oz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.35, 0.35], [-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35]]) h = Math.max(h, this.clearance(tmp.x + ox, tmp.z + oz));
      // right at a station the cable is already at platform height; ask for full clearance only a little way out
      let ds = 99;
      for (const sd of line.stopDist) ds = Math.min(ds, Math.abs(d - sd));
      const relax = Math.max(0, Math.min(1, (ds - 0.3) / 1.2));
      return Math.max(STATION, STATION + (h + 0.3 - STATION) * relax);
    };
    for (let iter = 0; iter < 14; iter++) {
      let changed = false;
      for (let i = 0; i + 1 < nodes.length; i++) {
        const A = nodes[i], B = nodes[i + 1];
        const len = B.d - A.d;
        for (let d = A.d + 0.2; d < B.d - 0.2; d += 0.25) {
          const t = (d - A.d) / len;
          const y = A.y * (1 - t) + B.y * t;
          const def = need(d) - y;
          if (def <= 0.002) continue;
          const fa = !A.fixed, fb = !B.fixed;
          if (fa && fb) { const den = (1 - t) * (1 - t) + t * t; A.y += (def * (1 - t)) / den; B.y += (def * t) / den; }
          else if (fb) B.y += def / Math.max(0.25, t);
          else if (fa) A.y += def / Math.max(0.25, 1 - t);
          else continue;
          changed = true;
        }
      }
      if (!changed) break;
    }
    // keep the towers from towering absurdly: cap and let the final clearance pass lift the spans if needed
    for (const n of nodes) if (!n.fixed) n.y = Math.min(n.y, 6);
    return nodes;
  }

  private profile(line: Line, nodes: { d: number; y: number }[]) {
    const poly = line.poly!;
    const step = 0.25;
    const n = Math.max(2, Math.ceil(poly.length / step) + 1);
    const ys = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = i * step;
      while (k + 2 < nodes.length && nodes[k + 1].d < d) k++;
      const A = nodes[k], B = nodes[Math.min(nodes.length - 1, k + 1)];
      const len = Math.max(1e-3, B.d - A.d);
      const t = Math.max(0, Math.min(1, (d - A.d) / len));
      // a little catenary sag in the middle of each span
      ys[i] = A.y * (1 - t) + B.y * t - Math.sin(t * Math.PI) * Math.min(0.06, len * 0.012);
    }
    return { ys, step };
  }

  private buildGondolaLine(line: Line) {
    const poly = line.poly!;
    const nodes = this.towers(line);
    const prof = this.profile(line, nodes);
    this.cable.set(line.id, prof);
    const b = new MeshBuilder();
    b.paintW = 0;
    const CABLE = lin(0x2d333b);
    const tmp = { x: 0, z: 0, ang: 0 };
    for (const lane of [-1, 1]) {
      const pts: { x: number; y: number; z: number }[] = [];
      for (let i = 0; i < prof.ys.length; i++) {
        poly.at(Math.min(i * prof.step, poly.length), MODES.gondola.lane * lane, tmp);
        pts.push({ x: tmp.x, y: prof.ys[i], z: tmp.z });
      }
      cableTube(b, pts, 0.0035, CABLE);
    }
    const geos: THREE.BufferGeometry[] = [b.geometry()];
    for (const nd of nodes) {
      if (nd.fixed) continue;
      poly.at(nd.d, 0, tmp);
      const tx = Math.floor(tmp.x + 20), ty = Math.floor(tmp.z + 20);
      const wet = tx >= 0 && ty >= 0 && tx < N && ty < N && this.world.water[tileIdx(tx, ty)] === 1;
      geos.push(...pylonGeo(tmp.x, tmp.z, tmp.ang, nd.y - 0.008, wet ? -0.5 : 0.004, line.color));
    }
    const merged = mergeGeos(geos);
    const m = new THREE.Mesh(merged, this.mat);
    m.castShadow = true;
    this.group.add(m);
    this.cableMeshes.push(m);
  }

  /** rebuild only the cable cars (their cables follow the skyline as buildings grow) */
  rebuildCables() {
    for (const m of this.cableMeshes) { this.group.remove(m); m.geometry.dispose(); }
    this.cableMeshes = [];
    this.cable.clear();
    for (const line of this.transit.lines) if (line.kind === 'gondola' && line.poly) this.buildGondolaLine(line);
  }

  /** rebuild everything that depends on lines and stops */
  rebuild() {
    const tr = this.transit;
    for (const m of [...this.viaducts.values(), ...this.stations.values(), ...this.shelters.values(), ...this.trams.values(), ...this.piers.values(), ...this.gondolaStations.values()]) { this.group.remove(m); m.geometry.dispose(); }
    this.viaducts.clear(); this.stations.clear(); this.shelters.clear(); this.trams.clear(); this.piers.clear(); this.gondolaStations.clear();
    for (const line of tr.lines) {
      if (!line.poly) continue;
      if (line.kind === 'metro') {
        const m = new THREE.Mesh(viaduct(line, this.world), this.mat);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.viaducts.set(line.id, m);
      } else if (line.kind === 'tram') {
        const m = new THREE.Mesh(tramTrack(line, this.world), this.tramMat);
        m.receiveShadow = true;
        this.group.add(m);
        this.trams.set(line.id, m);
      }
    }
    this.rebuildCables();
    for (const s of tr.stops) {
      const colors = s.lines.map((l) => l.color);
      if (!colors.length) colors.push(MODES[s.kind].color);
      if (s.kind === 'metro') {
        // orientation from the first line through it
        const l = s.lines.find((x) => x.poly) ?? null;
        let ang = 0;
        if (l && l.poly) {
          const k = l.stops.indexOf(s);
          const tmp = { x: 0, z: 0, ang: 0 };
          l.poly.at(l.stopDist[k], 0, tmp);
          ang = tmp.ang;
        } else ang = 0;
        const m = new THREE.Mesh(stationGeo(s, ang, colors), this.mat);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.stations.set(s.id, m);
      } else if (s.kind === 'ferry') {
        // the pier points at the berth its first line uses
        let dx = 1, dz = 0;
        for (const l of s.lines) {
          const k = l.stops.indexOf(s);
          const berth = l.tiles[l.stopIdx[k]];
          if (berth !== undefined) { dx = tileX(berth) - tileX(s.tile); dz = tileY(berth) - tileY(s.tile); break; }
        }
        if (Math.abs(dx) + Math.abs(dz) !== 1) { dx = 1; dz = 0; for (let d = 0; d < 4; d++) { const nx = tileX(s.tile) + DX[d], ny = tileY(s.tile) + DY[d]; if (inMap(nx, ny) && this.world.water[tileIdx(nx, ny)]) { dx = DX[d]; dz = DY[d]; break; } } }
        const m = new THREE.Mesh(pierGeo(dx, dz, colors), this.mat);
        m.position.set(s.x, 0, s.z);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.piers.set(s.id, m);
      } else if (s.kind === 'gondola') {
        const l = s.lines.find((x) => x.poly) ?? null;
        const ang = l ? this.heading(l, l.stops.indexOf(s)) : 0;
        const m = new THREE.Mesh(gondolaStationGeo(ang, colors), this.mat);
        m.position.set(s.x, 0, s.z);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.gondolaStations.set(s.id, m);
      } else {
        const t = s.tile;
        const tx = tileX(t), ty = tileY(t);
        const hz = (inMap(tx - 1, ty) && this.world.road[tileIdx(tx - 1, ty)]) || (inMap(tx + 1, ty) && this.world.road[tileIdx(tx + 1, ty)]);
        const vt = (inMap(tx, ty - 1) && this.world.road[tileIdx(tx, ty - 1)]) || (inMap(tx, ty + 1) && this.world.road[tileIdx(tx, ty + 1)]);
        const alongX = !!hz && (!vt || (tx + ty) % 2 === 0);
        const geo = s.kind === 'tram' ? tramShelterGeo(colors, alongX) : shelterGeo(colors, alongX);
        const m = new THREE.Mesh(geo, this.mat);
        // east-west roads: shelter on the south sidewalk; north-south: west sidewalk
        const ox = alongX ? 0 : -0.435, oz = alongX ? 0.435 : 0;
        m.position.set(s.x + ox, 0.012, s.z + oz);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        this.shelters.set(s.id, m);
      }
    }
  }

  /** queue people near their stops */
  updateCrowd(t: number) {
    let n = 0;
    const cap = 2400;
    const tr = this.transit;
    for (const s of tr.stops) {
      const q = s.queue.length;
      if (!q) continue;
      const show = Math.min(q, s.kind === 'metro' ? 44 : s.kind === 'ferry' ? 34 : 20);
      let bx: number, bz: number, ang = 0, y: number;
      if (s.kind === 'metro') {
        const l = s.lines.find((x) => x.poly);
        const tmp = { x: 0, z: 0, ang: 0 };
        if (l && l.poly) l.poly.at(l.stopDist[l.stops.indexOf(s)], 0, tmp);
        ang = tmp.ang; bx = s.x; bz = s.z; y = TRACK_Y + 0.032;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        for (let k = 0; k < show && n < cap; k++) {
          const side = k % 2 === 0 ? 1 : -1;
          const slot = (k >> 1);
          const u = -0.42 + (slot % 11) * 0.083 + (slot > 10 ? 0.04 : 0);
          const v = side * (0.2 + (slot >= 11 ? 0.05 : 0) + (((k * 7) % 3) * 0.018));
          this.person(n++, bx + ca * u - sa * v, y + Math.sin(t * 2.3 + k) * 0.002, bz + sa * u + ca * v, ang + (side > 0 ? -1.57 : 1.57), s.queue[k % q].color);
        }
      } else if (s.kind === 'ferry') {
        // along the pier deck toward the water
        let dx = 1, dz = 0;
        for (const l of s.lines) { const berth = l.tiles[l.stopIdx[l.stops.indexOf(s)]]; if (berth !== undefined) { dx = tileX(berth) - tileX(s.tile); dz = tileY(berth) - tileY(s.tile); break; } }
        if (Math.abs(dx) + Math.abs(dz) !== 1) { dx = 1; dz = 0; }
        const px = -dz, pz = dx;
        for (let k = 0; k < show && n < cap; k++) {
          const row = Math.floor(k / 6), col = k % 6;
          const u = 0.55 + row * 0.07 + ((k * 5) % 3) * 0.008;
          const v = (col - 2.5) * 0.058;
          this.person(n++, s.x + dx * u + px * v, 0.052 + Math.sin(t * 2.3 + k) * 0.002, s.z + dz * u + pz * v, Math.atan2(-dz, dx) + 1.57, s.queue[k % q].color);
        }
      } else if (s.kind === 'gondola') {
        // a queue in front of the station
        const l = s.lines.find((x) => x.poly);
        const a = l ? this.heading(l, l.stops.indexOf(s)) : 0;
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let k = 0; k < show && n < cap; k++) {
          const row = Math.floor(k / 5), col = k % 5;
          const side = k % 2 === 0 ? 1 : -1;
          const slot = k >> 1;
          const u = -0.22 + (slot % 5) * 0.11, v = side * (0.1 + Math.floor(slot / 5) * 0.05);
          this.person(n++, s.x + ca * u - sa * v, 0.455 + Math.sin(t * 2.3 + k) * 0.002, s.z + sa * u + ca * v, a + (side > 0 ? 1.57 : -1.57), s.queue[k % q].color);
        }
      } else {
        // along the sidewalk beside the shelter
        const tx = tileX(s.tile), ty = tileY(s.tile);
        const alongX = !!(inMap(tx - 1, ty) && this.world.road[tileIdx(tx - 1, ty)]) || !!(inMap(tx + 1, ty) && this.world.road[tileIdx(tx + 1, ty)]);
        const hzFirst = alongX;
        for (let k = 0; k < show && n < cap; k++) {
          const u = -0.2 + (k % 10) * 0.05;
          const v = (k < 10 ? 0.0 : 0.05) + 0.0;
          const x = hzFirst ? s.x + u : s.x - 0.435 + 0.06 + v;
          const z = hzFirst ? s.z + 0.435 - 0.06 - v : s.z + u;
          this.person(n++, x, 0.012 + Math.sin(t * 2.3 + k) * 0.002, z, hzFirst ? -1.57 : 3.14, s.queue[k % q].color);
        }
      }
    }
    this.crowd.count = n;
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowdTint.needsUpdate = true;
  }

  private person(i: number, x: number, y: number, z: number, ang: number, color: number) {
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(0, ang, 0);
    tmpObj.scale.setScalar(1);
    tmpObj.updateMatrix();
    this.crowd.setMatrixAt(i, tmpObj.matrix);
    const c = PEOPLE[color % PEOPLE.length];
    this.crowdTint.setXYZ(i, c.r, c.g, c.b);
  }

  /** the lit parts only matter at night; nothing to animate per frame beyond uniforms */
  update() { void U; }
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // geometries from MeshBuilder share one attribute layout; concatenate them
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  let vtx = 0, idx = 0;
  for (const g of geos) { vtx += g.getAttribute('position').count; idx += g.index ? g.index.count : 0; }
  for (const n of names) {
    const first = geos[0].getAttribute(n) as THREE.BufferAttribute;
    const arr = new Float32Array(vtx * first.itemSize);
    let o = 0;
    for (const g of geos) { const a = g.getAttribute(n) as THREE.BufferAttribute; arr.set(a.array as Float32Array, o); o += a.array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, first.itemSize));
  }
  const ind = new Uint32Array(idx);
  let io = 0, base = 0;
  for (const g of geos) {
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) ind[io + i] = gi.getX(i) + base;
    io += gi.count; base += g.getAttribute('position').count;
  }
  out.setIndex(new THREE.BufferAttribute(ind, 1));
  out.computeBoundingSphere();
  return out;
}
