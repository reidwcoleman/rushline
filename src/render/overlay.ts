// Interaction overlays: tile cursors, route ribbons, catchment rings, accident beacons.
import * as THREE from 'three';
import { U, tmpObj, GLSL } from './gfx.ts';
import { wx, wz, tileX, tileY, type World } from '../sim/world.ts';

function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = 20;
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
  };
  rr(6, 6, 116, 116, r);
  g.fillStyle = 'rgba(255,255,255,0.32)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const OK = new THREE.Color(0x4ade80), BAD = new THREE.Color(0xff5a5a), INFO = new THREE.Color(0x60a5fa), GOLD = new THREE.Color(0xffc54d);

export type CursorStyle = 'ok' | 'bad' | 'info' | 'gold';

interface Ribbon { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }

export class Overlay {
  group = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private tileMat: THREE.MeshBasicMaterial;
  private ribbons = new Map<string, Ribbon>();
  private rings: THREE.InstancedMesh;
  private ringMat: THREE.ShaderMaterial;
  private beacons: THREE.InstancedMesh;
  private beaconMat: THREE.ShaderMaterial;
  private ringData: { x: number; z: number; r: number; c: THREE.Color; a: number; pulse: number }[] = [];
  private beaconData: { x: number; z: number; c: THREE.Color }[] = [];

