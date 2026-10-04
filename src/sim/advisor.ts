// The city advisor: reads the state of the city and offers one concrete, one-click fix at a time.
// Also builds good-enough lines automatically (used by the advisor and the "build one for me" buttons).
import type { Game, Cmd } from './game.ts';
import { COST } from './game.ts';
import { MODES, MODE_ORDER, type Mode } from './modes.ts';
import { N, tileIdx, tileX, tileY, wx, wz } from './world.ts';
import type { Line, Stop, Building } from './types.ts';
import { CARGO_INFO, CARGO_LIST, FACILITY, isIndustry, room, CATCH } from './industry.ts';

export interface Advice {
  id: string;
  tone: 'tip' | 'warn' | 'urgent';
  title: string;
  body: string;
  cta?: string;
  act?: () => Cmd;
  focus?: { x: number; z: number; dist: number };
  stopId?: number;
  lineId?: number;
}

const fmt$ = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** the best two spots for a new line of this mode: where uncovered homes are, and where jobs are */
export function suggestLine(g: Game, mode: Mode, tries = 8): number[][] {
  const w = g.world, m = MODES[mode];
  const cand: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (!w.isUnlocked(i) || g.spotCheck(mode, i)) continue;
    if (w.stop[i] >= 0) continue;
    if ((mode === 'bus' || mode === 'tram') && g.roadDegree(i) >= 3) continue;
    cand.push(i);
  }
  if (cand.length < 2) return [];
  const blds = [...g.city.buildings.values()];
  const R = m.walkR;
  const homes = new Map<number, number>(), jobs = new Map<number, number>();
  for (const t of cand) {
    const cx = wx(tileX(t)), cz = wz(tileY(t));
    let hs = 0, js = 0;
    for (const b of blds) {
      const dx = b.x + 0.5 - 20 - cx, dz = b.y + 0.5 - 20 - cz;
      if (dx * dx + dz * dz > R * R) continue;
      if (b.kind === 'res') hs += b.residents.length * (1 - g.transit.coverage(b.x, b.y) * 0.85);
      else js += b.cap * (b.special === 'arena' ? 2 : 1);
    }
    homes.set(t, hs); jobs.set(t, js);
  }
  const top = (map: Map<number, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const H = top(homes, 14), J = top(jobs, 14);
  const lo = mode === 'gondola' ? 5 : 8, hi = mode === 'gondola' ? 17 : mode === 'ferry' ? 24 : 24;
  const pairs: { p: number[]; sc: number }[] = [];
  for (const [a, ha] of H) for (const [b, jb] of J) {
    if (a === b) continue;
    const d = Math.hypot(tileX(a) - tileX(b), tileY(a) - tileY(b));
    if (d < lo || d > hi) continue;
    pairs.push({ p: [a, b], sc: (ha + 1) * (jb + 1) / (d + 8) });
  }
  pairs.sort((x, y) => y.sc - x.sc);
  const out: number[][] = [];
  for (const { p } of pairs) {
    const mid = g.autoStops(mode, p[0], p[1]);
    out.push([p[0], ...mid, p[1]]);
    if (out.length >= tries) break;
  }
  return out;
}

/** build the best line the city can afford for a mode */
export function autoLine(g: Game, mode: Mode): Cmd & { line?: Line } {
  if (mode !== 'bus' && !g.unlocked[mode]) return { ok: false, msg: `${MODES[mode].label} is not unlocked yet.` };
  let last = 'I could not find a good spot for a line.';
  for (const tiles of suggestLine(g, mode)) {
    const q = g.quoteLine(mode, tiles);
    if (!q.ok) { last = q.reason ?? last; continue; }
    if (q.cost > g.money) { last = `A good ${MODES[mode].label.toLowerCase()} line costs ${fmt$(q.cost)}. Save a little more.`; continue; }
    const r = g.createLine(mode, tiles);
    if (r.ok) {
      // a second vehicle straight away keeps the first stops from filling up
      if (g.money > MODES[mode].vehCost * 3) g.addVehicle(r.line!);
      return r;
    }
    last = r.msg ?? last;
  }
  return { ok: false, msg: last };
}

// ------------------------------------------------------------------ freight

