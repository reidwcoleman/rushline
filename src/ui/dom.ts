// Tiny DOM helpers and the icon set (24px grid, 1.8 stroke, round caps).
type Attrs = Record<string, any> | null;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c as Node | string);
  return el;
}
export const clear = (el: Element) => { while (el.firstChild) el.removeChild(el.firstChild); };

const P: Record<string, string> = {
  inspect: 'M5 3.5l13 6.2-5.6 1.9-1.9 5.6z',
  road: 'M8 3L4.5 21M16 3l3.5 18M12 4.5v3M12 10.5v3M12 16.5v3',
  avenue: 'M7 3L3 21M17 3l4 18M11 4.5L10.4 19.5M13 4.5l.6 15',
  bus: 'M6 4h12a2 2 0 0 1 2 2v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2zM4 11h16M7.5 16.5V19M16.5 16.5V19M7.5 13.8h.01M16.5 13.8h.01',
  metro: 'M8 3h8a3 3 0 0 1 3 3v8.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 10.5h14M8.5 21l1.8-3.5M15.5 21l-1.8-3.5M8.6 14.2h.01M15.4 14.2h.01',
  tram: 'M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM5 10h14M12 2v2M8 21l1.5-4M16 21l-1.5-4M8.6 13.4h.01M15.4 13.4h.01',
  ferry: 'M3 15.5l2.2 3.2h13.6l2.2-3.2zM6.5 15.5L8 10h8l1.5 5.5M10.5 10V6.5h3V10M12 3.5v3M3 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1',
  gondola: 'M3 4.5l18 4.5M12 6.8V10M8 10h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 16 18H8a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 8 10zM6.5 13.5h11M9.5 15.8h.01M14.5 15.8h.01',
  transit: 'M5 17.5h14M7 17.5V9.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8M7 12.5h10M9.5 20.5v-3M14.5 20.5v-3',
  autopilot: 'M12 3.5l2 4.6 4.8.5-3.6 3.2 1.1 4.8-4.3-2.6-4.3 2.6 1.1-4.8-3.6-3.2 4.8-.5z',
  bulb: 'M9 18h6M10 21h4M12 3.5a5.5 5.5 0 0 0-3.4 9.8c.6.5.9 1.2.9 2V16h5v-.7c0-.8.3-1.5.9-2A5.5 5.5 0 0 0 12 3.5z',
  park: 'M12 3.5a4.6 4.6 0 0 0-4.3 6.3A3.8 3.8 0 0 0 9 17.2h6a3.8 3.8 0 0 0 1.3-7.4A4.6 4.6 0 0 0 12 3.5zM12 17v4',
  arena: 'M3 14c0-3.3 4-6 9-6s9 2.7 9 6-4 6-9 6-9-2.7-9-6zM7 14c0-1.6 2.2-3 5-3s5 1.4 5 3-2.2 3-5 3-5-1.4-5-3zM12 3v3',
  bulldoze: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10.3 10.5v6M13.7 10.5v6',
  lines: 'M4 6.5h16M4 12h16M4 17.5h9',
  policy: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  land: 'M3 6.5l6-2.3 6 2.3 6-2.3v13.3l-6 2.3-6-2.3-6 2.3zM9 4.2v13.3M15 6.5v13.3',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  rain: 'M7 15.5a4.5 4.5 0 0 1 .6-9 5.5 5.5 0 0 1 10.5 1.5 3.6 3.6 0 0 1-.6 7.5zM8.5 19l-1 2M12.5 19l-1 2M16.5 19l-1 2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 4L2.8 20h18.4zM12 10v4.5M12 17.2v.1',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};
export function icon(name: string, cls = ''): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', P[name] ?? '');
  s.append(p);
  return s;
}
export const money = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const clock = (hour: number) => {
  const hh = Math.floor(hour) % 24, mm = Math.floor((hour % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
