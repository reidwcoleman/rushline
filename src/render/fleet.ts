// Cars, buses and trains as instanced meshes (paint colour per instance, lit windows and lamps at night).
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj } from './gfx.ts';
import type { Traffic } from '../sim/traffic.ts';
import type { Transit } from '../sim/transit.ts';
import type { World } from '../sim/world.ts';

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

interface FPool { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; n: number; cap: number }

export class Fleet {
  group = new THREE.Group();
  private cars: FPool[] = [];
  private bus: FPool;
  private trainHead: FPool;
  private trainMid: FPool;
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

  update(traffic: Traffic, transit: Transit, accidents: Iterable<number> = []) {
    const w = this.world;
    for (const c of this.cars) c.n = 0;
    this.bus.n = 0; this.trainHead.n = 0; this.trainMid.n = 0;
    const tmpC = new THREE.Color();
    for (const v of traffic.vehicles) {
      if (v.dead) continue;
      const tile = v.path[v.i];
      const y = w.water[tile] ? 0.04 : 0.016;
      if (v.kind === 0) {
        tmpC.set(v.color);
        const c = v.color;
        // paint colours are authored in sRGB; convert once for the linear pipeline
        tmpC.set(c);
        this.putLin(this.cars[v.shape % 3], v.x, y, v.z, v.ang, tmpC);
      } else {
        tmpC.set(v.color);
        this.putLin(this.bus, v.x, y, v.z, v.ang, tmpC);
      }
    }
    for (const t of accidents) {
      const x = ((t % 40) - 20 + 0.5), z = (Math.floor(t / 40) - 20 + 0.5);
      const h = ((t * 2654435761) >>> 0) / 4294967296;
      tmpC.set(0xd64545); this.putLin(this.cars[0], x - 0.1, 0.016, z + 0.06, 0.6 + h, tmpC);
      tmpC.set(0x3b82f6); this.putLin(this.cars[1], x + 0.13, 0.016, z - 0.07, -0.8 + h * 0.6, tmpC);
    }
    const pos = { x: 0, z: 0, ang: 0 };
    for (const line of transit.lines) {
      if (line.kind !== 'metro' || !line.poly) continue;
      tmpC.set(line.color);
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
    for (const p of [...this.cars, this.bus, this.trainHead, this.trainMid]) {
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.tint.needsUpdate = true;
    }
  }

  private putLin(p: FPool, x: number, y: number, z: number, ang: number, c: THREE.Color) {
    if (p.n >= p.cap) return;
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(0, -ang, 0);
    tmpObj.scale.setScalar(1);
    tmpObj.updateMatrix();
    p.mesh.setMatrixAt(p.n, tmpObj.matrix);
    // THREE.Color.set(hex) converts sRGB -> linear working space already
    p.tint.setXYZ(p.n, c.r, c.g, c.b);
    p.n++;
  }
}
