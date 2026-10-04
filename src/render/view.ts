// The 3D view: owns the scene and every renderable layer, listens to the game, draws a frame.
import * as THREE from 'three';
import { Game } from '../sim/game.ts';
import { N, HALF, tileIdx, wx, wz, tileX, tileY } from '../sim/world.ts';
import { hourOf } from '../sim/types.ts';
import { U } from './gfx.ts';
import { Renderer } from './renderer.ts';
import { CameraRig } from './camera.ts';
import { Land, Sky, TimeOfDay } from './land.ts';
import { Roads } from './roads.ts';
import { BuildingsView } from './buildings.ts';
import { Props } from './props.ts';
import { Fleet, TRACK_Y } from './fleet.ts';
import { TransitGfx } from './transitgfx.ts';
import { Overlay } from './overlay.ts';
import { Particles, Rain } from './fx.ts';
import { Life } from './life.ts';
import { ParksView } from './parks.ts';

export type OverlayMode = 'none' | 'traffic' | 'transit' | 'happy';

export class View {
  scene = new THREE.Scene();
  rig = new CameraRig();
  renderer: Renderer;
  land: Land;
  sky: Sky;
  tod: TimeOfDay;
  roads: Roads;
  buildings: BuildingsView;
  props: Props;
  fleet: Fleet;
  tgfx: TransitGfx;
  overlay: Overlay;
  fx: Particles;
  rain: Rain;
  life: Life;
  parks: ParksView;
  private parksDirty = false;
  time = 0;
  rainAmt = 0;
  rainTarget = 0;
  roadsDirty = true;
  transitDirty = true;
  mode: OverlayMode = 'none';
  showRoutes = false;
  fixedHour: number | null = null;
  wind: [number, number] = [0.5, 0.2];
  cursors: { tile: number; style: 'ok' | 'bad' | 'info' | 'gold' }[] = [];
  extraRings: { x: number; z: number; r: number; color: number; alpha: number; fill: number; pulse: number }[] = [];
  private accidents = new Set<number>();
  private festival: { x: number; z: number } | null = null;
  private happyDirty = true;
  private happyTimer = 0;
  private routesKey = '';
  private frameNo = 0;
  intro = false;
  titleShift = 0;
  app_titleTarget = false;
  private shiftApplied = false;
  private blendFrom: number | null = null;
  private blend = 1;

  /** leave the fixed title-screen light and ease into the simulated time of day */
  beginHourBlend(from: number) { this.fixedHour = null; this.blendFrom = from; this.blend = 0; }