  constructor(scene: THREE.Scene, readonly world: World) {
    this.tileMat = new THREE.MeshBasicMaterial({ map: tileTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2), this.tileMat, 260);
    this.tiles.count = 0;
    this.tiles.frustumCulled = false;
    this.tiles.renderOrder = 8;
    this.tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(260 * 3), 3);
    this.group.add(this.tiles);

    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      uniforms: { uTime: U.uTime },
      vertexShader: /* glsl */ `attribute vec4 aRing; attribute vec3 aCol; varying vec2 vP; varying vec4 vR; varying vec3 vC;
        void main(){ vP = position.xz; vR = aRing; vC = aCol; vec3 p = position * aRing.z; p.y += 0.05; vec4 wp = instanceMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp; }`,
      fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vP; varying vec4 vR; varying vec3 vC;
        void main(){ float d = length(vP); if (d > 1.0) discard;
          float edge = smoothstep(0.93, 1.0, d) * smoothstep(1.0, 0.97, d + 0.0);
          float ring = smoothstep(0.9, 0.97, d) * (1.0 - smoothstep(0.97, 1.0, d));
          float pulse = 0.5 + 0.5 * sin(uTime * 3.0 * vR.w);
          float a = ring * (0.75 + 0.25 * pulse) + (1.0 - d) * 0.07 * vR.y;
          a *= vR.x;
          gl_FragColor = vec4(vC, a); }`,
    });
    const rg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(rg, this.ringMat, 128);
    rg.setAttribute('aRing', new THREE.InstancedBufferAttribute(new Float32Array(128 * 4), 4));
    rg.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(128 * 3), 3));
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 7;
    this.group.add(this.rings);

    this.beaconMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime },
      vertexShader: /* glsl */ `attribute vec3 aCol; varying vec3 vC; varying float vH; void main(){ vC = aCol; vH = position.y; vec4 wp = instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp; }`,
      fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vC; varying float vH;
        void main(){ float f = 0.6 + 0.4 * sin(uTime * 9.0); gl_FragColor = vec4(vC * (1.0 - vH) * 1.2, (1.0 - vH) * 0.55 * f); }`,
    });
    const bg = new THREE.CylinderGeometry(0.14, 0.2, 1, 12, 1, true).translate(0, 0.5, 0);
    bg.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3));
    this.beacons = new THREE.InstancedMesh(bg, this.beaconMat, 32);
    this.beacons.count = 0;
    this.beacons.frustumCulled = false;
    this.beacons.renderOrder = 9;
    this.group.add(this.beacons);
    scene.add(this.group);
  }

  // ------------------------------------------------------------ cursors

  setCursors(list: { tile: number; style: CursorStyle }[]) {
    const n = Math.min(list.length, 260);
    for (let i = 0; i < n; i++) {
      const { tile, style } = list[i];
      const y = this.world.water[tile] && this.world.road[tile] ? 0.075 : 0.045;
      tmpObj.position.set(wx(tileX(tile)), y, wz(tileY(tile)));
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix();
      this.tiles.setMatrixAt(i, tmpObj.matrix);
      const c = style === 'ok' ? OK : style === 'bad' ? BAD : style === 'gold' ? GOLD : INFO;
      this.tiles.setColorAt(i, c);
    }
    this.tiles.count = n;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------ rings (catchment, warnings)

  clearRings() { this.ringData.length = 0; }
  addRing(x: number, z: number, r: number, color: number, alpha = 1, fill = 1, pulse = 0) {
    this.ringData.push({ x, z, r, c: new THREE.Color(color), a: alpha, pulse: pulse * 1 + fill * 0 });
    (this.ringData[this.ringData.length - 1] as any).fill = fill;
  }
  flushRings() {
    const n = Math.min(this.ringData.length, 128);
    const ar = this.rings.geometry.getAttribute('aRing') as THREE.InstancedBufferAttribute;
    const ac = this.rings.geometry.getAttribute('aCol') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < n; i++) {
      const d = this.ringData[i] as any;
      tmpObj.position.set(d.x, 0, d.z);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.setScalar(1);
      tmpObj.updateMatrix();
      this.rings.setMatrixAt(i, tmpObj.matrix);
      ar.setXYZW(i, d.a, d.fill, d.r, d.pulse);
      ac.setXYZ(i, d.c.r, d.c.g, d.c.b);
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    ar.needsUpdate = true; ac.needsUpdate = true;
  }

  // ------------------------------------------------------------ route ribbons

  setRoute(id: string, pts: { x: number; z: number }[], y: number, color: number, width = 0.1, opts: { dash?: number; alpha?: number; flow?: number } = {}) {
    this.removeRoute(id);
    if (pts.length < 2) return;
    const pos: number[] = [], dist: number[] = [], idx: number[] = [];
    let d = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      if (i > 0) d += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      pos.push(p.x - dz * width / 2, y, p.z + dx * width / 2, p.x + dz * width / 2, y, p.z - dx * width / 2);
      dist.push(d, d);
      if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(dist, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(color) }, uDash: { value: opts.dash ?? 0 }, uAlpha: { value: opts.alpha ?? 0.9 }, uFlow: { value: opts.flow ?? 1.2 } },
      vertexShader: /* glsl */ `attribute float aD; varying float vD; void main(){ vD = aD; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uDash, uAlpha, uFlow, uTime; varying float vD;
        void main(){ float a = uAlpha; if (uDash > 0.5) { float f = fract(vD * 3.0 - uTime * uFlow); a *= smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.55, 0.7, f)); a = max(a, uAlpha * 0.25); }
          gl_FragColor = vec4(uCol, a); }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 6;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.ribbons.set(id, { mesh, mat });
  }
  removeRoute(id: string) {
    const r = this.ribbons.get(id);
    if (!r) return;
    this.group.remove(r.mesh);
    r.mesh.geometry.dispose(); r.mat.dispose();
    this.ribbons.delete(id);
  }
  clearRoutes(prefix = '') {
    for (const k of [...this.ribbons.keys()]) if (k.startsWith(prefix)) this.removeRoute(k);
  }
  setRoutesVisible(v: boolean, prefix: string) {
    for (const [k, r] of this.ribbons) if (k.startsWith(prefix)) r.mesh.visible = v;
  }

  // ------------------------------------------------------------ accident beacons

  setBeacons(list: { x: number; z: number; color: number }[]) {
    const ac = this.beacons.geometry.getAttribute('aCol') as THREE.InstancedBufferAttribute;
    const n = Math.min(list.length, 32);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      tmpObj.position.set(b.x, 0.02, b.z);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.scale.set(1, 0.9, 1);
      tmpObj.updateMatrix();
      this.beacons.setMatrixAt(i, tmpObj.matrix);
      const c = new THREE.Color(b.color);
      ac.setXYZ(i, c.r, c.g, c.b);
    }
    this.beacons.count = n;
    this.beacons.instanceMatrix.needsUpdate = true;
    ac.needsUpdate = true;
  }
  void() { void GLSL; void this.beaconData; }
}
