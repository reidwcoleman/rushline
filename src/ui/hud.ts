// HUD: top bar, toolbar, overlay switch, speed, toasts, context card and world-anchored labels.
import * as THREE from 'three';
import { h, icon, clear, money, fmt, clock } from './dom.ts';
import { COST, GOALS, UNLOCK } from '../sim/game.ts';
import { DAY, hourOf, dayOf } from '../sim/types.ts';
import { wx, wz, DS, DN } from '../sim/world.ts';
import { WALK_R_BUS } from '../sim/transit.ts';
import type { App } from './app.ts';
import type { ToolId } from './tools.ts';
import type { OverlayMode } from '../render/view.ts';

const TOOLS: { id: ToolId; icon: string; label: string; sub: string; key: string }[] = [
  { id: 'inspect', icon: 'inspect', label: 'Inspect', sub: 'Click anything to see how it is doing', key: '1' },
  { id: 'road', icon: 'road', label: 'Road', sub: `Drag to build · ${money(COST.street)} a tile`, key: '2' },
  { id: 'avenue', icon: 'avenue', label: 'Avenue', sub: `Twice the lanes · ${money(COST.avenue)} a tile`, key: '3' },
  { id: 'bus', icon: 'bus', label: 'Bus line', sub: 'Click roads to place stops', key: '4' },
  { id: 'metro', icon: 'metro', label: 'Metro line', sub: 'Elevated trains that skip traffic', key: '5' },
  { id: 'park', icon: 'park', label: 'Park', sub: `Calms the neighbourhood · ${money(COST.park)}`, key: '6' },
  { id: 'bulldoze', icon: 'bulldoze', label: 'Bulldoze', sub: 'Drag to clear', key: '7' },
];

export class Hud {
  root: HTMLElement;
  private toolBtns = new Map<ToolId, HTMLElement>();
  private ovBtns = new Map<OverlayMode, HTMLElement>();
  private spdBtns = new Map<number, HTMLElement>();
  private el: Record<string, HTMLElement> = {};
  private toasts!: HTMLElement;
  private labels!: HTMLElement;
  private context: HTMLElement | null = null;
  private contextKey = '';
  private tipEl!: HTMLElement;
  private legend!: HTMLElement;
  private stopLbl = new Map<number, HTMLElement>();
  private distLbl = new Map<number, HTMLElement>();
  private acc = 0;
  private tmpV = new THREE.Vector3();
  private lastStab = 100;
  private moneyShown = 0;

  constructor(readonly app: App, root: HTMLElement) {
    this.root = root;
    this.build();
  }

  private build() {
    const r = this.root;
    const e = this.el;
    // ---------- top bar
    e.name = h('div', { class: 'name' });
    e.when = h('div', { class: 'when num' });
    const city = h('div', { class: 'city glass' }, e.name, e.when);
    e.stabVal = h('span', { class: 'val num' }, '100');
    e.stabBar = h('i');
    e.rTraffic = this.risk('Traffic'); e.rTransit = this.risk('Transit'); e.rMood = this.risk('Mood');
    const stab = (e.stab = h('div', { class: 'stab glass' },
      h('div', { class: 'stab-row' }, h('span', { class: 'label' }, 'City stability'), e.stabVal),
      h('div', { class: 'bar' }, e.stabBar),
      h('div', { class: 'risks' }, e.rTraffic, e.rTransit, e.rMood)));
    e.money = h('div', { class: 'v num' }, '$0');
    e.moneyD = h('div', { class: 'd num' }, '');
    e.pop = h('div', { class: 'v num' }, '0');
    e.popD = h('div', { class: 'd num' }, '');
    e.rci = h('div', { class: 'rci', title: 'Demand: homes, shops, industry' }, h('i'), h('i'), h('i'));
    const stats = h('div', { class: 'stats glass' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Treasury'), e.money, e.moneyD),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Residents'), e.pop, e.popD),
      e.rci);
    r.append(h('div', { class: 'topbar' }, city, stab, stats));
    // goal pill
    e.goalT = h('span', {}, '');
    e.goalBar = h('i');
    r.append(e.goal = h('div', { class: 'glass goal-pill', style: { position: 'absolute', right: '16px', top: '100px', padding: '8px 14px', display: 'grid', gap: '6px', minWidth: '200px', borderRadius: '14px' } },
      h('div', { class: 'row', style: { fontSize: '12.5px' } }, h('span', { class: 'k' }, 'Next goal'), e.goalT),
      h('div', { class: 'meter' }, e.goalBar)));

