// Tools and input: pointer / keyboard handling, drafting roads and lines, selection and previews.
import { Game, COST, UNLOCK, SERVICE, type ServiceKind } from '../sim/game.ts';
import { N, HALF, tileIdx, tileX, tileY, wx, wz, inMap, DX, DY, type World } from '../sim/world.ts';
import { MODES, MODE_ORDER, CARGO_ORDER, isRoadMode, isCargoMode, type Mode } from '../sim/modes.ts';
import { isIndustry, CATCH } from '../sim/industry.ts';
import type { Line } from '../sim/types.ts';
import type { View } from '../render/view.ts';
import type { App } from './app.ts';
import { TRACK_Y } from '../render/fleet.ts';
import { money } from './dom.ts';
import { venueLabel } from '../sim/people.ts';

export type ToolId = 'inspect' | 'road' | 'avenue' | 'highway' | 'transit' | 'park' | 'arena' | 'bulldoze' | 'service' | 'junction';
export const TOOL_ORDER: ToolId[] = ['inspect', 'road', 'avenue', 'highway', 'transit', 'park', 'arena', 'bulldoze', 'service', 'junction'];
export const isRoadTool = (t: ToolId) => t === 'road' || t === 'avenue' || t === 'highway';
/** what the junction tool does on click */
export type JMode = 'roundabout' | 'signals' | 'plain' | 'ramp';
export const JCODE: Record<JMode, 0 | 1 | 2 | 'ramp'> = { roundabout: 2, signals: 1, plain: 0, ramp: 'ramp' };

export type Selection = { type: 'building'; id: number } | { type: 'person'; id: number } | { type: 'stop'; id: number } | { type: 'road'; tile: number } | { type: 'line'; id: number } | null;

interface Draft { kind: Mode; tiles: number[]; extend: Line | null }

