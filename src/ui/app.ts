// App shell: screens (title, pause, game over), coach, saving, and the per-frame glue between game, view and UI.
import { Game, serialize, GOALS } from '../sim/game.ts';
import { DAY, hourOf } from '../sim/types.ts';
import { View } from '../render/view.ts';
import { Sound } from '../audio/audio.ts';
import { h, icon, money, fmt } from './dom.ts';
import { Tools } from './tools.ts';
import { Hud } from './hud.ts';
import { Panels } from './panels.ts';
import { MODES, MODE_ORDER, CARGO_ORDER } from '../sim/modes.ts';
import type { Person } from '../sim/types.ts';
import type { Quality } from '../render/renderer.ts';

const SAVE_KEY = 'rushline.save.v1';
const PREF_KEY = 'rushline.prefs.v1';

export const hasSave = () => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } };
export const loadSave = () => { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };

interface Coach { id: string; title: string; text: string; done: () => boolean; after?: number }

export class App {
  sound = new Sound();
  tools!: Tools;
  hud!: Hud;
  panels!: Panels;
  modal: HTMLElement | null = null;
  ui: HTMLElement;
  tutorialDone = { road: false, bus: false };
  private titleMode = false;
  private coachEl: HTMLElement | null = null;
  private coachIdx = 0;
  private coachT = 0;
  private coachStart = { roads: 0, dist: 0, tx: 0, tz: 0, lines: 0 };
  private quality: Quality = 'high';
  private prefs: { v?: number; quality?: Quality; music?: boolean; muted?: boolean; coach?: boolean; diff?: number; advisor?: boolean; autoFleet?: boolean } = {};
  private lastSaveDay = 0;
  private overShown = false;
  private hintsShown = new Set<string>();
  private coachList: Coach[] = [];
  private fpsAcc = 0;
  private fpsN = 0;
  fps = 60;

  constructor(readonly game: Game, readonly view: View, opts: { title: boolean }) {
    this.ui = document.getElementById('ui')!;
    try { this.prefs = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}'); } catch { this.prefs = {}; }
    if (this.prefs.v !== 2) { delete this.prefs.diff; this.prefs.v = 2; }
    game.advisorOn = this.prefs.advisor ?? true;
    game.autoFleet = this.prefs.autoFleet ?? true;
    const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
    this.quality = this.prefs.quality ?? (mobile ? 'medium' : 'high');
    view.renderer.setQuality(this.quality);
    this.sound.musicOn = this.prefs.music ?? true;
    this.sound.muted = this.prefs.muted ?? false;
    this.panels = new Panels(this, this.ui);
    this.tools = new Tools(this);
    this.hud = new Hud(this, this.ui);
    this.bindGame();
    this.panels.sync();
    this.hud.refreshContext();
    this.titleMode = opts.title;
    this.ui.classList.toggle('is-title', opts.title);
    view.titleShift = opts.title ? 1 : 0;
    view.app_titleTarget = opts.title;
    view.fixedHour = opts.title ? 17.3 : null;
    this.focusCity();
    if (opts.title) this.showTitle(); else this.beginPlay();
  }

  // ------------------------------------------------------------ wiring

  private bindGame() {
    const g = this.game;
    g.on('toast', (t: any) => this.toast(t.msg, t.tone));
    g.on('sfx', (k: string) => this.sound.sfx(k));
    g.on('milestone', (goal: any) => { this.hud.celebrate(goal.title, `${fmt(goal.pop)} residents · +${money(goal.reward)}`); this.sound.sfx('milestone'); });
    g.on('unlock', (k: string) => { this.hud.refreshTools(); if (k === 'avenue' || k === 'metro' || k === 'policies' || k === 'highway' || k === 'junction') this.sound.sfx('unlock'); });
    g.on('gameOver', (info: any) => this.showGameOver(info));
    g.on('dayEnd', () => this.autosave());
    g.on('bldRemove', () => this.panels.sync());
    g.on('advice', () => this.hud.refreshAdvice());
    g.on('life', (it: any) => { if (!this.titleMode) this.hud.pushTick(it); });
    let lastDepart = 0;
    g.on('depart', (e: { kind: string; x: number; z: number }) => {
      const r = this.view.rig, now = performance.now();
      if (now - lastDepart < 1500 || r.dist > 30 || this.titleMode || Math.hypot(e.x - r.target.x, e.z - r.target.z) > 11) return;
      lastDepart = now;
      this.sound.sfx(e.kind === 'ferry' ? 'horn' : 'bell');
    });
  }

