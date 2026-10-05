// Procedural buildings: parametric variants per kind/level, drawn as instanced meshes with a shared procedural-window shader.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, mix3, shade3, instAttr, tmpObj, U } from './gfx.ts';
import { mulberry32 } from '../sim/util.ts';
import { VARIANTS } from '../sim/city.ts';
import type { Kind, Building } from '../sim/types.ts';
import { wx, wz, N } from '../sim/world.ts';

type RGB = number[];
type Win = [number, number, number, number];

const pal = (...hex: number[]): RGB[] => hex.map(lin);
const RES_WALL = pal(0xf2e6cf, 0xf3cfb2, 0xcfe0c3, 0xc8dcee, 0xf6e3a1, 0xefc4c4, 0xdcd6ca, 0xf8f1e4);
const RES_ROOF = pal(0xc9694a, 0x5d6b7d, 0x7a5a48, 0x4f8f8a, 0xd3a53f, 0xa3503b, 0x6b7280);
const APT_WALL = pal(0xc4785b, 0xe3d5bb, 0xf0eee8, 0xb9c6d6, 0xd9a58a, 0xcbd5b5, 0xe8c9a0);
const APT_ACCENT = pal(0x3d7f8a, 0xd1634a, 0xe0b04a, 0x5a6a9c, 0x4c9a74);
const TOWER_WALL = pal(0xe9edf2, 0xd8dee8, 0xe9e1d3, 0xc9d3de, 0xf0e6d6);
const SHOP_WALL = pal(0xf4efe4, 0xf0d9c3, 0xdce8e4, 0xe7dff2, 0xf3e3b8);
const AWN = pal(0xe24a4a, 0x2fa59a, 0xf2a03d, 0x7f5bd1, 0x3b86d6, 0xe86aa3);
const GLASS = pal(0x6a97c9, 0x4f9aa3, 0x6b7a92, 0xb7a278, 0x6572c4, 0x8fb2c8);
const MID_WALL = pal(0xdad2c2, 0xc9ced6, 0xe6d3b3, 0xbfc9c2, 0xd8c4c0);
const IND_WALL = pal(0xb7bec6, 0xc8b8a4, 0xa9b4be, 0xd0c9ba);
const IND_ACCENT = pal(0xf08a3c, 0xf2c14e, 0x4f86c6, 0xd4553e);
const DARK = lin(0x40454f);
const LOT_GRASS = lin(0x80bb5c);
const LOT_GRASS2 = lin(0x72ad52);
const LOT_PAVE = lin(0xd7d1c3);
const LOT_CONC = lin(0xbab6ab);
const PATH = lin(0xe8e2d4);
const TRUNK = lin(0x7a5a3c);
const LEAF = [lin(0x5fae55), lin(0x74be5a), lin(0x4f9a52), lin(0x86c862)];
const ROOF_FLAT = lin(0xa9a89f);
const ROOF_DARK = lin(0x6f7480);
const METAL = lin(0xc9ced3);
const WARM_SIGN = lin(0xffd58a);

export interface Variant {
  geo: THREE.BufferGeometry;
  height: number;
  smoke: { x: number; y: number; z: number }[];
}

const W = (cw: number, ch: number, fw: number, fh: number): Win => [cw, ch, fw, fh];

function lot(b: MeshBuilder, kind: Kind, r: () => number) {
  b.paintW = 0;
  if (kind === 'res') {
    b.floor(0, 0.016, 0, 0.96, 0.96, r() < 0.5 ? LOT_GRASS : LOT_GRASS2);
  } else if (kind === 'com') {
    b.floor(0, 0.016, 0, 0.96, 0.96, LOT_PAVE);
    // paving joints
    for (let i = -1; i <= 1; i++) { b.floor(i * 0.3, 0.0175, 0, 0.006, 0.9, shade3(LOT_PAVE, 0.93)); }
  } else {
    b.floor(0, 0.016, 0, 0.96, 0.96, LOT_CONC);
    b.floor(0, 0.0175, 0.42, 0.9, 0.01, lin(0xf2c14e));
  }
  b.paintW = 1;
}

function tree(b: MeshBuilder, x: number, z: number, s: number, r: () => number) {
  const sp = b.paintW; b.paintW = 0;
  b.cyl(x, 0.016, z, 0.012 * s, 0.01 * s, 0.07 * s, TRUNK, 5, { cap: false });
  const c = LEAF[(r() * LEAF.length) | 0];
  b.blob(x, 0.016 + 0.11 * s, z, 0.06 * s, 0.065 * s, 0.06 * s, c, 6, 4, 0.18, r);
  b.paintW = sp;
}

function bush(b: MeshBuilder, x: number, z: number, s: number, r: () => number) {
  const sp = b.paintW; b.paintW = 0;
  b.blob(x, 0.016 + 0.018 * s, z, 0.04 * s, 0.03 * s, 0.04 * s, LEAF[(r() * LEAF.length) | 0], 6, 3, 0.2, r);
  b.paintW = sp;
}

function ac(b: MeshBuilder, x: number, y: number, z: number, r: () => number) {
  const sp = b.paintW; b.paintW = 0;
  const w = 0.05 + r() * 0.04, d = 0.04 + r() * 0.03;
  b.box(x, y, z, w, 0.025, d, METAL);
  b.box(x, y + 0.025, z, w * 0.7, 0.01, d * 0.7, shade3(METAL, 0.7));
  b.paintW = sp;
}

// ------------------------------------------------------------------------------ residential

function house(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'res', r);
  const wall = RES_WALL[(r() * RES_WALL.length) | 0];
  const roof = RES_ROOF[(r() * RES_ROOF.length) | 0];
  const two = r() < 0.45;
  const w = 0.12 * (3 + ((r() * 2) | 0)), d = 0.3 + r() * 0.08;
  const fh = two ? 0.32 : 0.16;
  const bz = -0.06;
  const win = W(0.12, 0.16, 0.5, 0.52);
  b.box(0, 0.016, bz, w, fh, d, wall, { win, top: wall });
  // base trim
  b.paintW = 0; b.box(0, 0.016, bz, w + 0.012, 0.012, d + 0.012, shade3(wall, 0.8)); b.paintW = 1;
  const alongZ = r() < 0.4;
  const rise = 0.11 + r() * 0.07;
  b.gable(0, 0.016 + fh, bz, alongZ ? d : w, alongZ ? w : d, rise, roof, shade3(roof, 0.82), 0.03, alongZ);
  b.gableEnds(0, 0.016 + fh, bz, alongZ ? d : w, alongZ ? w : d, rise, wall, alongZ);
  // chimney
  b.paintW = 0;
  b.box((r() - 0.5) * w * 0.5, 0.016 + fh + rise * 0.4, bz + (r() - 0.5) * 0.05, 0.034, rise * 0.8, 0.034, lin(0xa8695a));
  // door + step
  b.box((r() - 0.5) * w * 0.4, 0.016, bz + d / 2 + 0.004, 0.04, 0.085, 0.01, lin(r() < 0.5 ? 0x7a4b3a : 0x3f6a78));
  b.box(0, 0.016, bz + d / 2 + 0.03, 0.14, 0.008, 0.05, PATH);
  b.floor(0, 0.0175, 0.34, 0.08, 0.32, PATH);
  // garage / annex
  if (r() < 0.5) {
    const gw = 0.16, gx = (w / 2 + gw / 2 - 0.01) * (r() < 0.5 ? 1 : -1);
    b.paintW = 1;
    b.box(gx, 0.016, bz + 0.02, gw, 0.13, d * 0.75, wall, { win: W(0.2, 0.2, 0.0, 0.0) });
    b.paintW = 0;
    b.box(gx, 0.016 + 0.13, bz + 0.02, gw + 0.03, 0.014, d * 0.75 + 0.03, roof);
    b.box(gx, 0.016, bz + 0.02 + d * 0.375 + 0.003, 0.11, 0.09, 0.008, lin(0xe6e1d6));
  }
  tree(b, (r() < 0.5 ? -1 : 1) * 0.36, 0.1 + r() * 0.3, 0.9 + r() * 0.5, r);
  if (r() < 0.6) tree(b, (r() < 0.5 ? -1 : 1) * 0.38, -0.3 + r() * 0.2, 0.8 + r() * 0.4, r);
  bush(b, -0.18, 0.2, 1, r); bush(b, 0.2, 0.19, 0.9, r);
  // white picket
  b.paintW = 0;
  for (const s of [-1, 1]) b.box(s * 0.44, 0.016, 0.28, 0.008, 0.035, 0.34, lin(0xf3f0e8));
  b.box(0, 0.016, 0.455, 0.36, 0.035, 0.008, lin(0xf3f0e8));
  b.box(0.3, 0.016, 0.455, 0.2, 0.035, 0.008, lin(0xf3f0e8));
  const geo = b.geometry();
  geo.computeBoundingBox();
  return { geo, height: 0.016 + fh + rise, smoke: [] };
}

