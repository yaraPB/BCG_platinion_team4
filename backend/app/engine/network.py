"""Immutable, indexed view of a client network: nodes, corridors and the directed arcs the router works on.

Each corridor becomes two arcs (2k: a->b, 2k+1: b->a). Arc weights are per tonne: cost in USD/t and time in hours.
River arcs have different downstream/upstream speeds; transfer arcs model port handling between a town and its port.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

import numpy as np

from .assumptions import Params
from .geo import haversine_km

HUB, COMMUNITY, JUNCTION, PORT = "hub", "community", "junction", "port"


@dataclass(frozen=True, slots=True)
class Node:
    id: str
    name: str
    kind: str
    lon: float
    lat: float
    air: bool = False
    caseload: int = 0
    priority: int = 0
    description: str | None = None
    context: str | None = None
    coordinate_source: str | None = None


@dataclass(frozen=True, slots=True)
class Corridor:
    id: str
    a: str
    b: str
    name: str
    mode: str  # road | river | transfer
    surface: str  # paved | unpaved | track | river | transfer
    km: float
    geometry: tuple[tuple[float, float], ...] = field(repr=False)
    downstream_ab: bool = True


class Network:
    def __init__(self, doc: dict, params: Params):
        self.doc_id: str = doc.get("id", "network")
        self.region: str = doc.get("region", "")
        self.notice: str = doc.get("notice", "")
        self.attribution: str = doc.get("attribution", "")
        self.version: int = int(doc.get("version", 1))
        self.params = params
        self.scenarios: list[dict] = list(doc.get("scenarios", []))

        self.nodes: list[Node] = [
            Node(
                id=n["id"], name=n["name"], kind=n["kind"], lon=float(n["coordinates"][0]), lat=float(n["coordinates"][1]),
                air=bool(n.get("air", False)), caseload=int(n.get("caseload", 0)), priority=int(n.get("priority", 0)),
                description=n.get("description"), context=n.get("foodSecurityContext"),
                coordinate_source=n.get("coordinateSource"),
            )
            for n in doc["nodes"]
        ]
        self.node_ix: dict[str, int] = {n.id: i for i, n in enumerate(self.nodes)}
        if len(self.node_ix) != len(self.nodes):
            raise ValueError("duplicate node ids")

        self.corridors: list[Corridor] = []
        for c in doc["corridors"]:
            if c["from"] not in self.node_ix or c["to"] not in self.node_ix:
                raise ValueError(f"corridor {c['id']} references unknown node")
            self.corridors.append(Corridor(
                id=c["id"], a=c["from"], b=c["to"], name=c["name"], mode=c["mode"], surface=c["surface"],
                km=float(c["km"]), geometry=tuple((float(x), float(y)) for x, y in c["geometry"]),
                downstream_ab=c.get("downstream", "from-to") == "from-to",
            ))
        self.corr_ix: dict[str, int] = {c.id: i for i, c in enumerate(self.corridors)}
        if len(self.corr_ix) != len(self.corridors):
            raise ValueError("duplicate corridor ids")

        n_arcs = 2 * len(self.corridors)
        self.arc_tail = np.empty(n_arcs, dtype=np.int64)
        self.arc_head = np.empty(n_arcs, dtype=np.int64)
        self.arc_corr = np.repeat(np.arange(len(self.corridors)), 2)
        self.arc_hours = np.empty(n_arcs)
        self.arc_cost = np.empty(n_arcs)
        self.arc_km = np.empty(n_arcs)
        for k, c in enumerate(self.corridors):
            a, b = self.node_ix[c.a], self.node_ix[c.b]
            for j, (u, v) in enumerate(((a, b), (b, a))):
                arc = 2 * k + j
                self.arc_tail[arc], self.arc_head[arc] = u, v
                self.arc_km[arc] = c.km
                hours, cost = self._arc_weights(c, downstream=(j == 0) == c.downstream_ab)
                self.arc_hours[arc], self.arc_cost[arc] = hours, cost

        # Python adjacency lists for the hot loops (faster than indexing numpy scalars).
        self.out_adj: list[list[tuple[int, int]]] = [[] for _ in self.nodes]
        self.in_adj: list[list[tuple[int, int]]] = [[] for _ in self.nodes]
        for arc in range(n_arcs):
            u, v = int(self.arc_tail[arc]), int(self.arc_head[arc])
            self.out_adj[u].append((arc, v))
            self.in_adj[v].append((arc, u))

        self.lon = np.array([n.lon for n in self.nodes])
        self.lat = np.array([n.lat for n in self.nodes])
        self.arc_hav_km = np.array([
            haversine_km(self.lon[int(t)], self.lat[int(t)], self.lon[int(h)], self.lat[int(h)])
            for t, h in zip(self.arc_tail, self.arc_head, strict=True)
        ])
        self.suppliers: list[int] = [i for i, n in enumerate(self.nodes) if n.kind == HUB]
        self.communities: list[int] = [i for i, n in enumerate(self.nodes) if n.kind == COMMUNITY]

    def _arc_weights(self, c: Corridor, *, downstream: bool) -> tuple[float, float]:
        p = self.params
        if c.mode == "road":
            return c.km / p.truck_speed(c.surface), c.km * p.road_rate(c.surface)
        if c.mode == "river":
            speed = p.barge_speed_downstream if downstream else p.barge_speed_upstream
            return c.km / speed, c.km * p.river_rate
        if c.mode == "transfer":
            return p.port_transfer_hours, p.port_handling
        raise ValueError(f"unknown mode {c.mode}")

    # ---- helpers -------------------------------------------------------------------------------------------
    def node(self, node_id: str) -> Node:
        return self.nodes[self.node_ix[node_id]]

    def corridor(self, corridor_id: str) -> Corridor:
        return self.corridors[self.corr_ix[corridor_id]]

    def distance_km(self, i: int, j: int) -> float:
        return haversine_km(self.lon[i], self.lat[i], self.lon[j], self.lat[j])

    def h_scale(self, weights: np.ndarray) -> float:
        """Largest k such that weights[arc] >= k * straight-line km for every arc.

        k * haversine(v, t) is then a consistent A* heuristic for these weights (and for any weights that only
        increase, e.g. delays or surcharges), because great-circle distance obeys the triangle inequality.
        """
        mask = self.arc_hav_km > 1e-6
        if not mask.any():
            return 0.0
        return float(np.min(weights[mask] / self.arc_hav_km[mask]))

    @cached_property
    def corridor_endpoints(self) -> np.ndarray:
        return np.array([[self.node_ix[c.a], self.node_ix[c.b]] for c in self.corridors], dtype=np.int64)

    def incident_corridors(self, node_id: str) -> list[int]:
        return [k for k, c in enumerate(self.corridors) if node_id in (c.a, c.b)]

    def oriented_geometry(self, arc: int) -> list[list[float]]:
        c = self.corridors[int(self.arc_corr[arc])]
        pts = [list(p) for p in c.geometry]
        return pts if arc % 2 == 0 else pts[::-1]
