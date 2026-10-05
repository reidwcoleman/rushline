// Foliage, street lamps and their light pools.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, instAttr, tmpObj, U } from './gfx.ts';
import { mulberry32 } from '../sim/util.ts';
import { World, N, HALF, SC, tileIdx, wx, wz, WATER_LEVEL, DX, DY, inMap } from '../sim/world.ts';

function pineGeo() {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.cyl(0, 0, 0, 0.014, 0.012, 0.06, lin(0x6e4f35), 5, { cap: false });
  b.paintW = 1;
  const g = lin(0x3f8f56);
  b.cyl(0, 0.035, 0, 0.1, 0.0, 0.13, g, 7, { cap: false });
  b.cyl(0, 0.095, 0, 0.078, 0.0, 0.12, lin(0x4a9a5b), 7, { cap: false });
  b.cyl(0, 0.15, 0, 0.055, 0.0, 0.11, lin(0x57a864), 7, { cap: false });
  return b.geometry();
}
function roundGeo(variant: number) {
  const b = new MeshBuilder();
  const r = mulberry32(variant * 31 + 5);
  b.paintW = 0;
  b.cyl(0, 0, 0, 0.016, 0.013, 0.1, lin(0x7a5a3c), 5, { cap: false });
  b.paintW = 1;
  const cols = [lin(0x62b257), lin(0x78c25a), lin(0x56a653)];
  b.blob(0, 0.14, 0, 0.1, 0.095, 0.1, cols[0], 7, 5, 0.22, r);
  b.blob(0.05, 0.19, 0.02, 0.065, 0.065, 0.065, cols[1], 6, 4, 0.2, r);
  b.blob(-0.045, 0.12, -0.04, 0.06, 0.06, 0.06, cols[2], 6, 4, 0.2, r);
  return b.geometry();
}
function rockGeo() {
  const b = new MeshBuilder();
  const r = mulberry32(99);
  b.paintW = 1;
  b.blob(0, 0.03, 0, 0.1, 0.07, 0.085, lin(0x9a9a92), 6, 4, 0.5, r);
  b.blob(0.07, 0.02, 0.03, 0.06, 0.045, 0.05, lin(0xa8a79d), 5, 3, 0.4, r);
  return b.geometry();
}
function lampGeo() {
  const b = new MeshBuilder();
  b.paintW = 0;
  b.cyl(0, 0, 0, 0.006, 0.005, 0.15, lin(0x3b4350), 5, { cap: false });
  b.box(0.022, 0.146, 0, 0.05, 0.006, 0.008, lin(0x3b4350));
  b.emitV = 5;
  b.box(0.045, 0.138, 0, 0.026, 0.008, 0.016, lin(0xfff0c8), { emit: 5 });
  b.emitV = 0;
  return b.geometry();
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  for (let i = 0; i <= 10; i++) { const t = i / 10; gr.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, 2.4).toFixed(3)})`); }
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Pool { mesh: THREE.InstancedMesh; tint: THREE.InstancedBufferAttribute; n: number; cap: number }

export class Props {
  group = new THREE.Group();
  private pine!: Pool;
  private round: Pool[] = [];
  private rock!: Pool;
  private tileTrees = new Map<number, { pool: Pool; slot: number; m: THREE.Matrix4 }[]>();
  private lamps!: Pool;
  private pools!: THREE.InstancedMesh;
  private poolMat: THREE.MeshBasicMaterial;
  private lampPos: { x: number; z: number }[] = [];

  constructor(readonly world: World, scene: THREE.Scene) {
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), { paint: true, sway: true, cloud: true });
    const mk = (geo: THREE.BufferGeometry, cap: number, shadow = true, m = mat): Pool => {
      const mesh = new THREE.InstancedMesh(geo, m, cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      const tint = instAttr(cap, 3, 1);
      geo.setAttribute('aTint', tint);
      this.group.add(mesh);
      return { mesh, tint, n: 0, cap };
    };
    this.pine = mk(pineGeo(), 6000);
    for (let i = 0; i < 3; i++) this.round.push(mk(roundGeo(i), 3000));
    this.rock = mk(rockGeo(), 400, false);
    const lampMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }), { paint: true, emit: true });
    this.lamps = mk(lampGeo(), 1400, true, lampMat);
    this.poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color(1.0, 0.78, 0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), this.poolMat, 1400);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 3;
    this.group.add(this.pools);
    scene.add(this.group);
    this.scatter();
    this.refreshLamps();
  }

  private place(p: Pool, x: number, y: number, z: number, s: number, rot: number, tint: [number, number, number], rec?: number) {
    if (p.n >= p.cap) return -1;
    tmpObj.position.set(x, y, z);
    tmpObj.rotation.set(0, rot, 0);
    tmpObj.scale.setScalar(s);
    tmpObj.updateMatrix();
    const slot = p.n++;
    p.mesh.setMatrixAt(slot, tmpObj.matrix);
    p.tint.setXYZ(slot, tint[0], tint[1], tint[2]);
    p.mesh.count = p.n;
    void rec;
    return slot;
  }

  /** trees on undeveloped tiles plus forests and rocks on the surrounding land */
  private scatter() {
    const w = this.world, t = w.terrain;
    const r = mulberry32(w.seed * 13 + 1);
    const pick = (): Pool => (r() < 0.5 ? this.pine : this.round[(r() * 3) | 0]);
    const tintOf = (): [number, number, number] => { const k = 0.82 + r() * 0.3; return [k * (0.96 + r() * 0.08), k, k * (0.92 + r() * 0.1)]; };
    // inside the play area
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (!w.tree[i] || w.water[i]) continue;
      const n = 1 + (r() < 0.55 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
      const list: { pool: Pool; slot: number; m: THREE.Matrix4 }[] = [];
      for (let k = 0; k < n; k++) {
        const p = pick();
        const px = wx(x) + (r() - 0.5) * 0.7, pz = wz(y) + (r() - 0.5) * 0.7;
        const s = 0.9 + r() * 0.7;
        const slot = this.place(p, px, 0.012, pz, s, r() * 6.28, tintOf());
        if (slot >= 0) { const m = new THREE.Matrix4(); p.mesh.getMatrixAt(slot, m); list.push({ pool: p, slot, m }); }
      }
      this.tileTrees.set(i, list);
    }
    // outside: poisson-ish jitter grid
    for (let gz = -EXT_T; gz <= EXT_T; gz += 0.8) for (let gx = -EXT_T; gx <= EXT_T; gx += 0.8) {
      const x = gx + (r() - 0.5) * 0.7, z = gz + (r() - 0.5) * 0.7;
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 0.2) continue;
      const h = t.height(x, z);
      if (h < WATER_LEVEL + 0.28) continue;
      const f = t.noise.fbm(x * 0.11 + 30, z * 0.11, 3) * 0.5 + 0.5;
      const dens = Math.max(0, (f - 0.38) * 2.2) + (h > 1.0 ? 0.35 : 0);
      if (r() > dens) continue;
      if (h > 4.4 && r() < 0.7) continue;
      const rockly = h > 3.4 && r() < 0.35;
      if (rockly) { this.place(this.rock, x, h, z, 0.8 + r() * 1.2, r() * 6.28, [0.9 + r() * 0.2, 0.9 + r() * 0.2, 0.9 + r() * 0.2]); continue; }
      const p = h > 2.2 ? this.pine : pick();
      this.place(p, x, h - 0.01, z, 1.0 + r() * 0.9, r() * 6.28, tintOf());
    }
    for (const p of [this.pine, this.rock, ...this.round]) { p.mesh.instanceMatrix.needsUpdate = true; p.tint.needsUpdate = true; }
  }

  /** hide the trees on tiles that now hold a road, building or park */
  refreshTrees() {
    const w = this.world;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [i, list] of this.tileTrees) {
      if (w.tree[i]) continue;
      for (const t of list) { t.pool.mesh.setMatrixAt(t.slot, zero); t.pool.mesh.instanceMatrix.needsUpdate = true; }
      this.tileTrees.delete(i);
    }
  }

  refreshLamps() {
    const w = this.world;
    const l = this.lamps;
    l.n = 0;
    l.mesh.count = 0;
    let np = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (!w.surf(i)) continue;
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if ((h % 100) > 52) continue;
      const cx = ((h >> 3) & 1) ? 1 : -1, cz = ((h >> 4) & 1) ? 1 : -1;
      const px = wx(x) + cx * 0.4, pz = wz(y) + cz * 0.4;
      // face the arm toward the road centre
      const rot = Math.atan2(-cz, cx) + Math.PI; // head points toward the tile centre
      const y0 = w.water[i] ? 0.03 : 0.012;
      const slot = this.place(l, px, y0, pz, 1, Math.atan2(cz, -cx), [1, 1, 1]);
      void rot;
      if (slot >= 0) {
        tmpObj.position.set(px - cx * 0.18, 0.026, pz - cz * 0.18);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.setScalar(1);
        tmpObj.updateMatrix();
        this.pools.setMatrixAt(np++, tmpObj.matrix);
      }
    }
    this.pools.count = np;
    this.pools.instanceMatrix.needsUpdate = true;
    l.mesh.instanceMatrix.needsUpdate = true;
    l.tint.needsUpdate = true;
  }

  update() {
    this.poolMat.opacity = Math.min(0.42, U.uNight.value * 0.42 + U.uDusk.value * 0.08);
    this.pools.visible = this.poolMat.opacity > 0.01;
  }
}

const EXT_T = 52 * SC;
