import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, BrightnessContrastEffect, HueSaturationEffect, BlendFunction, Effect, EffectAttribute, NoiseEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** miniature-photography blur: soft above and below a focus band, strength follows the camera height */
export class TiltShiftEffect extends Effect {
  constructor() {
    super('TiltShiftEffect', /* glsl */ `
      uniform float focus;
      uniform float amount;
      uniform float aspect;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float d = abs(uv.y - focus);
        float b = smoothstep(0.16, 0.62, d) * amount;
        if (b < 0.0002) { outputColor = inputColor; return; }
        vec4 sum = inputColor;
        float tot = 1.0;
        for (int i = 1; i <= 14; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float r = sqrt(fi / 14.0);
          vec2 off = vec2(cos(a) / aspect, sin(a)) * r * b;
          float w = 1.0 - r * 0.45;
          sum += texture2D(inputBuffer, uv + off) * w;
          tot += w;
        }
        outputColor = sum / tot;
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['focus', new THREE.Uniform(0.5)], ['amount', new THREE.Uniform(0.012)], ['aspect', new THREE.Uniform(1.7)]]),
    });
  }
  get focus() { return this.uniforms.get('focus')!.value as number; }
  set focus(v: number) { this.uniforms.get('focus')!.value = v; }
  get amount() { return this.uniforms.get('amount')!.value as number; }
  set amount(v: number) { this.uniforms.get('amount')!.value = v; }
  set aspect(v: number) { this.uniforms.get('aspect')!.value = v; }
}

const AO_FRAG = /* glsl */ `
uniform float aoRadius;
uniform float aoIntensity;
uniform vec2 aoTanHalf;
vec3 aoViewPos(vec2 uv, float d) {
  float vz = getViewZ(d);
  return vec3((uv * 2.0 - 1.0) * aoTanHalf * -vz, vz);
}
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (aoIntensity <= 0.0 || depth >= 0.99999) return;
  vec3 P = aoViewPos(uv, depth);
  float dist = -P.z;
  if (dist > 160.0) return;
  vec3 N = normalize(cross(dFdx(P), dFdy(P)));
  float rS = min(aoRadius / (dist * aoTanHalf.y * 2.0), 0.07);
  if (rS < texelSize.y * 1.5) return;
  float occ = 0.0;
  for (int i = 0; i < 14; i++) {
    float t = (float(i) + 0.5) / 14.0;
    float a = float(i) * 2.39996;
    vec2 o = vec2(cos(a), sin(a) * aspect) * rS * sqrt(t);
    vec2 q = uv + o;
    float dq = readDepth(q);
    vec3 S = aoViewPos(q, dq);
    vec3 v = S - P;
    float l = length(v);
    float h = max(0.0, dot(N, v) / max(l, 1e-4) - 0.2);
    occ += h * (1.0 - smoothstep(aoRadius * 0.6, aoRadius * 1.4, l));
  }
  occ = clamp(occ / 14.0 * 1.9, 0.0, 1.0);
  occ *= 1.0 - smoothstep(70.0, 150.0, dist);
  float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float ambient = 1.0 - smoothstep(0.35, 2.5, lum) * 0.55;
  outputColor = vec4(inputColor.rgb * (1.0 - occ * aoIntensity * ambient), inputColor.a);
}`;

/** cheap one-pass depth AO (contact shadows under buildings, cars and trees) */
export class AOEffect extends Effect {
  constructor() {
    super('AOEffect', AO_FRAG, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([['aoRadius', new THREE.Uniform(0.5)], ['aoIntensity', new THREE.Uniform(0.9)], ['aoTanHalf', new THREE.Uniform(new THREE.Vector2(1, 1))]]),
    });
  }
  set intensity(v: number) { this.uniforms.get('aoIntensity')!.value = v; }
  get intensity() { return this.uniforms.get('aoIntensity')!.value as number; }
  set radius(v: number) { this.uniforms.get('aoRadius')!.value = v; }
  setCamera(cam: THREE.PerspectiveCamera) {
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    (this.uniforms.get('aoTanHalf')!.value as THREE.Vector2).set(ty * cam.aspect, ty);
  }
}

export class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */ `
      uniform float exposure;
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        outputColor = vec4( inputColor.rgb * exposure, inputColor.a );
      }`, { uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }
  get value(): number { return this.uniforms.get('exposure')!.value; }
  set value(v: number) { this.uniforms.get('exposure')!.value = v; }
}

/** colour balance by time of day: lifts shadows toward blue at night, warms the highlights at golden hour */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform vec3 tint;
      uniform float night;
      uniform float warm;
      void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 shadowTint = mix(vec3(1.0), vec3(0.86, 0.93, 1.12), night);
        vec3 hiTint = mix(vec3(1.0), vec3(1.04, 1.0, 0.94), warm);
        c *= mix(shadowTint, hiTint, smoothstep(0.05, 0.6, l));
        outputColor = vec4(c * tint, inputColor.a);
      }`, { uniforms: new Map<string, THREE.Uniform>([['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['night', new THREE.Uniform(0)], ['warm', new THREE.Uniform(0)]]) });
  }
  set night(v: number) { this.uniforms.get('night')!.value = v; }
  set warm(v: number) { this.uniforms.get('warm')!.value = v; }
}

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly ao: N8AOPostPass;
  readonly ssao = new AOEffect();
  private ssaoPass: EffectPass;
  readonly tilt: TiltShiftEffect;
  readonly exposure = new ExposureEffect();
  readonly bloom: BloomEffect;
  readonly tone: ToneMappingEffect;
  readonly grade = new GradeEffect();
  readonly vignette: VignetteEffect;
  private tiltPass: EffectPass;
  camera: THREE.PerspectiveCamera;
  scale = 1;
  maxScale = 1;
  minScale = 0.62;
  quality: Quality = 'high';
  adaptive = true;
  private budget = 3.2e6;
  private frameTimes: number[] = [];
  private lastAdapt = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    const gl = this.gl;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.NoToneMapping;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.setClearColor(0xbfd9ee, 1);

    this.composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    this.ao.configuration.aoRadius = 0.9;
    this.ao.configuration.distanceFalloff = 0.8;
    this.ao.configuration.intensity = 2.6;
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.color = new THREE.Color(0x1a2233);
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);
    this.ssaoPass = new EffectPass(camera, this.ssao);
    this.composer.addPass(this.ssaoPass);

    this.tilt = new TiltShiftEffect();
    this.tiltPass = new EffectPass(camera, this.tilt);
    this.composer.addPass(this.tiltPass);

    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.4, intensity: 0.5, radius: 0.7 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.5 });
    const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.07 });
    const sat = new HueSaturationEffect({ saturation: 0.04 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.03;
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.composer.addPass(new EffectPass(camera, this.exposure, this.bloom, this.grade, this.tone, contrast, sat, this.vignette, grain, smaa));
    this.setQuality('high');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.budget = { low: 1.1e6, medium: 2.0e6, high: 2.9e6, ultra: 5.5e6 }[q];
    this.ao.enabled = q === 'ultra';
    this.ssaoPass.enabled = q !== 'ultra' && q !== 'low';
    this.ssao.intensity = q === 'medium' ? 0.8 : 0.95;
    this.ao.configuration.halfRes = true;
    this.minScale = 0.6;
    this.scale = 1;
    this.resize();
  }

  setExposure(x: number) {
    if (Math.abs(this.exposure.value - x) < 1e-5) return;
    this.exposure.value = x;
    this.bloom.luminanceMaterial.threshold = 1.0 / x;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    const ratio = Math.min(dpr, Math.sqrt(this.budget / (w * h)));
    this.gl.setPixelRatio(ratio * this.scale);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.tilt.aspect = w / h;
    this.ssao.setCamera(this.camera);
  }

  adapt(dt: number, now: number) {
    if (!this.adaptive) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdapt < 1.5 || this.frameTimes.length < 60) return;
    this.lastAdapt = now;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    let s = this.scale;
    if (p80 > 1 / 50) s = Math.max(this.minScale, s - 0.06);
    else if (p80 < 1 / 58) s = Math.min(this.maxScale, s + 0.03);
    if (Math.abs(s - this.scale) > 0.001) { this.scale = s; this.resize(); }
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
