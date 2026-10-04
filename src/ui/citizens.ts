// Citizen panel, the town directory and the live feed.
import { h, icon, clear, money } from './dom.ts';
import { drawAvatar } from './avatar.ts';
import { NEED_KEYS, NEED_LABEL, TRAITS, moodWord, moodColorHex, fullName, careerTier } from '../sim/people.ts';
import { dayOf, hourOf } from '../sim/types.ts';
import type { Person, Building } from '../sim/types.ts';
import type { FeedItem } from '../sim/city.ts';
import type { App } from './app.ts';
import type { Panels } from './panels.ts';

type Built = { el: HTMLElement; update: () => void };
const needColor = (v: number) => (v > 0.55 ? 'var(--green)' : v > 0.28 ? 'var(--amber)' : 'var(--red)');
const NEED_ICON: Record<string, string> = { energy: 'energy', hunger: 'hunger', fun: 'fun', social: 'social', comfort: 'comfort' };

export function timeAgo(app: App, t: number): string {
  const g = app.game;
  const dd = dayOf(g.t) - dayOf(t);
  if (dd <= 0) { const hrs = (g.t - t) / (180 / 24); return hrs < 1 ? 'just now' : `${Math.floor(hrs)}h ago`; }
  return dd === 1 ? 'yesterday' : `${dd} days ago`;
}

function stageWord(p: Person) { return p.age < 1 ? 'Newborn' : p.stage === 'child' ? (p.age < 5 ? 'Toddler' : 'Child') : p.stage === 'teen' ? 'Teen' : p.stage === 'senior' ? 'Retired' : ''; }

export function personLine(p: Person): string {
  const sw = stageWord(p);
  if (p.student && p.work) return `${p.age} · Pupil at ${p.work.name}`;
  if (p.work && p.title) return `${p.age} · ${p.title} at ${p.work.name}`;
  if (p.stage === 'adult') return `${p.age} · Looking for work`;
  return `${p.age} · ${sw || 'Resident'}`;
}

