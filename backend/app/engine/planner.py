"""Itinerary planning under a network state (closures, delays, surcharges).

For a delivery A -> B the planner returns ranked options:
- planned:          same supplier, same route as the intact-network plan
- reroute:          same supplier A, different route (bidirectional A*)
- switch_supplier:  another supplier D that can still reach B (reverse Dijkstra from B covers all suppliers at once)
- airlift:          air delivery from the nearest air-capable supplier (last resort)

Options are ranked by the objective (cost per tonne, or hours) so the cheapest viable plan wins, whether that is a
detour from A or a switch to D.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .network import Network
from .routing import INF, bidirectional_astar, components, dijkstra, path_from_reverse

OBJECTIVES = ("cost", "time")


@dataclass
class NetworkState:
    """Condition of the network: closed corridors, time/cost multipliers per corridor, offline nodes."""

    closed: set[str] = field(default_factory=set)
    time_mult: dict[str, float] = field(default_factory=dict)
    cost_mult: dict[str, float] = field(default_factory=dict)
    down_nodes: set[str] = field(default_factory=set)

    def arrays(self, net: Network) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """(blocked_arcs, hours, cost, closed_corridors) as arrays over arcs/corridors."""
        closed_c = np.zeros(len(net.corridors), dtype=bool)
        for cid in self.closed:
            closed_c[net.corr_ix[cid]] = True
        for nid in self.down_nodes:
            for k in net.incident_corridors(nid):
                closed_c[k] = True
        tm = np.ones(len(net.corridors))
        cm = np.ones(len(net.corridors))
        for cid, m in self.time_mult.items():
            tm[net.corr_ix[cid]] = max(1.0, m)
        for cid, m in self.cost_mult.items():
            cm[net.corr_ix[cid]] = max(1.0, m)
        return arrays_from_corridor_state(net, closed_c, tm, cm) + (closed_c,)


def arrays_from_corridor_state(net: Network, closed_c: np.ndarray, tm: np.ndarray, cm: np.ndarray
                               ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    blocked = closed_c[net.arc_corr]
    hours = net.arc_hours * tm[net.arc_corr]
    cost = net.arc_cost * cm[net.arc_corr]
    return blocked, hours, cost


def objective_weights(objective: str, hours: np.ndarray, cost: np.ndarray) -> np.ndarray:
    # Tiny secondary term breaks ties deterministically (cheaper-then-faster, or faster-then-cheaper).
    if objective == "time":
        return hours + 1e-6 * cost
    return cost + 1e-4 * hours


@dataclass
class Route:
    supplier: str
    destination: str
    arcs: list[int]
    nodes: list[str]
    corridors: list[str]
    km: float
    hours: float
    cost_per_t: float
    modes: list[str]

    @property
    def signature(self) -> str:
        return "|".join(self.corridors)


@dataclass
class Option:
    kind: str  # planned | reroute | switch_supplier | airlift
    supplier: str
    cost_per_t: float
    hours: float
    route: Route | None = None
    air_km: float | None = None

    def score(self, objective: str) -> tuple[float, float]:
        return (self.hours, self.cost_per_t) if objective == "time" else (self.cost_per_t, self.hours)


@dataclass
class ItineraryResult:
    origin: str
    destination: str
    objective: str
    tonnes: float
    baseline: Route | None
    options: list[Option]
    best: Option
    status: str  # on-plan | rerouted | supplier-changed | airlift
    split: bool
    destination_component: list[str]
    reachable_suppliers: list[str]


def build_route(net: Network, arcs: list[int], hours: np.ndarray, cost: np.ndarray) -> Route:
    nodes = [net.nodes[int(net.arc_tail[arcs[0]])].id] + [net.nodes[int(net.arc_head[a])].id for a in arcs]
    corridors, modes = [], []
    for a in arcs:
        c = net.corridors[int(net.arc_corr[a])]
        corridors.append(c.id)
        if c.mode != "transfer" and (not modes or modes[-1] != c.mode):
            modes.append(c.mode)
    return Route(
        supplier=nodes[0], destination=nodes[-1], arcs=list(arcs), nodes=nodes, corridors=corridors,
        km=float(sum(net.arc_km[a] for a in arcs)), hours=float(sum(hours[a] for a in arcs)),
        cost_per_t=float(sum(cost[a] for a in arcs)), modes=modes,
    )


def airlift_option(net: Network, destination: int, down: set[int] | None = None) -> Option | None:
    p = net.params
    best: Option | None = None
    for s in net.suppliers:
        if not net.nodes[s].air or (down and s in down) or s == destination:
            continue
        km = net.distance_km(s, destination)
        opt = Option(kind="airlift", supplier=net.nodes[s].id, cost_per_t=p.air_cost_per_t,
                     hours=p.air_mobilisation_hours + km / p.air_speed_kmh, air_km=km)
        if best is None or opt.hours < best.hours:
            best = opt
    return best


class Planner:
    """Caches intact-network baselines per objective; stateless otherwise (safe to share across requests)."""

    def __init__(self, net: Network):
        self.net = net
        self._baseline: dict[tuple[str, int, int], Route | None] = {}
        self._scale: dict[str, float] = {}
        self._air_cache: dict[tuple[int, frozenset[int]], Option | None] = {}
        self.primary_supplier: dict[str, str] = self._primary_suppliers()

    def scale(self, objective: str) -> float:
        if objective not in self._scale:
            w = objective_weights(objective, self.net.arc_hours, self.net.arc_cost)
            self._scale[objective] = self.net.h_scale(w)
        return self._scale[objective]

    def _primary_suppliers(self) -> dict[str, str]:
        """Planned supplier per community = cheapest supplier on the intact network."""
        net = self.net
        w = objective_weights("cost", net.arc_hours, net.arc_cost).tolist()
        out = {}
        for c in net.communities:
            dist, _ = dijkstra(net, w, c, reverse=True)
            reachable = [s for s in net.suppliers if dist[s] < INF]
            if reachable:
                out[net.nodes[c].id] = net.nodes[min(reachable, key=lambda s: (dist[s], net.nodes[s].id))].id
        return out

    def baseline(self, origin: int, destination: int, objective: str) -> Route | None:
        key = (objective, origin, destination)
        if key not in self._baseline:
            net = self.net
            w = objective_weights(objective, net.arc_hours, net.arc_cost)
            res = bidirectional_astar(net, w.tolist(), origin, destination, h_scale=self.scale(objective))
            self._baseline[key] = build_route(net, res[1], net.arc_hours, net.arc_cost) if res and res[1] else None
        return self._baseline[key]

    def plan(self, origin_id: str, destination_id: str, state: NetworkState | None = None, *,
             objective: str = "cost", tonnes: float | None = None) -> ItineraryResult:
        net = self.net
        state = state or NetworkState()
        o, d = net.node_ix[origin_id], net.node_ix[destination_id]
        blocked, hours, cost, closed_c = state.arrays(net)
        down = {net.node_ix[n] for n in state.down_nodes}
        return self.plan_arrays(o, d, blocked, hours, cost, closed_c, down, objective=objective, tonnes=tonnes)

    def plan_arrays(self, o: int, d: int, blocked: np.ndarray, hours: np.ndarray, cost: np.ndarray,
                    closed_c: np.ndarray, down: set[int], *, objective: str = "cost",
                    tonnes: float | None = None, with_components: bool = True) -> ItineraryResult:
        net = self.net
        if objective not in OBJECTIVES:
            raise ValueError(f"objective must be one of {OBJECTIVES}")
        w = objective_weights(objective, hours, cost)
        wl, bl = w.tolist(), blocked.tolist()
        baseline = self.baseline(o, d, objective)
        if tonnes is None:
            tonnes = net.params.tonnes_for(net.nodes[d].caseload)

        options: list[Option] = []
        # A -> B: bidirectional A* (point-to-point)
        if o not in down:
            res = bidirectional_astar(net, wl, o, d, h_scale=self.scale(objective), blocked=bl)
            if res is not None:
                r = build_route(net, res[1], hours, cost) if res[1] else None
                if r is not None:
                    same = baseline is not None and r.signature == baseline.signature
                    options.append(Option(kind="planned" if same else "reroute", supplier=r.supplier,
                                          cost_per_t=r.cost_per_t, hours=r.hours, route=r))
        # Any other supplier -> B: one reverse Dijkstra from B
        dist, pred = dijkstra(net, wl, d, reverse=True, blocked=bl)
        reachable = []
        for s in net.suppliers:
            if s in down or dist[s] == INF:
                continue
            reachable.append(net.nodes[s].id)
            if s == o:
                continue
            arcs = path_from_reverse(net, pred, s, d)
            if not arcs:
                continue
            r = build_route(net, arcs, hours, cost)
            options.append(Option(kind="switch_supplier", supplier=r.supplier, cost_per_t=r.cost_per_t,
                                  hours=r.hours, route=r))
        air = airlift_option(net, d, down)
        if air is not None:
            options.append(air)
        options.sort(key=lambda opt: opt.score(objective))
        if not options:
            raise ValueError("no delivery option at all (no air-capable supplier)")
        best = options[0]
        status = {"planned": "on-plan", "reroute": "rerouted", "switch_supplier": "supplier-changed",
                  "airlift": "airlift"}[best.kind]

        split, comp_nodes = False, []
        if with_components:
            labels = components(net, closed_c, down)
            split = labels[o] != labels[d]
            comp_nodes = [net.nodes[i].id for i in range(len(net.nodes)) if labels[i] == labels[d]]
        return ItineraryResult(
            origin=net.nodes[o].id, destination=net.nodes[d].id, objective=objective, tonnes=tonnes,
            baseline=baseline, options=options, best=best, status=status, split=split,
            destination_component=comp_nodes, reachable_suppliers=reachable,
        )

    def best_fast(self, o: int, d: int, bl: list[bool], wl: list[float], hours: np.ndarray, cost: np.ndarray,
                  down: set[int], objective: str) -> tuple[str, str, str, str, float, float]:
        """Best option only, for Monte Carlo: one reverse Dijkstra from d prices every supplier at once and only the
        winning route is traced. Returns (status, kind, supplier, signature, cost_per_t, hours)."""
        net = self.net
        dist, pred = dijkstra(net, wl, d, reverse=True, blocked=bl)
        best_s, best_w = -1, INF
        for s in net.suppliers:
            if s in down:
                continue
            ds = dist[s] - (1e-9 if s == o else 0.0)  # prefer the planned supplier on exact ties
            if ds < best_w:
                best_s, best_w = s, ds
        key = (d, frozenset(down))
        air = self._air_cache.get(key)
        if key not in self._air_cache:
            air = self._air_cache[key] = airlift_option(net, d, down)
        if air is not None:
            air_w = objective_weights(objective, np.array([air.hours]), np.array([air.cost_per_t]))[0]
            if best_s < 0 or air_w < best_w:
                return "airlift", "airlift", air.supplier, "air", air.cost_per_t, air.hours
        if best_s < 0:
            raise ValueError("no delivery option at all (no air-capable supplier)")
        arcs = path_from_reverse(net, pred, best_s, d) or []
        signature = "|".join(net.corridors[int(net.arc_corr[a])].id for a in arcs)
        c = float(sum(cost[a] for a in arcs))
        h = float(sum(hours[a] for a in arcs))
        if best_s == o:
            base = self.baseline(o, d, objective)
            same = base is not None and base.signature == signature
            return ("on-plan", "planned", net.nodes[o].id, signature, c, h) if same else \
                ("rerouted", "reroute", net.nodes[o].id, signature, c, h)
        return "supplier-changed", "switch_supplier", net.nodes[best_s].id, signature, c, h

    def plan_network(self, state: NetworkState | None = None, *, objective: str = "cost") -> list[ItineraryResult]:
        net = self.net
        state = state or NetworkState()
        blocked, hours, cost, closed_c = state.arrays(net)
        down = {net.node_ix[n] for n in state.down_nodes}
        results = []
        ordered = sorted(net.communities, key=lambda c: (-net.nodes[c].priority, net.nodes[c].id))
        for c in ordered:
            sup = self.primary_supplier.get(net.nodes[c].id)
            if sup is None:
                continue
            results.append(self.plan_arrays(net.node_ix[sup], c, blocked, hours, cost, closed_c, down,
                                            objective=objective))
        return results


def explain(net: Network, r: ItineraryResult) -> str:
    o, d = net.node(r.origin).name, net.node(r.destination).name
    b = r.best
    if r.status == "on-plan":
        return f"{o} → {d} is open on the planned route."
    if r.status == "rerouted":
        delta = b.cost_per_t - (r.baseline.cost_per_t if r.baseline else 0)
        return (f"The planned route is blocked, but {o} can still reach {d}. Cheapest detour adds "
                f"${delta:,.0f}/t and {b.hours - (r.baseline.hours if r.baseline else 0):+.0f} h.")
    if r.status == "supplier-changed":
        why = (f"The network has split: {o} is no longer connected to {d}." if r.split
               else f"A detour from {o} would cost more than switching supplier.")
        return f"{why} Cheapest reachable supplier is {net.node(b.supplier).name} via {', '.join(b.route.modes)}."
    return (f"No supplier can reach {d} by road or river. Last resort: air delivery from "
            f"{net.node(b.supplier).name} at ${b.cost_per_t:,.0f}/t.")
