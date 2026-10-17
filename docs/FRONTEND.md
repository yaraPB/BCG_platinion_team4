# Frontend design and mapping

## Scope

This redesign changes the React presentation, map assets and browser interactions. Existing route handlers, server planning rules and shared API types are unchanged. The application still consumes its existing `POST /api/plan` response when a corridor is closed or reopened.

## Screen structure

1. A compact navigation rail and workspace header.
2. Four operational metrics: people connected, food allocated, deliveries on plan and deliveries requiring attention.
3. Control tower, risk forecast, fallback playbook and corridor views.
4. The control tower places the dispatch list alongside the geographic map, with transport playback underneath and selected-journey details below.
5. On narrow screens the map comes first, followed by playback, a two-column delivery list and journey details.

The theme is light throughout. White panels and quiet borders establish hierarchy; green identifies selected routes and positive states, blue distinguishes river transport, and warm colors indicate disruptions. Status labels also include icons and text.

## Map controls

| Control | Result |
| --- | --- |
| Select a delivery or community | Highlights its geographic route and updates journey details. |
| Selected-delivery card | Fits the map to that journey. |
| Click a corridor | Opens an inspection card with a closure/reopen action. |
| Fit network | Restores the regional overview. |
| Routes | Shows or hides the background corridor layer. The selected route remains visible. |
| Risk areas | Shows hypothetical hazard footprints and assumption percentages. |
| 3D terrain | Loads terrain elevation and tilts the map; toggling restores the flat view. |
| Playback | Pauses, restarts, changes speed or scrubs the shared simulation clock. |

Trucks and barges follow the cached path in each delivery leg. Animation is time-weighted using the existing illustrative corridor hours; departures are staggered for readability. Playback loops through a 48-hour demonstration. Reduced-motion preferences disable autoplay; the time slider remains usable.

## Component boundaries

- `dashboard.tsx`: selected view, scenario, delivery, API request lifecycle, export and event log.
- `model/display-network.ts`: enriches API results with frontend geometry, transport modes and illustrative hazards. It preserves the API's supplier and path decisions.
- `map/network-map.tsx`: MapLibre lifecycle, vector layers, geographic markers and shared-clock transport animation.
- `map/geometry.ts`: distance-weighted path interpolation, bearings, hazard circles and vehicle icons.
- `map/schematic-map.tsx`: geographic SVG fallback if MapLibre initialization fails.
- `transport-timeline.tsx`: playback controls, time scrubber and delivery tracks.
- `model/simulation.ts`: deterministic, browser-only hypothetical scenario sampler. Work is chunked to keep inputs responsive and supports cancellation.
- `forecast-workspace.tsx`: assumption sliders, outcome charts, corridor exposure and fallback playbook.

## Geographic sources

| Asset | Source and use |
| --- | --- |
| `src/lib/data/map-style.json` | Complete [OpenFreeMap Positron](https://openfreemap.org/quick_start/) vector style, cached locally; tiles, glyphs and sprites load over the network. |
| `src/lib/data/corridor-geometry.json` | Road shapes from [OSRM / FOSSGIS](https://routing.openstreetmap.de/about.html), based on OpenStreetMap. White Nile and tributary waterway shapes from OpenStreetMap via Overpass. Retrieved 17 October 2026; each corridor records its source. |
| `src/lib/data/south-sudan.json` | South Sudan boundary from [Natural Earth](https://www.naturalearthdata.com/), used as a subtle regional outline. |
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

For visual checks: select a delivery, close a corridor, inspect the changed path, pause and scrub transport, toggle risk and terrain layers, run the forecast, and inspect the mobile layout. The corridor table provides keyboard-accessible closure actions alongside the map.
