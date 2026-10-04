// Particles: factory smoke, construction dust, rain.
import * as THREE from 'three';
import { U, GLSL } from './gfx.ts';

const CAP = 900;

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; s0: number; s1: number; c: [number, number, number]; a: number; grow: number }

export class Particles {
  mesh: THREE.Mesh;
  private ps: P[] = [];
  private aP: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;
  private smokeTimers = new Map<string, number>();

  constructor(scene: THREE.Scene) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', q.getAttribute('position'));
    g.setAttribute('uv', q.getAttribute('uv'));
    g.setIndex(q.getIndex());
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    this.aP.setUsage(THREE.DynamicDrawUsage); this.aC.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP);
    g.setAttribute('aC', this.aC);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uNight: U.uNight },
      vertexShader: /* glsl */ `
        attribute vec4 aP; attribute vec4 aC; varying vec2 vUv; varying vec4 vC;
        void main(){
          vUv = uv; vC = aC;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = aP.xyz + (right * position.x + up * position.y) * aP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight; varying vec2 vUv; varying vec4 vC;
        ${GLSL.COMMON}
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float d = length(p);
          float n = vnoise(p * 2.5 + vC.a * 10.0);
          float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.35) * vC.a;
          if (a < 0.01) discard;
          vec3 col = vC.rgb * mix(1.0, 0.35, uNight);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  puff(x: number, y: number, z: number, o: Partial<P> = {}) {
    if (this.ps.length >= CAP) return;
    this.ps.push({ x, y, z, vx: 0, vy: 0.2, vz: 0, life: 0, max: 2, s0: 0.1, s1: 0.4, c: [0.85, 0.86, 0.9], a: 0.6, grow: 1, ...o });
  }

  /** a ring of dust when a building lands */
  dust(x: number, z: number) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random();
      this.puff(x + Math.cos(a) * 0.2, 0.06, z + Math.sin(a) * 0.2, { vx: Math.cos(a) * 0.35, vz: Math.sin(a) * 0.35, vy: 0.09, max: 0.9 + Math.random() * 0.4, s0: 0.1, s1: 0.34, c: [0.86, 0.82, 0.74], a: 0.55 });
    }
  }

  smoke(key: string, x: number, y: number, z: number, dt: number, wind: [number, number]) {
    let t = (this.smokeTimers.get(key) ?? Math.random()) - dt;
    if (t <= 0) {
      t = 0.55 + Math.random() * 0.25;
      this.puff(x, y, z, { vx: wind[0] * 0.5, vz: wind[1] * 0.5, vy: 0.28, max: 4.2, s0: 0.09, s1: 0.55, c: [0.8, 0.8, 0.84], a: 0.55 });
    }
    this.smokeTimers.set(key, t);
  }

  update(dt: number, wind: [number, number]) {
    const ps = this.ps;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.max) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += (p.vx + wind[0] * 0.15 * (p.life / p.max)) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + wind[1] * 0.15 * (p.life / p.max)) * dt;
      p.vx *= 1 - dt * 0.6; p.vz *= 1 - dt * 0.6; p.vy *= 1 - dt * 0.25;
    }
    const n = Math.min(ps.length, CAP);
    const aP = this.aP.array as Float32Array, aC = this.aC.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      const t = p.life / p.max;
      const size = p.s0 + (p.s1 - p.s0) * Math.sqrt(t);
      aP[i * 4] = p.x; aP[i * 4 + 1] = p.y; aP[i * 4 + 2] = p.z; aP[i * 4 + 3] = size;
      aC[i * 4] = p.c[0]; aC[i * 4 + 1] = p.c[1]; aC[i * 4 + 2] = p.c[2];
      aC[i * 4 + 3] = p.a * Math.min(1, t * 6) * (1 - t) * (1 - t);
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.aP.needsUpdate = true; this.aC.needsUpdate = true;
  }
}

export class Rain {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private N = 1800;
  private attr: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene) {
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('position', q.getAttribute('position'));
    g.setAttribute('uv', q.getAttribute('uv'));
    g.setIndex(q.getIndex());
    this.pos = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) { this.pos[i * 4] = (Math.random() - 0.5) * 60; this.pos[i * 4 + 1] = Math.random() * 30; this.pos[i * 4 + 2] = (Math.random() - 0.5) * 60; this.pos[i * 4 + 3] = 0.7 + Math.random() * 0.6; }
    this.attr = new THREE.InstancedBufferAttribute(this.pos, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.attr);
    g.instanceCount = this.N;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uRain: U.uRain, uCenter: { value: new THREE.Vector3() }, uNight: U.uNight },
      vertexShader: /* glsl */ `
        attribute vec4 aP; uniform vec3 uCenter; varying float vA; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 c = vec3(uCenter.x + aP.x, aP.y, uCenter.z + aP.z);
          vec3 right = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
          right = normalize(right + vec3(0.0001));
          vec3 p = c + right * position.x * 0.012 + vec3(0.12 * position.y, position.y, 0.0) * 0.8 * aP.w;
          vA = aP.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uRain, uNight; varying float vA; varying vec2 vUv;
        void main(){ float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)); gl_FragColor = vec4(mix(vec3(0.75, 0.82, 0.92), vec3(0.45, 0.55, 0.75), uNight), a * 0.3 * uRain); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }
  update(dt: number, centre: THREE.Vector3) {
    const on = U.uRain.value > 0.03;
    this.mesh.visible = on;
    if (!on) return;
    this.mat.uniforms.uCenter.value.set(centre.x, 0, centre.z);
    for (let i = 0; i < this.N; i++) {
      this.pos[i * 4 + 1] -= dt * 22 * this.pos[i * 4 + 3];
      if (this.pos[i * 4 + 1] < 0) { this.pos[i * 4 + 1] += 30; this.pos[i * 4] = (Math.random() - 0.5) * 60; this.pos[i * 4 + 2] = (Math.random() - 0.5) * 60; }
    }
    this.attr.needsUpdate = true;
  }
}
