// Tools and input: pointer / keyboard handling, drafting roads and lines, selection and previews.
import { Game, COST, UNLOCK } from '../sim/game.ts';
import { N, HALF, tileIdx, tileX, tileY, wx, wz, inMap, DX, DY } from '../sim/world.ts';
import { WALK_R_BUS, WALK_R_METRO } from '../sim/transit.ts';
import type { Line } from '../sim/types.ts';
import type { View } from '../render/view.ts';
import type { App } from './app.ts';
import { TRACK_Y } from '../render/fleet.ts';
import { money } from './dom.ts';

export type ToolId = 'inspect' | 'road' | 'avenue' | 'bus' | 'metro' | 'park' | 'bulldoze';
export const TOOL_ORDER: ToolId[] = ['inspect', 'road', 'avenue', 'bus', 'metro', 'park', 'bulldoze'];

export type Selection = { type: 'building'; id: number } | { type: 'stop'; id: number } | { type: 'road'; tile: number } | { type: 'line'; id: number } | null;

interface Draft { kind: 'bus' | 'metro'; tiles: number[]; extend: Line | null }

export class Tools {
  tool: ToolId = 'inspect';
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
    if (t === 'metro' && !this.game.unlocked.metro) { this.app.toast(`Metro unlocks at ${UNLOCK.metro} residents.`, 'info'); this.app.sound.sfx('error'); return; }
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

  cancelDraft() {
    this.draft = null;
    this.draftKey = '';
    this.view.overlay.removeRoute('draft');
    this.view.overlay.removeRoute('draftHover');
    this.app.hud.refreshContext();
  }