    // ---------- toolbar
    const tb = h('div', { class: 'toolbar glass' });
    for (const t of TOOLS) {
      const b = h('button', { class: 'tool', onClick: () => this.app.tools.select(t.id) },
        icon(t.icon),
        h('span', { class: 'key' }, t.key),
        h('span', { class: 'tip' }, t.label, h('small', {}, t.sub)));
      this.toolBtns.set(t.id, b);
      tb.append(b);
      if (t.id === 'inspect' || t.id === 'metro') tb.append(h('div', { class: 'sep' }));
    }
    tb.append(h('div', { class: 'sep' }));
    const mk = (ic: string, label: string, sub: string, fn: () => void, key: string) => h('button', { class: 'tool', onClick: fn }, icon(ic), h('span', { class: 'key' }, key), h('span', { class: 'tip' }, label, h('small', {}, sub)));
    e.linesBtn = mk('lines', 'Lines', 'Your bus and metro lines', () => this.app.panels.toggle('lines'), 'L');
    e.polBtn = mk('policy', 'Policies', 'City-wide rules', () => this.app.panels.toggle('policies'), 'P');
    tb.append(e.linesBtn, e.polBtn);
    r.append(tb);

    // ---------- overlay dock
    const dock = h('div', { class: 'dock-l glass' });
    const segs: [OverlayMode, string, string][] = [['none', 'Normal', '#9aa3ad'], ['traffic', 'Traffic', '#f59e0b'], ['transit', 'Transit', '#60a5fa'], ['happy', 'Mood', '#4ade80']];
    for (const [m, label, col] of segs) {
      const b = h('button', { class: 'seg', onClick: () => this.setOverlay(m) }, col ? h('i', { style: { background: col } }) : null, label);
      this.ovBtns.set(m, b);
      dock.append(b);
    }
    r.append(dock);
    this.legend = h('div', { class: 'glass', style: { position: 'absolute', left: '16px', bottom: '70px', padding: '8px 12px', fontSize: '12px', fontWeight: '600', color: 'var(--text-2)', display: 'none', gap: '10px', alignItems: 'center', borderRadius: '12px' } });
    r.append(this.legend);

