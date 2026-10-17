# Frontend design and mapping

## Scope

The React presentation runs on the ViaMensa API (`backend/`). The public landing page is `/`, sign-in is `/login`, and the client workspace is `/app`. All data calls go through the same-origin proxy `/api/v1/*`, which attaches the session token from an httpOnly cookie: network and plan, itineraries, alerts and analysis, simulations and savings.

## Design direction

A night-operations control room, in the spirit of crisis and logistics dashboards: the map is the hero and everything else is a quiet instrument around it.

- **Colour.** Graphite surfaces (`#0b1013`, `#111a1e`, `#172128`) and a dark hillshaded basemap. Colour carries meaning only: route green `#18a874` for selected routes and on-plan deliveries, river blue `#3b85d8` for barge legs, amber `#b08c2b` for supplier changes and coral `#c43f33` for unreachable destinations and closed corridors. Hazard footprints use their own hues with a diagonal hatch. Text set in a status colour uses a lighter step so it clears 4.5:1 on panels. The four status colours pass the data-viz palette validator for colour-vision separation on both surfaces.
- **Type.** Archivo, one variable family with a width axis: normal width for text and readouts, an 84% narrow cut for compact labels, axis ticks, table headers and the event ticker. Big readouts use proportional figures; lists and axes use tabular figures. The font loads through `next/font` and falls back to the system sans.
- **Structure.** Hairlines and spacing carry hierarchy; corners are 4 to 6 px and panels are solid, not blurred glass. Panels float only over the map; the side column is a list, not a stack of cards. Icons are functional (status, transport mode, tools), not decoration on headings.
- **Motion.** Only motion that explains something: vehicles move along their legs on the shared clock; a dash pattern flows along the selected route from hub to community; a ring plays once when a community is selected; a sweep runs under the header while the server recalculates; the loading state draws a route. Everything respects reduced-motion preferences, and nothing animates box-shadows, blur or filters, which keeps the WebGL map smooth.

## Performance notes

- Map markers are created once per plan; selecting a delivery toggles a class instead of rebuilding them, and vehicles update every frame with a cheap transform.
- MapLibre sources update in separate effects (corridors and hazards, selected route, hover highlight) so a hover does not rewrite every source.
- No `backdrop-filter`, no `filter: drop-shadow` on moving elements, no box-shadow animations.
- Development mode runs React strict mode with double effects; judge smoothness on `npm run build && npm start`.
- A hydration warning that lists `bis_skin_checked` or `bis_register` attributes comes from a browser extension rewriting the DOM, not from the app. Test in an incognito window.

## Screen structure

The desktop layout is a fixed-viewport grid that does not scroll:

1. **Event ticker** (top). The latest operations event with a clock, plus a history popover of the session's events.
2. **Navigation rail** (left). Icon and label for the seven views: Tower, Route A→B, Alerts, Forecast, Playbook, Savings and Corridors. Views are deep-linkable with `/app#forecast` and similar.
3. **Header.** Wordmark, scenario selector with reset, live readouts (people connected, food allocated, deliveries on plan, deliveries needing attention), CSV export.
4. **Side column.** Changes with the view: the dispatch list and suppliers; the current closures (Route A→B, Alerts, Savings); risk assumptions, outlook and corridor exposure; reserves to hold per supplier; or the corridor access list.
5. **Map.** Always visible. Overlays: tools (fit, zoom, 3D terrain), the layer legend with toggles, the selected-delivery card, a corridor popover and, in the tower view, the journey inspector.
6. **Bottom strip.** Transport playback in the tower view, the delivery outlook chart in the forecast view and the fallback table in the playbook view. Hidden in the corridors view.
7. **Sheets.** Route A→B (itinerary planner), Alerts (news analysis → simulation → playbook) and Savings open as a scrollable sheet over the map; the map stays mounted underneath.

Below 1100px the shell becomes a scrolling page: ticker, horizontal view bar, header with wrapped readouts, the map at 62% of the viewport height, then the side-column content and the bottom strip.

## Map controls

| Control | Result |
| --- | --- |
| Select a delivery, community or vehicle | Highlights its geographic route with a glow and updates the journey inspector. |
| Selected-delivery card | Fits the map to that journey. |
| Click a corridor or closure marker | Opens a popover with a closure/reopen action. |
| Hover a corridor in the Corridors or exposure lists | Highlights that corridor on the map. |
| Fit | Restores the regional overview and flat view. |
| Routes | Shows or hides the background corridor layer. The selected route stays visible. |
| Risk areas | Shows hatched hazard footprints scaled by the assumed probability. Always on in the Forecast and Playbook views, where corridors are also coloured by closure probability with a scale in the legend. |
| 3D terrain | Loads terrain elevation and tilts the map; toggling restores the flat view. |
| Playback | Pauses, restarts, changes speed or scrubs the shared simulation clock. |

