// Shared render plumbing: uniforms, shader patches, a tiny geometry builder, palette helpers.
import * as THREE from 'three';
import { N, HALF } from '../sim/world.ts';

export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },        // 0 day .. 1 night
  uDusk: { value: 0 },         // warm window glow on at dusk
  uRain: { value: 0 },
  uCloud: { value: 0.55 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  uLockTex: { value: null as THREE.Texture | null },
  uOverlay: { value: 0 },
};

const GLSL_COMMON = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;

export interface PatchOpts {
  paint?: boolean;     // aTint/aPaint instance+vertex colour blending
  windows?: boolean;   // procedural windows from aWin + wall uv
  cloud?: boolean;     // drifting cloud shadows
  sway?: boolean;      // wind sway for foliage
  emit?: boolean;      // per-vertex emission aEmit
  lock?: boolean;      // district lock overlay (ground)
  wet?: boolean;       // rain makes surfaces glossy/darker
  grain?: number;      // world-space grain amount
}

/** adds the project's shader features to a MeshStandardMaterial */
export function patch(mat: THREE.MeshStandardMaterial, o: PatchOpts) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uNight = U.uNight;
    sh.uniforms.uDusk = U.uDusk;
    sh.uniforms.uRain = U.uRain;
    sh.uniforms.uCloud = U.uCloud;
    if (o.lock) sh.uniforms.uLockTex = U.uLockTex;
    let vs = sh.vertexShader, fs = sh.fragmentShader;

    // ---------- vertex
    let vpars = 'varying vec3 vWPos;\nuniform float uTime;\n';
    if (o.paint) vpars += 'attribute vec3 aTint;\nattribute float aPaint;\n';
    if (o.windows) vpars += 'attribute vec4 aWin;\nattribute vec2 aWuv;\nattribute float aSeed;\nvarying vec4 vWin;\nvarying vec2 vWuv;\nvarying float vSeed;\n';
    if (o.emit) vpars += 'attribute float aEmit;\nvarying float vEmit;\n';
    vs = vs.replace('#include <common>', '#include <common>\n' + vpars);
    if (o.paint) vs = vs.replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\nvColor = vec4(color.rgb * mix(vec3(1.0), aTint, aPaint), 1.0);\n#endif');
    if (o.windows) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin; vWuv = aWuv; vSeed = aSeed;');
    if (o.emit) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmit = aEmit;');
    if (o.sway) vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
  #else
  vec3 ip = vec3(0.0);
  #endif
  float sw = max(0.0, position.y) * 0.9;
  transformed.x += sin(uTime * 1.6 + ip.x * 1.7 + ip.z * 1.3) * 0.012 * sw;
  transformed.z += cos(uTime * 1.3 + ip.x * 1.1 + ip.z * 1.9) * 0.01 * sw;
}`);
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  vec4 wp0 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp0 = instanceMatrix * wp0;
  #endif
  vWPos = (modelMatrix * wp0).xyz;
}`);

    // ---------- fragment
    let fpars = GLSL_COMMON + 'varying vec3 vWPos;\nuniform float uTime;\nuniform float uNight;\nuniform float uDusk;\nuniform float uRain;\nuniform float uCloud;\n';
    if (o.windows) fpars += 'varying vec4 vWin;\nvarying vec2 vWuv;\nvarying float vSeed;\n';
    if (o.emit) fpars += 'varying float vEmit;\n';
    if (o.lock) fpars += 'uniform sampler2D uLockTex;\n';
    fs = fs.replace('#include <common>', '#include <common>\n' + fpars);
    fs = fs.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity );\nfloat winMask = 0.0; vec3 winEmit = vec3(0.0);');
    if (o.windows) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