    // ---------- speed dock
    const sd = h('div', { class: 'dock-r glass' });
    const pause = h('button', { class: 'spd pause', title: 'Pause (Space)', onClick: () => this.app.setSpeed(0) }, h('span', { html: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>' }));
    this.spdBtns.set(0, pause);
    sd.append(pause);
    for (const s of [1, 2, 4]) {
      const b = h('button', { class: 'spd', title: `${s}x`, onClick: () => this.app.setSpeed(s) }, `${s}x`);
      this.spdBtns.set(s, b);
      sd.append(b);
    }
    r.append(sd);

    this.toasts = h('div', { class: 'toasts' });
    r.append(this.toasts);
    this.labels = h('div', { class: 'labels' });
    r.insertBefore(this.labels, r.firstChild);
    this.tipEl = h('div', { class: 'hover-tip', style: { display: 'none' } });
    r.append(this.tipEl);
    r.append(e.vig = h('div', { class: 'vig-red' }));
    this.refreshTools();
    this.setOverlay('none', true);
    this.refreshSpeed();
  }

  private risk(label: string) {
    const el = h('div', { class: 'risk', style: { cursor: 'pointer' }, title: `Show the worst ${label.toLowerCase()} problem`, onClick: () => this.app.focusProblem(label === 'Traffic' ? 'traffic' : label === 'Transit' ? 'transit' : 'mood') }, h('span', {}, label), h('div', { class: 'mini' }, h('i')));
    return el;
  }
  private setRisk(el: HTMLElement, v: number) {
    el.classList.toggle('warn', v > 0.3 && v <= 0.62);
    el.classList.toggle('bad', v > 0.62);
    (el.querySelector('.mini > i') as HTMLElement).style.width = Math.round(Math.max(3, v * 100)) + '%';
  }

  // ------------------------------------------------------------ states

  /** highlight the tool the coach wants next */
  pulseTool(id: ToolId | null) {
    for (const [k, b] of this.toolBtns) b.classList.toggle('pulse', k === id);
  }

  refreshToolStates() {
    const g = this.app.game;
    for (const [id, b] of this.toolBtns) {
      b.classList.toggle('on', this.app.tools.tool === id);
      b.classList.toggle('lock', (id === 'avenue' && !g.unlocked.avenue) || (id === 'metro' && !g.unlocked.metro));
    }
    this.el.polBtn.classList.toggle('lock', !g.unlocked.policies);
  }

  refreshTools() {
    this.refreshToolStates();
    this.refreshContext();
  }

  refreshSpeed() {
    const s = this.app.game.speed;
    for (const [k, b] of this.spdBtns) b.classList.toggle('on', k === s);
  }

  setOverlay(m: OverlayMode, silent = false) {
    this.app.view.setMode(m);
    this.app.view.showRoutes = m === 'transit';
    for (const [k, b] of this.ovBtns) b.classList.toggle('on', k === m);
    const lg = this.legend;
    clear(lg);
    lg.style.display = m === 'traffic' || m === 'happy' ? 'flex' : 'none';
    if (m === 'traffic') lg.append('Free flowing', h('span', { style: { width: '120px', height: '6px', borderRadius: '3px', background: 'linear-gradient(90deg,#34d399,#facc15,#ef4444)' } }), 'Jammed');
    if (m === 'happy') lg.append('Unhappy', h('span', { style: { width: '120px', height: '6px', borderRadius: '3px', background: 'linear-gradient(90deg,#ef5350,#e8b04a,#4ade80)' } }), 'Content');
    if (!silent) this.app.sound.sfx('click');
  }

  toast(msg: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info') {
    const t = h('div', { class: `toast ${tone}` }, h('i'), h('span', {}, msg));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, tone === 'bad' ? 7500 : 5200);
  }

  celebrate(title: string, sub: string) {
    const c = h('div', { class: 'celebrate' }, h('b', {}, title), h('span', {}, sub));
    this.root.append(c);
    setTimeout(() => c.remove(), 3300);
  }

  // ------------------------------------------------------------ context card

  private ctxSig = '';
  refreshContext(force = true) {
    const t = this.app.tools, g = this.app.game;
    let key: string = t.tool;
    const d = t.draft;
    const sig = `${t.tool}|${d ? d.tiles.join(',') + (d.extend ? 'e' + d.extend.id : '') : ''}|${Math.floor(g.money / 50)}`;
    if (!force && sig === this.ctxSig && this.context) return;
    this.ctxSig = sig;
    let node: HTMLElement | null = null;
    if (d && d.extend) {
      key += 'ext' + d.extend.id;
      node = h('div', { class: 'context glass' },
        h('div', { class: 'sw', style: { background: '#' + d.extend.color.toString(16).padStart(6, '0') } }),
        h('div', { class: 't' }, h('b', {}, `Extend ${d.extend.name}`), h('span', {}, d.kind === 'bus' ? 'Click a road to add the next stop. Each click is built right away.' : 'Click open ground or a road to add the next station.')),
        h('button', { class: 'btn primary', onClick: () => t.finishDraft() }, 'Done'));
    } else if (d) {
      key += 'draft' + d.tiles.length;
      const q = d.kind === 'bus' ? g.quoteBus(d.tiles.length ? d.tiles : []) : g.quoteMetro(d.tiles.length >= 2 ? d.tiles : []);
      const cost = d.tiles.length >= 2 ? q.cost : d.kind === 'bus' ? COST.bus : COST.train;
      const sub = d.tiles.length < 2 ? (d.tiles.length === 0 ? (d.kind === 'bus' ? 'Click a road to place the first stop.' : 'Click to place the first station.') : 'Place at least one more stop.') : `${d.tiles.length} ${d.kind === 'bus' ? 'stops' : 'stations'} · ${money(cost)} with ${d.kind === 'bus' ? 'a bus' : 'a train'}`;
      node = h('div', { class: 'context glass' },
        h('div', { class: 'sw', style: { background: d.kind === 'bus' ? '#7cc4ff' : '#ffb02e' } }),
        h('div', { class: 't' }, h('b', {}, d.kind === 'bus' ? 'New bus line' : 'New metro line'), h('span', { class: d.tiles.length >= 2 && !q.ok ? 'warn' : '' }, d.tiles.length >= 2 && !q.ok ? q.reason ?? sub : sub)),
        h('button', { class: 'btn ghost sm', onClick: () => t.undoDraft() }, 'Undo'),
        h('button', { class: 'btn ghost sm', onClick: () => t.cancelDraft() }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: d.tiles.length < 2 || !q.ok || cost > g.money, onClick: () => t.finishDraft() }, 'Finish line'));
    } else if (t.tool !== 'inspect') {
      const def = TOOLS.find((x) => x.id === t.tool)!;
      const tips: Record<string, string> = {
        road: 'Drag across the map. Right-click to stop building.',
        avenue: 'Drag over streets to widen them, or over open ground to lay new avenues.',
        bus: 'Click roads to place stops. A line needs at least two. Right-click undoes.',
        metro: 'Click open ground or roads to place stations. Track is laid between them.',
        park: 'Click or drag over empty ground. Parks raise land value nearby.',
        bulldoze: 'Click or drag over buildings, roads and stops to clear them.',
      };
      node = h('div', { class: 'context glass' },
        h('div', { class: 'sw', style: { background: 'var(--amber)' } }),
        h('div', { class: 't' }, h('b', {}, def.label), h('span', {}, tips[t.tool] ?? def.sub)),
        h('button', { class: 'btn ghost sm', onClick: () => t.select('inspect') }, 'Done'));
    }
    if (key === this.contextKey && node && this.context) {
      // same shape, replace to refresh costs without replaying the animation
      node.style.animation = 'none';
    }
    this.contextKey = key;
    this.context?.remove();
    this.context = node;
    if (node) this.root.append(node);
  }

