// Ambient life: boats on the river, a flock of birds.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj } from './gfx.ts';
import { mulberry32 } from '../sim/util.ts';
import { WATER_LEVEL, N, tileIdx, tileX, tileY, wx, wz, inMap, type World } from '../sim/world.ts';

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

function walkerGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.cyl(0, 0.014, 0, 0.0125, 0.0105, 0.036, lin(0xffffff), 6, { cap: false });
  b.paintW = 0;
  b.cyl(0, 0, 0, 0.007, 0.007, 0.016, lin(0x2d3340), 5, { cap: false });   // legs
  b.blob(0, 0.058, 0, 0.0115, 0.0125, 0.0115, lin(0xf0c8a0), 5, 3);       // head
  return b.geometry();
}
interface Walker { tile: number; axis: number; dir: number; u: number; side: number; speed: number; ph: number }

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
  private walkers: Walker[] = [];
  private walkMesh: THREE.InstancedMesh;
  private walkTint: THREE.InstancedBufferAttribute;
  private walkWant = 0;
  private roadTiles: number[] = [];
  private roadVer = -1;
  private wrnd: () => number;

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
    this.wrnd = mulberry32(world.seed + 77);
    const WG = walkerGeo();
    this.walkTint = instAttr(320, 3, 1);
    WG.setAttribute('aTint', this.walkTint);
    this.walkMesh = new THREE.InstancedMesh(WG, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { paint: true }), 320);
    this.walkMesh.count = 0;
    this.walkMesh.frustumCulled = false;
    this.walkMesh.castShadow = true;
    const cols2 = [0xe65f5c, 0x4f8fdb, 0xf2b84b, 0x58b88a, 0x9c6fdb, 0xe87bb1, 0xf08a46, 0x45b5c4, 0x8bc34a, 0xd96a6a, 0x6c7ae0, 0xc9a45a, 0xf2f2ee, 0x3d4350];
    for (let i = 0; i < 320; i++) { const k = new THREE.Color(cols2[i % cols2.length]); this.walkTint.setXYZ(i, k.r, k.g, k.b); }
    this.walkTint.needsUpdate = true;
    this.group.add(this.boats, this.birds, this.walkMesh);
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
    this.stepWalkers(dt, time);
  }

  setNight(n: number) { this.birds.visible = n < 0.5; }

  setWalkers(n: number) { this.walkWant = Math.max(0, Math.round(n)); }

  private spawnWalker(): Walker | null {
    const w = this.world;
    if (this.roadVer !== w.version.roads) {
      this.roadVer = w.version.roads;
      this.roadTiles = [];
      for (let i = 0; i < N * N; i++) if (w.road[i] && !w.water[i]) this.roadTiles.push(i);
    }
    if (!this.roadTiles.length) return null;
    for (let k = 0; k < 12; k++) {
      const t = this.roadTiles[Math.floor(this.wrnd() * this.roadTiles.length)];
      const x = tileX(t), y = tileY(t);
      const h = (inMap(x - 1, y) && w.road[tileIdx(x - 1, y)] > 0) || (inMap(x + 1, y) && w.road[tileIdx(x + 1, y)] > 0);
      const v = (inMap(x, y - 1) && w.road[tileIdx(x, y - 1)] > 0) || (inMap(x, y + 1) && w.road[tileIdx(x, y + 1)] > 0);
      if (!h && !v) continue;
      const axis = h && (!v || this.wrnd() < 0.5) ? 0 : 1;
      return { tile: t, axis, dir: this.wrnd() < 0.5 ? 1 : -1, u: this.wrnd() - 0.5, side: (this.wrnd() < 0.5 ? -1 : 1) * (0.42 + this.wrnd() * 0.04), speed: 0.1 + this.wrnd() * 0.07, ph: this.wrnd() * 6.28 };
    }
    return null;
  }

  private stepWalkers(dt: number, time: number) {
    const w = this.world;
    while (this.walkers.length < Math.min(this.walkWant, 320)) { const s = this.spawnWalker(); if (!s) break; this.walkers.push(s); }
    if (this.walkers.length > this.walkWant) this.walkers.length = this.walkWant;
    let n = 0;
    for (const s of this.walkers) {
      if (!w.road[s.tile]) { const r = this.spawnWalker(); if (r) Object.assign(s, r); continue; }
      s.u += s.dir * s.speed * dt;
      if (Math.abs(s.u) > 0.5) {
        const x = tileX(s.tile) + (s.axis === 0 ? s.dir : 0), y = tileY(s.tile) + (s.axis === 1 ? s.dir : 0);
        const nt = inMap(x, y) ? tileIdx(x, y) : -1;
        if (nt >= 0 && w.road[nt] && !w.water[nt]) { s.tile = nt; s.u -= s.dir; }
        else { s.dir = -s.dir; s.u = s.dir > 0 ? -0.49 : 0.49; }
      }
      const cx = wx(tileX(s.tile)), cz = wz(tileY(s.tile));
      const px = cx + (s.axis === 0 ? s.u : s.side), pz = cz + (s.axis === 0 ? s.side : s.u);
      const heading = s.axis === 0 ? (s.dir > 0 ? 0 : Math.PI) : (s.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      tmpObj.position.set(px, 0.012 + Math.abs(Math.sin(time * 7 + s.ph)) * 0.0025, pz);
      tmpObj.rotation.set(0, -heading, 0);
      tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix();
      this.walkMesh.setMatrixAt(n++, tmpObj.matrix);
    }
    this.walkMesh.count = n;
    this.walkMesh.instanceMatrix.needsUpdate = true;
  }
}
