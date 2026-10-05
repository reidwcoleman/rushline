// The map: a minimap in the corner and the full neighbourhood map (M), drawn like a paper map.
import { h, icon, clear, money, fmt } from './dom.ts';
import { N, HALF, DS, DN, WATER_LEVEL, tileIdx, type World } from '../sim/world.ts';
import { moodColorHex } from '../sim/people.ts';
import { SERVICE } from '../sim/game.ts';
import type { Building } from '../sim/types.ts';
import type { App } from './app.ts';

const MARGIN = 6;                       // tiles of coast shown around the playable square
const SPAN = N + MARGIN * 2;            // tiles across the whole picture
const BASE_PX = 4;                      // resolution of the cached terrain, pixels per tile

export type MapLayer = 'map' | 'mood' | 'traffic' | 'value';
const LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'map', label: 'Map' }, { id: 'mood', label: 'Mood' }, { id: 'traffic', label: 'Traffic' }, { id: 'value', label: 'Land value' },
];

const INK = '#2b2f36';
const LAND = '#d6d0b4', LAND2 = '#cdc6a8', WATER = '#8db6c8', WATER2 = '#789fb4', SAND = '#e6dcb2', GRASS = '#bccb97', PARK = '#8fbf80', TREE = '#9bb17d', HILL = '#c4bd9f';
const ROAD_EDGE = 'rgba(60,54,42,0.7)', ROAD = '#fffdf6', AVE = '#fff3d2', HWY_EDGE = '#9a5a10', HWY = '#f0a53a';
const BLD: Record<string, string> = { res: '#e49a76', com: '#6f9fd4', ind: '#a39f98', special: '#8e7bc4' };

const baseCache = new Map<number, HTMLCanvasElement>();

/** the terrain, drawn once per seed: water, shore, grass and hills */
function terrainImage(world: World): HTMLCanvasElement {
  const hit = baseCache.get(world.seed);
  if (hit) return hit;
  const S = SPAN * BASE_PX;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const t = world.terrain;
  const hs = new Float32Array((S + 1) * (S + 1));
  const at = (i: number) => -HALF - MARGIN + i / BASE_PX;
  for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) hs[j * (S + 1) + i] = t.height(at(i), at(j));
  const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const cl = rgb(LAND), cl2 = rgb(LAND2), cw = rgb(WATER), cw2 = rgb(WATER2), cs = rgb(SAND), cg = rgb(GRASS), ch = rgb(HILL);
  const mix = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * (S + 1) + i;
    const hh = (hs[k] + hs[k + 1] + hs[k + S + 1] + hs[k + S + 2]) / 4;
    let col: number[];
    if (hh < WATER_LEVEL) {
      col = mix(cw, cw2, Math.min(1, (WATER_LEVEL - hh) / 1.6));
    } else {
      const shore = 1 - Math.min(1, (hh - WATER_LEVEL) / 0.2);
      col = mix(cl, cl2, 0.5 + 0.5 * Math.sin(i * 0.7 + j * 0.4) * 0.3);
      col = mix(col, cg, Math.min(1, Math.max(0, (hh - 0.1) / 0.8)) * 0.5);
      col = mix(col, ch, Math.min(1, Math.max(0, (hh - 1.2) / 2.4)) * 0.8);
      // hill shading from the slope toward the light
      const sl = (hs[k + 1] - hs[k + S + 1]) * 0.5;
      col = [col[0] + sl * 26, col[1] + sl * 26, col[2] + sl * 22];
      col = mix(col, cs, shore * 0.9);
    }
    const o = (j * S + i) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  baseCache.set(world.seed, c);
  return c;
}

const lerpHex = (a: number, b: number, k: number) => {
  const r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k);
  const gg = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k);
  const bb = Math.round((a & 255) + ((b & 255) - (a & 255)) * k);
  return `rgb(${r},${gg},${bb})`;
};
const heat = (k: number) => k < 0.5 ? lerpHex(0x4fae7a, 0xe8b04a, k * 2) : lerpHex(0xe8b04a, 0xd9503f, (k - 0.5) * 2);

interface Draw { layer: MapLayer; labels: boolean }

