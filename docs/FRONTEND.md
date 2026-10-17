# Frontend design and mapping

## Scope

This redesign changes the React presentation, map styling and browser interactions. Existing route handlers, server planning rules and shared API types are unchanged. The application still consumes its existing `POST /api/plan` response when a corridor is closed or reopened.

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
2. **Navigation rail** (left). Icon and label for the four views: Tower, Forecast, Playbook, Corridors. Views are deep-linkable with `/#forecast` and similar.
3. **Header.** Wordmark, scenario selector with reset, live readouts (people connected, food allocated, deliveries on plan, deliveries needing attention), CSV export.
4. **Side column.** Changes with the view: the dispatch list and supply reserves; risk assumptions, outlook and corridor exposure; reserves to hold per hub; or the corridor access list.
5. **Map.** Always visible. Overlays: tools (fit, zoom, 3D terrain), the layer legend with toggles, the selected-delivery card, a corridor popover and, in the tower view, the journey inspector.
6. **Bottom strip.** Transport playback in the tower view, the delivery outlook chart in the forecast view and the fallback table in the playbook view. Hidden in the corridors view.

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
- `model/display-network.ts`: enriches API results with frontend geometry, transport modes and illustrative hazards. It preserves the API's supplier and path decisions.
- `map/basemap.ts`: derives the night basemap from the cached Positron style, repainting every layer and adding the Natural Earth relief raster as a dark hillshade.
- `map/network-map.tsx`: MapLibre lifecycle, vector layers (glowing selected route, baseline path, hatched hazards, risk-coloured corridors, hover highlight), geographic markers and shared-clock transport animation. Accepts the active view, forecast road risks, a highlighted corridor and overlay children.
- `map/geometry.ts`: distance-weighted path interpolation, bearings, hazard circles, the hatch tile generator and vehicle icons.
- `map/schematic-map.tsx`: geographic SVG fallback if MapLibre initialization fails.
- `transport-timeline.tsx`: playback controls, time scrubber and per-delivery leg tracks.
- `model/simulation.ts`: deterministic, browser-only hypothetical scenario sampler. Work is chunked to keep inputs responsive and supports cancellation.
- `forecast-workspace.tsx`: `ForecastControls` (assumptions, outlook, corridor exposure), `OutlookChart` (stacked outcome bars), `PlaybookReserves` and `PlaybookTable`.
- `lib/presentation.ts`: the shared palette, status metadata and number formatting used by both CSS-free map code and React components.

## Geographic sources

| Asset | Source and use |
| --- | --- |
| `src/lib/data/map-style.json` | Complete [OpenFreeMap Positron](https://openfreemap.org/quick_start/) vector style, cached locally and repainted at runtime; tiles, glyphs and sprites load over the network. |
| `src/lib/data/corridor-geometry.json` | Road shapes from [OSRM / FOSSGIS](https://routing.openstreetmap.de/about.html), based on OpenStreetMap. White Nile and tributary waterway shapes from OpenStreetMap via Overpass. Retrieved 17 October 2026; each corridor records its source. |
| `src/lib/data/south-sudan.json` | South Sudan boundary from [Natural Earth](https://www.naturalearthdata.com/), drawn as a soft glowing outline. |
| Natural Earth shaded relief | Raster tiles referenced by the cached style, filtered dark for the hillshade texture. |
| Optional elevation | Public Mapzen Terrarium tiles on the AWS elevation dataset. |

The map displays attribution. OpenStreetMap data is available under the ODbL; preserve the data attribution when reusing cached geometry. Contributions and corrections can be made through [OpenStreetMap](https://www.openstreetmap.org/). Routing shapes were fetched during development, so the dashboard does not repeatedly call public routing services.

River paths include illustrative terminal connections. Transport modes, timings and suitability are demonstration assumptions, not a verified logistics network.

## Forecast interpretation

For each corridor, the browser combines hazard probability and synthetic exposure. The 72-hour survival probability is the product of each hazard's survival contribution; shorter horizons scale that survival probability by the horizon ratio. Explicitly closed corridors remain closed.

The simulation samples 2,000 independent corridor-failure sets and explores reachability, fallback supply and available stock. It follows the existing plan's priority order and keeps a planned supplier when reachable with sufficient stock. It is a presentation preview, separate from the authoritative dispatch response. Equal-cost route ties may differ from the server's Dijkstra implementation.

The playbook reports observed contingencies, a frequently co-occurring baseline closure and the 90th percentile of extra fallback demand per hub. Those figures are illustrative; they do not place orders or persist plans.

## Verification

```bash
npm run check
npm run build
```

For visual checks: select a delivery, close a corridor, inspect the changed path and the dashed planned route, pause and scrub transport, toggle risk and terrain layers, run the forecast and watch corridors recolour, open the playbook, and inspect the layout below 1100px. The corridor list provides keyboard-accessible closure actions alongside the map.
