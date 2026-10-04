// Planes: each flight comes in over the runway, taxis to a gate, waits, and takes off again.
import * as THREE from 'three';
import { MeshBuilder, patch, instAttr, tmpObj } from './gfx.ts';
import { addPlane, faceAngle, footCenter } from './buildings.ts';
import type { Game } from '../sim/game.ts';
import type { Particles } from './fx.ts';

// keyframes in the airport's own frame: x along the runway, z across, h heading in the x-z plane (unwrapped)
interface Key { t: number; x: number; y: number; z: number; h: number }
const PI = Math.PI;
function keys(gate: number): Key[] {
  const gx = [-0.55, 0.0, 0.55][gate % 3];
  return [
    { t: 0, x: 15, y: 6.2, z: -0.55, h: PI },
    { t: 8.4, x: 1.8, y: 0.42, z: -0.55, h: PI },
    { t: 9.4, x: 1.3, y: 0.03, z: -0.55, h: PI },
    { t: 12, x: -0.05, y: 0.03, z: -0.55, h: PI },
    { t: 13.4, x: -0.5, y: 0.03, z: -0.5, h: PI * 0.92 },
    { t: 14.6, x: gx - 0.0, y: 0.03, z: -0.3, h: PI * 0.5 + 0.04 },
    { t: 16.6, x: gx, y: 0.03, z: 0.32, h: PI * 0.5 },
    { t: 27, x: gx, y: 0.03, z: 0.32, h: PI * 0.5 },          // at the gate
    { t: 29, x: gx, y: 0.03, z: 0.16, h: PI * 0.5 },          // push back
    { t: 31, x: gx + 0.35, y: 0.03, z: 0.1, h: 0.2 },
    { t: 34, x: 1.15, y: 0.03, z: 0.1, h: 0 },
    { t: 35.8, x: 1.15, y: 0.03, z: -0.3, h: -PI * 0.5 },
    { t: 37, x: 1.18, y: 0.03, z: -0.55, h: -PI },
    { t: 38, x: 1.18, y: 0.03, z: -0.55, h: -PI },
    { t: 43, x: -0.7, y: 0.04, z: -0.55, h: -PI },
    { t: 44.5, x: -1.6, y: 0.35, z: -0.55, h: -PI },
    { t: 49, x: -8, y: 3.2, z: -0.55, h: -PI },
    { t: 54, x: -17, y: 7.5, z: -0.55, h: -PI },
  ];
}
const DURATION = 54;
const ease = (u: number) => u * u * (3 - 2 * u);

interface Plane { cx: number; cz: number; rot: number; gate: number; t0: number; color: THREE.Color; id: number }
const COLORS = [0xe05a4f, 0x3b82f6, 0xf2b84b, 0x2fa59a, 0x8b5cf6, 0x1d3b6e];

export class AirView {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private tint: THREE.InstancedBufferAttribute;
  private planes: Plane[] = [];
  private cap = 8;
  private trailT = 0;
  private seq = 0;

  constructor(scene: THREE.Scene, readonly game: Game, readonly fx: Particles) {
    const b = new MeshBuilder();
    addPlane(b, 0, 0, 0, 1.0, true);
    const geo = b.geometry();
    this.tint = instAttr(this.cap, 3, 1);
    geo.setAttribute('aTint', this.tint);
    this.mesh = new THREE.InstancedMesh(geo, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }), { paint: true }), this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    scene.add(this.group);
    game.on('flight', (e: { id: number }) => this.spawn(e.id));
  }

  spawn(buildingId: number) {
    const b = this.game.city.buildings.get(buildingId);
    if (!b || this.planes.filter((p) => p.id === buildingId).length >= 3) return;
    const c = footCenter(b);
    this.planes.push({ cx: c.x, cz: c.z, rot: b.rotFoot, gate: this.seq % 3, t0: this.game.t, color: new THREE.Color(COLORS[this.seq % COLORS.length]), id: buildingId });
    this.seq++;
  }

  update(dt: number) {
    const t = this.game.t;
    this.trailT -= dt;
    let n = 0;
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      const age = t - p.t0;
      if (age > DURATION) { this.planes.splice(i, 1); continue; }
      if (age < 0 || n >= this.cap) continue;
      const ks = keys(p.gate);
      let k = 1;
      while (k < ks.length - 1 && ks[k].t < age) k++;
      const a = ks[k - 1], bb = ks[k];
      const u = Math.min(1, Math.max(0, (age - a.t) / (bb.t - a.t)));
      const e = (a.y === bb.y && a.x === bb.x && a.z === bb.z) ? 0 : (bb.y > a.y + 0.2 || a.y > bb.y + 0.2 ? u : ease(u));
      const lx = a.x + (bb.x - a.x) * e, ly = a.y + (bb.y - a.y) * e, lz = a.z + (bb.z - a.z) * e, h = a.h + (bb.h - a.h) * e;
      const th = faceAngle(p.rot);
      const ct = Math.cos(th), st = Math.sin(th);
      const wx = p.cx + lx * ct + lz * st, wz = p.cz - lx * st + lz * ct;
      // nose follows the climb or descent
      const dy = bb.y - a.y, dx = Math.hypot(bb.x - a.x, bb.z - a.z) || 1;
      const pitch = Math.max(-0.35, Math.min(0.4, Math.atan2(dy, dx * 1.2))) * (ly > 0.1 ? 1 : 0);
      tmpObj.position.set(wx, 0.016 + ly, wz);
      tmpObj.rotation.set(0, th - h, pitch);
      tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix();
      this.mesh.setMatrixAt(n, tmpObj.matrix);
      this.tint.setXYZ(n, p.color.r, p.color.g, p.color.b);
      n++;
      // a faint trail while climbing and a puff of tyre smoke on touchdown
      if (this.trailT <= 0 && ly > 0.6 && age > 38) this.fx.puff(wx, 0.016 + ly, wz, { vx: 0, vz: 0, vy: 0.02, max: 1.6, s0: 0.1, s1: 0.4, c: [0.95, 0.96, 0.98], a: 0.28 });
      if (this.trailT <= 0 && age > 9 && age < 10.5) this.fx.puff(wx, 0.05, wz, { vx: 0, vz: 0, vy: 0.03, max: 1.2, s0: 0.12, s1: 0.4, c: [0.85, 0.85, 0.85], a: 0.4 });
    }
    if (this.trailT <= 0) this.trailT = 0.12;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }
}
