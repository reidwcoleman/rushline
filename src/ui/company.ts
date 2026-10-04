// The company window: books, loans, line profits, fleet condition and research.
import { h, icon, clear, money } from './dom.ts';
import { MODES, MODE_ORDER, CARGO_ORDER, type Mode } from '../sim/modes.ts';
import { researchCost, RESEARCH_DAYS, FARE_STEPS } from '../sim/game.ts';
import { DAY } from '../sim/types.ts';
import { ACHIEVEMENTS } from '../sim/achievements.ts';
import type { Line } from '../sim/types.ts';
import type { Panels } from './panels.ts';

type Built = { el: HTMLElement; update: () => void };
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const NAMES: Record<string, string> = {
  fares: 'Fares', taxes: 'Taxes', fees: 'Fees and sales', goals: 'Milestones', refund: 'Refunds', other: 'Other', cargo: 'Freight',
  upkeep: 'Upkeep', build: 'Construction', vehicles: 'Vehicles', service: 'Servicing', interest: 'Interest', research: 'Research', imports: 'Imports',
};

export function lineProfit(l: Line): number {
  const d = l.hist.slice(-4);
  if (!d.length) return l.dayRev - l.dayCost;
  return d.reduce((a, x) => a + x.rev - x.cost, 0) / d.length;
}

export function rating(netWorth: number, profit: number): { letter: string; word: string; color: string } {
  const score = netWorth / 1000 + profit / 40;
  if (score > 160) return { letter: 'A+', word: 'Tycoon', color: 'var(--green)' };
  if (score > 70) return { letter: 'A', word: 'Thriving', color: 'var(--green)' };
  if (score > 28) return { letter: 'B', word: 'Solid', color: 'var(--green)' };
  if (score > 6) return { letter: 'C', word: 'Getting by', color: 'var(--amber)' };
  if (score > -4) return { letter: 'D', word: 'Shaky', color: 'var(--amber)' };
  return { letter: 'E', word: 'In trouble', color: 'var(--red)' };
}

