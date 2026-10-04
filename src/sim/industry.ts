// Industry and cargo: what the farms, quarries, factories and terminals make, and who will buy it.
import type { Building, Cargo, Special } from './types.ts';
import { VENUES, FAC_JOBS } from './people.ts';

export const IND_SPECIALS: Special[] = ['farm', 'quarry', 'factory', 'terminal'];
export const isIndustry = (s?: Special) => s === 'farm' || s === 'quarry' || s === 'factory' || s === 'terminal';

export interface CargoInfo { label: string; rate: number; color: number; icon: string }
/** rate is dollars per unit per tile of distance hauled */
export const CARGO_INFO: Record<Cargo, CargoInfo> = {
  food: { label: 'Food', rate: 0.26, color: 0x7ac85a, icon: 'F' },
  stone: { label: 'Stone', rate: 0.22, color: 0x9ea6b0, icon: 'S' },
  goods: { label: 'Goods', rate: 0.35, color: 0xd29a5c, icon: 'G' },
};
export const CARGO_LIST: Cargo[] = ['food', 'stone', 'goods'];

export interface FacilityDef {
  label: string;
  jobs: number;
  makes: number;          // cargo index produced, -1 none
  takes: number[];        // cargo indexes accepted
  rate: number;           // units a day at full efficiency
  titles: [string, string, string];
  tag: string;
}
export const FACILITY: Record<'farm' | 'quarry' | 'factory' | 'terminal', FacilityDef> = {
  farm: { label: 'Farm', jobs: 12, makes: 0, takes: [], rate: 36, titles: FAC_JOBS.farm.titles, tag: 'Grows food. Shops, cafes and diners buy it.' },
  quarry: { label: 'Quarry', jobs: 14, makes: 1, takes: [], rate: 36, titles: FAC_JOBS.quarry.titles, tag: 'Digs stone. A factory turns it into goods.' },
  factory: { label: 'Factory', jobs: 18, makes: 2, takes: [1], rate: 36, titles: FAC_JOBS.factory.titles, tag: 'Turns stone into goods that shops sell.' },
  terminal: { label: 'Cargo terminal', jobs: 16, makes: -1, takes: [0, 1, 2], rate: 0, titles: FAC_JOBS.terminal.titles, tag: 'Ships anything out of the city. Pays well.' },
};
export const OUT_CAP = 90;
export const STOCK_CAP = 40;
export const CATCH = 2.4;

export const NAME_PATTERNS: Record<'farm' | 'quarry' | 'factory' | 'terminal', string[]> = {
  farm: ['{N} Farm', '{N} Orchards', '{N} Dairy', 'Green {N} Farm'],
  quarry: ['{N} Quarry', '{N} Stoneworks', '{N} Aggregates'],
  factory: ['{N} Manufacturing', '{N} Works', '{N} Goods Co.'],
  terminal: ['{N} Freight Terminal', '{N} Cargo Yard', '{N} Export Depot'],
};

/** index of the cargo a shop-type building sells, or -1 */
export function sellsIdx(b: Building): number {
  if (b.kind !== 'com' || !b.venue) return -1;
  const s = VENUES[b.venue].stock;
  return s === 'food' ? 0 : s === 'goods' ? 2 : -1;
}

/** how many units of a cargo the building could take right now */
export function room(b: Building, idx: number): number {
  if (b.special === 'terminal') return 1e9;
  if (b.special === 'factory') return idx === 1 ? Math.max(0, OUT_CAP - b.stock[1]) : 0;
  if (isIndustry(b.special)) return 0;
  return sellsIdx(b) === idx ? Math.max(0, STOCK_CAP - b.stock[idx]) : 0;
}
export const isSite = (b: Building) => isIndustry(b.special) || sellsIdx(b) >= 0;
