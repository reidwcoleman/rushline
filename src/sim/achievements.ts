// Long-term goals that sit alongside the population milestones.
import type { Game } from './game.ts';
import { MODE_ORDER } from './modes.ts';

export interface Achievement { id: string; title: string; desc: string; test: (g: Game) => boolean }

const boardings = (g: Game) => g.transit.lines.reduce((a, l) => a + l.boardings, 0) + Object.values(g.retiredBoard).reduce((a, b) => a + b, 0);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-line', title: 'On the move', desc: 'Open your first line.', test: (g) => g.transit.lines.length >= 1 },
  { id: 'riders-1000', title: 'Thousand riders', desc: 'Carry 1,000 passengers.', test: (g) => boardings(g) >= 1000 },
  { id: 'riders-10000', title: 'Rush hour regular', desc: 'Carry 10,000 passengers.', test: (g) => boardings(g) >= 10000 },
  { id: 'every-mode', title: 'Network planner', desc: 'Run a bus, tram, metro, ferry and cable car line.', test: (g) => MODE_ORDER.every((m) => g.transit.lines.some((l) => l.kind === m)) },
  { id: 'first-haul', title: 'First delivery', desc: 'Haul cargo to a customer.', test: (g) => g.delivered[0] + g.delivered[1] + g.delivered[2] > 0 },
  { id: 'export-300', title: 'Export business', desc: 'Send 300 units out through the terminal.', test: (g) => g.exported >= 300 },
  { id: 'flights-12', title: 'Frequent flyers', desc: 'Land 12 flights at your airport.', test: (g) => g.flights >= 12 },
  { id: 'school', title: 'Class is in', desc: 'Get 60 pupils into school.', test: (g) => g.city.stats.pupils >= 60 },
  { id: 'friends', title: 'Small world', desc: 'Two citizens become friends.', test: (g) => g.city.persons.some((p) => p.friends.length > 0) },
  { id: 'promoted', title: 'Climbing the ladder', desc: 'A citizen reaches the top of their career.', test: (g) => g.city.persons.some((p) => p.xp >= 18) },
  { id: 'retired', title: 'A long life', desc: 'Someone retires in your city.', test: (g) => g.city.stats.seniors > 0 && g.city.persons.some((p) => p.stage === 'senior' && p.age >= 66) },
  { id: 'baby', title: 'New arrival', desc: 'A baby is born in your city.', test: (g) => g.city.persons.some((p) => p.age === 0 && p.born > 0 && g.t - p.born > 5) },
  { id: 'content', title: 'A happy town', desc: 'Keep average mood above 70% in a town of 800.', test: (g) => g.city.stats.pop >= 800 && g.city.stats.mood > 0.7 },
  { id: 'clean-air', title: 'Fresh air', desc: 'Hold clean air in a city of 1,500.', test: (g) => g.city.stats.pop >= 1500 && g.city.stats.smog < 0.15 },
  { id: 'rich', title: 'Six figures', desc: 'Reach a company value of $100,000.', test: (g) => g.netWorth() >= 100000 },
  { id: 'debt-free', title: 'Debt free', desc: 'Borrow from the bank, then pay it all back.', test: (g) => g.everBorrowed && g.loan === 0 },
  { id: 'contracts-5', title: 'Dependable', desc: 'Finish 5 contracts.', test: (g) => g.contractsDone >= 5 },
  { id: 'research', title: 'State of the art', desc: 'Research every upgrade for one vehicle type.', test: (g) => Object.values(g.research).some((v) => v >= 3) },
  { id: 'roundabout', title: 'Round and round', desc: 'Build a roundabout.', test: (g) => g.world.ctl.some((c) => c === 2) },
  { id: 'highway', title: 'Open road', desc: 'Lay 12 tiles of highway.', test: (g) => g.world.road.reduce((n, r) => n + (r === 3 ? 1 : 0), 0) >= 12 },
  { id: 'overpass', title: 'Grade separated', desc: 'Carry a highway over a street.', test: (g) => g.world.under.some((u) => u > 0) },
  { id: 'wedding', title: 'Just married', desc: 'Two citizens marry.', test: (g) => g.city.social.weddings > 0 },
  { id: 'party', title: 'Life of the party', desc: 'A citizen throws a party.', test: (g) => g.city.social.parties > 0 },
  { id: 'wishes', title: 'Dreams come true', desc: '25 wishes fulfilled.', test: (g) => g.city.social.wishes >= 25 },
  { id: 'builder', title: 'Lot by lot', desc: 'Place 10 buildings yourself.', test: (g) => g.lotsPlaced >= 10 },
  { id: 'survive-30', title: 'Thirty days', desc: 'Keep the city running for 30 days.', test: (g) => g.day >= 31 },
  { id: 'big-city', title: 'Metropolis', desc: 'Reach 9,000 residents.', test: (g) => g.bestPop >= 9000 },
];