export function citizenPanel(P: Panels, id: number): Built {
  const app = P.app, g = app.game, city = g.city;
  const p0 = city.personById.get(id)!;
  const cv = h('canvas', { class: 'avatar' }) as HTMLCanvasElement;
  const name = h('h3', {}, fullName(p0));
  const sub = h('div', { class: 'sub' }, '');
  const moodChip = h('span', { class: 'moodchip' }, '');
  const now = h('div', { class: 'now' }, '');
  const thought = h('div', { class: 'thought' }, '');
  const needs = NEED_KEYS.map((k) => {
    const m = P.meter(0.5);
    const val = h('span', { class: 'v num' }, '');
    const row = h('div', { class: 'need' }, h('span', { class: 'ic' }, icon(NEED_ICON[k])), h('span', { class: 'k' }, NEED_LABEL[k]), m.el, val);
    return { k, m, val, row };
  });
  const traits = h('div', { class: 'chips' });
  const wants = h('div', { class: 'chips' });
  const family = h('div', { class: 'chips' });
  const [rHome, vHome] = P.row('Home', '');
  const [rWork, vWork] = P.row('Work', '');
  const [rPay, vPay] = P.row('Pay', '');
  const [rCash, vCash] = P.row('Cash', '');
  const [rFr, vFr] = P.row('Friends', '');
  const story = h('div', { class: 'story' });
  const followBtn = h('button', { class: 'btn sm primary', onClick: () => { app.toggleFollow(); upd(); } }, 'Follow');
  let lastLook = -1, lastMoodBand = -1;
  const upd = () => {
    const p = city.personById.get(id);
    if (!p) { app.tools.setSelection(null); return; }
    const band = p.mood > 0.6 ? 2 : p.mood > 0.42 ? 1 : 0;
    if (p.look !== lastLook || band !== lastMoodBand) { lastLook = p.look; lastMoodBand = band; drawAvatar(cv, p); }
    name.textContent = fullName(p);
    sub.textContent = personLine(p);
    moodChip.textContent = moodWord(p.mood);
    moodChip.style.setProperty('--c', moodColorHex(p.mood));
    now.textContent = city.activityOf(p, hourOf(g.t));
    thought.textContent = `“${city.thoughtOf(p)}”`;
    for (const n of needs) { const v = p.needs[n.k]; n.m.set(v, needColor(v)); n.val.textContent = `${Math.round(v * 100)}`; }
    clear(traits);
    for (const t of p.traits) traits.append(h('span', { class: 'chip', title: TRAITS[t].desc }, TRAITS[t].label));
    clear(wants);
    const w = city.wantsOf(p);
    if (!w.length) wants.append(h('span', { class: 'empty', style: { padding: '0' } }, 'Nothing pressing.'));
    for (const x of w) wants.append(h('span', { class: 'chip want' }, x));
    clear(family);
    for (const m of p.hh.members) {
      if (m === p) continue;
      family.append(h('button', { class: 'chip', onClick: () => app.selectPerson(m) }, h('i', { style: { background: moodColorHex(m.mood) } }), `${m.first}, ${m.age}`));
    }
    if (!family.childElementCount) family.append(h('span', { class: 'empty', style: { padding: '0' } }, 'Lives alone.'));
    vHome.textContent = city.addressOf(p.home);
    vHome.style.cursor = 'pointer';
    vHome.onclick = () => app.view.rig.focus(p.home.x - 20 + 0.5, p.home.y - 20 + 0.5, 14);
    vWork.textContent = p.work ? p.work.name : p.stage === 'adult' ? 'Unemployed' : '–';
    vWork.style.cursor = p.work ? 'pointer' : '';
    vWork.onclick = () => { if (p.work) app.view.rig.focus(p.work.x - 20 + 0.5, p.work.y - 20 + 0.5, 14); };
    vPay.textContent = p.wage ? `${money(p.wage)} a day · tier ${careerTier(p.xp) + 1}` : '–';
    vCash.textContent = money(p.wallet);
    vCash.style.color = p.wallet < 0 ? 'var(--red)' : '';
    const fr = p.friends.map((f) => city.personById.get(f)).filter((x): x is Person => !!x);
    vFr.textContent = fr.length ? fr.slice(0, 2).map((f) => f.first).join(', ') + (fr.length > 2 ? ` +${fr.length - 2}` : '') : 'none yet';
    clear(story);
    for (const e of [...p.log].reverse().slice(0, 5)) story.append(h('div', { class: 'ev' }, h('span', {}, e.text), h('small', {}, timeAgo(app, e.t))));
    if (!p.log.length) story.append(h('div', { class: 'empty', style: { padding: '0' } }, 'Their story starts here.'));
    followBtn.textContent = app.view.follow && app.view.focusPerson === p ? 'Following' : 'Follow';
    followBtn.classList.toggle('on', app.view.follow && app.view.focusPerson === p);
  };
  const el = h('div', { class: 'side glass citizen' },
    h('div', { class: 'head' }, h('div', { class: 'who' }, cv, h('div', {}, name, sub, moodChip)), h('button', { class: 'x', title: 'Close', onClick: () => P.close() }, icon('close'))),
    h('div', { class: 'actions' }, followBtn,
      h('button', { class: 'btn sm', onClick: () => app.view.rig.focus(p0.home.x - 20 + 0.5, p0.home.y - 20 + 0.5, 14) }, 'Home'),
      h('button', { class: 'btn sm', onClick: () => { const p = city.personById.get(id); if (p?.work) app.view.rig.focus(p.work.x - 20 + 0.5, p.work.y - 20 + 0.5, 14); } }, 'Work')),
    h('div', { class: 'live' }, h('div', { class: 'k' }, 'Right now'), now, thought),
    h('div', { class: 'needs' }, ...needs.map((n) => n.row)),
    h('div', { class: 'sec' }, h('div', { class: 'k' }, 'Traits'), traits),
    h('div', { class: 'sec' }, h('div', { class: 'k' }, 'Wants'), wants),
    h('div', { class: 'kv' }, rHome, rWork, rPay, rCash, rFr),
    h('div', { class: 'sec' }, h('div', { class: 'k' }, 'Household'), family),
    h('div', { class: 'sec' }, h('div', { class: 'k' }, 'Life so far'), story));
  upd();
  return { el, update: upd };
}

// ------------------------------------------------------------------ directory

