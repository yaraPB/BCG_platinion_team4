# API (v1)

Base URL: the API container (`https://<prefix>-api.<env-domain>` on Azure, `http://localhost:8000` locally). Interactive OpenAPI: `/docs`. Field names are camelCase. Errors: `{"detail": "..."}` with 400 / 401 / 404 / 413 / 422 / 429.

The web app calls these through its same-origin proxy (`/api/v1/...`), which adds the bearer token from the session cookie.

## Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/v1/auth/token` | `{email, password}` | `{accessToken, tokenType, expiresIn, tenant, user}` |
| GET | `/v1/me` | — | user and client |

All other `/v1` endpoints need `Authorization: Bearer <token>` and only see the signed-in client's data.

## Network and planning

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/network` | Nodes (hub, community, junction, port), corridors (mode, surface, km, hours, costPerTonne, geometry), scenarios |
| GET | `/v1/plan` | Baseline plan for every community (all corridors open) |
| POST | `/v1/plan` | `{closedRoads[], downNodes[], objective}` → plan under closures |
| POST | `/v1/itineraries` | `{origin, destination, closedRoads[], objective, tonnes?}` → best option and ranked alternatives |

`objective` is `cost` (default) or `time`. Each delivery or option carries `costPerTonne`, `hours`, `modes`, `path`/`nodes`, `roadIds`/`corridors`, and `coordinates` (road/river geometry for drawing).

Itinerary `status`: `on-plan`, `rerouted` (same supplier, detour), `supplier-changed` (another supplier is cheaper or the only one connected), `airlift` (nothing reaches by road or river). `split: true` means the closures disconnected the supplier from the destination; `destinationComponent` lists the nodes still connected to it.

The plan endpoint keeps the web types' shape: `status` is `unreachable` when only air delivery is left, with details in `airlift` and `fallback: "airlift"`.

## Alerts and analysis

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/alerts` | Client alerts (seed samples are flagged `isSample`) |
| POST | `/v1/alerts` | `{title, body, source?, url?, publishedAt?}` |
| DELETE | `/v1/alerts/{id}` | Remove an alert |
| POST | `/v1/alerts/analyze` | `{alertIds?, horizonDays?, useLlm?}` → ranked issues mapped to corridor/node IDs |
| GET | `/v1/analyses/latest`, `/v1/analyses/{id}` | Stored analyses |
| GET | `/v1/alerts/templates` | Breaking-news templates for demos and drills |
| POST | `/v1/alerts/simulate` | `{templateId?, closedRoads?, useLlm?}` → publishes a simulated alert, analyses it and returns an incident brief |
| POST | `/v1/demo/reset` | Deletes the simulated alerts |

Simulated alerts are stored with the source `Simulated newswire (demo)` and `isSample: true`, so they are never mistaken for real reports. The incident brief contains:
- `endangeredRoads`: closure probability per corridor from 2,000 correlated futures of the alert's issues, on top of `closedRoads`
- `predictedClosures`: corridors with a closure probability of at least 0.5
- `ifItHappens`: `closes` and `degrades` under each issue's most likely outcome
- `suggestions[]`: every delivery whose plan changes in that case, with `action` (`new_supplier`, `switch_supplier`, `reroute` or `airlift`), `newSupplier` (the supplier has never served that community in the plan), `untraveledCorridors` (legs that no current delivery uses), cost and time against the current plan, and `pRouteCut`

Each issue has `likelihood` (`very_likely` / `likely` / `possible` / `unlikely`), `severity`, the band `probability` used in simulation, `affectedCorridorIds`, `affectedNodeIds`, `durationDays`, `rationale` and `evidenceAlertIds`. `engine` is `claude` or `rules`; `engineNote` explains any fallback.

## Simulation

`POST /v1/simulations`

```json
{
  "analysisId": "…", "issueIds": ["issue-1", "issue-2"],
  "hazards": [{"title": "Jonglei floods", "kind": "flood", "likelihood": "likely", "corridorIds": ["bor-pibor"]}],
  "closedRoads": [], "runs": 5000, "seed": 42, "objective": "cost",
  "origin": "juba", "destination": "bor"
}
```

Give `analysisId` and/or `hazards`. Give `origin` and `destination` together for one itinerary, or omit both for every planned delivery. Response fields:
- `runs`, `uniqueStates`, `elapsedMs`, `pNetworkSplit`
- per hazard: `simulatedOccurrence`
- `corridorClosure` (probability per corridor)
- `targets[]`: `statusShare`, `pBaselineBlocked`, cost and time quantiles, `topPlans`, `expectedSavings`
- `planB[]` (single itinerary only)
- `playbook[]`: what each issue changes relative to the current closures
- `impact`, `modelNotes`

Runs are stored: `GET /v1/simulations`, `GET /v1/simulations/{id}`.

## Savings and assumptions

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/impact` | `{closedRoads[], closureDays}` → table per disrupted delivery (USD saved vs emergency airlift, extra USD vs plan, people-days protected vs waiting) with totals and the basis statement |
| GET | `/v1/assumptions` | Every unit rate (value, unit, sourced / estimate / client, source and URL), likelihood bands, hazard consequence parameters |

## Ops

`GET /healthz` (liveness), `GET /readyz` (database reachable).
