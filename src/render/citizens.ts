// The people you can see and pick: real citizens on foot, drivers, a marker over the one you follow.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj } from './gfx.ts';
import { HALF, N, tileIdx, tileX, tileY, wx, wz, inMap, DX, DY } from '../sim/world.ts';
import { decodeLook, SHIRT, moodColorHex } from '../sim/people.ts';
import type { Game } from '../sim/game.ts';
import type { Person, Building } from '../sim/types.ts';

export interface Dot { p: Person; x: number; z: number; ang: number; kind: 'walk' | 'car' | 'wait' }

const MAX_WALKERS = 420;

function personGeo() {
  const b = new MeshBuilder();
  b.paintW = 1;
  b.cyl(0, 0.014, 0, 0.0125, 0.0105, 0.036, lin(0xffffff), 6, { cap: false });
  b.paintW = 0;
  b.cyl(0, 0, 0, 0.007, 0.007, 0.016, lin(0x2d3340), 5, { cap: false });
  b.blob(0, 0.058, 0, 0.0115, 0.0125, 0.0115, lin(0xf0c8a0), 5, 3);
  return b.geometry();
}

export class CitizensView {
  group = new THREE.Group();
  dots: Dot[] = [];
  private pool: Dot[] = [];
  private mesh: THREE.InstancedMesh;
  private tint: THREE.InstancedBufferAttribute;
  private marker: THREE.Mesh;
  private markerMat: THREE.MeshStandardMaterial;
  private pathBudget = 0;
  /** extra height of a rider by vehicle kind; set by the view */
  carrierY: (p: Person) => number = () => 0.4;
  buildingH: (b: Building) => number = () => 0.5;