  // ------------------------------------------------------------ hover tip

  updateHoverTip() {
    const t = this.app.tools;
    const el = this.tipEl;
    const quote = t.quote, tip = t.tip;
    if (!t.hover || t.hover.tile < 0 || (!quote && !tip)) { el.style.display = 'none'; return; }
    clear(el);
    if (tip) { el.append(tip.text); if (tip.sub) el.append(h('small', {}, tip.sub)); }
    if (quote) {
      const q = h('div', { style: { color: quote.ok ? 'var(--text)' : '#ff9a9a' } }, quote.text);
      el.append(q);
      if (quote.reason) el.append(h('small', { style: { color: quote.ok ? 'var(--text-2)' : '#ff9a9a' } }, quote.reason));
    }
    el.style.display = 'block';
    this.moveTip();
  }
  moveTip() {
    const t = this.app.tools as any;
    this.tipEl.style.left = Math.min(innerWidth - 180, t.lastX) + 'px';
    this.tipEl.style.top = Math.min(innerHeight - 90, t.lastY) + 'px';
  }

  // ------------------------------------------------------------ per-frame

  update(dt: number) {
    this.acc += dt;
    const g = this.app.game;
    this.moveTip();
    if (this.acc > 0.2) { this.acc = 0; this.refreshNumbers(); }
    this.updateLabels();
    void g;
  }

  private refreshNumbers() {
    const g = this.app.game, e = this.el, s = g.city.stats;
    e.name.textContent = g.name;
    const hr = hourOf(g.t);
    clear(e.when);
    const rainy = this.app.view.rainTarget > 0.5;
    e.when.append(icon(rainy ? 'rain' : hr >= 6.3 && hr < 18.8 ? 'sun' : 'moon'), `Day ${dayOf(g.t)}  ${clock(hr)}`);
    const rush = hr >= 6.8 && hr < 9.6 ? 'Morning rush' : hr >= 16.4 && hr < 19.2 ? 'Evening rush' : '';
    if (rush) e.when.append(h('span', { class: 'rush' }, rush));
    // money
    this.moneyShown += (g.money - this.moneyShown) * 0.35;
    if (Math.abs(g.money - this.moneyShown) < 1) this.moneyShown = g.money;
    e.money.textContent = money(this.moneyShown);
    e.money.style.color = g.money < 0 ? 'var(--red)' : '';
    const net = (g.incomeRate - g.expenseRate) * DAY;
    e.moneyD.textContent = `${net >= 0 ? '+' : '-'}${money(Math.abs(net))} a day`;
    e.moneyD.className = 'd num ' + (net >= 0 ? 'up' : 'down');
    e.pop.textContent = fmt(s.pop);
    const emp = s.pop ? Math.round((s.employed / Math.max(1, s.pop * 0.52)) * 100) : 100;
    e.popD.textContent = s.pop ? `${Math.min(100, emp)}% employed` : '';
    const rci = e.rci.children as unknown as HTMLElement[];
    rci[0].style.height = 4 + s.demand.r * 30 + 'px'; rci[1].style.height = 4 + s.demand.c * 30 + 'px'; rci[2].style.height = 4 + s.demand.i * 30 + 'px';
    // stability
    const st = g.stability;
    e.stabVal.textContent = Math.round(st).toString();
    const bar = e.stabBar as HTMLElement;
    bar.style.width = st + '%';
    bar.style.background = st > 62 ? 'var(--green)' : st > 32 ? 'var(--amber)' : 'var(--red)';
    const c = g.crisis;
    this.setRisk(e.rTraffic, c.traffic); this.setRisk(e.rTransit, c.transit); this.setRisk(e.rMood, c.unrest);
    const crisis = st < 40 || c.total > 0.6;
    e.stab.classList.toggle('crisis', crisis && st < 70);
    e.vig.classList.toggle('on', st < 34);
    this.lastStab = st;
    // goal
    const goal = GOALS[g.goalIdx];
    if (goal) {
      e.goal.style.display = '';
      e.goalT.textContent = `${goal.title} · ${fmt(goal.pop)}`;
      (e.goalBar as HTMLElement).style.width = Math.min(100, (s.pop / goal.pop) * 100) + '%';
    } else e.goal.style.display = 'none';
    this.refreshToolStates();
    this.refreshSpeed();
    this.refreshContext(false);
  }

