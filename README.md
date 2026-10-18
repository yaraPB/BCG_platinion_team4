# FoodBridge

> [Link to the website](https://viamensa-web.greenbay-6805cff2.germanywestcentral.azurecontainerapps.io/)

FoodBridge plans food deliveries from a client's suppliers to the communities it serves and keeps them moving when roads fail. When a corridor is cut (flood, conflict, accident, anything), it finds the cheapest next option: a detour from the same supplier, another supplier that can still reach the community (even when the network has split in two), the river, or air as a last resort. It reads news and field alerts, ranks the issues likely to disrupt the network, simulates them together, and prepares fallbacks before they are needed.

## Architecture

| Layer | Implementation | Folder |
| --- | --- | --- |
| Web | Next.js (App Router), React, MapLibre on OpenFreeMap tiles. Landing page, sign-in, client workspace. Server-side proxy keeps the token in an httpOnly cookie. | `src/` |
| API | FastAPI (Python 3.13): routing engine, correlated Monte Carlo, LLM alert analysis, savings tables, JWT auth, per-client data. | `backend/` |
| Data | PostgreSQL (Azure Flexible Server in production, SQLite for local dev/tests); Alembic migrations. | `backend/migrations` |
| Network | Real South Sudan towns, OpenStreetMap road geometry (OSRM) and Nile/Sobat river legs (Overpass), built by a script and committed. | `backend/scripts/build_network.py` |
| Infra | Docker images, Azure Container Apps + PostgreSQL + Key Vault + ACR + Log Analytics/App Insights (Bicep), GitHub Actions CI/CD. | `infra/`, `.github/` |

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md) (live OpenAPI at `/docs` on the API) · Frontend design: [docs/FRONTEND.md](docs/FRONTEND.md).

## Frontend

The workspace (`/app`) is a night-operations control room: the map is the hero and quiet glass panels sit around it. MapLibre renders South Sudan on a dark hillshaded basemap derived from the cached OpenFreeMap style, with the API's OpenStreetMap road and river paths, hatched hazard footprints and animated trucks and barges. Colour carries meaning only (route green, river blue, new-supplier amber, unreachable coral), and every status also has an icon and a label.

Views are deep-linkable: `/app#itinerary`, `/app#alerts`, `/app#forecast`, `/app#playbook`, `/app#savings`, `/app#corridors` (or `/app?view=forecast` for links that must survive redirects).

**Hydration warning in development?** If the console diff shows attributes such as `bis_skin_checked`, `bis_register` or `__processed_…`, a browser extension (Bitdefender's web protection injects these) is rewriting the page before React hydrates. Open the app in an incognito window or exclude `localhost` in the extension. For the smoothest experience, test a production build (`npm run build && npm start`).

## Run locally

**Option A: Docker** (full stack with Postgres)

```bash
docker compose up --build        # web http://localhost:3000, API http://localhost:8000/docs
```

**Option B: without Docker**

```bash
# API (Python via uv: https://docs.astral.sh/uv/)
cd backend && uv sync && uv run uvicorn app.main:app --port 8000
# Web (Node 20.9+)
npm ci && FoodBridge_API_URL=http://localhost:8000 npm run dev
```

Sign in with `demo@FoodBridge.app` / `winners` (local default; set `FoodBridge_DEMO_USER_PASSWORD` to change it).
Set `ANTHROPIC_API_KEY` for LLM alert analysis; without it the API uses the rule-based analyser.

## Deploy to Azure

```bash
az login
RESOURCE_GROUP=FoodBridge-rg LOCATION=westeurope ANTHROPIC_API_KEY=... ./infra/deploy.sh
```

The script provisions the platform, builds both images in Azure Container Registry (no local Docker needed), deploys the container apps and prints the URLs. Secrets are generated once and kept in Key Vault. CI/CD: `.github/workflows/deploy.yml` (OIDC).

## Checks

| Command | Purpose |
| --- | --- |
| `cd backend && uv run pytest` | Engine, risk model, analyser and API tests (routing verified against NetworkX) |
| `cd backend && uv run ruff check app tests scripts` | Python lint |
| `npm run check` | Web lint, type check, tests |
| `npm run build` | Production web build |

## Data and numbers

- Towns, roads and rivers are real (OpenStreetMap). Warehouses, caseloads and priorities are the demo client's inputs.
- Every unit cost has a published source (World Bank, AfDB, UNOPS, Logistics Cluster, WFP); planning estimates (truck/barge speeds, hazard consequence parameters, likelihood→probability bands) are labelled as estimates. All of it is served by `GET /v1/assumptions` and shown in the app.
- Sample alerts in the seed are illustrative and labelled as such; real reports can be pasted into the workspace.

`index_lina.html`, `reroute-demo/`, `mock/` and `docs/PLAN.md` are earlier design references and are not part of the application.