export class Tools {
  tool: ToolId = 'inspect';
  mode: Mode = 'bus';
  /** which family of lines the transit tool is building */
  group: 'people' | 'cargo' = 'people';
  service: ServiceKind = 'school';
  jmode: JMode = 'roundabout';
  lastRoad: ToolId = 'road';
  autoStops = true;
  hover: { tile: number; x: number; z: number } | null = null;
  draft: Draft | null = null;
  selection: Selection = null;
  tip: { text: string; sub?: string; bad?: boolean } | null = null;
  quote: { text: string; ok: boolean; reason?: string; cost?: number } | null = null;
  private drag: { start: number; cur: number; tiles: number[]; paint: boolean } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; moved: number; button: number; shift: boolean } | null = null;
  private pinch: { d: number; a: number } | null = null;
  private keys = new Set<string>();
  private lastX = 0;
  private lastY = 0;
  private draftKey = '';
  private bulldozed = new Set<number>();
  private moved = false;

  constructor(readonly app: App) {
    const c = app.view.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
  }

  get game(): Game { return this.app.game; }
  get view(): View { return this.app.view; }

  // ------------------------------------------------------------------ tool state

  select(t: ToolId) {
    if (t === 'avenue' && !this.game.unlocked.avenue) { this.app.toast(`Avenues unlock at ${UNLOCK.avenue} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (t === 'highway' && !this.game.unlocked.highway) { this.app.toast(`Highways unlock at ${UNLOCK.highway} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (t === 'junction' && !this.game.unlocked.junction) { this.app.toast(`Junction control unlocks at ${UNLOCK.junction} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (isRoadTool(t)) this.lastRoad = t;
    if (t === 'service' && !this.game.unlocked.school) { this.app.toast(`Schools unlock at ${UNLOCK.school} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (t === 'arena' && !this.game.unlocked.arena) { this.app.toast(`The arena unlocks at ${UNLOCK.arena.toLocaleString()} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (this.tool === t && t !== 'inspect') { this.cancelDraft(); this.tool = 'inspect'; this.app.hud.refreshTools(); this.refreshPreview(true); return; }
    this.cancelDraft();
    this.tool = t;
    this.drag = null;
    if (t !== 'inspect') this.selection = null;
    this.app.sound.sfx('click');
    this.app.hud.refreshTools();
    this.app.panels.sync();
    this.refreshPreview(true);
  }

  /** switch between street, avenue and highway without toggling the tool off */
  setRoadType(t: 'road' | 'avenue' | 'highway') {
    if (t === 'avenue' && !this.game.unlocked.avenue) { this.app.toast(`Avenues unlock at ${UNLOCK.avenue} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (t === 'highway' && !this.game.unlocked.highway) { this.app.toast(`Highways unlock at ${UNLOCK.highway} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    this.cancelDraft();
    this.tool = t; this.lastRoad = t; this.drag = null; this.selection = null;
    this.app.sound.sfx('click');
    this.app.hud.refreshTools();
    this.app.panels.sync();
    this.refreshPreview(true);
  }

  setJMode(m: JMode) {
    this.jmode = m; this.tool = 'junction';
    this.app.sound.sfx('click');
    this.app.hud.refreshTools();
    this.refreshPreview(true);
  }

  setService(k: ServiceKind) {
    if (!this.game.unlocked[k]) { this.app.toast(`${SERVICE[k].label}s unlock at ${SERVICE[k].unlock} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    this.service = k; this.tool = 'service';
    this.app.sound.sfx('click');
    this.app.hud.refreshTools();
    this.refreshPreview(true);
  }

  modeUnlocked(m: Mode) { return m === 'bus' || this.game.unlocked[m as keyof Game['unlocked']]; }

  setGroup(gp: 'people' | 'cargo') {
    if (this.draft?.extend) return;
    const list = gp === 'cargo' ? CARGO_ORDER : MODE_ORDER;
    const m = list.find((x) => this.modeUnlocked(x));
    if (!m) { this.app.toast(`Freight unlocks at ${MODES.truck.unlock} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    this.group = gp;
    this.setMode(this.mode !== m && list.includes(this.mode) && this.modeUnlocked(this.mode) ? this.mode : m);
  }

  setMode(m: Mode) {
    if (!this.modeUnlocked(m)) { this.app.toast(`${MODES[m].label} unlocks at ${MODES[m].unlock} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    if (this.draft?.extend) return;
    this.cancelDraft();
    this.mode = m;
    this.group = isCargoMode(m) ? 'cargo' : 'people';
    this.tool = 'transit';
    this.app.sound.sfx('click');
    this.app.hud.refreshTools();
    this.refreshPreview(true);
  }

  cycleMode(dir = 1) {
    const list = (this.group === 'cargo' ? CARGO_ORDER : MODE_ORDER).filter((m) => this.modeUnlocked(m));
    const i = list.indexOf(this.mode);
    this.setMode(list[(i + dir + list.length) % list.length]);
  }

  cancelDraft() {
    this.draft = null;
    this.draftKey = '';
    this.view.overlay.removeRoute('draft');
    this.view.overlay.removeRoute('draftHover');
    this.app.hud.refreshContext();
  }

  startExtend(line: Line) {
    this.tool = 'transit';
    this.mode = line.kind;
    this.group = isCargoMode(line.kind) ? 'cargo' : 'people';
    this.draft = { kind: line.kind, tiles: [], extend: line };
    this.selection = null;
    this.app.hud.refreshTools();
    this.app.panels.sync();
    this.app.hud.refreshContext();
  }

  setSelection(s: Selection) {
    this.selection = s;
    if (s) this.app.panels.open = null;
    this.app.panels.sync();
  }

  // ------------------------------------------------------------------ pointer

  private ndc(e: { clientX: number; clientY: number }) { return [(e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1] as const; }

  private onDown(e: PointerEvent) {
    if (this.app.modal) return;
    this.app.sound.init();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.moved = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
      this.drag = null; this.pan = null;
      return;
    }
    const panBtn = e.button === 2 || e.button === 1 || (e.button === 0 && (this.keys.has('Space') || this.tool === 'inspect'));
    if (panBtn) {
      this.pan = { x: e.clientX, y: e.clientY, moved: 0, button: e.button, shift: e.shiftKey };
      return;
    }
    if (e.button === 0) this.toolDown(e);
  }

  private onMove(e: PointerEvent) {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const [nx, ny] = this.ndc({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      this.view.rig.zoom(this.pinch.d / Math.max(10, d), nx, ny);
      this.view.rig.rotate(-(ang - this.pinch.a));
      this.pinch = { d, a: ang };
      this.moved = true;
      return;
    }
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (this.pan) {
      this.pan.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pan.button === 1 || (this.pan.button === 0 && this.pan.shift)) this.view.rig.rotate(-dx * 0.006, dy * 0.004);
      else this.view.rig.pan(dx, dy);
      this.moved = this.pan.moved > 4;
      if (this.moved && this.view.follow) this.app.stopFollow();
      return;
    }
    // hover / drag over canvas only
    if (e.target !== this.view.canvas && !this.drag) { if (this.hover) { this.hover = null; this.refreshPreview(); } return; }
    const pk = this.view.pick(e.clientX, e.clientY);
    this.hover = pk;
    if (this.drag && pk && pk.tile >= 0) this.dragTo(pk.tile);
    this.refreshPreview();
  }

  private onUp(e: PointerEvent) {
    const had = this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!had) return;
    if (this.pan) {
      const wasClick = this.pan.moved < 5;
      const btn = this.pan.button;
      this.pan = null;
      if (wasClick) {
        if (btn === 0 && this.tool === 'inspect') this.clickSelect(e);
        else if (btn === 2) this.rightClick();
      }
      return;
    }
    if (this.drag) this.toolUp();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (this.app.modal) return;
    const [nx, ny] = this.ndc(e);
    if (e.shiftKey) { this.view.rig.rotate(e.deltaY * 0.003); return; }
    const k = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * (e.ctrlKey ? 0.012 : 0.0016));
    this.view.rig.zoom(k, nx, ny);
  }

  private rightClick() {
    if (this.draft) {
      if (this.draft.tiles.length) { this.draft.tiles.pop(); this.refreshPreview(true); this.app.hud.refreshContext(); this.app.sound.sfx('tick'); }
      else this.cancelDraft();
    } else if (this.tool !== 'inspect') this.select('inspect');
  }

  // ------------------------------------------------------------------ tool actions

  private toolDown(e: PointerEvent) {
    const pk = this.view.pick(e.clientX, e.clientY);
    this.hover = pk;
    if (!pk || pk.tile < 0) return;
    const t = pk.tile;
    switch (this.tool) {
      case 'road': case 'avenue': case 'highway':
        this.drag = { start: t, cur: t, tiles: [t], paint: false };
        break;
      case 'junction': {
        const r = this.game.setJunction(t, JCODE[this.jmode]);
        if (!r.ok) { this.app.toast(r.msg ?? 'Cannot do that here.', 'warn'); this.app.sound.sfx('error'); }
        break;
      }
      case 'arena': {
        const r = this.game.placeArena(t);
        if (!r.ok) { this.app.toast(r.msg ?? 'Cannot build there.', 'warn'); this.app.sound.sfx('error'); }
        else { this.select('inspect'); this.setSelection({ type: 'building', id: this.game.world.bld[t] }); }
        break;
      }
      case 'service': {
        const r = this.game.placeService(this.service, t);
        if (!r.ok) { this.app.toast(r.msg ?? 'Cannot build there.', 'warn'); this.app.sound.sfx('error'); }
        else { this.select('inspect'); this.setSelection({ type: 'building', id: this.game.world.bld[t] }); }
        break;
      }
      case 'park': case 'bulldoze':
        this.drag = { start: t, cur: t, tiles: [t], paint: true };
        this.bulldozed.clear();
        this.paintTile(t);
        break;
      case 'transit':
        this.addDraftStop(t);
        break;
    }
    this.refreshPreview(true);
  }

  private dragTo(t: number) {
    const d = this.drag!;
    d.cur = t;
    if (d.paint) { this.paintTile(t); return; }
    d.tiles = this.lPath(d.start, t);
  }

  private toolUp() {
    const d = this.drag!;
    this.drag = null;
    if (d.paint) { this.bulldozed.clear(); this.refreshPreview(true); return; }
    if (isRoadTool(this.tool)) {
      const r = this.game.buildRoad(d.tiles, this.tool === 'highway' ? 3 : this.tool === 'avenue' ? 2 : 1);
      if (!r.ok) { this.app.toast(r.msg ?? 'Cannot build there.', 'warn'); this.app.sound.sfx('error'); }
      else if (!this.app.tutorialDone.road) this.app.tutorialDone.road = true;
    }
    this.refreshPreview(true);
  }

  private paintTile(t: number) {
    if (this.bulldozed.has(t)) return;
    this.bulldozed.add(t);
    const r = this.tool === 'park' ? this.game.placePark(t) : this.game.bulldoze(t);
    if (!r.ok && r.msg && this.bulldozed.size === 1) { this.app.toast(r.msg, 'warn'); this.app.sound.sfx('error'); }
  }

  /** straight line along the dominant axis, with an optional second leg for a clear diagonal drag */
  lPath(a: number, b: number): number[] {
    const ax = tileX(a), ay = tileY(a), bx = tileX(b), by = tileY(b);
    const dx = bx - ax, dy = by - ay;
    const out: number[] = [];
    const step = (x0: number, y0: number, x1: number, y1: number) => {
      const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
      let x = x0, y = y0;
      out.push(tileIdx(x, y));
      while (x !== x1 || y !== y1) { if (x !== x1) x += sx; else y += sy; out.push(tileIdx(x, y)); }
    };
    if (Math.min(Math.abs(dx), Math.abs(dy)) < 2) {
      if (Math.abs(dx) >= Math.abs(dy)) step(ax, ay, bx, ay); else step(ax, ay, ax, by);
    } else {
      if (Math.abs(dx) >= Math.abs(dy)) { step(ax, ay, bx, ay); step(bx, ay, bx, by); } else { step(ax, ay, ax, by); step(ax, by, bx, by); }
    }
    return [...new Set(out)];
  }

  // ------------------------------------------------------------------ drafts (bus / metro)

  private fail(msg: string) { this.app.toast(msg, 'warn'); this.app.sound.sfx('error'); }

  private addDraftStop(t: number) {
    const g = this.game;
    if (!this.draft) this.draft = { kind: this.mode, tiles: [], extend: null };
    const d = this.draft;
    const prev = d.extend && !d.tiles.length ? d.extend.stops[d.extend.stops.length - 1].tile : d.tiles[d.tiles.length - 1];
    if (t === prev) return;
    // extension: act immediately, one stop at a time
    if (d.extend) {
      const r = g.extendLine(d.extend, t);
      if (!r.ok) { this.fail(r.msg ?? 'Cannot extend there.'); return; }
      this.app.sound.sfx('line');
      this.app.hud.refreshContext();
      this.app.panels.sync();
      return;
    }
    const why = g.spotCheck(d.kind, t);
    if (why) { this.fail(why); return; }
    if (d.tiles.includes(t)) return;
    if (d.tiles.length) {
      let extra: number[] = [];
      if (this.autoStops) extra = g.autoStops(d.kind, prev, t).filter((x) => x !== prev && x !== t && !d.tiles.includes(x));
      const next = [...d.tiles, ...extra, t];
      const q = g.quoteLine(d.kind, next);
      if (!q.ok) {
        // fall back to just the clicked stop so the player sees the real reason
        const q2 = g.quoteLine(d.kind, [...d.tiles, t]);
        if (!q2.ok) { this.fail(q2.reason ?? 'Cannot route there.'); return; }
        extra = [];
      }
      d.tiles.push(...extra);
    }
    d.tiles.push(t);
    this.app.sound.sfx('tick');
    this.draftKey = '';
    this.app.hud.refreshContext();
  }

  finishDraft() {
    const d = this.draft;
    if (!d) return;
    if (d.extend) { this.cancelDraft(); this.tool = 'inspect'; this.app.hud.refreshTools(); return; }
    if (d.tiles.length < 2) return;
    const r = this.game.createLine(d.kind, d.tiles);
    if (!r.ok) { this.fail(r.msg ?? 'Could not build the line.'); return; }
    const line = r.line!;
    this.app.toast(`${line.name} is running with 1 ${MODES[d.kind].vehicle}. Add more from the line card.`, 'good');
    this.cancelDraft();
    this.tool = 'inspect';
    this.selection = { type: 'line', id: line.id };
    this.app.tutorialDone.bus = true;
    this.app.hud.refreshTools();
    this.app.panels.sync();
    this.refreshPreview(true);
  }

  undoDraft() {
    if (this.draft?.tiles.length) { this.draft.tiles.pop(); this.draftKey = ''; this.refreshPreview(true); this.app.hud.refreshContext(); this.app.sound.sfx('tick'); }
  }

  // ------------------------------------------------------------------ selection

  private clickSelect(e: PointerEvent) {
    const pk = this.view.pick(e.clientX, e.clientY);
    if (!pk || pk.tile < 0) { this.setSelection(null); return; }
    const g = this.game, w = g.world, t = pk.tile;
    const who = this.view.citizens.pick(pk.x, pk.z, this.pickRadius());
    if (who) { this.app.selectPerson(who); return; }
    if (w.stop[t] >= 0) this.setSelection({ type: 'stop', id: w.stop[t] });
    else if (w.bld[t] >= 0) this.setSelection({ type: 'building', id: w.bld[t] });
    else if (w.road[t]) this.setSelection({ type: 'road', tile: t });
    else this.setSelection(null);
    this.app.sound.sfx('tick');
  }

  /** how close to a citizen the pointer has to be, scaled by zoom */
  pickRadius() { return 0.2 + this.view.rig.dist * 0.0085; }

  // ------------------------------------------------------------------ keys

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!down) { this.keys.delete(e.code); return; }
    if (this.app.modal) { if (e.code === 'Escape') this.app.closeModal(); return; }
    this.keys.add(e.code);
    this.app.sound.init();
    const g = this.game;
    switch (e.code) {
      case 'Digit1': this.select('inspect'); break;
      case 'Digit2': this.select('road'); break;
      case 'Digit3': this.select('avenue'); break;
      case 'Digit4': if (this.tool === 'transit' && !this.draft) this.cycleMode(1); else this.select('transit'); break;
      case 'Digit5': this.select('park'); break;
      case 'Digit6': this.select('arena'); break;
      case 'Digit7': this.select('bulldoze'); break;
      case 'Digit8': this.select('service'); break;
      case 'Digit9': this.select('highway'); break;
      case 'Digit0': this.select('junction'); break;
      case 'BracketRight': if (this.tool === 'transit') this.cycleMode(1); break;
      case 'BracketLeft': if (this.tool === 'transit') this.cycleMode(-1); break;
      case 'Space': e.preventDefault(); this.app.togglePause(); break;
      case 'Equal': case 'NumpadAdd': this.app.setSpeed(g.speed >= 4 ? 4 : g.speed === 0 ? 1 : g.speed * 2); break;
      case 'Minus': case 'NumpadSubtract': this.app.setSpeed(g.speed <= 1 ? 1 : g.speed / 2); break;
      case 'KeyL': this.app.panels.toggle('lines'); break;
      case 'KeyP': this.app.panels.toggle('policies'); break;
      case 'KeyC': this.app.panels.toggle('citizens'); break;
      case 'KeyB': this.app.panels.toggle('company'); break;
      case 'KeyT': this.app.hud.setOverlay(this.view.mode === 'transit' ? 'none' : 'transit'); break;
      case 'KeyG': this.app.hud.setOverlay(this.view.mode === 'traffic' ? 'none' : 'traffic'); break;
      case 'KeyH': this.app.hud.setOverlay(this.view.mode === 'happy' ? 'none' : 'happy'); break;
      case 'KeyM': this.app.toggleMute(); break;
      case 'KeyU': this.app.ui.style.visibility = this.app.ui.style.visibility === 'hidden' ? '' : 'hidden'; break;
      case 'Enter': this.finishDraft(); break;
      case 'Backspace': e.preventDefault(); this.undoDraft(); break;
      case 'Escape':
        if (this.draft) this.cancelDraft();
        else if (this.tool !== 'inspect') this.select('inspect');
        else if (this.selection) this.setSelection(null);
        else if (this.app.panels.open) this.app.panels.close();
        else this.app.openPause();
        break;
      case 'Home': this.view.rig.focus(0, 0, 40); break;
    }
  }

  /** per-frame: keyboard camera */
  update(dt: number) {
    if (this.app.modal) return;
    const k = this.keys;
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    if (f || r) { this.view.rig.move(f, r, dt); if (this.view.follow) this.app.stopFollow(); }
    if (k.has('KeyQ')) this.view.rig.rotate(-dt * 1.6);
    if (k.has('KeyE')) this.view.rig.rotate(dt * 1.6);
    if (k.has('KeyR')) this.view.rig.rotate(0, dt * 0.9);
    if (k.has('KeyF')) this.view.rig.rotate(0, -dt * 0.9);
    if (k.has('KeyZ')) this.view.rig.zoom(Math.exp(-dt * 1.4), 0, 0);
    if (k.has('KeyX')) this.view.rig.zoom(Math.exp(dt * 1.4), 0, 0);
  }

  // ------------------------------------------------------------------ previews

  private pvKey = '';
  refreshPreview(force = false) {
    const g = this.game, w = g.world, v = this.view;
    const hk = this.hover ? this.hover.tile : -2;
    const key = `${this.tool}|${hk}|${this.draft ? this.draft.tiles.join(',') : ''}|${this.drag ? this.drag.tiles.length + ':' + this.drag.cur : ''}|${this.selection ? JSON.stringify(this.selection) : ''}|${Math.floor(g.money / 20)}|${g.world.version.roads}|${g.city.buildings.size}|${g.transit.stops.length}`;
    if (!force && key === this.pvKey && !this.pan) return;
    this.pvKey = key;
    const cursors: { tile: number; style: 'ok' | 'bad' | 'info' | 'gold' }[] = [];
    const rings: View['extraRings'] = [];
    this.tip = null;
    this.quote = null;
    const hv = this.hover && this.hover.tile >= 0 ? this.hover.tile : -1;
    const dragging = !!this.drag;
    switch (this.tool) {
      case 'inspect': {
        const near = hv >= 0 && !this.pan && this.hover ? v.citizens.pick(this.hover.x, this.hover.z, this.pickRadius()) : null;
        if (near) {
          this.tip = { text: `${near.first} ${near.last}`, sub: g.city.activityOf(near, g.hour) };
        } else if (hv >= 0 && !this.pan) {
          const b = g.buildingAt(hv);
          if (b) {
            cursors.push({ tile: hv, style: 'info' });
            this.tip = { text: b.kind === 'res' ? venueLabel(b) : b.name, sub: b.kind === 'res' ? `${b.residents.length} residents` : `${venueLabel(b)} · ${b.workers.length} / ${b.cap} staff` };
          } else if (w.stop[hv] >= 0) {
            const s = g.transit.stopById.get(w.stop[hv])!;
            cursors.push({ tile: hv, style: 'info' });
            this.tip = { text: s.name, sub: `${s.queue.length} waiting` };
          } else if (w.road[hv]) {
            cursors.push({ tile: hv, style: 'info' });
            const sp = g.traffic.cong[hv];
            this.tip = { text: roadLabel(w, hv), sub: sp > 0.8 ? 'Flowing' : sp > 0.45 ? 'Busy' : 'Jammed' };
          }
        }
        break;
      }
      case 'junction': {
        // light up every tile this control can go on, then judge the one under the pointer
        const code = JCODE[this.jmode];
        for (let i = 0; i < w.road.length; i++) {
          if (!w.road[i]) continue;
          if (code === 'ramp' ? (w.road[i] === 3 && !w.ramp[i] && g.nextToSurface(i)) : (w.surf(i) && w.degree(i) >= 3 && w.ctl[i] !== code)) cursors.push({ tile: i, style: 'info' });
        }
        if (hv >= 0 && w.road[hv]) {
          const why = g.junctionCheck(hv, code);
          const cost = g.junctionCost(code);
          cursors.push({ tile: hv, style: why ? 'bad' : g.money >= cost ? 'ok' : 'bad' });
          this.quote = { text: cost ? money(cost) : 'Free', ok: !why && g.money >= cost, reason: why ?? (g.money >= cost ? undefined : 'Not enough money') };
        }
        break;
      }
      case 'road': case 'avenue': case 'highway': {
        const level = this.tool === 'highway' ? 3 : this.tool === 'avenue' ? 2 : 1;
        const tiles = dragging ? this.drag!.tiles : hv >= 0 ? [hv] : [];
        if (tiles.length) {
          const pr = g.previewRoad(tiles, level);
          tiles.forEach((t, i) => cursors.push({ tile: t, style: pr.ok[i] ? (g.roadTileCost(t, level) > 0 ? 'ok' : 'info') : 'bad' }));
          const afford = pr.cost <= g.money;
          this.quote = { text: pr.cost > 0 ? money(pr.cost) : 'Nothing to build', ok: afford && pr.ok.some((x) => x) && pr.cost > 0, reason: !afford ? 'Not enough money' : pr.reason, cost: pr.cost };
          if (!afford) cursors.forEach((c) => { if (c.style === 'ok') c.style = 'bad'; });
        }
        break;
      }
      case 'arena': {
        if (hv >= 0) {
          const rf = g.city.roadFor({ x: tileX(hv), y: tileY(hv) });
          const ok = w.isUnlocked(hv) && !w.water[hv] && w.isEmpty(hv) && !w.rail[hv] && rf.tile >= 0;
          cursors.push({ tile: hv, style: ok ? 'ok' : 'bad' });
          this.quote = { text: money(COST.arena), ok: ok && g.money >= COST.arena, reason: ok ? (g.money >= COST.arena ? undefined : 'Not enough money') : 'Needs empty ground beside a road' };
        }
        break;
      }
      case 'service': {
        if (hv >= 0 && this.service === 'airport') {
          const def = SERVICE.airport;
          const pl = g.planAirport(hv);
          const tiles = pl.ok ? pl.foot : [hv];
          for (const t of tiles) cursors.push({ tile: t, style: pl.ok ? 'ok' : 'bad' });
          this.quote = { text: money(def.cost), ok: pl.ok && g.money >= def.cost, reason: pl.ok ? (g.money >= def.cost ? undefined : 'Not enough money') : pl.reason };
        } else if (hv >= 0) {
          const def = SERVICE[this.service];
          const rf = g.city.roadFor({ x: tileX(hv), y: tileY(hv) });
          const ok = w.isUnlocked(hv) && !w.water[hv] && w.isEmpty(hv) && !w.rail[hv] && rf.tile >= 0;
          cursors.push({ tile: hv, style: ok ? 'ok' : 'bad' });
          if (ok) rings.push({ x: wx(tileX(hv)), z: wz(tileY(hv)), r: this.service === 'school' ? 18 : 14, color: 0x4ade80, alpha: 0.3, fill: 1, pulse: 0 });
          this.quote = { text: money(def.cost), ok: ok && g.money >= def.cost, reason: ok ? (g.money >= def.cost ? undefined : 'Not enough money') : 'Needs empty ground beside a road' };
        }
        break;
      }
      case 'park': case 'bulldoze': {
        if (hv >= 0) {
          const ok = this.tool === 'park' ? (w.isUnlocked(hv) && !w.water[hv] && w.isEmpty(hv) && !w.rail[hv]) : (w.isUnlocked(hv) && (w.bld[hv] >= 0 || w.road[hv] > 0 || w.park[hv] > 0 || w.stop[hv] >= 0));
          cursors.push({ tile: hv, style: ok ? (this.tool === 'park' ? 'ok' : 'bad') : 'info' });
          if (this.tool === 'park') this.quote = { text: money(COST.park), ok: ok && g.money >= COST.park, reason: ok ? undefined : 'Pick an empty tile' };
          else if (ok) this.quote = { text: w.bld[hv] >= 0 ? `Demolish ${money(COST.bulldoze)}` : 'Remove', ok: true };
        }
        break;
      }
      case 'transit': {
        const mode = this.mode, m = MODES[mode];
        const rad = m.walkR;
        const d = this.draft;
        const color = d?.extend ? d.extend.color : m.color;
        const base: number[] = d?.extend && !d.tiles.length ? d.extend.stops.map((s) => s.tile) : d?.tiles ?? [];
        if (isCargoMode(mode)) for (const b of g.city.cargoSites()) {
          if (!isIndustry(b.special)) continue;
          rings.push({ x: wx(b.x), z: wz(b.y), r: CATCH, color: 0xd9a441, alpha: 0.28, fill: 1, pulse: 0 });
        }
        if (mode === 'ferry') for (let i = 0; i < N * N; i++) if (w.shore[i] && !g.spotCheck('ferry', i) && !base.includes(i)) cursors.push({ tile: i, style: 'info' });
        for (const t of base) { cursors.push({ tile: t, style: 'gold' }); rings.push({ x: wx(tileX(t)), z: wz(tileY(t)), r: rad, color, alpha: 0.5, fill: 1, pulse: 0 }); }
        if (hv >= 0) {
          const prevTile = base.length ? base[base.length - 1] : -1;
          let ok = false, reason = '';
          let track: number[] = [];
          const why = g.spotCheck(mode, hv);
          if (why) reason = why;
          else if (d?.tiles.includes(hv) || (d?.extend && d.extend.stops.some((s) => s.tile === hv))) reason = 'Already on this line';
          else {
            ok = true;
            if (d?.extend) {
              const q = g.quoteExtend(d.extend, hv);
              ok = q.ok; reason = q.reason ?? ''; track = q.track;
              this.quote = { text: money(q.cost), ok: ok && g.money >= q.cost, reason: ok ? (g.money >= q.cost ? undefined : 'Not enough money') : reason, cost: q.cost };
            } else if (prevTile >= 0) {
              const tilesQ = [...(d?.tiles ?? []), hv];
              const q = g.quoteLine(mode, tilesQ);
              ok = q.ok; reason = q.reason ?? ''; track = q.track;
              this.quote = { text: money(q.cost), ok: ok && g.money >= q.cost, reason: ok ? (g.money >= q.cost ? undefined : 'Not enough money') : reason, cost: q.cost };
            } else {
              this.quote = { text: money(g.world.stop[hv] >= 0 ? 0 : m.stopCost), ok: true };
            }
          }
          if (!ok && !this.quote) this.quote = { text: '', ok: false, reason };
          else if (!ok && this.quote) this.quote.ok = false;
          cursors.push({ tile: hv, style: ok ? 'ok' : 'bad' });
          if (ok) rings.push({ x: wx(tileX(hv)), z: wz(tileY(hv)), r: rad, color: 0x4ade80, alpha: 0.55, fill: 1, pulse: 0 });
          if (track.length && !isRoadMode(mode)) this.drawTrack(mode, track, ok ? color : 0xff5a5a);
          else this.view.overlay.removeRoute('draftHover');
          this.drawDraft(mode, base, hv, ok, color);
        } else this.drawDraft(mode, base, -1, false, color);
        break;
      }
    }
    // selection highlight
    const sel = this.selection;
    if (sel) {
      if (sel.type === 'building') { const b = g.city.buildings.get(sel.id); if (b) cursors.push({ tile: b.tile, style: 'gold' }); }
      else if (sel.type === 'stop') { const s = g.transit.stopById.get(sel.id); if (s) { cursors.push({ tile: s.tile, style: 'gold' }); rings.push({ x: s.x, z: s.z, r: MODES[s.kind].walkR, color: 0xffc54d, alpha: 0.55, fill: 1, pulse: 0 }); } }
      else if (sel.type === 'road') cursors.push({ tile: sel.tile, style: 'gold' });
    }
    v.cursors = cursors;
    v.extraRings = rings;
    this.app.hud.updateHoverTip();
  }

  private routeY(mode: Mode) { return mode === 'metro' || mode === 'freight' ? TRACK_Y + 0.07 : mode === 'tram' ? 0.075 : mode === 'ferry' ? -0.06 : mode === 'gondola' ? 0.9 : 0.07; }

  private drawTrack(mode: Mode, tiles: number[], color: number) {
    const pts: { x: number; z: number }[] = [];
    for (const t of tiles) pts.push({ x: wx(tileX(t)), z: wz(tileY(t)) });
    this.view.overlay.setRoute('draftHover', pts, this.routeY(mode), color, 0.09, { dash: 1, alpha: 0.95 });
  }

  private drawDraft(mode: Mode, base: number[], hv: number, ok: boolean, color: number) {
    const key = `${mode}|${base.join(',')}|${hv}|${ok}`;
    if (key === this.draftKey) return;
    this.draftKey = key;
    const ov = this.view.overlay, g = this.game;
    ov.removeRoute('draft');
    if (!isRoadMode(mode)) {
      if (hv < 0 || !ok) ov.removeRoute('draftHover');
      if (base.length >= 2) {
        const q = g.transit.planTrack(mode, base, g.transit.nextLineId);
        if (q.ok) ov.setRoute('draft', q.tiles.map((t) => ({ x: wx(tileX(t)), z: wz(tileY(t)) })), this.routeY(mode), color, 0.1, { dash: 1, alpha: 0.95 });
      }
      return;
    }
    ov.removeRoute('draftHover');
    const pts: { x: number; z: number }[] = [];
    const seq = hv >= 0 && ok ? [...base, hv] : base;
    for (let k = 0; k + 1 < seq.length; k++) {
      const path = g.traffic.router.find(seq[k], seq[k + 1]);
      if (!path) continue;
      for (const t of path) pts.push({ x: wx(tileX(t)), z: wz(tileY(t)) });
    }
    if (pts.length > 1) ov.setRoute('draft', pts, 0.07, color, 0.11, { dash: 1, alpha: 0.95 });
  }

  /** world → screen helper for labels */
  get toolLabel() { return this.tool; }
}
void HALF; void N; void inMap; void DX; void DY;

export function roadLabel(w: World, i: number): string {
  const r = w.road[i];
  const base = r === 3 ? (w.ramp[i] ? 'Interchange' : w.water[i] ? 'Highway bridge' : 'Highway') : r === 2 ? 'Avenue' : w.water[i] ? 'Bridge' : 'Street';
  if (r < 3 && w.ctl[i] && w.degree(i) >= 3) return w.ctl[i] === 2 ? 'Roundabout' : 'Signalled junction';
  return base;
}
