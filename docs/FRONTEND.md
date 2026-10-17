# Frontend design and mapping

## Scope

The React presentation runs on the ViaMensa API (`backend/`). The public landing page is at `/`, sign-in at `/login`, and the client workspace at `/app`. All data calls go through the same-origin proxy `/api/v1/*`, which attaches the session token from an httpOnly cookie: network and plan, itineraries, alerts and analysis, simulations, savings.

## Screen structure

1. A compact navigation rail and workspace header.
2. Four operational metrics: people connected, food allocated, deliveries on plan and deliveries requiring attention.
3. Control tower, itinerary (A→B), alerts & AI (news analysis → simulation → playbook), risk forecast, fallback playbook, savings and corridor views.
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
- `model/display-network.ts`: maps API corridors (OpenStreetMap geometry, mode, distance) to the display model, computes exposure of each corridor to the scenario hazard areas geometrically, and hides port transfers. It preserves the API's supplier and path decisions.
- `map/network-map.tsx`: MapLibre lifecycle, vector layers, geographic markers and shared-clock transport animation.
- `map/geometry.ts`: distance-weighted path interpolation, bearings, hazard circles and vehicle icons.
- `map/schematic-map.tsx`: geographic SVG fallback if MapLibre initialization fails.
- `transport-timeline.tsx`: playback controls, time scrubber and delivery tracks.
- `model/simulation.ts`: sends the risk-forecast assumptions to `POST /v1/simulations` (correlated server model) and maps the response to the forecast and playbook views.
- `forecast-workspace.tsx`: assumption sliders, outcome charts, corridor exposure and fallback playbook.
- `itinerary-panel.tsx`, `risk-panel.tsx`, `impact-panel.tsx`: A→B planner, alert analysis plus simulation, and savings tables.

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

The sliders are the planner's 72-hour probabilities for three scenario areas. Shorter horizons scale survival by the horizon ratio. The server runs the correlated disruption model: areas can co-occur; corridors inside an area fail together, with consequences that depend on the hazard and road surface. Every future is re-planned (reroute, supplier switch or airlift), and identical futures are solved once. Explicitly closed corridors stay closed. For issues extracted from news and field reports, use **Alerts & AI**. The playbook shows the most frequent contingency per community, the corridor that most often triggered it, and the 90th-percentile fallback load per supplier.

## Verification

```bash
npm run check
npm run build
```

For visual checks: select a delivery, close a corridor, inspect the changed path, pause and scrub transport, toggle risk and terrain layers, run the forecast, and inspect the mobile layout. The corridor table provides keyboard-accessible closure actions alongside the map.