  constructor(scene: THREE.Scene, readonly game: Game) {
    const g = personGeo();
    this.tint = instAttr(MAX_WALKERS, 3, 1);
    g.setAttribute('aTint', this.tint);
    this.mesh = new THREE.InstancedMesh(g, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { paint: true }), MAX_WALKERS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.markerMat = new THREE.MeshStandardMaterial({ color: 0x4ade80, emissive: 0x4ade80, emissiveIntensity: 1.6, roughness: 0.3, transparent: true, opacity: 0.95 });
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), this.markerMat);
    this.marker.scale.set(0.8, 1.35, 0.8);
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    this.group.add(this.mesh, this.marker);
    scene.add(this.group);
  }

  // ------------------------------------------------------------ paths

  private nearRoad(x: number, z: number): number {
    const w = this.game.world;
    const tx = Math.floor(x + HALF), ty = Math.floor(z + HALF);
    if (inMap(tx, ty) && w.road[tileIdx(tx, ty)] && !w.water[tileIdx(tx, ty)]) return tileIdx(tx, ty);
    let best = -1, bd = 9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (!inMap(nx, ny)) continue;
      const i = tileIdx(nx, ny);
      if (!w.road[i] || w.water[i]) continue;
      const d = Math.hypot(wx(nx) - x, wz(ny) - z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** a polyline along the streets for a walking leg; computed lazily and cached on the walk */
  private ensurePath(p: Person) {
    const s = p.walk;
    if (!s || s.path) return;
    if (this.pathBudget <= 0) return;
    this.pathBudget--;
    const direct = [s.x0, s.z0, s.x1, s.z1];
    if (s.dur < 4) { s.path = direct; return; }
    const a = this.nearRoad(s.x0, s.z0), b = this.nearRoad(s.x1, s.z1);
    if (a < 0 || b < 0) { s.path = direct; return; }
    const tiles = a === b ? [a] : this.game.traffic.router.find(a, b);
    if (!tiles) { s.path = direct; return; }
    const pts: number[] = [s.x0, s.z0];
    for (const t of tiles) pts.push(wx(tileX(t)), wz(tileY(t)));
    pts.push(s.x1, s.z1);
    // keep to one side of the street
    const side = (p.id & 1 ? 1 : -1) * 0.32;
    const n = pts.length / 2;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let dx = pts[i1 * 2] - pts[i0 * 2], dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const edge = i === 0 || i === n - 1 ? 0 : 1;
      out.push(pts[i * 2] - dz * side * edge, pts[i * 2 + 1] + dx * side * edge);
    }
    s.path = out;
  }

  private along(p: Person, t: number, out: { x: number; z: number; ang: number }) {
    const s = p.walk!;
    const k = Math.min(1, Math.max(0, (t - s.t0) / s.dur));
    const path = s.path ?? [s.x0, s.z0, s.x1, s.z1];
    const n = path.length / 2;
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]);
    let want = total * k;
    for (let i = 1; i < n; i++) {
      const ax = path[i * 2 - 2], az = path[i * 2 - 1], bx = path[i * 2], bz = path[i * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (want <= l || i === n - 1) {
        const f = l > 1e-6 ? Math.min(1, want / l) : 0;
        out.x = ax + (bx - ax) * f; out.z = az + (bz - az) * f; out.ang = Math.atan2(bz - az, bx - ax);
        return;
      }
      want -= l;
    }
  }

  // ------------------------------------------------------------ frame

  private grab(i: number): Dot {
    let d = this.pool[i];
    if (!d) d = this.pool[i] = { p: null as unknown as Person, x: 0, z: 0, ang: 0, kind: 'walk' };
    return d;
  }

  update(dt: number, time: number, focus: Person | null, hide: number) {
    const g = this.game, t = g.t;
    this.pathBudget = 14;
    let n = 0, nw = 0;
    const tmp = { x: 0, z: 0, ang: 0 };
    const hideAbove = 1 - hide;
    for (const p of g.city.persons) {
      switch (p.phase) {
        case 'walkIn': case 'walkOut': case 'walk': {
          if (!p.walk) break;
          this.ensurePath(p);
          this.along(p, t, tmp);
          const d = this.grab(n++); d.p = p; d.x = tmp.x; d.z = tmp.z; d.ang = tmp.ang; d.kind = 'walk';
          // draw most walkers; thin them out in the dark and rain
          if (nw < MAX_WALKERS && (p.id % 100) / 100 < hideAbove + 0.25) {
            const look = decodeLook(p.look);
            const c = SHIRT[look.shirt];
            this.tint.setXYZ(nw, ((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
            tmpObj.position.set(d.x, 0.012 + Math.abs(Math.sin(time * 7 + p.id)) * 0.0025, d.z);
            tmpObj.rotation.set(0, -d.ang, 0);
            tmpObj.scale.setScalar(p === focus ? 2.6 : 1.7);
            tmpObj.updateMatrix();
            this.mesh.setMatrixAt(nw++, tmpObj.matrix);
          }
          break;
        }
        case 'drive': {
          if (!p.car || p.car.dead) break;
          const d = this.grab(n++); d.p = p; d.x = p.car.x; d.z = p.car.z; d.ang = p.car.ang; d.kind = 'car';
          break;
        }
        case 'wait': {
          if (!p.stopRef) break;
          const d = this.grab(n++); d.p = p; d.x = p.stopRef.x; d.z = p.stopRef.z; d.ang = 0; d.kind = 'wait';
          break;
        }
      }
    }
    this.dots.length = n;
    for (let i = 0; i < n; i++) this.dots[i] = this.pool[i];
    this.mesh.count = nw;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
    // marker over the followed or selected citizen
    if (focus && !focus.dead) {
      const w = this.where(focus);
      this.marker.visible = true;
      this.marker.position.set(w.x, w.y + 0.2 + Math.sin(time * 3) * 0.025, w.z);
      this.marker.rotation.y = time * 1.6;
      const col = new THREE.Color(moodColorHex(focus.mood));
      this.markerMat.color.copy(col); this.markerMat.emissive.copy(col);
    } else this.marker.visible = false;
    void dt;
  }

  /** where a person is and how high to put a marker over them */
  where(p: Person): { x: number; z: number; y: number; inside: boolean } {
    const pos = this.game.city.positionOf(p);
    let y = 0.14;
    if (pos.inside) { const b = p.at ?? p.home; y = this.buildingH(b) + 0.05; }
    else if (p.phase === 'ride') y = this.carrierY(p);
    else if (p.phase === 'drive') y = 0.3;
    return { x: pos.x, z: pos.z, y, inside: pos.inside };
  }

  /** nearest outdoor citizen to a ground point */
  pick(x: number, z: number, r: number): Person | null {
    let best: Person | null = null, bd = r * r;
    for (const d of this.dots) {
      const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (dd < bd) { bd = dd; best = d.p; }
    }
    return best;
  }
}
void N; void DX; void DY;
