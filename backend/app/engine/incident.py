"""Incident brief: from analysed news issues to endangered roads and concrete fallback suggestions.

1. Endangered roads: correlated Monte Carlo over the issues (on top of current closures) gives each corridor's
   probability of being closed.
2. If it happens: the issues' most likely outcome (corridors with closure probability >= 0.5 close, others degrade)
   is re-planned for every delivery.
3. Suggestions: every delivery whose plan changes gets the new best option, flagged when it uses a supplier that
   has never served that community in the plan, or corridors the current plan never travels.
"""

from __future__ import annotations

from dataclasses import dataclass

from .network import Network
from .planner import ItineraryResult, NetworkState, Planner, explain
from .risk import Hazard, expected_outcome
from .simulation import run_simulation


@dataclass
class Suggestion:
    destination: str
    name: str
    people: int
    tonnes: float
    action: str  # reroute | new_supplier | switch_supplier | airlift
    current_supplier: str | None
    suggested_supplier: str
    new_supplier: bool
    untraveled_corridors: list[str]
    modes: list[str]
    corridors: list[str]
    cost_per_t: float
    hours: float
    current_cost_per_t: float | None
    current_hours: float | None
    p_route_cut: float
    explanation: str


def _signature(r: ItineraryResult) -> tuple:
    b = r.best
    return (b.kind, b.supplier, b.route.signature if b.route else "air")


def incident_brief(planner: Planner, hazards: list[Hazard], base: NetworkState, *, runs: int = 2000,
                   seed: int = 11) -> dict:
    net: Network = planner.net
    sim = run_simulation(planner, hazards, runs=runs, seed=seed, base=base)
    endangered = sorted(
        ({"corridorId": cid, "name": net.corridor(cid).name, "mode": net.corridor(cid).mode, "pClosed": round(p, 3)}
         for cid, p in sim.corridor_closure.items() if cid not in base.closed and net.corridor(cid).mode != "transfer"),
        key=lambda x: -x["pClosed"],
    )
    predicted = [e["corridorId"] for e in endangered if e["pClosed"] >= 0.5]

    closed, tm, cm = set(base.closed), dict(base.time_mult), dict(base.cost_mult)
    for hz in hazards:
        c, t, m = expected_outcome(net, hz)
        closed |= c
        tm.update(t)
        cm.update(m)
    if_happens = NetworkState(closed=closed, time_mult=tm, cost_mult=cm, down_nodes=set(base.down_nodes))

    intact = planner.plan_network()
    served_before = {(r.best.supplier, r.destination) for r in intact if r.best.kind != "airlift"}
    current = {r.destination: r for r in planner.plan_network(base)}
    traveled = {c for r in current.values() if r.best.route for c in r.best.route.corridors}
    p_cut = {t.destination: t.p_baseline_blocked for t in sim.targets}

    suggestions: list[Suggestion] = []
    for r in planner.plan_network(if_happens):
        cur = current[r.destination]
        if _signature(r) == _signature(cur):
            continue
        b, node = r.best, net.node(r.destination)
        is_new = b.kind != "airlift" and (b.supplier, r.destination) not in served_before
        action = ("airlift" if b.kind == "airlift" else "new_supplier" if is_new
                  else "switch_supplier" if b.supplier != cur.best.supplier else "reroute")
        route_corridors = b.route.corridors if b.route else []
        suggestions.append(Suggestion(
            destination=r.destination, name=node.name, people=node.caseload, tonnes=round(r.tonnes, 1), action=action,
            current_supplier=cur.best.supplier if cur.best.kind != "airlift" else None, suggested_supplier=b.supplier,
            new_supplier=is_new,
            untraveled_corridors=[c for c in route_corridors if c not in traveled and net.corridor(c).mode != "transfer"],
            modes=b.route.modes if b.route else ["air"], corridors=route_corridors,
            cost_per_t=round(b.cost_per_t, 2), hours=round(b.hours, 1),
            current_cost_per_t=round(cur.best.cost_per_t, 2), current_hours=round(cur.best.hours, 1),
            p_route_cut=round(p_cut.get(r.destination, 0.0), 3), explanation=explain(net, r),
        ))
    order = {"new_supplier": 0, "switch_supplier": 1, "reroute": 2, "airlift": 3}
    suggestions.sort(key=lambda s: (order[s.action], -s.people))
    return {
        "endangeredRoads": endangered,
        "predictedClosures": predicted,
        "ifItHappens": {"closes": sorted(closed - set(base.closed)), "degrades": sorted(tm)},
        "suggestions": [s.__dict__ for s in suggestions],
        "simulation": {"runs": sim.runs, "uniqueStates": sim.unique_states, "elapsedMs": round(sim.elapsed_ms, 1),
                       "pNetworkSplit": sim.p_network_split, "pAnyDisruption": sim.p_any_disruption},
    }
