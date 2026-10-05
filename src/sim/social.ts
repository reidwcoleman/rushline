// The social life of the city: orders you give citizens, dates, engagements and weddings, parties, moods that come and go, and wishes.
import { clamp } from './util.ts';
import { VENUES, has, fullName, logLife, TRAITS } from './people.ts';
import { DAY, dayOf, hourOf } from './types.ts';
import type { City } from './city.ts';
import type { Person, Building, Order, Venue } from './types.ts';

const HR = DAY / 24;

export interface Action { id: string; label: string; sub: string; ok: boolean; why?: string }
export interface Moodlet { text: string; amt: number }

interface Agenda { t: number; run: () => void }

/** wishes a citizen can hold, with who may hold them and what their text says */
const WISHES: { id: string; text: string; for: (p: Person, c: City) => number }[] = [
  { id: 'job', text: 'Find a job', for: (p) => (p.stage === 'adult' && !p.work ? 6 : 0) },
  { id: 'friend', text: 'Make a new friend', for: (p) => (p.stage !== 'child' && p.friends.length < 3 ? (has(p, 'social') ? 3 : 1.4) : 0) },
  { id: 'love', text: 'Find someone special', for: (p, c) => (p.stage === 'adult' && p.age < 60 && !p.bond && p.friends.length > 0 && !c.social.hasFamilyPartnerHint(p) ? 2.2 : 0) },
  { id: 'date', text: 'Go on a date', for: (p) => (p.bond === 1 ? 3 : 0) },
  { id: 'engaged', text: 'Get engaged', for: (p) => (p.bond === 1 ? 1.5 : 0) },
  { id: 'married', text: 'Get married', for: (p) => (p.bond === 2 ? 4 : 0) },
  { id: 'baby', text: 'Have a baby', for: (p, c) => (p.bond === 3 && p.age >= 22 && p.age <= 42 && p.hh.members.length < 4 && !p.hh.members.some((m) => m.age < 5) ? 2 : 0) },
  { id: 'promo', text: 'Get promoted', for: (p) => (p.work && !p.student && p.stage === 'adult' ? (has(p, 'driven') ? 3 : 1.2) : 0) },
  { id: 'eatout', text: 'Eat out somewhere nice', for: (p) => (p.stage !== 'child' ? (has(p, 'foodie') ? 3 : 1) : 0) },
  { id: 'gym', text: 'Work out', for: (p) => (p.stage !== 'child' && p.age < 70 ? (has(p, 'sporty') ? 3 : 0.6) : 0) },
  { id: 'fun', text: 'Have a night out', for: (p) => (p.stage !== 'child' ? 1.4 : 0.8) },
  { id: 'party', text: 'Go to a party', for: (p) => (p.stage !== 'child' && p.friends.length ? (has(p, 'social') ? 2.6 : 0.8) : 0) },
  { id: 'skill', text: 'Get better at something', for: (p) => (p.stage !== 'child' && p.age < 75 ? 1.1 : 0) },
  { id: 'host', text: 'Throw a party', for: (p) => (p.stage === 'adult' && p.friends.length >= 2 && has(p, 'social') ? 1.6 : 0) },
];

export class Social {
  agenda: Agenda[] = [];
  /** buildings with a party on right now */
  active = new Set<Building>();
  dates = 0; weddings = 0; parties = 0; wishes = 0; breakups = 0; engagements = 0;
  private tickT = 0;

  constructor(readonly city: City) {}

  private get now() { return this.city.ctx.t; }
  private get rand() { return this.city.ctx.rand; }
  private byId(id: number): Person | null { return id ? this.city.personById.get(id) ?? null : null; }
  partnerOf(p: Person): Person | null { const o = this.byId(p.partner); return o && !o.dead && o.partner === p.id ? o : null; }
  hasFamilyPartnerHint(_p: Person) { return false; }
  private at(t: number, run: () => void) { this.agenda.push({ t, run }); }
  private dayStart() { return Math.floor(this.now / DAY) * DAY; }