  startExtend(line: Line) {
    this.tool = line.kind === 'bus' ? 'bus' : 'metro';
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
      case 'road': case 'avenue':
        this.drag = { start: t, cur: t, tiles: [t], paint: false };
        break;
      case 'park': case 'bulldoze':
        this.drag = { start: t, cur: t, tiles: [t], paint: true };
        this.bulldozed.clear();
        this.paintTile(t);
        break;
      case 'bus': case 'metro':
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
    if (this.tool === 'road' || this.tool === 'avenue') {
      const r = this.game.buildRoad(d.tiles, this.tool === 'avenue' ? 2 : 1);
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

  private addDraftStop(t: number) {
    const g = this.game, w = g.world;
    if (!this.draft) this.draft = { kind: this.tool === 'bus' ? 'bus' : 'metro', tiles: [], extend: null };
    const d = this.draft;
    const prev = d.extend && !d.tiles.length ? d.extend.stops[d.extend.stops.length - 1].tile : d.tiles[d.tiles.length - 1];
    if (t === prev) return;
    // extension: act immediately, one stop at a time
    if (d.extend) {
      const line = d.extend;
      if (d.kind === 'bus') {
        const q = g.quoteBus([prev, t]);
        const cost = (w.stop[t] < 0 ? COST.busStop : 0);
        if (!w.road[t]) { this.app.toast('Stops go on roads.', 'warn'); this.app.sound.sfx('error'); return; }
        if (cost > g.money) { this.app.toast('Not enough money.', 'warn'); this.app.sound.sfx('error'); return; }
        if (!g.transit.extendBus(line, t)) { this.app.toast(q.reason ?? 'Those stops are not connected by road.', 'warn'); this.app.sound.sfx('error'); return; }
        g.spend(cost);
        this.app.sound.sfx('line');
      } else {
        const cost = (w.stop[t] < 0 ? COST.station : 0);
        if (w.bld[t] >= 0 || w.water[t]) { this.app.toast('Stations need open ground or a road.', 'warn'); this.app.sound.sfx('error'); return; }
        if (cost + 600 > g.money) { this.app.toast('Not enough money.', 'warn'); this.app.sound.sfx('error'); return; }
        const r = g.transit.extendMetro(line, t);
        if (!r.ok) { this.app.toast(r.reason ?? 'No room for track.', 'warn'); this.app.sound.sfx('error'); return; }
        g.spend(cost + 600);
        this.app.sound.sfx('line');
      }
      this.app.hud.refreshContext();
      this.app.panels.sync();
      return;
    }
    if (d.kind === 'bus') {
      if (!w.road[t]) { this.app.toast('Stops go on roads. Build a road first.', 'warn'); this.app.sound.sfx('error'); return; }
      if (w.stopKind[t] === 2) { this.app.toast('That tile is a metro station.', 'warn'); this.app.sound.sfx('error'); return; }
      if (d.tiles.includes(t)) return;
      if (d.tiles.length) {
        const last = d.tiles[d.tiles.length - 1];
        if (!g.traffic.router.find(last, t)) { this.app.toast('Those stops are not connected by road.', 'warn'); this.app.sound.sfx('error'); return; }
      }
    } else {
      const q = g.quoteMetro([...d.tiles, t]);
      if (d.tiles.length === 0) {
        if (w.water[t] || w.bld[t] >= 0 || !w.isUnlocked(t) || w.stopKind[t] === 1) { this.app.toast('Stations need open ground or a road.', 'warn'); this.app.sound.sfx('error'); return; }
      } else if (!q.ok) { this.app.toast(q.reason ?? 'Cannot route track there.', 'warn'); this.app.sound.sfx('error'); return; }
      if (d.tiles.includes(t)) return;
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
    const r = d.kind === 'bus' ? this.game.createBusLine(d.tiles) : this.game.createMetroLine(d.tiles);
    if (!r.ok) { this.app.toast(r.msg ?? 'Could not build the line.', 'warn'); this.app.sound.sfx('error'); return; }
    const line = r.line!;
    this.app.toast(`${line.name} is running with 1 ${d.kind === 'bus' ? 'bus' : 'train'}. Add more from the line card.`, 'good');
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
    if (w.stop[t] >= 0) this.setSelection({ type: 'stop', id: w.stop[t] });
    else if (w.bld[t] >= 0) this.setSelection({ type: 'building', id: w.bld[t] });
    else if (w.road[t]) this.setSelection({ type: 'road', tile: t });
    else this.setSelection(null);
    this.app.sound.sfx('tick');
  }

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
      case 'Digit4': this.select('bus'); break;
      case 'Digit5': this.select('metro'); break;
      case 'Digit6': this.select('park'); break;
      case 'Digit7': this.select('bulldoze'); break;
      case 'Space': e.preventDefault(); this.app.togglePause(); break;
      case 'Equal': case 'NumpadAdd': this.app.setSpeed(g.speed >= 4 ? 4 : g.speed === 0 ? 1 : g.speed * 2); break;
      case 'Minus': case 'NumpadSubtract': this.app.setSpeed(g.speed <= 1 ? 1 : g.speed / 2); break;
      case 'KeyL': this.app.panels.toggle('lines'); break;
      case 'KeyP': this.app.panels.toggle('policies'); break;
      case 'KeyT': this.app.hud.setOverlay(this.view.mode === 'transit' ? 'none' : 'transit'); break;
      case 'KeyG': this.app.hud.setOverlay(this.view.mode === 'traffic' ? 'none' : 'traffic'); break;
      case 'KeyH': this.app.hud.setOverlay(this.view.mode === 'happy' ? 'none' : 'happy'); break;
      case 'KeyM': this.app.toggleMute(); break;
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
    if (f || r) this.view.rig.move(f, r, dt);
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
        if (hv >= 0 && !this.pan) {
          const b = g.buildingAt(hv);
          if (b) {
            cursors.push({ tile: hv, style: 'info' });
            const names = { res: ['House', 'Apartments', 'Tower'], com: ['Shop', 'Offices', 'Skyscraper'], ind: ['Workshop', 'Factory', 'Plant'] };
            this.tip = { text: names[b.kind][b.level - 1], sub: b.kind === 'res' ? `${b.residents.length} residents` : `${b.workers.length} / ${b.cap} workers` };
          } else if (w.stop[hv] >= 0) {
            const s = g.transit.stopById.get(w.stop[hv])!;
            cursors.push({ tile: hv, style: 'info' });
            this.tip = { text: s.name, sub: `${s.queue.length} waiting` };
          } else if (w.road[hv]) {
            cursors.push({ tile: hv, style: 'info' });
            const sp = g.traffic.cong[hv];
            this.tip = { text: w.road[hv] === 2 ? 'Avenue' : w.water[hv] ? 'Bridge' : 'Street', sub: sp > 0.8 ? 'Flowing' : sp > 0.45 ? 'Busy' : 'Jammed' };
          }
        }
        break;
      }
      case 'road': case 'avenue': {
        const level = this.tool === 'avenue' ? 2 : 1;
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
      case 'park': case 'bulldoze': {
        if (hv >= 0) {
          const ok = this.tool === 'park' ? (w.isUnlocked(hv) && !w.water[hv] && w.isEmpty(hv) && !w.rail[hv]) : (w.isUnlocked(hv) && (w.bld[hv] >= 0 || w.road[hv] > 0 || w.park[hv] > 0 || w.stop[hv] >= 0));
          cursors.push({ tile: hv, style: ok ? (this.tool === 'park' ? 'ok' : 'bad') : 'info' });
          if (this.tool === 'park') this.quote = { text: money(COST.park), ok: ok && g.money >= COST.park, reason: ok ? undefined : 'Pick an empty tile' };
          else if (ok) this.quote = { text: w.bld[hv] >= 0 ? `Demolish ${money(COST.bulldoze)}` : 'Remove', ok: true };
        }
        break;
      }
      case 'bus': case 'metro': {
        const kind = this.tool === 'bus' ? 'bus' : 'metro';
        const rad = kind === 'bus' ? WALK_R_BUS : WALK_R_METRO;
        const d = this.draft;
        const color = d?.extend ? d.extend.color : kind === 'bus' ? 0x7cc4ff : 0xffb02e;
        const base: number[] = d?.extend && !d.tiles.length ? d.extend.stops.map((s) => s.tile) : d?.tiles ?? [];
        for (const t of base) { cursors.push({ tile: t, style: 'gold' }); rings.push({ x: wx(tileX(t)), z: wz(tileY(t)), r: rad, color, alpha: 0.5, fill: 1, pulse: 0 }); }
        if (hv >= 0) {
          let ok = false, reason = '';
          const prevTile = base.length ? base[base.length - 1] : -1;
          if (kind === 'bus') {
            ok = !!w.road[hv] && w.stopKind[hv] !== 2 && !(d?.tiles.includes(hv));
            if (!w.road[hv]) reason = 'Stops go on roads';
            else if (prevTile >= 0 && ok && !g.traffic.router.find(prevTile, hv)) { ok = false; reason = 'Not connected by road'; }
          } else {
            const tilesQ = d?.extend && !d.tiles.length ? [prevTile, hv] : [...(d?.tiles ?? []), hv];
            if (tilesQ.length >= 2) {
              const q = g.quoteMetro(tilesQ);
              ok = q.ok; reason = q.reason ?? '';
              const cost = q.cost;
              this.quote = { text: money(cost - COST.train), ok: ok && g.money >= cost, reason: ok ? (g.money >= cost ? undefined : 'Not enough money') : reason, cost };
              if (q.track.length) this.drawTrack(q.track, ok ? color : 0xff5a5a);
            } else {
              ok = !w.water[hv] && w.bld[hv] < 0 && w.isUnlocked(hv) && w.stopKind[hv] !== 1;
              reason = ok ? '' : 'Needs open ground or a road';
              this.quote = { text: money(w.stop[hv] >= 0 ? 0 : COST.station), ok, reason };
            }
          }
          cursors.push({ tile: hv, style: ok ? 'ok' : 'bad' });
          if (ok) rings.push({ x: wx(tileX(hv)), z: wz(tileY(hv)), r: rad, color: ok ? 0x4ade80 : 0xff5a5a, alpha: 0.55, fill: 1, pulse: 0 });
          if (kind === 'bus') {
            const newStop = w.stop[hv] < 0;
            this.quote = { text: money(newStop ? COST.busStop : 0), ok, reason: ok ? undefined : reason };
            if (!ok && reason) this.quote.ok = false;
          }
          // route preview
          this.drawDraft(kind, base, hv, ok, color);
        } else this.drawDraft(kind, base, -1, false, color);
        break;
      }
    }
    // selection highlight
    const sel = this.selection;
    if (sel) {
      if (sel.type === 'building') { const b = g.city.buildings.get(sel.id); if (b) cursors.push({ tile: b.tile, style: 'gold' }); }
      else if (sel.type === 'stop') { const s = g.transit.stopById.get(sel.id); if (s) { cursors.push({ tile: s.tile, style: 'gold' }); rings.push({ x: s.x, z: s.z, r: s.kind === 'bus' ? WALK_R_BUS : WALK_R_METRO, color: 0xffc54d, alpha: 0.55, fill: 1, pulse: 0 }); } }
      else if (sel.type === 'road') cursors.push({ tile: sel.tile, style: 'gold' });
    }
    v.cursors = cursors;
    v.extraRings = rings;
    this.app.hud.updateHoverTip();
  }

  private drawTrack(tiles: number[], color: number) {
    const pts: { x: number; z: number }[] = [];
    for (const t of tiles) pts.push({ x: wx(tileX(t)), z: wz(tileY(t)) });
    this.view.overlay.setRoute('draftHover', pts, TRACK_Y + 0.07, color, 0.09, { dash: 1, alpha: 0.95 });
  }

  private drawDraft(kind: 'bus' | 'metro', base: number[], hv: number, ok: boolean, color: number) {
    const key = `${kind}|${base.join(',')}|${hv}|${ok}`;
    if (key === this.draftKey) return;
    this.draftKey = key;
    const ov = this.view.overlay, g = this.game;
    ov.removeRoute('draft');
    if (kind === 'metro') {
      ov.removeRoute('draft');
      if (hv < 0 || !ok) ov.removeRoute('draftHover');
      if (base.length >= 2) {
        const q = g.transit.planMetro(base, g.transit.nextLineId);
        if (q.ok) ov.setRoute('draft', q.tiles.map((t) => ({ x: wx(tileX(t)), z: wz(tileY(t)) })), TRACK_Y + 0.07, color, 0.1, { dash: 1, alpha: 0.95 });
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
