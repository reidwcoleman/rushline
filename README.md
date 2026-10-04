# Rushline

A city-management game about keeping a growing city moving. The streets fill up faster than you can pave them: build roads, avenues, bus lines and an elevated metro, tune the city's policies, and keep three pressures (traffic, crowded stops, unhappy residents) from pushing the stability bar to zero.

Everything you see is generated in code: terrain, water, buildings, vehicles, windows, sky, sound. No image, model or audio files.

## Play

- Drag with the right mouse button to pan, scroll to zoom, `Q`/`E` to rotate, `R`/`F` to tilt.
- Tools `1`-`8`: inspect, road, avenue, bus line, metro line, park, arena, bulldoze.
- Bus and metro lines: click to place stops or stations, then `Enter` (or Finish line). Lines can only cross at a shared station.
- `G` traffic view, `T` transit view, `H` mood view, `L` lines, `P` policies, `Space` pause, `+`/`-` speed, `U` hide the interface.
- Click the three small meters under "City stability" to jump to the worst problem.

## Run it

```
npm install
npm run dev        # http://localhost:5330
npm run build
```

Tools (headless Chrome and Node, no test framework):

```
npm run sim                                         # one balance run
node --experimental-transform-types tools/smart.ts 5 30 1   # a scripted player; prints how long the city survives
node --experimental-transform-types tools/fuzz.ts 11 14 gentle   # random commands with invariant checks
node tools/shot.mjs --url "/?hold&demo=7&play=1" --out shots/a.png --eval "__cam(0,0,30,.7,.9); 1"
node tools/fps.mjs                                  # frame rate per quality level
```

## How it is built

- `src/sim` is plain TypeScript with no rendering: map and terrain, car-following traffic with junction yielding, bus and metro vehicles, the multimodal trip planner, people with daily schedules, growth and upgrades, economy, stability, events.
- `src/render` is three.js: procedural buildings drawn as instanced meshes with a window shader, a rounded-junction road mesh, viaducts and stations, water and sky shaders, a day/night cycle, depth AO and tilt-shift in the post chain.
- `src/ui` is the HUD, tools and panels, written with plain DOM.
