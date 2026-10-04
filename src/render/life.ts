// Ambient life: boats on the river, a flock of birds.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj } from './gfx.ts';
import { mulberry32 } from '../sim/util.ts';
import { WATER_LEVEL, type World } from '../sim/world.ts';

function boatGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.box(0, 0, 0, 0.36, 0.05, 0.12, lin(0xffffff));
  b.box(0.17, 0, 0, 0.06, 0.05, 0.09, lin(0xffffff));
  b.paintW = 0;
  b.box(-0.02, 0.05, 0, 0.14, 0.05, 0.08, lin(0xf4f1ea));
  b.box(-0.02, 0.1, 0, 0.16, 0.012, 0.1, lin(0xd9d4c8));
  b.cyl(0.03, 0.05, 0, 0.004, 0.003, 0.2, lin(0x8b7b66), 5);
  return b.geometry();
}
function birdGeo() {
  const b = new MeshBuilder();
  b.paintW = 0;
  const c = lin(0xf6f6f2);
  const l = b.vert(0, 0, -0.14, 0, 1, 0, c), m = b.vert(0.05, 0.0, 0, 0, 1, 0, c), r = b.vert(0, 0, 0.14, 0, 1, 0, c), t = b.vert(-0.04, 0.0, 0, 0, 1, 0, c);
  b.tri(l, m, t); b.tri(m, r, t);
  b.tri(l, t, m); b.tri(m, t, r);
  return b.geometry();
}

export class Life {
  group = new THREE.Group();
  private boats: THREE.InstancedMesh;
  private boatTint: THREE.InstancedBufferAttribute;
  private birds: THREE.InstancedMesh;
  private river: [number, number][];
  private boatState: { u: number; dir: number; speed: number; off: number }[] = [];
  private birdState: { cx: number; cz: number; r: number; a: number; w: number; h: number; ph: number }[] = [];
  private poly: { x: number; z: number; cum: number }[] = [];
  private len = 0;

  constructor(scene: THREE.Scene, readonly world: World) {
    const rnd = mulberry32(world.seed + 41);
    this.river = world.terrain.rivers[0].pts;
    let c = 0;
    for (let i = 0; i < this.river.length; i++) {
      if (i) c += Math.hypot(this.river[i][0] - this.river[i - 1][0], this.river[i][1] - this.river[i - 1][1]);
      this.poly.push({ x: this.river[i][0], z: this.river[i][1], cum: c });
    }
    this.len = c;
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), { paint: true });
    const g = boatGeo();
    this.boatTint = instAttr(8, 3, 1);
    g.setAttribute('aTint', this.boatTint);
    this.boats = new THREE.InstancedMesh(g, mat, 8);
    this.boats.castShadow = true;
    this.boats.frustumCulled = false;
    const cols = [0xe05a4f, 0x3b82f6, 0xf2b84b, 0x2fa59a, 0xffffff, 0x8b5cf6, 0xe88aa6, 0x6ec86a];
    for (let i = 0; i < 8; i++) {
      this.boatState.push({ u: rnd() * this.len, dir: rnd() < 0.5 ? 1 : -1, speed: 0.35 + rnd() * 0.35, off: (rnd() - 0.5) * 0.7 });
      const k = new THREE.Color(cols[i]);
      this.boatTint.setXYZ(i, k.r, k.g, k.b);
    }
    this.boatTint.needsUpdate = true;
    const bm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const bg = birdGeo();
    this.birds = new THREE.InstancedMesh(bg, bm, 16);
    this.birds.frustumCulled = false;
    for (let i = 0; i < 16; i++) this.birdState.push({ cx: (rnd() - 0.5) * 20, cz: (rnd() - 0.5) * 20, r: 8 + rnd() * 18, a: rnd() * 6.28, w: (0.12 + rnd() * 0.12) * (rnd() < 0.5 ? 1 : -1), h: 5 + rnd() * 5, ph: rnd() * 6 });
    this.group.add(this.boats, this.birds);
    scene.add(this.group);
  }

  private at(u: number, off: number) {
    // clamp to the river and find the point
    const L = this.len;
    u = ((u % (2 * L)) + 2 * L) % (2 * L);
    if (u > L) u = 2 * L - u;
    let i = 1;
    while (i < this.poly.length - 1 && this.poly[i].cum < u) i++;
    const a = this.poly[i - 1], b = this.poly[i];
    const t = (u - a.cum) / Math.max(1e-6, b.cum - a.cum);
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: a.x + dx * t - (dz / l) * off, z: a.z + dz * t + (dx / l) * off, ang: Math.atan2(dz, dx) };
  }

  update(dt: number, time: number) {
    for (let i = 0; i < this.boatState.length; i++) {
      const s = this.boatState[i];
      s.u += s.dir * s.speed * dt;
      const p = this.at(s.u, s.off);
      const dirAng = p.ang + (s.dir < 0 ? Math.PI : 0);
      // only draw boats inside the visible island
      const inside = Math.abs(p.x) < 52 && Math.abs(p.z) < 52;
      tmpObj.position.set(p.x, WATER_LEVEL + 0.02 + Math.sin(time * 1.3 + i) * 0.006, p.z);
      tmpObj.rotation.set(Math.sin(time * 1.1 + i * 2) * 0.03, -dirAng, Math.sin(time * 0.9 + i) * 0.02);
      tmpObj.scale.setScalar(inside ? 1 : 0.0001);
      tmpObj.updateMatrix();
      this.boats.setMatrixAt(i, tmpObj.matrix);
    }
    this.boats.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.birdState.length; i++) {
      const s = this.birdState[i];
      s.a += s.w * dt;
      const x = s.cx + Math.cos(s.a) * s.r, z = s.cz + Math.sin(s.a) * s.r;
      tmpObj.position.set(x, s.h + Math.sin(time * 0.7 + s.ph) * 0.4, z);
      const heading = Math.atan2(Math.cos(s.a) * s.w, -Math.sin(s.a) * s.w);
      tmpObj.rotation.set(0, -heading + Math.PI / 2, 0);
      const flap = 0.5 + 0.5 * Math.sin(time * 9 + s.ph * 3);
      tmpObj.scale.set(1, 0.4 + flap * 1.2, 1);
      tmpObj.updateMatrix();
      this.birds.setMatrixAt(i, tmpObj.matrix);
    }
    this.birds.instanceMatrix.needsUpdate = true;
  }

  setNight(n: number) { this.birds.visible = n < 0.5; }
}
