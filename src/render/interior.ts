// Look inside: lift the roof off a home or a shop and see the rooms, the furniture and the people in them, dollhouse style.
import * as THREE from 'three';
import { MeshBuilder, lin, shade3 } from './gfx.ts';
import { footCenter, type BuildingsView } from './buildings.ts';
import { decodeLook, SKIN, HAIR, SHIRT } from '../sim/people.ts';
import { mulberry32 } from '../sim/util.ts';
import { hourOf } from '../sim/types.ts';
import type { Game } from '../sim/game.ts';
import type { Building, Person } from '../sim/types.ts';
import type { CameraRig } from './camera.ts';

type Pose = 'stand' | 'sit' | 'lie';
interface Spot { x: number; z: number; pose: Pose; face: number }
interface Plan {
  geo: THREE.BufferGeometry;
  /** named places, per flat for homes */
  flats: Record<string, Spot[]>[];
  /** the room as it will be seen: width, depth */
  w: number; d: number;
  /** lit windows and lamps follow the clock */
  lamps: THREE.Mesh[];
}
interface Fig { p: Person; g: THREE.Group; flat: number; x: number; z: number; spot: Spot; kind: string; until: number; walking: boolean }

const WALL = lin(0xf1ebde), WALL_IN = lin(0xe6dfd0), WOOD = lin(0xc9a46f), WOOD2 = lin(0xb8925c), TILE = lin(0xd5dfe3), TILE2 = lin(0xc3cfd5), GRASS = lin(0x80bb5c), GRASS2 = lin(0x72ad52);
const FABRIC = [0x5b7fa6, 0xb3563f, 0x6b8f6e, 0x8c6c9e, 0xd0a24a, 0x4d8a8f, 0xc77d8b];
const SLAB = lin(0xd2ccbd);

export class InteriorView {
  group = new THREE.Group();
  b: Building | null = null;
  private plan: Plan | null = null;
  figs: Fig[] = [];
  private body: THREE.Mesh | null = null;
  private mats = new Map<number, THREE.MeshStandardMaterial>();
  private geo = {
    torso: new THREE.CylinderGeometry(0.0095, 0.0115, 0.034, 7),
    legs: new THREE.CylinderGeometry(0.0075, 0.0075, 0.018, 6),
    head: new THREE.SphereGeometry(0.0125, 8, 6),
    hair: new THREE.SphereGeometry(0.0132, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
    arm: new THREE.CylinderGeometry(0.0036, 0.0036, 0.03, 5),
  };
  private saved: { dist: number; pitch: number; min: number } | null = null;
  private light = new THREE.PointLight(0xffd9a8, 0, 2.6, 1.4);
  private level = 0;
  private refreshAt = 0;
  /** the camera zoom limit while inside */
  private static MIN = 1.1;
  onChange: (b: Building | null) => void = () => {};

  constructor(scene: THREE.Scene, readonly game: Game, readonly buildings: BuildingsView, readonly rig: CameraRig) {
    this.group.visible = false;
    this.light.position.set(0, 0.55, 0.05);
    this.group.add(this.light);
    scene.add(this.group);
  }

  get open() { return !!this.b; }
  get count() { return this.figs.length; }

  /** can this building be looked into? */
  canEnter(b: Building): boolean {
    if (b.kind === 'res') return true;
    return b.kind === 'com' && !b.special && !!b.venue && b.venue !== 'mall';
  }

  show(b: Building) {
    if (!this.canEnter(b)) return;
    if (this.b === b) return;
    if (this.b) this.hideSilently();
    this.b = b;
    this.level = b.level;
    this.plan = b.kind === 'res' ? this.homePlan(b) : this.venuePlan(b);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.body = new THREE.Mesh(this.plan.geo, mat);
    this.body.castShadow = true; this.body.receiveShadow = true;
    const c = footCenter(b);
    this.group.position.set(c.x, 0, c.z);
    this.group.add(this.body);
    for (const l of this.plan.lamps) this.group.add(l);
    this.group.visible = true;
    this.buildings.setHidden(b, true);
    if (!this.saved) this.saved = { dist: this.rig.gDist, pitch: this.rig.gPitch, min: this.rig.minDist };
    this.rig.minDist = InteriorView.MIN;
    this.rig.focus(c.x, c.z + 0.02, Math.max(3.2, this.plan.w * 3.9));
    this.rig.gPitch = 1.1;
    this.refreshAt = 0;
    this.onChange(b);
  }

  private hideSilently() {
    if (this.b) this.buildings.setHidden(this.b, false);
    for (const f of this.figs) this.group.remove(f.g);
    this.figs = [];
    for (const l of this.plan?.lamps ?? []) this.group.remove(l);
    if (this.body) { this.group.remove(this.body); this.body.geometry.dispose(); (this.body.material as THREE.Material).dispose(); this.body = null; }
    this.group.visible = false;
    this.light.intensity = 0;
    this.b = null;
    this.plan = null;
  }

  hide() {
    if (!this.b) return;
    const c = footCenter(this.b);
    this.hideSilently();
    if (this.saved) {
      this.rig.minDist = this.saved.min;
      this.rig.gPitch = this.saved.pitch;
      this.rig.focus(c.x, c.z, Math.max(this.saved.dist, 14));
      this.saved = null;
    }
    this.onChange(null);
  }

  /** where a person inside is standing, for the marker */
  posOf(p: Person): { x: number; y: number; z: number } | null {
    for (const f of this.figs) if (f.p === p) return { x: this.group.position.x + f.x, y: 0.2, z: this.group.position.z + f.z };
    return null;
  }

  pick(x: number, z: number, r = 0.08): Person | null {
    let best: Person | null = null, bd = r * r;
    for (const f of this.figs) {
      const dx = this.group.position.x + f.x - x, dz = this.group.position.z + f.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = f.p; }
    }
    return best;
  }

