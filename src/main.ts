import './style.css';
import { Game, restore } from './sim/game.ts';
import { HALF } from './sim/world.ts';
import { View } from './render/view.ts';
import { App, loadSave } from './ui/app.ts';
import { growDemo, addModes, addFreight, addAirport, addHighway } from './dev.ts';

const params = new URLSearchParams(location.search);
let game: Game;
const save = params.has('continue') ? loadSave() : null;
if (save) { try { game = restore(save); } catch (e) { console.error('save failed to load', e); game = new Game(+(params.get('seed') ?? 7)); } }
else game = new Game(+(params.get('seed') ?? 1 + Math.floor(Math.random() * 9000)), { diff: +(params.get('diff') ?? 0) });
if (params.has('demo')) growDemo(game, +(params.get('demo') || 6), !params.has('nometro'));
let modeIds: Record<string, number | null> = {};
if (params.has('modes')) modeIds = addModes(game);
if (params.has('freight')) modeIds = { ...modeIds, ...addFreight(game) };
if (params.has('airport')) modeIds = { ...modeIds, ...addAirport(game) };
if (params.has('highway')) modeIds = { ...modeIds, ...addHighway(game) };
const canvas = document.getElementById('c') as HTMLCanvasElement;
const view = new View(game, canvas);
const app = new App(game, view, { title: !params.has('play') && !params.has('demo') && !params.has('hold') });
let held = params.has('hold');
const w = window as any;
w.__game = game;
w.__view = view;
w.__app = app;
w.__hold = (v = true) => { held = v; };
w.__pump = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { game.update(dt); app.frame(dt); view.frame(dt); } };
w.__cam = (x = 0, z = 0, dist = 30, yaw = 0.72, pitch = 0.92) => { const r = view.rig; r.gTarget.set(x, 0, z); r.gDist = dist; r.gYaw = yaw; r.gPitch = pitch; r.snap(); };
w.__screen = (tx: number, ty: number) => { const p = view.rig.toScreen(new (view.rig.camera.position.constructor as any)(tx - HALF + 0.5, 0.05, ty - HALF + 0.5)); return [p.x, p.y]; };
w.__modes = modeIds;
w.__focusLine = (id: number, dist = 14, yaw = 0.7, pitch = 0.75) => { const l = game.transit.lineById.get(id); if (!l || !l.poly) return null; const p = l.poly.at(l.poly.length / 2); const r = view.rig; r.gTarget.set(p.x, 0, p.z); r.gDist = dist; r.gYaw = yaw; r.gPitch = pitch; r.snap(); return [p.x, p.z]; };
w.__focusStop = (id: number, idx = 0, dist = 7, yaw = 0.7, pitch = 0.6) => { const l = game.transit.lineById.get(id); const st = l?.stops[idx]; if (!st) return null; const r = view.rig; r.gTarget.set(st.x, 0, st.z); r.gDist = dist; r.gYaw = yaw; r.gPitch = pitch; r.snap(); return [st.x, st.z]; };
w.__ready = true;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!held) { game.update(dt); app.frame(dt); view.frame(dt); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
