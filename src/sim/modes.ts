// Every way to move people: one table so sim, UI and renderer agree.
export type Mode = 'bus' | 'tram' | 'metro' | 'ferry' | 'gondola' | 'truck' | 'freight';
/** passenger modes, in the order the picker shows them */
export const MODE_ORDER: Mode[] = ['bus', 'tram', 'metro', 'ferry', 'gondola'];
export const CARGO_ORDER: Mode[] = ['truck', 'freight'];
export const isCargoMode = (m: Mode) => m === 'truck' || m === 'freight';
/** vehicles that drive on the road network */
export const isRoadMode = (m: Mode) => m === 'bus' || m === 'truck';

export interface ModeDef {
  id: Mode;
  label: string;            // "Metro"
  vehicle: string;          // "train"
  vehicles: string;         // "trains"
  stopWord: string;         // "station"
  stopCode: number;         // world.stopKind value
  solid: boolean;           // the stop takes a whole tile and blocks roads
  onRoad: boolean;          // runs on the road network
  cap: number;              // passengers per vehicle
  stopCap: number;          // starting waiting capacity
  stopMax: number;
  walkR: number;            // tiles people will walk to a stop
  speed: number;            // tiles per second (rail-like modes)
  acc: number; dec: number;
  spacing: number;          // min gap between vehicles of one line, tiles
  dwell: number;            // seconds at a stop
  lane: number;             // lateral offset of the lane used per direction
  fare: number;
  baseCost: number;         // first vehicle bought with the line
  stopCost: number;
  trackCost: number;        // per tile of track / water route / cable
  vehCost: number;
  expandCost: number;
  maxVeh: number;
  upVeh: number; upStop: number; upTrack: number;
  unlock: number;           // residents
  color: number;            // default accent in the UI
  tag: string;              // one-line pitch
  how: string;              // how to place
  icon: string;
  life: number;             // days before a vehicle starts to wear out for good
  models: [string, string, string, string]; // generations unlocked by research
}

