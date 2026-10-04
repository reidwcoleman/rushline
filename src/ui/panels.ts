// Right-hand panels: inspect (building / stop / road / line), lines list, policies.
import { h, icon, clear, money, fmt } from './dom.ts';
import { COST, UNLOCK } from '../sim/game.ts';
import { roadLabel } from './tools.ts';
import { MODES, isCargoMode } from '../sim/modes.ts';
import { CARGO_INFO, CARGO_LIST, FACILITY, isIndustry, sellsIdx, OUT_CAP, STOCK_CAP } from '../sim/industry.ts';
import { DAY } from '../sim/types.ts';
import type { Line, Stop, Building } from '../sim/types.ts';
import type { Policies } from '../sim/city.ts';
import type { App } from './app.ts';
import { wx, wz, tileX, tileY } from '../sim/world.ts';
import { citizenPanel, directoryPanel, buildingResidents } from './citizens.ts';
import { companyPanel, fareControl, lineProfit } from './company.ts';
import { venueLabel, moodColorHex } from '../sim/people.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const NAMES = { res: ['House', 'Apartments', 'Residential tower'], com: ['Shop', 'Offices', 'Skyscraper'], ind: ['Workshop', 'Factory', 'Industrial plant'] };
const KIND = { res: 'Residential', com: 'Commercial', ind: 'Industrial' };

interface Built { el: HTMLElement; update: () => void }

export class Panels {
  open: 'lines' | 'policies' | 'citizens' | 'company' | null = null;
  get isOpen() { return !!this.cur; }
  private host: HTMLElement;
  private cur: Built | null = null;
  private curKey = '';
  private acc = 0;

  constructor(readonly app: App, root: HTMLElement) {
    this.host = root;
  }