export class MapView {
  /** the small map in the corner */
  mini: HTMLElement;
  private miniCanvas: HTMLCanvasElement;
  private miniStatic: HTMLCanvasElement;
  private miniSize = 176;
  private miniKey = '';
  private miniAt = -9;
  private full: HTMLElement | null = null;
  private fullCanvas!: HTMLCanvasElement;
  private fullStatic!: HTMLCanvasElement;
  private fullSide!: HTMLElement;
  private fullTip!: HTMLElement;
  private fullAt = -9;
  private fullKey = '';
  private layer: MapLayer = 'map';
  private layerBtns = new Map<MapLayer, HTMLElement>();
  private hatch: CanvasPattern | null = null;
  private dragging = false;
  private hover = { x: -1, y: -1 };
  private sideKey = '';

  constructor(readonly app: App, root: HTMLElement) {
    this.miniCanvas = h('canvas', { class: 'mm-c' });
    this.miniStatic = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.miniCanvas.width = this.miniCanvas.height = this.miniStatic.width = this.miniStatic.height = Math.round(this.miniSize * dpr);
    const open = h('button', { class: 'mm-open', title: 'Open the map (M)', onClick: () => this.toggleFull() }, icon('expand'));
    const tag = h('div', { class: 'mm-tag' }, h('span', {}, 'Map'), h('kbd', {}, 'M'));
    this.mini = h('div', { class: 'minimap glass', title: 'Click to move the camera' }, this.miniCanvas, open, tag);
    const move = (e: PointerEvent) => {
      const r = this.miniCanvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * SPAN - MARGIN - HALF;
      const z = ((e.clientY - r.top) / r.height) * SPAN - MARGIN - HALF;
      this.app.view.rig.focus(Math.max(-HALF, Math.min(HALF, x)), Math.max(-HALF, Math.min(HALF, z)));
      this.app.view.follow = false;
    };
    this.miniCanvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.miniCanvas.setPointerCapture(e.pointerId); move(e); });
    this.miniCanvas.addEventListener('pointermove', (e) => { if (this.dragging) move(e); });
    this.miniCanvas.addEventListener('pointerup', () => { this.dragging = false; });
    root.append(this.mini);
  }

  get isOpen() { return !!this.full; }

  // ------------------------------------------------------------ drawing

  /** paint the whole map onto `c` at its own size */
  private paint(c: HTMLCanvasElement, d: Draw) {
    const app = this.app, g = app.game, w = g.world, city = g.city;
    const ctx = c.getContext('2d')!;
    const S = c.width;
    const u = S / SPAN;                     // pixels per tile
    const px = (tx: number) => (tx + MARGIN) * u;
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(terrainImage(w), 0, 0, S, S);

    // trees
    ctx.fillStyle = TREE;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = tileIdx(x, y);
      if (!w.tree[i] || w.water[i] || w.road[i] || w.bld[i] >= 0 || w.park[i]) continue;
      const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      ctx.beginPath();
      ctx.arc(px(x) + u * (0.3 + (hsh % 5) * 0.1), px(y) + u * (0.3 + ((hsh >> 4) % 5) * 0.1), u * 0.22, 0, 6.3);
      ctx.fill();
    }
    // parks
    ctx.fillStyle = PARK;
    for (let i = 0; i < N * N; i++) if (w.park[i]) ctx.fillRect(px(i % N) + 0.5, px((i / N) | 0) + 0.5, u - 1, u - 1);

    // roads: casing first, then the surface, so junctions merge
    const wid = (r: number) => (r === 3 ? 0.62 : r === 2 ? 0.46 : 0.3) * u;
    const tint = (i: number, r: number) => {
      if (d.layer === 'traffic') return r === 3 ? HWY : heat(Math.max(0, Math.min(1, (1 - city.traffic.cong[i]) * 1.15)));
      return r === 3 ? HWY : r === 2 ? AVE : ROAD;
    };
    for (const pass of [0, 1]) {
      for (let i = 0; i < N * N; i++) {
        const r = w.road[i];
        if (!r) continue;
        const x = i % N, y = (i / N) | 0;
        const cx = px(x) + u / 2, cy = px(y) + u / 2;
        const ww = wid(r) + (pass === 0 ? Math.max(1, u * 0.12) : 0);
        ctx.fillStyle = pass === 0 ? (r === 3 ? HWY_EDGE : ROAD_EDGE) : tint(i, r);
        ctx.fillRect(cx - ww / 2, cy - ww / 2, ww, ww);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= N || ny >= N) continue;
          const j = tileIdx(nx, ny), r2 = w.road[j];
          if (!r2) continue;
          const mw = Math.max(wid(r), wid(r2)) + (pass === 0 ? Math.max(1, u * 0.12) : 0);
          const hori = dx === 1;
          ctx.fillStyle = pass === 0 ? (r === 3 && r2 === 3 ? HWY_EDGE : ROAD_EDGE) : (d.layer === 'traffic' ? tint(i, Math.max(r, r2)) : (r === 3 && r2 === 3 ? HWY : Math.max(r, r2) === 2 ? AVE : ROAD));
          if (hori) ctx.fillRect(cx, cy - mw / 2, u, mw); else ctx.fillRect(cx - mw / 2, cy, mw, u);
        }
      }
    }

    // buildings
    const foot = (b: Building) => (b.foot.length ? b.foot : [b.tile]);
    for (const b of city.buildings.values()) {
      let col: string;
      if (d.layer === 'mood') col = b.kind === 'res' && b.residents.length ? '#' + moodColorHex(b.happy).replace('#', '') : '#bdb8a9';
      else if (d.layer === 'value') col = heat(1 - Math.max(0, Math.min(1, b.land)));
      else if (d.layer === 'traffic') col = '#cfc9b6';
      else col = b.special ? BLD.special : BLD[b.kind];
      ctx.fillStyle = col;
      for (const t of foot(b)) {
        const x = t % N, y = (t / N) | 0;
        const pad = u * (b.level >= 3 ? 0.1 : b.level === 2 ? 0.16 : 0.22);
        ctx.fillRect(px(x) + pad, px(y) + pad, u - pad * 2, u - pad * 2);
      }
      if (b.partyUntil > g.t) { ctx.fillStyle = '#ff6fa8'; ctx.beginPath(); ctx.arc(px(b.x) + u / 2, px(b.y) + u / 2, u * 0.45, 0, 6.3); ctx.fill(); }
    }

    // transit lines and stops
    for (const l of g.transit.lines) {
      if (l.deleted) continue;
      const tiles = l.kind === 'metro' || l.kind === 'tram' || l.kind === 'ferry' || l.kind === 'gondola' || l.kind === 'freight' ? (l.tiles.length > 1 ? l.tiles : l.stops.map((s) => s.tile)) : l.stops.map((s) => s.tile);
      if (tiles.length < 2) continue;
      ctx.strokeStyle = '#' + l.color.toString(16).padStart(6, '0');
      ctx.lineWidth = Math.max(1.5, u * 0.22);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      tiles.forEach((t, k) => { const X = px(t % N) + u / 2, Y = px((t / N) | 0) + u / 2; if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (u >= 5) {
      for (const s of g.transit.stops) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(px(s.tile % N) + u / 2, px((s.tile / N) | 0) + u / 2, u * 0.26, 0, 6.3); ctx.fill(); ctx.stroke();
      }
    }

    // neighbourhoods: locked ones are veiled, the borders are dashed
    if (!this.hatch) this.hatch = this.makeHatch(ctx);
    for (const dist of w.districts) {
      const x0 = px(dist.col * DS), y0 = px(dist.row * DS), sz = DS * u;
      if (!dist.unlocked) {
        ctx.fillStyle = 'rgba(52,60,72,0.38)'; ctx.fillRect(x0, y0, sz, sz);
        if (this.hatch) { ctx.fillStyle = this.hatch; ctx.fillRect(x0, y0, sz, sz); }
      }
    }
    // the land beyond the city limits fades back
    ctx.fillStyle = 'rgba(43,47,54,0.14)';
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.rect(px(0), px(0), N * u, N * u); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(43,47,54,0.35)';
    ctx.lineWidth = Math.max(1, u * 0.12);
    ctx.setLineDash([u * 0.7, u * 0.5]);
    ctx.beginPath();
    for (let k = 0; k <= DN; k++) { ctx.moveTo(px(k * DS), px(0)); ctx.lineTo(px(k * DS), px(N)); ctx.moveTo(px(0), px(k * DS)); ctx.lineTo(px(N), px(k * DS)); }
    ctx.stroke();
    ctx.setLineDash([]);

    if (d.labels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const dist of w.districts) {
        const cx = px(dist.col * DS + DS / 2), cy = px(dist.row * DS + DS / 2);
        ctx.font = `600 ${Math.round(u * 1.6)}px Fraunces, Georgia, serif`;
        ctx.lineWidth = u * 0.5; ctx.strokeStyle = dist.unlocked ? 'rgba(244,239,225,0.85)' : 'rgba(40,46,56,0.55)'; ctx.lineJoin = 'round';
        ctx.strokeText(dist.name, cx, cy - u * 0.2);
        ctx.fillStyle = dist.unlocked ? INK : '#f3efe2';
        ctx.fillText(dist.name, cx, cy - u * 0.2);
        if (!dist.unlocked) {
          ctx.font = `600 ${Math.round(u * 1.15)}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(243,239,226,0.85)';
          ctx.fillText(`Expand ${money(dist.cost)}`, cx, cy + u * 1.4);
        }
      }
    }
    ctx.restore();
  }

  private makeHatch(ctx: CanvasRenderingContext2D) {
    const t = document.createElement('canvas');
    t.width = t.height = 10;
    const g = t.getContext('2d')!;
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(8, 12); g.lineTo(12, 8); g.stroke();
    return ctx.createPattern(t, 'repeat');
  }

  /** the camera footprint, the followed citizen and their home on top of the cached picture */
  private overlay(dst: HTMLCanvasElement, src: HTMLCanvasElement, big: boolean) {
    const app = this.app, g = app.game;
    const ctx = dst.getContext('2d')!;
    const S = dst.width, u = S / SPAN;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(src, 0, 0);
    const to = (x: number, z: number): [number, number] => [(x + HALF + MARGIN) * u, (z + HALF + MARGIN) * u];
    // camera footprint
    const rig = app.view.rig;
    const pts: [number, number][] = [];
    for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      let p = rig.groundAt(nx, ny);
      if (!p) p = rig.groundAt(nx, Math.min(ny, -0.2));
      if (!p) return;
      const lim = HALF + MARGIN;
      const dx = Math.max(-lim, Math.min(lim, p.x)), dz = Math.max(-lim, Math.min(lim, p.z));
      pts.push(to(dx, dz));
    }
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,176,46,0.16)'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, u * 0.16); ctx.strokeStyle = '#e8921a'; ctx.lineJoin = 'round'; ctx.stroke();
    // the citizen being watched
    const sel = app.tools.selection;
    if (sel?.type === 'person') {
      const p = g.city.personById.get(sel.id);
      if (p) {
        const w = app.view.citizens.where(p);
        const [x, y] = to(w.x, w.z);
        const [hx, hy] = to(p.home.x - HALF + 0.5, p.home.y - HALF + 0.5);
        ctx.strokeStyle = 'rgba(43,47,54,0.5)'; ctx.setLineDash([u * 0.5, u * 0.4]); ctx.lineWidth = Math.max(1, u * 0.1);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.rect(hx - u * 0.3, hy - u * 0.3, u * 0.6, u * 0.6); ctx.fill(); ctx.stroke();
        const k = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        ctx.fillStyle = 'rgba(74,222,128,' + (0.25 + 0.2 * k) + ')';
        ctx.beginPath(); ctx.arc(x, y, u * (0.9 + 0.35 * k), 0, 6.3); ctx.fill();
        ctx.fillStyle = '#35c26b'; ctx.strokeStyle = '#0f3d22'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - u * 0.55); ctx.lineTo(x + u * 0.38, y); ctx.lineTo(x, y + u * 0.55); ctx.lineTo(x - u * 0.38, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    if (big && this.hover.x >= 0) {
      const x = this.hover.x, y = this.hover.y;
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
      ctx.strokeRect((x + MARGIN) * u + 0.5, (y + MARGIN) * u + 0.5, u - 1, u - 1);
    }
  }

  // ------------------------------------------------------------ per frame

  update(dt: number) {
    void dt;
    const g = this.app.game, t = performance.now() / 1000;
    const city = g.city;
    const key = `${g.world.version.roads}|${g.world.version.lock}|${city.buildings.size}|${g.transit.lines.length}|${g.transit.stops.length}|${this.layer}`;
    const mini = this.mini;
    if (mini.offsetParent !== null && innerWidth > 900) {
      if (key !== this.miniKey || t - this.miniAt > 2) {
        this.miniKey = key; this.miniAt = t;
        this.paint(this.miniStatic, { layer: 'map', labels: false });
      }
      this.overlay(this.miniCanvas, this.miniStatic, false);
    }
    if (this.full) {
      if (key !== this.fullKey || t - this.fullAt > 1.2) {
        this.fullKey = key; this.fullAt = t;
        this.paint(this.fullStatic, { layer: this.layer, labels: true });
        this.refreshSide();
      }
      this.overlay(this.fullCanvas, this.fullStatic, true);
    }
  }

  // ------------------------------------------------------------ the full map

  toggleFull() {
    if (this.full) { this.closeFull(); return; }
    this.app.sound.sfx('click');
    const size = Math.max(420, Math.min(innerHeight - 96, innerWidth - 440, 920));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.fullCanvas = h('canvas', { class: 'mf-c' });
    this.fullStatic = document.createElement('canvas');
    this.fullCanvas.width = this.fullCanvas.height = this.fullStatic.width = this.fullStatic.height = Math.round(size * dpr);
    this.fullCanvas.style.width = this.fullCanvas.style.height = size + 'px';
    this.fullTip = h('div', { class: 'mf-tip', style: { display: 'none' } });
    const wrap = h('div', { class: 'mf-map' }, this.fullCanvas, this.fullTip);
    const tile = (e: MouseEvent) => {
      const r = this.fullCanvas.getBoundingClientRect();
      const fx = ((e.clientX - r.left) / r.width) * SPAN - MARGIN, fy = ((e.clientY - r.top) / r.height) * SPAN - MARGIN;
      return { fx, fy, x: Math.floor(fx), y: Math.floor(fy) };
    };
    this.fullCanvas.addEventListener('pointermove', (e) => {
      const p = tile(e);
      const inside = p.x >= 0 && p.y >= 0 && p.x < N && p.y < N;
      this.hover = inside ? { x: p.x, y: p.y } : { x: -1, y: -1 };
      if (!inside) { this.fullTip.style.display = 'none'; return; }
      this.showTip(p.x, p.y, e.clientX, e.clientY);
    });
    this.fullCanvas.addEventListener('pointerleave', () => { this.hover = { x: -1, y: -1 }; this.fullTip.style.display = 'none'; });
    this.fullCanvas.addEventListener('click', (e) => {
      const p = tile(e);
      if (p.x < 0 || p.y < 0 || p.x >= N || p.y >= N) return;
      const w = this.app.game.world;
      const bid = w.bld[tileIdx(p.x, p.y)];
      this.closeFull();
      this.app.view.follow = false;
      this.app.view.rig.focus(p.x - HALF + 0.5, p.y - HALF + 0.5, bid >= 0 ? 16 : Math.min(this.app.view.rig.gDist, 26));
      if (bid >= 0) this.app.tools.setSelection({ type: 'building', id: bid });
    });
    const layers = h('div', { class: 'mf-seg' });
    for (const l of LAYERS) {
      const b = h('button', { class: 'seg' + (this.layer === l.id ? ' on' : ''), onClick: () => { this.layer = l.id; for (const [k, bb] of this.layerBtns) bb.classList.toggle('on', k === l.id); this.fullAt = -9; this.refreshLegend(); } }, l.label);
      this.layerBtns.set(l.id, b);
      layers.append(b);
    }
    this.fullSide = h('div', { class: 'mf-list' });
    const legend = (this.legendEl = h('div', { class: 'mf-legend' }));
    const g = this.app.game;
    const side = h('div', { class: 'mf-side' },
      h('div', { class: 'mf-head' },
        h('div', {}, h('h2', {}, g.name), h('div', { class: 'sub' }, 'Neighbourhoods')),
        h('button', { class: 'x', title: 'Close (M)', onClick: () => this.closeFull() }, icon('close'))),
      layers, this.fullSide, legend);
    this.full = h('div', { class: 'mapfull', onClick: (e: MouseEvent) => { if (e.target === this.full) this.closeFull(); } }, h('div', { class: 'mf-card glass' }, wrap, side));
    this.app.ui.append(this.full);
    this.fullKey = ''; this.sideKey = '';
    this.refreshLegend();
    this.update(0);
  }

  private legendEl!: HTMLElement;
  private refreshLegend() {
    const l = this.legendEl;
    if (!l) return;
    clear(l);
    const dot = (c: string, t: string) => h('span', { class: 'lg' }, h('i', { style: { background: c } }), t);
    if (this.layer === 'map') l.append(dot(BLD.res, 'Homes'), dot(BLD.com, 'Shops'), dot(BLD.ind, 'Industry'), dot(BLD.special, 'Services'), dot(PARK, 'Parks'), dot(HWY, 'Highway'));
    else if (this.layer === 'mood') l.append(h('span', { class: 'lg' }, 'Unhappy', h('b', { class: 'ramp', style: { background: 'linear-gradient(90deg,#ef5350,#e8b04a,#4ade80)' } }), 'Content'));
    else if (this.layer === 'traffic') l.append(h('span', { class: 'lg' }, 'Free', h('b', { class: 'ramp', style: { background: 'linear-gradient(90deg,#4fae7a,#e8b04a,#d9503f)' } }), 'Jammed'));
    else l.append(h('span', { class: 'lg' }, 'Dear', h('b', { class: 'ramp', style: { background: 'linear-gradient(90deg,#d9503f,#e8b04a,#4fae7a)' } }), 'Cheap'));
  }

  closeFull() {
    if (!this.full) return;
    this.full.remove();
    this.full = null;
    this.layerBtns.clear();
    this.app.sound.sfx('click');
  }

  private showTip(x: number, y: number, cx: number, cy: number) {
    const g = this.app.game, w = g.world, i = tileIdx(x, y);
    const d = w.districts[Math.floor(y / DS) * DN + Math.floor(x / DS)];
    const bid = w.bld[i];
    let title = d.name, body = d.unlocked ? 'Open for building' : `Locked · ${money(d.cost)}`;
    if (bid >= 0) {
      const b = g.city.buildings.get(bid);
      if (b) {
        title = b.name || (b.special ? SERVICE[b.special as 'school']?.label ?? b.special : b.kind === 'res' ? (b.level === 1 ? 'House' : b.level === 2 ? 'Apartments' : 'Residential tower') : b.kind === 'com' ? 'Shops and offices' : 'Works');
        body = b.kind === 'res' ? `${b.residents.length} living here · ${d.name}` : `${b.workers.length} jobs · ${d.name}`;
      }
    } else if (w.road[i]) { title = w.road[i] === 3 ? 'Highway' : w.road[i] === 2 ? 'Avenue' : 'Street'; body = d.name; }
    else if (w.water[i]) { title = 'Water'; body = d.name; }
    else if (w.park[i]) { title = 'Park'; body = d.name; }
    clear(this.fullTip);
    this.fullTip.append(h('b', {}, title), h('span', {}, body));
    const r = this.fullCanvas.parentElement!.getBoundingClientRect();
    this.fullTip.style.display = 'grid';
    this.fullTip.style.left = Math.min(r.width - 180, cx - r.left + 14) + 'px';
    this.fullTip.style.top = Math.max(4, cy - r.top + 14) + 'px';
  }

  /** the neighbourhood list: who lives where, how they feel, and what unlocking costs */
  private refreshSide() {
    const g = this.app.game, w = g.world;
    const stats = w.districts.map(() => ({ res: 0, jobs: 0, happy: 0, n: 0, bld: 0 }));
    for (const b of g.city.buildings.values()) {
      const s = stats[Math.floor(b.y / DS) * DN + Math.floor(b.x / DS)];
      s.bld++;
      if (b.kind === 'res') { s.res += b.residents.length; if (b.residents.length) { s.happy += b.happy * b.residents.length; s.n += b.residents.length; } }
      else s.jobs += b.cap;
    }
    const key = w.districts.map((d, i) => `${d.unlocked}${stats[i].res}${stats[i].jobs}${Math.round(stats[i].happy)}${g.money >= d.cost}`).join('|');
    if (key === this.sideKey) return;
    this.sideKey = key;
    clear(this.fullSide);
    const order = [...w.districts].sort((a, b) => (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || stats[b.index].res - stats[a.index].res);
    for (const d of order) {
      const s = stats[d.index];
      const mood = s.n ? s.happy / s.n : -1;
      const row = h('div', { class: 'mf-row' + (d.unlocked ? '' : ' lock'), onClick: () => { this.closeFull(); this.app.view.follow = false; this.app.view.rig.focus((d.col * DS + DS / 2) - HALF, (d.row * DS + DS / 2) - HALF, 46); } },
        h('i', { class: 'dot', style: { background: mood < 0 ? 'rgba(255,255,255,0.18)' : moodColorHex(mood) } }),
        h('div', { class: 'mf-nm' }, h('b', {}, d.name), h('small', {}, d.unlocked ? (s.bld ? `${fmt(s.res)} residents · ${fmt(s.jobs)} jobs` : 'Empty land') : 'Locked')),
        d.unlocked ? null : h('button', { class: 'mf-buy' + (g.money >= d.cost ? ' afford' : ''), onClick: (e: Event) => { e.stopPropagation(); this.app.buyDistrict(d.index); this.sideKey = ''; this.fullAt = -9; } }, icon(g.money >= d.cost ? 'plus' : 'lock'), money(d.cost)));
      this.fullSide.append(row);
    }
  }
}
