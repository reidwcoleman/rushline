// Skills that grow with practice, and the lifetime aspiration each adult works toward.
import { clamp } from './util.ts';
import { careerTier, has } from './people.ts';
import type { Person } from './types.ts';

export type SkillId = 'cooking' | 'fitness' | 'logic' | 'charisma' | 'creativity';
export const SKILL_IDS: SkillId[] = ['cooking', 'fitness', 'logic', 'charisma', 'creativity'];
export const SKILL_INFO: Record<SkillId, { label: string; icon: string; how: string }> = {
  cooking: { label: 'Cooking', icon: 'hunger', how: 'Home meals. Better meals fill them up.' },
  fitness: { label: 'Fitness', icon: 'energy', how: 'The gym. Tires them more slowly.' },
  logic: { label: 'Logic', icon: 'school', how: 'Offices and school. Climbs the career ladder faster.' },
  charisma: { label: 'Charisma', icon: 'social', how: 'Nights out and parties. Makes friends easily.' },
  creativity: { label: 'Creativity', icon: 'spark', how: 'Cinema, bars and cafes. More fun at home.' },
};
export const MAX_SKILL = 10;
export const skillLevel = (p: Person, s: SkillId) => Math.min(MAX_SKILL, Math.floor(p.skills[SKILL_IDS.indexOf(s)] ?? 0));
export const skillValue = (p: Person, s: SkillId) => p.skills[SKILL_IDS.indexOf(s)] ?? 0;

export interface Aspiration {
  id: string;
  label: string;
  goal: string;
  /** 0..1, finished at 1 */
  progress: (p: Person) => number;
  /** how well it suits someone, to choose one for them */
  fit: (p: Person) => number;
}
const kids = (p: Person) => p.hh.members.filter((m) => m.age < 18 && m !== p).length;
export const ASPIRATIONS: Aspiration[] = [
  { id: 'popular', label: 'Friend to everyone', goal: 'Five friends and a way with people',
    progress: (p) => clamp(p.friends.length / 5) * 0.6 + clamp(skillValue(p, 'charisma') / 6) * 0.4,
    fit: (p) => 1 + (has(p, 'social') ? 2 : 0) + (has(p, 'sunny') ? 1 : 0) },
  { id: 'family', label: 'Happy family', goal: 'Marry and raise two children',
    progress: (p) => (p.bond / 3) * 0.5 + clamp(kids(p) / 2) * 0.5,
    fit: (p) => 1 + (has(p, 'home') ? 2 : 0) + (p.partner ? 2 : 0) },
  { id: 'wealth', label: 'Big shot', goal: 'Reach the top of a career with money to spare',
    progress: (p) => (careerTier(p.xp) / 2) * 0.55 + clamp(p.wallet / 1500) * 0.45,
    fit: (p) => 1 + (has(p, 'driven') ? 3 : 0) + (has(p, 'thrifty') ? 1 : 0) },
  { id: 'athlete', label: 'Peak form', goal: 'Fitness level 8',
    progress: (p) => skillValue(p, 'fitness') / 8,
    fit: (p) => 1 + (has(p, 'sporty') ? 4 : 0) },
  { id: 'chef', label: 'Master chef', goal: 'Cooking level 8',
    progress: (p) => skillValue(p, 'cooking') / 8,
    fit: (p) => 1 + (has(p, 'foodie') ? 4 : 0) + (has(p, 'home') ? 1 : 0) },
  { id: 'scholar', label: 'Big thinker', goal: 'Logic level 8',
    progress: (p) => skillValue(p, 'logic') / 8,
    fit: (p) => 1 + (has(p, 'driven') ? 2 : 0) + (has(p, 'grump') ? 1 : 0) },
  { id: 'artist', label: 'Free spirit', goal: 'Creativity level 8',
    progress: (p) => skillValue(p, 'creativity') / 8,
    fit: (p) => 1 + (has(p, 'night') ? 2 : 0) + (has(p, 'sunny') ? 1 : 0) },
];
export const aspirationOf = (p: Person) => ASPIRATIONS.find((a) => a.id === p.aspire) ?? null;

export function pickAspiration(p: Person, r: () => number): string {
  const total = ASPIRATIONS.reduce((s, a) => s + a.fit(p), 0);
  let x = r() * total;
  for (const a of ASPIRATIONS) { x -= a.fit(p); if (x <= 0) return a.id; }
  return ASPIRATIONS[0].id;
}

/** how quickly each skill is picked up, per hour of the right activity */
export const TRAIN_RATE = 0.11;
