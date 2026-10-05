// The Sims-style live panel: portrait with a mood gem, the household, and every need as a bar.
import { h, icon, clear } from './dom.ts';
import { drawAvatar } from './avatar.ts';
import { NEED_KEYS, NEED_LABEL, moodWord, moodColorHex, fullName } from '../sim/people.ts';
import { aspirationOf } from '../sim/skills.ts';
import { hourOf } from '../sim/types.ts';
import { personLine } from './citizens.ts';
import type { Person } from '../sim/types.ts';
import type { App } from './app.ts';

const needColor = (v: number) => (v > 0.55 ? 'var(--green)' : v > 0.28 ? 'var(--amber)' : 'var(--red)');

export class SimBar {
  el: HTMLElement;
  private cv = h('canvas', { class: 'sb-face' });
  private gem = h('i', { class: 'sb-gem' });
  private name = h('b', { class: 'sb-name' });
  private sub = h('span', { class: 'sb-sub' });
  private mood = h('span', { class: 'sb-mood' });
  private now = h('div', { class: 'sb-now' });
  private asp = h('div', { class: 'sb-asp' });
  private aspBar = h('i');
  private aspTxt = h('span');
  private house = h('div', { class: 'sb-house' });
  private needs = new Map<string, { fill: HTMLElement; row: HTMLElement }>();
  private shown = -1;
  private acc = 0;
  private lookKey = '';
  private houseKey = '';

  constructor(readonly app: App, root: HTMLElement) {
    const grid = h('div', { class: 'sb-needs' });
    for (const k of NEED_KEYS) {
      const fill = h('i');
      const row = h('div', { class: 'sb-need', title: NEED_LABEL[k] }, icon(k), h('span', { class: 'sb-bar' }, fill), h('small', {}, NEED_LABEL[k]));
      this.needs.set(k, { fill, row });
      grid.append(row);
    }
    this.asp.append(h('span', { class: 'sb-bar' }, this.aspBar), this.aspTxt);
    const face = h('div', { class: 'sb-face-wrap' }, this.gem, this.cv);
    const info = h('div', { class: 'sb-info' }, h('div', { class: 'sb-top' }, this.name, this.mood), this.sub, this.now, this.asp);
    this.el = h('div', { class: 'simbar glass', style: { display: 'none' } }, this.house, face, info, grid);
    root.append(this.el);
  }

  update(dt: number) {
    const app = this.app, sel = app.tools.selection;
    const p = sel?.type === 'person' ? app.game.city.personById.get(sel.id) ?? null : null;
    if (!p) { if (this.shown !== -1) { this.shown = -1; this.el.style.display = 'none'; } return; }
    if (this.shown !== p.id) { this.shown = p.id; this.el.style.display = ''; this.lookKey = ''; this.houseKey = ''; this.acc = 1; this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in'); }
    this.acc += dt;
    if (this.acc < 0.15) return;
    this.acc = 0;
    const city = app.game.city;
    const band = p.mood > 0.6 ? 2 : p.mood > 0.42 ? 1 : 0;
    const lk = `${p.id}|${p.look}|${band}|${p.age}`;
    if (lk !== this.lookKey) { this.lookKey = lk; drawAvatar(this.cv as HTMLCanvasElement, p, 88); }
    const col = moodColorHex(p.mood);
    this.el.style.setProperty('--mc', col);
    this.name.textContent = fullName(p);
    this.sub.textContent = personLine(p);
    this.mood.textContent = `${moodWord(p.mood)} · ${Math.round(p.mood * 100)}`;
    this.now.textContent = city.activityOf(p, hourOf(app.game.t));
    for (const k of NEED_KEYS) {
      const v = p.needs[k], e = this.needs.get(k)!;
      e.fill.style.width = Math.round(v * 100) + '%';
      e.fill.style.background = needColor(v);
      e.row.classList.toggle('low', v < 0.28);
    }
    const a = aspirationOf(p);
    this.asp.style.display = a ? '' : 'none';
    if (a) {
      const pr = p.aspDone ? 1 : Math.min(1, a.progress(p));
      this.aspBar.style.width = Math.round(pr * 100) + '%';
      this.aspTxt.textContent = p.aspDone ? `${a.label} · done` : a.label;
      this.asp.title = a.goal;
    }
    // household portraits
    const hk = p.hh.members.map((m) => `${m.id}${m.mood > 0.6 ? 2 : m.mood > 0.42 ? 1 : 0}${m.look}`).join(',') + '|' + p.id;
    if (hk !== this.houseKey) {
      this.houseKey = hk;
      clear(this.house);
      for (const m of p.hh.members.slice(0, 6)) this.house.append(this.member(m, m === p));
      this.house.style.display = p.hh.members.length > 1 ? '' : 'none';
    }
  }

  private member(m: Person, on: boolean) {
    const cv = h('canvas', {}) as HTMLCanvasElement;
    drawAvatar(cv, m, 38);
    const b = h('button', { class: 'sb-mem' + (on ? ' on' : ''), title: `${fullName(m)}, ${m.age}`, onClick: () => this.app.selectPerson(m, true) }, cv);
    b.style.setProperty('--mc', moodColorHex(m.mood));
    return b;
  }
}