Trucks and barges follow the cached path in each delivery leg. Animation is time-weighted using the existing illustrative corridor hours; departures are staggered for readability. The transport strip shows every delivery as its legs (road green, river blue), lit progressively as the clock advances. Reduced-motion preferences disable autoplay and the selection pulse; the time slider remains usable.

## Component boundaries

- `dashboard.tsx`: active view, scenario, selection, API request lifecycle, export, event log, deep links, and the three view-dependent regions (side column, map overlays, bottom strip).
- `model/display-network.ts`: maps API corridors (OpenStreetMap geometry, mode, distance) to the display model, computes each corridor's exposure to the scenario hazard areas from its geometry, and hides port transfers. It preserves the API's supplier and path decisions.
- `map/basemap.ts`: derives the night basemap from the cached Positron style, repainting every layer and adding the Natural Earth relief raster as a dark hillshade.
- `map/network-map.tsx`: MapLibre lifecycle, vector layers (glowing selected route, baseline path, hatched hazards, risk-coloured corridors, hover highlight), geographic markers and shared-clock transport animation. Accepts the active view, forecast road risks, a highlighted corridor and overlay children.
- `map/geometry.ts`: distance-weighted path interpolation, bearings, hazard circles, the hatch tile generator and vehicle icons.
- `map/schematic-map.tsx`: geographic SVG fallback if MapLibre initialization fails.
- `transport-timeline.tsx`: playback controls, time scrubber and per-delivery leg tracks.
- `model/simulation.ts`: sends the forecast assumptions to `POST /v1/simulations` (correlated server model) and maps the response to the forecast and playbook views.
- `itinerary-panel.tsx`, `risk-panel.tsx`, `impact-panel.tsx`: the Route A→B, Alerts and Savings sheets.
- `forecast-workspace.tsx`: `ForecastControls` (assumptions, outlook, corridor exposure), `OutlookChart` (stacked outcome bars), `PlaybookReserves` and `PlaybookTable`.
- `lib/presentation.ts`: the shared palette, status metadata and number formatting used by both CSS-free map code and React components.

## Geographic sources

| Asset | Source and use |
| --- | --- |
| `src/lib/data/map-style.json` | Complete [OpenFreeMap Positron](https://openfreemap.org/quick_start/) vector style, cached locally and repainted at runtime; tiles, glyphs and sprites load over the network. |
| Corridor geometry | Served by the API (`GET /v1/network`). Built by `backend/scripts/build_network.py`: road shapes from OSRM on OpenStreetMap, White Nile, Sobat and Bahr el Zeraf river lines from OpenStreetMap via Overpass. |
| `src/lib/data/south-sudan.json` | South Sudan boundary from [Natural Earth](https://www.naturalearthdata.com/), drawn as a soft glowing outline. |
| Natural Earth shaded relief | Raster tiles referenced by the cached style, filtered dark for the hillshade texture. |
| Optional elevation | Public Mapzen Terrarium tiles on the AWS elevation dataset. |

The map displays attribution. OpenStreetMap data is available under the ODbL; preserve the data attribution when reusing cached geometry. Contributions and corrections can be made through [OpenStreetMap](https://www.openstreetmap.org/). Routing shapes were fetched during development, so the dashboard does not repeatedly call public routing services.

Unit costs are published rates and speeds are labelled estimates (`GET /v1/assumptions`); warehouses and caseloads are demo client inputs.

## Forecast interpretation

The sliders are the planner's 72-hour probabilities for three scenario areas; shorter horizons scale survival by the horizon ratio. The server runs the correlated disruption model: areas can co-occur, corridors inside an area fail together, and consequences depend on the hazard and the road surface. Every future is re-planned (reroute, supplier switch or airlift), and identical futures are solved once. Explicitly closed corridors stay closed. For issues extracted from news and field reports, use **Alerts**.

The playbook reports the most frequent contingency per community, the corridor that most often triggered it, and the 90th percentile of fallback demand per supplier. These are planning figures; they do not place orders.

## Verification

```bash
npm run check
npm run build
```

For visual checks: select a delivery, close a corridor, inspect the changed path and the dashed planned route, pause and scrub transport, toggle risk and terrain layers, run the forecast and watch corridors recolour, open the playbook, and inspect the layout below 1100px. The corridor list provides keyboard-accessible closure actions alongside the map.
