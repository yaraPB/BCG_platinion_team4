# Njia Logistics: Lifeline Engine demo

Single-file interactive demo (`index.html`, no build, no dependencies). Open it in any browser.

Concept: treat suppliers, delivery sites and junctions as a graph. When roads fail, the engine picks one of three tiers per site:

1. **Reroute.** Road closed but the graph is still connected: shortest alternate path from the same supplier (Dijkstra).
2. **Re-source.** The graph has split: find the connected component that contains the site and the nearest supplier inside it with stock.
3. **Airlift / escalate.** No supplier with stock is reachable by road.

Hazard alerts (flood, cyclone, conflict, landslide) give each road a failure probability per forecast horizon. A Monte Carlo run (2,000 sampled futures) re-plans the network for each future and produces recommended actions: pre-position stock, front-load deliveries, put airlift on standby.

## Demo script

1. Scenario 1 (bridge washout): western sites reroute.
2. Scenario 2 (river flood): network splits into two islands, western sites re-source from local depots.
3. Scenario 3 (flood + cyclone + unrest): port offline, Upper Mto isolated, airlift.
4. Horizon +48h, "Run 2,000 simulations", approve a recommendation.
5. Click any road to close it, any warehouse to take it offline.

## Editing the scenario

All network data lives in the `NODES`, `EDGES` and `HAZARDS` arrays in the `<script id="engine">` block. The company, map, stock and forecast figures are illustrative.
