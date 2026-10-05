// Terrain, water, sky and the time-of-day lighting rig.
import * as THREE from 'three';
import { U, patch, GLSL } from './gfx.ts';
import { Noise2, smoothstep, clamp, lerp } from '../sim/util.ts';
import { World, N, HALF, SC, WATER_LEVEL, DN, DS } from '../sim/world.ts';

export const EXT = 56 * SC;          // half-size of the terrain mesh in world units
const SEG = 336;

const col = (hex: number) => new THREE.Color(hex);

// ---------------------------------------------------------------------------------- terrain

export class Land {
  mesh: THREE.Mesh;
  water: THREE.Mesh;
  waterMat: THREE.ShaderMaterial;
  depthTex: THREE.DataTexture;
  lockTex: THREE.DataTexture;
  private lockData = new Uint8Array(N * N);

  constructor(readonly world: World, readonly scene: THREE.Scene) {
    const t = world.terrain;
    const noise = new Noise2(world.seed + 77);
    // ----- geometry
    const g = new THREE.BufferGeometry();
    const nV = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(nV * 3), colr = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3);
    const hs = new Float32Array(nV);
    const step = (EXT * 2) / SEG;
    for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
      const x = -EXT + i * step, z = -EXT + j * step;
      hs[j * (SEG + 1) + i] = t.height(x, z);
    }
    const H = (i: number, j: number) => hs[Math.min(SEG, Math.max(0, j)) * (SEG + 1) + Math.min(SEG, Math.max(0, i))];
    const grass1 = col(0x7fb35a), grass2 = col(0x6ba14e), grass3 = col(0x5c9247), sand = col(0xe7d9a6), wetSand = col(0xc9b98a), rock = col(0x8f8c80), rock2 = col(0xb4ac9a), dirt = col(0x8d7a56), bed = col(0x5d8a86), meadow = col(0x82b95c);
    const tmp = new THREE.Color();
    for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
      const k = j * (SEG + 1) + i;
      const x = -EXT + i * step, z = -EXT + j * step;
      const h = hs[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const nl = Math.hypot(dx, 1, dz);
      nrm[k * 3] = -dx / nl; nrm[k * 3 + 1] = 1 / nl; nrm[k * 3 + 2] = -dz / nl;
      const slope = Math.hypot(dx, dz);
      const n1 = noise.fbm(x * 0.09, z * 0.09, 3) * 0.5 + 0.5;
      const n2 = noise.fbm(x * 0.35 + 9, z * 0.35, 2) * 0.5 + 0.5;
      const inPlay = Math.max(Math.abs(x), Math.abs(z)) < HALF + 1;
      tmp.copy(grass1).lerp(grass2, smoothstep(0.3, 0.7, n1)).lerp(grass3, smoothstep(0.55, 0.9, n2) * 0.45);
      if (inPlay) tmp.lerp(meadow, 0.35);
      // sandy banks and beach
      const bank = 1 - smoothstep(WATER_LEVEL + 0.02, WATER_LEVEL + 0.22, h);
      tmp.lerp(sand, bank * 0.95);
      // underwater floor
      tmp.lerp(wetSand, smoothstep(WATER_LEVEL, WATER_LEVEL - 0.25, h) * 0.9);
      tmp.lerp(bed, smoothstep(WATER_LEVEL - 0.2, WATER_LEVEL - 1.2, h) * 0.8);
      // hills: darker olive then rock
      const hi = smoothstep(0.8, 3.2, h);
      tmp.lerp(col(0x55904a), hi * 0.6);
      tmp.lerp(rock, smoothstep(2.6, 4.0, h) * 0.7 + smoothstep(0.7, 1.4, slope) * 0.6);
      tmp.lerp(rock2, smoothstep(4.4, 5.8, h) * 0.6);
      tmp.lerp(dirt, smoothstep(0.8, 1.2, slope) * 0.25 * n2);
      colr[k * 3] = tmp.r; colr[k * 3 + 1] = tmp.g; colr[k * 3 + 2] = tmp.b;
    }
    const idx = new Uint32Array(SEG * SEG * 6);
    let q = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));

    // lock texture
    this.lockTex = new THREE.DataTexture(this.lockData, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.lockTex.magFilter = THREE.LinearFilter; this.lockTex.minFilter = THREE.LinearFilter;
    this.lockTex.wrapS = this.lockTex.wrapT = THREE.ClampToEdgeWrapping;
    this.lockTex.needsUpdate = true;
    U.uLockTex.value = this.lockTex;
    this.refreshLock();

    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }), { cloud: true, lock: true, grain: 0.1, wet: true });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // ----- water
    const dN = 384;
    const depth = new Uint8Array(dN * dN);
    for (let j = 0; j < dN; j++) for (let i = 0; i < dN; i++) {
      const x = -EXT + ((i + 0.5) / dN) * EXT * 2, z = -EXT + ((j + 0.5) / dN) * EXT * 2;
      const h = t.height(x, z);
      depth[j * dN + i] = Math.round(clamp((WATER_LEVEL - h) / 3.2) * 255);
    }
    this.depthTex = new THREE.DataTexture(depth, dN, dN, THREE.RedFormat, THREE.UnsignedByteType);
    this.depthTex.magFilter = this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping;
    this.depthTex.needsUpdate = true;
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...THREE.UniformsLib.fog,
        uTime: U.uTime,
        uNight: U.uNight,
        uRain: U.uRain,
        uDepthTex: { value: this.depthTex },
        uSun: U.uSunDir,
        uSkyH: { value: new THREE.Color(0xbfe0ff) },
        uSkyT: { value: new THREE.Color(0x66aaf0) },
        uSunCol: { value: new THREE.Color(0xfff2d8) },
        uExt: { value: EXT },
      },
      fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uNight, uRain, uExt;
        uniform sampler2D uDepthTex;
        uniform vec3 uSun, uSkyH, uSkyT, uSunCol;
        varying vec3 vW;
        ${GLSL.COMMON}
        #include <fog_pars_fragment>
        float wave(vec2 p, vec2 d, float f, float s, out vec2 g){
          float ph = dot(p, d) * f + uTime * s;
          g = d * cos(ph) * f;
          return sin(ph);
        }
        void main(){
          vec2 uv = (vW.xz + uExt) / (2.0 * uExt);
          float dep = texture2D(uDepthTex, uv).r * 3.2;
          if (dep < 0.0005 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) discard;
          vec2 p = vW.xz;
          vec2 g1, g2, g3, g4;
          float h = wave(p, normalize(vec2(1.0, 0.35)), 1.7, 0.9, g1) * 0.5
                  + wave(p, normalize(vec2(-0.4, 1.0)), 2.6, 1.25, g2) * 0.35
                  + wave(p, normalize(vec2(0.8, -0.9)), 4.4, 1.7, g3) * 0.2
                  + wave(p, normalize(vec2(-1.0, -0.2)), 7.5, 2.3, g4) * 0.1;
          vec2 grad = g1 * 0.5 + g2 * 0.35 + g3 * 0.2 + g4 * 0.1;
          // fine ripples
          float e = 0.02;
          vec2 np = p * 6.0 + vec2(uTime * 0.25, -uTime * 0.18);
          float n0 = vnoise(np), nx = vnoise(np + vec2(e * 6.0, 0.0)), nz = vnoise(np + vec2(0.0, e * 6.0));
          grad += vec2(nx - n0, nz - n0) * 2.6;
          float calm = mix(0.05, 0.1, uRain);
          vec3 n = normalize(vec3(-grad.x * calm, 1.0, -grad.y * calm));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          // body colour by depth
          float d1 = 1.0 - exp(-dep * 1.7);
          vec3 shallow = vec3(0.34, 0.78, 0.76), deep = vec3(0.045, 0.30, 0.43);
          vec3 body = mix(shallow, deep, d1);
          body *= 0.9 + 0.1 * h;
          // caustic shimmer in the shallows
          float cau = vnoise(p * 9.0 + uTime * 0.6) * vnoise(p * 13.0 - uTime * 0.5);
          body += (1.0 - d1) * cau * 0.22;
          vec3 R = reflect(-V, n);
          vec3 sky = mix(uSkyH, uSkyT, clamp(R.y * 1.4, 0.0, 1.0));
          vec3 col = mix(body, sky, clamp(0.12 + fres * 0.85, 0.0, 0.95));
          // sun glitter
          vec3 L = normalize(uSun);
          float sp = pow(max(dot(R, L), 0.0), 220.0) * 6.0 + pow(max(dot(R, L), 0.0), 24.0) * 0.35;
          col += uSunCol * sp * (1.0 - uNight * 0.6) * step(0.0, L.y);
          // shore foam
          float fn = vnoise(p * 7.0 + vec2(uTime * 0.3, 0.0)) * 0.6 + vnoise(p * 15.0 - uTime * 0.4) * 0.4;
          float fo = smoothstep(0.16 + fn * 0.05, 0.0, dep - 0.02 * sin(uTime * 1.4 + fn * 6.0));
          col = mix(col, vec3(0.97, 1.0, 1.0), fo * 0.85);
          // rain rings
          if (uRain > 0.05) {
            vec2 rp = p * 5.0; vec2 ri = floor(rp); vec2 rf = fract(rp) - 0.5;
            float rt = fract(uTime * 0.9 + hash21(ri));
            float rr = length(rf) - rt * 0.5;
            col += vec3(0.5) * smoothstep(0.05, 0.0, abs(rr)) * (1.0 - rt) * uRain * 0.5;
          }
          col *= mix(1.0, 0.16, uNight);
          col += uNight * vec3(0.01, 0.025, 0.05);
          float alpha = mix(0.38, 0.96, smoothstep(0.0, 0.42, dep));
          alpha = max(alpha, fo * 0.9);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2), this.waterMat);
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = 1;
    scene.add(this.water);
  }

  refreshLock() {
    const w = this.world;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.floor(y / DS) * DN + Math.floor(x / DS);
      this.lockData[y * N + x] = w.unlocked[d] ? 0 : 255;
    }
    this.lockTex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------- sky

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: U.uTime,
        uSun: U.uSunDir,
        uNight: U.uNight,
        uRain: U.uRain,
        uTop: { value: new THREE.Color(0x4a9be8) },
        uHor: { value: new THREE.Color(0xbfe3ff) },
        uCloudCol: { value: new THREE.Color(0xffffff) },
        uSunCol: { value: new THREE.Color(0xfff0d0) },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uNight, uRain;
        uniform vec3 uSun, uTop, uHor, uCloudCol, uSunCol;
        varying vec3 vDir;
        ${GLSL.COMMON}
        void main(){
          vec3 v = normalize(vDir);
          float h = max(v.y, 0.0);
          vec3 col = mix(uHor, uTop, pow(h, 0.5));
          col = mix(col, uHor * 0.9, smoothstep(0.0, -0.25, v.y)) ;
          vec3 L = normalize(uSun);
          float sd = max(dot(v, L), 0.0);
          // sun disc + glow
          float day = 1.0 - uNight;
          col += uSunCol * (pow(sd, 900.0) * 7.0 + pow(sd, 40.0) * 0.45 + pow(sd, 6.0) * 0.12) * step(-0.05, L.y) * day;
          // moon
          vec3 M = normalize(vec3(-L.x, abs(L.y) + 0.25, -L.z));
          float md = max(dot(v, M), 0.0);
          col += vec3(0.75, 0.85, 1.0) * (pow(md, 1500.0) * 3.0 + pow(md, 60.0) * 0.14) * uNight;
          // stars
          if (uNight > 0.02 && v.y > 0.0) {
            vec2 sp = v.xz / (v.y + 0.35) * 55.0;
            vec2 si = floor(sp);
            float sh = hash21(si);
            float tw = 0.6 + 0.4 * sin(uTime * (1.5 + sh * 3.0) + sh * 40.0);
            float star = step(0.985, sh) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * tw;
            col += vec3(star) * uNight * smoothstep(0.0, 0.25, v.y);
          }
          // clouds on a plane
          if (v.y > 0.0) {
            vec2 cp = v.xz / (v.y + 0.12) * 0.55 + vec2(uTime * 0.012, uTime * 0.004);
            float c = fbm2(cp * 1.4) * 0.9 + fbm2(cp * 3.0 + 4.0) * 0.25;
            float m = smoothstep(0.52 - uRain * 0.25, 0.78 - uRain * 0.25, c) * smoothstep(0.0, 0.22, v.y);
            vec3 cc = uCloudCol * (0.78 + 0.35 * smoothstep(0.35, 0.8, c)) * mix(1.0, 0.45, uRain);
            // lit rim toward the sun
            cc += uSunCol * pow(sd, 3.0) * 0.35 * day;
            col = mix(col, cc, m * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 20), this.mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

// ---------------------------------------------------------------------------------- time of day

interface Key { h: number; top: number; hor: number; sun: number; sunI: number; hemiS: number; hemiG: number; hemiI: number; fog: number; exp: number; cloud: number }
const KEYS: Key[] = [
  { h: 0, top: 0x050a1c, hor: 0x16264a, sun: 0x8fb0ff, sunI: 0.75, hemiS: 0x1d2b55, hemiG: 0x0d1424, hemiI: 0.55, fog: 0x14203f, exp: 1.25, cloud: 0x2a3556 },
  { h: 4.8, top: 0x0a1330, hor: 0x2a3b66, sun: 0x8fb0ff, sunI: 0.7, hemiS: 0x24376a, hemiG: 0x101a30, hemiI: 0.55, fog: 0x253257, exp: 1.2, cloud: 0x3b4670 },
  { h: 5.9, top: 0x4a67ae, hor: 0xffb08a, sun: 0xffa56c, sunI: 1.7, hemiS: 0x7d8cc0, hemiG: 0x464652, hemiI: 0.75, fog: 0xe3b09c, exp: 1.12, cloud: 0xffc3a8 },
  { h: 7.4, top: 0x4d95e6, hor: 0xffd9b8, sun: 0xffddb0, sunI: 3.0, hemiS: 0x9cc4f0, hemiG: 0x6a8a52, hemiI: 0.8, fog: 0xdde6ee, exp: 1.04, cloud: 0xfff4e8 },
  { h: 10, top: 0x3d8fe8, hor: 0xbfe2ff, sun: 0xfff3dc, sunI: 3.7, hemiS: 0xa8d0ff, hemiG: 0x759a58, hemiI: 0.9, fog: 0xcfe6f7, exp: 1.0, cloud: 0xffffff },
  { h: 14, top: 0x3a8ae6, hor: 0xbfe2ff, sun: 0xfff3dc, sunI: 3.7, hemiS: 0xa8d0ff, hemiG: 0x759a58, hemiI: 0.9, fog: 0xcfe6f7, exp: 1.0, cloud: 0xffffff },
  { h: 16.8, top: 0x4a8ee0, hor: 0xffe0b4, sun: 0xffdca8, sunI: 3.3, hemiS: 0xa4c6f0, hemiG: 0x759a58, hemiI: 0.88, fog: 0xe6ddd2, exp: 1.04, cloud: 0xfff0dc },
  { h: 18.2, top: 0x4a62b0, hor: 0xff9f72, sun: 0xffa066, sunI: 2.3, hemiS: 0x8f93c8, hemiG: 0x5a4a50, hemiI: 0.78, fog: 0xe4a58e, exp: 1.1, cloud: 0xffb08a },
  { h: 19.4, top: 0x232d62, hor: 0x9a6d95, sun: 0xa9aef8, sunI: 1.0, hemiS: 0x4a5390, hemiG: 0x242842, hemiI: 0.66, fog: 0x6c5a82, exp: 1.2, cloud: 0x8a6a9c },
  { h: 21, top: 0x070c22, hor: 0x1c2c52, sun: 0x8fb0ff, sunI: 0.75, hemiS: 0x1d2b55, hemiG: 0x0d1424, hemiI: 0.55, fog: 0x16224a, exp: 1.25, cloud: 0x2a3556 },
  { h: 24, top: 0x050a1c, hor: 0x16264a, sun: 0x8fb0ff, sunI: 0.75, hemiS: 0x1d2b55, hemiG: 0x0d1424, hemiI: 0.55, fog: 0x14203f, exp: 1.25, cloud: 0x2a3556 },
];

const cA = new THREE.Color(), cB = new THREE.Color();
function lerpCol(out: THREE.Color, a: number, b: number, t: number) { cA.set(a); cB.set(b); out.copy(cA).lerp(cB, t); return out; }

export class TimeOfDay {
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  hour = 6;
  night = 0;
  /** 0..1 smog over the city */
  haze = 0;
  private sunPos = new THREE.Vector3();
  constructor(readonly scene: THREE.Scene, readonly sky: Sky, readonly land: Land) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.sun.shadow.blurSamples = 12;
    scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xbcd4ff, 0.35);
    scene.add(this.fill);
    this.hemi = new THREE.HemisphereLight(0xa8d0ff, 0x759a58, 0.9);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xcfe6f7, 0.0062);
    scene.fog = this.fog;
  }

  update(hour: number, rain: number, dt: number) {
    this.hour = hour;
    // find keyframes
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((hour - a.h) / (b.h - a.h));
    const s = t * t * (3 - 2 * t);
    const sky = this.sky.mat.uniforms;
    lerpCol(sky.uTop.value, a.top, b.top, s);
    lerpCol(sky.uHor.value, a.hor, b.hor, s);
    lerpCol(sky.uCloudCol.value, a.cloud, b.cloud, s);
    // rain greys everything
    if (rain > 0.001) {
      const grey = new THREE.Color(0x7d8794);
      sky.uTop.value.lerp(grey, rain * 0.6);
      sky.uHor.value.lerp(new THREE.Color(0xa5adb6), rain * 0.65);
      sky.uCloudCol.value.lerp(new THREE.Color(0x8a929c), rain * 0.7);
    }
    const sunCol = lerpCol(sky.uSunCol.value, a.sun, b.sun, s).clone();
    const sunI = lerp(a.sunI, b.sunI, s) * (1 - rain * 0.55);
    // sun path: east at 6h, overhead at 12h, west at 18h
    const ang = ((hour - 6) / 12) * Math.PI;
    const el = Math.sin(ang);
    const dayDir = new THREE.Vector3(-Math.cos(ang), Math.max(0.0, el) * 0.95 + 0.0, -0.38 + 0.18 * Math.max(0, el)).normalize();
    const sunUp = el > 0.04;
    // night factor (for windows, lamps)
    const nightK = clamp((0.16 - el) / 0.22);
    this.night = nightK;
    U.uNight.value = nightK;
    U.uDusk.value = clamp(1 - Math.abs(el - 0.12) / 0.3) * (hour > 12 ? 1 : 0.0);
    U.uRain.value = rain;
    U.uCloud.value = 0.5 + rain * 0.2;
    let dir: THREE.Vector3;
    if (sunUp || el > -0.02) { dir = dayDir.clone(); if (dir.y < 0.06) dir.y = 0.06 + (el + 0.02) * 0.5; dir.normalize(); }
    else dir = new THREE.Vector3(Math.cos(ang) * 0.6, 0.55 + Math.abs(el) * 0.3, 0.35).normalize();
    U.uSunDir.value.copy(sunUp ? dayDir.clone().setY(Math.max(el, 0.02)).normalize() : dir.clone().multiplyScalar(-1).setY(-0.3).normalize().multiplyScalar(-1).setY(-0.2));
    // the skybox uses the true sun vector (can sit below the horizon); lighting uses a clamped one
    U.uSunDir.value.set(-Math.cos(ang), Math.sin(ang), -0.38).normalize();
    this.sunPos.copy(dir).multiplyScalar(90);
    this.sun.position.copy(this.sunPos);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI;
    this.fill.position.set(-dir.x * 60, 30, -dir.z * 60 + 20);
    this.fill.intensity = (0.35 + nightK * 0.1) * (1 - rain * 0.3);
    this.fill.color.setRGB(0.72, 0.82, 1.0);
    lerpCol(this.hemi.color, a.hemiS, b.hemiS, s);
    lerpCol(this.hemi.groundColor, a.hemiG, b.hemiG, s);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, s) * (1 + rain * 0.15) * 0.62;
    const fogc = lerpCol(new THREE.Color(), a.fog, b.fog, s);
    if (rain > 0.001) fogc.lerp(new THREE.Color(0x9aa4ae), rain * 0.7);
    if (this.haze > 0.01) fogc.lerp(new THREE.Color(0xb8a58c), this.haze * 0.5 * (1 - nightK * 0.6));
    this.fog.color.copy(fogc);
    this.fog.density = 0.0058 + rain * 0.006 + nightK * 0.0012 + this.haze * 0.0034;
    this.scene.background = null;
    const wm = this.land.waterMat.uniforms;
    wm.uSkyH.value.copy(sky.uHor.value);
    wm.uSkyT.value.copy(sky.uTop.value);
    wm.uSunCol.value.copy(sunCol);
    // shadows only when the sun (or moon) is meaningfully above the horizon
    this.sun.castShadow = true;
    void dt;
  }

  get exposure() {
    return 1;
  }
  get warm() {
    const h = this.hour;
    return clamp(1 - Math.abs(h - 7) / 2.2) + clamp(1 - Math.abs(h - 17.8) / 2.2);
  }
}
