// Shared data shapes for the simulation (no behaviour here).
import type { World } from './world.ts';
import type { Poly } from './path.ts';
import type { Mode } from './modes.ts';

export type Kind = 'res' | 'com' | 'ind';

export interface Building {
  id: number;
  x: number; y: number; tile: number;
  kind: Kind;
  level: number;          // 1..3
  variant: number;
  rot: number;            // 0..3 faces a neighbouring road
  born: number;           // sim time
  cap: number;            // housing (res) or jobs (com/ind)
  residents: Person[];
  workers: Person[];
  visitors: number;       // people currently visiting (com) - for display
  access: number;         // adjacent road tile, -1 if cut off
  accessAll: number[];    // every adjacent road tile (big buildings use several driveways)
  land: number;           // land value 0..1 (cached)
  happy: number;          // 0..1 average satisfaction of residents (res) or 1
  lastLevel: number;      // sim time of last level change
  cutoff: number;         // seconds without road access
  glow: number;           // render hint
  special?: 'arena';
}

export type PState = 'home' | 'toWork' | 'work' | 'toHome' | 'toLeisure' | 'leisure' | 'toBack';

export interface Leg { line: Line; from: number; to: number } // stop indices on the line

export interface Person {
  id: number;
  home: Building;
  work: Building | null;
  state: PState;
  // schedule (hours)
  workStart: number;
  workEnd: number;
  leisure: number;       // probability to do an evening trip
  carBias: number;       // <1 prefers driving
  color: number;
  // current trip
  tripFrom: Building | null;
  tripTo: Building | null;
  tripStart: number;
  tripIdeal: number;
  tripMode: 0 | 1 | 2 | 3 | 4; // 0 none 1 car 2 transit 3 walk 4 stuck-walk
  nextState: PState;
  legs: Leg[] | null;
  leg: number;
  timer: number;          // walking timer
  phase: 'none' | 'walkIn' | 'wait' | 'ride' | 'walkOut' | 'drive' | 'walk' | 'queue';
  stopRef: Stop | null;
  sat: number;            // 0..1 satisfaction
  lastTrip: number;       // day of last completed trip (for stats)
  dest: Building | null;
  waitStart: number;
  dead: boolean;
  leisureDone: number;    // day number of last leisure trip
  walkOutT: number;       // seconds of walking after the last leg
  workDay: number;        // last day this person commuted
  leisureEnd: number;     // hour to head home from leisure
  remote: boolean;        // working from home today
  charged: boolean;       // paid the congestion charge on this trip
  at: Building | null;    // building the person is currently inside
  planTime: number;       // estimated total time of the chosen plan
}

export interface Stop {
  id: number;
  tile: number;
  kind: Mode;
  name: string;
  x: number; z: number;
  lines: Line[];
  queue: Person[];
  cap: number;
  over: number;           // seconds spent overcrowded
  pulse: number;
  lastBoard: number;
  boardings: number;
}

export interface Carrier {
  id: number;
  line: Line;
  dir: 1 | -1;
  target: number;         // stop index heading to
  passengers: Person[];
  cap: number;
  state: 'run' | 'dwell' | 'wait';
  dwell: number;
  // bus
  veh: Vehicle | null;
  // train
  d: number; speed: number;
  off: number;            // lateral offset of the lane it currently uses
  age: number;
  wait: number;           // time spent held for spacing
}

export interface Line {
  id: number;
  kind: Mode;
  name: string;
  color: number;
  stops: Stop[];
  vehicles: Carrier[];
  // rail-like modes
  tiles: number[];            // the full track tile path
  stopIdx: number[];          // index into tiles where each stop sits
  poly: Poly | null;
  stopDist: number[];
  // stats
  boardings: number;
  income: number;
  riders: number;             // rolling average of riders on board
  deleted: boolean;
  created: number;
  loops: number;
  segTime: number[];          // seconds between consecutive stops (live estimate)
  broken: boolean;            // bus cannot reach a stop
  lastFull: number;           // sim time a vehicle last left someone behind
}

export interface Vehicle {
  id: number;
  kind: 0 | 1;            // 0 car, 1 bus
  path: number[];
  i: number;              // index into path
  s: number;              // progress through tile i, 0..1
  speed: number;
  lane: number;
  len: number;
  color: number;
  x: number; z: number; ang: number;
  blocked: number;
  person: Person | null;
  carrier: Carrier | null;
  dwell: number;          // buses held at a stop
  dead: boolean;
  reroute: number;        // cooldown
  spawnedAt: number;
  shape: number;          // render hint
  holdTile: number;
  stuck: number;          // seconds spent (nearly) motionless
  ghost: number;          // seconds of deadlock-breaking pass-through left
}

export interface Ctx {
  world: World;
  t: number;              // sim seconds
  rand: () => number;
  emit: (type: string, data?: unknown) => void;
}

export const DAY = 180;                 // seconds per game day at 1x
export const hourOf = (t: number) => ((t % DAY) / DAY) * 24;
export const dayOf = (t: number) => Math.floor(t / DAY) + 1;