function apartment(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'res', r);
  const wall = APT_WALL[(r() * APT_WALL.length) | 0];
  const accent = APT_ACCENT[(r() * APT_ACCENT.length) | 0];
  const floors = 3 + ((r() * 3) | 0);
  const fh = 0.17;
  const h = floors * fh + 0.02;
  const w = 0.12 * (4 + ((r() * 2) | 0)), d = 0.44 + r() * 0.1;
  const win = W(0.12, fh, 0.52, 0.58);
  b.box(0, 0.016, -0.04, w, h, d, wall, { win, top: shade3(wall, 0.9) });
  // ground floor plinth + canopy
  b.paintW = 0;
  b.box(0, 0.016, -0.04, w + 0.016, 0.03, d + 0.016, shade3(wall, 0.72));
  b.box(0, 0.016 + 0.1, -0.04 + d / 2 + 0.03, 0.18, 0.012, 0.07, accent);
  b.box(0, 0.016, -0.04 + d / 2 + 0.004, 0.07, 0.1, 0.008, lin(0x3a4350));
  b.paintW = 1;
  // balconies on alternating floors
  for (let f = 1; f < floors; f++) {
    if ((f + v) % 2 === 0) continue;
    for (let k = 0; k < 2; k++) {
      const bx = (k - 0.5) * w * 0.5;
      b.paintW = 0;
      b.box(bx, 0.016 + f * fh + 0.01, -0.04 + d / 2 + 0.02, 0.1, 0.012, 0.045, shade3(wall, 0.85));
      b.box(bx, 0.016 + f * fh + 0.022, -0.04 + d / 2 + 0.04, 0.1, 0.03, 0.005, accent);
      b.paintW = 1;
    }
  }
  // parapet + roof gear
  const top = 0.016 + h;
  b.paintW = 0;
  b.box(0, top, -0.04, w + 0.02, 0.02, d + 0.02, shade3(wall, 0.78));
  b.box(0, top + 0.02, -0.04, w - 0.02, 0.004, d - 0.02, ROOF_FLAT);
  ac(b, -w * 0.25, top + 0.024, -0.1, r); ac(b, w * 0.2, top + 0.024, 0.0, r);
  if (r() < 0.6) b.box(w * 0.28, top + 0.024, -0.14, 0.09, 0.06, 0.08, shade3(wall, 0.85));
  b.paintW = 1;
  if (r() < 0.55) { tree(b, -0.4, 0.38, 1, r); tree(b, 0.38, 0.4, 0.9, r); } else { bush(b, -0.3, 0.4, 1.2, r); bush(b, 0.3, 0.4, 1.2, r); }
  const geo = b.geometry();
  return { geo, height: top + 0.06, smoke: [] };
}

function tower(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'res', r);
  const wall = TOWER_WALL[(r() * TOWER_WALL.length) | 0];
  const accent = APT_ACCENT[(r() * APT_ACCENT.length) | 0];
  const fh = 0.115;
  const floors = 11 + ((r() * 7) | 0);
  const w = 0.09 * (5 + ((r() * 1) | 0)), d = 0.36 + r() * 0.06;
  const win = W(0.09, fh, 0.6, 0.6);
  // podium
  b.box(0, 0.016, 0, 0.7, 0.14, 0.62, shade3(wall, 0.9), { win: W(0.14, 0.14, 0.7, 0.55) });
  b.paintW = 0;
  b.box(0, 0.156, 0, 0.72, 0.014, 0.64, ROOF_FLAT);
  b.paintW = 1;
  const y0 = 0.17;
  const split = Math.floor(floors * (0.65 + r() * 0.1));
  b.box(0, y0, 0, w, split * fh, d, wall, { win, top: wall });
  const w2 = w - 0.09, d2 = d - 0.07;
  if (floors - split > 0) b.box(0, y0 + split * fh, 0, w2, (floors - split) * fh, d2, shade3(wall, 0.96), { win, top: wall });
  const top = y0 + floors * fh;
  // vertical fins in the accent colour
  b.paintW = 0;
  for (const s of [-1, 1]) b.box(s * (w / 2 + 0.006), y0, 0, 0.012, split * fh, d * 0.92, mix3(accent, wall, 0.55));
  b.box(0, top, 0, w2 + 0.012, 0.016, d2 + 0.012, shade3(wall, 0.7));
  // crown
  b.box(0, top + 0.016, 0, w2 * 0.5, 0.05, d2 * 0.5, shade3(wall, 0.8));
  b.cyl(0, top + 0.066, 0, 0.004, 0.003, 0.2, lin(0x8a929c), 5);
  b.emitV = 3.5; b.box(0, top + 0.26, 0, 0.012, 0.012, 0.012, lin(0xff4a3d), { emit: 3.5 }); b.emitV = 0;
  ac(b, -w2 * 0.25, top + 0.016, d2 * 0.25, r);
  b.paintW = 1;
  tree(b, -0.4, 0.4, 1, r); tree(b, 0.4, 0.38, 1.1, r);
  const geo = b.geometry();
  return { geo, height: top + 0.3, smoke: [] };
}

// ------------------------------------------------------------------------------ commercial

function shop(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'com', r);
  const wall = SHOP_WALL[(r() * SHOP_WALL.length) | 0];
  const awn = AWN[(r() * AWN.length) | 0];
  const two = r() < 0.4;
  const w = 0.12 * (5 + ((r() * 1.4) | 0)), d = 0.44 + r() * 0.08;
  const h = two ? 0.36 : 0.2;
  const bz = -0.08;
  b.box(0, 0.016, bz, w, h, d, wall, { win: W(0.18, two ? 0.18 : 0.2, 0.8, 0.6), top: ROOF_FLAT });
  // storefront band: dark glass on front handled by windows; awning (striped)
  b.paintW = 0;
  const ay = 0.016 + 0.12, az = bz + d / 2;
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const x0 = -w / 2 + (i / stripes) * w, x1 = -w / 2 + ((i + 1) / stripes) * w;
    const col = i % 2 === 0 ? awn : lin(0xfaf6ee);
    const a = b.vert(x0, ay + 0.045, az, 0, 0.6, 0.8, col), bb = b.vert(x1, ay + 0.045, az, 0, 0.6, 0.8, col), c = b.vert(x1, ay, az + 0.075, 0, 0.6, 0.8, col), dd = b.vert(x0, ay, az + 0.075, 0, 0.6, 0.8, col);
    b.quad(a, dd, c, bb);
    // underside
    const e = b.vert(x0, ay + 0.045, az, 0, -1, 0, shade3(col, 0.6)), f = b.vert(x1, ay + 0.045, az, 0, -1, 0, shade3(col, 0.6)), g = b.vert(x1, ay, az + 0.075, 0, -1, 0, shade3(col, 0.6)), hh = b.vert(x0, ay, az + 0.075, 0, -1, 0, shade3(col, 0.6));
    b.quad(e, f, g, hh);
  }
  // sign board (glows at night)
  b.box(0, ay + 0.06, az + 0.012, w * 0.6, 0.05, 0.014, awn, { emit: 1.2 });
  // parapet and roof gear
  b.box(0, 0.016 + h, bz, w + 0.014, 0.025, d + 0.014, shade3(wall, 0.86));
  ac(b, -w * 0.2, 0.016 + h + 0.025, bz, r); if (r() < 0.6) ac(b, w * 0.22, 0.016 + h + 0.025, bz + 0.07, r);
  // sidewalk cafe tables
  if (r() < 0.6) for (let i = 0; i < 3; i++) { b.cyl(-0.18 + i * 0.18, 0.016, az + 0.16, 0.02, 0.02, 0.04, lin(0xf4efe4), 7); b.cyl(-0.18 + i * 0.18, 0.056, az + 0.16, 0.035, 0.035, 0.004, lin(0xf4efe4), 8); }
  tree(b, -0.4, 0.42, 0.9, r); tree(b, 0.4, 0.42, 0.9, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.016 + h + 0.06, smoke: [] };
}

