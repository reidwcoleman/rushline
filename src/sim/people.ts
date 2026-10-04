// The people of the city: names, households, traits, needs, moods, careers. Pure data and rules, no world access.
import { clamp, type Rng } from './util.ts';
import type { Venue, Stage, TraitId, Needs, Person, Building } from './types.ts';

// ------------------------------------------------------------------ names

const FIRST = [
  'Maya', 'Dev', 'Ines', 'Theo', 'Amara', 'Jonas', 'Priya', 'Mateo', 'Hana', 'Felix', 'Noor', 'Caleb', 'Lena', 'Omar', 'Sofia', 'Ravi', 'Ada', 'Tomas', 'Yuki', 'Elias',
  'Zara', 'Marcus', 'Iris', 'Kofi', 'Mina', 'Leo', 'Anya', 'Samir', 'Clara', 'Diego', 'Freya', 'Jamal', 'Nora', 'Pablo', 'Rosa', 'Idris', 'Tess', 'Arjun', 'Wren', 'Luca',
  'Esme', 'Kenji', 'Paloma', 'Gus', 'Odette', 'Bram', 'Lucia', 'Sana', 'Rhys', 'Mei', 'Otto', 'Greta', 'Nico', 'Aisha', 'Hugo', 'Vera', 'Joon', 'Beatrix', 'Emeka', 'Dalia',
  'Silas', 'Talia', 'Ezra', 'Camila', 'Anders', 'Naomi', 'Rafael', 'June', 'Malik', 'Elena', 'Soren', 'Imani', 'Cyrus', 'Petra', 'Wes', 'Lilah', 'Andre', 'Ottilie', 'Basil', 'Yara',
  'Milo', 'Fatima', 'Declan', 'Ayla', 'Harvey', 'Zoe', 'Tobias', 'Selma', 'Jules', 'Amina', 'Ronan', 'Pia', 'Kwame', 'Edith', 'Stellan', 'Maren', 'Ibrahim', 'Cora', 'Nils', 'Rina',
];
const LAST = [
  'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Haddad', 'Kowalski', 'Rivera', 'Brennan', 'Adeyemi', 'Novak', 'Castillo', 'Whitfield', 'Nakamura', 'Duarte', 'Hollis', 'Petrov',
  'Sandoval', 'Fairchild', 'Mbeki', 'Larsen', 'Quinn', 'Bellamy', 'Ferreira', 'Ashworth', 'Kim', 'Delacroix', 'Osei', 'Hartley', 'Varga', 'Mendes', 'Thorne', 'Ibarra',
  'Calloway', 'Sato', 'Pemberton', 'Nair', 'Rosen', 'Abara', 'Lockhart', 'Vance', 'Dumont', 'Eriksen', 'Gallo', 'Hendry', 'Ito', 'Jovanovic', 'Kaplan', 'Laurent', 'Marsh', 'Nolan',
  'Ortega', 'Pruitt', 'Rao', 'Strand', 'Teague', 'Ueda', 'Voss', 'Weller', 'Yilmaz', 'Zhou', 'Ballard', 'Cheung', 'Dalton', 'Everhart', 'Fontaine', 'Greer', 'Hale', 'Iyer', 'Keane', 'Lopez',
];
export const firstName = (r: Rng) => FIRST[Math.floor(r() * FIRST.length)];
export const lastName = (r: Rng) => LAST[Math.floor(r() * LAST.length)];

const NAME_WORDS = [
  'Alder', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Grove', 'Harbor', 'Ivy', 'Juniper', 'Kestrel', 'Linden', 'Maple', 'Orchard', 'Pine', 'Reed', 'Sable', 'Thistle', 'Union',
  'Vale', 'Willow', 'Amber', 'Beacon', 'Copper', 'Ember', 'Garnet', 'Heron', 'Indigo', 'Jasper', 'Lantern', 'Opal', 'Quay', 'Ridge', 'Summit', 'Crown', 'Meadow', 'Brook', 'Canal',
  'Marlow', 'Hollis', 'Fenwick', 'Larkin', 'Piper', 'Sparrow', 'Tandem', 'Velvet', 'Wicker', 'Yonder', 'Corner', 'Lucky', 'Golden', 'Little', 'Old Town', 'Sunrise',
];
const VENUE_PATTERNS: Record<Venue, string[]> = {
  shop: ['{N} Goods', '{N} General Store', '{N} & Co.', 'The {N} Shop', '{N} Mercantile'],
  cafe: ['{N} Coffee', 'The {N} Cup', '{N} Roasters', 'Bean & {N}', '{N} Cafe'],
  diner: ['{N} Diner', 'The {N} Table', '{N} Kitchen', '{N} Grill', 'Mama {N}\'s'],
  cinema: ['{N} Cinema', 'The {N} Picture House', '{N} Theatre', 'Starlight {N}'],
  bar: ['The {N} Arms', '{N} Taproom', 'The Gilded {N}', '{N} Social Club', 'The Rusty {N}'],
  gym: ['{N} Fitness', 'Iron {N}', '{N} Athletic Club', 'Form & {N}'],
  office: ['{N} Tower', '{N} Partners', '{N} Plaza Offices', '{N} Holdings', '{N} Group'],
  mall: ['{N} Galleria', '{N} Arcade', '{N} Market Hall', '{N} Centre'],
  arena: ['{N} Arena'],
  school: ['{N} School', '{N} Academy'],
  clinic: ['{N} Clinic', '{N} Medical Centre'],
};
const IND_PATTERNS = ['{N} Works', '{N} Foundry', '{N} Manufacturing', '{N} Industrial', '{N} Fabrication', '{N} Mill', '{N} Machine Co.'];
export function venueName(r: Rng, v: Venue | 'ind'): string {
  const pats = v === 'ind' ? IND_PATTERNS : VENUE_PATTERNS[v];
  return pats[Math.floor(r() * pats.length)].replace('{N}', NAME_WORDS[Math.floor(r() * NAME_WORDS.length)]);
}

