import * as THREE from 'three';
import { HALF } from '../sim/world.ts';

/** orbit / pan / zoom rig that always looks at a point on the ground */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, 0, 0);
  yaw = 0.72;
  pitch = 0.92;
  dist = 40;
  // goals (smoothed toward)
  gTarget = new THREE.Vector3(0, 0, 0);
  gYaw = 0.72;
  gPitch = 0.92;
  gDist = 40;
  minDist = 7;
  maxDist = 82;
  shake = 0;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(26, innerWidth / innerHeight, 1, 900);
    this.apply();
  }

  snap() {
    this.target.copy(this.gTarget); this.yaw = this.gYaw; this.pitch = this.gPitch; this.dist = this.gDist;
    this.apply();
  }

  apply() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    if (this.shake > 0.0005) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.target);
    // keep the far plane sensible and the near plane tight enough for depth precision
    this.camera.near = Math.max(1, this.dist * 0.12);
    this.camera.far = 700;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 9);
    this.target.lerp(this.gTarget, k);
    this.yaw += (this.gYaw - this.yaw) * k;
    this.pitch += (this.gPitch - this.pitch) * k;
    this.dist += (this.gDist - this.dist) * (1 - Math.exp(-dt * 11));
    this.shake *= Math.exp(-dt * 6);
    this.apply();
  }

  clampTarget() {
    const lim = HALF + 5;
    this.gTarget.x = Math.max(-lim, Math.min(lim, this.gTarget.x));
    this.gTarget.z = Math.max(-lim, Math.min(lim, this.gTarget.z));
  }

  /** screen pixel drag → ground pan */
  pan(dxPx: number, dyPx: number) {
    const h = innerHeight;
    const wpp = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.gDist) / h; // world units per pixel at the target depth
    const sy = Math.sin(this.gYaw), cy = Math.cos(this.gYaw);
    // screen right = (cy, 0, -sy); screen up (on the ground) = (-sy, 0, -cy)
    const k = wpp / Math.max(0.25, Math.sin(this.gPitch)) ;
    this.gTarget.x -= (cy * dxPx * wpp + sy * dyPx * k * 1.0);
    this.gTarget.z -= (-sy * dxPx * wpp + cy * dyPx * k * 1.0);
    this.clampTarget();
  }

  /** keyboard pan in camera-relative directions */
  move(fwd: number, right: number, dt: number) {
    const sp = this.gDist * 0.95 * dt;
    const sy = Math.sin(this.gYaw), cy = Math.cos(this.gYaw);
    this.gTarget.x += (-sy * fwd + cy * right) * sp;
    this.gTarget.z += (-cy * fwd - sy * right) * sp;
    this.clampTarget();
  }

  rotate(dYaw: number, dPitch = 0) {
    this.gYaw += dYaw;
    this.gPitch = Math.max(0.42, Math.min(1.32, this.gPitch + dPitch));
  }

  /** zoom keeping the ground point under the cursor fixed */
  zoom(factor: number, ndcX: number, ndcY: number) {
    const before = this.groundAt(ndcX, ndcY, true);
    this.gDist = Math.max(this.minDist, Math.min(this.maxDist, this.gDist * factor));
    if (before) {
      // approximate: move the target so the same point stays under the cursor
      const oldDist = this.dist;
      this.dist = this.gDist; this.apply();
      const after = this.groundAt(ndcX, ndcY, true);
      this.dist = oldDist; this.apply();
      if (after) {
        this.gTarget.x += before.x - after.x;
        this.gTarget.z += before.z - after.z;
        this.clampTarget();
      }
    }
  }

  groundAt(ndcX: number, ndcY: number, useGoal = false): THREE.Vector3 | null {
    if (useGoal) {
      // evaluate with the goal pose
      const sT = this.target.clone(), sY = this.yaw, sP = this.pitch, sD = this.dist;
      this.target.copy(this.gTarget); this.yaw = this.gYaw; this.pitch = this.gPitch; this.dist = this.gDist;
      this.apply();
      const p = this.groundAt(ndcX, ndcY, false);
      this.target.copy(sT); this.yaw = sY; this.pitch = sP; this.dist = sD;
      this.apply();
      return p;
    }
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out) ? out : null;
  }

  toScreen(v: THREE.Vector3, out = { x: 0, y: 0, visible: true }) {
    this.tmp.copy(v).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * innerWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * innerHeight;
    out.visible = this.tmp.z < 1 && this.tmp.z > -1;
    return out;
  }

  focus(x: number, z: number, dist?: number) {
    this.gTarget.set(x, 0, z);
    if (dist) this.gDist = dist;
    this.clampTarget();
  }
}