if (vWin.x > 0.0) {
  vec2 cell = vec2(vWuv.x / vWin.x, vWuv.y / vWin.y);
  vec2 id = floor(cell + 0.0001);
  vec2 f = fract(cell + 0.0001);
  vec2 mg = (1.0 - vWin.zw) * 0.5;
  vec2 aa = max(fwidth(cell), vec2(0.0001)) * 0.9;
  float inx = smoothstep(mg.x, mg.x + aa.x, f.x) * (1.0 - smoothstep(1.0 - mg.x - aa.x, 1.0 - mg.x, f.x));
  float iny = smoothstep(mg.y, mg.y + aa.y, f.y) * (1.0 - smoothstep(1.0 - mg.y - aa.y, 1.0 - mg.y, f.y));
  winMask = inx * iny;
  // fade tiny windows out at a distance so they do not shimmer
  winMask *= 1.0 - smoothstep(0.35, 0.8, max(aa.x, aa.y));
  float hh = hash21(id + vec2(vSeed * 17.31, vSeed * 3.7));
  float lit = step(0.52, hh) * step(0.18, hash21(id * 1.7 + vSeed));
  vec3 glass = mix(vec3(0.10, 0.17, 0.25), vec3(0.34, 0.5, 0.64), hash21(id + 4.2) * 0.35 + 0.1);
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask);
  float on = max(uNight, uDusk * 0.5);
  vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.9, 0.7), hash21(id + 9.1));
  winEmit = warm * winMask * lit * on * 1.55;
}`);
      fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, winMask);');
      fs = fs.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, winMask);');
    }
    if (o.wet) {
      fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, uRain);');
      fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.18 * uRain;');
    }
    if (o.grain) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  float gn = vnoise(vWPos.xz * 38.0) * 0.5 + vnoise(vWPos.xz * 9.0) * 0.5;
  diffuseColor.rgb *= 1.0 + (gn - 0.5) * ${o.grain.toFixed(3)};
}`);
    }
    if (o.lock) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 luv = (vWPos.xz + ${HALF.toFixed(1)}) / ${N.toFixed(1)};
  float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
  float lk = texture2D(uLockTex, luv).r * inside;
  float edge = 1.0 - abs(lk * 2.0 - 1.0);
  edge = smoothstep(0.55, 1.0, edge) * inside;
  float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 locked = mix(diffuseColor.rgb, vec3(gray) * vec3(0.84, 0.9, 1.0), 0.55) * 0.86;
  diffuseColor.rgb = mix(diffuseColor.rgb, locked, lk);
  float dash = step(0.5, fract((vWPos.x + vWPos.z) * 2.2));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.86, 0.45), edge * 0.55 * (0.35 + 0.65 * dash));
}`);
    }
    if (o.emit) {
      fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // vEmit: 1 = lit windows, 3+ = lamps and headlights
  float k = vEmit < 2.0 ? max(uNight, uDusk * 0.5) * vEmit * 0.9 : vEmit * max(uNight, uDusk * 0.45);
  totalEmissiveRadiance += diffuseColor.rgb * k * (vEmit < 2.0 ? 1.0 : 2.2);
}`);
    }
    if (o.windows) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += winEmit;');
    if (o.cloud) {
      fs = fs.replace('#include <opaque_fragment>', `{
  vec2 cp = vWPos.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.006);
  float cn = fbm2(cp);
  float cs = smoothstep(0.52, 0.72, cn);
  outgoingLight *= 1.0 - cs * uCloud * (1.0 - uNight * 0.7);
}
#include <opaque_fragment>`);
    }
    sh.vertexShader = vs;
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'rl' + JSON.stringify(o);
  return mat;
}

export const GLSL = { COMMON: GLSL_COMMON };

// ------------------------------------------------------------------ geometry builder

export interface BuildAttrs {
  pos: number[]; nrm: number[]; col: number[]; paint: number[]; emit: number[]; win: number[]; wuv: number[]; idx: number[];
}

/** Collects triangles with vertex colours + the project's custom attributes into one BufferGeometry. */
export class MeshBuilder {
  pos: number[] = []; nrm: number[] = []; col: number[] = []; paint: number[] = []; emit: number[] = []; win: number[] = []; wuv: number[] = []; idx: number[] = [];
  /** current default attributes for new vertices */
  paintW = 1;
  emitV = 0;
  winP: [number, number, number, number] = [0, 0, 0, 0];

