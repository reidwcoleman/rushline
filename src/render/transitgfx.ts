// Elevated viaducts, stations, bus shelters and the people waiting at them.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, shade3, mix3, instAttr, tmpObj, U } from './gfx.ts';
import { smoothTilePath } from '../sim/path.ts';
import { wx, wz, tileX, tileY, DX, DY, N, inMap, tileIdx, type World } from '../sim/world.ts';
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
function extrude(b: MeshBuilder, samples: { x: number; z: number; ang: number }[], sec: Sec[], closeEnds = false) {
  for (let i = 0; i + 1 < samples.length; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    const l0x = -Math.sin(s0.ang), l0z = Math.cos(s0.ang), l1x = -Math.sin(s1.ang), l1z = Math.cos(s1.ang);
    for (let k = 0; k + 1 < sec.length; k++) {
      const a = sec[k], c = sec[k + 1];
      const dO = c.o - a.o, dY = c.y - a.y;
      const len = Math.hypot(dO, dY) || 1;
      const no = -dY / len, ny = dO / len;
      const col = k % 2 === 0 ? a.c : a.c;
      const p = (s: typeof s0, lx: number, lz: number, sc: Sec) => [s.x + lx * sc.o, sc.y, s.z + lz * sc.o];
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
  private mat: THREE.MeshStandardMaterial;
  private crowd: THREE.InstancedMesh;
  private crowdTint: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, readonly world: World, readonly transit: Transit) {
    this.mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }), { paint: false, emit: true, cloud: true });
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

  /** rebuild everything that depends on lines and stops */
  rebuild() {
    const tr = this.transit;
    for (const m of [...this.viaducts.values(), ...this.stations.values(), ...this.shelters.values()]) { this.group.remove(m); m.geometry.dispose(); }
    this.viaducts.clear(); this.stations.clear(); this.shelters.clear();
    for (const line of tr.lines) {
      if (line.kind !== 'metro' || !line.poly) continue;
      const m = new THREE.Mesh(viaduct(line, this.world), this.mat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.viaducts.set(line.id, m);
    }
    for (const s of tr.stops) {
      const colors = s.lines.map((l) => l.color);
      if (!colors.length) colors.push(s.kind === 'metro' ? 0xffb02e : 0x8892a0);
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
      } else {
        const t = s.tile;
        const tx = tileX(t), ty = tileY(t);
        const hz = (inMap(tx - 1, ty) && this.world.road[tileIdx(tx - 1, ty)]) || (inMap(tx + 1, ty) && this.world.road[tileIdx(tx + 1, ty)]);
        const vt = (inMap(tx, ty - 1) && this.world.road[tileIdx(tx, ty - 1)]) || (inMap(tx, ty + 1) && this.world.road[tileIdx(tx, ty + 1)]);
        const alongX = !!hz && (!vt || (tx + ty) % 2 === 0);
        const geo = shelterGeo(colors, alongX);
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
      const show = Math.min(q, s.kind === 'metro' ? 44 : 20);
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