export const DISTRICT_NAMES = [
  'Old Town', 'Harbourside', 'The Flats', 'Linden Hill', 'Millbrook', 'Crown Heights', 'Foundry Row', 'Riverside', 'Maple Park', 'Kestrel Point', 'Union Square', 'Westgate',
  'Cobble End', 'Orchard Rise', 'Quayside', 'Lantern Quarter',
];

// ------------------------------------------------------------------ venues

export interface VenueDef {
  label: string;
  fun: number; hunger: number; social: number;   // need gained per hour spent there
  price: number;                                 // spend per visit
  wage: number;                                  // base daily wage of staff
  jobs: [string, string, string];                // career ladder
  stock: 'food' | 'goods' | null;                // what it sells (cargo phase)
}
export const VENUES: Record<Venue, VenueDef> = {
  shop:   { label: 'Shop',    fun: 0.30, hunger: 0.05, social: 0.22, price: 0.9, wage: 12, jobs: ['Clerk', 'Shift lead', 'Store manager'], stock: 'goods' },
  cafe:   { label: 'Cafe',    fun: 0.20, hunger: 0.45, social: 0.55, price: 0.7, wage: 11, jobs: ['Barista', 'Head barista', 'Owner'], stock: 'food' },
  diner:  { label: 'Diner',   fun: 0.18, hunger: 0.78, social: 0.38, price: 1.1, wage: 12, jobs: ['Line cook', 'Chef', 'Head chef'], stock: 'food' },
  cinema: { label: 'Cinema',  fun: 0.85, hunger: 0.08, social: 0.30, price: 1.4, wage: 12, jobs: ['Usher', 'Projectionist', 'Manager'], stock: null },
  bar:    { label: 'Bar',     fun: 0.55, hunger: 0.18, social: 0.80, price: 1.2, wage: 12, jobs: ['Bartender', 'Mixologist', 'Manager'], stock: 'food' },
  gym:    { label: 'Gym',     fun: 0.45, hunger: 0.00, social: 0.35, price: 0.9, wage: 13, jobs: ['Trainer', 'Coach', 'Studio owner'], stock: null },
  office: { label: 'Offices', fun: 0.00, hunger: 0.00, social: 0.00, price: 0.0, wage: 18, jobs: ['Analyst', 'Project lead', 'Director'], stock: null },
  mall:   { label: 'Mall',    fun: 0.55, hunger: 0.35, social: 0.45, price: 1.6, wage: 14, jobs: ['Sales rep', 'Merchandiser', 'Centre manager'], stock: 'goods' },
  arena:  { label: 'Arena',   fun: 1.00, hunger: 0.15, social: 0.75, price: 3.2, wage: 15, jobs: ['Steward', 'Groundskeeper', 'Event producer'], stock: null },
  school: { label: 'School',  fun: 0.00, hunger: 0.00, social: 0.00, price: 0.0, wage: 16, jobs: ['Teaching assistant', 'Teacher', 'Principal'], stock: null },
  clinic: { label: 'Clinic',  fun: 0.00, hunger: 0.00, social: 0.00, price: 0.0, wage: 20, jobs: ['Nurse', 'Doctor', 'Chief of medicine'], stock: null },
};
/** jobs at the freight industries */
export const FAC_JOBS: Record<string, { label: string; wage: number; titles: [string, string, string] }> = {
  farm: { label: 'Farm', wage: 13, titles: ['Farmhand', 'Tractor driver', 'Farm manager'] },
  quarry: { label: 'Quarry', wage: 16, titles: ['Quarryman', 'Blaster', 'Quarry manager'] },
  factory: { label: 'Factory', wage: 16, titles: ['Line worker', 'Technician', 'Plant manager'] },
  terminal: { label: 'Cargo terminal', wage: 15, titles: ['Loader', 'Crane operator', 'Terminal manager'] },
};
export const IND_JOBS: [string, string, string][] = [['Operator', 'Welder', 'Foreman'], ['Machinist', 'Technician', 'Plant engineer'], ['Technician', 'Engineer', 'Plant manager']];