export function companyPanel(P: Panels): Built {
  const app = P.app, g = app.game;
  let tab: 'books' | 'lines' | 'fleet' | 'research' | 'jobs' = 'books';
  const body = h('div', { class: 'co-body' });
  const tabs = h('div', { class: 'tabs' });
  let key = '';

  const drawTabs = () => {
    clear(tabs);
    for (const [id, label] of [['books', 'Books'], ['lines', 'Lines'], ['fleet', 'Fleet'], ['research', 'Research'], ['jobs', 'Jobs']] as const) {
      tabs.append(h('button', { class: 'tab' + (tab === id ? ' on' : ''), onClick: () => { tab = id; key = ''; drawTabs(); upd(); } }, label));
    }
  };

  const bars = (vals: { inc: number; exp: number }[]) => {
    const max = Math.max(50, ...vals.map((v) => Math.max(v.inc, v.exp)));
    const el = h('div', { class: 'cashbars' });
    for (const v of vals) {
      const net = v.inc - v.exp;
      el.append(h('div', { class: 'cb', title: `${money(v.inc)} in, ${money(v.exp)} out` },
        h('i', { class: 'in', style: { height: Math.max(2, (v.inc / max) * 100) + '%' } }),
        h('i', { class: 'out', style: { height: Math.max(2, (v.exp / max) * 100) + '%' } }),
        h('b', { class: net >= 0 ? 'up' : 'down' })));
    }
    return el;
  };

  const books = () => {
    const hist = g.bookHist.slice(-14);
    const days = hist.map((b) => ({ inc: sum(b.inc), exp: sum(b.exp) }));
    // running profit leaves out one-off spending on building and buying vehicles
    const op = (b: { inc: Record<string, number>; exp: Record<string, number> }) => sum(b.inc) - ((b.exp.upkeep ?? 0) + (b.exp.service ?? 0) + (b.exp.interest ?? 0) + (b.exp.imports ?? 0) + (b.exp.research ?? 0));
    const last = hist[hist.length - 1];
    const avgNet = hist.length ? hist.slice(-4).reduce((a, b) => a + op(b), 0) / Math.min(4, hist.length) : 0;
    const rt = rating(g.netWorth(), avgNet);
    const top = h('div', { class: 'co-top' },
      h('div', {}, h('div', { class: 'k' }, 'Company value'), h('div', { class: 'big-n num' }, money(g.netWorth()))),
      h('div', { class: 'rate', style: { '--c': rt.color } as any }, h('b', {}, rt.letter), h('span', {}, rt.word)));
    const kv = h('div', { class: 'kv' },
      kvRow('Cash', money(g.money), g.money < 0 ? 'var(--red)' : ''),
      kvRow('Loan', g.loan ? money(g.loan) : 'none'),
      kvRow('Network assets', money(g.assets())),
      kvRow('Operating profit', `${avgNet >= 0 ? '+' : '-'}${money(Math.abs(avgNet))} a day`, avgNet >= 0 ? 'var(--green)' : 'var(--red)'));
    const chart = h('div', { class: 'sec' }, h('div', { class: 'k' }, 'Last two weeks'), days.length ? bars(days) : h('div', { class: 'empty', style: { padding: '0' } }, 'The first full day is still being counted.'));
    const brk = h('div', { class: 'sec' }, h('div', { class: 'k' }, last ? `Yesterday` : 'Today so far'));
    const ledger = last ?? g.book;
    const rows = h('div', { class: 'ledger' });
    for (const [k, v] of Object.entries(ledger.inc).sort((a, b) => b[1] - a[1])) if (v >= 1) rows.append(h('div', { class: 'lr' }, h('span', {}, NAMES[k] ?? k), h('b', { class: 'num up' }, '+' + money(v))));
    for (const [k, v] of Object.entries(ledger.exp).sort((a, b) => b[1] - a[1])) if (v >= 1) rows.append(h('div', { class: 'lr' }, h('span', {}, NAMES[k] ?? k), h('b', { class: 'num down' }, '-' + money(v))));
    if (!rows.childElementCount) rows.append(h('div', { class: 'empty', style: { padding: '0' } }, 'Nothing yet.'));
    brk.append(rows);
    // loans
    const lim = g.loanLimit();
    const loan = h('div', { class: 'sec' },
      h('div', { class: 'row' }, h('span', { class: 'k' }, 'Bank'), h('span', { class: 'v num' }, `${money(g.loan)} of ${money(lim)}`)),
      P.meter(lim ? g.loan / lim : 0, g.loan / Math.max(1, lim) > 0.7 ? 'var(--amber)' : 'var(--blue)').el,
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm', onClick: () => { const r = g.takeLoan(5000); if (!r.ok) app.toast(r.msg ?? '', 'warn'); key = ''; upd(); } }, 'Borrow $5,000'),
        h('button', { class: 'btn sm', onClick: () => { const r = g.repayLoan(5000); if (!r.ok) app.toast(r.msg ?? '', 'warn'); key = ''; upd(); } }, 'Repay $5,000'),
        g.loan > 0 ? h('button', { class: 'btn sm ghost', onClick: () => { g.repayLoan(g.loan); key = ''; upd(); } }, 'Repay all') : null),
      h('div', { class: 'empty', style: { padding: '0', fontSize: '12px' } }, 'Interest is 0.7% of the loan every day. The limit grows with your city.'));
    // upkeep policy
    const lv = ['Skimp', 'Standard', 'Thorough'];
    const maint = h('div', { class: 'sec' },
      h('div', { class: 'k' }, 'Maintenance'),
      h('div', { class: 'tabs' }, ...lv.map((n, i) => h('button', { class: 'tab' + (g.maint === i ? ' on' : ''), onClick: () => { g.setMaintenance(i); key = ''; upd(); } }, n))),
      h('div', { class: 'empty', style: { padding: '0', fontSize: '12px' } }, ['Cheaper upkeep, but vehicles wear fast and break down more.', 'Vehicles are serviced at the end of the line when they get worn.', 'Serviced early and often. Costs more, rarely breaks down.'][g.maint]),
      h('button', { class: 'btn sm' + (g.autoRenew ? ' on' : ''), onClick: () => { g.autoRenew = !g.autoRenew; key = ''; upd(); } }, g.autoRenew ? 'Auto-renew old vehicles: on' : 'Auto-renew old vehicles: off'));
    body.append(top, kv, chart, brk, loan, maint);
  };

  const kvRow = (k: string, v: string, color = '') => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v num', style: color ? { color } : {} }, v));

  const linesTab = () => {
    const ls = [...g.transit.lines].sort((a, b) => lineProfit(b) - lineProfit(a));
    if (!ls.length) { body.append(h('div', { class: 'empty' }, 'No lines yet. Build one and its profit shows here.')); return; }
    body.append(h('div', { class: 'empty', style: { paddingTop: '0' } }, 'Average profit per day over the last few days, after running costs.'));
    for (const l of ls) {
      const p = lineProfit(l);
      const rev = l.hist.length ? l.hist.slice(-4).reduce((a, x) => a + x.rev, 0) / Math.min(4, l.hist.length) : l.dayRev;
      body.append(h('button', { class: 'lineitem profit', onClick: () => { P.open = null; app.tools.setSelection({ type: 'line', id: l.id }); } },
        h('div', { class: 'sw', style: { background: hex(l.color) } }),
        h('div', {}, h('div', { class: 'n' }, l.name), h('div', { class: 'm' }, `${l.vehicles.length} ${l.vehicles.length === 1 ? MODES[l.kind].vehicle : MODES[l.kind].vehicles} · ${money(rev)} takings`)),
        h('div', { class: 'r num ' + (p >= 0 ? 'up' : 'down') }, `${p >= 0 ? '+' : '-'}${money(Math.abs(p))}`, h('div', { class: 'm' }, 'a day'))));
    }
  };

  const fleetTab = () => {
    const all: { c: import('../sim/types.ts').Carrier; l: Line; age: number }[] = [];
    for (const l of g.transit.lines) for (const c of l.vehicles) all.push({ c, l, age: g.transit.ageDays(c) });
    if (!all.length) { body.append(h('div', { class: 'empty' }, 'No vehicles yet.')); return; }
    const worn = all.filter((x) => x.c.cond < 0.5 || x.age > MODES[x.l.kind].life);
    const avg = all.reduce((a, x) => a + x.c.cond, 0) / all.length;
    body.append(
      h('div', { class: 'tri' },
        h('div', {}, h('b', { class: 'num' }, String(all.length)), h('span', {}, 'Vehicles')),
        h('div', {}, h('b', { class: 'num' }, `${Math.round(avg * 100)}%`), h('span', {}, 'Avg condition')),
        h('div', {}, h('b', { class: 'num' }, String(worn.length)), h('span', {}, 'Worn out')),
        h('div', {}, h('b', { class: 'num' }, String(g.breakdowns)), h('span', {}, 'Breakdowns'))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm primary', disabled: !worn.length, onClick: () => { let n = 0; for (const l of g.transit.lines) { const r = g.renewLine(l, true); if (r.ok) n++; } if (!n) app.toast('Nothing needs renewing.', 'info'); key = ''; upd(); } }, `Renew all worn (${worn.length})`)),
      h('div', { class: 'k' }, 'Worst first'));
    for (const x of all.sort((a, b) => a.c.cond - b.c.cond).slice(0, 9)) {
      const m = P.meter(x.c.cond, x.c.cond > 0.6 ? 'var(--green)' : x.c.cond > 0.35 ? 'var(--amber)' : 'var(--red)');
      body.append(h('div', { class: 'veh' },
        h('i', { style: { background: hex(x.l.color) } }),
        h('div', {}, h('b', {}, `${MODES[x.l.kind].models[x.c.lvl]}`), h('small', {}, `${x.l.name} · ${Math.round(x.age)} days old${x.c.broken > 0 ? ' · broken down' : ''}`)),
        m.el,
        h('button', { class: 'btn sm ghost', title: `Renew for ${money(g.renewCost(x.c))}`, onClick: () => { const r = g.renewVehicle(x.c); if (!r.ok) app.toast(r.msg ?? '', 'warn'); key = ''; upd(); } }, money(g.renewCost(x.c)))));
    }
  };

  const researchTab = () => {
    const pr = g.project;
    if (g.bestPop < 300) body.append(h('div', { class: 'empty' }, 'The lab opens at 300 residents.'));
    if (pr) {
      const f = Math.min(1, (g.t - pr.start) / Math.max(1, pr.done - pr.start));
      body.append(h('div', { class: 'proj' }, h('div', { class: 'row' }, h('b', {}, `Researching ${MODES[pr.mode].models[pr.lvl + 1]}`), h('span', { class: 'v num' }, `${Math.max(0, Math.ceil((pr.done - g.t) / DAY * 10) / 10)} days`)), P.meter(f, 'var(--amber)').el));
    }
    for (const m of [...MODE_ORDER, ...CARGO_ORDER] as Mode[]) {
      const lvl = g.research[m];
      const def = MODES[m];
      const card = h('div', { class: 'rcard' });
      const pips = h('div', { class: 'pips' }, ...[0, 1, 2, 3].map((i) => h('i', { class: i <= lvl ? 'on' : '' })));
      card.append(h('div', { class: 'row' }, h('span', { class: 'rn' }, icon(def.icon), def.label), pips), h('div', { class: 'cur' }, def.models[lvl]));
      if (lvl < 3) {
        const cost = researchCost(m, lvl);
        card.append(h('div', { class: 'row' }, h('small', {}, `Next: ${def.models[lvl + 1]} · ${RESEARCH_DAYS[lvl]} days`),
          h('button', { class: 'btn sm primary', disabled: !!pr || g.bestPop < 300, onClick: () => { const r = g.startResearch(m); if (!r.ok) app.toast(r.msg ?? '', 'warn'); key = ''; upd(); } }, money(cost))));
        card.append(h('small', { class: 'gain' }, `+12% seats, +7% speed, 14% less wear on new ${def.vehicles}`));
      } else card.append(h('small', { class: 'gain' }, 'Fully researched'));
      body.append(card);
    }
  };

  const jobsTab = () => {
    const act = g.contracts.filter((c) => c.state === 'active');
    const off = g.contracts.filter((c) => c.state === 'offer');
    const past = g.contracts.filter((c) => c.state === 'done' || c.state === 'failed');
    body.append(h('div', { class: 'tri' },
      h('div', {}, h('b', { class: 'num' }, String(act.length)), h('span', {}, 'Active')),
      h('div', {}, h('b', { class: 'num' }, String(off.length)), h('span', {}, 'Offers')),
      h('div', {}, h('b', { class: 'num' }, String(g.contractsDone)), h('span', {}, 'Completed')),
      h('div', {}, h('b', { class: 'num' }, `${3 - act.length}`), h('span', {}, 'Free slots'))));
    const days = (c: typeof act[number]) => Math.max(0, (c.until - g.t) / DAY);
    if (act.length) body.append(h('div', { class: 'k' }, 'In progress'));
    for (const c of act) {
      body.append(h('div', { class: 'job active' }, h('div', { class: 'row' }, h('b', {}, c.title), h('span', { class: 'v num up' }, '+' + money(c.reward))),
        P.meter(c.progress / c.target, 'var(--amber)').el,
        h('div', { class: 'row' }, h('small', {}, `${Math.floor(c.progress)} of ${c.target}`), h('small', {}, `${days(c).toFixed(1)} days left`))));
    }
    if (off.length) body.append(h('div', { class: 'k' }, 'Offers'));
    for (const c of off) {
      body.append(h('div', { class: 'job' }, h('div', { class: 'row' }, h('b', {}, c.title), h('span', { class: 'v num up' }, '+' + money(c.reward))),
        h('small', {}, c.desc),
        h('div', { class: 'row' }, h('small', {}, `${days(c).toFixed(1)} days to decide`), h('div', { class: 'actions' },
          h('button', { class: 'btn sm ghost', onClick: () => { g.declineContract(c.id); key = ''; upd(); } }, 'Pass'),
          h('button', { class: 'btn sm primary', onClick: () => { const r = g.acceptContract(c.id); if (!r.ok) app.toast(r.msg ?? '', 'warn'); key = ''; upd(); } }, 'Accept')))));
    }
    if (!act.length && !off.length) body.append(h('div', { class: 'empty' }, g.bestPop < 250 ? 'Clients start calling at 250 residents.' : 'No offers right now. New ones arrive every day.'));
    body.append(h('div', { class: 'k' }, `Achievements · ${g.achieved.size} of ${ACHIEVEMENTS.length}`));
    const grid = h('div', { class: 'ach' });
    for (const a of ACHIEVEMENTS) grid.append(h('div', { class: 'a' + (g.achieved.has(a.id) ? ' got' : ''), title: a.desc }, h('i'), h('span', {}, a.title)));
    body.append(grid);
    if (past.length) body.append(h('div', { class: 'k' }, 'Recent'), ...past.slice(-4).reverse().map((c) => h('div', { class: 'lr' }, h('span', {}, c.title), h('b', { class: 'num ' + (c.state === 'done' ? 'up' : 'down') }, c.state === 'done' ? '+' + money(c.reward) : 'missed'))));
  };

  const upd = () => {
    const k = `${tab}|${g.achieved.size}|${g.contracts.map((c) => c.id + c.state + Math.floor(c.progress / 4)).join(',')}|${g.bookHist.length}|${Math.floor(g.t / 4)}|${g.loan}|${g.maint}|${g.autoRenew}|${g.project ? g.project.mode : ''}|${g.research.bus}${g.research.tram}${g.research.metro}${g.research.ferry}${g.research.gondola}|${Math.floor(g.money / 400)}|${g.transit.lines.length}`;
    if (k === key) return;
    key = k;
    clear(body);
    if (tab === 'books') books(); else if (tab === 'lines') linesTab(); else if (tab === 'fleet') fleetTab(); else if (tab === 'research') researchTab(); else jobsTab();
  };
  drawTabs();
  const el = P.shell('Company', 'Books, fleet and research', tabs, body);
  el.classList.add('wide');
  upd();
  return { el, update: upd };
}

export function fareControl(P: Panels, line: Line, onChange: () => void): HTMLElement {
  const g = P.app.game;
  const labels = ['Free', 'Cheap', 'Standard', 'Dear', 'Premium'];
  const wrap = h('div', { class: 'fares' });
  FARE_STEPS.forEach((mul, i) => {
    wrap.append(h('button', { class: 'tab' + (Math.abs(line.fareMul - mul) < 0.01 ? ' on' : ''), title: `${(MODES[line.kind].fare * mul).toFixed(2)} per ride`, onClick: () => { g.setFare(line, mul); onChange(); } }, labels[i]));
  });
  return wrap;
}
