// HUD: top bar, toolbar, overlay switch, speed, toasts, context card and world-anchored labels.
import * as THREE from 'three';
import { h, icon, clear, money, fmt, clock } from './dom.ts';
import { COST, GOALS, UNLOCK, SERVICE } from '../sim/game.ts';
import { moodColorHex, fullName } from '../sim/people.ts';
import { CARGO_INFO, CARGO_LIST, isIndustry, sellsIdx, FACILITY } from '../sim/industry.ts';
import { DAY, hourOf, dayOf } from '../sim/types.ts';
import { wx, wz, DS, DN } from '../sim/world.ts';
import { MODES, MODE_ORDER, CARGO_ORDER, type Mode } from '../sim/modes.ts';
import type { App } from './app.ts';
import { isRoadTool, type ToolId, type JMode } from './tools.ts';
import type { OverlayMode } from '../render/view.ts';

const TOOLS: { id: ToolId; icon: string; label: string; sub: string; key: string }[] = [
  { id: 'inspect', icon: 'inspect', label: 'Inspect', sub: 'Click anything to see how it is doing', key: '1' },
  { id: 'road', icon: 'road', label: 'Roads', sub: `Streets, avenues and highways · drag to build`, key: '2' },
  { id: 'transit', icon: 'bus', label: 'Transit line', sub: 'Bus, tram, metro, ferry, gondola, freight', key: '4' },
  { id: 'park', icon: 'park', label: 'Park', sub: `Calms the neighbourhood · ${money(COST.park)}`, key: '5' },
  { id: 'arena', icon: 'arena', label: 'Arena', sub: `Match days pack the roads · ${money(COST.arena)}`, key: '6' },
  { id: 'bulldoze', icon: 'bulldoze', label: 'Bulldoze', sub: 'Drag to clear', key: '7' },
  { id: 'service', icon: 'school', label: 'Services', sub: 'Schools, clinics, airport', key: '8' },
  { id: 'junction', icon: 'junction', label: 'Junctions', sub: 'Roundabouts, signals, highway interchanges', key: '0' },
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
  private cargoLbl = new Map<number, HTMLElement>();
  private acc = 0;
  private tmpV = new THREE.Vector3();
  private lastStab = 100;
  private moneyShown = 0;
  private advisor!: HTMLElement;
  private ticker!: HTMLElement;
  private tickQ: { id: number; pid: number; text: string; tone: string }[] = [];
  private tickUntil = 0;
  private tickCur = 0;
  private personLbl: HTMLElement | null = null;
  private emotes = new Map<number, HTMLElement>();
  private emoteIds: number[] = [];
  private emoteT = 0;
  private advKey = '';

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
      const b = h('button', { class: 'tool', onClick: () => { const tl = this.app.tools; if (t.id === 'road') tl.select(isRoadTool(tl.tool) ? 'inspect' : tl.lastRoad); else tl.select(t.id); } },
        icon(t.icon),
        h('span', { class: 'key' }, t.key),
        h('span', { class: 'tip' }, t.label, h('small', {}, t.sub)));
      this.toolBtns.set(t.id, b);
      tb.append(b);
      if (t.id === 'inspect' || t.id === 'transit') tb.append(h('div', { class: 'sep' }));
    }
    tb.append(h('div', { class: 'sep' }));
    const mk = (ic: string, label: string, sub: string, fn: () => void, key: string) => h('button', { class: 'tool', onClick: fn }, icon(ic), h('span', { class: 'key' }, key), h('span', { class: 'tip' }, label, h('small', {}, sub)));
    e.linesBtn = mk('lines', 'Lines', 'Every line you run', () => this.app.panels.toggle('lines'), 'L');
    e.polBtn = mk('policy', 'Policies', 'City-wide rules', () => this.app.panels.toggle('policies'), 'P');
    e.citBtn = mk('people', 'Citizens', 'Who lives here and what they want', () => this.app.panels.toggle('citizens'), 'C');
    e.coBtn = mk('company', 'Company', 'Books, fleet and research', () => this.app.panels.toggle('company'), 'B');
    tb.append(e.linesBtn, e.polBtn, e.citBtn, e.coBtn);
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
    this.legend = h('div', { class: 'glass', style: { position: 'absolute', left: '16px', bottom: '118px', padding: '8px 12px', fontSize: '12px', fontWeight: '600', color: 'var(--text-2)', display: 'none', gap: '10px', alignItems: 'center', borderRadius: '12px' } });
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

    this.ticker = h('button', { class: 'ticker glass', onClick: () => { const it = (this.ticker as any)._pid; const p = this.app.game.city.personById.get(it); if (p) this.app.selectPerson(p, true); } });
    r.append(this.ticker);
    this.advisor = h('div', { class: 'advisor glass', style: { display: 'none' } });
    r.append(this.advisor);
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
      b.classList.toggle('on', this.app.tools.tool === id || (id === 'road' && isRoadTool(this.app.tools.tool)));
      b.classList.toggle('lock', (id === 'junction' && !g.unlocked.junction) || (id === 'arena' && !g.unlocked.arena) || (id === 'service' && !g.unlocked.school && !g.unlocked.airport));
    }
    // the roads button wears the icon of the road type in hand
    const rb = this.toolBtns.get('road');
    const rt = isRoadTool(this.app.tools.tool) ? this.app.tools.tool : 'road';
    if (rb && (rb as any)._rt !== rt) {
      (rb as any)._rt = rt;
      rb.replaceChild(icon(rt === 'highway' ? 'highway' : rt === 'avenue' ? 'avenue' : 'road'), rb.querySelector('svg')!);
    }
    // the transit button wears the icon of the mode in hand
    const tb = this.toolBtns.get('transit');
    const mode = this.app.tools.mode;
    if (tb && (tb as any)._mode !== mode) {
      (tb as any)._mode = mode;
      tb.replaceChild(icon(MODES[mode].icon), tb.querySelector('svg')!);
      const tip = tb.querySelector('.tip');
      if (tip) { clear(tip); tip.append(`${MODES[mode].label} line`, h('small', {}, MODES[mode].tag)); }
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

  private modeChips(): HTMLElement {
    const t = this.app.tools;
    const row = h('div', { class: 'mode-row' });
    const g = this.app.game;
    const grp = h('div', { class: 'grpseg' },
      h('button', { class: 'tab' + (t.group === 'people' ? ' on' : ''), onClick: () => t.setGroup('people') }, icon('people'), 'People'),
      h('button', { class: 'tab' + (t.group === 'cargo' ? ' on' : '') + (g.unlocked.truck ? '' : ' lock'), title: g.unlocked.truck ? 'Haul food, stone and goods' : `Freight unlocks at ${MODES.truck.unlock} residents`, onClick: () => t.setGroup('cargo') }, icon(g.unlocked.truck ? 'cargo' : 'lock'), 'Freight'));
    row.append(grp);
    for (const m of t.group === 'cargo' ? CARGO_ORDER : MODE_ORDER) {
      const def = MODES[m];
      const open = t.modeUnlocked(m);
      const chip = h('button', { class: 'mchip' + (t.mode === m ? ' on' : '') + (open ? '' : ' lock'), title: open ? def.tag : `Unlocks at ${def.unlock} residents`, onClick: () => t.setMode(m) },
        icon(open ? def.icon : 'lock'), h('span', {}, def.label), open ? null : h('small', {}, String(def.unlock)));
      chip.style.setProperty('--mc', '#' + def.color.toString(16).padStart(6, '0'));
      row.append(chip);
    }
    return row;
  }

  refreshContext(force = true) {
    const t = this.app.tools, g = this.app.game;
    let key: string = t.tool;
    const d = t.draft;
    const sig = `${t.tool}|${t.jmode}|${g.unlocked.avenue}${g.unlocked.highway}${g.unlocked.junction}|${t.mode}|${t.group}|${g.unlocked.truck}${g.unlocked.freight}|${t.service}|${g.unlocked.school}${g.unlocked.clinic}|${t.autoStops}|${d ? d.tiles.join(',') + (d.extend ? 'e' + d.extend.id : '') : ''}|${Math.floor(g.money / 50)}|${g.pop >= 150}${g.unlocked.tram}${g.unlocked.ferry}${g.unlocked.gondola}${g.unlocked.metro}`;
    if (!force && sig === this.ctxSig && this.context) return;
    this.ctxSig = sig;
    let node: HTMLElement | null = null;
    const hexc = (c: number) => '#' + c.toString(16).padStart(6, '0');
    if (d && d.extend) {
      key += 'ext' + d.extend.id;
      const m = MODES[d.kind];
      node = h('div', { class: 'context glass' },
        h('div', { class: 'sw', style: { background: hexc(d.extend.color) } }),
        h('div', { class: 't' }, h('b', {}, `Extend ${d.extend.name}`), h('span', {}, `Click to add the next ${m.stopWord}. Each click is built right away.`)),
        h('button', { class: 'btn primary', onClick: () => t.finishDraft() }, 'Done'));
    } else if (d) {
      key += 'draft' + d.tiles.length;
      const m = MODES[d.kind];
      const q = d.tiles.length >= 2 ? g.quoteLine(d.kind, d.tiles) : null;
      const cost = q ? q.cost : m.baseCost + m.stopCost;
      const sub = d.tiles.length < 2
        ? (d.tiles.length === 0 ? `Click to place the first ${m.stopWord}.` : `Place at least one more ${m.stopWord}.`)
        : `${d.tiles.length} ${m.stopWord}s · ${money(cost)} with 1 ${m.vehicle}`;
      const canAuto = d.kind === 'bus' || d.kind === 'tram' || d.kind === 'metro';
      node = h('div', { class: 'context glass' },
        h('div', { class: 'sw', style: { background: hexc(m.color) } }),
        h('div', { class: 't' }, h('b', {}, `New ${m.label.toLowerCase()} line`), h('span', { class: q && !q.ok ? 'warn' : '' }, q && !q.ok ? q.reason ?? sub : sub)),
        canAuto ? h('button', { class: 'btn ghost sm' + (t.autoStops ? ' on' : ''), title: 'Add stops along long hops for you', onClick: () => { t.autoStops = !t.autoStops; this.refreshContext(); } }, t.autoStops ? 'Auto-stops on' : 'Auto-stops off') : null,
        h('button', { class: 'btn ghost sm', onClick: () => t.undoDraft() }, 'Undo'),
        h('button', { class: 'btn ghost sm', onClick: () => t.cancelDraft() }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: !q || !q.ok || cost > g.money, onClick: () => t.finishDraft() }, 'Finish line'));
    } else if (t.tool === 'transit') {
      key += 'pick' + t.mode;
      const m = MODES[t.mode];
      node = h('div', { class: 'context glass tcontext' },
        this.modeChips(),
        h('div', { class: 'trow' },
          h('div', { class: 'sw', style: { background: hexc(m.color) } }),
          h('div', { class: 't' }, h('b', {}, `${m.label} · from ${money(m.baseCost + m.stopCost * 2)}`), h('span', {}, `${m.tag} ${m.how}`)),
          h('button', { class: 'btn ghost sm', onClick: () => t.select('inspect') }, 'Done')));
    } else if (t.tool === 'service') {
      key += 'svc' + t.service;
      const row = h('div', { class: 'mode-row' });
      for (const k of ['school', 'clinic', 'airport'] as const) {
        const open = g.unlocked[k];
        const chip = h('button', { class: 'mchip' + (t.service === k ? ' on' : '') + (open ? '' : ' lock'), onClick: () => t.setService(k) }, icon(open ? k : 'lock'), h('span', {}, SERVICE[k].label), open ? null : h('small', {}, String(SERVICE[k].unlock)));
        chip.style.setProperty('--mc', k === 'school' ? '#f2b84b' : k === 'clinic' ? '#3aa7a0' : '#7cc4ff');
        row.append(chip);
      }
      const sd = SERVICE[t.service];
      node = h('div', { class: 'context glass tcontext' }, row,
        h('div', { class: 'trow' }, h('div', { class: 'sw', style: { background: t.service === 'school' ? '#f2b84b' : t.service === 'clinic' ? '#3aa7a0' : '#7cc4ff' } }),
          h('div', { class: 't' }, h('b', {}, `${sd.label} · ${money(sd.cost)}`), h('span', {}, t.service === 'airport' ? `${sd.tag} Click where the top-left corner should go.` : `${sd.tag} Click empty ground beside a road.`)),
          h('button', { class: 'btn ghost sm', onClick: () => t.select('inspect') }, 'Done')));
    } else if (isRoadTool(t.tool)) {
      key += 'road' + t.tool;
      const row = h('div', { class: 'mode-row' });
      const kinds: { id: 'road' | 'avenue' | 'highway'; label: string; cost: number; open: boolean; color: string; need: number }[] = [
        { id: 'road', label: 'Street', cost: COST.street, open: true, color: '#cdd3dc', need: 0 },
        { id: 'avenue', label: 'Avenue', cost: COST.avenue, open: g.unlocked.avenue, color: '#f2b84b', need: UNLOCK.avenue },
        { id: 'highway', label: 'Highway', cost: COST.highway, open: g.unlocked.highway, color: '#34c58a', need: UNLOCK.highway },
      ];
      for (const k of kinds) {
        const chip = h('button', { class: 'mchip' + (t.tool === k.id ? ' on' : '') + (k.open ? '' : ' lock'), onClick: () => t.setRoadType(k.id) }, icon(k.open ? (k.id === 'road' ? 'road' : k.id) : 'lock'), h('span', {}, k.label), k.open ? h('small', {}, money(k.cost)) : h('small', {}, String(k.need)));
        chip.style.setProperty('--mc', k.color);
        row.append(chip);
      }
      const tips: Record<string, string> = {
        road: 'Drag across the map. Streets give homes and shops their frontage.',
        avenue: 'Drag over streets to widen them, or over open ground to lay new avenues.',
        highway: `Fast, no frontage. Drag across a road to make an interchange; both ends get ramps if a street is beside them. Cross-roads need a junction (key 0) or an interchange. Bridges ${money(COST.highwayBridge)}.`,
      };
      node = h('div', { class: 'context glass tcontext' }, row,
        h('div', { class: 'trow' }, h('div', { class: 'sw', style: { background: t.tool === 'highway' ? '#34c58a' : t.tool === 'avenue' ? '#f2b84b' : '#cdd3dc' } }),
          h('div', { class: 't' }, h('b', {}, t.tool === 'highway' ? 'Highway' : t.tool === 'avenue' ? 'Avenue' : 'Street'), h('span', {}, tips[t.tool])),
          h('button', { class: 'btn ghost sm', onClick: () => t.select('inspect') }, 'Done')));
    } else if (t.tool === 'junction') {
      key += 'jct' + t.jmode;
      const row = h('div', { class: 'mode-row' });
      const jopts: { id: JMode; label: string; ic: string; cost: number; color: string; tag: string }[] = [
        { id: 'roundabout', label: 'Roundabout', ic: 'roundabout', cost: COST.roundabout, color: '#7cc4ff', tag: 'Traffic circles an island and never stops for a light. Best on busy crossings of equal roads.' },
        { id: 'signals', label: 'Signals', ic: 'signal', cost: COST.signal, color: '#f2b84b', tag: 'Lights give each road a turn. Good for avenues crossing avenues, slow on quiet streets.' },
        { id: 'ramp', label: 'Interchange', ic: 'ramp', cost: COST.ramp, color: '#34c58a', tag: 'Joins a highway tile to the streets beside it. Highways are sealed off without one.' },
        { id: 'plain', label: 'Plain', ic: 'plain', cost: 0, color: '#cdd3dc', tag: 'Take the signals or roundabout off a junction.' },
      ];
      for (const k of jopts) {
        const chip = h('button', { class: 'mchip' + (t.jmode === k.id ? ' on' : ''), onClick: () => t.setJMode(k.id) }, icon(k.ic), h('span', {}, k.label), h('small', {}, k.cost ? money(k.cost) : 'free'));
        chip.style.setProperty('--mc', k.color);
        row.append(chip);
      }
      const jo = jopts.find((x) => x.id === t.jmode)!;
      node = h('div', { class: 'context glass tcontext' }, row,
        h('div', { class: 'trow' }, h('div', { class: 'sw', style: { background: jo.color } }),
          h('div', { class: 't' }, h('b', {}, `${jo.label}${jo.cost ? ' · ' + money(jo.cost) : ''}`), h('span', {}, `${jo.tag} Click a highlighted tile.`)),
          h('button', { class: 'btn ghost sm', onClick: () => t.select('inspect') }, 'Done')));
    } else if (t.tool !== 'inspect') {
      const def = TOOLS.find((x) => x.id === t.tool)!;
      const tips: Record<string, string> = {
        park: 'Click or drag over empty ground. Parks raise land value nearby.',
        arena: 'Click empty ground beside a road. The city holds a match every few days.',
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

  // ------------------------------------------------------------ advisor

  refreshAdvice() {
    const g = this.app.game;
    const a = g.advice[0];
    const hide = !a || !g.advisorOn || this.app.panels.isOpen || !!this.app.modal || this.app.tools.draft !== null;
    if (hide) { this.advisor.style.display = 'none'; this.advKey = ''; return; }
    const key = a.id + '|' + a.title + '|' + a.cta + '|' + a.body;
    if (key === this.advKey && this.advisor.style.display !== 'none') return;
    this.advKey = key;
    clear(this.advisor);
    this.advisor.className = `advisor glass ${a.tone}`;
    const show = () => {
      if (a.focus) this.app.view.rig.focus(a.focus.x, a.focus.z, a.focus.dist);
      if (a.stopId !== undefined && g.transit.stopById.has(a.stopId)) this.app.tools.setSelection({ type: 'stop', id: a.stopId });
      if (a.lineId !== undefined && g.transit.lineById.has(a.lineId)) this.app.tools.setSelection({ type: 'line', id: a.lineId });
      this.app.sound.sfx('tick');
    };
    const run = () => {
      if (!a.act) return;
      const r = a.act() as any;
      if (!r.ok) { this.app.toast(r.msg ?? 'That did not work.', 'warn'); this.app.sound.sfx('error'); }
      else if (r.line) {
        const l = r.line;
        this.app.toast(`${l.name} is running. Select it any time to add ${MODES[l.kind as Mode].vehicles}.`, 'good');
        if (l.poly) { const p = l.poly.at(l.poly.length / 2); this.app.view.rig.focus(p.x, p.z, 26); }
        this.app.tools.setSelection({ type: 'line', id: l.id });
      }
      g.refreshAdvice();
    };
    this.advisor.append(
      h('div', { class: 'ad-head' }, h('span', { class: 'ad-ic' }, icon('bulb')), h('b', {}, a.title),
        h('button', { class: 'x', title: 'Not now', onClick: () => g.dismissAdvice(a.id) }, icon('close'))),
      h('p', {}, a.body),
      h('div', { class: 'ad-actions' },
        a.cta && a.act ? h('button', { class: 'btn primary sm', onClick: run }, a.cta) : null,
        a.focus || a.stopId !== undefined || a.lineId !== undefined ? h('button', { class: 'btn ghost sm', onClick: show }, 'Show me') : null),
      g.advice.length > 1 ? h('div', { class: 'ad-more' }, `${g.advice.length - 1} more`) : '');
    this.advisor.style.display = '';
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
    if (this.acc > 0.2) { this.acc = 0; this.refreshNumbers(); this.refreshAdvice(); }
    this.updateLabels();
    this.updateTicker();
    void g;
  }

  pushTick(it: { id: number; pid: number; text: string; tone: string }) {
    this.tickQ.push(it);
    if (this.tickQ.length > 4) this.tickQ.splice(0, this.tickQ.length - 2);
  }
  private updateTicker() {
    const now = performance.now();
    const t = this.ticker;
    if (this.tickCur && now > this.tickUntil) { t.classList.remove('show'); this.tickCur = 0; this.tickUntil = now + 450; }
    if (!this.tickCur && this.tickQ.length && now > this.tickUntil && !this.app.modal && !this.app.game.over) {
      const it = this.tickQ.shift()!;
      this.tickCur = it.id;
      (t as any)._pid = it.pid;
      clear(t);
      t.className = `ticker glass show ${it.tone}`;
      t.append(h('i'), it.text);
      this.tickUntil = now + (this.tickQ.length > 1 ? 4200 : 7500);
    }
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

  /** a hungry, tired, stuck or delighted citizen shows it above their head */
  private emoteOf(p: import('../sim/types.ts').Person): { ic: string; c: string } | null {
    const n = p.needs;
    if (p.phase === 'wait' && this.app.game.t - p.waitStart > 35) return { ic: 'warn', c: '#ff7a6b' };
    if (p.phase === 'drive' && p.car && p.car.stuck > 4) return { ic: 'warn', c: '#ff7a6b' };
    if (n.hunger < 0.22) return { ic: 'hunger', c: '#ffb02e' };
    if (n.energy < 0.14) return { ic: 'moon', c: '#9bb4ff' };
    if (n.social < 0.14) return { ic: 'social', c: '#7cc4ff' };
    if (p.mood > 0.84) return { ic: 'fun', c: '#4ade80' };
    return null;
  }
  private updateEmotes(_dt: number) {
    const app = this.app, v = app.view, rig = v.rig;
    const now = performance.now();
    const near = rig.dist < 26 && !app.modal && app.game.speed >= 0;
    if (near && now > this.emoteT) {
      this.emoteT = now + 700;
      const picks: { id: number; d: number }[] = [];
      for (const dot of v.citizens.dots) {
        const dd = Math.hypot(dot.x - rig.target.x, dot.z - rig.target.z);
        if (dd > rig.dist * 0.7) continue;
        if (this.emoteOf(dot.p)) picks.push({ id: dot.p.id, d: dd });
      }
      picks.sort((a, b) => a.d - b.d);
      this.emoteIds = picks.slice(0, 6).map((x) => x.id);
    }
    const seen = new Set<number>();
    if (near) for (const id of this.emoteIds) {
      const p = app.game.city.personById.get(id);
      if (!p) continue;
      const e = this.emoteOf(p);
      if (!e) continue;
      const w = v.citizens.where(p);
      if (w.inside) continue;
      const sp = rig.toScreen(this.tmpV.set(w.x, w.y + 0.2, w.z));
      if (!sp.visible || sp.x < 0 || sp.x > innerWidth || sp.y < 0 || sp.y > innerHeight) continue;
      seen.add(id);
      let el = this.emotes.get(id);
      if (!el) { el = h('div', { class: 'lbl' }, h('div', { class: 'emote' }, icon(e.ic))); this.emotes.set(id, el); this.labels.append(el); }
      const em = el.firstElementChild as HTMLElement;
      if ((el as any)._ic !== e.ic) { (el as any)._ic = e.ic; clear(em); em.append(icon(e.ic)); }
      em.style.setProperty('--c', e.c);
      el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -100%)`;
      el.style.left = '0'; el.style.top = '0';
    }
    for (const [id, el] of this.emotes) if (!seen.has(id)) { el.remove(); this.emotes.delete(id); }
  }

  private updateLabels() {
    const app = this.app, g = app.game, v = app.view;
    const rig = v.rig;
    const dtSafe = 0;
    const showAll = v.mode === 'transit' || app.tools.tool === 'transit';
    const sel = app.tools.selection;
    const hoverTile = app.tools.hover?.tile ?? -1;
    const seen = new Set<number>();
    for (const s of g.transit.stops) {
      const over = s.queue.length > s.cap;
      const busy = s.queue.length >= Math.max(5, s.cap * 0.6);
      const focus = (sel?.type === 'stop' && sel.id === s.id) || hoverTile === s.tile;
      if (!showAll && !over && !busy && !focus) continue;
      const p = rig.toScreen(this.tmpV.set(s.x, s.kind === 'metro' ? 1.35 : s.kind === 'gondola' ? 0.95 : s.kind === 'ferry' ? 0.4 : 0.34, s.z));
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
    // cargo tags over industries (and shops while planning freight)
    const cargoMode = (app.tools.tool === 'transit' && app.tools.group === 'cargo') || v.mode === 'transit';
    const seenC = new Set<number>();
    for (const b of g.city.cargoSites()) {
      const ind = isIndustry(b.special);
      const focus = (sel?.type === 'building' && sel.id === b.id) || hoverTile === b.tile;
      if (!focus && !(cargoMode && (ind || app.tools.group === 'cargo'))) continue;
      const p = rig.toScreen(this.tmpV.set(wx(b.x), v.buildings.heightOf(b) + 0.18, wz(b.y)));
      if (!p.visible || p.x < -60 || p.x > innerWidth + 60 || p.y < -20 || p.y > innerHeight + 20) continue;
      seenC.add(b.id);
      let el = this.cargoLbl.get(b.id);
      if (!el) { el = h('div', { class: 'lbl' }); this.cargoLbl.set(b.id, el); this.labels.append(el); }
      const bits: { c: number; t: string }[] = [];
      if (ind) {
        const F = FACILITY[b.special as keyof typeof FACILITY];
        if (F.makes >= 0) bits.push({ c: CARGO_INFO[CARGO_LIST[F.makes]].color, t: `${Math.floor(b.out[F.makes])}` });
        if (F.takes.length && b.special !== 'terminal') bits.push({ c: CARGO_INFO[CARGO_LIST[F.takes[0]]].color, t: `${Math.floor(b.stock[F.takes[0]])} in` });
      } else { const i = sellsIdx(b); if (i >= 0) bits.push({ c: CARGO_INFO[CARGO_LIST[i]].color, t: `${Math.floor(b.stock[i])}` }); }
      const low = !ind && bits.length && b.stock[sellsIdx(b)] < 3;
      const key = `${b.name}|${bits.map((x) => x.t).join(',')}|${ind}|${low}`;
      if ((el as any)._k !== key) {
        (el as any)._k = key; clear(el);
        const t = h('div', { class: 'tag cargo' + (low ? ' low' : '') });
        if (ind) t.append(b.name);
        for (const bt of bits) t.append(h('i', { style: { background: '#' + bt.c.toString(16).padStart(6, '0') } }), h('b', {}, bt.t));
        if (!ind && !bits.length) t.append(b.name);
        el.append(t);
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.style.left = '0'; el.style.top = '0';
    }
    for (const [id, el] of this.cargoLbl) if (!seenC.has(id)) { el.remove(); this.cargoLbl.delete(id); }
    // little emotes over nearby citizens when the camera is close
    this.updateEmotes(dtSafe);
    // thought bubble over the citizen being watched
    const fp = v.focusPerson;
    if (fp && !fp.dead && !app.panels.open) {
      const wp = v.citizens.where(fp);
      const sp = rig.toScreen(this.tmpV.set(wp.x, wp.y + 0.55, wp.z));
      if (sp.visible && sp.x > 0 && sp.x < innerWidth && sp.y > 0 && sp.y < innerHeight) {
        if (!this.personLbl) { this.personLbl = h('div', { class: 'lbl' }); this.labels.append(this.personLbl); }
        const el = this.personLbl;
        const th = g.city.thoughtOf(fp);
        const key = fp.id + '|' + th;
        if ((el as any)._k !== key) { (el as any)._k = key; clear(el); el.append(h('div', { class: 'bubble' }, h('b', {}, fullName(fp)), h('span', {}, th))); }
        el.style.transform = `translate(${sp.x}px, ${sp.y}px) translate(-50%, -100%)`;
        el.style.left = '0'; el.style.top = '0';
      } else if (this.personLbl) { this.personLbl.remove(); this.personLbl = null; }
    } else if (this.personLbl) { this.personLbl.remove(); this.personLbl = null; }
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
      if (!p.visible || p.x < 175 || p.x > innerWidth - 110 || p.y < 125 || p.y > innerHeight - 90 || (p.x > innerWidth - 340 && p.y < 170)) continue;
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
    void UNLOCK; void wx; void wz; void moodColorHex;
  }
}