  // ---------------------------------------------------------------- orders

  /** tell a citizen to go somewhere and stay a while. Returns false if they cannot get there. */
  order(p: Person, o: { kind: Order['kind']; dest: Building; stay: number; label: string; with?: number }, replace = false): boolean {
    if (p.dead || (o.dest.access < 0 && o.dest !== p.home)) return false;
    if (replace) this.cancel(p);
    p.orders.push({ ...o, ph: 0, until: 0 });
    p.leisureDone = dayOf(this.now);
    return true;
  }

  cancel(p: Person) {
    if (!p.orders.length) return;
    p.orders.length = 0;
    // whatever they were doing, they finish the trip and then go back to their own plans
    p.leisureEnd = hourOf(this.now);
  }

  /** advance a citizen's orders; true if this tick was spent on them */
  run(p: Person): boolean {
    if (!p.orders.length) return false;
    const c = this.city, t = this.now;
    const o = p.orders[0];
    if (o.ph === 0) {
      if (o.dest.access < 0 && o.dest !== p.home) { p.orders.shift(); return true; }
      const here = p.at ?? p.home;
      if (here === o.dest) { o.ph = 2; o.until = t + o.stay * HR; this.arrived(p, o); return true; }
      const to = o.dest === p.home ? 'home' : o.dest === p.work ? 'work' : 'leisure';
      const mid = to === 'home' ? 'toHome' : to === 'work' ? 'toWork' : 'toLeisure';
      c.startTrip(p, here, o.dest, to, mid);
      o.ph = 1;
      return true;
    }
    if (o.ph === 1) { o.ph = 2; o.until = t + o.stay * HR; this.arrived(p, o); return true; }
    if (t >= o.until) {
      p.orders.shift();
      if (!p.orders.length) p.leisureEnd = hourOf(t);
    }
    return true;
  }

  private arrived(p: Person, o: Order) {
    const c = this.city;
    if (o.kind === 'date') {
      this.addBuff(p, 'date', 'Date night', 0.09, 1);
      p.needs.fun = clamp(p.needs.fun + 0.15); p.needs.social = clamp(p.needs.social + 0.2);
      this.grant(p, 'date');
    } else if (o.kind === 'party' || o.kind === 'wedding') {
      this.addBuff(p, 'party', o.kind === 'wedding' ? 'A lovely wedding' : 'Great party', 0.07, 0.8);
      this.grant(p, 'party');
    } else if (o.kind === 'host') {
      this.addBuff(p, 'host', 'Hosted a great party', 0.08, 1);
      this.grant(p, 'host');
    }
    void c;
  }

  // ---------------------------------------------------------------- moods and wishes

  addBuff(p: Person, id: string, text: string, amt: number, days: number) {
    const until = this.now + days * DAY;
    const b = p.buffs.find((x) => x.id === id);
    if (b) { b.until = until; b.amt = amt; b.text = text; } else p.buffs.push({ id, text, amt, until });
  }

  buffSum(p: Person): number {
    if (!p.buffs.length) return 0;
    const t = this.now;
    let s = 0;
    for (let i = p.buffs.length - 1; i >= 0; i--) { if (p.buffs[i].until <= t) p.buffs.splice(i, 1); else s += p.buffs[i].amt; }
    return s;
  }