function midrise(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'com', r);
  const wall = MID_WALL[(r() * MID_WALL.length) | 0];
  const glass = GLASS[(r() * GLASS.length) | 0];
  const fh = 0.15;
  const floors = 5 + ((r() * 4) | 0);
  const w = 0.1 * (6 + ((r() * 1.5) | 0)), d = 0.5 + r() * 0.08;
  const win = W(0.1, fh, 0.8, 0.68);
  b.box(0, 0.016, -0.02, w, 0.14, d, shade3(wall, 0.9), { win: W(0.2, 0.14, 0.82, 0.62) });
  const y0 = 0.156;
  b.box(0, y0, -0.02, w - 0.05, (floors - 1) * fh, d - 0.05, wall, { win, top: wall });
  // horizontal bands
  b.paintW = 0;
  for (let f = 2; f < floors; f += 2) b.box(0, y0 + (f - 1) * fh - 0.008, -0.02, w - 0.04, 0.016, d - 0.04, shade3(wall, 0.72));
  const top = y0 + (floors - 1) * fh;
  b.box(0, top, -0.02, w - 0.03, 0.02, d - 0.03, shade3(wall, 0.65));
  // glass atrium accent on the front
  b.paintW = 1;
  b.box(0, y0, -0.02 + (d - 0.05) / 2 + 0.01, 0.22, (floors - 1) * fh, 0.02, glass, { win: W(0.055, 0.075, 0.9, 0.75) });
  b.paintW = 0;
  ac(b, -0.15, top + 0.02, -0.08, r); ac(b, 0.18, top + 0.02, 0.05, r);
  b.box(0.12, top + 0.02, -0.12, 0.12, 0.07, 0.1, shade3(wall, 0.8));
  b.emitV = 1.2; b.box(0, top - 0.06, -0.02 + d / 2 - 0.02, w * 0.7, 0.035, 0.012, WARM_SIGN, { emit: 1.2 }); b.emitV = 0;
  tree(b, -0.42, 0.4, 0.9, r); tree(b, 0.42, 0.4, 0.9, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: top + 0.12, smoke: [] };
}

function skyscraper(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'com', r);
  const glass = GLASS[v % GLASS.length];
  const trim = shade3(glass, 0.55);
  const fh = 0.12;
  const curtain = W(0.075, fh, 0.92, 0.82);
  // podium with lobby
  b.box(0, 0.016, 0, 0.78, 0.12, 0.7, shade3(glass, 1.15), { win: W(0.13, 0.12, 0.85, 0.7), top: ROOF_FLAT });
  b.paintW = 0;
  b.box(0, 0.136, 0, 0.8, 0.012, 0.72, ROOF_DARK);
  b.paintW = 1;
  const y0 = 0.148;
  let top = y0;
  let crown = 0;
  const style = v % 6;
  if (style === 0) {
    // stepped slab
    const f1 = 9 + ((r() * 4) | 0), f2 = 6 + ((r() * 4) | 0), f3 = 4 + ((r() * 3) | 0);
    b.box(0, y0, 0, 0.6, f1 * fh, 0.5, glass, { win: curtain });
    b.box(0, y0 + f1 * fh, 0, 0.45, f2 * fh, 0.4, glass, { win: curtain });
    b.box(0, y0 + (f1 + f2) * fh, 0, 0.3, f3 * fh, 0.3, glass, { win: curtain });
    top = y0 + (f1 + f2 + f3) * fh; crown = 0.3;
    b.paintW = 0;
    b.cyl(0, top, 0, 0.006, 0.004, crown, lin(0xaab2bb), 5);
  } else if (style === 1) {
    // twin towers on a podium joined by a skybridge
    const fl = 12 + ((r() * 5) | 0);
    b.box(-0.2, y0, 0, 0.26, fl * fh, 0.42, glass, { win: curtain });
    b.box(0.2, y0, 0, 0.26, (fl - 2) * fh, 0.42, shade3(glass, 1.08), { win: curtain });
    b.paintW = 0;
    b.box(0, y0 + 7 * fh, 0, 0.16, 0.07, 0.2, trim);
    top = y0 + fl * fh; crown = 0.06;
    b.box(-0.2, top, 0, 0.28, 0.014, 0.44, trim);
    b.box(0.2, y0 + (fl - 2) * fh, 0, 0.28, 0.014, 0.44, trim);
  } else if (style === 2) {
    // tapering glass tower with a pointed cap
    const fl = 17 + ((r() * 5) | 0);
    let yy = y0, wd = 0.5, dp = 0.44;
    for (let s = 0; s < 4; s++) {
      const n = Math.round(fl / 4);
      b.box(0, yy, 0, wd, n * fh, dp, glass, { win: curtain });
      yy += n * fh; wd -= 0.07; dp -= 0.06;
    }
    top = yy; crown = 0.42;
    b.paintW = 0;
    b.cone(0, top, 0, 0.12, crown * 0.55, shade3(glass, 0.75), 4);
    b.cyl(0, top + crown * 0.5, 0, 0.005, 0.003, crown * 0.5, lin(0xaab2bb), 5);
  } else if (style === 3) {
    // round tower
    const fl = 15 + ((r() * 5) | 0);
    b.cyl(0, y0, 0, 0.27, 0.27, fl * fh, glass, 22, { win: curtain, capColor: ROOF_DARK });
    // use box windows on a faceted drum instead (cylinder uv is angle*radius so windows still work)
    top = y0 + fl * fh; crown = 0.16;
    b.paintW = 0;
    b.cyl(0, top, 0, 0.28, 0.28, 0.018, trim, 20);
    b.cyl(0, top + 0.018, 0, 0.12, 0.12, 0.08, shade3(glass, 0.8), 14);
    b.cyl(0, top + 0.098, 0, 0.004, 0.003, 0.18, lin(0xaab2bb), 5);
  } else if (style === 4) {
    // slab with a slanted top (stepped to mimic the cut)
    const fl = 14 + ((r() * 4) | 0);
    b.box(0, y0, 0, 0.62, fl * fh, 0.44, glass, { win: curtain });
    for (let s = 0; s < 4; s++) b.box(-0.2 + s * 0.04, y0 + fl * fh + s * fh * 0.9, 0, 0.22 + (3 - s) * 0.08, fh * 0.9, 0.44, glass, { win: curtain });
    top = y0 + fl * fh + 4 * fh * 0.9; crown = 0.1;
    b.paintW = 0;
    b.box(0.2, y0, -0.24, 0.02, fl * fh, 0.02, trim);
  } else {
    // setback tower + helipad
    const fl = 10 + ((r() * 4) | 0);
    b.box(0, y0, 0, 0.56, fl * fh, 0.56, glass, { win: curtain });
    b.box(0, y0 + fl * fh, 0, 0.4, 4 * fh, 0.4, shade3(glass, 1.1), { win: curtain });
    top = y0 + (fl + 4) * fh; crown = 0.12;
    b.paintW = 0;
    b.cyl(0.0, top, 0, 0.16, 0.16, 0.012, lin(0x4a5260), 14);
    b.cyl(0.0, top + 0.012, 0, 0.1, 0.1, 0.003, lin(0xf3f0e6), 14);
  }
  b.paintW = 0;
  b.box(0, top, 0, 0.1, 0.016, 0.1, trim);
  b.emitV = 3.6; b.box(0, top + crown, 0, 0.012, 0.012, 0.012, lin(0xff4a3d), { emit: 3.6 }); b.emitV = 0;
  tree(b, -0.42, 0.4, 1.1, r); tree(b, 0.42, 0.4, 1.1, r); tree(b, -0.42, -0.4, 1.1, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: top + crown + 0.04, smoke: [] };
}

// ------------------------------------------------------------------------------ industrial