/** pick what a new shop-type building is, by level */
export function rollVenue(r: Rng, level: number): Venue {
  const x = r();
  if (level === 1) return x < 0.30 ? 'shop' : x < 0.52 ? 'cafe' : x < 0.72 ? 'diner' : x < 0.80 ? 'cinema' : x < 0.90 ? 'bar' : 'gym';
  if (level === 2) return x < 0.55 ? 'office' : x < 0.72 ? 'mall' : x < 0.80 ? 'cinema' : x < 0.88 ? 'diner' : x < 0.94 ? 'gym' : 'bar';
  return x < 0.62 ? 'office' : x < 0.78 ? 'mall' : x < 0.86 ? 'cinema' : x < 0.94 ? 'diner' : 'bar';
}
export const venueLabel = (b: Building): string => {
  if (b.special && FAC_JOBS[b.special]) return FAC_JOBS[b.special].label;
  if (b.kind === 'res') return ['House', 'Apartments', 'Residential tower'][b.level - 1];
  if (b.kind === 'ind') return ['Workshop', 'Factory', 'Industrial plant'][b.level - 1];
  if (b.venue === 'office') return ['Small office', 'Offices', 'Skyscraper'][b.level - 1];
  return VENUES[b.venue ?? 'shop'].label;
};

// ------------------------------------------------------------------ traits

export interface TraitDef { id: TraitId; label: string; desc: string; opposes?: TraitId }
export const TRAITS: Record<TraitId, TraitDef> = {
  early:   { id: 'early',   label: 'Early bird',    desc: 'Starts work early and hates the late rush.', opposes: 'night' },
  night:   { id: 'night',   label: 'Night owl',     desc: 'Starts late and stays out late.', opposes: 'early' },
  foodie:  { id: 'foodie',  label: 'Foodie',        desc: 'Gets hungry faster and loves a good meal out.' },
  home:    { id: 'home',    label: 'Homebody',      desc: 'Happiest at home. Rarely goes out.', opposes: 'social' },
  social:  { id: 'social',  label: 'Social',        desc: 'Needs company. Always up for going out.', opposes: 'home' },
  driven:  { id: 'driven',  label: 'Driven',        desc: 'Works long days and climbs the ladder faster.' },
  green:   { id: 'green',   label: 'Green',         desc: 'Prefers transit and walking to driving.', opposes: 'driver' },
  thrifty: { id: 'thrifty', label: 'Thrifty',       desc: 'Watches every dollar. Fare hikes hurt.' },
  driver:  { id: 'driver',  label: 'Car lover',     desc: 'Will drive if there is any way to.', opposes: 'green' },
  sporty:  { id: 'sporty',  label: 'Sporty',        desc: 'Walks far, loves the gym.' },
  grump:   { id: 'grump',   label: 'Grumpy',        desc: 'Mood runs low. Complains about everything.', opposes: 'sunny' },
  sunny:   { id: 'sunny',   label: 'Sunny',         desc: 'Optimist. Mood runs high.', opposes: 'grump' },
};
const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];
export function rollTraits(r: Rng): TraitId[] {
  const out: TraitId[] = [];
  for (let k = 0; k < 40 && out.length < 2; k++) {
    const t = TRAIT_IDS[Math.floor(r() * TRAIT_IDS.length)];
    if (out.includes(t) || out.some((o) => TRAITS[o].opposes === t || TRAITS[t].opposes === o)) continue;
    out.push(t);
  }
  return out;
}
export const has = (p: Person, t: TraitId) => p.traits.includes(t);

// ------------------------------------------------------------------ stages

export const stageOf = (age: number): Stage => (age < 13 ? 'child' : age < 18 ? 'teen' : age < 65 ? 'adult' : 'senior');
export const isPupil = (p: Person) => p.stage === 'child' && p.age >= 5 || p.stage === 'teen';