  /** everything currently lifting or dragging someone's mood, in words */
  moodlets(p: Person): Moodlet[] {
    const n = p.needs, c = this.city, out: Moodlet[] = [];
    const add = (text: string, amt: number) => out.push({ text, amt });
    if (n.energy < 0.25) add('Exhausted', -0.12); else if (n.energy > 0.85) add('Well rested', 0.04);
    if (n.hunger < 0.25) add('Starving', -0.14); else if (n.hunger > 0.85) add('Full', 0.04);
    if (n.fun < 0.25) add('Bored stiff', -0.12); else if (n.fun > 0.8) add('Entertained', 0.05);
    if (n.social < 0.25) add('Lonely', -0.1); else if (n.social > 0.8) add('Good company', 0.05);
    if (n.bladder < 0.15) add('Needs the bathroom', -0.06);
    if (n.hygiene < 0.2) add('Needs a wash', -0.07); else if (n.hygiene > 0.9) add('Fresh', 0.02);
    if (n.comfort < 0.32) add('Run-down neighbourhood', -0.1); else if (n.comfort > 0.7) add('Lovely home', 0.06);
    if (p.wallet < 0) add('Broke', -0.08);
    if (p.work && p.sat < 0.45) add('Awful commute', -0.06); else if (p.work && p.sat > 0.88) add('Easy commute', 0.03);
    if (c.stats.smog > 0.5) add('Smoggy air', -0.04);
    if (has(p, 'sunny')) add('Sunny outlook', 0.07); else if (has(p, 'grump')) add('Grumpy by nature', -0.07);
    const mate = this.partnerOf(p);
    if (mate && p.bond >= 2) add(p.bond === 3 ? `Married to ${mate.first}` : `Engaged to ${mate.first}`, 0.03);
    for (const b of p.buffs) if (b.until > this.now) add(b.text, b.amt);
    return out;
  }

  pickWish(p: Person) {
    if (p.dead) return;
    const opts = WISHES.map((w) => ({ w, s: w.for(p, this.city) })).filter((x) => x.s > 0);
    if (!opts.length) { p.wish = null; return; }
    let r = this.rand() * opts.reduce((a, b) => a + b.s, 0);
    for (const o of opts) { r -= o.s; if (r <= 0) { p.wish = { id: o.w.id, text: o.w.text }; return; } }
    p.wish = { id: opts[0].w.id, text: opts[0].w.text };
  }

  /** a wish may just have come true */
  grant(p: Person, id: string) {
    if (!p.wish || p.wish.id !== id) return;
    const c = this.city;
    const text = p.wish.text;
    p.wish = null;
    this.wishes++;
    this.addBuff(p, 'wish', 'A wish came true', 0.07, 1.2);
    logLife(p, this.now, `A wish came true: ${text.toLowerCase()}.`);
    c.pushFeed(p, `${fullName(p)}'s wish came true: ${text.toLowerCase()}.`, 'good', 'wish', 14);
  }

  /** someone walked into a venue, on their own or by order */
  visited(p: Person, b: Building) {
    const v = b.venue;
    if (v === 'cafe' || v === 'diner') this.grant(p, 'eatout');
    else if (v === 'gym') this.grant(p, 'gym');
    else if (v === 'cinema' || v === 'bar' || v === 'mall' || b.special === 'arena' || b.special === 'airport') this.grant(p, 'fun');
    if (b.partyUntil > this.now) this.grant(p, 'party');
  }

  // ---------------------------------------------------------------- what you can ask of someone

  /** the best venue of a kind for this person: near, and good at what they want */
  private venueFor(p: Person, goal: 'eat' | 'fun' | 'social' | 'gym' | 'date'): Building | null {
    const here = p.at ?? p.home;
    let best: Building | null = null, bs = -1;
    const mate = goal === 'date' ? this.partnerOf(p) : null;
    for (const b of this.city.buildings.values()) {
      if (b.kind !== 'com' || b.access < 0 || !b.venue || b.special) {
        if (!(b.special === 'arena' && goal === 'fun')) continue;
      }
      const v = b.venue ? VENUES[b.venue] : null;
      if (!v) continue;
      if (b.venue === 'bar' && p.age < 18) continue;
      let g = 0;
      if (goal === 'eat') g = v.hunger + 0.2 * v.social;
      else if (goal === 'fun') g = v.fun + 0.25 * v.social;
      else if (goal === 'social') g = v.social + 0.3 * v.fun;
      else if (goal === 'gym') g = b.venue === 'gym' ? 1 : 0;
      else g = b.venue === 'cafe' ? 0.9 : b.venue === 'diner' ? 1 : b.venue === 'cinema' ? 1.15 : b.venue === 'bar' && (!mate || mate.age >= 18) ? 0.8 : 0;
      if (b.venue === 'office' || b.venue === 'shop' && goal !== 'fun') g *= 0.1;
      if (g <= 0.05) continue;
      const d = goal === 'date' && mate
        ? (Math.hypot(b.x - p.home.x, b.y - p.home.y) + Math.hypot(b.x - mate.home.x, b.y - mate.home.y)) / 2
        : Math.hypot(b.x - here.x, b.y - here.y);
      const s = g * (1 + b.level * 0.15) / Math.pow(d + 3, 1.15) + (goal === 'date' ? this.rand() * 0.04 : 0);
      if (s > bs) { bs = s; best = b; }
    }
    return best;
  }