function workshop(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'ind', r);
  const wall = IND_WALL[(r() * IND_WALL.length) | 0];
  const acc = IND_ACCENT[(r() * IND_ACCENT.length) | 0];
  const w = 0.7, d = 0.46, h = 0.2;
  const bz = -0.12;
  b.box(0, 0.016, bz, w, h, d, wall, { win: W(0.2, 0.2, 0.7, 0.3) });
  // sawtooth roof
  b.paintW = 0;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i / n) * w, x1 = -w / 2 + ((i + 1) / n) * w;
    const y = 0.016 + h;
    const hi = 0.09;
    const c1 = lin(0x8b93a0), c2 = lin(0xb6bdc8);
    let a = b.vert(x0, y, bz + d / 2, 0, 0.5, 0.86, c1), bb = b.vert(x1, y, bz + d / 2, 0, 0.5, 0.86, c1), c = b.vert(x1, y + hi, bz + d / 2 - d * 0.2, 0, 0.5, 0.86, c1), dd = b.vert(x0, y + hi, bz + d / 2 - d * 0.2, 0, 0.5, 0.86, c1);
    b.quad(a, bb, c, dd);
    a = b.vert(x0, y + hi, bz + d / 2 - d * 0.2, 0, 1, 0, c2); bb = b.vert(x1, y + hi, bz + d / 2 - d * 0.2, 0, 1, 0, c2); c = b.vert(x1, y, bz - d / 2, 0, 1, 0, c2); dd = b.vert(x0, y, bz - d / 2, 0, 1, 0, c2);
    b.quad(a, bb, c, dd);
    // glazed face
    a = b.vert(x0, y, bz + d / 2 - d * 0.2 * 0, -0, 0, -1, lin(0x6c8aa6)); void a;
    const gx0 = b.vert(x0, y + hi, bz + d / 2 - d * 0.2, 1, 0, 0, lin(0x6c8aa6)), gx1 = b.vert(x0, y, bz + d / 2, 1, 0, 0, lin(0x6c8aa6)), gx2 = b.vert(x0, y, bz + d / 2 - d * 0.2, 1, 0, 0, lin(0x6c8aa6));
    b.tri(gx0, gx2, gx1);
    const gy0 = b.vert(x1, y + hi, bz + d / 2 - d * 0.2, -1, 0, 0, lin(0x6c8aa6)), gy1 = b.vert(x1, y, bz + d / 2, -1, 0, 0, lin(0x6c8aa6)), gy2 = b.vert(x1, y, bz + d / 2 - d * 0.2, -1, 0, 0, lin(0x6c8aa6));
    b.tri(gy0, gy1, gy2);
  }
  // roll-up door + safety stripe
  b.box(-0.18, 0.016, bz + d / 2 + 0.004, 0.16, 0.12, 0.008, lin(0xdcdfe3));
  b.box(0.2, 0.016, bz + d / 2 + 0.004, 0.16, 0.12, 0.008, acc);
  // crates and pallets
  for (let i = 0; i < 4; i++) b.box(-0.3 + i * 0.07 + r() * 0.03, 0.016, 0.34 + r() * 0.06, 0.05, 0.04 + r() * 0.03, 0.05, lin(0xc79a62));
  b.box(0.3, 0.016, 0.36, 0.1, 0.05, 0.1, acc);
  // small truck
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.016 + h + 0.1, smoke: [] };
}

function factory(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'ind', r);
  const wall = IND_WALL[(r() * IND_WALL.length) | 0];
  const acc = IND_ACCENT[(r() * IND_ACCENT.length) | 0];
  const smoke: { x: number; y: number; z: number }[] = [];
  b.box(0, 0.016, -0.1, 0.74, 0.3, 0.5, wall, { win: W(0.2, 0.3, 0.7, 0.22) });
  b.paintW = 0;
  b.box(0, 0.316, -0.1, 0.76, 0.02, 0.52, ROOF_DARK);
  // roof louvres
  for (let i = 0; i < 3; i++) b.box(-0.22 + i * 0.22, 0.336, -0.1, 0.12, 0.05, 0.3, lin(0x9aa3ad));
  b.paintW = 1;
  // annex
  b.box(0.27, 0.016, 0.28, 0.3, 0.16, 0.24, shade3(wall, 0.95), { win: W(0.15, 0.16, 0.6, 0.3) });
  b.paintW = 0;
  b.box(0.27, 0.176, 0.28, 0.32, 0.014, 0.26, ROOF_DARK);
  // stacks with red/white bands
  const stacks = v % 2 === 0 ? [[-0.28, -0.22]] : [[-0.28, -0.22], [-0.14, -0.28]];
  for (const [sx, sz] of stacks) {
    for (let k = 0; k < 6; k++) b.cyl(sx, 0.336 + k * 0.1, sz, 0.034 - k * 0.0016, 0.034 - (k + 1) * 0.0016, 0.1, k % 2 ? lin(0xf0eee8) : lin(0xd4553e), 8, { cap: k === 5 });
    smoke.push({ x: sx, y: 0.336 + 0.6, z: sz });
  }
  // silos
  for (const sx of [-0.2, -0.05]) {
    b.cyl(sx, 0.016, 0.3, 0.07, 0.07, 0.3, lin(0xdadee3), 12, { capColor: lin(0xc2c8ce) });
    b.cyl(sx, 0.316, 0.3, 0.07, 0.0, 0.05, lin(0xaab0b7), 12, { cap: false });
  }
  // pipes
  b.box(0.0, 0.2, 0.18, 0.5, 0.016, 0.016, acc);
  // container stack
  b.box(0.35, 0.016, -0.42, 0.14, 0.05, 0.07, acc); b.box(0.35, 0.066, -0.42, 0.14, 0.05, 0.07, lin(0x4f86c6));
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.95, smoke };
}

function plant(r: () => number, v: number): Variant {
  const b = new MeshBuilder();
  lot(b, 'ind', r);
  const wall = IND_WALL[(r() * IND_WALL.length) | 0];
  const acc = IND_ACCENT[(r() * IND_ACCENT.length) | 0];
  const smoke: { x: number; y: number; z: number }[] = [];
  b.box(-0.08, 0.016, 0.0, 0.7, 0.34, 0.56, wall, { win: W(0.22, 0.34, 0.7, 0.2) });
  b.paintW = 0;
  b.box(-0.08, 0.356, 0.0, 0.72, 0.02, 0.58, ROOF_DARK);
  // cooling towers (hyperboloid-ish)
  for (const [cx, cz] of [[0.33, -0.18], [0.33, 0.14]]) {
    b.cyl(cx, 0.016, cz, 0.09, 0.07, 0.2, lin(0xd9dce0), 14, { cap: false });
    b.cyl(cx, 0.216, cz, 0.07, 0.085, 0.14, lin(0xd9dce0), 14, { cap: false });
    smoke.push({ x: cx, y: 0.38, z: cz });
  }
  // tall stacks
  for (const [sx, sz] of [[-0.3, -0.34], [-0.15, -0.36]]) {
    for (let k = 0; k < 8; k++) b.cyl(sx, 0.376 + k * 0.1, sz, 0.036 - k * 0.0014, 0.036 - (k + 1) * 0.0014, 0.1, k % 2 ? lin(0xf0eee8) : lin(0xd4553e), 8, { cap: k === 7 });
    smoke.push({ x: sx, y: 0.376 + 0.82, z: sz });
  }
  // silo cluster
  for (const [sx, sz] of [[-0.38, 0.36], [-0.24, 0.38], [-0.1, 0.36]]) b.cyl(sx, 0.016, sz, 0.055, 0.055, 0.26, lin(0xe4e6ea), 10, { capColor: lin(0xb8bfc6) });
  b.box(-0.24, 0.27, 0.38, 0.42, 0.012, 0.02, acc);
  // pipe bridge
  b.box(0.1, 0.24, 0.0, 0.01, 0.01, 0.5, acc);
  b.box(0.25, 0.016, 0.38, 0.2, 0.06, 0.1, acc);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 1.25, smoke };
}

// ------------------------------------------------------------------------------ landmark

function arena(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, LOT_CONC);
  const team = lin(0x2f5d9e), team2 = lin(0xe8b84a);
  // outer wall with arches (windows) and a rising roof ring
  b.paintW = 1;
  b.cyl(0, 0.016, 0, 0.45, 0.42, 0.2, lin(0xe4e8ee), 28, { cap: false, win: W(0.09, 0.1, 0.5, 0.45) });
  b.paintW = 0;
  b.cyl(0, 0.216, 0, 0.455, 0.34, 0.06, lin(0xf6f7f9), 28, { cap: false });
  // seating bowl: coloured tiers, inside the roof ring
  for (let t = 0; t < 3; t++) b.cyl(0, 0.04 + t * 0.045, 0, 0.34 - t * 0.04, 0.32 - t * 0.04, 0.045, t % 2 ? team2 : team, 28, { cap: false });
  b.cyl(0, 0.03, 0, 0.24, 0.24, 0.01, lin(0x3d8f46), 28);
  // pitch lines
  b.floor(0, 0.0415, 0, 0.3, 0.012, lin(0xf4f4ef)); b.floor(0, 0.0415, 0, 0.012, 0.18, lin(0xf4f4ef));
  b.floor(-0.14, 0.0415, 0, 0.012, 0.18, lin(0xf4f4ef)); b.floor(0.14, 0.0415, 0, 0.012, 0.18, lin(0xf4f4ef));
  // floodlight masts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl(sx * 0.36, 0.016, sz * 0.36, 0.011, 0.008, 0.46, lin(0x8a929c), 6, { cap: false });
    b.box(sx * 0.36, 0.45, sz * 0.36, 0.08, 0.035, 0.08, lin(0xfff6dc), { emit: 5.5 });
  }
  // entrance canopy and sign
  b.box(0, 0.016, 0.47, 0.22, 0.12, 0.05, lin(0xc9d1da));
  b.box(0, 0.14, 0.49, 0.2, 0.04, 0.014, lin(0xffc54d), { emit: 2.2 });
  void r;
  const geo = b.geometry();
  return { geo, height: 0.5, smoke: [] };
}