/** the closest tile that can host a yard (or depot) for a facility */
export function yardFor(g: Game, b: Building, mode: 'truck' | 'freight'): number {
  let best = -1, bd = 99;
  for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const t = tileIdx(x, y);
    if (g.spotCheck(mode, t)) continue;
    if (mode === 'truck' && g.roadDegree(t) >= 3) continue;
    const d = Math.hypot(x - b.x, y - b.y) + (g.world.stop[t] >= 0 ? -0.5 : 0);
    if (Math.hypot(wx(x) - wx(b.x), wz(y) - wz(b.y)) > CATCH) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

const servedBy = (g: Game, b: Building) => g.transit.lines.some((l) => (l.kind === 'truck' || l.kind === 'freight') && l.stops.some((s) => Math.hypot(s.x - wx(b.x), s.z - wz(b.y)) <= CATCH));

/** best producer to connect and where its cargo should go */
export function freightOffer(g: Game): { from: Building; to: Building; idx: number; tiles: number[]; cost: number; est: number } | null {
  const sites = g.city.cargoSites();
  let best: ReturnType<typeof freightOffer> = null;
  for (const p of sites) {
    if (!isIndustry(p.special) || p.special === 'terminal') continue;
    const F = FACILITY[p.special as 'farm' | 'quarry' | 'factory'];
    if (F.makes < 0 || p.out[F.makes] < 14 || servedBy(g, p)) continue;
    const a = yardFor(g, p, 'truck');
    if (a < 0) continue;
    for (const q of sites) {
      if (q === p || room(q, F.makes) < 8) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 4 || d > 22) continue;
      const bt = yardFor(g, q, 'truck');
      if (bt < 0 || bt === a) continue;
      const qt = g.quoteLine('truck', [a, bt]);
      if (!qt.ok || qt.cost > g.money) continue;
      const est = Math.min(F.rate * p.eff, 60) * CARGO_INFO[CARGO_LIST[F.makes]].rate * d * (q.special === 'terminal' ? 1.25 : 1);
      if (!best || est > best.est) best = { from: p, to: q, idx: F.makes, tiles: [a, bt], cost: qt.cost, est };
    }
  }
  return best;
}

export function autoFreight(g: Game): Cmd & { line?: Line } {
  if (!g.unlocked.truck) return { ok: false, msg: 'Freight is not unlocked yet.' };
  const o = freightOffer(g);
  if (!o) return { ok: false, msg: 'I could not find a farm, quarry or factory worth connecting right now.' };
  const r = g.createLine('truck', o.tiles);
  if (r.ok && r.line) { g.addVehicle(r.line); }
  return r;
}

/** a rough price for the advisor's offer (cached for a few seconds, the search is not free) */
const quoteCache = new WeakMap<Game, Map<Mode, { t: number; q: number | null }>>();
export function autoLineQuote(g: Game, mode: Mode): number | null {
  let m = quoteCache.get(g);
  if (!m) quoteCache.set(g, (m = new Map()));
  const hit = m.get(mode);
  if (hit && g.t - hit.t < 12 && hit.t <= g.t) return hit.q;
  let q: number | null = null;
  for (const tiles of suggestLine(g, mode, 3)) {
    const r = g.quoteLine(mode, tiles);
    if (r.ok) { q = r.cost; break; }
  }
  m.set(mode, { t: g.t, q });
  return q;
}

/** which mode to offer next: spread the network across what is unlocked and affordable */
const bestMode = (g: Game): Mode => {
  const count = (m: Mode) => g.transit.lines.filter((l) => l.kind === m).length;
  const opts: Mode[] = ['bus'];
  if (g.unlocked.tram && g.money > MODES.tram.baseCost + MODES.tram.stopCost * 2 + 900) opts.push('tram');
  if (g.unlocked.metro && g.money > 6000 && g.pop > 1500) opts.push('metro');
  opts.sort((a, b) => count(a) - count(b) || MODE_ORDER.indexOf(b) - MODE_ORDER.indexOf(a));
  return opts[0];
};