  private busy(p: Person) { return p.dead || p.orders.length > 0; }

  /** the things the player can ask this citizen to do right now */
  actionsFor(p: Person): Action[] {
    const out: Action[] = [];
    const c = this.city;
    const here = p.at ?? p.home;
    const atHome = here === p.home && p.phase === 'none';
    out.push({ id: 'home', label: 'Go home', sub: c.addressOf(p.home), ok: !atHome, why: 'Already home' });
    if (p.work) out.push({ id: 'work', label: p.student ? 'Go to school' : 'Go to work', sub: p.work.name, ok: p.at !== p.work || p.phase !== 'none', why: 'Already there' });
    const eat = this.venueFor(p, 'eat'), fun = this.venueFor(p, 'fun'), hang = this.venueFor(p, 'social'), gym = this.venueFor(p, 'gym');
    if (p.stage !== 'child' || p.age >= 5) {
      out.push({ id: 'eat', label: 'Eat out', sub: eat?.name ?? 'No restaurant nearby', ok: !!eat });
      out.push({ id: 'fun', label: 'Have fun', sub: fun?.name ?? 'Nothing to do nearby', ok: !!fun });
      out.push({ id: 'hang', label: 'Hang out', sub: hang?.name ?? 'Nowhere to meet', ok: !!hang });
      if (p.age >= 12) out.push({ id: 'gym', label: 'Work out', sub: gym?.name ?? 'No gym in town', ok: !!gym });
    }
    // friends and family elsewhere
    const seen = new Set<number>();
    const frs = p.friends.map((f) => this.byId(f)).filter((x): x is Person => !!x && x.home !== p.home && x.home.access >= 0);
    frs.sort((a, b) => Math.hypot(a.home.x - here.x, a.home.y - here.y) - Math.hypot(b.home.x - here.x, b.home.y - here.y));
    for (const f of frs.slice(0, 3)) { if (seen.has(f.home.id)) continue; seen.add(f.home.id); out.push({ id: 'visit:' + f.id, label: `Visit ${f.first}`, sub: c.addressOf(f.home), ok: true }); }
    const mate = this.partnerOf(p);
    if (mate && p.age >= 14) out.push({ id: 'date', label: `Date with ${mate.first}`, sub: this.venueFor(p, 'date')?.name ?? 'No place to go', ok: !!this.venueFor(p, 'date') && !this.busy(mate) && mate.phase === 'none' });
    if (p.stage === 'adult' && (p.friends.length || mate || p.hh.members.length > 1)) out.push({ id: 'party', label: 'Throw a party', sub: p.friends.length ? `${Math.min(8, p.friends.length)} friends invited` : 'Family and neighbours', ok: p.wallet > -20 && p.home.partyUntil < this.now, why: 'Already a party on' });
    return out;
  }

