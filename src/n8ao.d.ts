declare module 'n8ao' {
  import type * as THREE from 'three';
  import type { Pass } from 'postprocessing';
  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    transparencyAware: boolean;
    accumulate: boolean;
    renderMode: number;
    biasOffset: number;
    biasMultiplier: number;
    [key: string]: unknown;
  }
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    scene: THREE.Scene;
    camera: THREE.Camera;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: string): void;
  }
  export class N8AOPass extends N8AOPostPass {}
}
