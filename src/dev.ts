// Test helpers (not used by normal play): grow a showcase city quickly.
import type { Game } from './sim/game.ts';
import { N, tileIdx } from './sim/world.ts';
import { DAY } from './sim/types.ts';

export function growDemo(g: Game, days = 6, withMetro = true) {
  const w = g.world;
  g.money = 400000;
  for (const d of w.districts) if (!d.unlocked) g.unlockDistrict(d.index);
  let next = g.t;
  const cx = 20, cy = 20;
  const gridStep = () => {
    const cand: { tiles: number[]; d: number }[] = [];
    for (let k = -20; k <= 20; k += 4) {
      const row: number[] = [], col: number[] = [];
      for (let i = 0; i < N; i++) {
        const rt = tileIdx(i, cy + k), ct = tileIdx(cx + k, i);
        if (cy + k >= 0 && cy + k < N && w.isUnlocked(rt) && !w.road[rt] && w.bld[rt] < 0 && !w.park[rt]) row.push(rt);
        if (cx + k >= 0 && cx + k < N && w.isUnlocked(ct) && !w.road[ct] && w.bld[ct] < 0 && !w.park[ct]) col.push(ct);
      }
      if (row.length) cand.push({ tiles: row, d: Math.abs(k) });
      if (col.length) cand.push({ tiles: col, d: Math.abs(k) });
    }
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand) { if (g.buildRoad(c.tiles, 1).ok) return; }
  };
  const lineAlong = (horizontal: boolean, k: number, lo: number, hi: number, step = 3) => {
    const tiles: number[] = [];
    for (let i = lo; i <= hi; i += step) tiles.push(horizontal ? tileIdx(i, cy + k) : tileIdx(cx + k, i));
    const ok: number[] = [];
    for (const t of tiles) { if (w.road[t] && w.stopKind[t] !== 2 && w.bld[t] < 0) ok.push(t); else if (ok.length >= 2) break; else ok.length = 0; }
    if (ok.length >= 2) g.createBusLine(ok);
  };
  const metro = (horizontal: boolean, k: number) => {
    const tiles: number[] = [];
    for (let i = 5; i <= 35; i += 6) tiles.push(horizontal ? tileIdx(i, cy + k) : tileIdx(cx + k, i));
    const ok = tiles.filter((t) => w.isUnlocked(t) && !w.water[t] && w.bld[t] < 0 && w.stopKind[t] !== 1);
    if (ok.length >= 2) g.createMetroLine(ok);
  };
  const start = g.t;
  let step = 0;
  while (g.t - start < DAY * days && !g.over) {
    g.update(0.1);
    g.stability = 100;
    if (g.t > next) {
      next = g.t + DAY * 0.1;
      step++;
      gridStep(); gridStep();
      if (step === 6) { const row: number[] = [], col: number[] = []; for (let i = 0; i < N; i++) { row.push(tileIdx(i, cy)); col.push(tileIdx(cx, i)); } g.buildRoad(row.filter((t) => w.road[t] || (w.bld[t] < 0 && !w.water[t])), 2); g.buildRoad(col.filter((t) => w.road[t] || (w.bld[t] < 0 && !w.water[t])), 2); }
      if (step === 12) { lineAlong(true, 0, 2, 38); lineAlong(false, 0, 2, 38); }
      if (step === 16) lineAlong(true, 4, 2, 38);
      if (step === 22 && withMetro) { metro(true, -4); }
      if (step === 26 && withMetro) { metro(false, 4); }
      for (const l of g.transit.lines) if (l.vehicles.length < (l.kind === 'bus' ? 4 : 3)) g.addVehicle(l);
    }
  }
  g.stability = 100;
}

/** build one tram, ferry and gondola line on good spots (screenshots / tests) */
export function addModes(g: Game) {
  const w = g.world;
  g.money = Math.max(g.money, 300000);
  for (const k of ['tram', 'ferry', 'gondola', 'metro'] as const) g.unlocked[k] = true;
  let a = 12345;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
  const roads: number[] = [], shore: number[] = [], open: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (w.road[i] && w.stop[i] < 0) roads.push(i);
    if (w.shore[i] && w.isEmpty(i) && w.isUnlocked(i)) shore.push(i);
    if (!w.road[i] && !w.water[i] && w.bld[i] < 0 && !w.park[i] && w.stop[i] < 0 && w.isUnlocked(i)) open.push(i);
  }
  const blds = [...g.city.buildings.values()];
  const dist = (p: number, q: number) => Math.hypot((p % N) - (q % N), Math.floor(p / N) - Math.floor(q / N));
  const near = (t: number, r: number) => blds.reduce((n, b) => n + (Math.hypot(b.x - (t % N), b.y - Math.floor(t / N)) < r ? b.cap : 0), 0);
  const best = (arr: number[], lo: number, hi: number) => {
    const out: { p: number[]; sc: number }[] = [];
    for (let k = 0; k < 700; k++) { const p = arr[(rnd() * arr.length) | 0], q = arr[(rnd() * arr.length) | 0]; const d = dist(p, q); if (d >= lo && d <= hi) out.push({ p: [p, q], sc: near(p, 4) * near(q, 4) }); }
    return out.sort((x, y) => y.sc - x.sc).slice(0, 14).map((o) => o.p);
  };
  const out: Record<string, number | null> = {};
  for (const [mode, arr, lo, hi] of [['tram', roads, 9, 20], ['ferry', shore, 6, 24], ['gondola', open, 7, 16]] as const) {
    out[mode] = null;
    for (const c of best(arr, lo, hi)) { const r = g.createLine(mode, c); if (r.ok) { out[mode] = r.line!.id; for (let k = 0; k < 2; k++) g.addVehicle(r.line!); break; } }
  }
  return out;
}