  /** do what the player asked. Returns a short line for the toast, or null if nothing happened. */
  perform(p: Person, id: string): string | null {
    const c = this.city, hour = hourOf(this.now);
    const go = (b: Building | null, label: string, stay: number, kind: Order['kind'] = 'go') => {
      if (!b) return null;
      return this.order(p, { kind, dest: b, stay, label }, true) ? label : null;
    };
    if (id === 'home') return go(p.home, `${p.first} is heading home`, 1.5);
    if (id === 'work') return p.work ? go(p.work, `${p.first} is heading to ${p.work.name}`, 0.5) : null;
    if (id === 'eat') { const b = this.venueFor(p, 'eat'); return go(b, `${p.first} is going to ${b?.name}`, 1.2); }
    if (id === 'fun') { const b = this.venueFor(p, 'fun'); return go(b, `${p.first} is going to ${b?.name}`, 1.8); }
    if (id === 'hang') { const b = this.venueFor(p, 'social'); return go(b, `${p.first} is going to ${b?.name}`, 1.5); }
    if (id === 'gym') { const b = this.venueFor(p, 'gym'); return go(b, `${p.first} is going to ${b?.name}`, 1.5); }
    if (id.startsWith('visit:')) {
      const f = this.byId(+id.slice(6));
      if (!f) return null;
      return go(f.home, `${p.first} is visiting ${f.first}`, 2, 'visit');
    }
    if (id === 'date') { const m = this.partnerOf(p); return m && this.dateNight(p, m, true) ? `${p.first} and ${m.first} are heading out` : null; }
    if (id === 'party') {
      void hour;
      const n = this.party(p, 'party', 3);
      return n >= 0 ? `${p.first} is throwing a party` : null;
    }
    void c;
    return null;
  }

  /** a default stay for a place picked on the map */
  stayFor(b: Building, p: Person): number {
    if (b === p.home) return 1.5;
    if (b === p.work) return 0.5;
    if (b.kind === 'res') return 2;
    const v: Venue | null = b.venue;
    return v === 'cinema' ? 2 : v === 'gym' ? 1.5 : v === 'diner' || v === 'cafe' ? 1.2 : 1.5;
  }

  // ---------------------------------------------------------------- dates, weddings and parties

  dateNight(a: Person, b: Person, forced = false): boolean {
    const ok = (p: Person) => !p.dead && p.phase === 'none' && !p.orders.length && (p.state === 'home' || p.state === 'leisure' || p.state === 'work') && p.age >= 14;
    if (!ok(a) || !ok(b)) return false;
    const v = this.venueFor(a, 'date');
    if (!v) return false;
    this.order(a, { kind: 'date', dest: v, stay: 1.7, label: `Date with ${b.first}`, with: b.id }, forced);
    this.order(b, { kind: 'date', dest: v, stay: 1.7, label: `Date with ${a.first}`, with: a.id }, forced);
    this.dates++;
    this.city.pushFeed(a, `${a.first} and ${b.first} went out on a date to ${v.name}.`, 'good', 'date', 5);
    logLife(a, this.now, `Went out with ${b.first} to ${v.name}.`);
    logLife(b, this.now, `Went out with ${a.first} to ${v.name}.`);
    return true;
  }

  /** a gathering at host's home. Returns how many guests were invited, or -1 if nobody could come. */
  party(host: Person, label: string, hours: number, extra: Person[] = []): number {
    const c = this.city;
    if (host.dead) return -1;
    const pool = new Set<Person>(extra);
    for (const f of host.friends) { const q = this.byId(f); if (q) pool.add(q); }
    const mate = this.partnerOf(host);
    if (mate) pool.add(mate);
    for (const m of host.hh.members) pool.add(m);
    const guests: Person[] = [];
    const later: Person[] = [];
    for (const q of pool) {
      if (q === host || q.dead || q.orders.length || q.age < 3) continue;
      const free = (q.phase === 'none' || q.home === host.home) && !(q.state === 'work' && q.at === q.work && !extra.includes(q));
      (free ? guests : later).push(q);
    }
    // nearest first, so the crowd arrives together
    const dist = (x: Person) => Math.hypot(x.home.x - host.home.x, x.home.y - host.home.y);
    guests.sort((x, y) => dist(x) - dist(y));
    const going = guests.slice(0, 9);
    const wedding = label.includes('wedding');
    const kind: Order['kind'] = wedding ? 'wedding' : 'party';
    const home = host.home;
    if (!going.length && !later.length && !extra.length) return -1;
    home.partyUntil = this.now + (hours + 0.6) * HR;
    this.active.add(home);
    this.order(host, { kind: 'host', dest: home, stay: hours, label: `Hosting a ${label}` }, true);
    for (const q of going) this.order(q, { kind, dest: home, stay: Math.max(1.2, hours - 0.6), label: `At ${host.first}'s ${label}` }, false);
    // people still at work or on the road come when they are free
    for (const q of later.slice(0, Math.max(0, 9 - going.length))) this.inviteLater(q, host, label, kind, hours, 4);
    const n = going.length + Math.min(later.length, Math.max(0, 9 - going.length));
    this.parties++;
    if (!wedding) {
      c.pushFeed(host, `${host.first} is throwing a ${label}. ${n} ${n === 1 ? 'guest is' : 'guests are'} invited.`, 'good', 'party', 6);
      logLife(host, this.now, `Threw a ${label} at home.`);
    }
    return n;
  }

