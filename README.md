# Rushline

A city-management game about keeping a growing city moving. The streets fill up faster than you can pave them: build roads and avenues, then run buses, trams, an elevated metro, ferries and cable cars, tune the city's policies, and keep three pressures (traffic, crowded stops, unhappy residents) from pushing the stability bar to zero.

Everything you see is generated in code: terrain, water, buildings, vehicles, windows, sky, sound. No image, model or audio files.

## Play

- Drag with the right mouse button to pan, scroll to zoom, `Q`/`E` to rotate, `R`/`F` to tilt.
- Tools `1`-`7`: inspect, road, avenue, transit line, park, arena, bulldoze.
- Transit (`4`, then pick a mode with the chips, press `4` again or `[` `]` to cycle):
  - **Bus** - cheap, uses the road, gets stuck in traffic.
  - **Tram** - rails in the road median, never stuck in traffic. Streets on its route become avenues. Unlocks at 150 residents.
  - **Ferry** - piers on the shoreline, boats sail the river and bay. 320 residents.
  - **Gondola** - cable cars fly straight over rivers and rooftops, up to 18 tiles a hop. 420 residents.
  - **Metro** - big elevated trains on their own track. 600 residents.
- Click to place stops, then `Enter` (or Finish line). Auto-stops fills in stops along long hops. Metro lines can only cross at a shared station. People walk between nearby stops, so a bus can feed a metro.
- The advisor (top right) offers one-click fixes: add a vehicle, widen a street, build a line for you. Auto-fleet buys vehicles for crowded lines. Both can be switched off in the pause menu. Relaxed difficulty is the default.
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
node --experimental-transform-types tools/modetest.ts 8 2   # builds one of each new mode and checks riders
node tools/fps.mjs                                  # frame rate per quality level
```

## How it is built

- `src/sim` is plain TypeScript with no rendering: map and terrain, car-following traffic with junction yielding, bus, tram, metro, ferry and cable car vehicles (one table in `modes.ts`), the multimodal trip planner with walking transfers, the advisor, people with daily schedules, growth and upgrades, economy, stability, events.
- `src/render` is three.js: procedural buildings drawn as instanced meshes with a window shader, a rounded-junction road mesh, viaducts, tram rails, piers, cable car pylons and stations, water and sky shaders, image-based lighting from the live sky, a day/night cycle, depth AO and tilt-shift in the post chain.
- `src/ui` is the HUD, tools and panels, written with plain DOM.