  toast(msg: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info') { this.hud.toast(msg, tone); }

  // ------------------------------------------------------------ citizens

  selectPerson(p: Person, focus = false) {
    this.tools.setSelection({ type: 'person', id: p.id });
    this.view.focusPerson = p;
    if (focus) {
      const w = this.view.citizens.where(p);
      this.view.rig.focus(w.x, w.z, Math.min(this.view.rig.gDist, 16));
    }
    this.sound.sfx('tick');
  }
  toggleFollow() {
    const sel = this.tools.selection;
    if (sel?.type !== 'person') return;
    const p = this.game.city.personById.get(sel.id);
    if (!p) return;
    if (this.view.follow && this.view.focusPerson === p) { this.stopFollow(); return; }
    this.view.focusPerson = p;
    this.view.follow = true;
    this.view.rig.gDist = Math.min(this.view.rig.gDist, 13);
    this.sound.sfx('click');
  }
  stopFollow() { if (!this.view.follow) return; this.view.follow = false; this.panels.sync(); }

  focusCity() {
    const g = this.game;
    let x = 0, z = 0, n = 0;
    for (const b of g.city.buildings.values()) { x += b.x - 20 + 0.5; z += b.y - 20 + 0.5; n++; }
    if (n) { x /= n; z /= n; }
    const r = this.view.rig;
    r.gTarget.set(x, 0, z);
    r.gDist = this.titleMode ? 30 : 34;
    r.gPitch = this.titleMode ? 0.58 : 0.92;
    r.snap();
  }

  // ------------------------------------------------------------ flow

  private beginPlay() {
    if (this.titleMode) this.view.beginHourBlend(17.3);
    this.titleMode = false;
    this.ui.classList.remove('is-title');
    this.view.app_titleTarget = false;
    this.game.speed = 1;
    this.hud.refreshSpeed();
    const r = this.view.rig;
    r.gDist = 34; r.gPitch = 0.92;
    if (this.prefs.coach !== false && this.game.day <= 2) this.startCoach();
  }

  setSpeed(s: number) {
    if (this.game.over) return;
    this.game.speed = s;
    this.hud.refreshSpeed();
    this.sound.sfx('tick');
  }
  togglePause() { this.setSpeed(this.game.speed === 0 ? 1 : 0); }
  toggleMute() { this.sound.setMuted(!this.sound.muted); this.savePrefs(); this.toast(this.sound.muted ? 'Sound off' : 'Sound on', 'info'); }
  private savePrefs() {
    this.prefs.advisor = this.game.advisorOn; this.prefs.autoFleet = this.game.autoFleet;
    this.prefs.quality = this.quality; this.prefs.music = this.sound.musicOn; this.prefs.muted = this.sound.muted;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch { /* private mode */ }
  }

  buyDistrict(i: number) {
    const r = this.game.unlockDistrict(i);
    if (!r.ok) { this.toast(r.msg ?? 'Cannot expand yet.', 'warn'); this.sound.sfx('error'); }
  }

  autosave() {
    const g = this.game;
    if (g.over || this.titleMode || g.day === this.lastSaveDay) return;
    this.lastSaveDay = g.day;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(g))); } catch { /* quota */ }
  }

  newCity(diff = this.prefs.diff ?? this.game.diff) {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    const seed = 1 + Math.floor(Math.random() * 9000);
    location.search = `?seed=${seed}&play=1&diff=${diff}`;
  }

  /** jump the camera and selection to the worst spot for a given kind of trouble */
  focusProblem(kind: 'traffic' | 'transit' | 'mood') {
    const g = this.game, r = this.view.rig;
    this.sound.sfx('click');
    if (kind === 'traffic') {
      let best = -1, bs = 0;
      for (let i = 0; i < g.traffic.tileCars.length; i++) { const n = g.traffic.tileCars[i].length; if (n < 2) continue; const sc = n * (1.2 - g.traffic.cong[i]); if (sc > bs) { bs = sc; best = i; } }
      if (best < 0) { this.toast('No traffic trouble right now.', 'good'); return; }
      r.focus((best % 40) - 20 + 0.5, Math.floor(best / 40) - 20 + 0.5, 20);
      this.hud.setOverlay('traffic', true);
      this.tools.setSelection({ type: 'road', tile: best });
    } else if (kind === 'transit') {
      let best: any = null, bs = 0.3;
      for (const s of g.transit.stops) { const f = s.queue.length / s.cap; if (f > bs) { bs = f; best = s; } }
      if (!best) { this.toast('Every stop has room.', 'good'); return; }
      r.focus(best.x, best.z, 18);
      this.tools.setSelection({ type: 'stop', id: best.id });
    } else {
      let best: any = null, bs = 0.62;
      for (const b of g.city.buildings.values()) if (b.kind === 'res' && b.residents.length > 2 && b.happy < bs) { bs = b.happy; best = b; }
      if (!best) { this.toast('Residents are content.', 'good'); return; }
      r.focus(best.x - 20 + 0.5, best.y - 20 + 0.5, 16);
      this.hud.setOverlay('happy', true);
      this.tools.setSelection({ type: 'building', id: best.id });
    }
  }

  // ------------------------------------------------------------ modal screens

  closeModal() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
    if (this.resumeSpeed !== null && !this.game.over) { this.game.speed = this.resumeSpeed; this.hud.refreshSpeed(); }
    this.resumeSpeed = null;
  }
  private resumeSpeed: number | null = null;

  private showModal(node: HTMLElement) {
    this.modal?.remove();
    this.modal = node;
    this.ui.append(node);
  }

  private showTitle() {
    this.game.speed = 0.35;
    const save = hasSave() ? loadSave() : null;
    let diff = this.prefs.diff ?? 0;
    const diffBtns: HTMLElement[] = [];
    const names = ['Relaxed', 'Standard', 'Rush'];
    const dsub = h('div', { class: 'meta' }, '');
    const setDiff = (d: number) => { diff = d; this.prefs.diff = d; this.savePrefs(); diffBtns.forEach((b, i) => b.classList.toggle('on', i === d)); dsub.textContent = ['More cash, slower growth and a lot of forgiveness. A helper suggests fixes.', 'A steady climb. Traffic bites around 2,000 residents.', 'Fast growth and little slack. For people who like a fight.'][d]; };
    names.forEach((n, i) => diffBtns.push(h('button', { class: 'seg', onClick: () => { setDiff(i); this.sound.init(); this.sound.sfx('tick'); } }, n)));
    const btns = h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onClick: () => { this.sound.init(); if (diff !== this.game.diff) { this.newCity(diff); return; } this.modal?.remove(); this.modal = null; this.beginPlay(); this.sound.sfx('unlock'); } }, 'Play'),
      save ? h('button', { class: 'btn', onClick: () => { location.search = '?continue=1&play=1'; } }, `Continue · day ${Math.floor(save.t / DAY) + 1}`) : null,
      h('button', { class: 'btn', onClick: () => this.newCity(diff) }, 'New city'));
    setDiff(diff);
    const el = h('div', { class: 'screen title' },
      h('div', { class: 'hero' },
        h('div', { class: 'logo' }, h('div', { html: '<svg width="54" height="54" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#ffb02e"/><path d="M13 45h14l8-25h16" fill="none" stroke="#2a1a00" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13" cy="45" r="5.5" fill="#fff"/><circle cx="51" cy="20" r="5.5" fill="#fff"/></svg>' })),
        h('h1', {}, 'Rushline'),
        h('div', { class: 'tag-line' }, 'Real people live in your city and every one of them has to get somewhere. Lay the roads, move them by bus, tram, metro, ferry and cable car, then haul the cargo that keeps the town running.'),
        btns,
        h('div', { class: 'title-modes' }, ...[...MODE_ORDER, ...CARGO_ORDER].map((m) => { const sp = h('span', {}, icon(MODES[m].icon), MODES[m].label); sp.style.setProperty('--mc', '#' + MODES[m].color.toString(16).padStart(6, '0')); return sp; })),
        h('div', { class: 'dock-l', style: { position: 'static', padding: '4px', marginTop: '6px' } }, ...diffBtns),
        dsub,
        h('div', { class: 'meta' }, 'Drag to look around · scroll to zoom · build with the toolbar')));
    this.showModal(el);
  }

  openPause() {
    if (this.modal || this.titleMode || this.game.over) return;
    this.resumeSpeed = this.game.speed;
    this.game.speed = 0;
    this.hud.refreshSpeed();
    const qBtn = (q: Quality) => h('button', { class: 'seg' + (this.quality === q ? ' on' : ''), onClick: () => { this.quality = q; this.view.renderer.setQuality(q); this.savePrefs(); this.openPauseRefresh(); } }, q[0].toUpperCase() + q.slice(1));
    const el = h('div', { class: 'screen', onClick: (e: Event) => { if (e.target === el) this.closeModal(); } },
      h('div', { class: 'card glass' },
        h('h2', {}, 'Paused'),
        h('div', { class: 'big' },
          h('div', {}, h('b', { class: 'num' }, fmt(this.game.city.stats.pop)), h('span', {}, 'Residents')),
          h('div', {}, h('b', { class: 'num' }, String(this.game.day)), h('span', {}, 'Day')),
          h('div', {}, h('b', { class: 'num' }, money(this.game.money)), h('span', {}, 'Treasury'))),
        h('div', { class: 'row' }, h('span', { class: 'k' }, 'Graphics'), h('div', { class: 'dock-l', style: { position: 'static', padding: '3px' } }, qBtn('low'), qBtn('medium'), qBtn('high'), qBtn('ultra'))),
        h('div', { class: 'row' }, h('span', { class: 'k' }, 'Sound'), h('div', { class: 'actions' },
          h('button', { class: 'btn sm', onClick: () => { this.toggleMute(); this.openPauseRefresh(); } }, this.sound.muted ? 'Off' : 'On'),
          h('button', { class: 'btn sm', onClick: () => { this.sound.musicOn = !this.sound.musicOn; this.savePrefs(); this.openPauseRefresh(); } }, this.sound.musicOn ? 'Music on' : 'Music off'))),
        h('div', { class: 'row' }, h('span', { class: 'k' }, 'Helpers'), h('div', { class: 'actions' },
          h('button', { class: 'btn sm' + (this.game.advisorOn ? ' on' : ''), title: 'Suggests one-click fixes', onClick: () => { this.game.advisorOn = !this.game.advisorOn; if (this.game.advisorOn) this.game.refreshAdvice(); else { this.game.advice = []; this.game.emit('advice', []); } this.savePrefs(); this.openPauseRefresh(); } }, this.game.advisorOn ? 'Advisor on' : 'Advisor off'),
          h('button', { class: 'btn sm' + (this.game.autoFleet ? ' on' : ''), title: 'Buys vehicles for crowded lines', onClick: () => { this.game.autoFleet = !this.game.autoFleet; this.savePrefs(); this.openPauseRefresh(); } }, this.game.autoFleet ? 'Auto-fleet on' : 'Auto-fleet off'))),
        h('div', { class: 'keys' },
          h('kbd', {}, 'Right-drag'), h('span', {}, 'Pan the map'),
          h('kbd', {}, 'Scroll'), h('span', {}, 'Zoom to the cursor'),
          h('kbd', {}, 'Q E'), h('span', {}, 'Rotate · R F tilt'),
          h('kbd', {}, '1–9 0'), h('span', {}, 'Choose a tool · 2 3 9 street, avenue, highway · 4 again or [ ] swaps the vehicle type · 8 services · 0 junctions'),
          h('kbd', {}, 'Enter'), h('span', {}, 'Finish a line'),
          h('kbd', {}, 'G T H'), h('span', {}, 'Traffic, transit, mood views'),
          h('kbd', {}, 'C B L P'), h('span', {}, 'Citizens, company books, lines, policies'),
          h('kbd', {}, 'Click a person'), h('span', {}, 'Meet them. Follow to watch their day'),
          h('kbd', {}, 'Space'), h('span', {}, 'Pause · + − speed'),
          h('kbd', {}, 'U'), h('span', {}, 'Hide the interface for screenshots')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onClick: () => this.closeModal() }, 'Resume'),
          h('button', { class: 'btn danger', onClick: () => { if (confirm('Start a new city? This one is saved only until you do.')) this.newCity(); } }, 'New city'))));
    this.showModal(el);
  }
  private openPauseRefresh() { const rs = this.resumeSpeed; this.modal?.remove(); this.modal = null; this.resumeSpeed = rs; this.game.speed = 0; this.openPause(); this.resumeSpeed = rs; }

  private showGameOver(info: { reason: string; days: number; pop: number; best: number }) {
    if (this.overShown) return;
    this.overShown = true;
    this.sound.sfx('over');
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    const g = this.game;
    this.game.speed = 0;
    setTimeout(() => {
      const el = h('div', { class: 'screen' },
        h('div', { class: 'card glass' },
          h('h2', {}, `${g.name} has seized up`),
          h('p', {}, info.reason + ' The streets are full, the stops are overflowing and people have given up on getting anywhere.'),
          h('div', { class: 'big' },
            h('div', {}, h('b', { class: 'num' }, String(info.days)), h('span', {}, 'Days survived')),
            h('div', {}, h('b', { class: 'num' }, fmt(info.best)), h('span', {}, 'Peak residents')),
            h('div', {}, h('b', { class: 'num' }, String(g.transit.lines.length)), h('span', {}, 'Lines built'))),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onClick: () => this.newCity() }, 'Try a new city'),
            h('button', { class: 'btn', onClick: () => { this.modal?.remove(); this.modal = null; } }, 'Look at the wreckage'))));
      this.showModal(el);
    }, 1400);
  }

  // ------------------------------------------------------------ coach

  private startCoach() {
    const g = this.game;
    this.coachList = [
      { id: 'look', title: 'Look around', text: 'Right-drag to pan, scroll to zoom, Q and E to rotate.', done: () => Math.abs(this.view.rig.gDist - this.coachStart.dist) > 3 || Math.hypot(this.view.rig.gTarget.x - this.coachStart.tx, this.view.rig.gTarget.z - this.coachStart.tz) > 3, after: 14 },
      { id: 'road', title: 'Grow the street grid', text: 'Press 2 for the road tool and drag out from the end of a street. New roads open land for homes and shops.', done: () => this.roadCount() > this.coachStart.roads + 5, after: 70 },
      { id: 'bus', title: 'Start a bus line', text: 'Press 4, click a few roads to place stops, then Finish. Or let the advisor (top right) build one for you.', done: () => g.transit.lines.length > this.coachStart.lines, after: 90 },
      { id: 'meet', title: 'Meet your citizens', text: 'Click any little person or car to see who they are, what they need and what they think. Press C for the town directory.', done: () => this.tools.selection?.type === 'person', after: 30 },
      { id: 'advisor', title: 'Lean on the advisor', text: 'The card at the top right offers one-click fixes: add a vehicle, widen a street, build a line. New modes unlock as you grow.', done: () => false, after: 20 },
      { id: 'watch', title: 'Watch the stability bar', text: 'It drops when roads jam or stops overflow. At zero the city fails. Add capacity before it turns red.', done: () => false, after: 16 },
    ];
    this.coachIdx = 0; this.coachT = 0;
    this.snapCoach();
    this.renderCoach();
  }
  private roadCount() { const w = this.game.world; let n = 0; for (let i = 0; i < w.road.length; i++) if (w.road[i]) n++; return n; }
  private snapCoach() {
    const r = this.view.rig;
    this.coachStart = { roads: this.roadCount(), dist: r.gDist, tx: r.gTarget.x, tz: r.gTarget.z, lines: this.game.transit.lines.length };
  }
  private renderCoach() {
    this.coachEl?.remove();
    this.coachEl = null;
    const c = this.coachList[this.coachIdx];
    this.hud.pulseTool(c?.id === 'road' ? 'road' : c?.id === 'bus' ? 'transit' : null);
    if (!c) return;
    const dots = h('div', { class: 'dots' }, ...this.coachList.map((_, i) => h('i', { class: i <= this.coachIdx ? 'on' : '' })));
    this.coachEl = h('div', { class: 'coach glass' }, dots, h('div', {}, h('b', {}, c.title), h('span', {}, c.text)),
      h('button', { class: 'btn ghost sm', onClick: () => { this.coachIdx = 99; this.renderCoach(); this.prefs.coach = false; this.savePrefs(); } }, 'Skip'));
    this.ui.append(this.coachEl);
  }
  private updateCoach(dt: number) {
    const c = this.coachList[this.coachIdx];
    if (!c || this.modal) return;
    this.coachT += dt;
    if (c.done() || (c.after && this.coachT > c.after)) {
      this.coachIdx++;
      this.coachT = 0;
      this.snapCoach();
      this.sound.sfx('tick');
      this.renderCoach();
    }
  }

  /** one-off hints that fire the first time something notable happens */
  private hint(id: string, msg: string, tone: 'info' | 'warn' | 'bad' | 'good' = 'info') {
    if (this.hintsShown.has(id)) return;
    this.hintsShown.add(id);
    this.toast(msg, tone);
  }

  // ------------------------------------------------------------ frame

  frame(dt: number) {
    const g = this.game, v = this.view;
    this.tools.update(dt);
    const sel = this.tools.selection;
    v.highlightLine = sel?.type === 'line' ? sel.id : -1;
    if (sel?.type === 'person') { if (!v.focusPerson || v.focusPerson.id !== sel.id) v.focusPerson = g.city.personById.get(sel.id) ?? null; }
    else { v.focusPerson = null; v.follow = false; }
    this.hud.update(dt);
    this.panels.update(dt);
    this.updateCoach(dt);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 1) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    if (this.titleMode) {
      v.rig.gYaw += dt * 0.045;
    } else {
      if (g.transit.overcrowded > 0 && g.day >= 1) this.hint('crowd', 'A stop is overcrowded. Select it and add vehicles to its line, or expand the stop.', 'warn');
      if (g.traffic.gridlock > 4) this.hint('grid', 'Traffic is backing up. Try the Traffic view (G) to see where, then widen those roads or add a line.', 'warn');
    }
    this.sound.update(g.city.stats.pop, v.tod.night, v.rainAmt, g.traffic.trafficIndex, g.speed, dt);
  }
}
void icon; void hourOf; void GOALS;