  private inviteLater(q: Person, host: Person, label: string, kind: Order['kind'], hours: number, tries: number) {
    this.at(this.now + 0.9 * HR, () => {
      if (q.dead || host.dead || host.home.partyUntil <= this.now + HR * 0.6) return;
      const left = (host.home.partyUntil - this.now) / HR;
      if (!q.orders.length && q.phase === 'none' && !(q.state === 'work' && q.at === q.work)) this.order(q, { kind, dest: host.home, stay: Math.max(0.8, left - 0.4), label: `At ${host.first}'s ${label}` }, false);
      else if (tries > 0) this.inviteLater(q, host, label, kind, hours, tries - 1);
    });
  }

  private weddingFor(a: Person, b: Person) {
    const c = this.city;
    if (a.dead || b.dead || this.partnerOf(a) !== b) return;
    a.bond = 3; b.bond = 3; a.since = b.since = this.now;
    this.weddings++;
    // the guests: friends of both
    const extra: Person[] = [];
    for (const id of [...a.friends, ...b.friends]) { const q = this.byId(id); if (q && q !== a && q !== b && !extra.includes(q)) extra.push(q); }
    // host at whichever home has more room
    const host = a.home.cap - a.home.residents.length >= b.home.cap - b.home.residents.length ? a : b;
    const other = host === a ? b : a;
    this.addBuff(a, 'wed', 'Wedding day', 0.16, 2); this.addBuff(b, 'wed', 'Wedding day', 0.16, 2);
    a.needs.social = clamp(a.needs.social + 0.3); b.needs.social = clamp(b.needs.social + 0.3);
    logLife(a, this.now, `Married ${b.first}.`); logLife(b, this.now, `Married ${a.first}.`);
    this.grant(a, 'married'); this.grant(b, 'married');
    // they may both be away from home: send the other to the host's door
    if (other.orders.length) this.cancel(other);
    this.party(host, 'wedding', 3, extra.filter((q) => q.hh !== host.hh));
    this.order(other, { kind: 'wedding', dest: host.home, stay: 2.4, label: `Wedding with ${host.first}` }, true);
    c.pushFeed(a, `${fullName(a)} and ${fullName(b)} got married.`, 'good', 'wedding', 3);
    this.liveTogether(a, b);
  }