function school(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, LOT_PAVE);
  const brick = lin(0xe7c99a), trim = lin(0xf6f1e6), roof = lin(0x6a5a52), accent = lin(0xf2b84b);
  // play yard with court lines and a hoop
  b.floor(0.18, 0.0175, 0.3, 0.5, 0.3, lin(0x7fa6c9));
  b.floor(0.18, 0.0185, 0.3, 0.46, 0.012, lin(0xf4f4ef)); b.floor(0.18, 0.0185, 0.3, 0.012, 0.26, lin(0xf4f4ef));
  b.cyl(0.43, 0.016, 0.3, 0.006, 0.006, 0.14, lin(0x8a929c), 5, { cap: false });
  b.box(0.43, 0.15, 0.3, 0.012, 0.03, 0.05, lin(0xf4f4ef));
  b.paintW = 1;
  // long main wing with window bands
  b.box(-0.05, 0.016, -0.12, 0.82, 0.22, 0.3, brick, { win: W(0.1, 0.11, 0.62, 0.55), top: roof });
  // taller classroom block
  b.box(-0.3, 0.016, -0.12, 0.26, 0.34, 0.32, shade3(brick, 0.96), { win: W(0.1, 0.11, 0.62, 0.55), top: roof });
  b.paintW = 0;
  b.box(-0.05, 0.236, -0.12, 0.84, 0.014, 0.32, roof);
  b.box(-0.3, 0.356, -0.12, 0.28, 0.014, 0.34, roof);
  // entrance: porch with yellow canopy and steps
  b.box(0.12, 0.016, 0.06, 0.2, 0.2, 0.06, trim);
  b.box(0.12, 0.2, 0.075, 0.24, 0.022, 0.12, accent);
  b.box(0.12, 0.016, 0.06, 0.07, 0.11, 0.012, lin(0x4a5568));
  b.box(0.12, 0.016, 0.15, 0.24, 0.01, 0.07, trim); b.box(0.12, 0.026, 0.12, 0.2, 0.01, 0.06, trim);
  // clock tower
  b.box(0.12, 0.236, -0.12, 0.1, 0.16, 0.1, trim);
  b.cyl(0.12, 0.396, -0.12, 0.085, 0.0, 0.1, roof, 4, { cap: false });
  b.box(0.12, 0.3, -0.067, 0.05, 0.05, 0.008, lin(0xfff6dc), { emit: 1.4 });
  // flagpole
  b.cyl(-0.42, 0.016, 0.36, 0.006, 0.005, 0.34, lin(0xd8dce0), 5, { cap: false });
  b.box(-0.39, 0.3, 0.36, 0.06, 0.035, 0.004, lin(0xe05a4f));
  // trees at the corners
  tree(b, -0.44, 0.1, 1.1, r); tree(b, -0.4, 0.44, 0.9, r); tree(b, 0.44, -0.4, 1, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.5, smoke: [] };
}

function clinic(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, lin(0xe5e3dc));
  const white = lin(0xf5f7f8), teal = lin(0x3aa7a0), glass = lin(0x8dc4d2), red = lin(0xe5484d);
  // lawn and parking
  b.floor(-0.28, 0.0175, 0.34, 0.36, 0.26, LOT_GRASS);
  b.floor(0.26, 0.0175, 0.38, 0.4, 0.18, lin(0x9a9fa6));
  for (let i = 0; i < 5; i++) b.floor(0.12 + i * 0.07, 0.0185, 0.38, 0.006, 0.12, lin(0xf4f4ef));
  b.paintW = 1;
  // main wing: three storeys, long ribbon windows
  b.box(0, 0.016, -0.1, 0.7, 0.36, 0.34, white, { win: W(0.09, 0.12, 0.72, 0.5), top: ROOF_FLAT });
  // side wing
  b.box(-0.3, 0.016, 0.1, 0.26, 0.2, 0.3, shade3(white, 0.97), { win: W(0.09, 0.1, 0.7, 0.5), top: ROOF_FLAT });
  b.paintW = 0;
  b.box(0, 0.376, -0.1, 0.72, 0.014, 0.36, shade3(white, 0.8));
  b.box(-0.3, 0.216, 0.1, 0.28, 0.014, 0.32, shade3(white, 0.8));
  // teal band and glass lobby with an ambulance canopy
  b.box(0, 0.2, -0.1, 0.72, 0.03, 0.36, teal);
  b.box(0.18, 0.016, 0.09, 0.3, 0.14, 0.14, glass, { emit: 0.7 });
  b.box(0.18, 0.156, 0.09, 0.34, 0.018, 0.18, teal);
  b.box(-0.02, 0.1, 0.12, 0.2, 0.012, 0.16, white);
  for (const sx of [-0.11, 0.07]) b.box(sx, 0.016, 0.19, 0.012, 0.084, 0.012, lin(0xcfd5da));
  // red cross sign on the front
  b.box(0.0, 0.26, 0.075, 0.1, 0.1, 0.012, white);
  b.box(0.0, 0.29, 0.082, 0.07, 0.022, 0.006, red, { emit: 1.6 }); b.box(0.0, 0.266, 0.082, 0.022, 0.07, 0.006, red, { emit: 1.6 });
  // helipad on the roof
  b.cyl(0.22, 0.39, -0.1, 0.1, 0.1, 0.012, lin(0x5b6670), 16);
  b.floor(0.22, 0.4025, -0.1, 0.1, 0.014, lin(0xf4f4ef)); b.floor(0.22, 0.4025, -0.1, 0.014, 0.1, lin(0xf4f4ef));
  ac(b, -0.2, 0.39, -0.12, r);
  tree(b, -0.38, 0.36, 1.1, r); tree(b, -0.22, 0.4, 0.9, r); bush(b, -0.1, 0.34, 1, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.5, smoke: [] };
}


// ------------------------------------------------------------------------------ freight industries

const CROP_A = lin(0x9bc55a), CROP_B = lin(0x7fae4b), SOIL = lin(0x8a6a48), BARN_RED = lin(0xb5493b), BARN_TRIM = lin(0xf3eee2), HAY = lin(0xe3c46b);
const CROPS = [lin(0xd9b84a), lin(0x6fae4c), lin(0x93c452), lin(0x5c9a45)];

