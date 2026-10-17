from __future__ import annotations

import math
import random

import networkx as nx
import pytest

from app.engine.assumptions import default_params
from app.engine.geo import haversine_km
from app.engine.network import Network
from app.engine.planner import objective_weights
from app.engine.routing import INF, bidirectional_astar, components, dijkstra, path_from_reverse, yen_k_shortest


def random_network(seed: int, n: int = 40, extra_edges: int = 50) -> Network:
    rng = random.Random(seed)
    nodes = [{"id": f"n{i}", "name": f"N{i}", "kind": "hub" if i < 5 else "community",
              "coordinates": [30 + rng.random() * 4, 5 + rng.random() * 4], "caseload": 1000} for i in range(n)]
    pairs = {(i, i + 1) for i in range(n - 1)}  # spanning path keeps it connected
    while len(pairs) < n - 1 + extra_edges:
        a, b = rng.sample(range(n), 2)
        pairs.add((min(a, b), max(a, b)))
    corridors = []
    for a, b in pairs:
        pa, pb = nodes[a]["coordinates"], nodes[b]["coordinates"]
        km = haversine_km(pa[0], pa[1], pb[0], pb[1]) * rng.uniform(1.0, 1.8)
        corridors.append({"id": f"c{a}-{b}", "from": f"n{a}", "to": f"n{b}", "name": "", "mode": "road",
                          "surface": rng.choice(["paved", "unpaved", "track"]), "km": km, "geometry": [pa, pb]})
    return Network({"nodes": nodes, "corridors": corridors}, default_params())


def to_nx(net: Network, w, blocked=None) -> nx.DiGraph:
    g = nx.DiGraph()
    for arc in range(len(net.arc_tail)):
        if blocked is not None and blocked[arc]:
            continue
        g.add_edge(int(net.arc_tail[arc]), int(net.arc_head[arc]), weight=w[arc])
    return g


@pytest.mark.parametrize("seed", range(8))
@pytest.mark.parametrize("objective", ["cost", "time"])
def test_bidirectional_astar_matches_networkx(seed: int, objective: str):
    net = random_network(seed)
    w = objective_weights(objective, net.arc_hours, net.arc_cost)
    rng = random.Random(seed)
    blocked = [rng.random() < 0.15 for _ in range(len(w))]
    g = to_nx(net, w, blocked)
    scale = net.h_scale(w)
    for _ in range(25):
        s, t = rng.sample(range(len(net.nodes)), 2)
        res = bidirectional_astar(net, w.tolist(), s, t, h_scale=scale, blocked=blocked)
        try:
            expected = nx.dijkstra_path_length(g, s, t)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            assert res is None
            continue
        assert res is not None
        assert math.isclose(res[0], expected, rel_tol=1e-9, abs_tol=1e-9)
        # path is contiguous, starts at s, ends at t, and uses no blocked arc
        arcs = res[1]
        assert int(net.arc_tail[arcs[0]]) == s and int(net.arc_head[arcs[-1]]) == t
        assert all(int(net.arc_head[a]) == int(net.arc_tail[b]) for a, b in zip(arcs, arcs[1:], strict=False))
        assert not any(blocked[a] for a in arcs)


def test_h_scale_is_consistent(net):
    for objective in ("cost", "time"):
        w = objective_weights(objective, net.arc_hours, net.arc_cost)
        k = net.h_scale(w)
        assert k > 0
        assert (w + 1e-12 >= k * net.arc_hav_km).all()


def test_astar_equals_reverse_dijkstra_on_real_network(net):
    w = objective_weights("cost", net.arc_hours, net.arc_cost)
    wl, scale = w.tolist(), net.h_scale(w)
    for d in net.communities:
        dist, pred = dijkstra(net, wl, d, reverse=True)
        for s in net.suppliers:
            res = bidirectional_astar(net, wl, s, d, h_scale=scale)
            if dist[s] == INF:
                assert res is None
                continue
            assert math.isclose(res[0], dist[s], rel_tol=1e-9)
            arcs = path_from_reverse(net, pred, s, d)
            assert math.isclose(sum(wl[a] for a in arcs), dist[s], rel_tol=1e-9)


def test_yen_paths_are_loopless_and_sorted(net):
    w = objective_weights("cost", net.arc_hours, net.arc_cost).tolist()
    s, t = net.node_ix["juba"], net.node_ix["bor"]
    paths = yen_k_shortest(net, w, s, t, 4)
    assert len(paths) >= 2
    costs = [c for c, _ in paths]
    assert costs == sorted(costs)
    for _, arcs in paths:
        nodes = [int(net.arc_tail[arcs[0]])] + [int(net.arc_head[a]) for a in arcs]
        assert len(nodes) == len(set(nodes))
    assert len({tuple(p) for _, p in paths}) == len(paths)


def test_components_detect_split(net):
    import numpy as np

    closed = np.zeros(len(net.corridors), dtype=bool)
    labels = components(net, closed)
    assert len({labels[i] for i in net.communities}) == 1
    for cid in ("river-nasir-malakal", "ulang-nasir"):
        closed[net.corr_ix[cid]] = True
    labels = components(net, closed)
    assert labels[net.node_ix["nasir"]] != labels[net.node_ix["malakal"]]