/** build a few freight lines between the starting industries (for screenshots and tests) */
export function addFreight(g: Game) {
  g.money = Math.max(g.money, 200000);
  g.unlocked.truck = true; g.unlocked.freight = true;
  const sites = g.city.cargoSites();
  const ind = (k: string) => sites.find((b) => b.special === k);
  const farm = ind('farm'), quarry = ind('quarry'), fac = ind('factory'), term = ind('terminal');
  const out: Record<string, number | null> = {};
  if (!farm || !quarry || !fac || !term) return out;
  const near = (b: { x: number; y: number }, mode: 'truck' | 'freight') => {
    let best = -1, bd = 99;
    for (let y = b.y - 3; y <= b.y + 3; y++) for (let x = b.x - 3; x <= b.x + 3; x++) {
      if (x < 0 || y < 0 || x >= 40 || y >= 40) continue;
      const t = y * 40 + x;
      if (g.spotCheck(mode, t)) continue;
      if (mode === 'truck' && g.roadDegree(t) >= 3) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };
  const shops = sites.filter((b) => b.kind === 'com' && !b.special).sort((a, b) => Math.hypot(a.x - farm.x, a.y - farm.y) - Math.hypot(b.x - farm.x, b.y - farm.y));
  const mk = (key: string, mode: 'truck' | 'freight', bs: { x: number; y: number }[], n = 2) => {
    const tiles = bs.map((b) => near(b, mode));
    if (tiles.some((t) => t < 0)) { out[key] = null; return; }
    const r = g.createLine(mode, tiles);
    if (r.ok && r.line) { for (let i = 1; i < n; i++) g.addVehicle(r.line); out[key] = r.line.id; } else out[key] = null;
  };
  mk('farmShop', 'truck', [farm, shops[0] ?? term]);
  mk('quarryFactory', 'truck', [quarry, fac]);
  mk('factoryTerminal', 'truck', [fac, term]);
  mk('rail', 'freight', [quarry, term], 2);
  return out;
}

/** put an airport on the best free spot (for screenshots and tests) */
export function addAirport(g: Game) {
  g.money = Math.max(g.money, 200000);
  g.unlocked.airport = true;
  for (const d of g.world.districts) if (!d.unlocked) g.unlockDistrict(d.index);
  for (let i = 0; i < 1600; i++) {
    const pl = g.planAirport(i);
    if (pl.ok) { const r = g.placeService('airport', i); if (r.ok) return { at: i, rot: pl.rot }; }
  }
  return { at: -1, rot: -1 };
}

/** lay a highway across town with overpasses and an interchange, a roundabout and a signal (screenshots and tests) */
export function addHighway(g: Game) {
  const w = g.world;
  g.money = Math.max(g.money, 300000);
  g.unlocked.highway = true; g.unlocked.junction = true;
  let best: number[] = [], bestScore = -1;
  const scan = (get: (k: number) => number) => {
    let run: number[] = [];
    const flush = () => {
      const par = run.filter((t) => w.road[t] && ((w.surf(t - 1) && w.surf(t + 1)) || (w.surf(t - N) && w.surf(t + N) && !w.surf(t - 1) && false))).length;
      const sc = run.length - par * 6;
      if (run.length > 12 && sc > bestScore) { bestScore = sc; best = run; }
      run = [];
    };
    for (let k = 0; k < N; k++) {
      const t = get(k);
      if (w.isUnlocked(t) && w.bld[t] < 0 && !w.park[t] && w.stop[t] < 0 && !w.rail[t] && !w.water[t]) run.push(t); else flush();
    }
    flush();
  };
  for (let y = 8; y < N - 8; y++) scan((k) => tileIdx(k, y));
  if (best.length < 2) return { at: -1, overpasses: 0, rab: -1, sig: -1, ok: 0 };
  const r = g.buildRoad(best, 3);
  const mid = best[Math.floor(best.length / 2)];
  g.setJunction(mid, 'ramp');
  const jn = [...Array(N * N).keys()].filter((i) => w.surf(i) && w.degree(i) >= 3).sort((a, b) => Math.hypot((a % N) - 20, ((a / N) | 0) - 20) - Math.hypot((b % N) - 20, ((b / N) | 0) - 20));
  const rab = jn[3] ?? -1, sig = jn[7] ?? -1;
  if (rab >= 0) g.setJunction(rab, 2);
  if (sig >= 0) g.setJunction(sig, 1);
  return { at: mid, overpasses: best.filter((t) => w.under[t]).length, rab, sig, ok: r.ok ? 1 : 0 };
}
