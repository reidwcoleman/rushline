// Right-hand panels: inspect (building / stop / road / line), lines list, policies.
import { h, icon, clear, money, fmt } from './dom.ts';
import { COST, UNLOCK } from '../sim/game.ts';
import { DAY } from '../sim/types.ts';
import type { Line, Stop, Building } from '../sim/types.ts';
import type { Policies } from '../sim/city.ts';
import type { App } from './app.ts';
import { wx, wz, tileX, tileY } from '../sim/world.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const NAMES = { res: ['House', 'Apartments', 'Residential tower'], com: ['Shop', 'Offices', 'Skyscraper'], ind: ['Workshop', 'Factory', 'Industrial plant'] };
const KIND = { res: 'Residential', com: 'Commercial', ind: 'Industrial' };

interface Built { el: HTMLElement; update: () => void }

export class Panels {
  open: 'lines' | 'policies' | null = null;
  private host: HTMLElement;
  private cur: Built | null = null;
  private curKey = '';
  private acc = 0;

  constructor(readonly app: App, root: HTMLElement) {
    this.host = root;
  }

  toggle(name: 'lines' | 'policies') {
    if (name === 'policies' && !this.app.game.unlocked.policies) { this.app.toast(`Policies unlock at ${UNLOCK.policies} residents.`, 'info'); this.app.sound.sfx('error'); return; }
    this.open = this.open === name ? null : name;
    if (this.open) this.app.tools.selection = null;
    this.app.sound.sfx('click');
    this.sync();
  }
  close() {
    this.open = null;
    this.app.tools.selection = null;
    this.sync();
  }

