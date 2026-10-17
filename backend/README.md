# ViaMensa API

FastAPI service: routing engine, correlated Monte Carlo, LLM alert analysis, savings, auth. See `../docs/ARCHITECTURE.md` and `../docs/API.md`.

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8000   # SQLite at ./viamensa.db, demo user seeded
uv run pytest                                      # 50 tests; never calls a real LLM
uv run ruff check app tests scripts
uv run python scripts/build_network.py             # rebuild the seed network from OpenStreetMap (cached)
```

Configuration (env, prefix `VIAMENSA_`): `DATABASE_URL`, `JWT_SECRET` (required in production), `CORS_ORIGINS` (JSON list), `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, `MAX_SIMULATION_RUNS`, `ANTHROPIC_MODEL`; plus `ANTHROPIC_API_KEY` (optional).

| Path | Contents |
| --- | --- |
| `app/engine/` | network model, routing (bidirectional A*, reverse Dijkstra, Yen, components), planner, risk model, simulation, impact, assumptions with sources |
| `app/intel/` | Claude analyzer (structured output, network-pinned enums) and rule-based fallback |
| `app/api/` | routes, schemas, auth and tenant dependencies |
| `app/db/` | models, session, bootstrap (migrations under advisory lock + idempotent seed) |
| `app/seed/` | South Sudan network (OSM geometry), scenarios, sample alerts (labelled illustrative) |