  constructor(readonly game: Game, readonly canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.scene, this.rig.camera);
    this.land = new Land(game.world, this.scene);
    this.sky = new Sky(this.scene);
    this.tod = new TimeOfDay(this.scene, this.sky, this.land);
    this.roads = new Roads(game.world, this.scene);
    this.buildings = new BuildingsView(this.scene);
    this.props = new Props(game.world, this.scene);
    this.fleet = new Fleet(this.scene, game.world);
    this.tgfx = new TransitGfx(this.scene, game.world, game.transit);
    this.overlay = new Overlay(this.scene, game.world);
    this.fx = new Particles(this.scene);
    this.rain = new Rain(this.scene);
    this.life = new Life(this.scene, game.world);
    this.parks = new ParksView(this.scene, game.world);
    this.bind();
    this.rig.gTarget.set(0, 0, 0);
    this.rig.snap();
  }

  /** (re)attach to a game — used by new-game */
  bind() {
    const game = this.game;
    for (const b of game.city.buildings.values()) this.buildings.add(b, 0, false);
    game.on('bldAdd', (b) => { this.buildings.add(b, this.time, true); this.fx.dust(wx(b.x), wz(b.y)); this.happyDirty = true; });
    game.on('bldRemove', (e) => { this.buildings.remove(e.b); this.fx.dust(wx(e.b.x), wz(e.b.y)); });
    game.on('bldLevel', (b) => { this.buildings.relevel(b, this.time); this.fx.dust(wx(b.x), wz(b.y)); });
    game.on('bldRot', (b) => this.buildings.rotate(b));
    game.on('roadsChanged', () => { this.roadsDirty = true; });
    game.on('treesChanged', () => this.props.refreshTrees());
    game.on('parkChanged', () => { this.parksDirty = true; });
    game.on('stopsChanged', () => { this.transitDirty = true; });
    game.on('linesChanged', () => { this.transitDirty = true; this.routesKey = ''; });
    game.on('districtUnlocked', () => this.land.refreshLock());
    game.on('weather', (w) => { this.rainTarget = w === 'rain' ? 1 : 0; });
    game.on('accident', (t: number) => this.accidents.add(t));
    game.on('festival', (b: any) => { this.festival = { x: wx(b.x), z: wz(b.y) }; });
    game.on('festivalEnd', () => { this.festival = null; });
    game.on('accidentClear', (t: number) => this.accidents.delete(t));
    game.on('gameOver', () => { this.rig.shake = 0.4; });
    game.on('sfx', (k: string) => { if (k === 'demolish') this.rig.shake = Math.max(this.rig.shake, 0.06); });
  }

  /** ground tile under the pointer: tile index or -1, plus the world point */
  pick(clientX: number, clientY: number): { tile: number; x: number; z: number } | null {
    const nx = (clientX / innerWidth) * 2 - 1, ny = -(clientY / innerHeight) * 2 + 1;
    const p = this.rig.groundAt(nx, ny);
    if (!p) return null;
    const tx = Math.floor(p.x + HALF), ty = Math.floor(p.z + HALF);
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return { tile: -1, x: p.x, z: p.z };
    return { tile: tileIdx(tx, ty), x: p.x, z: p.z };
  }

  setMode(m: OverlayMode) {
    this.mode = m;
    this.happyDirty = true;
    if (m !== 'happy') this.buildings.setTintMode(0, undefined, this.game.city.buildings.values());
  }

  frame(dt: number) {
    this.frameNo++;
    this.time += dt;
    const game = this.game;
    U.uTime.value = this.time;
    if (this.roadsDirty) { this.roads.rebuild(); this.props.refreshLamps(); this.roadsDirty = false; }
    if (this.parksDirty) { this.parks.rebuild(); this.parksDirty = false; }
    if (this.transitDirty) { this.tgfx.rebuild(); this.transitDirty = false; this.routesKey = ''; }
    this.rainAmt += (this.rainTarget - this.rainAmt) * (1 - Math.exp(-dt * 0.5));
    let hour = this.fixedHour ?? hourOf(game.t);
    if (this.blendFrom !== null) {
      this.blend = Math.min(1, this.blend + dt / 2.8);
      const real = hourOf(game.t);
      let d = real - this.blendFrom;
      if (d > 12) d -= 24; if (d < -12) d += 24;
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      hour = (this.blendFrom + d * k + 24) % 24;
      if (this.blend >= 1) this.blendFrom = null;
    }
    // title: the city sits to the right of the headline
    const ts = this.titleShift;
    if (ts > 0.001 || this.shiftApplied) {
      const target = this.fixedHour !== null || this.blendFrom !== null ? 1 : 0;
      void target;
    }
    this.titleShift += ((this.app_titleTarget ? 1 : 0) - this.titleShift) * (1 - Math.exp(-dt * 2.2));
    if (this.titleShift > 0.002) { this.rig.camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.19 * this.titleShift, 0, innerWidth, innerHeight); this.shiftApplied = true; }
    else if (this.shiftApplied) { this.rig.camera.clearViewOffset(); this.shiftApplied = false; }
    this.tod.update(hour, this.rainAmt, dt);
    this.renderer.setExposure(1.0);
    this.rig.update(dt);
    this.buildings.update(this.time);
    this.roads.setOverlay(this.mode === 'traffic' ? 1 : 0, game.traffic.cong, game.traffic.load);
    // lights and pools
    this.props.update();
    this.fleet.update(game.traffic, game.transit, this.accidents);
    this.tgfx.updateCrowd(this.time);
    // smoke
    const gust = 0.6 + 0.4 * Math.sin(this.time * 0.13);
    this.wind = [0.55 * gust, 0.22 * gust];
    if (game.speed > 0) for (const s of this.buildings.smoke) this.fx.smoke(`b${s.id}_${s.y.toFixed(2)}`, s.x, s.y, s.z, dt * Math.max(1, game.speed * 0.6), this.wind);
    this.fx.update(dt * (game.speed > 0 ? 1 : 0.2), this.wind);
    this.rain.update(dt, this.rig.target);
    this.life.update(dt, this.time);
    this.life.setNight(this.tod.night + this.rainAmt);
    // cursors, rings, routes
    this.overlay.setCursors(this.cursors);
    this.overlay.clearRings();
    for (const r of this.extraRings) this.overlay.addRing(r.x, r.z, r.r, r.color, r.alpha, r.fill, r.pulse);
    for (const s of game.transit.stops) {
      if (s.queue.length > s.cap * 0.85) {
        const sev = Math.min(1, s.queue.length / (s.cap * 1.4));
        this.overlay.addRing(s.x, s.z, 0.55 + sev * 0.25, 0xff4d4d, 0.9, 0.9, 1.4 + sev * 2.5);
      }
    }
    if (this.festival) this.overlay.addRing(this.festival.x, this.festival.z, 1.1 + Math.sin(this.time * 3) * 0.08, 0xffc54d, 0.95, 0.9, 1.2);
    this.overlay.flushRings();
    const beacons: { x: number; z: number; color: number }[] = [];
    for (const t of this.accidents) {
      beacons.push({ x: wx(tileX(t)), z: wz(tileY(t)), color: Math.floor(this.time * 4) % 2 ? 0xff3b30 : 0x3b82f6 });
      if (game.speed > 0) this.fx.smoke('acc' + t, wx(tileX(t)), 0.1, wz(tileY(t)), dt, [0.1, 0.05]);
    }
    if (this.festival) beacons.push({ x: this.festival.x, z: this.festival.z, color: 0xffc54d });
    this.overlay.setBeacons(beacons);
    this.updateRoutes();
    this.updateHappy(dt);
    // depth of field softness follows altitude
    this.renderer.tilt.amount = 0.0035 + Math.max(0, this.rig.dist - 22) * 0.00016;
    this.renderer.tilt.focus = 0.5;
    this.renderer.grade.night = this.tod.night;
    this.renderer.grade.warm = this.tod.warm;
    this.renderer.adapt(dt, this.time);
    this.renderer.render(dt);
  }

  private updateRoutes() {
    const tr = this.game.transit;
    const key = `${this.showRoutes}|` + tr.lines.map((l) => `${l.id}:${l.stops.length}:${l.tiles.length}`).join(',');
    if (key === this.routesKey) return;
    this.routesKey = key;
    this.overlay.clearRoutes('line:');
    if (!this.showRoutes) return;
    const router = this.game.traffic.router;
    for (const line of tr.lines) {
      const pts: { x: number; z: number }[] = [];
      if (line.kind === 'metro' && line.poly) {
        for (let d = 0; d <= line.poly.length; d += 0.15) { const p = line.poly.at(d, 0); pts.push({ x: p.x, z: p.z }); }
        this.overlay.setRoute('line:' + line.id, pts, TRACK_Y + 0.05, line.color, 0.07, { dash: 1, alpha: 0.95 });
      } else {
        for (let k = 0; k + 1 < line.stops.length; k++) {
          const path = router.find(line.stops[k].tile, line.stops[k + 1].tile);
          if (!path) continue;
          for (const t of path) pts.push({ x: wx(tileX(t)), z: wz(tileY(t)) });
        }
        this.overlay.setRoute('line:' + line.id, pts, 0.06 + line.id * 0.001, line.color, 0.1, { dash: 1, alpha: 0.9 });
      }
    }
  }

  private updateHappy(dt: number) {
    if (this.mode !== 'happy') return;
    this.happyTimer -= dt;
    if (this.happyTimer > 0 && !this.happyDirty) return;
    this.happyTimer = 1.5;
    this.happyDirty = false;
    const list = this.game.city.buildings.values();
    this.buildings.setTintMode(1, (b) => (b.kind === 'res' ? b.happy : 0.7), list);
  }
}