  toggle(name: 'lines' | 'policies' | 'citizens' | 'company') {
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
    else if (this.open === 'citizens') { key = 'citizens'; build = () => directoryPanel(this); }
    else if (this.open === 'company') { key = 'company'; build = () => companyPanel(this); }
    else if (t.selection?.type === 'person') { const id = t.selection.id; key = 'c' + id; build = () => citizenPanel(this, id); }
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
      if (s?.type === 'person' && !g.city.personById.has(s.id)) { t.selection = null; this.app.view.follow = false; this.sync(); return; }
      if (this.open === 'lines' && this.curKey === 'lines') this.sync();
      this.cur.update();
    }
  }

  // ------------------------------------------------------------ helpers

  shell(title: string, sub: string, ...body: (Node | string | null)[]): HTMLElement {
    return h('div', { class: 'side glass' },
      h('div', { class: 'head' }, h('div', {}, h('h3', {}, title), h('div', { class: 'sub' }, sub)), h('button', { class: 'x', title: 'Close', onClick: () => this.close() }, icon('close'))),
      ...body);
  }
  row(k: string, v: Node | string): [HTMLElement, HTMLElement] {
    const vv = h('span', { class: 'v num' }, v);
    return [h('div', { class: 'row' }, h('span', { class: 'k' }, k), vv), vv];
  }
  meter(frac: number, color = 'var(--green)') {
    const i = h('i');
    i.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
    i.style.background = color;
    return { el: h('div', { class: 'meter' }, i), set: (f: number, c?: string) => { i.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; if (c) i.style.background = c; } };
  }
  moodWord(v: number) { return v > 0.75 ? 'Delighted' : v > 0.55 ? 'Content' : v > 0.35 ? 'Strained' : 'Fed up'; }
  private moodColor(v: number) { return v > 0.55 ? 'var(--green)' : v > 0.35 ? 'var(--amber)' : 'var(--red)'; }

  // ------------------------------------------------------------ building

  private buildingPanel(id: number): Built {
    const g = this.app.game;
    const b0 = g.city.buildings.get(id)!;
    const home = b0.kind === 'res';
    const [r1, v1] = this.row(home ? 'Residents' : b0.special === 'school' ? 'Staff' : 'Workers', '');
    const [r2, v2] = this.row(home ? 'Mood' : b0.special === 'school' ? 'Pupils' : 'Jobs open', '');
    const mood = this.meter(b0.happy);
    const [r3, v3] = this.row(home ? 'Commute' : 'Inside now', '');
    const land = this.meter(b0.land, 'var(--amber)');
    const people = h('div', {});
    let pKey = '';
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
        v2.textContent = b.special === 'school' ? `${b.students.length} / 70` : String(b.cap - b.workers.length);
        v3.textContent = `${b.guests.length + b.workers.filter((w) => w.at === b && w.phase === 'none').length}`;
      }
      land.set(b.land);
      updCargo();
      const k = (b.kind === 'res' ? b.residents : b.special === 'school' ? b.students : b.workers).map((p) => p.id).slice(0, 10).join(',');
      if (k !== pKey) { pKey = k; clear(people); people.append(h('div', { class: 'k small' }, home ? 'Who lives here' : b.special === 'school' ? 'Pupils' : 'Who works here'), buildingResidents(this, b)); }
    };
    const cargo = h('div', { class: 'sec' });
    const updCargo = () => {
      const b = g.city.buildings.get(id); if (!b) return;
      clear(cargo);
      if (isIndustry(b.special)) {
        const F = FACILITY[b.special as keyof typeof FACILITY];
        cargo.append(h('div', { class: 'k small' }, F.label === 'Cargo terminal' ? 'Accepts anything' : 'Cargo'));
        if (F.makes >= 0) {
          const ci = CARGO_INFO[CARGO_LIST[F.makes]];
          const m = this.meter(b.out[F.makes] / OUT_CAP, b.out[F.makes] > OUT_CAP * 0.85 ? 'var(--amber)' : 'var(--green)');
          cargo.append(h('div', { class: 'cargo-row' }, h('div', { class: 'row' }, h('span', { class: 'cchip', style: { '--c': '#' + ci.color.toString(16).padStart(6, '0') } as any }, h('i'), `${ci.label} ready`), h('span', { class: 'v num' }, `${Math.floor(b.out[F.makes])} / ${OUT_CAP}`)), m.el));
          cargo.append(h('div', { class: 'row' }, h('span', { class: 'k' }, 'Makes'), h('span', { class: 'v num' }, `${Math.round(F.rate * b.eff)} a day`)));
          cargo.append(h('div', { class: 'row' }, h('span', { class: 'k' }, 'Service rating'), h('span', { class: 'v num' }, b.eff >= 1.4 ? 'Excellent' : b.eff >= 1.05 ? 'Good' : b.eff >= 0.8 ? 'Fair' : 'Poor')));
        }
        if (F.takes.length && b.special !== 'terminal') {
          const ci = CARGO_INFO[CARGO_LIST[F.takes[0]]];
          cargo.append(h('div', { class: 'row' }, h('span', { class: 'cchip', style: { '--c': '#' + ci.color.toString(16).padStart(6, '0') } as any }, h('i'), `${ci.label} waiting to process`), h('span', { class: 'v num' }, `${Math.floor(b.stock[F.takes[0]])}`)));
        }
        const lines = g.transit.lines.filter((l) => isCargoMode(l.kind) && l.stops.some((st) => Math.hypot(st.x - wx(b.x), st.z - wz(b.y)) <= 2.4));
        cargo.append(h('div', { class: 'chips' }, ...(lines.length ? lines.map((l) => h('button', { class: 'chip', onClick: () => this.app.tools.setSelection({ type: 'line', id: l.id }) }, h('i', { style: { background: hex(l.color) } }), l.name)) : [h('span', { class: 'empty', style: { padding: '0' } }, 'No freight line calls here yet.')])));
      } else if (sellsIdx(b) >= 0) {
        const idx = sellsIdx(b), ci = CARGO_INFO[CARGO_LIST[idx]];
        const m = this.meter(b.stock[idx] / STOCK_CAP, b.stock[idx] < 3 ? 'var(--red)' : 'var(--green)');
        cargo.append(h('div', { class: 'k small' }, 'Supplies'), h('div', { class: 'cargo-row' }, h('div', { class: 'row' }, h('span', { class: 'cchip', style: { '--c': '#' + ci.color.toString(16).padStart(6, '0') } as any }, h('i'), `${ci.label} on the shelves`), h('span', { class: 'v num' }, `${Math.floor(b.stock[idx])} / ${STOCK_CAP}`)), m.el),
          h('div', { class: 'empty', style: { padding: '0', fontSize: '12px' } }, b.stock[idx] < 3 ? 'Running on imports, which cost money. Deliver local goods by truck or rail.' : 'Stocked locally. Every unit delivered saves an import.'));
      }
    };
    const title = b0.kind === 'res' ? venueLabel(b0) : b0.name;
    const subline = b0.special === 'arena' ? 'Landmark · hosts match days' : b0.special ? `${venueLabel(b0)} · city service` : b0.kind === 'res' ? `${this.app.game.city.addressOf(b0)}` : `${venueLabel(b0)} · ${this.app.game.city.districtOf(b0)}`;
    const tip = isIndustry(b0.special) ? FACILITY[b0.special as keyof typeof FACILITY].tag + ' Build a freight line (Freight in the transit tool) to haul it.' : b0.special === 'school' ? 'Pupils within about 18 tiles enrol. They need a way in every morning.' : b0.special === 'clinic' ? 'Seniors nearby live longer and feel better. Check-ups bring visitors.' : b0.access < 0 ? 'No road touches this lot. Connect it so people can get in and out.' : b0.level < 3 ? 'Good transit, parks and short commutes lift land value. Higher value lets it grow taller.' : 'Fully built up. Keep the commute short to hold the value.';
    const el = this.shell(title, subline,
      h('div', { class: 'kv' }, r1, r2, home ? mood.el : null, r3),
      people,
      cargo,
      b0.special && b0.special !== 'arena' && b0.special !== 'school' && b0.special !== 'clinic' ? null : b0.special ? null : h('div', { class: 'kv' }, h('div', { class: 'row' }, h('span', { class: 'k' }, 'Land value'), h('span', { class: 'v' }, b0.level < 3 ? 'drives upgrades' : 'maxed')), land.el),
      h('div', { class: 'empty' }, tip),
      h('div', { class: 'actions' }, h('button', { class: 'btn danger sm', onClick: () => { const r = g.bulldoze(b0.tile); if (r.ok) this.app.tools.setSelection(null); else this.app.toast(r.msg ?? '', 'warn'); } }, `Demolish · ${money(COST.bulldoze)}`)));
    void moodColorHex;
    // name your own places
    if (b0.kind !== 'res' && b0.name && !b0.special) {
      const h3 = el.querySelector('h3');
      if (h3) {
        const inp = h('input', { class: 'rename', value: b0.name, maxlength: 28, spellcheck: 'false', title: 'Click to rename' }) as HTMLInputElement;
        inp.addEventListener('change', () => { const v = inp.value.trim(); if (v) b0.name = v; else inp.value = b0.name; });
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
        h3.replaceWith(inp);
      }
    }
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
      const full = s.cap >= MODES[s.kind].stopMax;
      expBtn.textContent = full ? 'Fully expanded' : `Expand to ${Math.min(MODES[s.kind].stopMax, Math.round(s.cap * 1.5))} · ${money(MODES[s.kind].expandCost)}`;
      (expBtn as HTMLButtonElement).disabled = full;
    };
    const md = MODES[s0.kind];
    if (isCargoMode(s0.kind)) {
      const near = h('div', { class: 'kv' });
      const chipsC = h('div', { class: 'chips' });
      const updC = () => {
        const s = g.transit.stopById.get(id); if (!s) return;
        clear(near); clear(chipsC);
        for (const b of g.city.sitesNear(s.x, s.z)) {
          const bits: string[] = [];
          if (isIndustry(b.special)) { for (let i = 0; i < 3; i++) if (b.out[i] > 0.5) bits.push(`${Math.floor(b.out[i])} ${CARGO_INFO[CARGO_LIST[i]].label.toLowerCase()} ready`); if (b.special === 'factory') bits.push(`${Math.floor(b.stock[1])} stone waiting`); if (b.special === 'terminal') bits.push('takes anything'); }
          else { const i = sellsIdx(b); if (i >= 0) bits.push(`${Math.floor(b.stock[i])} ${CARGO_INFO[CARGO_LIST[i]].label.toLowerCase()} in stock`); }
          near.append(h('button', { class: 'lineitem', style: { gridTemplateColumns: '1fr' }, onClick: () => this.app.tools.setSelection({ type: 'building', id: b.id }) }, h('div', {}, h('div', { class: 'n' }, b.name), h('div', { class: 'm' }, bits.join(' · ') || venueLabel(b)))));
        }
        if (!near.childElementCount) near.append(h('div', { class: 'empty' }, 'Nothing is in reach of this yard any more.'));
        for (const l of s.lines) chipsC.append(h('button', { class: 'chip', onClick: () => this.app.tools.setSelection({ type: 'line', id: l.id }) }, h('i', { style: { background: hex(l.color) } }), l.name));
        if (!s.lines.length) chipsC.append(h('span', { class: 'empty' }, 'No lines call here yet.'));
      };
      const elC = this.shell(s0.name, `${md.label} ${md.stopWord}`, h('div', { class: 'k small', style: { color: 'var(--text-2)', fontSize: '12px', fontWeight: '600' } }, 'In reach'), near, chipsC,
        h('div', { class: 'actions' }, h('button', { class: 'btn danger sm', onClick: () => { this.app.game.bulldoze(s0.tile); this.app.tools.setSelection(null); } }, 'Remove')));
      updC();
      return { el: elC, update: updC };
    }
    const el = this.shell(s0.name, `${md.label} ${md.stopWord}`,
      h('div', { class: 'kv' }, r1, m.el, r2),
      chips,
      h('div', { class: 'empty' }, md.solid ? 'Big stops hold more people, but a full platform still counts against stability.' : 'If the crowd outgrows the stop it starts to hurt the whole city. Add vehicles to the line or expand the stop.'),
      h('div', { class: 'actions' }, expBtn,
        h('button', { class: 'btn danger sm', onClick: () => { this.app.game.bulldoze(s0.tile); this.app.tools.setSelection(null); } }, 'Remove')));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ road

  private roadPanel(tile: number): Built {
    const g = this.app.game, w = g.world;
    const kind = () => roadLabel(w, tile);
    const [r1, v1] = this.row('Speed', '');
    const [r2, v2] = this.row('Traffic', '');
    const m = this.meter(0);
    const up = h('button', { class: 'btn sm primary', onClick: () => { const r = g.buildRoad([tile], 2); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else this.app.panels.sync(); } }, `Widen to avenue · ${money(COST.upgrade)}`);
    // junction control: what governs this crossing
    const jbtn = (label: string, code: 0 | 1 | 2 | 'ramp', cost: number) => h('button', {
      class: 'btn sm', onClick: () => { const r = g.setJunction(tile, code); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else upd(); },
    }, cost ? `${label} · ${money(cost)}` : label);
    const bRab = jbtn('Roundabout', 2, COST.roundabout), bSig = jbtn('Signals', 1, COST.signal), bPlain = jbtn('Plain', 0, 0), bRamp = jbtn('Make interchange', 'ramp', COST.ramp);
    const jrow = h('div', { class: 'actions' }, bRab, bSig, bPlain, bRamp);
    const upd = () => {
      if (!w.road[tile]) { this.app.tools.setSelection(null); return; }
      const t3 = el.querySelector('h3'); if (t3) t3.textContent = kind();
      const jc = g.unlocked.junction;
      const canJ = w.surf(tile) && w.degree(tile) >= 3;
      bRab.style.display = canJ && jc ? '' : 'none'; bSig.style.display = canJ && jc ? '' : 'none'; bPlain.style.display = canJ && jc && w.ctl[tile] ? '' : 'none';
      bRab.classList.toggle('on', w.ctl[tile] === 2); bSig.classList.toggle('on', w.ctl[tile] === 1);
      bRamp.style.display = jc && g.junctionCheck(tile, 'ramp') === null ? '' : 'none';
      jrow.style.display = jc && (canJ || bRamp.style.display === '') ? '' : 'none';
      const c = g.traffic.cong[tile];
      v1.textContent = `${Math.round(c * 100)}% of free flow`;
      const l = g.traffic.load[tile];
      v2.textContent = l > 0.85 ? 'Packed' : l > 0.5 ? 'Busy' : l > 0.15 ? 'Light' : 'Empty';
      m.set(l, l > 0.85 ? 'var(--red)' : l > 0.5 ? 'var(--amber)' : 'var(--green)');
      (up as HTMLButtonElement).style.display = w.road[tile] === 1 && g.unlocked.avenue ? '' : 'none';
    };
    const el = this.shell(kind(), `Tile ${tileX(tile)}, ${tileY(tile)}`,
      h('div', { class: 'kv' }, r1, r2, m.el),
      jrow,
      h('div', { class: 'actions' }, up, h('button', { class: 'btn danger sm', onClick: () => { g.bulldoze(tile); this.app.tools.setSelection(null); } }, 'Remove road')));
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ line

  private linePanel(id: number): Built {
    const g = this.app.game, tr = g.transit;
    const l0 = tr.lineById.get(id)!;
    const cargoLine = isCargoMode(l0.kind);
    const [r1, v1] = this.row(cargoLine ? 'Cargo on board' : 'Riders on board', '');
    const [r2, v2] = this.row(cargoLine ? 'Hauled' : 'Boarded', '');
    const [r3, v3] = this.row(cargoLine ? 'Freight income' : 'Fare income', '');
    const [r4, v4] = this.row('Every', '');
    const [r5, v5] = this.row('Profit', '');
    const [r6, v6] = this.row('Fleet', '');
    const fareBox = h('div', { class: 'sec' });
    const renewBtn = h('button', { class: 'btn sm', onClick: () => { const r = g.renewLine(l0, true); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else this.app.toast(r.msg ?? '', 'good'); upd(); } }, 'Renew worn');
    const count = h('b', {}, '');
    const cost = h('span', { class: 'sub' }, '');
    const stops = h('div', { class: 'chips' });
    const plus = h('button', { onClick: () => { const r = g.addVehicle(l0); if (!r.ok) { this.app.toast(r.msg ?? '', 'warn'); this.app.sound.sfx('error'); } else upd(); } }, '+');
    const minus = h('button', { onClick: () => { const r = g.removeVehicle(l0); if (!r.ok) this.app.toast(r.msg ?? '', 'warn'); else upd(); } }, '−');
    const warn = h('div', { class: 'empty', style: { color: 'var(--amber)' } });
    const upd = () => {
      const l = tr.lineById.get(id); if (!l) return;
      const board = cargoLine ? Math.round(l.vehicles.reduce((a, c) => a + (c.load?.qty ?? 0), 0)) : l.vehicles.reduce((a, c) => a + c.passengers.length, 0);
      v1.textContent = cargoLine ? `${board} units` : `${board}`;
      v2.textContent = cargoLine ? `${fmt(l.hauled)} units` : fmt(l.boardings);
      v3.textContent = money(l.income);
      const hw = tr.headway(l);
      v4.textContent = isFinite(hw) ? `${Math.round(hw)} s` : '–';
      const pf = lineProfit(l);
      v5.textContent = `${pf >= 0 ? '+' : '-'}${money(Math.abs(pf))} a day`;
      v5.style.color = pf >= 0 ? 'var(--green)' : 'var(--red)';
      const avg = l.vehicles.length ? l.vehicles.reduce((a, c) => a + c.cond, 0) / l.vehicles.length : 1;
      const worn = l.vehicles.filter((c) => c.cond < 0.5 || tr.ageDays(c) > MODES[l.kind].life).length;
      v6.textContent = `${Math.round(avg * 100)}% condition${worn ? ` · ${worn} worn` : ''}`;
      v6.style.color = avg < 0.4 ? 'var(--red)' : avg < 0.6 ? 'var(--amber)' : '';
      (renewBtn as HTMLElement).style.display = worn ? '' : 'none';
      clear(fareBox);
      if (!cargoLine) fareBox.append(h('div', { class: 'k' }, `Ticket price · ${l.fareMul === 0 ? 'free' : '$' + (MODES[l.kind].fare * l.fareMul).toFixed(2) + ' a ride'}`), fareControl(this, l, () => upd()));
      count.textContent = String(l.vehicles.length);
      const max = tr.maxVehicles(l);
      cost.textContent = `${MODES[l.kind].vehicles[0].toUpperCase()}${MODES[l.kind].vehicles.slice(1)} · ${money(tr.vehicleCost(l))} each · max ${max}`;
      clear(stops);
      for (const s of l.stops) stops.append(h('button', { class: 'chip', onClick: () => this.app.tools.setSelection({ type: 'stop', id: s.id }) }, h('i', { style: { background: s.queue.length > s.cap ? 'var(--red)' : hex(l.color) } }), s.name));
      warn.textContent = l.broken ? 'A stop on this line cannot be reached by road. Reconnect it or remove the line.' : '';
      warn.style.display = l.broken ? '' : 'none';
    };
    const lm = MODES[l0.kind];
    const el = this.shell(l0.name, `${lm.label} line · ${l0.stops.length} ${lm.stopWord}s`,
      h('div', { class: 'row' }, h('span', { class: 'chip', style: { background: hex(l0.color), color: '#10151c' } }, lm.label), h('div', { class: 'stepper' }, minus, count, plus)),
      cost,
      warn,
      h('div', { class: 'kv' }, r1, r2, r3, r4, r5, r6),
      fareBox,
      stops,
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onClick: () => this.app.tools.startExtend(l0) }, 'Extend'),
        renewBtn,
        h('button', { class: 'btn sm', onClick: () => { const s = l0.stops[0]; this.app.view.rig.focus(s.x, s.z, 24); } }, 'Show'),
        h('button', { class: 'btn danger sm', onClick: () => { g.deleteLine(l0); this.app.tools.setSelection(null); this.app.toast(`${l0.name} removed.`, 'info'); } }, 'Delete')));
    // the name is yours to change
    const h3 = el.querySelector('h3');
    if (h3) {
      const inp = h('input', { class: 'rename', value: l0.name, maxlength: 26, spellcheck: 'false', title: 'Click to rename' }) as HTMLInputElement;
      inp.addEventListener('change', () => { const v = inp.value.trim(); if (v) { l0.name = v; g.emit('linesChanged'); } else inp.value = l0.name; });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') inp.blur(); });
      h3.replaceWith(inp);
    }
    upd();
    return { el, update: upd };
  }

  // ------------------------------------------------------------ lines list

  private linesPanel(): Built {
    const g = this.app.game, tr = g.transit;
    const list = h('div', { class: 'kv' });
    const upd = () => {
      clear(list);
      if (!tr.lines.length) { list.append(h('div', { class: 'empty' }, 'No lines yet. Pick the Transit tool (4), choose a mode, click a few spots to place stops, then press Finish.')); return; }
      for (const l of tr.lines) {
        const cl = isCargoMode(l.kind);
        const board = cl ? Math.round(l.vehicles.reduce((a, c) => a + (c.load?.qty ?? 0), 0)) : l.vehicles.reduce((a, c) => a + c.passengers.length, 0);
        const wait = l.stops.reduce((a, s) => a + s.queue.length, 0);
        list.append(h('button', { class: 'lineitem', onClick: () => { this.open = null; this.app.tools.setSelection({ type: 'line', id: l.id }); } },
          h('div', { class: 'sw', style: { background: hex(l.color) } }),
          h('div', {}, h('div', { class: 'n' }, l.name), h('div', { class: 'm' }, `${MODES[l.kind].label} · ${l.stops.length} ${MODES[l.kind].stopWord}s · ${l.vehicles.length} ${l.vehicles.length === 1 ? MODES[l.kind].vehicle : MODES[l.kind].vehicles}${cl ? '' : ` · ${wait} waiting`}`)),
          h('div', { class: 'r num' }, `${board}`, h('div', { class: 'm' }, cl ? 'units' : 'on board'))));
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
