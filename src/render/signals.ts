// Traffic signal masts and lamps at controlled junctions. Poles are static; the bulbs change colour with the phase.
import * as THREE from 'three';
import { MeshBuilder, lin } from './gfx.ts';
import { N, DX, DY, tileIdx, wx, wz, type World } from '../sim/world.ts';
import type { Game } from '../sim/game.ts';

const POLE = lin(0x3b414d);
const HEAD = lin(0x20242c);
const RED = new THREE.Color(0xff3b30), GREEN = new THREE.Color(0x3ddc84), AMBER = new THREE.Color(0xffb020);
const MAX = 160;

export class SignalView {
  group = new THREE.Group();
  private poles: THREE.Mesh;
  private bulbs: THREE.InstancedMesh;
  private arms: { tile: number; axis: 0 | 1 }[] = [];
  private ver = -1;
  private last: number[] = [];

  constructor(scene: THREE.Scene, readonly game: Game) {
    this.poles = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
    this.poles.castShadow = true;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX);
    this.bulbs.count = 0;
    this.bulbs.frustumCulled = false;
    this.bulbs.setColorAt(0, RED);
    this.group.add(this.poles, this.bulbs);
    scene.add(this.group);
  }

  private rebuild() {
    const w: World = this.game.world;
    const b = new MeshBuilder();
    const m = new THREE.Matrix4();
    this.arms.length = 0;
    let n = 0;
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      const i = tileIdx(tx, ty);
      if (w.ctl[i] !== 1 || !w.surf(i) || w.degree(i) < 3) continue;
      for (let d = 0; d < 4; d++) {
        const ni = tileIdx(tx + DX[d], ty + DY[d]);
        if (tx + DX[d] < 0 || ty + DY[d] < 0 || tx + DX[d] >= N || ty + DY[d] >= N || !w.linked(i, ni)) continue;
        if (n >= MAX) continue;
        const ex = DX[d], ez = DY[d], px = -ez, pz = ex;
        const hw = w.road[i] === 2 || w.road[ni] === 2 ? 0.42 : 0.3;
        // mast on the kerb at the right of the approach, head over the lane
        const x = wx(tx) + ex * 0.47 - px * (hw + 0.045), z = wz(ty) + ez * 0.47 - pz * (hw + 0.045);
        b.cyl(x, 0.012, z, 0.008, 0.01, 0.15, POLE, 5);
        b.box(x, 0.15, z, 0.034, 0.075, 0.034, HEAD);
        m.makeTranslation(x - ex * 0.0, 0.2, z - ez * 0.0 + 0);
        // bulb sits on the face toward the approaching traffic
        m.makeTranslation(x + ex * 0.02, 0.188, z + ez * 0.02);
        this.bulbs.setMatrixAt(n, m);
        this.arms.push({ tile: i, axis: d % 2 === 0 ? 0 : 1 });
        n++;
      }
    }
    this.bulbs.count = n;
    this.bulbs.instanceMatrix.needsUpdate = true;
    this.poles.geometry.dispose();
    this.poles.geometry = b.count ? b.geometry() : new THREE.BufferGeometry();
    this.last = new Array(n).fill(-1);
    this.ver = w.version.roads;
  }

  update() {
    const w = this.game.world;
    if (this.ver !== w.version.roads) this.rebuild();
    for (let k = 0; k < this.arms.length; k++) {
      const a = this.arms[k];
      const st = this.game.traffic.sigState(a.tile, a.axis);
      if (this.last[k] === st) continue;
      this.last[k] = st;
      this.bulbs.setColorAt(k, st === 1 ? GREEN : st === 2 ? AMBER : RED);
      if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    }
  }
}