function farm(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, lin(0x7fb257));
  // crop rows in two plots
  for (const [cx, cz, w, d, ci] of [[-0.22, -0.2, 0.5, 0.34, 0], [0.24, -0.2, 0.42, 0.34, 1], [-0.18, 0.28, 0.54, 0.26, 2]] as const) {
    b.floor(cx, 0.0175, cz, w, d, SOIL);
    const n = Math.floor(d / 0.045);
    for (let i = 0; i < n; i++) b.floor(cx, 0.0185, cz - d / 2 + 0.03 + i * 0.045, w - 0.03, 0.026, CROPS[(ci + (i & 1)) % 4]);
  }
  // barn with a gambrel-ish roof
  b.paintW = 0;
  b.box(0.3, 0.016, 0.3, 0.3, 0.14, 0.22, BARN_RED);
  b.gable(0.3, 0.156, 0.3, 0.3, 0.22, 0.09, lin(0x6a5a52), lin(0x594a44), 0.025, false);
  b.gableEnds(0.3, 0.156, 0.3, 0.3, 0.22, 0.09, BARN_RED, false);
  b.box(0.3, 0.016, 0.412, 0.1, 0.1, 0.008, BARN_TRIM);
  b.box(0.3, 0.016, 0.413, 0.008, 0.1, 0.006, BARN_RED);
  // silo
  b.cyl(0.08, 0.016, 0.36, 0.05, 0.05, 0.3, lin(0xdfe3e8), 12, { capColor: lin(0xaab2bb) });
  b.blob(0.08, 0.316, 0.36, 0.05, 0.03, 0.05, lin(0xb9c1ca), 9, 4);
  // farmhouse
  b.paintW = 1;
  b.box(-0.36, 0.016, 0.34, 0.2, 0.1, 0.16, lin(0xf2e6cf), { win: W(0.14, 0.14, 0.5, 0.5) });
  b.paintW = 0;
  b.gable(-0.36, 0.116, 0.34, 0.2, 0.16, 0.08, lin(0xc9694a), lin(0xa3503b), 0.025, true);
  // hay bales and a tractor
  for (let i = 0; i < 4; i++) b.cyl(-0.05 + (i % 2) * 0.07, 0.016 + Math.floor(i / 2) * 0.05, 0.1 + (i % 2) * 0.02, 0.03, 0.03, 0.045, HAY, 8);
  b.box(0.1, 0.034, 0.02, 0.12, 0.05, 0.07, lin(0x3d8f46));
  b.box(0.16, 0.084, 0.02, 0.05, 0.04, 0.06, lin(0x3d8f46));
  b.box(0.045, 0.016, 0.02, 0.06, 0.06, 0.08, lin(0x1f2328));
  tree(b, -0.46, -0.44, 1.2, r); tree(b, 0.46, -0.44, 1, r); tree(b, 0.44, 0.1, 0.9, r);
  // fence
  for (const sx of [-1, 1]) b.box(sx * 0.47, 0.016, 0.0, 0.006, 0.03, 0.9, lin(0xf3f0e8));
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.46, smoke: [] };
}

function quarry(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, lin(0xc9bfa6));
  // terraced pit: rim rings stepping down toward a dark floor
  const rings: [number, number, number][] = [[0.46, 0.07, 0xb7a98a], [0.37, 0.05, 0xa89877], [0.28, 0.03, 0x9a8967]];
  for (const [rad, h, col] of rings) b.cyl(-0.08, 0.016, -0.1, rad, rad - 0.03, h, lin(col), 22, { cap: false });
  b.cyl(-0.08, 0.016, -0.1, 0.2, 0.2, 0.012, lin(0x6e6350), 20);
  b.cyl(-0.08, 0.026, -0.1, 0.08, 0.08, 0.004, lin(0x4a7a96), 14);          // a small pool at the bottom
  // ramp
  b.box(0.19, 0.03, -0.1, 0.24, 0.016, 0.06, lin(0x8c7c5d));
  // crusher and hopper
  b.box(0.36, 0.016, 0.22, 0.2, 0.18, 0.16, lin(0x8c929a));
  b.box(0.36, 0.196, 0.22, 0.22, 0.014, 0.18, lin(0x5c6168));
  b.cone(0.36, 0.21, 0.22, 0.09, 0.07, lin(0xd08f2d), 4);
  b.box(0.2, 0.1, 0.22, 0.2, 0.012, 0.03, lin(0x3b4048));                    // conveyor
  b.box(0.12, 0.016, 0.22, 0.014, 0.09, 0.014, lin(0x6c7078));
  // stone piles
  for (const [px, pz, rad, h, col] of [[-0.3, 0.3, 0.1, 0.1, 0xaab0b8], [-0.1, 0.38, 0.08, 0.07, 0x8f959d], [0.1, 0.42, 0.07, 0.06, 0xc4c9cf]] as const) b.cone(px, 0.016, pz, rad, h, lin(col), 9);
  // excavator and dump truck
  b.box(-0.28, 0.016, -0.34, 0.12, 0.05, 0.08, lin(0xf2b84b));
  b.box(-0.3, 0.066, -0.34, 0.06, 0.04, 0.06, lin(0xf2b84b));
  b.box(-0.22, 0.09, -0.34, 0.1, 0.014, 0.02, lin(0xf2b84b));
  b.box(0.1, 0.03, -0.38, 0.16, 0.05, 0.08, lin(0xf2b84b));
  b.box(0.04, 0.08, -0.38, 0.1, 0.03, 0.07, lin(0x5c6168));
  tree(b, 0.44, -0.12, 0.9, r); tree(b, -0.46, 0.1, 0.9, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.38, smoke: [] };
}

function freightFactory(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, LOT_CONC);
  b.floor(0, 0.0175, 0.42, 0.9, 0.012, lin(0xf2c14e));
  const wall = lin(0xe5e2da), brick = lin(0xc47a5a);
  b.paintW = 1;
  // main hall with a sawtooth roof
  b.box(-0.12, 0.016, -0.08, 0.66, 0.2, 0.5, wall, { win: W(0.16, 0.2, 0.7, 0.5), top: ROOF_DARK });
  b.paintW = 0;
  for (let i = 0; i < 4; i++) {
    const x0 = -0.38 + i * 0.16;
    b.box(x0 + 0.08, 0.216, -0.08, 0.16, 0.0, 0.5, ROOF_DARK);
    b.gable(x0 + 0.08, 0.216, -0.08, 0.16, 0.5, 0.06, lin(0x8c9298), lin(0x70767d), 0.0, true);
    b.box(x0 + 0.02, 0.216, -0.08, 0.004, 0.058, 0.5, lin(0x8fb7c9), { emit: 0.6 });    // north-light glazing
  }
  // loading dock with bays and a truck
  b.box(0.28, 0.016, 0.04, 0.2, 0.12, 0.34, brick);
  for (let i = 0; i < 3; i++) b.box(0.386, 0.016, -0.06 + i * 0.1, 0.012, 0.08, 0.07, lin(0x4a515c));
  b.box(0.5, 0.03, 0.04, 0.12, 0.07, 0.06, lin(0xf2f2ee));
  // stack and tanks
  for (let k = 0; k < 6; k++) b.cyl(-0.3, 0.216 + k * 0.1, -0.34, 0.032 - k * 0.0012, 0.032 - (k + 1) * 0.0012, 0.1, k % 2 ? lin(0xf0eee8) : lin(0xd4553e), 9, { cap: k === 5 });
  for (const [tx, tz] of [[-0.36, 0.36], [-0.2, 0.38], [-0.04, 0.36]] as const) b.cyl(tx, 0.016, tz, 0.065, 0.065, 0.13, lin(0xd9dce0), 12, { capColor: lin(0xb8bfc6) });
  b.box(-0.2, 0.15, 0.37, 0.4, 0.01, 0.014, lin(0xf08a3c));
  // crates of finished goods
  for (let i = 0; i < 6; i++) b.box(0.0 + (i % 3) * 0.07, 0.016 + Math.floor(i / 3) * 0.05, 0.4, 0.06, 0.048, 0.06, i % 2 ? lin(0xd29a5c) : lin(0xb9824a));
  tree(b, 0.46, 0.46, 0.8, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.78, smoke: [{ x: -0.3, y: 0.82, z: -0.34 }] };
}

const BOXES = [0xc8452e, 0x2f5d9e, 0xe8b84a, 0x2f9e6b, 0xeceae2, 0xd9783a];
function terminal(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.floor(0, 0.016, 0, 0.98, 0.98, lin(0xb6b4ad));
  for (let i = -2; i <= 2; i++) b.floor(i * 0.2, 0.0175, 0, 0.006, 0.9, lin(0xf2f2ee));
  // container stacks
  const rnd = mulberry32(77);
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 2; gz++) {
    const h = 1 + ((rnd() * 3) | 0);
    for (let k = 0; k < h; k++) b.box(-0.34 + gx * 0.2, 0.016 + k * 0.05, -0.28 + gz * 0.12, 0.17, 0.048, 0.1, lin(BOXES[(gx * 3 + gz * 5 + k) % BOXES.length]));
  }
  // portal crane
  const cy = 0.34;
  for (const sx of [-0.4, 0.4]) for (const sz of [-0.36, -0.16]) b.box(sx, 0.016, sz, 0.02, cy, 0.02, lin(0xf2b84b));
  b.box(0, cy + 0.016, -0.26, 0.84, 0.03, 0.04, lin(0xf2b84b));
  b.box(0.1, cy - 0.06, -0.26, 0.04, 0.06, 0.05, lin(0x3b4048));
  b.box(0.1, cy - 0.14, -0.26, 0.014, 0.08, 0.014, lin(0x3b4048));
  b.box(0.1, cy - 0.17, -0.26, 0.1, 0.03, 0.07, lin(BOXES[1]));
  b.box(0.0, cy + 0.046, -0.26, 0.05, 0.03, 0.05, lin(0xfff6dc), { emit: 3 });
  // warehouse and office
  b.paintW = 1;
  b.box(-0.1, 0.016, 0.3, 0.6, 0.16, 0.3, lin(0xdfe3e8), { win: W(0.2, 0.2, 0.0, 0.0), top: ROOF_DARK });
  b.box(0.36, 0.016, 0.32, 0.2, 0.24, 0.2, lin(0xe9edf2), { win: W(0.1, 0.12, 0.7, 0.6), top: ROOF_FLAT });
  b.paintW = 0;
  for (let i = 0; i < 4; i++) b.box(-0.3 + i * 0.13, 0.016, 0.455, 0.09, 0.1, 0.01, lin(0x4a5568));
  b.box(0.36, 0.26, 0.32, 0.22, 0.01, 0.22, lin(0x9aa3ac));
  b.box(0.36, 0.27, 0.32, 0.12, 0.05, 0.02, lin(0xffc54d), { emit: 2 });
  b.paintW = 1;
  void r;
  const geo = b.geometry();
  return { geo, height: 0.4, smoke: [] };
}


