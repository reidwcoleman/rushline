# Rushline

A city-management and transport-tycoon game. Real people with names, jobs, moods and families live in your city and all of them have to get somewhere. Build roads and avenues, move them by bus, tram, elevated metro, ferry and cable car, haul food, stone and goods by truck and freight rail, land planes at your own airport, and run it all as a company with books, loans, fares, vehicle wear and research. Keep three pressures (traffic, crowded stops, unhappy residents) from pushing the stability bar to zero.

The map is 64 by 64 tiles of land with a river, a lake and a coast, split into sixteen named neighbourhoods. You start with the middle four and buy the rest as the city grows.

Everything you see is generated in code: terrain, water, buildings, vehicles, people, windows, sky, sound. No image, model or audio files.

## Play

- Drag with the right mouse button to pan, scroll to zoom, `Q`/`E` to rotate, `R`/`F` to tilt.
- Tools `1`-`9`, `0` and `V`: inspect, street (`2`), avenue (`3`), transit line, park, arena, bulldoze, services (schools, clinics, airport), highway (`9`), junctions (`0`).
- **Roads**: streets and avenues give homes and shops their frontage. **Highways** (400 residents) are fast and sealed off: no buildings face them, and a highway only joins the streets at an **interchange**. Drag one across town and every street it crosses straight on goes under it on an overpass, with the deck rising on ramps either side; a street that ends at it, or a bend, becomes an interchange. Draw a street across a highway and it runs under. The junction tool (`0`, 150 residents) lights up every crossing it can change: **roundabouts** (cars circle the island and never wait for a light), **traffic signals** (actuated: a road keeps green while cars arrive, then gives way) and **interchanges** (turn an overpass or a highway tile beside a street into on and off ramps). Junctions without control have the most accidents. A highway beside homes lowers their land value.
- Transit (`4`, then People or Freight, then pick a vehicle with the chips, `4` again or `[` `]` to cycle):
  - **Bus** - cheap, uses the road, gets stuck in traffic.
  - **Tram** - rails in the road median, never stuck in traffic. Streets on its route become avenues. 150 residents.
  - **Ferry** - piers on the shoreline, boats sail the river and bay. 320 residents.
  - **Gondola** - cable cars fly straight over rivers and rooftops, up to 18 tiles a hop. 420 residents.
  - **Metro** - big elevated trains on their own track. 600 residents.
  - **Trucks** and **Freight rail** - haul cargo between farms, quarries, the factory, shops and the cargo terminal. 400 and 900 residents.
- Click to place stops, then `Enter` (or Finish line). Auto-stops fills in stops along long hops. People walk between nearby stops, so a bus can feed a metro.
- **The map** (`M`, or the small map in the corner): a paper map of the whole island with every neighbourhood named, locked ones hatched, roads, buildings, parks, transit lines and the part of the world your camera sees. Switch it to mood, traffic or land value, hover for what is where, click anywhere to fly there (a building opens its panel), or buy a neighbourhood from the list. Drag on the corner map to move the camera.
- **Look inside** (`I`, or Look inside on a home or a shop): the roof comes off and you see the rooms. Homes have a living room with a sofa and TV, a kitchen, a bedroom and a bathroom; flats show four households at once. Cafes, diners, bars, gyms, cinemas, offices and shops each have their own fittings. The people inside walk between the sofa, the table, the bed, the toilet and the shower according to what they need. Click one to pick them. `Esc` puts the roof back.
- **Citizens**: click any little person or car to meet them. Each has a name, age, traits, a household, a job and career ladder, seven needs (energy, hunger, bladder, hygiene, fun, social, comfort), five skills (cooking, fitness, logic, charisma, creativity) that grow with practice, a lifetime aspiration (friend to everyone, happy family, big shot, peak form, master chef, big thinker, free spirit), a mood, friends, and a thought. Picking someone opens the live panel at the bottom: a portrait with a mood gem, their household, and every need as a bar. Follow them around the city. `C` opens the town directory: news, people sorted by mood, and what residents are asking for. Families move in, kids go to school, people get promoted, retire and are born.
- **Direct their lives**: pick a citizen and use Do something: go home, go to work, eat out, have fun, hang out, work out, visit a friend, take their partner on a date, throw a party, or Send somewhere (click any building). Orders override their own plans until done, then they go back to their routine ("free will"). Citizens have a wish (find a job, make a friend, fall in love, get married, throw a party...) and moodlets that explain their mood: well rested, lonely, a lovely wedding, heartbroken.
- **Love and family**: friends become couples, go on dates, get engaged and married. Weddings and birthdays are real parties: friends walk to the house, the house glows pink and throws confetti. Married couples move in together and have children. People mourn a lost partner.
- **Lots** (`V`): place houses, apartments, shops, cafes, diners, bars, gyms, cinemas, offices and malls yourself, and rename the places you build.
- **Freight**: farms make food, quarries dig stone, the factory turns stone into goods, shops sell food and goods, and the terminal exports everything. Cargo piles up at the industry until a truck or train takes it. Industries that get collected from grow. Shops that run dry buy imports, which costs money.
- **Company** (`B`): books, a two-week cash chart, loans, maintenance level, profit per line, fleet condition with renewals, a research lab that gives each vehicle type four generations, and contracts that pay cash. Every line has a ticket price: cheaper fares fill vehicles, dearer ones earn more per rider.
- Vehicles wear out. Worn ones break down and block the way, so keep them serviced or renew them.
- **Airport** (Services, 2,200 residents): a three by two tile block with a runway, terminal and tower. Planes come in, park at a gate and take off again, and every flight pays.
- The advisor (top right) offers one-click fixes: add a vehicle, widen a street, build a line, connect a farm. Auto-fleet buys vehicles for crowded lines. Both can be switched off in the pause menu. Relaxed difficulty is the default.
- `G` traffic view, `T` transit view, `H` mood view, `M` map, `I` look inside, `C` citizens, `B` company, `L` lines, `P` policies, `Space` pause, `+`/`-` speed, `U` hide the interface, `Shift+M` mute.

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
node --experimental-transform-types tools/citizens.ts 3 3 5 # needs, moods, households and the town feed over a few days
node --experimental-transform-types tools/freighttest.ts 3 3 # builds freight lines between the starting industries
node --experimental-transform-types tools/roundtrip.ts 4    # save and restore of citizens, industries, airport and finance
node --experimental-transform-types tools/roadtest.ts 4 top-rab   # highway, overpasses, signals and roundabouts: routing, driving, save and load
node tools/roadui.mjs                               # the road tools with real keys and mouse drags
node tools/v6ui.mjs                                 # the map, live panel and look-inside with real clicks
node tools/fps.mjs                                  # frame rate per quality level
```

## How it is built

- `src/sim` is plain TypeScript with no rendering: map and terrain, car-following traffic with junction yielding, signals, roundabouts and grade-separated highways (an overpass is a straight-through jump in the router), seven vehicle types (one table in `modes.ts`), the multimodal trip planner with walking transfers, the advisor, citizens (`people.ts`: names, traits, needs, careers, households, aging) and their daily schedules, industry and cargo (`industry.ts`), vehicle wear and breakdowns, company books, loans, research and contracts, growth and upgrades, economy, stability, events.
- `src/render` is three.js (citizens, planes, trucks and trains included): procedural buildings drawn as instanced meshes with a window shader, a rounded-junction road mesh, viaducts, tram rails, piers, cable car pylons and stations, water and sky shaders, image-based lighting from the live sky, a day/night cycle, depth AO and tilt-shift in the post chain.
- `src/ui` is the HUD, tools and panels, written with plain DOM.
