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