export const MODES: Record<Mode, ModeDef> = {
  bus: {
    id: 'bus', label: 'Bus', vehicle: 'bus', vehicles: 'buses', stopWord: 'stop', stopCode: 1, solid: false, onRoad: true,
    cap: 30, stopCap: 18, stopMax: 48, walkR: 3.4, speed: 0, acc: 0, dec: 0, spacing: 0, dwell: 1, lane: 0,
    fare: 0.35, baseCost: 200, stopCost: 80, trackCost: 0, vehCost: 200, expandCost: 220, maxVeh: 10,
    upVeh: 16, upStop: 3, upTrack: 0, unlock: 0, color: 0x7cc4ff,
    tag: 'Cheap and flexible. Shares the road with cars.', how: 'Click roads to place stops.', icon: 'bus',
    life: 36, models: ['City bus', 'Articulated bus', 'Hybrid articulated', 'Electric double-articulated'],
  },
  tram: {
    id: 'tram', label: 'Tram', vehicle: 'tram', vehicles: 'trams', stopWord: 'stop', stopCode: 3, solid: false, onRoad: true,
    cap: 64, stopCap: 30, stopMax: 90, walkR: 4.1, speed: 2.05, acc: 1.5, dec: 2.2, spacing: 1.5, dwell: 1.9, lane: 0.05,
    fare: 0.45, baseCost: 480, stopCost: 260, trackCost: 22, vehCost: 480, expandCost: 360, maxVeh: 8,
    upVeh: 30, upStop: 9, upTrack: 1.4, unlock: 150, color: 0xff8a3d,
    tag: 'Rails in the road median. Never stuck in traffic. Widens streets to avenues.', how: 'Click roads to place stops. Rails follow the road.', icon: 'tram',
    life: 48, models: ['Classic tram', 'Low-floor tram', 'Bi-directional light rail', 'Streetcar 5000'],
  },
  metro: {
    id: 'metro', label: 'Metro', vehicle: 'train', vehicles: 'trains', stopWord: 'station', stopCode: 2, solid: true, onRoad: false,
    cap: 120, stopCap: 50, stopMax: 150, walkR: 5.2, speed: 2.9, acc: 1.5, dec: 2.1, spacing: 1.9, dwell: 2.4, lane: 0.1,
    fare: 0.6, baseCost: 900, stopCost: 1000, trackCost: 70, vehCost: 900, expandCost: 600, maxVeh: 8,
    upVeh: 70, upStop: 55, upTrack: 3, unlock: 600, color: 0xffb02e,
    tag: 'Big elevated trains that skip everything.', how: 'Click open ground to place stations. Track is laid between them.', icon: 'metro',
    life: 64, models: ['Metro train', 'Series 2 stock', 'Driverless units', 'Maglev set'],
  },
  ferry: {
    id: 'ferry', label: 'Ferry', vehicle: 'ferry', vehicles: 'ferries', stopWord: 'pier', stopCode: 4, solid: true, onRoad: false,
    cap: 56, stopCap: 34, stopMax: 100, walkR: 4.6, speed: 1.35, acc: 0.6, dec: 0.9, spacing: 1.6, dwell: 3.4, lane: 0.14,
    fare: 0.9, baseCost: 620, stopCost: 520, trackCost: 6, vehCost: 620, expandCost: 420, maxVeh: 6,
    upVeh: 30, upStop: 14, upTrack: 0, unlock: 320, color: 0x35c9d6,
    tag: 'Crosses the river and bay. Quiet and roomy.', how: 'Click shoreline tiles to place piers. Boats sail the water between them.', icon: 'ferry',
    life: 52, models: ['Harbour ferry', 'Fast catamaran', 'Hydrofoil', 'Electric hydrofoil'],
  },
  gondola: {
    id: 'gondola', label: 'Gondola', vehicle: 'cabin', vehicles: 'cabins', stopWord: 'station', stopCode: 5, solid: true, onRoad: false,
    cap: 9, stopCap: 18, stopMax: 54, walkR: 3.8, speed: 1.55, acc: 1.2, dec: 1.8, spacing: 0.7, dwell: 1.1, lane: 0.045,
    fare: 0.28, baseCost: 70, stopCost: 380, trackCost: 26, vehCost: 70, expandCost: 260, maxVeh: 16,
    upVeh: 4, upStop: 13, upTrack: 1.1, unlock: 420, color: 0xa77bff,
    tag: 'Cable cars fly straight over rivers and rooftops.', how: 'Click open ground for stations. Cables run straight, up to 18 tiles a hop.', icon: 'gondola',
    life: 52, models: ['Cable cabin', 'Detachable grip', 'Ten-person cabin', 'Panoramic cabin'],
  },
  truck: {
    id: 'truck', label: 'Trucks', vehicle: 'truck', vehicles: 'trucks', stopWord: 'yard', stopCode: 6, solid: false, onRoad: true,
    cap: 20, stopCap: 0, stopMax: 0, walkR: 2.4, speed: 0, acc: 0, dec: 0, spacing: 0, dwell: 1.4, lane: 0,
    fare: 0, baseCost: 360, stopCost: 120, trackCost: 0, vehCost: 360, expandCost: 0, maxVeh: 8,
    upVeh: 10, upStop: 2, upTrack: 0, unlock: 400, color: 0xd9a441,
    tag: 'Haul cargo by road between farms, quarries, factories and shops.', how: 'Click roads right beside an industry or shop to place loading yards.', icon: 'truck',
    life: 40, models: ['Box truck', 'Rigid hauler', 'Articulated truck', 'Electric road train'],
  },
  freight: {
    id: 'freight', label: 'Freight rail', vehicle: 'freight train', vehicles: 'freight trains', stopWord: 'depot', stopCode: 7, solid: true, onRoad: false,
    cap: 60, stopCap: 0, stopMax: 0, walkR: 2.4, speed: 2.5, acc: 0.9, dec: 1.5, spacing: 2.8, dwell: 3.2, lane: 0.12,
    fare: 0, baseCost: 900, stopCost: 700, trackCost: 55, vehCost: 1100, expandCost: 0, maxVeh: 5,
    upVeh: 22, upStop: 8, upTrack: 2.4, unlock: 900, color: 0x8d6e63,
    tag: 'Long trains of wagons. Big loads over long distances.', how: 'Click open ground beside an industry for a depot. Track is laid between them.', icon: 'freight',
    life: 64, models: ['Freight loco', 'Diesel-electric haul', 'Heavy haul set', 'Electric heavy haul'],
  },
};

export const GONDOLA_MAX_HOP = 18;
export const modeOfStopCode = (c: number): Mode | null => MODE_ORDER.find((m) => MODES[m].stopCode === c) ?? null;
export const isSolidCode = (c: number) => c === 2 || c === 4 || c === 5 || c === 7;