  sync() {
    const t = this.app.tools;
    let key = '';
    let build: (() => Built) | null = null;
    if (this.open === 'lines') { key = 'lines'; build = () => this.linesPanel(); }
    else if (this.open === 'policies') { key = 'policies'; build = () => this.policiesPanel(); }
    else if (t.selection?.type === 'building') { const id = t.selection.id; key = 'b' + id; build = () => this.buildingPanel(id); }
    else if (t.selection?.type === 'stop') { const id = t.selection.id; key = 's' + id; build = () => this.stopPanel(id); }
    else if (t.selection?.type === 'road') { const tile = t.selection.tile; key = 'r' + tile; build = () => this.roadPanel(tile); }
    else if (t.selection?.type === 'line') { const id = t.selection.id; key = 'l' + id; build = () => this.linePanel(id); }
    if (key === this.curKey && this.cur) { this.cur.update(); return; }
    this.cur?.el.remove();
    this.cur = null;
    this.curKey = key;
    if (build) {
      const b = build();
      this.cur = b;
      this.host.append(b.el);
    }
    t.refreshPreview(true);
  }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.4) return;
    this.acc = 0;
    if (this.cur) {
      // drop panels whose subject vanished
      const t = this.app.tools, g = this.app.game;
      const s = t.selection;
      if (s?.type === 'building' && !g.city.buildings.has(s.id)) { t.selection = null; this.sync(); return; }
      if (s?.type === 'stop' && !g.transit.stopById.has(s.id)) { t.selection = null; this.sync(); return; }
      if (s?.type === 'line' && !g.transit.lineById.has(s.id)) { t.selection = null; this.sync(); return; }
      if (this.open === 'lines' && this.curKey === 'lines') this.sync();
      this.cur.update();
    }
  }

  // ------------------------------------------------------------ helpers

  private shell(title: string, sub: string, ...body: (Node | string | null)[]): HTMLElement {
    return h('div', { class: 'side glass' },
      h('div', { class: 'head' }, h('div', {}, h('h3', {}, title), h('div', { class: 'sub' }, sub)), h('button', { class: 'x', title: 'Close', onClick: () => this.close() }, icon('close'))),
      ...body);
  }
  private row(k: string, v: Node | string): [HTMLElement, HTMLElement] {
    const vv = h('span', { class: 'v num' }, v);
    return [h('div', { class: 'row' }, h('span', { class: 'k' }, k), vv), vv];
  }
  private meter(frac: number, color = 'var(--green)') {
    const i = h('i');
    i.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    i.style.background = color;
    return { el: h('div', { class: 'meter' }, i), set: (f: number, c?: string) => { i.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; if (c) i.style.background = c; } };
  }
  private moodWord(v: number) { return v > 0.75 ? 'Delighted' : v > 0.55 ? 'Content' : v > 0.35 ? 'Strained' : 'Fed up'; }
  private moodColor(v: number) { return v > 0.55 ? 'var(--green)' : v > 0.35 ? 'var(--amber)' : 'var(--red)'; }

  // ------------------------------------------------------------ building

  private buildingPanel(id: number): Built {
    const g = this.app.game;
    const b0 = g.city.buildings.get(id)!;
    const [r1, v1] = this.row(b0.kind === 'res' ? 'Residents' : 'Workers', '');
    const [r2, v2] = this.row(b0.kind === 'res' ? 'Mood' : 'Jobs open', '');
    const mood = this.meter(b0.happy);
    const [r3, v3] = this.row('Commute', '');
    const land = this.meter(b0.land, 'var(--amber)');
    const upd = () => {
      const b = g.city.buildings.get(id); if (!b) return;
      if (b.kind === 'res') {
        v1.textContent = `${b.residents.length} / ${b.cap}`;
        v2.textContent = this.moodWord(b.happy);
        mood.set(b.happy, this.moodColor(b.happy));
        let sum = 0, n = 0;
        for (const p of b.residents) if (p.lastTrip > 0) { sum += p.lastTrip; n++; }
        v3.textContent = n ? `${Math.round(sum / n)} s` : 'none yet';
      } else {
        v1.textContent = `${b.workers.length} / ${b.cap}`;
        v2.textContent = String(b.cap - b.workers.length);
        v3.textContent = b.kind === 'com' ? `${b.visitors} visiting` : '';
      }
      land.set(b.land);
    };
    const el = this.shell(b0.special === 'arena' ? 'Arena' : NAMES[b0.kind][b0.level - 1], b0.special === 'arena' ? 'Landmark · hosts match days' : `${KIND[b0.kind]} · level ${b0.level}`,
      h('div', { class: 'kv' }, r1, r2, b0.kind === 'res' ? mood.el : null, r3),
      h('div', { class: 'kv' }, h('div', { class: 'row' }, h('span', { class: 'k' }, 'Land value'), h('span', { class: 'v' }, b0.level < 3 ? 'drives upgrades' : 'maxed')), land.el),
      h('div', { class: 'empty' }, b0.access < 0 ? 'No road touches this lot. Connect it so people can get in and out.' : b0.level < 3 ? 'Good transit, parks and short commutes lift land value. Higher value lets it grow taller.' : 'Fully built up. Keep the commute short to hold the value.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn danger sm', onClick: () => { const r = g.bulldoze(b0.tile); if (r.ok) this.app.tools.setSelection(null); else this.app.toast(r.msg ?? '', 'warn'); } }, `Demolish · ${money(COST.bulldoze)}`)));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ stop

  private stopPanel(id: number): Built {
    const g = this.app.game;
    const s0 = g.transit.stopById.get(id)!;
    const [r1, v1] = this.row('Waiting', '');
    const m = this.meter(0);
    const [r2, v2] = this.row('Boarded', '');
    const chips = h('div', { class: 'chips' });
    const expBtn = h('button', { class: 'btn sm', onClick: () => { const r = g.expandStop(s0); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else upd(); } }, '');
    const upd = () => {
      const s = g.transit.stopById.get(id); if (!s) return;
      v1.textContent = `${s.queue.length} / ${s.cap}`;
      const f = s.queue.length / s.cap;
      m.set(f, f > 1 ? 'var(--red)' : f > 0.7 ? 'var(--amber)' : 'var(--green)');
      v2.textContent = fmt(s.boardings);
      clear(chips);
      for (const l of s.lines) chips.append(h('button', { class: 'chip', onClick: () => this.app.tools.setSelection({ type: 'line', id: l.id }) }, h('i', { style: { background: hex(l.color) } }), l.name));
      if (!s.lines.length) chips.append(h('span', { class: 'empty' }, 'No lines call here yet.'));
      const full = s.cap >= (s.kind === 'bus' ? 48 : 150);
      expBtn.textContent = full ? 'Fully expanded' : `Expand to ${Math.round(s.cap * 1.5)} · ${money(s.kind === 'bus' ? COST.expandBus : COST.expandStation)}`;
      (expBtn as HTMLButtonElement).disabled = full;
    };
    const el = this.shell(s0.name, s0.kind === 'bus' ? 'Bus stop' : 'Metro station',
      h('div', { class: 'kv' }, r1, m.el, r2),
      chips,
      h('div', { class: 'empty' }, s0.kind === 'bus' ? 'If the crowd outgrows the stop it starts to hurt the whole city. Add buses to the line or expand the stop.' : 'Stations hold more people than stops, but a full platform still counts against stability.'),
      h('div', { class: 'actions' }, expBtn,
        h('button', { class: 'btn danger sm', onClick: () => { this.app.game.bulldoze(s0.tile); this.app.tools.setSelection(null); } }, 'Remove')));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ road

  private roadPanel(tile: number): Built {
    const g = this.app.game, w = g.world;
    const kind = () => (w.road[tile] === 2 ? 'Avenue' : w.water[tile] ? 'Bridge' : 'Street');
    const [r1, v1] = this.row('Speed', '');
    const [r2, v2] = this.row('Traffic', '');
    const m = this.meter(0);
    const up = h('button', { class: 'btn sm primary', onClick: () => { const r = g.buildRoad([tile], 2); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else this.app.panels.sync(); } }, `Widen to avenue · ${money(COST.upgrade)}`);
    const upd = () => {
      if (!w.road[tile]) { this.app.tools.setSelection(null); return; }
      const c = g.traffic.cong[tile];
      v1.textContent = `${Math.round(c * 100)}% of free flow`;
      const l = g.traffic.load[tile];
      v2.textContent = l > 0.85 ? 'Packed' : l > 0.5 ? 'Busy' : l > 0.15 ? 'Light' : 'Empty';
      m.set(l, l > 0.85 ? 'var(--red)' : l > 0.5 ? 'var(--amber)' : 'var(--green)');
      (up as HTMLButtonElement).style.display = w.road[tile] === 1 && g.unlocked.avenue ? '' : 'none';
    };
    const el = this.shell(kind(), `Tile ${tileX(tile)}, ${tileY(tile)}`,
      h('div', { class: 'kv' }, r1, r2, m.el),
      h('div', { class: 'actions' }, up, h('button', { class: 'btn danger sm', onClick: () => { g.bulldoze(tile); this.app.tools.setSelection(null); } }, 'Remove road')));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ line

  private linePanel(id: number): Built {
    const g = this.app.game, tr = g.transit;
    const l0 = tr.lineById.get(id)!;
    const [r1, v1] = this.row('Riders on board', '');
    const [r2, v2] = this.row('Boarded', '');
    const [r3, v3] = this.row('Fare income', '');
    const [r4, v4] = this.row('Every', '');
    const count = h('b', {}, '');
    const cost = h('span', { class: 'sub' }, '');
    const stops = h('div', { class: 'chips' });
    const plus = h('button', { onClick: () => { const r = g.addVehicle(l0); if (!r.ok) { this.app.toast(r.msg ?? '', 'warn'); this.app.sound.sfx('error'); } else upd(); } }, '+');
    const minus = h('button', { onClick: () => { const r = g.removeVehicle(l0); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else upd(); } }, '−');
    const warn = h('div', { class: 'empty', style: { color: 'var(--amber)' } });
    const upd = () => {
      const l = tr.lineById.get(id); if (!l) return;
      const board = l.vehicles.reduce((a, c) => a + c.passengers.length, 0);
      v1.textContent = `${board}`;
      v2.textContent = fmt(l.boardings);
      v3.textContent = money(l.income);
      const hw = tr.headway(l);
      v4.textContent = isFinite(hw) ? `${Math.round(hw)} s` : '–';
      count.textContent = String(l.vehicles.length);
      const max = tr.maxVehicles(l);
      cost.textContent = `${l.kind === 'bus' ? 'Buses' : 'Trains'} · ${money(tr.vehicleCost(l))} each · max ${max}`;
      clear(stops);
      for (const s of l.stops) stops.append(h('button', { class: 'chip', onClick: () => this.app.tools.setSelection({ type: 'stop', id: s.id }) }, h('i', { style: { background: s.queue.length > s.cap ? 'var(--red)' : hex(l.color) } }), s.name));
      warn.textContent = l.broken ? 'A stop on this line cannot be reached by road. Reconnect it or remove the line.' : '';
      warn.style.display = l.broken ? '' : 'none';
    };
    const el = this.shell(l0.name, `${l0.kind === 'bus' ? 'Bus' : 'Metro'} line · ${l0.stops.length} ${l0.kind === 'bus' ? 'stops' : 'stations'}`,
      h('div', { class: 'row' }, h('span', { class: 'chip', style: { background: hex(l0.color), color: '#10151c' } }, l0.kind === 'bus' ? 'Bus' : 'Metro'), h('div', { class: 'stepper' }, minus, count, plus)),
      cost,
      warn,
      h('div', { class: 'kv' }, r1, r2, r3, r4),
      stops,
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onClick: () => this.app.tools.startExtend(l0) }, 'Extend'),
        h('button', { class: 'btn sm', onClick: () => { const s = l0.stops[0]; this.app.view.rig.focus(s.x, s.z, 24); } }, 'Show'),
        h('button', { class: 'btn danger sm', onClick: () => { g.deleteLine(l0); this.app.tools.setSelection(null); this.app.toast(`${l0.name} removed.`, 'info'); } }, 'Delete')));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ lines list

  private linesPanel(): Built {
    const g = this.app.game, tr = g.transit;
    const list = h('div', { class: 'kv' });
    const upd = () => {
      clear(list);
      if (!tr.lines.length) { list.append(h('div', { class: 'empty' }, 'No lines yet. Pick the Bus line tool (4), click a few roads to place stops, then press Finish.')); return; }
      for (const l of tr.lines) {
        const board = l.vehicles.reduce((a, c) => a + c.passengers.length, 0);
        const wait = l.stops.reduce((a, s) => a + s.queue.length, 0);
        list.append(h('button', { class: 'lineitem', onClick: () => { this.open = null; this.app.tools.setSelection({ type: 'line', id: l.id }); } },
          h('div', { class: 'sw', style: { background: hex(l.color) } }),
          h('div', {}, h('div', { class: 'n' }, l.name), h('div', { class: 'm' }, `${l.stops.length} stops · ${l.vehicles.length} ${l.kind === 'bus' ? 'bus' : 'train'}${l.vehicles.length === 1 ? '' : l.kind === 'bus' ? 'es' : 's'} · ${wait} waiting`)),
          h('div', { class: 'r num' }, `${board}`, h('div', { class: 'm' }, 'on board'))));
      }
    };
    const el = this.shell('Lines', `${tr.lines.length} running`, list);
    upd();
    return { el, update: () => { upd(); (el.querySelector('.sub') as HTMLElement).textContent = `${tr.lines.length} running`; } };
  }

  // ------------------------------------------------------------ policies

  private policiesPanel(): Built {
    const g = this.app.game;
    const defs: { k: keyof Policies; name: string; desc: string; cost: string }[] = [
      { k: 'stagger', name: 'Staggered hours', desc: 'Start times spread over the morning, which flattens the rush.', cost: '$25 a day' },
      { k: 'busLanes', name: 'Bus lanes', desc: 'Buses get their own lane and skip the jams. Cars lose a little road.', cost: '$30 a day' },
      { k: 'toll', name: 'Congestion charge', desc: 'Drivers pay to enter the centre, so fewer cars go there. Earns a fee.', cost: '$20 a day' },
      { k: 'remote', name: 'Work-from-home days', desc: 'Some workers stay home each day. Less commuting, less shopping.', cost: '$25 a day' },
      { k: 'freeTransit', name: 'Free transit', desc: 'No fares, so far more people ride. You give up the fare income.', cost: 'No fares' },
    ];
    const rows = defs.map((d) => {
      const sw = h('button', { class: 'sw-toggle', onClick: () => { const r = g.setPolicy(d.k, !g.policies[d.k]); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); upd(); } });
      const row = h('div', { class: 'pol' }, h('b', {}, d.name), sw, h('span', {}, d.desc), h('span', { class: 'cost' }, d.cost));
      return { sw, d, row };
    });
    const upd = () => { for (const r of rows) r.sw.classList.toggle('on', !!g.policies[r.d.k]); };
    const el = this.shell('Policies', 'Rules that apply to the whole city', ...rows.map((r) => r.row));
    upd();
    return { el, update: upd };
  }
}
void DAY; void wx; void wz;
export type { Stop, Line, Building };