  // ------------------------------------------------------------ people

  private mat(hex: number) {
    let m = this.mats.get(hex);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }); this.mats.set(hex, m); }
    return m;
  }

  private makeFig(p: Person): THREE.Group {
    const L = decodeLook(p.look);
    const g = new THREE.Group();
    const kid = p.age < 13;
    const s = kid ? 0.72 : 1;
    const torso = new THREE.Mesh(this.geo.torso, this.mat(SHIRT[L.shirt]));
    torso.position.y = 0.035;
    const legs = new THREE.Mesh(this.geo.legs, this.mat(0x2d3340));
    legs.position.y = 0.009;
    const head = new THREE.Mesh(this.geo.head, this.mat(parseInt(SKIN[L.skin].slice(1), 16)));
    head.position.y = 0.064;
    const hair = new THREE.Mesh(this.geo.hair, this.mat(p.age >= 65 ? 0xb9bcc2 : parseInt(HAIR[L.hairColor].slice(1), 16)));
    hair.position.y = 0.0665;
    const armL = new THREE.Mesh(this.geo.arm, this.mat(parseInt(SKIN[L.skin].slice(1), 16)));
    armL.position.set(-0.0125, 0.036, 0);
    const armR = armL.clone(); armR.position.x = 0.0125;
    for (const m of [torso, legs, head, hair, armL, armR]) { m.castShadow = true; g.add(m); }
    g.scale.setScalar(1.35 * s);
    g.userData.legs = legs; g.userData.torso = torso; g.userData.s = 1.35 * s;
    return g;
  }

  /** what a person is up to, as a place to be */
  private intent(p: Person, resident: boolean, hour: number, slot: number): string {
    const city = this.game.city;
    if (!resident) return 'living';
    const act = city.activityOf(p, hour);
    if (act === 'Sleeping') return 'bed';
    if (this.b && this.b.partyUntil > this.game.t) return 'party';
    if (p.needs.bladder < 0.22) return 'toilet';
    if (p.needs.hygiene < 0.3) return 'shower';
    if (act.startsWith('Having ')) return 'table';
    if (p.remote) return 'desk';
    const pick = ['sofa', 'tv', 'kitchen', 'stand', 'sofa', 'table'];
    return pick[(slot * 7 + p.id * 3) % pick.length];
  }

  private venueIntent(p: Person, worker: boolean, slot: number): string {
    if (worker) return p.id % 3 === 0 ? 'desk' : 'counter';
    return ['seat', 'seat', 'stand', 'seat'][(slot + p.id) % 4];
  }

  private refreshPeople() {
    const b = this.b!, plan = this.plan!;
    const inside: { p: Person; resident: boolean; worker: boolean }[] = [];
    if (b.kind === 'res') {
      for (const p of b.residents) if (!p.dead && p.at === b && p.phase === 'none' && (p.state === 'home' || p.state === 'leisure')) inside.push({ p, resident: true, worker: false });
      for (const p of b.guests) if (!p.dead && !inside.some((x) => x.p === p)) inside.push({ p, resident: false, worker: false });
    } else {
      for (const p of b.workers) if (!p.dead && p.at === b && p.phase === 'none' && !p.student) inside.push({ p, resident: false, worker: true });
      for (const p of b.guests) if (!p.dead) inside.push({ p, resident: false, worker: false });
    }
    inside.length = Math.min(inside.length, 16);
    // drop those who left
    for (let i = this.figs.length - 1; i >= 0; i--) if (!inside.some((x) => x.p === this.figs[i].p)) { this.group.remove(this.figs[i].g); this.figs.splice(i, 1); }
    const flatOf = (p: Person) => { const hs = this.households(b); const k = hs.indexOf(p.hh); return k < 0 ? 0 : Math.min(k, plan.flats.length - 1); };
    for (const it of inside) {
      if (this.figs.some((f) => f.p === it.p)) continue;
      const flat = b.kind === 'res' ? flatOf(it.p) : 0;
      const door = plan.flats[flat].door?.[0] ?? { x: 0, z: plan.d / 2, pose: 'stand' as Pose, face: 0 };
      const g = this.makeFig(it.p);
      g.position.set(door.x, 0.012, door.z);
      this.group.add(g);
      this.figs.push({ p: it.p, g, flat, x: door.x, z: door.z, spot: door, kind: '', until: 0, walking: true });
    }
  }

  private households(b: Building) {
    const hs: Person['hh'][] = [];
    for (const p of b.residents) if (!hs.includes(p.hh)) hs.push(p.hh);
    hs.sort((a, c) => c.members.length - a.members.length);
    return hs.slice(0, 4);
  }

  update(dt: number, time: number) {
    if (!this.b || !this.plan) return;
    const b = this.b;
    // the building changed under us
    if (!this.game.city.buildings.has(b.id) || b.level !== this.level) { this.hide(); return; }
    const t = this.game.t, hour = hourOf(t);
    if (time >= this.refreshAt) { this.refreshAt = time + 0.6; this.refreshPeople(); }
    const plan = this.plan;
    let slot = 0;
    for (const f of this.figs) {
      slot++;
      const resident = f.p.home === b;
      if (t >= f.until) {
        const kind = b.kind === 'res' ? this.intent(f.p, resident, hour, Math.floor(t / 22) + slot) : this.venueIntent(f.p, b.workers.includes(f.p), Math.floor(t / 30) + slot);
        const spots = plan.flats[f.flat][kind] ?? plan.flats[f.flat].stand ?? [];
        if (spots.length) {
          // two people never share a spot while there is another to take
          let rank = 0;
          for (const o of this.figs) { if (o === f) break; if (o.flat === f.flat && o.kind === kind) rank++; }
          const pick = kind === 'bed' || kind === 'table' || kind === 'seat' || kind === 'sofa' ? spots[rank % spots.length] : spots[(f.p.id + Math.floor(t / 40)) % spots.length];
          if (kind !== f.kind || pick !== f.spot) { f.spot = pick; f.walking = true; }
        }
        f.kind = kind;
        f.until = t + 10 + ((f.p.id * 13) % 9);
      }
      // walk to the spot
      const dx = f.spot.x - f.x, dz = f.spot.z - f.z, d = Math.hypot(dx, dz);
      const sp = 0.16 * dt * 1.5;
      if (d > 0.004) {
        const k = Math.min(1, sp / d);
        f.x += dx * k; f.z += dz * k;
        f.g.rotation.set(0, -Math.atan2(dz, dx) + Math.PI / 2, 0);
        f.g.position.y = 0.012 + Math.abs(Math.sin(time * 9 + f.p.id)) * 0.003;
        f.g.scale.y = f.g.userData.s;
      } else {
        f.walking = false;
        const pose = f.spot.pose;
        f.g.rotation.y = f.spot.face;
        if (pose === 'lie') { f.g.rotation.set(-Math.PI / 2, 0, 0); f.g.rotation.order = 'YXZ'; f.g.rotation.y = f.spot.face; f.g.position.y = 0.062; }
        else if (pose === 'sit') { f.g.position.y = 0.002; f.g.scale.y = f.g.userData.s * 0.82; }
        else { f.g.position.y = 0.012; f.g.scale.y = f.g.userData.s; }
      }
      f.g.position.x = f.x; f.g.position.z = f.z;
      if (f.walking || f.spot.pose !== 'lie') { if (f.walking) f.g.rotation.x = 0; }
    }
    // lamps glow after dark
    const night = hour < 6.5 || hour > 18.5;
    for (const l of plan.lamps) (l.material as THREE.MeshStandardMaterial).emissiveIntensity = night ? 2.4 : 0.15;
    this.light.intensity += ((night ? 2.2 : 0) - this.light.intensity) * Math.min(1, dt * 4);
  }

  // ------------------------------------------------------------ rooms

  /** a flat or house: living room and kitchen on the left, bedroom and bathroom on the right */
  private flat(b: MeshBuilder, ox: number, oz: number, w: number, d: number, r: () => number, spots: Record<string, Spot[]>, lamps: THREE.Mesh[]) {
    const sf = Math.min(1, w / 0.9);
    const x0 = ox - w / 2, x1 = ox + w / 2, z0 = oz - d / 2, z1 = oz + d / 2;
    const split = x0 + w * 0.62, zb = oz - d * 0.06;
    const WH = 0.07, T = 0.012;
    const fab = lin(FABRIC[(r() * FABRIC.length) | 0]), fab2 = lin(FABRIC[(r() * FABRIC.length) | 0]);
    const add = (k: string, s: Spot) => { (spots[k] ??= []).push(s); };
    b.paintW = 0;
    // floors
    b.box(ox, 0.012, oz, w, 0.006, d, SLAB);
    b.floor((x0 + split) / 2, 0.0185, (z1 + oz + d * 0.06) / 2, split - x0 - 0.004, z1 - oz - d * 0.06 - 0.004, WOOD);
    for (let i = 0; i < 6; i++) b.floor((x0 + split) / 2, 0.019, oz + d * 0.06 + (z1 - oz - d * 0.06) * (i + 0.5) / 6, split - x0 - 0.004, 0.003, WOOD2);
    b.floor((x0 + split) / 2, 0.0185, (z0 + oz + d * 0.06) / 2, split - x0 - 0.004, oz + d * 0.06 - z0 - 0.004, TILE);
    b.floor((split + x1) / 2, 0.0185, (z0 + zb) / 2, x1 - split - 0.004, zb - z0 - 0.004, lin(0xd9c7c0));
    b.floor((split + x1) / 2, 0.0185, (zb + z1) / 2, x1 - split - 0.004, z1 - zb - 0.004, TILE2);
    // rug
    b.floor(x0 + w * 0.3, 0.0195, oz + d * 0.28, w * 0.34, d * 0.26, shade3(fab, 0.9));
    // walls: outer ring with a doorway at the front, inner partitions with gaps
    const wall = (cx: number, cz: number, ww: number, dd: number) => b.box(cx, 0.018, cz, ww, WH, dd, WALL, { top: WALL_IN });
    wall(ox, z0, w, T); wall(x0, oz, T, d); wall(x1, oz, T, d);
    const doorW = 0.1 * sf + 0.03, doorX = x0 + w * 0.28;
    wall((x0 + doorX - doorW / 2) / 2, z1, doorX - doorW / 2 - x0, T);
    wall((doorX + doorW / 2 + x1) / 2, z1, x1 - doorX - doorW / 2, T);
    const gap = 0.09 * sf + 0.02;
    // vertical partition with a doorway
    b.box(split, 0.018, (z0 + (oz - gap / 2)) / 2, T, WH, (oz - gap / 2) - z0, WALL, { top: WALL_IN });
    b.box(split, 0.018, ((oz + gap / 2) + z1) / 2, T, WH, z1 - (oz + gap / 2), WALL, { top: WALL_IN });
    // bedroom / bathroom partition with a doorway
    const bg = 0.08 * sf + 0.02, bgx = split + (x1 - split) * 0.5;
    b.box((split + bgx - bg / 2) / 2, 0.018, zb, bgx - bg / 2 - split, WH, T, WALL, { top: WALL_IN });
    b.box((bgx + bg / 2 + x1) / 2, 0.018, zb, x1 - bgx - bg / 2, WH, T, WALL, { top: WALL_IN });
    // front door
    b.box(doorX, 0.018, z1 + 0.001, doorW - 0.01, 0.003, 0.03 * sf, lin(0x7a4b3a));
    add('door', { x: doorX, z: z1 - 0.03, pose: 'stand', face: Math.PI });

    // ---- living room: sofa facing a TV, coffee table, plant
    const lx = x0 + w * 0.26, lz = oz + d * 0.3;
    b.box(lx + 0.0, 0.02, lz, 0.13 * sf, 0.03 * sf, 0.06 * sf, fab);
    b.box(lx + 0.0, 0.05 * sf, lz + 0.026 * sf, 0.13 * sf, 0.03 * sf, 0.014 * sf, shade3(fab, 0.85));
    b.box(lx - 0.07 * sf, 0.02, lz, 0.016 * sf, 0.04 * sf, 0.06 * sf, shade3(fab, 0.8)); b.box(lx + 0.07 * sf, 0.02, lz, 0.016 * sf, 0.04 * sf, 0.06 * sf, shade3(fab, 0.8));
    add('sofa', { x: lx, z: lz - 0.004, pose: 'sit', face: Math.PI });
    add('sofa', { x: lx + 0.04 * sf, z: lz - 0.004, pose: 'sit', face: Math.PI });
    b.box(lx, 0.02, lz - 0.075 * sf, 0.07 * sf, 0.018 * sf, 0.035 * sf, WOOD2);
    b.box(lx, 0.02, z1 - 0.045 * sf, 0.12 * sf, 0.03 * sf, 0.025 * sf, lin(0x6a4b36));
    const tv = b.count; void tv;
    b.box(lx, 0.05 * sf, z1 - 0.045 * sf, 0.09 * sf, 0.05 * sf, 0.008 * sf, lin(0x1c2128), { emit: 0.0 });
    b.box(lx, 0.058 * sf, z1 - 0.04 * sf, 0.08 * sf, 0.036 * sf, 0.002, lin(0x6fb4e0), { emit: 1.8 });
    add('tv', { x: lx, z: lz - 0.004, pose: 'sit', face: Math.PI });
    add('stand', { x: lx - 0.12 * sf, z: lz - 0.02, pose: 'stand', face: Math.PI * 0.5 });
    b.blob(x0 + 0.035 * sf, 0.05 * sf, z1 - 0.04 * sf, 0.022 * sf, 0.032 * sf, 0.022 * sf, lin(0x5fae55), 6, 4);
    b.cyl(x0 + 0.035 * sf, 0.019, z1 - 0.04 * sf, 0.012 * sf, 0.01 * sf, 0.02 * sf, lin(0xb3563f), 6);
    // ---- kitchen: counter run along the back wall, a fridge, a dining table
    const ky = z0 + 0.03 * sf + T;
    b.box(x0 + 0.04 * sf + T, 0.019, ky + 0.002, 0.05 * sf, 0.09 * sf, 0.045 * sf, lin(0xeef1f3));        // fridge
    b.box(x0 + 0.115 * sf, 0.019, ky, 0.09 * sf, 0.04 * sf, 0.05 * sf, lin(0xb9aea0), { top: lin(0x4a4f57) });  // counter + hob
    b.box(x0 + 0.115 * sf, 0.059, ky, 0.06 * sf, 0.002, 0.03 * sf, lin(0x2a2d33));
    for (const bx of [-0.012, 0.012]) b.cyl(x0 + 0.115 * sf + bx, 0.0615, ky - 0.006, 0.006 * sf, 0.006 * sf, 0.002, lin(0xd0d4d9), 6);
    b.box(x0 + 0.205 * sf, 0.019, ky, 0.08 * sf, 0.04 * sf, 0.05 * sf, lin(0xb9aea0), { top: lin(0xdfe3e6) });  // sink
    b.box(x0 + 0.205 * sf, 0.059, ky - 0.004, 0.035 * sf, 0.004, 0.022 * sf, lin(0x8fa0aa));
    add('kitchen', { x: x0 + 0.14 * sf, z: ky + 0.05 * sf, pose: 'stand', face: 0 });
    add('kitchen', { x: x0 + 0.205 * sf, z: ky + 0.05 * sf, pose: 'stand', face: 0 });
    const tx = x0 + w * 0.34, tz = oz - d * 0.12;
    b.cyl(tx, 0.019, tz, 0.032 * sf, 0.032 * sf, 0.036 * sf, lin(0xa9805a), 10);
    b.cyl(tx, 0.019, tz, 0.006 * sf, 0.006 * sf, 0.036 * sf, lin(0x6a4b36), 5);
    for (const [cx2, cz2, face] of [[-1, 0, Math.PI * 0.5], [1, 0, -Math.PI * 0.5]] as const) {
      b.box(tx + cx2 * 0.05 * sf, 0.019, tz + cz2, 0.026 * sf, 0.026 * sf, 0.026 * sf, fab2);
      add('table', { x: tx + cx2 * 0.05 * sf, z: tz + cz2, pose: 'sit', face });
    }
    b.cyl(tx, 0.055, tz, 0.01 * sf, 0.008 * sf, 0.012 * sf, lin(0xe8e1d4), 6);
    add('stand', { x: tx, z: tz + 0.075 * sf, pose: 'stand', face: Math.PI });
    for (let k = 0; k < 4; k++) add('party', { x: x0 + w * (0.1 + 0.14 * k), z: oz + d * (0.1 + 0.12 * (k % 2)), pose: 'stand', face: k * 1.7 });
    // ---- bedroom: a double bed under the back wall, wardrobe, bedside lamp
    const bx = split + (x1 - split) * 0.45, bz = z0 + 0.055 * sf + T;
    b.box(bx, 0.019, bz + 0.02 * sf, 0.08 * sf, 0.022 * sf, 0.115 * sf, lin(0x8a6a4a));
    b.box(bx, 0.039, bz + 0.026 * sf, 0.074 * sf, 0.016 * sf, 0.1 * sf, fab2);
    b.box(bx, 0.0535, bz - 0.022 * sf, 0.06 * sf, 0.012 * sf, 0.03 * sf, lin(0xf7f4ee));
    b.box(bx, 0.047, bz + 0.04 * sf, 0.076 * sf, 0.004, 0.06 * sf, shade3(fab2, 0.85));
    add('bed', { x: bx - 0.017 * sf, z: bz + 0.012 * sf, pose: 'lie', face: 0 });
    add('bed', { x: bx + 0.017 * sf, z: bz + 0.012 * sf, pose: 'lie', face: 0 });
    add('bed', { x: lx - 0.01 * sf, z: lz + 0.004, pose: 'lie', face: Math.PI / 2 });
    b.box(x1 - 0.022 * sf, 0.019, bz + 0.02 * sf, 0.03 * sf, 0.1 * sf, 0.06 * sf, lin(0xb08a5e));
    const lampM = b.count; void lampM;
    b.box(bx + 0.058 * sf, 0.019, bz - 0.02 * sf, 0.02 * sf, 0.022 * sf, 0.02 * sf, lin(0x8a6a4a));
    b.box(bx + 0.058 * sf, 0.041, bz - 0.02 * sf, 0.016 * sf, 0.014 * sf, 0.016 * sf, lin(0xffe2a8), { emit: 1.6 });
    add('desk', { x: split + 0.05 * sf, z: zb - 0.045 * sf, pose: 'sit', face: Math.PI * 0.5 });
    b.box(split + 0.022 * sf + T, 0.019, zb - 0.045 * sf, 0.03 * sf, 0.032 * sf, 0.07 * sf, lin(0xc8b08a));
    b.box(split + 0.02 * sf + T, 0.051, zb - 0.045 * sf, 0.006 * sf, 0.03 * sf, 0.04 * sf, lin(0x1c2128));
    // ---- bathroom: toilet, basin, shower
    const by = zb + 0.035 * sf;
    b.box(x1 - 0.03 * sf, 0.019, by + 0.015 * sf, 0.04 * sf, 0.03 * sf, 0.028 * sf, lin(0xf4f6f8));
    b.cyl(x1 - 0.06 * sf, 0.019, by + 0.015 * sf, 0.016 * sf, 0.014 * sf, 0.022 * sf, lin(0xf4f6f8), 8);
    add('toilet', { x: x1 - 0.06 * sf, z: by + 0.05 * sf, pose: 'stand', face: 0 });
    b.box(split + (x1 - split) * 0.3, 0.019, z1 - 0.035 * sf - T, 0.08 * sf, 0.03 * sf, 0.05 * sf, lin(0xf4f6f8));
    b.box(split + (x1 - split) * 0.3, 0.04, z1 - 0.035 * sf - T, 0.065 * sf, 0.004, 0.036 * sf, lin(0x9ed0e8));
    add('shower', { x: split + (x1 - split) * 0.3, z: z1 - 0.08 * sf, pose: 'stand', face: Math.PI });
    b.box(split + (x1 - split) * 0.78, 0.019, z1 - 0.03 * sf - T, 0.03 * sf, 0.036 * sf, 0.03 * sf, lin(0xdfe3e6));
    // a light over the living room that comes on at night
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffd58a, emissiveIntensity: 0.2 }));
    lamp.position.set(lx, 0.17, oz + d * 0.14);
    lamps.push(lamp);
    spots.stand = (spots.stand ?? []).concat([
      { x: x0 + w * 0.16, z: oz + d * 0.12, pose: 'stand', face: 0 }, { x: x0 + w * 0.5, z: oz + d * 0.16, pose: 'stand', face: 2 }, { x: split - 0.05 * sf, z: oz - d * 0.02, pose: 'stand', face: 1 },
    ]);
    spots.living = [...(spots.party ?? []), ...(spots.stand ?? []), ...(spots.sofa ?? [])];
    if (!spots.counter) spots.counter = spots.kitchen;
  }

  private homePlan(b: Building): Plan {
    const r = mulberry32(b.id * 7919 + 5);
    const mb = new MeshBuilder();
    mb.paintW = 0;
    const flats: Record<string, Spot[]>[] = [];
    const lamps: THREE.Mesh[] = [];
    const hh = Math.max(1, this.households(b).length);
    const multi = b.level > 1 && hh > 1;
    const fw = b.level === 1 ? 0.9 : 0.5, fd = 0.6;
    const cols = multi ? 2 : 1, rows = multi ? Math.min(2, Math.ceil(hh / 2)) : 1;
    const W = cols * fw + (cols - 1) * 0.04, D = rows * fd + (rows - 1) * 0.05;
    // the lot and a path to the door
    mb.floor(0, 0.0125, 0, Math.max(W + 0.14, 1.0), Math.max(D + 0.14, 1.0), r() < 0.5 ? GRASS : GRASS2);
    for (let k = 0; k < cols * rows; k++) {
      const ox = -W / 2 + fw / 2 + (k % cols) * (fw + 0.04), oz = -D / 2 + fd / 2 + Math.floor(k / cols) * (fd + 0.05);
      const sp: Record<string, Spot[]> = {};
      this.flat(mb, ox, oz, fw, fd, r, sp, lamps);
      flats.push(sp);
      // path from the door to the edge of the lot
      mb.floor(ox - fw / 2 + fw * 0.28, 0.0188, oz + fd / 2 + 0.055, 0.07, 0.11, lin(0xe8e2d4));
    }
    // garden
    const gz = D / 2 + 0.04;
    for (const sx of [-1, 1]) {
      mb.cyl(sx * (W / 2 + 0.05), 0.0125, -D * 0.25 + sx * 0.05, 0.012, 0.01, 0.07, lin(0x7a5a3c), 5, { cap: false });
      mb.blob(sx * (W / 2 + 0.05), 0.1, -D * 0.25 + sx * 0.05, 0.06, 0.065, 0.06, lin(sx > 0 ? 0x5fae55 : 0x74be5a), 6, 4);
    }
    for (let k = 0; k < 4; k++) mb.blob(-W / 2 + 0.08 + k * 0.2, 0.02, gz + 0.02, 0.035, 0.026, 0.035, lin(0x5fae55), 6, 3);
    void gz;
    return { geo: mb.geometry(), flats, w: W, d: D, lamps };
  }

  /** a shop floor: fixtures by what the place is */
  private venuePlan(b: Building): Plan {
    const r = mulberry32(b.id * 6151 + 1);
    const mb = new MeshBuilder();
    mb.paintW = 0;
    const W = 0.94, D = 0.74, sp: Record<string, Spot[]> = {};
    const lamps: THREE.Mesh[] = [];
    const add = (k: string, s: Spot) => { (sp[k] ??= []).push(s); };
    const v = b.venue!;
    const x0 = -W / 2, z0 = -D / 2, z1 = D / 2, T = 0.012, WH = 0.075;
    mb.floor(0, 0.0125, 0, 1.06, 1.0, lin(0x9a9d94));
    mb.box(0, 0.012, 0, W, 0.006, D, SLAB);
    const floorCol = v === 'cafe' || v === 'diner' || v === 'bar' ? WOOD : v === 'gym' ? lin(0x4a5058) : v === 'cinema' ? lin(0x4a3a4c) : v === 'office' ? lin(0xb7bcc4) : lin(0xe6dfd0);
    mb.floor(0, 0.0185, 0, W - 0.004, D - 0.004, floorCol);
    const wall = (cx: number, cz: number, ww: number, dd: number) => mb.box(cx, 0.018, cz, ww, WH, dd, WALL, { top: WALL_IN });
    wall(0, z0, W, T); wall(x0, 0, T, D); wall(W / 2, 0, T, D);
    wall(-0.2 - 0.0, z1, W / 2 - 0.1 - 0.0, T); wall(0.28, z1, W / 2 - 0.12, T);
    mb.box(0.04, 0.018, z1, 0.18, 0.003, 0.02, lin(0x3b86d6));
    add('door', { x: 0.04, z: z1 - 0.03, pose: 'stand', face: Math.PI });
    const fab = lin(FABRIC[(r() * FABRIC.length) | 0]);
    const chair = (x: number, z: number, face: number) => { mb.box(x, 0.019, z, 0.024, 0.024, 0.024, fab); add('seat', { x, z, pose: 'sit', face }); };
    const table = (x: number, z: number) => { mb.cyl(x, 0.019, z, 0.034, 0.034, 0.034, lin(0xa9805a), 10); mb.cyl(x, 0.019, z, 0.005, 0.005, 0.034, lin(0x6a4b36), 5); chair(x - 0.06, z, Math.PI / 2); chair(x + 0.06, z, -Math.PI / 2); mb.cyl(x, 0.053, z, 0.009, 0.007, 0.01, lin(0xe8e1d4), 6); };
    const counter = (len: number) => {
      mb.box(0, 0.019, z0 + 0.08, len, 0.05, 0.05, lin(0x7d5a3c), { top: lin(0xe8e1d4) });
      mb.box(0, 0.069, z0 + 0.08, len * 0.3, 0.012, 0.03, lin(0x2a2d33));
      for (let k = 0; k < 4; k++) { const sx = -len / 2 + 0.1 + k * (len - 0.2) / 3; mb.cyl(sx, 0.019, z0 + 0.135, 0.011, 0.011, 0.022, lin(0xc7ccd1), 6); add('seat', { x: sx, z: z0 + 0.135, pose: 'sit', face: 0 }); }
      add('counter', { x: -0.1, z: z0 + 0.035, pose: 'stand', face: Math.PI }); add('counter', { x: 0.14, z: z0 + 0.035, pose: 'stand', face: Math.PI });
      for (let k = 0; k < 5; k++) mb.box(-len / 2 + 0.1 + k * (len - 0.2) / 4, 0.07, z0 + 0.02, 0.022, 0.05, 0.016, lin([0x9ec27a, 0xd9a54a, 0xb85a4a, 0x7aa6c8, 0xc9b0d8][k]));
    };
    if (v === 'cafe' || v === 'diner' || v === 'bar') {
      counter(v === 'bar' ? 0.7 : 0.54);
      table(-0.25, 0.04); table(0.2, 0.06); table(-0.22, 0.26); table(0.24, 0.27);
      add('stand', { x: 0, z: 0.16, pose: 'stand', face: 0 });
      add('desk', { x: -0.1, z: z0 + 0.035, pose: 'stand', face: Math.PI });
    } else if (v === 'gym') {
      for (let k = 0; k < 4; k++) {
        const tx = -0.3 + k * 0.2, tz = z0 + 0.14;
        mb.box(tx, 0.019, tz, 0.08, 0.016, 0.12, lin(0x2a2d33));
        mb.box(tx, 0.035, tz - 0.05, 0.07, 0.07, 0.012, lin(0x3d424a));
        mb.box(tx, 0.098, tz - 0.05, 0.05, 0.02, 0.01, lin(0x6fb4e0), { emit: 1.2 });
        add('seat', { x: tx, z: tz + 0.005, pose: 'stand', face: 0 });
      }
      mb.box(-0.25, 0.019, 0.1, 0.16, 0.02, 0.06, lin(0x3d424a)); mb.box(-0.25, 0.039, 0.1, 0.14, 0.012, 0.045, lin(0xd4553e));
      add('stand', { x: -0.25, z: 0.19, pose: 'stand', face: Math.PI }); add('stand', { x: 0.1, z: 0.12, pose: 'stand', face: 1 });
      mb.floor(0.25, 0.0192, 0.14, 0.3, 0.2, lin(0x8f6fd0));
      add('stand', { x: 0.25, z: 0.14, pose: 'stand', face: 2 });
      mb.box(0, 0.03, z1 - 0.02, W - 0.1, 0.07, 0.006, lin(0xaec9d8), { emit: 0.5 });
    } else if (v === 'cinema') {
      mb.box(0, 0.03, z0 + 0.02, 0.76, 0.1, 0.012, lin(0xeef3f8), { emit: 1.6 });
      for (let row = 0; row < 3; row++) for (let k = 0; k < 6; k++) {
        const sx = -0.32 + k * 0.128, sz = -0.05 + row * 0.15;
        mb.box(sx, 0.019, sz, 0.07, 0.03, 0.05, lin(0xb3342f)); mb.box(sx, 0.049, sz + 0.02, 0.07, 0.03, 0.012, lin(0x8e2722));
        add('seat', { x: sx, z: sz, pose: 'sit', face: 0 });
      }
      add('stand', { x: -0.36, z: 0.3, pose: 'stand', face: 0 }); add('counter', { x: 0.34, z: 0.3, pose: 'stand', face: Math.PI });
      mb.box(0.34, 0.019, 0.26, 0.2, 0.045, 0.04, lin(0x7d5a3c), { top: lin(0xe8e1d4) });
    } else if (v === 'office') {
      for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) {
        const dx = -0.28 + k * 0.28, dz = -0.2 + row * 0.3;
        mb.box(dx, 0.019, dz, 0.15, 0.03, 0.08, lin(0xc8b08a), { top: lin(0xdfd5c0) });
        mb.box(dx, 0.049, dz - 0.025, 0.05, 0.04, 0.006, lin(0x1c2128)); mb.box(dx, 0.052, dz - 0.021, 0.044, 0.03, 0.002, lin(0x6fb4e0), { emit: 1.4 });
        mb.box(dx, 0.019, dz + 0.07, 0.03, 0.03, 0.03, lin(0x3d424a));
        add('desk', { x: dx, z: dz + 0.07, pose: 'sit', face: Math.PI }); add('counter', { x: dx, z: dz + 0.07, pose: 'sit', face: Math.PI });
        add('seat', { x: dx, z: dz + 0.07, pose: 'sit', face: Math.PI });
      }
      add('stand', { x: 0.3, z: 0.3, pose: 'stand', face: 0 });
      mb.cyl(-0.38, 0.019, 0.3, 0.02, 0.02, 0.12, lin(0x5fae55), 6);
    } else {
      for (let k = 0; k < 3; k++) { mb.box(-0.25 + k * 0.25, 0.019, -0.12, 0.1, 0.09, 0.45 * 0.5, lin(0xc8b08a)); for (let j = 0; j < 3; j++) mb.box(-0.25 + k * 0.25, 0.04 + j * 0.028, -0.12, 0.09, 0.012, 0.2, lin([0xe24a4a, 0x3b86d6, 0xf2a03d][(j + k) % 3])); add('stand', { x: -0.25 + k * 0.25 + 0.09, z: -0.12, pose: 'stand', face: 1.5 }); }
      mb.box(0.3, 0.019, 0.26, 0.18, 0.045, 0.05, lin(0x7d5a3c), { top: lin(0xe8e1d4) });
      add('counter', { x: 0.3, z: 0.31, pose: 'stand', face: Math.PI });
      add('seat', { x: 0.0, z: 0.2, pose: 'stand', face: 0 });
    }
    // details every place has: an entrance mat, plants in the corners, a window seat, things on the walls
    mb.floor(0.04, 0.0192, z1 - 0.06, 0.2, 0.07, lin(0x6a4b36));
    for (const [px, pz] of [[x0 + 0.04, z1 - 0.05], [-x0 - 0.04, z1 - 0.05], [-x0 - 0.04, z0 + 0.05]] as const) {
      mb.cyl(px, 0.019, pz, 0.016, 0.013, 0.026, lin(0xb3563f), 7);
      mb.blob(px, 0.062, pz, 0.026, 0.034, 0.026, lin(0x5fae55), 6, 4);
    }
    mb.box(x0 + 0.02, 0.019, 0.12, 0.03, 0.026, 0.3, shade3(fab, 0.8)); mb.box(x0 + 0.014, 0.045, 0.12, 0.012, 0.03, 0.3, shade3(fab, 0.65));
    for (let k = 0; k < 4; k++) mb.box(x0 + 0.03, 0.045, -0.02 + k * 0.08, 0.02, 0.008, 0.04, lin([0xe24a4a, 0xf2c14e, 0x3b86d6, 0xffffff][k]));
    for (let k = 0; k < 5; k++) mb.box(x0 + 0.01 + k * 0.17, 0.052, z0 + 0.001, 0.07, 0.03, 0.004, lin([0x3b86d6, 0xe24a4a, 0xf2a03d, 0x4c9a74, 0x7f5bd1][(k + b.id) % 5]));
    if (v === 'cafe' || v === 'diner' || v === 'bar') {
      mb.box(0.12, 0.069, z0 + 0.08, 0.1, 0.03, 0.032, lin(0xdfe9ee), { emit: 0.25 });
      mb.box(0.12, 0.069, z0 + 0.08, 0.1, 0.003, 0.034, lin(0x6a4b36));
      for (let k = 0; k < 4; k++) mb.cyl(-0.25 + (k % 2) * 0.45 + (k > 1 ? -0.03 : 0.0), 0.053, 0.04 + (k % 2 ? 0.02 : 0) + (k > 1 ? 0.22 : 0), 0.006, 0.005, 0.008, lin(0xffffff), 6);
    }
    sp.stand = sp.stand ?? sp.seat ?? [{ x: 0, z: 0.2, pose: 'stand', face: 0 }];
    sp.seat = sp.seat ?? sp.stand;
    sp.desk = sp.desk ?? sp.counter ?? sp.stand;
    sp.counter = sp.counter ?? sp.stand;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffd58a, emissiveIntensity: 0.2 }));
    lamp.position.set(0, 0.2, 0);
    lamps.push(lamp);
    return { geo: mb.geometry(), flats: [sp], w: W, d: D, lamps };
  }
}