  get count() { return this.pos.length / 3; }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color | number[], u = 0, v = 0): number {
    const i = this.count;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    if (Array.isArray(c)) this.col.push(c[0], c[1], c[2]); else this.col.push(c.r, c.g, c.b);
    this.paint.push(this.paintW);
    this.emit.push(this.emitV);
    this.win.push(this.winP[0], this.winP[1], this.winP[2], this.winP[3]);
    this.wuv.push(u, v);
    return i;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number) { this.idx.push(a, b, c, a, c, d); }

  /** axis aligned box; centre (cx, y0 + h/2, cz); walls get window uvs when `win` set */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, c: THREE.Color | number[], opts: { top?: THREE.Color | number[]; bottom?: boolean; win?: [number, number, number, number]; paint?: number; emit?: number; topEmit?: number } = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const savedWin = this.winP, savedPaint = this.paintW, savedEmit = this.emitV;
    if (opts.paint !== undefined) this.paintW = opts.paint;
    if (opts.emit !== undefined) this.emitV = opts.emit;
    const wp: [number, number, number, number] = opts.win ?? [0, 0, 0, 0];
    // +z face (front): u along x
    this.winP = wp;
    let i = this.vert(x0, y0, z1, 0, 0, 1, c, 0, y0), j = this.vert(x1, y0, z1, 0, 0, 1, c, w, y0), k = this.vert(x1, y1, z1, 0, 0, 1, c, w, y1), l = this.vert(x0, y1, z1, 0, 0, 1, c, 0, y1);
    this.quad(i, j, k, l);
    // -z face
    i = this.vert(x1, y0, z0, 0, 0, -1, c, 0, y0); j = this.vert(x0, y0, z0, 0, 0, -1, c, w, y0); k = this.vert(x0, y1, z0, 0, 0, -1, c, w, y1); l = this.vert(x1, y1, z0, 0, 0, -1, c, 0, y1);
    this.quad(i, j, k, l);
    // +x face
    i = this.vert(x1, y0, z1, 1, 0, 0, c, 0, y0); j = this.vert(x1, y0, z0, 1, 0, 0, c, d, y0); k = this.vert(x1, y1, z0, 1, 0, 0, c, d, y1); l = this.vert(x1, y1, z1, 1, 0, 0, c, 0, y1);
    this.quad(i, j, k, l);
    // -x face
    i = this.vert(x0, y0, z0, -1, 0, 0, c, 0, y0); j = this.vert(x0, y0, z1, -1, 0, 0, c, d, y0); k = this.vert(x0, y1, z1, -1, 0, 0, c, d, y1); l = this.vert(x0, y1, z0, -1, 0, 0, c, 0, y1);
    this.quad(i, j, k, l);
    // top
    this.winP = [0, 0, 0, 0];
    const tc = opts.top ?? c;
    if (opts.topEmit !== undefined) this.emitV = opts.topEmit;
    i = this.vert(x0, y1, z1, 0, 1, 0, tc); j = this.vert(x1, y1, z1, 0, 1, 0, tc); k = this.vert(x1, y1, z0, 0, 1, 0, tc); l = this.vert(x0, y1, z0, 0, 1, 0, tc);
    this.quad(i, j, k, l);
    if (opts.bottom) {
      i = this.vert(x0, y0, z0, 0, -1, 0, c); j = this.vert(x1, y0, z0, 0, -1, 0, c); k = this.vert(x1, y0, z1, 0, -1, 0, c); l = this.vert(x0, y0, z1, 0, -1, 0, c);
      this.quad(i, j, k, l);
    }
    this.winP = savedWin; this.paintW = savedPaint; this.emitV = savedEmit;
  }

  /** flat quad on the xz plane at height y facing up */
  floor(cx: number, y: number, cz: number, w: number, d: number, c: THREE.Color | number[], rot = 0) {
    const co = Math.cos(rot), si = Math.sin(rot);
    const p = (lx: number, lz: number) => [cx + lx * co - lz * si, cz + lx * si + lz * co];
    const [ax, az] = p(-w / 2, d / 2), [bx, bz] = p(w / 2, d / 2), [cx2, cz2] = p(w / 2, -d / 2), [dx, dz] = p(-w / 2, -d / 2);
    const a = this.vert(ax, y, az, 0, 1, 0, c), b = this.vert(bx, y, bz, 0, 1, 0, c), cc = this.vert(cx2, y, cz2, 0, 1, 0, c), dd = this.vert(dx, y, dz, 0, 1, 0, c);
    this.quad(a, b, cc, dd);
  }

  /** gable roof prism along x (ridge parallel to x): width w along x, depth d along z */
  gable(cx: number, y0: number, cz: number, w: number, d: number, rise: number, c: THREE.Color | number[], c2?: THREE.Color | number[], overhang = 0.03, alongZ = false) {
    const sp = this.winP; this.winP = [0, 0, 0, 0];
    const hw = w / 2 + overhang, hd = d / 2 + overhang;
    const col2 = c2 ?? c;
    const sx = alongZ ? hd : hw, sz = alongZ ? hw : hd; // half sizes in world x / z
    const yr = y0 + rise;
    if (!alongZ) {
      // ridge along x. slopes face +z and -z
      const nz = rise / Math.hypot(rise, hd), ny = hd / Math.hypot(rise, hd);
      let a = this.vert(cx - hw, y0, cz + hd, 0, ny, nz, c), b = this.vert(cx + hw, y0, cz + hd, 0, ny, nz, c), cc = this.vert(cx + hw, yr, cz, 0, ny, nz, c), dd = this.vert(cx - hw, yr, cz, 0, ny, nz, c);
      this.quad(a, b, cc, dd);
      a = this.vert(cx + hw, y0, cz - hd, 0, ny, -nz, col2); b = this.vert(cx - hw, y0, cz - hd, 0, ny, -nz, col2); cc = this.vert(cx - hw, yr, cz, 0, ny, -nz, col2); dd = this.vert(cx + hw, yr, cz, 0, ny, -nz, col2);
      this.quad(a, b, cc, dd);
      // gable ends (walls) — use the roof colour darkened is wrong; they take the wall colour from caller via box
    } else {
      const nx = rise / Math.hypot(rise, hw), ny = hw / Math.hypot(rise, hw);
      let a = this.vert(cx + hw, y0, cz + hd, nx, ny, 0, c), b = this.vert(cx + hw, y0, cz - hd, nx, ny, 0, c), cc = this.vert(cx, yr, cz - hd, nx, ny, 0, c), dd = this.vert(cx, yr, cz + hd, nx, ny, 0, c);
      this.quad(a, b, cc, dd);
      a = this.vert(cx - hw, y0, cz - hd, -nx, ny, 0, col2); b = this.vert(cx - hw, y0, cz + hd, -nx, ny, 0, col2); cc = this.vert(cx, yr, cz + hd, -nx, ny, 0, col2); dd = this.vert(cx, yr, cz - hd, -nx, ny, 0, col2);
      this.quad(a, b, cc, dd);
    }
    void sx; void sz;
    this.winP = sp;
  }

  /** triangular prism end caps for gable roofs (so the roof is closed) */
  gableEnds(cx: number, y0: number, cz: number, w: number, d: number, rise: number, c: THREE.Color | number[], alongZ = false) {
    const sp = this.winP; this.winP = [0, 0, 0, 0];
    const hw = w / 2, hd = d / 2, yr = y0 + rise;
    if (!alongZ) {
      for (const s of [1, -1]) {
        const x = cx + s * hw;
        const a = this.vert(x, y0, cz + hd, s, 0, 0, c), b = this.vert(x, y0, cz - hd, s, 0, 0, c), t = this.vert(x, yr, cz, s, 0, 0, c);
        if (s > 0) this.tri(a, b, t); else this.tri(b, a, t);
      }
    } else {
      for (const s of [1, -1]) {
        const z = cz + s * hd;
        const a = this.vert(cx - hw, y0, z, 0, 0, s, c), b = this.vert(cx + hw, y0, z, 0, 0, s, c), t = this.vert(cx, yr, z, 0, 0, s, c);
        if (s > 0) this.tri(a, b, t); else this.tri(b, a, t);
      }
    }
    this.winP = sp;
  }

  /** vertical cylinder (n sides) */
  cyl(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, c: THREE.Color | number[], n = 10, opts: { cap?: boolean; capColor?: THREE.Color | number[]; win?: [number, number, number, number] } = {}) {
    const sp = this.winP; this.winP = opts.win ?? [0, 0, 0, 0];
    const rows: number[][] = [];
    const slope = (r0 - r1) / h;
    const ny = slope, nl = Math.hypot(1, ny);
    for (let r = 0; r < 2; r++) {
      const row: number[] = [];
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rad = r === 0 ? r0 : r1;
        row.push(this.vert(cx + ca * rad, y0 + (r === 0 ? 0 : h), cz + sa * rad, ca / nl, ny / nl, sa / nl, c, (k / n) * Math.PI * 2 * Math.max(r0, 0.001), y0 + (r === 0 ? 0 : h)));
      }
      rows.push(row);
    }
    for (let k = 0; k < n; k++) this.quad(rows[0][k + 1], rows[0][k], rows[1][k], rows[1][k + 1]);
    if (opts.cap !== false && r1 > 0.001) {
      this.winP = [0, 0, 0, 0];
      const cc = opts.capColor ?? c;
      const ctr = this.vert(cx, y0 + h, cz, 0, 1, 0, cc);
      const ring: number[] = [];
      for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; ring.push(this.vert(cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1, 0, 1, 0, cc)); }
      for (let k = 0; k < n; k++) this.tri(ctr, ring[k + 1], ring[k]);
    }
    this.winP = sp;
  }

  /** sphere-ish blob (icosphere-lite via lat/long) */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: THREE.Color | number[], seg = 7, rings = 5, jitter = 0, rnd?: () => number) {
    const sp = this.winP; this.winP = [0, 0, 0, 0];
    const grid: number[][] = [];
    for (let r = 0; r <= rings; r++) {
      const row: number[] = [];
      const phi = (r / rings) * Math.PI;
      for (let s = 0; s <= seg; s++) {
        const th = (s / seg) * Math.PI * 2;
        let nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
        const j = jitter && rnd ? 1 + (rnd() - 0.5) * jitter : 1;
        row.push(this.vert(cx + nx * rx * j, cy + ny * ry * j, cz + nz * rz * j, nx, ny, nz, c));
      }
      grid.push(row);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) this.quad(grid[r][s], grid[r][s + 1], grid[r + 1][s + 1], grid[r + 1][s]);
    this.winP = sp;
  }

  /** cone */
  cone(cx: number, y0: number, cz: number, r: number, h: number, c: THREE.Color | number[], n = 7) {
    this.cyl(cx, y0, cz, r, 0.0005, h, c, n, { cap: false });
  }

  /** vertical slab quad facing out along ±x or ±z (used for signs, awnings) */
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPaint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setAttribute('aEmit', new THREE.Float32BufferAttribute(this.emit, 1));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 4));
    g.setAttribute('aWuv', new THREE.Float32BufferAttribute(this.wuv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** srgb hex to a linear THREE.Color triple */
export const C = (hex: number) => new THREE.Color(hex);
export const lin = (hex: number): number[] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export function mix3(a: number[], b: number[], t: number): number[] { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function shade3(a: number[], k: number): number[] { return [a[0] * k, a[1] * k, a[2] * k]; }

/** instanced attributes helper: a typed array + attribute with dynamic usage */
export function instAttr(count: number, size: number, init = 0) {
  const arr = new Float32Array(count * size);
  if (init) arr.fill(init);
  const a = new THREE.InstancedBufferAttribute(arr, size);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}

export const tmpObj = new THREE.Object3D();
