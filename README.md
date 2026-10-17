# ViaMensa

A fullstack food logistics application built with **Next.js, React and TypeScript**. ViaMensa connects a geographic view of South Sudan with server-side route planning, stock allocation and disruption scenarios.

The interface uses a light theme: white surfaces, neutral typography and restrained green accents. MapLibre renders the map and animated delivery movements.

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
| Control tower | Three hubs, seven communities and fifteen schematic corridors on a light map. |
| Transport animation | Illustrative movements along delivery routes; pause and resume controls; reduced motion support. |
| Scenario planning | Presets and individual closures trigger server-side recalculation of routes, suppliers and stock. |
| Dispatch board | Search communities, filter deliveries needing attention and select a destination. |
| Delivery details | Supplier, route, allocation, travel estimate, remaining food and decision explanation. |
| Network insights | Delivery outcomes, remaining inventory and illustrative corridor exposure. |
| Export | Download the current dispatch plan as CSV. |
| Map fallback | Interactive SVG schematic when geographic rendering is unavailable; keyboard-accessible corridor controls. |

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
    dispatch-board.tsx       Searchable delivery list
    delivery-detail.tsx      Selected route and allocation
    insights.tsx             Outcomes, stock and corridor controls
    map/                     MapLibre, SVG fallback and geometry
  lib/
    data/network.ts          Demonstration dataset
    server/planning.ts       Routing, priority and stock allocation
    types.ts                 Shared domain and API types
tests/                       Planner and API tests
docs/                        Architecture, API and product reference
```

The supplied `index_lina.html`, `mock/` and `assets/` are design references. They are not application entry points or served by Next.js. The active application is entirely in `src/`.

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

This is a planning demonstration. Town coordinates are approximate. Corridors, travel times, risk values, populations, food insecurity phases, stocks and food quantities are synthetic. Map lines are schematic connections; moving markers are illustrations rather than vehicle telemetry.

The application does not currently include authentication, a database, live conflict/weather feeds or durable saved plans. Every request calculates a fresh scenario without changing another user's view. The farmer and NGO reference mock has separate data and is not connected to this API.

MapLibre is bundled with the application. Basemap tiles need internet access; the corridor model does not need an external routing service.

## Documentation

- [Architecture and planning rules](docs/ARCHITECTURE.md)
- [API contract and examples](docs/API.md)
- [Original farmer and NGO product plan](docs/PLAN.md) — historical reference

Implementation references: [Next.js](https://nextjs.org/docs/app), [Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) and [MapLibre](https://maplibre.org/maplibre-gl-js/docs/).