/** one household's make-up: ages in a plausible family shape */
export function composeAges(r: Rng, size: number): number[] {
  const adult = () => 24 + Math.floor(r() * 36);
  const kid = () => 1 + Math.floor(r() * 16);
  const x = r();
  if (size === 1) return x < 0.72 ? [20 + Math.floor(r() * 44)] : [66 + Math.floor(r() * 18)];
  if (size === 2) {
    if (x < 0.46) { const a = adult(); return [a, clamp(a + Math.round((r() - 0.5) * 12), 20, 64)]; }
    if (x < 0.62) { const a = 66 + Math.floor(r() * 14); return [a, a + Math.round((r() - 0.5) * 8)]; }
    const a = 26 + Math.floor(r() * 20); return [a, Math.min(kid(), a - 20)];
  }
  if (size === 3) {
    const a = 28 + Math.floor(r() * 18);
    return x < 0.75 ? [a, a + Math.round((r() - 0.5) * 8), Math.min(kid(), a - 20)] : [a, Math.min(kid(), a - 20), Math.min(kid(), a - 22)];
  }
  const a = 30 + Math.floor(r() * 14);
  return [a, a + Math.round((r() - 0.5) * 8), Math.min(kid(), a - 22), Math.min(kid(), a - 22)];
}

// ------------------------------------------------------------------ appearance

export const SKIN = ['#f6d5b8', '#efc29c', '#d9a47a', '#b97f55', '#8d5a3b', '#5f3a25'];
export const HAIR = ['#2a2018', '#4a3020', '#7a5230', '#b88a4a', '#d9b870', '#8a8f98', '#c8452e', '#1a1a22'];
export const SHIRT = [0xe65f5c, 0x4f8fdb, 0xf2b84b, 0x58b88a, 0x9c6fdb, 0xe87bb1, 0xf08a46, 0x45b5c4, 0x8bc34a, 0xd96a6a, 0x6c7ae0, 0xc9a45a, 0xf2f2ee, 0x3d4350];
export interface Look { skin: number; hair: number; hairColor: number; shirt: number; glasses: boolean; beard: boolean }
export function decodeLook(look: number): Look {
  const n = look >>> 0;
  return { skin: n % 6, hair: (n >> 3) % 6, hairColor: (n >> 6) % 8, shirt: (n >> 9) % SHIRT.length, glasses: ((n >> 14) & 7) === 0, beard: ((n >> 17) & 7) < 2 };
}
export const rollLook = (r: Rng) => Math.floor(r() * 0x7fffff);

// ------------------------------------------------------------------ needs and mood

export const NEED_KEYS = ['energy', 'hunger', 'fun', 'social', 'comfort'] as const;
export const NEED_LABEL: Record<keyof Needs, string> = { energy: 'Energy', hunger: 'Hunger', fun: 'Fun', social: 'Social', comfort: 'Comfort' };
export const freshNeeds = (r: Rng): Needs => ({ energy: 0.7 + r() * 0.25, hunger: 0.6 + r() * 0.3, fun: 0.55 + r() * 0.35, social: 0.55 + r() * 0.35, comfort: 0.55 + r() * 0.3 });

export function moodOf(p: Person): number {
  const n = p.needs;
  let m = 0.14 * n.energy + 0.2 * n.hunger + 0.2 * n.fun + 0.14 * n.social + 0.32 * n.comfort;
  const low = Math.min(n.energy, n.hunger, n.fun, n.social, n.comfort);
  if (low < 0.25) m -= (0.25 - low) * 0.7;
  if (has(p, 'sunny')) m += 0.07;
  if (has(p, 'grump')) m -= 0.07;
  return clamp(m);
}
/** the single number the city reads: how a commute treated them plus how their life is going */
export const feel = (p: Person) => 0.65 * p.sat + 0.35 * p.mood;

export const moodWord = (v: number) => (v > 0.78 ? 'Delighted' : v > 0.6 ? 'Content' : v > 0.42 ? 'Okay' : v > 0.28 ? 'Strained' : 'Miserable');
export const moodColorHex = (v: number) => (v > 0.6 ? '#4ade80' : v > 0.42 ? '#e8b04a' : '#ef5350');

// ------------------------------------------------------------------ careers

export function careerTier(xp: number) { return xp >= 18 ? 2 : xp >= 6 ? 1 : 0; }
export function jobFor(b: Building, xp: number, p?: Person): { title: string; wage: number } {
  const tier = careerTier(xp);
  const boost = 1 + tier * 0.42 + (p && has(p, 'driven') ? 0.1 : 0);
  if (b.special && FAC_JOBS[b.special]) { const f = FAC_JOBS[b.special]; return { title: f.titles[tier], wage: Math.round(f.wage * boost) }; }
  if (b.kind === 'ind') return { title: IND_JOBS[b.level - 1][tier], wage: Math.round([13, 16, 20][b.level - 1] * boost) };
  const v = VENUES[b.venue ?? 'shop'];
  return { title: v.jobs[tier], wage: Math.round(v.wage * [1, 1.3, 1.7][b.level - 1] * boost) };
}

// ------------------------------------------------------------------ life log

export function logLife(p: Person, t: number, text: string) {
  p.log.push({ t, text });
  if (p.log.length > 9) p.log.shift();
}

export const fullName = (p: Person) => `${p.first} ${p.last}`;
