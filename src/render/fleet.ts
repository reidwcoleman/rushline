// Cars, buses and trains as instanced meshes (paint colour per instance, lit windows and lamps at night).
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj } from './gfx.ts';
import type { Traffic } from '../sim/traffic.ts';
import type { Transit } from '../sim/transit.ts';
import { WATER_LEVEL, N, HALF, type World } from '../sim/world.ts';
import type { Line } from '../sim/types.ts';
import { CARGO_INFO, CARGO_LIST } from '../sim/industry.ts';

export const TRACK_Y = 0.92;

const GLASS = lin(0x25303c);
const TYRE = lin(0x1b1d22);
const WHITE = lin(0xf2f2ee);
const SILVER = lin(0xcfd4da);
const HEAD = lin(0xfff1c8);
const TAIL = lin(0xff3b30);

function wheel(b: MeshBuilder, x: number, z: number, r = 0.022, w = 0.02) {
  b.paintW = 0;
  b.box(x, 0.0, z, r * 2, r * 2, w, TYRE);
}

function carGeo(kind: number) {
  const b = new MeshBuilder();
  const L = kind === 2 ? 0.26 : 0.27, Wd = 0.118;
  b.paintW = 1;
  if (kind === 2) {
    // van
    b.box(0, 0.016, 0, L, 0.075, Wd, WHITE);
    b.paintW = 0;
    b.box(0.04, 0.07, 0, 0.14, 0.05, Wd * 0.94, GLASS);
    b.paintW = 1;
    b.box(-0.02, 0.118, 0, 0.2, 0.01, Wd * 0.96, WHITE);
  } else if (kind === 1) {
    // hatch
    b.box(0, 0.016, 0, L, 0.052, Wd, WHITE);
    b.box(0.045, 0.066, 0, 0.1, 0.014, Wd * 0.9, WHITE);
    b.paintW = 0;
    b.box(-0.01, 0.066, 0, 0.16, 0.05, Wd * 0.92, GLASS);
    b.paintW = 1;
    b.box(-0.01, 0.116, 0, 0.15, 0.01, Wd * 0.94, WHITE);
  } else {
    // sedan
    b.box(0, 0.016, 0, L, 0.05, Wd, WHITE);
    b.paintW = 0;
    b.box(-0.015, 0.066, 0, 0.13, 0.045, Wd * 0.92, GLASS);
    b.paintW = 1;
    b.box(-0.015, 0.111, 0, 0.12, 0.009, Wd * 0.94, WHITE);
  }
  // lights
  b.paintW = 0;
  for (const s of [-1, 1]) {
    b.box(L / 2 - 0.004, 0.044, s * 0.04, 0.012, 0.014, 0.024, HEAD, { emit: 4.5 });
    b.box(-L / 2 + 0.004, 0.046, s * 0.042, 0.012, 0.012, 0.024, TAIL, { emit: 2.5 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 0.085, sz * (Wd / 2 - 0.004));
  return b.geometry();
}

function busGeo() {
  const b = new MeshBuilder();
  const L = 0.5, Wd = 0.15, H = 0.16;
  b.paintW = 1;
  b.box(0, 0.016, 0, L, H, Wd, WHITE);
  b.paintW = 0;
  // window band, lit at night
  b.box(0, 0.075, 0, L - 0.04, 0.05, Wd + 0.004, GLASS, { emit: 0.9 });
  b.box(L / 2 + 0.001, 0.07, 0, 0.004, 0.065, Wd * 0.88, GLASS);
  b.box(0, 0.016 + H, 0, L - 0.02, 0.008, Wd - 0.02, SILVER);
  b.box(0, 0.016 + H + 0.008, 0, 0.18, 0.016, 0.07, SILVER);
  // destination sign
  b.box(L / 2 + 0.002, 0.15, 0, 0.004, 0.018, Wd * 0.6, lin(0xffc54d), { emit: 3 });
  for (const s of [-1, 1]) {
    b.box(L / 2 - 0.004, 0.04, s * 0.05, 0.012, 0.016, 0.024, HEAD, { emit: 4.5 });
    b.box(-L / 2 + 0.004, 0.044, s * 0.05, 0.012, 0.014, 0.024, TAIL, { emit: 2.5 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 0.17, sz * (Wd / 2 - 0.004), 0.026, 0.022);
  return b.geometry();
}

function trainGeo(nose: boolean) {
  const b = new MeshBuilder();
  const L = 0.26, Wd = 0.17, H = 0.15;
  b.paintW = 0;
  b.box(0, 0.0, 0, L, H, Wd, SILVER);
  // livery stripe (line colour)
  b.paintW = 1;
  b.box(0, 0.02, 0, L + 0.002, 0.026, Wd + 0.003, WHITE);
  b.paintW = 0;
  // windows
  b.box(0, 0.06, 0, L - 0.03, 0.05, Wd + 0.004, GLASS, { emit: 1.0 });
  b.box(0, H, 0, L - 0.02, 0.012, Wd - 0.03, lin(0x9aa3ac));
  b.box(0, H + 0.012, 0, 0.1, 0.012, 0.08, lin(0x7d868f));
  if (nose) {
    // cab: stepped taper at +x
    b.box(L / 2 + 0.012, 0.0, 0, 0.028, H * 0.9, Wd * 0.92, SILVER);
    b.box(L / 2 + 0.03, 0.0, 0, 0.016, H * 0.7, Wd * 0.8, SILVER);
    b.box(L / 2 + 0.02, 0.07, 0, 0.012, 0.055, Wd * 0.7, GLASS, { emit: 0.4 });
    b.paintW = 1;
    b.box(L / 2 + 0.02, 0.02, 0, 0.034, 0.026, Wd * 0.88, WHITE);
    b.paintW = 0;
    for (const s of [-1, 1]) b.box(L / 2 + 0.04, 0.045, s * 0.055, 0.008, 0.02, 0.026, HEAD, { emit: 5 });
  }
  // bogies
  for (const sx of [-1, 1]) b.box(sx * 0.09, -0.03, 0, 0.07, 0.03, Wd * 0.7, lin(0x333840));
  return b.geometry();
}


function tramGeo(nose: boolean) {
  const b = new MeshBuilder();
  const L = 0.2, Wd = 0.1, H = 0.1, y0 = 0.008;
  b.paintW = 0;
  b.box(0, y0, 0, L, H, Wd, lin(0xece8de));
  b.paintW = 1;
  b.box(0, y0 + 0.012, 0, L + 0.002, 0.026, Wd + 0.003, WHITE);        // livery band (line colour)
  b.box(0, y0 + H - 0.004, 0, L - 0.012, 0.012, Wd - 0.012, WHITE);     // roof stripe
  b.paintW = 0;
  b.box(0, y0 + 0.05, 0, L - 0.02, 0.038, Wd + 0.004, GLASS, { emit: 1.0 });
  b.box(0, y0 + H + 0.004, 0, L - 0.02, 0.008, Wd - 0.03, lin(0x9aa3ac));
  b.box(0.02, y0 + H + 0.012, 0, 0.05, 0.01, 0.045, lin(0x6d757e));    // pantograph
  b.box(0.02, y0 + H + 0.022, 0, 0.012, 0.004, 0.05, lin(0x3a4048));
  if (nose) {
    b.box(L / 2 + 0.01, y0, 0, 0.02, H * 0.92, Wd * 0.94, lin(0xece8de));
    b.box(L / 2 + 0.024, y0 + 0.006, 0, 0.012, H * 0.76, Wd * 0.82, lin(0xece8de));
    b.box(L / 2 + 0.018, y0 + 0.045, 0, 0.012, 0.042, Wd * 0.72, GLASS, { emit: 0.35 });
    b.paintW = 1;
    b.box(L / 2 + 0.016, y0 + 0.01, 0, 0.026, 0.024, Wd * 0.9, WHITE);
    b.paintW = 0;
    for (const s of [-1, 1]) b.box(L / 2 + 0.031, y0 + 0.026, s * 0.03, 0.006, 0.012, 0.016, HEAD, { emit: 5 });
  } else {
    b.box(L / 2 + 0.004, y0 + 0.01, 0, 0.012, H * 0.8, Wd * 0.9, lin(0x2b3037));   // articulation bellows
  }
  return b.geometry();
}

function ferryGeo() {
  const b = new MeshBuilder();
  const L = 0.62, Wd = 0.2;
  const HULL = lin(0xf4f2ea), NAVY = lin(0x24415c);
  b.paintW = 0;
  b.box(-0.02, -0.03, 0, L - 0.1, 0.034, Wd - 0.02, NAVY);                      // below the waterline
  b.box(-0.02, 0.0, 0, L - 0.08, 0.05, Wd, HULL);
  b.paintW = 1;
  b.box(-0.02, 0.022, 0, L - 0.08, 0.016, Wd + 0.004, WHITE);                   // stripe in the line colour
  b.paintW = 0;
  // bow
  b.box(L / 2 - 0.05, 0.0, 0, 0.08, 0.05, Wd * 0.74, HULL);
  b.box(L / 2 - 0.0, 0.0, 0, 0.06, 0.05, Wd * 0.42, HULL);
  b.box(L / 2 + 0.03, 0.01, 0, 0.02, 0.04, Wd * 0.18, HULL);
  b.box(L / 2 - 0.05, -0.03, 0, 0.08, 0.034, Wd * 0.6, NAVY);
  // stern
  b.box(-L / 2 + 0.005, -0.01, 0, 0.03, 0.05, Wd * 0.9, HULL);
  // main deck cabin with a lit window band
  b.box(-0.04, 0.05, 0, 0.34, 0.06, Wd - 0.04, lin(0xeef0f2));
  b.box(-0.04, 0.072, 0, 0.32, 0.026, Wd - 0.032, GLASS, { emit: 1.1 });
  b.box(-0.07, 0.11, 0, 0.22, 0.045, Wd - 0.08, lin(0xeef0f2));
  b.box(-0.07, 0.122, 0, 0.2, 0.02, Wd - 0.072, GLASS, { emit: 1.1 });
  b.box(-0.07, 0.155, 0, 0.25, 0.008, Wd - 0.06, lin(0xcfd4da));                // roof
  b.box(0.1, 0.05, 0, 0.1, 0.02, Wd * 0.5, lin(0xd9dde1));                        // fore deck
  // funnel in line colour + mast with a nav light
  b.paintW = 1;
  b.cyl(-0.12, 0.156, 0, 0.026, 0.022, 0.05, WHITE, 8);
  b.paintW = 0;
  b.cyl(-0.12, 0.2, 0, 0.026, 0.026, 0.008, lin(0x2a2f36), 8);
  b.box(0.0, 0.163, 0, 0.008, 0.07, 0.008, lin(0xcfd4da));
  b.box(0.0, 0.232, 0, 0.012, 0.012, 0.012, lin(0xfff1c8), { emit: 4 });
  for (const s of [-1, 1]) b.box(L / 2 - 0.03, 0.045, s * 0.05, 0.01, 0.008, 0.01, s > 0 ? lin(0x35d07f) : lin(0xff4b4b), { emit: 3 });
  b.box(-L / 2 + 0.002, 0.04, 0, 0.008, 0.008, 0.01, lin(0xffffff), { emit: 3 });
  // lifebuoys
  for (const s of [-1, 1]) b.box(-0.04, 0.1, s * (Wd / 2 - 0.004), 0.02, 0.02, 0.006, lin(0xff6b3d));
  return b.geometry();
}

function cabinGeo() {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.box(0, 0.08, 0, 0.012, 0.075, 0.012, lin(0x3a4048));                       // hanger up to the grip
  b.box(0, 0.152, 0, 0.05, 0.016, 0.02, lin(0x4a515c));                         // grip on the cable
  b.paintW = 1;
  b.box(0, 0.015, 0, 0.1, 0.07, 0.085, WHITE);                                   // body in the line colour
  b.paintW = 0;
  b.box(0, 0.036, 0, 0.102, 0.036, 0.087, GLASS, { emit: 1.0 });
  b.box(0, 0.085, 0, 0.09, 0.006, 0.075, lin(0xe9edf1));
  b.box(0, 0.0, 0, 0.09, 0.014, 0.075, lin(0xdfe3e7));
  return b.geometry();
}

function truckGeo() {
  const b = new MeshBuilder();
  const L = 0.56, Wd = 0.16;
  b.paintW = 1;
  b.box(L / 2 - 0.09, 0.016, 0, 0.18, 0.11, Wd, WHITE);                          // cab in the line colour
  b.paintW = 0;
  b.box(L / 2 - 0.045, 0.07, 0, 0.09, 0.04, Wd * 0.94, GLASS);
  b.box(L / 2 - 0.09, 0.126, 0, 0.17, 0.01, Wd * 0.96, SILVER);
  b.box(-0.07, 0.03, 0, L - 0.2, 0.03, Wd * 0.96, lin(0x4a5058));                // chassis
  b.box(-0.07, 0.06, 0, L - 0.22, 0.012, Wd, lin(0x8a6a48));                      // flatbed
  for (const s of [-1, 1]) b.box(-0.07, 0.072, s * (Wd / 2 - 0.003), L - 0.22, 0.03, 0.006, lin(0x6c5238));
  b.box(-L / 2 + 0.07, 0.072, 0, 0.006, 0.03, Wd, lin(0x6c5238));
  for (const s of [-1, 1]) {
    b.box(L / 2 - 0.004, 0.044, s * 0.052, 0.012, 0.016, 0.026, HEAD, { emit: 4.5 });
    b.box(-L / 2 + 0.004, 0.05, s * 0.054, 0.012, 0.014, 0.026, TAIL, { emit: 2.5 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 0.19, sz * (Wd / 2 - 0.004), 0.028, 0.026);
  wheel(b, 0.2, 0.065, 0.028, 0.026); wheel(b, 0.2, -0.065, 0.028, 0.026);
  return b.geometry();
}
function loadGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.box(-0.07, 0.072, 0, 0.32, 0.075, 0.13, WHITE);
  b.box(-0.07, 0.147, 0, 0.26, 0.018, 0.1, WHITE);
  return b.geometry();
}
function locoGeo() {
  const b = new MeshBuilder();
  const L = 0.3, Wd = 0.17;
  b.paintW = 0;
  b.box(0, 0.0, 0, L, 0.1, Wd, lin(0x3b4048));
  b.paintW = 1;
  b.box(0, 0.0, 0, L + 0.003, 0.03, Wd + 0.003, WHITE);
  b.box(-0.05, 0.1, 0, 0.18, 0.05, Wd * 0.9, WHITE);                                    // hood in the line colour
  b.paintW = 0;
  b.box(0.08, 0.1, 0, 0.1, 0.075, Wd * 0.94, lin(0xe9e6de));                            // cab
  b.box(0.08, 0.125, 0, 0.1, 0.03, Wd * 0.96, GLASS, { emit: 0.5 });
  b.box(0.08, 0.175, 0, 0.11, 0.01, Wd, lin(0x7d868f));
  b.cyl(-0.12, 0.15, 0, 0.022, 0.02, 0.034, lin(0x2a2f36), 8);
  for (const s of [-1, 1]) b.box(L / 2 + 0.002, 0.05, s * 0.055, 0.008, 0.02, 0.026, HEAD, { emit: 5 });
  for (const sx of [-1, 1]) b.box(sx * 0.09, -0.03, 0, 0.08, 0.03, Wd * 0.7, lin(0x23272d));
  return b.geometry();
}
function wagonGeo() {
  const b = new MeshBuilder();
  const L = 0.27, Wd = 0.17;
  b.paintW = 0;
  b.box(0, 0.0, 0, L, 0.035, Wd, lin(0x4a4038));
  b.box(0, 0.035, 0, L, 0.05, 0.008, lin(0x5b4f45));
  for (const s of [-1, 1]) b.box(0, 0.035, s * (Wd / 2 - 0.004), L, 0.05, 0.008, lin(0x5b4f45));
  b.box(-L / 2 + 0.004, 0.035, 0, 0.008, 0.05, Wd, lin(0x5b4f45));
  b.box(L / 2 - 0.004, 0.035, 0, 0.008, 0.05, Wd, lin(0x5b4f45));
  for (const sx of [-1, 1]) b.box(sx * 0.085, -0.03, 0, 0.07, 0.03, Wd * 0.7, lin(0x23272d));
  return b.geometry();
}
function wagonLoadGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.box(0, 0.04, 0, 0.23, 0.07, 0.14, WHITE);
  b.box(0, 0.11, 0, 0.18, 0.015, 0.1, WHITE);
  return b.geometry();
}

interface FPool { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; n: number; cap: number }

export class Fleet {
  group = new THREE.Group();
  private cars: FPool[] = [];
  private bus: FPool;
  private trainHead: FPool;
  private trainMid: FPool;
  private tramHead: FPool;
  private tramMid: FPool;
  private ferry: FPool;
  private cabin: FPool;
  private truck: FPool;
  private load: FPool;
  private loco: FPool;
  private wagon: FPool;
  private wload: FPool;
  private mat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, readonly world: World) {
    this.mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 }), { paint: true, emit: true });
    const mk = (geo: THREE.BufferGeometry, cap: number): FPool => {
      const mesh = new THREE.InstancedMesh(geo, this.mat, cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const tint = instAttr(cap, 3, 1);
      geo.setAttribute('aTint', tint);
      this.group.add(mesh);
      return { mesh, tint, n: 0, cap };
    };
    for (let k = 0; k < 3; k++) this.cars.push(mk(carGeo(k), 700));
    this.bus = mk(busGeo(), 160);
    this.trainHead = mk(trainGeo(true), 160);
    this.trainMid = mk(trainGeo(false), 160);
    this.tramHead = mk(tramGeo(true), 100);
    this.tramMid = mk(tramGeo(false), 100);
    this.ferry = mk(ferryGeo(), 60);
    this.cabin = mk(cabinGeo(), 220);
    this.truck = mk(truckGeo(), 120);
    this.load = mk(loadGeo(), 120);
    this.loco = mk(locoGeo(), 40);
    this.wagon = mk(wagonGeo(), 160);
    this.wload = mk(wagonLoadGeo(), 160);
    scene.add(this.group);
  }

  private put(p: FPool, x: number, y: number, z: number, ang: number, color: number, s = 1, pitch = 0) {
    if (p.n >= p.cap) return;
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(0, -ang, pitch);
    tmpObj.scale.setScalar(s);
    tmpObj.updateMatrix();
    p.mesh.setMatrixAt(p.n, tmpObj.matrix);
    p.tint.setXYZ(p.n, ((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    p.n++;
  }

  update(traffic: Traffic, transit: Transit, accidents: Iterable<number> = [], cableY: (line: Line, d: number) => number = () => 1, time = 0) {
    const w = this.world;
    for (const c of this.cars) c.n = 0;
    this.bus.n = 0; this.trainHead.n = 0; this.trainMid.n = 0; this.tramHead.n = 0; this.tramMid.n = 0; this.ferry.n = 0; this.cabin.n = 0; this.truck.n = 0; this.load.n = 0; this.loco.n = 0; this.wagon.n = 0; this.wload.n = 0;
    const tmpC = new THREE.Color();
    const lift = { y: 0, pitch: 0 };
    for (const v of traffic.vehicles) {
      if (v.dead) continue;
      const tile = v.path[v.i];
      let y = w.water[tile] ? 0.04 : 0.016;
      let pitch = 0;
      if (w.road[tile] === 3) { traffic.lift(v, lift); y += lift.y; pitch = lift.pitch; }
      if (v.kind === 0) {
        tmpC.set(v.color);
        const c = v.color;
        // paint colours are authored in sRGB; convert once for the linear pipeline
        tmpC.set(c);
        this.putLin(this.cars[v.shape % 3], v.x, y, v.z, v.ang, tmpC, 1, pitch);
      } else if (v.carrier && v.carrier.line.kind === 'truck') {
        tmpC.set(v.color);
        this.putLin(this.truck, v.x, y, v.z, v.ang, tmpC, 1, pitch);
        const ld = v.carrier.load;
        if (ld && ld.qty > 0.5) { tmpC.set(CARGO_INFO[CARGO_LIST[ld.type]].color); this.putLin(this.load, v.x, y, v.z, v.ang, tmpC, Math.min(1, 0.45 + ld.qty / v.carrier.cap * 0.55), pitch); }
      } else {
        tmpC.set(v.color);
        this.putLin(this.bus, v.x, y, v.z, v.ang, tmpC, 1, pitch);
      }
    }
    for (const t of accidents) {
      const x = ((t % N) - HALF + 0.5), z = (Math.floor(t / N) - HALF + 0.5);
      const h = ((t * 2654435761) >>> 0) / 4294967296;
      tmpC.set(0xd64545); this.putLin(this.cars[0], x - 0.1, 0.016, z + 0.06, 0.6 + h, tmpC);
      tmpC.set(0x3b82f6); this.putLin(this.cars[1], x + 0.13, 0.016, z - 0.07, -0.8 + h * 0.6, tmpC);
    }
    const pos = { x: 0, z: 0, ang: 0 };
    for (const line of transit.lines) {
      if (line.kind === 'bus' || line.kind === 'truck' || !line.poly) continue;
      tmpC.set(line.color);
      if (line.kind === 'freight') {
        for (const c of line.vehicles) {
          const dir = c.dir;
          for (let k = 0; k < 4; k++) {
            line.poly.at(c.d - dir * k * 0.29, c.off, pos);
            const ang = pos.ang + (dir < 0 ? Math.PI : 0);
            if (k === 0) this.putLin(this.loco, pos.x, TRACK_Y + 0.05, pos.z, ang, tmpC);
            else {
              this.putLin(this.wagon, pos.x, TRACK_Y + 0.05, pos.z, ang, tmpC);
              const ld = c.load;
              if (ld && ld.qty > 0.5 && ld.qty > (k - 1) * c.cap / 3 * 0.9) { const col = new THREE.Color(CARGO_INFO[CARGO_LIST[ld.type]].color); this.putLin(this.wload, pos.x, TRACK_Y + 0.05, pos.z, ang, col); }
            }
          }
        }
        continue;
      }
      if (line.kind === 'tram') {
        for (const c of line.vehicles) {
          const dir = c.dir;
          for (let k = 0; k < 3; k++) {
            line.poly.at(c.d - dir * k * 0.207, c.off, pos);
            const ang = pos.ang + (dir < 0 ? Math.PI : 0);
            const tx = Math.floor(pos.x + HALF), ty = Math.floor(pos.z + HALF);
            const y = 0.0215 + (tx >= 0 && ty >= 0 && tx < N && ty < N && w.water[ty * N + tx] ? 0.022 : 0);
            if (k === 0) this.putLin(this.tramHead, pos.x, y, pos.z, ang, tmpC);
            else if (k === 2) this.putLin(this.tramHead, pos.x, y, pos.z, ang + Math.PI, tmpC);
            else this.putLin(this.tramMid, pos.x, y, pos.z, ang, tmpC);
          }
        }
        continue;
      }
      if (line.kind === 'ferry') {
        for (const c of line.vehicles) {
          line.poly.at(c.d, c.off, pos);
          const bob = Math.sin(time * 1.7 + c.id * 2.1) * 0.006;
          this.putLin(this.ferry, pos.x, WATER_LEVEL + 0.012 + bob, pos.z, pos.ang + (c.dir < 0 ? Math.PI : 0), tmpC);
        }
        continue;
      }
      if (line.kind === 'gondola') {
        for (const c of line.vehicles) {
          line.poly.at(c.d, c.off, pos);
          const y = cableY(line, c.d) - 0.152;
          this.putLin(this.cabin, pos.x, y + Math.sin(time * 1.3 + c.id) * 0.002, pos.z, pos.ang + (c.dir < 0 ? Math.PI : 0), tmpC);
        }
        continue;
      }
      for (const c of line.vehicles) {
        const dir = c.dir;
        const lateral = c.off;
        // cars trail behind the head in the direction of travel
        for (let k = 0; k < 3; k++) {
          const d = c.d - dir * k * 0.275;
          line.poly.at(d, lateral, pos);
          const ang = pos.ang + (dir < 0 ? Math.PI : 0);
          // the head car leads, the last car has its cab at the back
          if (k === 0) this.putLin(this.trainHead, pos.x, TRACK_Y + 0.055, pos.z, ang, tmpC);
          else if (k === 2) this.putLin(this.trainHead, pos.x, TRACK_Y + 0.055, pos.z, ang + Math.PI, tmpC);
          else this.putLin(this.trainMid, pos.x, TRACK_Y + 0.055, pos.z, ang, tmpC);
        }
      }
    }
    for (const p of [...this.cars, this.bus, this.trainHead, this.trainMid, this.tramHead, this.tramMid, this.ferry, this.cabin, this.truck, this.load, this.loco, this.wagon, this.wload]) {
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.tint.needsUpdate = true;
    }
  }

  private putLin(p: FPool, x: number, y: number, z: number, ang: number, c: THREE.Color, sy = 1, pitch = 0) {
    if (p.n >= p.cap) return;
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(0, -ang, pitch);
    tmpObj.scale.set(1, sy, 1);
    tmpObj.updateMatrix();
    p.mesh.setMatrixAt(p.n, tmpObj.matrix);
    // THREE.Color.set(hex) converts sRGB -> linear working space already
    p.tint.setXYZ(p.n, c.r, c.g, c.b);
    p.n++;
  }
}
