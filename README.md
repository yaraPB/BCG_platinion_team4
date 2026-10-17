# ViaMensa

> ViaMensa	Latin	Via (road) + Mensa (table). A road to every table

A fullstack food logistics application built with **Next.js, React and TypeScript**. ViaMensa connects a geographic view of South Sudan with server-side route planning, stock allocation and disruption scenarios.

The interface uses a light theme: white surfaces, neutral typography and restrained green accents. MapLibre renders a detailed South Sudan map, geographic road and river paths, and animated trucks and barges. The frontend redesign preserves the existing planning API and server logic.

## Quick start

**Requirements:** Node.js 20.9+ and npm. Node.js 22 or 24 LTS is recommended.

```bash
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). No environment variables, API keys, Python installation or launcher scripts are required.

For a production build:

```bash
npm run build
npm start
```

Use `npm run dev -- --port 3001` to change the port.

## Features

| Area | Behavior |
| --- | --- |
| Control tower | Three hubs, seven communities and fifteen geographic corridors on a light OpenFreeMap basemap. |
| Transport animation | Trucks and barges follow cached road and river geometry, synchronized with a scrubber, pause, restart and playback speed controls. |
| Scenario planning | Presets and individual closures trigger server-side recalculation of routes, suppliers and stock. |
| Dispatch board | Search communities, filter deliveries needing attention and select a destination. |
| Delivery details | Supplier, route, allocation, travel estimate, remaining food and decision explanation. |
| Risk forecast | Browser-only simulation of 2,000 hypothetical scenarios with adjustable probabilities and a 24/48/72-hour horizon. |
| Fallback playbook | Community contingencies and indicative reserve requirements derived from the simulation. |
| Map layers | Road/river routes, illustrative risk areas, optional terrain, selected-route focus and corridor inspection. |
| Export | Download the current dispatch plan as CSV. |
| Map fallback | Interactive SVG using the same geographic paths when MapLibre cannot load; keyboard-accessible corridor controls. |

## Stack and structure

| Layer | Implementation |
| --- | --- |
| Frontend | React components, TypeScript and responsive CSS |
| Framework | Next.js App Router |
| Backend | Next.js Route Handlers and a server-side TypeScript planning service |
| Map | MapLibre GL JS with a light OpenFreeMap vector basemap and OpenStreetMap attribution |
| Data | Typed synthetic fixtures; stateless scenario calculations |
| Verification | ESLint, TypeScript and the Node test runner through `tsx` |

```text
src/
  app/
    api/network/route.ts      Network endpoint
    api/plan/route.ts         Baseline and recalculation endpoints
    globals.css              Light theme and responsive layout
    layout.tsx               Root layout and metadata
    page.tsx                 Server-rendered initial plan
  components/
    dashboard.tsx            Scenario state and API requests
    transport-timeline.tsx   Shared playback clock and journey timelines
    forecast-workspace.tsx   Risk inputs, outcome charts and playbook
    model/                   Frontend geometry adapter and browser simulation
    map/                     MapLibre, SVG fallback and transport geometry
  lib/
    data/network.ts          Demonstration dataset
    server/planning.ts       Routing, priority and stock allocation
    types.ts                 Shared domain and API types
tests/                       Planner and API tests
docs/                        Architecture, API and product reference
```

The supplied `index_lina.html`, `reroute-demo/` and `assets/` are design references. They are not application entry points or served by Next.js. The active application is entirely in `src/`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | Code conventions and React rules |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Routing, stock, priority and API validation tests |
| `npm run check` | Lint, type checking and tests |

Commit `package-lock.json` and use `npm ci` for reproducible installs. Generated files, dependencies and local caches are excluded through `.gitignore`.

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/network` | Nodes, corridors and scenario presets |
| GET | `/api/plan` | Baseline dispatch plan |
| POST | `/api/plan` | Recalculate for closed corridor IDs |

Example request body:

```json
{ "closedRoads": ["juba-bor"] }
```

## Data boundaries

This is a planning demonstration. Town coordinates are approximate. Corridor availability, travel times, exposure assumptions, populations, food insecurity phases, stocks and food quantities are synthetic. Road geometry is cached from OpenStreetMap routing; the two river corridors follow cached OpenStreetMap waterway geometry. Geometry and displayed transport modes do not certify road access, navigability or travel time. Moving vehicles illustrate the plan and are not telemetry.

The risk forecast runs entirely in the browser. It samples independent corridor closures using adjustable, synthetic hazard exposure. It does not ingest weather or conflict reports and adds no server endpoint.

The application does not currently include authentication, a database, live conflict/weather feeds or durable saved plans. Every request calculates a fresh scenario without changing another user's view. The farmer and NGO reference mock has separate data and is not connected to this API.

MapLibre is bundled with the application. OpenFreeMap tiles, optional terrain tiles and Google Fonts need internet access; cached route geometry and the browser simulation need no external routing service or API key. System fonts provide a fallback. See [Frontend design and mapping](docs/FRONTEND.md) for sources, controls and component structure.

## Documentation

- [Architecture and planning rules](docs/ARCHITECTURE.md)
- [Frontend design and mapping](docs/FRONTEND.md)
- [API contract and examples](docs/API.md)
- [Original farmer and NGO product plan](docs/PLAN.md) — historical reference

Implementation references: [Next.js](https://nextjs.org/docs/app), [Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [MapLibre](https://maplibre.org/maplibre-gl-js/docs/).