export function directoryPanel(P: Panels): Built {
  const app = P.app, g = app.game, city = g.city;
  let tab: 'news' | 'people' | 'wants' = 'news';
  let sort: 'sad' | 'happy' | 'jobless' | 'new' = 'sad';
  const body = h('div', { class: 'dir' });
  const summary = h('div', { class: 'dsum' });
  const tabs = h('div', { class: 'tabs' });
  const mini = new Map<number, HTMLCanvasElement>();
  let key = '';
  const feedRow = (f: FeedItem) => h('button', { class: 'feedrow ' + f.tone, onClick: () => { const p = city.personById.get(f.pid); if (p) app.selectPerson(p, true); } },
    h('i'), h('span', {}, f.text), h('small', {}, timeAgo(app, f.t)));
  const render = () => {
    const s = city.stats;
    clear(summary);
    const mood = P.meter(s.mood, moodColorHex(s.mood));
    summary.append(
      h('div', { class: 'row' }, h('span', { class: 'k' }, 'Average mood'), h('span', { class: 'v' }, moodWord(s.mood))), mood.el,
      h('div', { class: 'tri' },
        h('div', {}, h('b', { class: 'num' }, String(s.adults)), h('span', {}, 'Adults')),
        h('div', {}, h('b', { class: 'num' }, String(s.kids)), h('span', {}, 'Young')),
        h('div', {}, h('b', { class: 'num' }, String(s.seniors)), h('span', {}, 'Seniors')),
        h('div', {}, h('b', { class: 'num' }, `${s.adults ? Math.round((s.employed / s.adults) * 100) : 100}%`), h('span', {}, 'Employed'))));
    clear(tabs);
    for (const [id, label] of [['news', 'Town news'], ['people', 'People'], ['wants', 'Requests']] as const) {
      tabs.append(h('button', { class: 'tab' + (tab === id ? ' on' : ''), onClick: () => { tab = id; key = ''; render(); upd(); } }, label));
    }
  };
  const upd = () => {
    const s = city.stats;
    if (tab === 'news') {
      const k = 'n' + (city.feed.length ? city.feed[city.feed.length - 1].id : 0);
      if (k === key) return;
      key = k; clear(body);
      const items = [...city.feed].reverse().slice(0, 30);
      if (!items.length) body.append(h('div', { class: 'empty' }, 'Quiet so far. Families will arrive as the city grows.'));
      for (const f of items) body.append(feedRow(f));
    } else if (tab === 'people') {
      const k = 'p' + sort + Math.floor(g.t / 6) + s.pop;
      if (k === key) return;
      key = k; clear(body);
      const sorts = h('div', { class: 'tabs small' });
      for (const [id, label] of [['sad', 'Unhappiest'], ['happy', 'Happiest'], ['jobless', 'Jobless'], ['new', 'Newest']] as const) sorts.append(h('button', { class: 'tab' + (sort === id ? ' on' : ''), onClick: () => { sort = id; key = ''; upd(); } }, label));
      body.append(sorts);
      let list = city.persons.filter((p) => !p.dead);
      if (sort === 'jobless') list = list.filter((p) => p.stage === 'adult' && !p.work);
      list = list.sort((a, b) => (sort === 'sad' ? a.mood - b.mood : sort === 'happy' ? b.mood - a.mood : sort === 'new' ? b.born - a.born : a.id - b.id)).slice(0, 12);
      if (!list.length) body.append(h('div', { class: 'empty' }, sort === 'jobless' ? 'Everyone who wants work has it.' : 'Nobody here yet.'));
      for (const p of list) {
        const cv = h('canvas', { class: 'mini' }) as HTMLCanvasElement;
        drawAvatar(cv, p);
        cv.style.width = '34px'; cv.style.height = '34px';
        body.append(h('button', { class: 'prow', onClick: () => app.selectPerson(p, true) }, cv,
          h('div', {}, h('b', {}, fullName(p)), h('small', {}, city.activityOf(p, hourOf(g.t)))),
          h('span', { class: 'dot', style: { background: moodColorHex(p.mood) }, title: moodWord(p.mood) })));
      }
    } else {
      const k = 'w' + Math.floor(g.t / 8);
      if (k === key) return;
      key = k; clear(body);
      const wants = Object.entries(city.wantFrac).sort((a, b) => b[1] - a[1]).filter((e) => e[1] > 0.02).slice(0, 7);
      body.append(h('div', { class: 'empty', style: { paddingTop: '0' } }, 'What residents are asking for right now, from a sample of the city.'));
      if (!wants.length) body.append(h('div', { class: 'empty' }, 'Everyone is content.'));
      for (const [text, f] of wants) {
        const m = P.meter(Math.min(1, f * 1.6), f > 0.4 ? 'var(--red)' : f > 0.18 ? 'var(--amber)' : 'var(--green)');
        body.append(h('div', { class: 'want-row' }, h('div', { class: 'row' }, h('span', {}, text), h('span', { class: 'v num' }, `${Math.round(f * 100)}%`)), m.el, h('small', {}, wantHint(text))));
      }
    }
    void mini;
  };
  const el = P.shell('Citizens', `${city.stats.pop.toLocaleString()} residents in ${city.households.size.toLocaleString()} households`, summary, tabs, body);
  render(); upd();
  return { el, update: () => { render(); upd(); (el.querySelector('.sub') as HTMLElement).textContent = `${city.stats.pop.toLocaleString()} residents in ${city.households.size.toLocaleString()} households`; } };
}

function wantHint(text: string): string {
  switch (text) {
    case 'A park nearby': return 'Place parks near homes. Fun and land value both rise.';
    case 'Something fun to do': return 'Shops, cafes and cinemas grow with demand. Keep them reachable.';
    case 'Somewhere to eat nearby': return 'Commercial zones near homes will bring cafes and diners.';
    case 'A school nearby': return 'Build a school (unlocks at 260 residents).';
    case 'A clinic nearby': return 'Build a clinic (unlocks at 520 residents).';
    case 'A shorter commute': return 'A faster line or a closer job would help.';
    case 'Transit near home': return 'Run a line past residential streets.';
    case 'A job': return 'More industry and offices will open vacancies.';
    default: return '';
  }
}

export function buildingResidents(P: Panels, b: Building): HTMLElement {
  const app = P.app;
  const el = h('div', { class: 'chips' });
  const people = b.kind === 'res' ? b.residents : b.special === 'school' ? b.students : b.workers;
  for (const p of people.slice(0, 10)) el.append(h('button', { class: 'chip', onClick: () => app.selectPerson(p, true) }, h('i', { style: { background: moodColorHex(p.mood) } }), `${p.first} ${p.last[0]}.`));
  if (people.length > 10) el.append(h('span', { class: 'chip' }, `+${people.length - 10}`));
  if (!people.length) el.append(h('span', { class: 'empty', style: { padding: '0' } }, b.kind === 'res' ? 'Empty.' : 'Nobody works here yet.'));
  return el;
}
