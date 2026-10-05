// A small procedural portrait for a citizen: same look seed as the little figure on the map.
import { decodeLook, SKIN, HAIR, SHIRT } from '../sim/people.ts';
import type { Person } from '../sim/types.ts';

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

export function drawAvatar(cv: HTMLCanvasElement, p: Pick<Person, 'look' | 'age' | 'mood'>, size = 64) {
  const S = 64, dpr = Math.min(2, window.devicePixelRatio || 1) * Math.max(1, size / 64);
  cv.width = Math.round(size * Math.min(2, window.devicePixelRatio || 1) * Math.max(1, size / 64)); cv.height = cv.width;
  cv.style.width = size + 'px'; cv.style.height = size + 'px';
  const c = cv.getContext('2d')!;
  c.setTransform(cv.width / S, 0, 0, cv.width / S, 0, 0);
  void dpr;
  c.clearRect(0, 0, S, S);
  const L = decodeLook(p.look);
  const skin = SKIN[L.skin], hair = HAIR[L.hairColor], shirt = hex(SHIRT[L.shirt]);
  const old = p.age >= 65, kid = p.age < 13;
  // backdrop tinted by mood
  const m = p.mood;
  const g = c.createLinearGradient(0, 0, 0, S);
  const a = m > 0.6 ? ['#2f4a3a', '#1f3328'] : m > 0.42 ? ['#4a4330', '#2f2a1e'] : ['#4d2f2f', '#331f1f'];
  g.addColorStop(0, a[0]); g.addColorStop(1, a[1]);
  c.fillStyle = g;
  c.beginPath(); c.roundRect(0, 0, S, S, 16); c.fill();
  c.save();
  c.beginPath(); c.roundRect(0, 0, S, S, 16); c.clip();
  const cx = S / 2, headY = kid ? 34 : 29, hr = kid ? 14 : 12.5;
  // shoulders
  c.fillStyle = shirt;
  c.beginPath(); c.ellipse(cx, S + 6, kid ? 20 : 26, kid ? 20 : 24, 0, Math.PI, 0); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.12)'; c.beginPath(); c.ellipse(cx, S + 6, 10, 9, 0, Math.PI, 0); c.fill();
  // neck
  c.fillStyle = skin; c.fillRect(cx - 4.5, headY + hr - 4, 9, 9);
  // back hair for long styles
  c.fillStyle = hair;
  if (L.hair === 1 || L.hair === 4) { c.beginPath(); c.roundRect(cx - hr - 2.5, headY - hr + 1, (hr + 2.5) * 2, hr * 2 + 6, 9); c.fill(); }
  // head
  c.fillStyle = skin;
  c.beginPath(); c.ellipse(cx, headY, hr * 0.92, hr, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.08)'; c.beginPath(); c.ellipse(cx + hr * 0.3, headY + 2, hr * 0.5, hr * 0.8, 0, -1.2, 1.2); c.fill();
  // ears
  c.fillStyle = skin;
  c.beginPath(); c.arc(cx - hr * 0.92, headY + 1, 2.4, 0, 7); c.arc(cx + hr * 0.92, headY + 1, 2.4, 0, 7); c.fill();
  // front hair
  c.fillStyle = old ? '#b9bcc2' : hair;
  switch (L.hair) {
    case 0: c.beginPath(); c.ellipse(cx, headY - hr * 0.55, hr * 0.98, hr * 0.62, 0, Math.PI, 0); c.fill(); break;        // short
    case 1: c.beginPath(); c.ellipse(cx, headY - hr * 0.5, hr * 1.02, hr * 0.7, 0, Math.PI, 0); c.fill(); c.fillRect(cx - hr * 1.0, headY - hr * 0.5, 3.4, hr * 1.4); c.fillRect(cx + hr * 1.0 - 3.4, headY - hr * 0.5, 3.4, hr * 1.4); break; // long
    case 2: c.beginPath(); c.ellipse(cx, headY - hr * 0.5, hr, hr * 0.66, 0, Math.PI, 0); c.fill(); c.beginPath(); c.arc(cx, headY - hr - 3, 5, 0, 7); c.fill(); break;       // bun
    case 3: for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(cx - hr + 2 + i * ((hr * 2 - 4) / 6), headY - hr * 0.62 + Math.abs(3 - i) * 0.8, 4.4, 0, 7); c.fill(); } break; // curls
    case 4: c.beginPath(); c.ellipse(cx, headY - hr * 0.6, hr * 1.0, hr * 0.5, 0, Math.PI, 0); c.fill(); break;
    default: if (!old) { c.beginPath(); c.ellipse(cx, headY - hr * 0.74, hr * 0.85, hr * 0.36, 0, Math.PI, 0); c.fill(); } break; // thin on top
  }
  // face
  c.fillStyle = '#2b2118';
  const ey = headY - 0.5, ex = hr * 0.42;
  c.beginPath(); c.arc(cx - ex, ey, 1.6, 0, 7); c.arc(cx + ex, ey, 1.6, 0, 7); c.fill();
  if (L.glasses && !kid) { c.strokeStyle = '#1d232b'; c.lineWidth = 1.3; c.beginPath(); c.arc(cx - ex, ey, 3.6, 0, 7); c.moveTo(cx + ex + 3.6, ey); c.arc(cx + ex, ey, 3.6, 0, 7); c.moveTo(cx - ex + 3.6, ey); c.lineTo(cx + ex - 3.6, ey); c.stroke(); }
  if (L.beard && !kid && p.age > 20 && L.hair !== 1) { c.fillStyle = old ? '#b9bcc2' : hair; c.beginPath(); c.ellipse(cx, headY + hr * 0.55, hr * 0.7, hr * 0.42, 0, 0, Math.PI); c.fill(); }
  // mouth follows mood
  c.strokeStyle = '#5a2f26'; c.lineWidth = 1.6; c.lineCap = 'round';
  const my = headY + hr * 0.52;
  c.beginPath();
  if (m > 0.6) { c.arc(cx, my - 2, 4.4, 0.15 * Math.PI, 0.85 * Math.PI); }
  else if (m > 0.42) { c.moveTo(cx - 3.4, my); c.lineTo(cx + 3.4, my); }
  else { c.arc(cx, my + 4, 4, 1.15 * Math.PI, 1.85 * Math.PI); }
  c.stroke();
  c.restore();
}
