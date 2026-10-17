"""Monte Carlo over correlated disruption scenarios.

For each sampled future the planner finds the best option for each target delivery. Futures that produce the same
network state (same closures and multipliers on the affected corridors) are solved once and memoised; with a few
dozen exposed corridors most of thousands of runs hit the cache, which is what makes 10k+ runs interactive.

Outputs per target: distribution of outcomes (on-plan / rerouted / supplier-changed / airlift), cost and time
distributions, the most frequent fallback plans, a robust Plan B ranked across all futures, and a deterministic
playbook ("if hazard X happens, do Y").
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np

from .planner import NetworkState, Planner, arrays_from_corridor_state, build_route, explain, objective_weights
from .risk import Hazard, expected_outcome, sample_states
from .routing import components, yen_k_shortest

STATUSES = ("on-plan", "rerouted", "supplier-changed", "airlift")


@dataclass
class Outcome:
    status: str
    kind: str
    supplier: str
    signature: str
    cost_per_t: float
    hours: float


@dataclass
class TargetSummary:
    origin: str
    destination: str
    tonnes: float
    people: int
    status_share: dict[str, float]
    p_baseline_blocked: float
    cost_per_t: dict[str, float]
    hours: dict[str, float]
    baseline_cost_per_t: float | None
    baseline_hours: float | None
    top_plans: list[dict]
    expected_savings: dict[str, float]
    top_trigger: str | None = None


@dataclass
class SimulationResult:
    runs: int
    seed: int
    objective: str
    unique_states: int
    elapsed_ms: float
    p_network_split: float
    hazard_occurrence: dict[str, float]
    corridor_closure: dict[str, float]
    targets: list[TargetSummary]
    plan_b: list[dict] = field(default_factory=list)
    playbook: list[dict] = field(default_factory=list)
    p_any_disruption: float = 0.0
    expected_people_connected: float = 0.0
    suppliers: list[dict] = field(default_factory=list)


def _quantiles(x: np.ndarray) -> dict[str, float]:
    if x.size == 0:
        return {"mean": 0.0, "p50": 0.0, "p90": 0.0}
    return {"mean": float(x.mean()), "p50": float(np.percentile(x, 50)), "p90": float(np.percentile(x, 90))}


def run_simulation(planner: Planner, hazards: list[Hazard], *, runs: int = 2000, seed: int = 7,
                   objective: str = "cost", base: NetworkState | None = None,
                   targets: list[tuple[str, str]] | None = None) -> SimulationResult:
    net = planner.net
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    base = base or NetworkState()
    base_blocked, _, _, base_closed = base.arrays(net)
    down = {net.node_ix[n] for n in base.down_nodes}
    if targets is None:
        targets = [(planner.primary_supplier[net.nodes[c].id], net.nodes[c].id) for c in net.communities
                   if net.nodes[c].id in planner.primary_supplier]
    tix = [(net.node_ix[o], net.node_ix[d]) for o, d in targets]

    states = sample_states(net, hazards, runs, rng)
    closed = states.closed | base_closed[None, :]
    tm, cm = states.time_mult, states.cost_mult
    for cid, m in base.time_mult.items():
        tm[:, net.corr_ix[cid]] = np.maximum(tm[:, net.corr_ix[cid]], m)
    for cid, m in base.cost_mult.items():
        cm[:, net.corr_ix[cid]] = np.maximum(cm[:, net.corr_ix[cid]], m)

    affected = np.nonzero(closed.any(axis=0) | (tm != 1).any(axis=0) | (cm != 1).any(axis=0))[0]
    cache: dict[bytes, tuple[list[Outcome], int]] = {}
    outcomes: list[list[Outcome]] = []
    n_comp_rel = np.zeros(runs, dtype=np.int64)
    relevant = set(net.suppliers) | set(net.communities)

    for r in range(runs):
        key = closed[r, affected].tobytes() + tm[r, affected].tobytes() + cm[r, affected].tobytes()
        hit = cache.get(key)
        if hit is None:
            blocked, hours, cost = arrays_from_corridor_state(net, closed[r], tm[r], cm[r])
            wl = objective_weights(objective, hours, cost).tolist()
            bl = blocked.tolist()
            row = [Outcome(*planner.best_fast(o, d, bl, wl, hours, cost, down, objective)) for o, d in tix]
            labels = components(net, closed[r], down)
            n_rel = len({labels[i] for i in relevant if i not in down})
            hit = (row, n_rel)
            cache[key] = hit
        outcomes.append(hit[0])
        n_comp_rel[r] = hit[1]

    base_rel = len({components(net, base_closed, down)[i] for i in relevant if i not in down})
    summaries = [_summarise(planner, i, targets[i], outcomes, closed, states, hazards, objective)
                 for i in range(len(targets))]

    # Network-level aggregates: any delivery off-plan, people still reached by land/river, fallback load per supplier.
    any_dis = np.array([any(x.status != "on-plan" for x in row) for row in outcomes])
    people = np.array([net.nodes[d].caseload for _, d in tix], dtype=float)
    tonnes = np.array([net.params.tonnes_for(net.nodes[d].caseload) for _, d in tix])
    land = np.array([[x.kind != "airlift" for x in row] for row in outcomes], dtype=bool)
    sup_rows = []
    for sidx in net.suppliers:
        sid = net.nodes[sidx].id
        fb = np.array([[x.status == "supplier-changed" and x.supplier == sid for x in row] for row in outcomes], dtype=bool)
        load = (fb * tonnes[None, :]).sum(axis=1)
        sup_rows.append({"supplier": sid, "fallbackProbability": float((load > 0).mean()),
                         "expectedFallbackTonnes": float(load.mean()), "p90FallbackTonnes": float(np.percentile(load, 90))})

    result = SimulationResult(
        runs=runs, seed=seed, objective=objective, unique_states=len(cache),
        elapsed_ms=0.0, p_network_split=float((n_comp_rel > max(1, base_rel)).mean()),
        hazard_occurrence={hz.id: float(states.occurred[:, k].mean()) for k, hz in enumerate(hazards)},
        corridor_closure={net.corridors[k].id: float(closed[:, k].mean()) for k in affected if closed[:, k].any()},
        targets=summaries,
        p_any_disruption=float(any_dis.mean()),
        expected_people_connected=float((land * people[None, :]).sum(axis=1).mean()),
        suppliers=sup_rows,
    )
    if len(targets) == 1:
        o, d = targets[0]
        result.plan_b = robust_plan_b(planner, o, d, closed, tm, cm, objective=objective)
    result.playbook = playbook(planner, hazards, targets, objective=objective, base=base)
    result.elapsed_ms = (time.perf_counter() - t0) * 1000
    return result


def _summarise(planner: Planner, i: int, target: tuple[str, str], outcomes: list[list[Outcome]], closed: np.ndarray,
               states, hazards: list[Hazard], objective: str) -> TargetSummary:
    net = planner.net
    o_id, d_id = target
    o, d = net.node_ix[o_id], net.node_ix[d_id]
    runs = len(outcomes)
    col = [row[i] for row in outcomes]
    counts = Counter(x.status for x in col)
    costs = np.array([x.cost_per_t for x in col])
    hours = np.array([x.hours for x in col])
    base = planner.baseline(o, d, objective)
    people = net.nodes[d].caseload
    tonnes = net.params.tonnes_for(people)

    blocked_base = np.zeros(runs, dtype=bool)
    if base is not None:
        ci = [net.corr_ix[c] for c in base.corridors]
        blocked_base = closed[:, ci].any(axis=1)

    plans: dict[str, list[Outcome]] = defaultdict(list)
    for x in col:
        plans[x.signature].append(x)
    top = []
    for sig, xs in sorted(plans.items(), key=lambda kv: -len(kv[1]))[:5]:
        first = xs[0]
        entry = {"signature": sig, "kind": first.kind, "status": first.status, "supplier": first.supplier,
                 "share": len(xs) / runs, "costPerT": float(np.mean([x.cost_per_t for x in xs])),
                 "hours": float(np.mean([x.hours for x in xs])),
                 "corridors": [] if sig == "air" else sig.split("|")}
        top.append(entry)

    # Savings vs "no pre-computed fallback": when the planned route is cut, operations default to an emergency
    # airlift (WFP's last resort) or to waiting for the road to reopen.
    air = net.params.air_cost_per_t
    disrupted = blocked_base
    land_fallback = disrupted & np.array([x.kind != "airlift" for x in col])
    saved_vs_air = np.where(land_fallback, (air - costs) * tonnes, 0.0)
    durations = np.zeros(runs)
    if base is not None and hazards:
        ci = [net.corr_ix[c] for c in base.corridors]
        for k, hz in enumerate(hazards):
            hits_route = states.closed[:, ci].any(axis=1) & states.occurred[:, k]
            dur = hz.duration_days or hz.consequence.duration_days
            durations = np.where(hits_route, np.maximum(durations, dur), durations)
    fallback_days = hours / 24.0
    gap_avoided = np.where(land_fallback, np.maximum(0.0, durations - fallback_days) * people, 0.0)

    trigger = None
    if base is not None:
        off = np.array([x.status != "on-plan" for x in col])
        ci = [net.corr_ix[c] for c in base.corridors]
        counts_c = closed[off][:, ci].sum(axis=0) if off.any() else np.zeros(len(ci))
        if counts_c.size and counts_c.max() > 0:
            trigger = base.corridors[int(np.argmax(counts_c))]

    return TargetSummary(
        origin=o_id, destination=d_id, tonnes=tonnes, people=people, top_trigger=trigger,
        status_share={s: counts.get(s, 0) / runs for s in STATUSES},
        p_baseline_blocked=float(blocked_base.mean()),
        cost_per_t=_quantiles(costs), hours=_quantiles(hours),
        baseline_cost_per_t=base.cost_per_t if base else None, baseline_hours=base.hours if base else None,
        top_plans=top,
        expected_savings={
            "usdVsAirlift": float(saved_vs_air.mean()),
            "peopleDaysVsWaiting": float(gap_avoided.mean()),
            "pLandFallbackWhenCut": float(land_fallback.sum() / max(1, disrupted.sum())),
        },
    )


def robust_plan_b(planner: Planner, origin: str, destination: str, closed: np.ndarray, tm: np.ndarray,
                  cm: np.ndarray, *, objective: str = "cost", k: int = 3) -> list[dict]:
    """Rank pre-committable routes (k-shortest per supplier on the intact network) across all sampled futures.

    For each candidate: P(route stays open), mean cost/time when open, and expected cost if the operator commits
    to it and falls back to an airlift whenever it is cut. Vectorised over runs.
    """
    net = planner.net
    d = net.node_ix[destination]
    w = objective_weights(objective, net.arc_hours, net.arc_cost).tolist()
    air = net.params.air_cost_per_t
    base = planner.baseline(net.node_ix[origin], d, objective)
    candidates = []
    for s in net.suppliers:
        for _, arcs in yen_k_shortest(net, w, s, d, k):
            candidates.append(build_route(net, arcs, net.arc_hours, net.arc_cost))
    rows = []
    for route in candidates:
        ci = np.array([net.corr_ix[c] for c in route.corridors])
        arc_ix = np.array(route.arcs)
        ok = ~closed[:, ci].any(axis=1)
        cost_r = (net.arc_cost[arc_ix][None, :] * cm[:, ci]).sum(axis=1)
        hours_r = (net.arc_hours[arc_ix][None, :] * tm[:, ci]).sum(axis=1)
        p_ok = float(ok.mean())
        exp_cost = float(np.where(ok, cost_r, air).mean())
        rows.append({
            "supplier": route.supplier, "corridors": route.corridors, "nodes": route.nodes, "modes": route.modes,
            "km": route.km, "isPlanA": base is not None and route.signature == base.signature,
            "pOpen": p_ok,
            "costPerTIfOpen": float(cost_r[ok].mean()) if ok.any() else None,
            "hoursIfOpen": float(hours_r[ok].mean()) if ok.any() else None,
            "expectedCostPerT": exp_cost,
        })
    rows.sort(key=lambda r: (r["expectedCostPerT"], -r["pOpen"]))
    return rows[:6]


def playbook(planner: Planner, hazards: list[Hazard], targets: list[tuple[str, str]], *, objective: str,
             base: NetworkState) -> list[dict]:
    net = planner.net
    out = []
    # Only report what each issue changes relative to the current state (manual closures already applied).
    before = {(o, d): planner.plan(o, d, base, objective=objective) for o, d in targets}
    for hz in hazards:
        closed, tm, cm = expected_outcome(net, hz)
        state = NetworkState(closed=set(base.closed) | closed,
                             time_mult={**base.time_mult, **tm}, cost_mult={**base.cost_mult, **cm},
                             down_nodes=set(base.down_nodes))
        actions = []
        for o, d in targets:
            res = planner.plan(o, d, state, objective=objective)
            prev = before[(o, d)]
            same_plan = (res.best.kind, res.best.supplier, res.best.route.signature if res.best.route else "air") == \
                (prev.best.kind, prev.best.supplier, prev.best.route.signature if prev.best.route else "air")
            if res.status == "on-plan" or (same_plan and abs(res.best.cost_per_t - prev.best.cost_per_t) < 0.5):
                continue
            b = res.best
            actions.append({
                "origin": o, "destination": d, "status": res.status, "supplier": b.supplier, "kind": b.kind,
                "costPerT": b.cost_per_t, "hours": b.hours,
                "baselineCostPerT": res.baseline.cost_per_t if res.baseline else None,
                "corridors": b.route.corridors if b.route else [], "explanation": explain(net, res),
            })
        out.append({"hazardId": hz.id, "title": hz.title, "kind": hz.kind, "probability": hz.probability,
                    "closes": sorted(closed), "degrades": sorted(tm), "actions": actions})
    return out