// ------------------------------------------------------------------------------ airport (3 x 2 tiles)

/** a small jet facing +x, built from boxes: used for parked planes on the apron and for the flying ones */
export function addPlane(b: MeshBuilder, x: number, y: number, z: number, scale: number, paint: boolean) {
  const s = scale;
  const body = lin(0xf3f4f6), glass = lin(0x2c3a4a), engine = lin(0xaeb4bb);
  const sp = b.paintW;
  b.paintW = 0;
  b.box(x, y, z, 0.56 * s, 0.075 * s, 0.075 * s, body);                        // fuselage
  b.cone(x + 0.3 * s, y + 0.0375 * s - 0.0375 * s, z, 0.0375 * s, 0.1 * s, body, 8);   // nose placeholder (tilted below)
  b.box(x + 0.2 * s, y + 0.045 * s, z, 0.1 * s, 0.03 * s, 0.07 * s, glass);    // cockpit glazing
  b.box(x - 0.02 * s, y + 0.012 * s, z, 0.14 * s, 0.03 * s, 0.62 * s, body);    // wings
  b.box(x - 0.1 * s, y + 0.012 * s, z, 0.04 * s, 0.014 * s, 0.6 * s, lin(0xd5d9de));
  for (const sz of [-1, 1]) b.cyl(x + 0.05 * s, y - 0.01 * s, z + sz * 0.15 * s, 0.022 * s, 0.022 * s, 0.07 * s, engine, 8);
  b.box(x - 0.27 * s, y + 0.06 * s, z, 0.1 * s, 0.1 * s, 0.012 * s, body);     // fin
  b.box(x - 0.27 * s, y + 0.02 * s, z, 0.06 * s, 0.012 * s, 0.24 * s, body);   // tailplane
  b.paintW = paint ? 1 : 0;
  b.box(x - 0.275 * s, y + 0.1 * s, z, 0.08 * s, 0.06 * s, 0.014 * s, paint ? lin(0xffffff) : lin(0xd4553e));   // livery on the fin
  b.box(x + 0.0, y + 0.04 * s, z, 0.4 * s, 0.014 * s, 0.077 * s, paint ? lin(0xffffff) : lin(0xd4553e));        // cheat line
  b.paintW = sp;
}

function airport(r: () => number): Variant {
  const b = new MeshBuilder();
  b.paintW = 0;
  const ASPH = lin(0x4a4f57), CONC = lin(0xc4c1b8), WHITE_L = lin(0xf4f4ef);
  b.floor(0, 0.016, 0, 2.96, 1.96, lin(0x86b266));
  // runway with edge lines, centre dashes and threshold stripes
  b.floor(0, 0.0175, -0.55, 2.9, 0.44, ASPH);
  b.floor(0, 0.0185, -0.55 - 0.2, 2.86, 0.01, WHITE_L); b.floor(0, 0.0185, -0.55 + 0.2, 2.86, 0.01, WHITE_L);
  for (let i = -6; i <= 6; i++) b.floor(i * 0.22, 0.0185, -0.55, 0.12, 0.014, WHITE_L);
  for (const sx of [-1, 1]) for (let k = -3; k <= 3; k++) b.floor(sx * 1.32, 0.0185, -0.55 + k * 0.05, 0.1, 0.02, WHITE_L);
  // edge lights glow after dark
  for (let i = -7; i <= 7; i++) for (const sz of [-1, 1]) b.box(i * 0.2, 0.0185, -0.55 + sz * 0.235, 0.018, 0.012, 0.018, lin(0xfff0c8), { emit: 3.5 });
  // taxiways and the apron
  b.floor(-0.55, 0.0175, -0.12, 0.13, 0.62, ASPH);
  b.floor(1.15, 0.0175, -0.12, 0.13, 0.62, ASPH);
  b.floor(0.3, 0.0175, 0.12, 1.9, 0.18, ASPH);
  b.floor(0.0, 0.0176, 0.4, 2.2, 0.36, CONC);
  for (const gx of [-0.55, 0.0, 0.55]) b.floor(gx, 0.0186, 0.4, 0.012, 0.3, lin(0xf2c14e));
  // terminal with a glass front and canopy
  b.paintW = 1;
  b.box(-0.1, 0.016, 0.78, 1.7, 0.14, 0.3, lin(0xe9edf1), { win: W(0.12, 0.14, 0.7, 0.56), top: ROOF_FLAT });
  b.paintW = 0;
  b.box(-0.1, 0.156, 0.78, 1.74, 0.02, 0.34, lin(0x5a6470));
  b.box(-0.1, 0.05, 0.62, 1.5, 0.07, 0.03, lin(0x7fb4cf), { emit: 0.6 });
  b.box(-0.1, 0.12, 0.6, 1.62, 0.014, 0.1, lin(0xf2f4f6));
  // jet bridges
  for (const gx of [-0.55, 0.0, 0.55]) { b.box(gx, 0.08, 0.57, 0.05, 0.05, 0.22, lin(0xdcdfe3)); b.box(gx, 0.016, 0.67, 0.012, 0.064, 0.012, lin(0x8a929c)); }
  // control tower
  b.cyl(1.05, 0.016, 0.8, 0.055, 0.045, 0.6, lin(0xe6e2d8), 10, { cap: false });
  b.cyl(1.05, 0.616, 0.8, 0.1, 0.12, 0.09, lin(0x7fb4cf), 10, { cap: false, win: undefined });
  b.cyl(1.05, 0.706, 0.8, 0.125, 0.04, 0.02, lin(0x4a515c), 10);
  b.box(1.05, 0.726, 0.8, 0.012, 0.1, 0.012, lin(0xcfd4da));
  b.box(1.05, 0.826, 0.8, 0.02, 0.02, 0.02, lin(0xff4a3d), { emit: 4 });
  // hangar with a barrel roof
  b.box(-1.2, 0.016, 0.76, 0.5, 0.14, 0.34, lin(0xd8d4c8));
  b.gable(-1.2, 0.156, 0.76, 0.5, 0.34, 0.07, lin(0xa8aeb6), lin(0x90969e), 0.01, true);
  b.box(-1.2, 0.016, 0.935, 0.34, 0.1, 0.008, lin(0x4a5568));
  // parked planes on two of the gates
  addPlane(b, 0.98, 0.05, 0.36, 0.9, false);
  b.paintW = 0;
  // fuel tanks, a windsock and ground vehicles
  for (const [tx, tz] of [[1.35, 0.55], [1.35, 0.35]] as const) b.cyl(tx, 0.016, tz, 0.07, 0.07, 0.1, lin(0xdfe3e8), 12, { capColor: lin(0xb8bfc6) });
  b.cyl(-1.35, 0.016, -0.2, 0.006, 0.006, 0.14, lin(0xcfd4da), 5, { cap: false });
  b.box(-1.31, 0.12, -0.2, 0.07, 0.03, 0.02, lin(0xff7a3d));
  b.box(0.25, 0.02, 0.2, 0.08, 0.04, 0.045, lin(0xf2b84b)); b.box(-0.35, 0.02, 0.22, 0.07, 0.035, 0.04, lin(0xf2f2ee));
  // car park in front
  b.floor(0.9, 0.0176, 0.95, 1.0, 0.05, ASPH);
  for (let i = 0; i < 7; i++) b.box(0.55 + i * 0.12, 0.02, 0.95, 0.07, 0.035, 0.035, lin(BOXES[(i * 5) % BOXES.length]));
  for (let i = 0; i < 9; i++) tree(b, -1.4 + i * 0.35, 0.96, 0.8 + (i % 3) * 0.15, r);
  tree(b, 1.45, -0.95, 1, r); tree(b, -1.45, -0.95, 1, r);
  b.paintW = 1;
  const geo = b.geometry();
  return { geo, height: 0.85, smoke: [] };
}