  /** after a wedding: one moves in with the other, or they find a place of their own */
  liveTogether(a: Person, b: Person): boolean {
    const c = this.city;
    if (a.hh === b.hh) return true;
    const room = (p: Person) => p.home.cap - p.home.residents.length;
    const fitsB = (host: Person, mover: Person) => room(host) >= 1 && host.hh.members.length + 1 <= 6 && mover.hh.members.length === 1;
    if (fitsB(a, b)) { this.moveInto(b, a.hh); return true; }
    if (fitsB(b, a)) { this.moveInto(a, b.hh); return true; }
    // a place of their own
    let best: Building | null = null, bd = 1e9;
    for (const h of c.buildings.values()) {
      if (h.kind !== 'res' || h.residents.length > 0 || h.cap < 2 || h.access < 0) continue;
      const d = Math.hypot(h.x - a.home.x, h.y - a.home.y) + Math.hypot(h.x - b.home.x, h.y - b.home.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (!best || a.hh.members.length > 1 || b.hh.members.length > 1) return false;
    const hh = c.newHousehold(best, a.last);
    this.moveInto(a, hh); this.moveInto(b, hh);
    c.pushFeed(a, `${a.first} and ${b.first} moved into ${c.addressOf(best)} together.`, 'info', 'movein2', 4);
    return true;
  }

  moveInto(p: Person, hh: import('./types.ts').Household) {
    const c = this.city;
    const oldHome = p.home, old = p.hh;
    if (old === hh) return;
    const i = oldHome.residents.indexOf(p); if (i >= 0) oldHome.residents.splice(i, 1);
    const j = old.members.indexOf(p); if (j >= 0) old.members.splice(j, 1);
    if (!old.members.length) c.households.delete(old.id);
    p.hh = hh; p.home = hh.home; p.last = hh.last;
    hh.members.push(p); hh.home.residents.push(p);
    if (p.at === oldHome && p.phase === 'none') p.at = hh.home;
    logLife(p, this.now, `Moved into ${c.addressOf(hh.home)}.`);
  }

  // ---------------------------------------------------------------- daily rhythm

  dayTick(day: number) {
    const c = this.city, r = this.rand, t = this.now;
    // forget partners who are gone
    for (const p of c.persons) if (p.partner && !this.partnerOf(p)) { p.partner = 0; p.bond = 0; }
    // new wishes
    for (const p of c.persons) {
      if (p.wish && r() < 0.22) p.wish = null;
      if (!p.wish && r() < 0.7) this.pickWish(p);
    }
    this.romance(day);
    // dates tonight
    const base = this.dayStart();
    for (const p of c.persons) {
      const m = this.partnerOf(p);
      if (!m || p.id > m.id || p.bond < 1) continue;
      const chance = p.bond === 3 ? 0.18 : p.bond === 2 ? 0.55 : 0.6;
      if (r() < chance) this.at(base + (17.3 + r() * 2.2) * HR, () => this.dateNight(p, m));
    }
    void t;
  }

  /** a birthday that deserves a party */
  birthday(p: Person) {
    if (p.age < 18 || p.friends.length < 2 || p.dead) return;
    const c = this.city;
    if (this.rand() > (has(p, 'social') ? 0.07 : 0.025)) return;
    void c;
    this.at(this.dayStart() + (15.5 + this.rand() * 2.5) * HR, () => { if (!p.dead && !p.orders.length && this.active.size < 3) this.party(p, 'birthday party', 3); });
  }

  /** friends fall for each other, couples settle down, and some drift apart */
  private romance(_day: number) {
    const c = this.city, r = this.rand, t = this.now;
    const singles = c.persons.filter((p) => p.stage === 'adult' && p.age <= 62 && !p.bond && p.friends.length && !p.dead);
    const tries = Math.min(140, Math.ceil(singles.length / 2));
    for (let k = 0; k < tries && singles.length; k++) {
      const p = singles[Math.floor(r() * singles.length)];
      if (p.bond || p.mood < 0.4) continue;
      const o = this.byId(p.friends[Math.floor(r() * p.friends.length)]);
      if (!o || o.bond || o.hh === p.hh || o.stage !== 'adult' || o.age > 64 || Math.abs(o.age - p.age) > 10 || o.mood < 0.4) continue;
      let like = 0.35;
      for (const tr of p.traits) if (o.traits.includes(tr)) like += 0.12;
      for (const tr of p.traits) if (TRAITS[tr].opposes && o.traits.includes(TRAITS[tr].opposes!)) like -= 0.1;
      if (r() < clamp(like) * 0.5) this.startDating(p, o);
    }
    const seen = new Set<number>();
    for (const p of [...c.persons]) {
      if (p.dead || !p.bond || seen.has(p.id)) continue;
      const m = this.partnerOf(p);
      if (!m) continue;
      seen.add(p.id); seen.add(m.id);
      const days = (t - p.since) / DAY;
      const happy = Math.min(p.mood, m.mood);
      if (p.bond === 1) {
        if (r() < 0.018 + (happy < 0.4 ? 0.05 : 0)) { this.breakUp(p, m); continue; }
        if (days >= 3 && happy > 0.5 && r() < 0.2) this.engage(p, m);
      } else if (p.bond === 2) {
        if (r() < 0.006) { this.breakUp(p, m); continue; }
        if (days >= 2 && r() < 0.5) this.at(this.dayStart() + (13.5 + r() * 2) * HR, () => this.weddingFor(p, m));
      } else if (p.bond === 3 && p.hh !== m.hh && r() < 0.5) this.liveTogether(p, m);
    }
  }

  startDating(a: Person, b: Person) {
    const c = this.city;
    a.partner = b.id; b.partner = a.id; a.bond = 1; b.bond = 1; a.since = b.since = this.now;
    logLife(a, this.now, `Started seeing ${b.first}.`); logLife(b, this.now, `Started seeing ${a.first}.`);
    this.addBuff(a, 'love', 'Newly in love', 0.1, 2); this.addBuff(b, 'love', 'Newly in love', 0.1, 2);
    this.grant(a, 'love'); this.grant(b, 'love');
    c.pushFeed(a, `${a.first} ${a.last} and ${b.first} ${b.last} started dating.`, 'good', 'dating', 4);
  }

  private engage(a: Person, b: Person) {
    a.bond = 2; b.bond = 2; a.since = b.since = this.now;
    this.engagements++;
    logLife(a, this.now, `Got engaged to ${b.first}.`); logLife(b, this.now, `Got engaged to ${a.first}.`);
    this.addBuff(a, 'ring', 'Engaged', 0.12, 2); this.addBuff(b, 'ring', 'Engaged', 0.12, 2);
    this.grant(a, 'engaged'); this.grant(b, 'engaged');
    this.city.pushFeed(a, `${a.first} and ${b.first} got engaged.`, 'good', 'engaged', 4);
  }

  breakUp(a: Person, b: Person) {
    a.partner = 0; b.partner = 0; a.bond = 0; b.bond = 0;
    this.breakups++;
    logLife(a, this.now, `Broke up with ${b.first}.`); logLife(b, this.now, `Broke up with ${a.first}.`);
    this.addBuff(a, 'sad', 'Heartbroken', -0.14, 2); this.addBuff(b, 'sad', 'Heartbroken', -0.14, 2);
    a.needs.social = clamp(a.needs.social - 0.15); b.needs.social = clamp(b.needs.social - 0.15);
    this.city.pushFeed(a, `${a.first} and ${b.first} broke up.`, 'warn', 'breakup', 5);
  }

  /** someone died: the partner grieves */
  widowed(dead: Person) {
    const m = this.byId(dead.partner);
    if (!m || m.dead) return;
    m.partner = 0; m.bond = 0;
    this.addBuff(m, 'grief', `Grieving ${dead.first}`, -0.2, 5);
    m.needs.comfort = clamp(m.needs.comfort - 0.15);
    logLife(m, this.now, `Lost ${dead.first}.`);
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number) {
    this.tickT += dt;
    if (this.tickT < 1) return;
    this.tickT = 0;
    const t = this.now;
    if (this.agenda.length) {
      const due = this.agenda.filter((a) => a.t <= t);
      if (due.length) { this.agenda = this.agenda.filter((a) => a.t > t); for (const a of due) a.run(); }
    }
    for (const b of this.active) if (b.partyUntil <= t) { this.active.delete(b); b.partyUntil = 0; }
  }

  /** counts for the town panel */
  couples(): { dating: number; engaged: number; married: number } {
    const o = { dating: 0, engaged: 0, married: 0 };
    for (const p of this.city.persons) {
      if (!p.bond || p.id > p.partner) continue;
      if (p.bond === 1) o.dating++; else if (p.bond === 2) o.engaged++; else o.married++;
    }
    return o;
  }
}