  // ------------------------------------------------------------ world labels

  private updateLabels() {
    const app = this.app, g = app.game, v = app.view;
    const rig = v.rig;
    const showAll = v.mode === 'transit' || app.tools.tool === 'bus' || app.tools.tool === 'metro';
    const sel = app.tools.selection;
    const hoverTile = app.tools.hover?.tile ?? -1;
    const seen = new Set<number>();
    for (const s of g.transit.stops) {
      const over = s.queue.length > s.cap;
      const busy = s.queue.length >= Math.max(5, s.cap * 0.6);
      const focus = (sel?.type === 'stop' && sel.id === s.id) || hoverTile === s.tile;
      if (!showAll && !over && !busy && !focus) continue;
      const p = rig.toScreen(this.tmpV.set(s.x, s.kind === 'metro' ? 1.35 : 0.34, s.z));
      if (!p.visible || p.x < -40 || p.x > innerWidth + 40 || p.y < -20 || p.y > innerHeight + 20) continue;
      seen.add(s.id);
      let el = this.stopLbl.get(s.id);
      if (!el) {
        el = h('div', { class: 'lbl' });
        this.stopLbl.set(s.id, el);
        this.labels.append(el);
      }
      const key = `${s.name}|${over}|${s.lines.map((l) => l.id).join()}|${s.queue.length}`;
      if ((el as any)._k !== key) {
        (el as any)._k = key;
        clear(el);
        const t = h('div', { class: 'tag' + (over ? ' over' : '') });
        for (const l of s.lines.slice(0, 3)) t.append(h('i', { style: { background: '#' + l.color.toString(16).padStart(6, '0') } }));
        t.append(over ? `${s.name} · ${s.queue.length}` : s.queue.length > 0 ? `${s.name} · ${s.queue.length}` : s.name);
        el.append(t);
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.style.left = '0'; el.style.top = '0';
    }
    for (const [id, el] of this.stopLbl) if (!seen.has(id)) { el.remove(); this.stopLbl.delete(id); }
    // district purchase pills
    const w = g.world;
    const shown = new Set<number>();
    for (const d of w.districts) {
      if (d.unlocked) continue;
      let adj = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = d.col + dx, r = d.row + dy;
        if (c >= 0 && r >= 0 && c < DN && r < DN && w.districts[r * DN + c].unlocked) adj = true;
      }
      if (!adj) continue;
      const cx = (d.col * DS + DS / 2) - 20 , cz = (d.row * DS + DS / 2) - 20;
      const p = rig.toScreen(this.tmpV.set(cx, 0.1, cz));
      if (!p.visible || p.x < 175 || p.x > innerWidth - 110 || p.y < 125 || p.y > innerHeight - 90) continue;
      shown.add(d.index);
      let el = this.distLbl.get(d.index);
      const afford = g.money >= d.cost;
      if (!el) {
        el = h('button', { class: 'pill', style: { position: 'absolute', left: '0', top: '0' }, onClick: () => app.buyDistrict(d.index) });
        this.distLbl.set(d.index, el);
        this.labels.append(el);
      }
      const key = `${d.cost}|${afford}`;
      if ((el as any)._k !== key) {
        (el as any)._k = key;
        clear(el);
        el.className = 'pill' + (afford ? ' afford' : '');
        el.append(icon(afford ? 'plus' : 'lock'), `Expand ${money(d.cost)}`);
      }
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }
    for (const [id, el] of this.distLbl) if (!shown.has(id)) { el.remove(); this.distLbl.delete(id); }
    void WALK_R_BUS; void UNLOCK; void wx; void wz;
  }
}
