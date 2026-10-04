// City parks: lawns with paths, a centrepiece and trees, merged into one mesh.
import * as THREE from 'three';
import { MeshBuilder, patch, lin, shade3, mix3 } from './gfx.ts';
import { mulberry32 } from '../sim/util.ts';
import { N, tileIdx, wx, wz, type World } from '../sim/world.ts';

const LAWN_A = lin(0x78c25c), LAWN_B = lin(0x6bb552);
const PATH = lin(0xe7dcc2);
const STONE = lin(0xb9bcc0);
const WATER = lin(0x62c6e6);
const WOOD = lin(0x8a6a4a);
const TRUNK = lin(0x7a5a3c);
const LEAVES = [lin(0x4f9f55), lin(0x62b257), lin(0x78c25a), lin(0xe9a23b), lin(0xd9667a)];

export class ParksView {
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, readonly world: World) {
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), { cloud: true });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.rebuild();
  }

  rebuild() {
    const w = this.world;
    const b = new MeshBuilder();
    b.paintW = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (!w.park[i]) continue;
      const cx = wx(x), cz = wz(y);
      const r = mulberry32(i * 977 + 13);
      const variant = (x * 7 + y * 3) % 4;
      // lawn with mowing stripes
      for (let k = 0; k < 4; k++) b.floor(cx - 0.36 + k * 0.24, 0.0165, cz, 0.24, 0.96, k % 2 ? LAWN_A : LAWN_B);
      // paths
      const diag = r() < 0.5;
      if (diag) { b.floor(cx, 0.018, cz, 0.09, 1.05, PATH, Math.PI / 4); b.floor(cx, 0.018, cz, 0.09, 1.05, PATH, -Math.PI / 4); }
      else { b.floor(cx, 0.018, cz, 0.09, 0.96, PATH); b.floor(cx, 0.018, cz, 0.96, 0.09, PATH); }
      b.cyl(cx, 0.016, cz, 0.17, 0.17, 0.004, PATH, 16, { cap: true });
      if (variant === 0) {
        b.cyl(cx, 0.02, cz, 0.12, 0.12, 0.05, STONE, 14);
        b.cyl(cx, 0.065, cz, 0.1, 0.1, 0.005, WATER, 14);
        b.cyl(cx, 0.07, cz, 0.012, 0.004, 0.13, lin(0xdff6ff), 6);
        b.emitV = 0;
      } else if (variant === 1) {
        // gazebo
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.cyl(cx + Math.cos(a) * 0.09, 0.02, cz + Math.sin(a) * 0.09, 0.008, 0.008, 0.12, lin(0xf0ece2), 5, { cap: false }); }
        b.cyl(cx, 0.14, cz, 0.13, 0.01, 0.07, lin(0xc9694a), 6, { cap: false });
      } else if (variant === 2) {
        // play area
        b.box(cx - 0.05, 0.02, cz, 0.12, 0.1, 0.1, lin(0xe05a4f));
        b.box(cx + 0.09, 0.02, cz + 0.03, 0.05, 0.05, 0.12, lin(0x3b82f6));
        b.box(cx + 0.03, 0.12, cz, 0.18, 0.012, 0.012, lin(0xf2b84b));
        b.floor(cx, 0.019, cz, 0.38, 0.38, lin(0xf0d9a0));
      } else {
        // pond with a duck-yellow dot
        b.cyl(cx, 0.019, cz, 0.15, 0.15, 0.004, lin(0x4aa7c9), 16);
        b.blob(cx + 0.05, 0.03, cz - 0.03, 0.02, 0.012, 0.02, lin(0xffd95a), 5, 3);
      }
      // trees around the edge
      const n = 4 + ((r() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const a = r() * 6.28, rr = 0.3 + r() * 0.14;
        const tx = cx + Math.cos(a) * rr, tz = cz + Math.sin(a) * rr;
        if (Math.abs(tx - cx) < 0.07 || Math.abs(tz - cz) < 0.07) continue;
        const s = 0.9 + r() * 0.6;
        b.cyl(tx, 0.016, tz, 0.012 * s, 0.01 * s, 0.07 * s, TRUNK, 5, { cap: false });
        b.blob(tx, 0.016 + 0.11 * s, tz, 0.07 * s, 0.075 * s, 0.07 * s, LEAVES[(r() * (r() < 0.2 ? 5 : 3)) | 0], 6, 4, 0.2, r);
      }
      // benches
      for (let k = 0; k < 2; k++) {
        const a = (k * 2 + 1) * Math.PI / 2 + (diag ? Math.PI / 4 : 0);
        b.box(cx + Math.cos(a) * 0.24, 0.02, cz + Math.sin(a) * 0.24, 0.07, 0.03, 0.025, WOOD);
      }
      // hedge border facing roads handled by the sidewalk; a low low-poly hedge ring
      void mix3; void shade3;
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.count ? b.geometry() : new THREE.BufferGeometry();
  }
}