// ------------------------------------------------------------------------------ catalogue

const MAKERS: Record<Kind, ((r: () => number, v: number) => Variant)[]> = {
  res: [house, apartment, tower],
  com: [shop, midrise, skyscraper],
  ind: [workshop, factory, plant],
};

export function buildVariant(kind: Kind, level: number, variant: number, special?: string): Variant {
  if (special === 'arena') return arena(mulberry32(5));
  if (special === 'school') return school(mulberry32(11));
  if (special === 'clinic') return clinic(mulberry32(13));
  if (special === 'farm') return farm(mulberry32(17));
  if (special === 'quarry') return quarry(mulberry32(19));
  if (special === 'factory') return freightFactory(mulberry32(23));
  if (special === 'terminal') return terminal(mulberry32(29));
  if (special === 'airport') return airport(mulberry32(31));
  const r = mulberry32(kind.charCodeAt(0) * 1000 + level * 100 + variant * 7 + 3);
  return MAKERS[kind][level - 1](r, variant);
}

export const faceAngle = (rot: number) => [Math.PI / 2, 0, -Math.PI / 2, Math.PI][rot & 3];

/** world centre of a building; large ones cover several tiles */
export function footCenter(b: Building): { x: number; z: number } {
  if (!b.foot.length) return { x: wx(b.x), z: wz(b.y) };
  let sx = 0, sz = 0;
  for (const t of b.foot) { sx += wx(t % N); sz += wz(Math.floor(t / N)); }
  return { x: sx / b.foot.length, z: sz / b.foot.length };
}

interface Pool {
  mesh: THREE.InstancedMesh;
  ids: number[];            // building id per slot
  tint: THREE.InstancedBufferAttribute;
  seed: THREE.InstancedBufferAttribute;
  variant: Variant;
}

interface Anim { b: Building; t0: number; kind: 'spawn' | 'level' | 'drop'; ref: { pool: Pool; slot: number } | null; dur: number }

export class BuildingsView {
  group = new THREE.Group();
  material: THREE.MeshStandardMaterial;
  pools = new Map<string, Pool>();
  where = new Map<number, { pool: Pool; slot: number }>();
  anims: Anim[] = [];
  smoke: { id: number; x: number; y: number; z: number }[] = [];
  private tintMode = 0;

  constructor(scene: THREE.Scene) {
    this.material = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), { paint: true, windows: true, emit: true, cloud: true });
    scene.add(this.group);
  }

  private pool(kind: Kind, level: number, variant: number, special?: string): Pool {
    const key = special ? special : `${kind}${level}_${variant}`;
    let p = this.pools.get(key);
    if (p) return p;
    const v = buildVariant(kind, level, variant, special);
    const cap = special === 'arena' ? 4 : special ? 24 : 220;
    const mesh = new THREE.InstancedMesh(v.geo, this.material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tint = instAttr(cap, 3, 1);
    const seed = instAttr(cap, 1);
    v.geo.setAttribute('aTint', tint);
    v.geo.setAttribute('aSeed', seed);
    this.group.add(mesh);
    p = { mesh, ids: [], tint, seed, variant: v };
    this.pools.set(key, p);
    return p;
  }

  private setMatrix(p: Pool, slot: number, b: Building, sy: number, extra = 0) {
    const sxz = 1 + (1 - Math.min(1, sy)) * 0.06 + extra;
    const c = footCenter(b);
    tmpObj.position.set(c.x, 0, c.z);
    tmpObj.rotation.set(0, faceAngle(b.rot), 0);
    tmpObj.scale.set(sxz, Math.max(0.001, sy), sxz);
    tmpObj.updateMatrix();
    p.mesh.setMatrixAt(slot, tmpObj.matrix);
    p.mesh.instanceMatrix.needsUpdate = true;
  }

  add(b: Building, now: number, animate = true) {
    const p = this.pool(b.kind, b.level, b.variant, b.special);
    const slot = p.mesh.count++;
    p.ids[slot] = b.id;
    const r = mulberry32(b.id * 9973);
    const k = 0.92 + r() * 0.16;
    p.tint.setXYZ(slot, k, k * (0.97 + r() * 0.06), k * (0.97 + r() * 0.06));
    p.seed.setX(slot, r() * 100);
    p.tint.needsUpdate = true; p.seed.needsUpdate = true;
    this.where.set(b.id, { pool: p, slot });
    this.setMatrix(p, slot, b, animate ? 0.001 : 1);
    if (animate) this.anims.push({ b, t0: now, kind: 'spawn', ref: null, dur: 0.9 });
    for (const s of p.variant.smoke) {
      // rotate the local smoke point by the building heading
      const a = faceAngle(b.rot), ca = Math.cos(a), sa = Math.sin(a);
      this.smoke.push({ id: b.id, x: wx(b.x) + s.x * ca + s.z * sa, y: s.y, z: wz(b.y) + -s.x * sa + s.z * ca });
    }
  }

  remove(b: Building) {
    const w = this.where.get(b.id);
    if (!w) return;
    const { pool: p, slot } = w;
    const last = p.mesh.count - 1;
    if (slot !== last) {
      const m = new THREE.Matrix4();
      p.mesh.getMatrixAt(last, m);
      p.mesh.setMatrixAt(slot, m);
      p.tint.copyAt(slot, p.tint, last);
      p.seed.copyAt(slot, p.seed, last);
      const movedId = p.ids[last];
      p.ids[slot] = movedId;
      const mw = this.where.get(movedId);
      if (mw) mw.slot = slot;
      p.tint.needsUpdate = true; p.seed.needsUpdate = true;
    }
    p.ids.length = last;
    p.mesh.count = last;
    p.mesh.instanceMatrix.needsUpdate = true;
    this.where.delete(b.id);
    this.smoke = this.smoke.filter((s) => s.id !== b.id);
    this.anims = this.anims.filter((a) => a.b !== b);
  }

  /** a level change swaps the geometry: remove from the old pool and add to the new one with a grow animation */
  relevel(b: Building, now: number) {
    this.remove(b);
    this.add(b, now, true);
  }

  rotate(b: Building) {
    const w = this.where.get(b.id);
    if (w) this.setMatrix(w.pool, w.slot, b, 1);
  }

  heightOf(b: Building) {
    return this.pool(b.kind, b.level, b.variant, b.special).variant.height;
  }

  update(now: number) {
    if (!this.anims.length) return;
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      const t = (now - a.t0) / a.dur;
      const w = this.where.get(a.b.id);
      if (!w) { this.anims.splice(i, 1); continue; }
      if (t >= 1) { this.setMatrix(w.pool, w.slot, a.b, 1); this.anims.splice(i, 1); continue; }
      // elastic out
      const e = t <= 0 ? 0 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 9.4) * (1 - t * 0.3);
      this.setMatrix(w.pool, w.slot, a.b, Math.max(0.001, e));
    }
  }

  /** colour the buildings by a 0..1 value (happiness etc.) or restore */
  setTintMode(mode: number, valueOf?: (b: Building) => number, list?: Iterable<Building>) {
    this.tintMode = mode;
    if (!list) return;
    for (const b of list) {
      const w = this.where.get(b.id);
      if (!w) continue;
      const p = w.pool;
      if (mode === 0) {
        const r = mulberry32(b.id * 9973);
        const k = 0.92 + r() * 0.16;
        p.tint.setXYZ(w.slot, k, k * (0.97 + r() * 0.06), k * (0.97 + r() * 0.06));
      } else {
        const v = valueOf ? valueOf(b) : 0.5;
        // red .. amber .. green
        const g = mix3([1.5, 0.35, 0.3], [0.5, 1.35, 0.55], Math.min(1, Math.max(0, v)));
        p.tint.setXYZ(w.slot, g[0], g[1], g[2]);
      }
      p.tint.needsUpdate = true;
    }
  }

  static get night() { return U.uNight.value; }
}