export function advise(g: Game, dismissed: Set<string>): Advice[] {
  const out: Advice[] = [];
  const w = g.world, tr = g.transit, st = g.city.stats;
  const add = (a: Advice) => { if (!dismissed.has(a.id)) out.push(a); };

  // 1. an overcrowded stop, the thing that ends cities
  let worst: Stop | null = null, wf = 0.9;
  for (const s of tr.stops) { const f = s.queue.length / s.cap; if (f > wf) { wf = f; worst = s; } }
  if (worst) {
    const s = worst;
    const line = [...s.lines].sort((a, b) => a.vehicles.length / tr.maxVehicles(a) - b.vehicles.length / tr.maxVehicles(b))[0];
    if (line && line.vehicles.length < tr.maxVehicles(line) && g.money >= tr.vehicleCost(line)) {
      const m = MODES[line.kind];
      add({ id: 'crowd' + s.id, tone: 'urgent', title: `${s.name} is overflowing`, body: `${s.queue.length} people are waiting. More ${m.vehicles} on ${line.name} will clear it.`, cta: `Add a ${m.vehicle} · ${fmt$(tr.vehicleCost(line))}`, act: () => g.addVehicle(line), focus: { x: s.x, z: s.z, dist: 16 }, stopId: s.id });
    } else if (s.cap < MODES[s.kind].stopMax && g.money >= MODES[s.kind].expandCost) {
      add({ id: 'crowdx' + s.id, tone: 'urgent', title: `${s.name} is overflowing`, body: 'The platform is too small for the crowd. Expanding it buys time.', cta: `Expand · ${fmt$(MODES[s.kind].expandCost)}`, act: () => g.expandStop(s), focus: { x: s.x, z: s.z, dist: 16 }, stopId: s.id });
    } else {
      add({ id: 'crowdl' + s.id, tone: 'urgent', title: `${s.name} is overflowing`, body: 'That line is maxed out. Build another line that serves the same neighbourhood.', focus: { x: s.x, z: s.z, dist: 18 }, stopId: s.id });
    }
  }

  const roomForLine = tr.lines.length < 12;

  // 2. a jammed stretch of road
  let jam = -1, jl = 0;
  for (let i = 0; i < N * N; i++) {
    if (!w.road[i] || w.stop[i] >= 0) continue;
    const bad = (1 - g.traffic.cong[i]) * Math.min(1, g.traffic.load[i] * 1.6);
    if (bad > jl) { jl = bad; jam = i; }
  }
  if (jam >= 0 && jl > 0.42) {
    const x = tileX(jam), y = tileY(jam);
    const focus = { x: wx(x), z: wz(y), dist: 20 };
    if (g.unlocked.junction && w.surf(jam) && w.degree(jam) >= 3 && !w.ctl[jam] && g.junctionCheck(jam, 2) === null && g.money >= COST.roundabout + 400) {
      add({ id: 'jct' + jam, tone: 'warn', title: 'A junction is clogging', body: 'Cars from every side are fighting over one crossing. A roundabout keeps them moving without stopping.', cta: `Roundabout here · ${fmt$(COST.roundabout)}`, act: () => g.setJunction(jam, 2), focus });
    } else if (w.road[jam] === 1 && g.unlocked.avenue) {
      // widen the street along its axis around the jam
      const horiz = (x > 0 && w.road[tileIdx(x - 1, y)] > 0) || (x < N - 1 && w.road[tileIdx(x + 1, y)] > 0);
      const tiles: number[] = [];
      for (let k = -5; k <= 5; k++) {
        const tx = horiz ? x + k : x, ty = horiz ? y : y + k;
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
        const t = tileIdx(tx, ty);
        if (w.road[t] === 1) tiles.push(t);
      }
      let cost = 0;
      for (const t of tiles) cost += g.roadTileCost(t, 2);
      if (tiles.length && cost <= g.money) add({ id: 'jam' + jam, tone: 'warn', title: 'A street is jammed', body: 'Cars are crawling here. Wider lanes carry about twice the traffic.', cta: `Widen it · ${fmt$(cost)}`, act: () => g.buildRoad(tiles, 2), focus });
    } else if (g.money > 1200 && roomForLine) {
      const mode = bestMode(g);
      const q = autoLineQuote(g, mode);
      if (q !== null && q <= g.money) add({ id: 'jamline', tone: 'warn', title: 'Traffic is backing up', body: `A ${MODES[mode].label.toLowerCase()} line gets people out of their cars. I can pick a route for you.`, cta: `Build a ${MODES[mode].label.toLowerCase()} line · ~${fmt$(q)}`, act: () => autoLine(g, mode), focus });
    }
  }

  // 3. buildings with no road
  let cut: any = null, cutN = 0;
  for (const b of g.city.buildings.values()) if (b.access < 0 && b.cutoff > 8) { cutN++; cut = cut ?? b; }
  if (cut) add({ id: 'cut', tone: 'warn', title: `${cutN} ${cutN === 1 ? 'building has' : 'buildings have'} no road`, body: 'Nobody can get in or out. Draw a road to the lot and it comes back to life.', focus: { x: wx(cut.x), z: wz(cut.y), dist: 18 } });

  // 3b. nowhere left to build
  {
    let lots = 0;
    for (let i = 0; i < N * N && lots < 6; i++) {
      if (!w.buildable(i) || !w.isEmpty(i)) continue;
      if (g.roadDegree(i) > 0) lots++;
    }
    if (lots < 5 && st.pop >= 25) add({ id: 'room', tone: 'tip', title: 'The city has run out of room', body: 'Every lot beside a road is taken, so growth has stopped. Draw new streets (press 2) off the edges to open more land.' });
  }

  // 4. first transit
  if (tr.lines.length === 0 && st.pop >= 45) {
    const q = autoLineQuote(g, 'bus');
    if (q !== null) add({ id: 'first', tone: 'tip', title: 'Your first bus line', body: 'Too many cars is how cities seize up. A bus line between where people live and where they work takes pressure off the roads.', cta: `Build one for me · ~${fmt$(q)}`, act: () => autoLine(g, 'bus') });
  }

  // 5. newly unlocked modes nobody has tried
  for (const m of MODE_ORDER) {
    if (m === 'bus' || !g.unlocked[m] || !roomForLine) continue;
    if (tr.lines.some((l) => l.kind === m)) continue;
    const q = autoLineQuote(g, m);
    if (q === null || q > g.money) continue;
    const def = MODES[m];
    add({ id: 'try' + m, tone: 'tip', title: `${def.label} lines are unlocked`, body: `${def.tag} I can pick a good route.`, cta: `Build a ${def.label.toLowerCase()} line · ~${fmt$(q)}`, act: () => autoLine(g, m) });
  }

  // 6. big uncovered neighbourhoods
  if (tr.lines.length > 0 && st.pop >= 120 && roomForLine) {
    let uncovered = 0, total = 0;
    for (const b of g.city.buildings.values()) if (b.kind === 'res') { const n = b.residents.length; total += n; if (g.transit.coverage(b.x, b.y) < 0.15) uncovered += n; }
    if (total > 0 && uncovered / total > 0.4) {
      const mode = bestMode(g);
      const q = autoLineQuote(g, mode);
      if (q !== null && q <= g.money) add({ id: 'gap' + Math.floor(total / 150), tone: 'tip', title: 'Many homes are far from transit', body: `${Math.round((uncovered / total) * 100)}% of residents cannot walk to a stop. A new line there will fill up quickly.`, cta: `Build a ${MODES[mode].label.toLowerCase()} line · ~${fmt$(q)}`, act: () => autoLine(g, mode) });
    }
  }

  // 7. a crowded line that has not overflowed yet
  for (const l of tr.lines) {
    const cap = l.vehicles.reduce((a, c) => a + c.cap, 0);
    const load = l.vehicles.reduce((a, c) => a + c.passengers.length, 0);
    if (cap > 0 && load / cap > 0.85 && l.vehicles.length < tr.maxVehicles(l) && g.money >= tr.vehicleCost(l) * 2) {
      const m = MODES[l.kind];
      add({ id: 'full' + l.id, tone: 'tip', title: `${l.name} is nearly full`, body: `Every ${m.vehicle} is packed. One more keeps the stops from backing up.`, cta: `Add a ${m.vehicle} · ${fmt$(tr.vehicleCost(l))}`, act: () => g.addVehicle(l), lineId: l.id });
    }
  }

  // 7b. cargo piling up with nobody hauling it, or a freight line that cannot keep up
  if (g.unlocked.truck && roomForLine) {
    const o = freightOffer(g);
    if (o && g.money > o.cost + 600) {
      const ci = CARGO_INFO[CARGO_LIST[o.idx]];
      add({ id: 'freight' + o.from.id + '_' + o.to.id, tone: 'tip', title: `${o.from.name} has ${ci.label.toLowerCase()} to move`, body: `${Math.floor(o.from.out[o.idx])} units are waiting and nobody collects them. A truck line to ${o.to.name} pays about ${fmt$(o.est)} a day.`, cta: `Build a truck line · ${fmt$(o.cost)}`, act: () => autoFreight(g), focus: { x: wx(o.from.x), z: wz(o.from.y), dist: 18 } });
    }
  }
  for (const l of tr.lines) {
    if (l.kind !== 'truck' && l.kind !== 'freight') continue;
    if (l.vehicles.length >= tr.maxVehicles(l) || g.money < tr.vehicleCost(l) * 2) continue;
    let waiting = 0;
    for (const s of l.stops) for (const b of g.city.sitesNear(s.x, s.z)) if (isIndustry(b.special)) for (const v of b.out) waiting += v;
    if (waiting > 100 * l.stops.length * 0.45 && l.vehicles.length < 4) add({ id: 'haul' + l.id, tone: 'tip', title: `${l.name} cannot keep up`, body: 'Cargo is stacking up at the loading yards. Another vehicle moves more and the industry grows when it is well served.', cta: `Add a ${MODES[l.kind].vehicle} · ${fmt$(tr.vehicleCost(l))}`, act: () => g.addVehicle(l), lineId: l.id });
  }

  // 8. cash to spare
  if (g.money > 9000 && !g.world.districts.every((d) => d.unlocked)) {
    const next = g.world.districts.filter((d) => !d.unlocked).sort((a, b) => a.cost - b.cost)[0];
    if (next && g.money > next.cost * 1.6 && st.pop > 400) add({ id: 'land' + next.index, tone: 'tip', title: 'You can afford more land', body: 'More districts mean more room to grow. The orange Expand pills on the map show the price.' });
  }
  void COST;
  const rank = { urgent: 0, warn: 1, tip: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
