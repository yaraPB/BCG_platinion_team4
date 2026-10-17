"""Shortest-path primitives.

- bidirectional_astar: point-to-point (A -> B). Searches from both ends with the balanced ("average") potentials of
  Goldberg & Harrelson / Ikeda et al., which keep reduced arc costs non-negative in both directions, so the classic
  bidirectional stopping rule (top_f + top_r >= best) stays exact.
- dijkstra(reverse=True): one-to-all distances *to* a destination. Answers "which supplier is cheapest to reach B"
  for every supplier in a single pass — cheaper than one A* per supplier.
- yen_k_shortest: loopless k-shortest paths, used to build candidate fallback routes.
- components: connected components over open corridors, used to detect that a cut has split the network.

Weights are per arc; `blocked[arc] = True` removes an arc.
"""

from __future__ import annotations

import heapq
import math
from collections.abc import Sequence

import numpy as np

from .network import Network

INF = math.inf


def dijkstra(net: Network, w: Sequence[float], source: int, *, reverse: bool = False,
             blocked: Sequence[bool] | None = None) -> tuple[list[float], list[int]]:
    """Returns (dist, pred_arc). With reverse=True, dist[v] is the cost from v *to* source and pred_arc[v] is the
    first arc of the best v -> source path."""
    n = len(net.nodes)
    dist = [INF] * n
    pred = [-1] * n
    dist[source] = 0.0
    adj = net.in_adj if reverse else net.out_adj
    pq: list[tuple[float, int]] = [(0.0, source)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for arc, v in adj[u]:
            if blocked is not None and blocked[arc]:
                continue
            nd = d + w[arc]
            if nd < dist[v]:
                dist[v] = nd
                pred[v] = arc
                heapq.heappush(pq, (nd, v))
    return dist, pred


def path_from_forward(net: Network, pred: Sequence[int], source: int, target: int) -> list[int] | None:
    arcs: list[int] = []
    v = target
    while v != source:
        arc = pred[v]
        if arc < 0:
            return None
        arcs.append(arc)
        v = int(net.arc_tail[arc])
    arcs.reverse()
    return arcs


def path_from_reverse(net: Network, pred: Sequence[int], start: int, target: int) -> list[int] | None:
    """Walk a reverse-Dijkstra predecessor map from start to target (the reverse search's source)."""
    arcs: list[int] = []
    v = start
    guard = 0
    while v != target:
        arc = pred[v]
        if arc < 0 or guard > len(net.nodes):
            return None
        arcs.append(arc)
        v = int(net.arc_head[arc])
        guard += 1
    return arcs


def bidirectional_astar(net: Network, w: Sequence[float], s: int, t: int, *, h_scale: float,
                        blocked: Sequence[bool] | None = None) -> tuple[float, list[int]] | None:
    """Exact s -> t shortest path. h_scale must satisfy w[arc] >= h_scale * straight_line_km(arc) (see Network.h_scale)."""
    if s == t:
        return 0.0, []
    lon, lat = net.lon, net.lat
    cos_lat = np.cos(np.radians(lat))

    def hav(i: int, j: int) -> float:
        # Fast haversine on precomputed arrays
        dlat = math.radians(lat[j] - lat[i])
        dlon = math.radians(lon[j] - lon[i])
        a = math.sin(dlat / 2) ** 2 + cos_lat[i] * cos_lat[j] * math.sin(dlon / 2) ** 2
        return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))

    pot: dict[int, float] = {}

    def pf(v: int) -> float:  # forward potential; reverse potential is -pf
        p = pot.get(v)
        if p is None:
            p = 0.5 * h_scale * (hav(v, t) - hav(s, v))
            pot[v] = p
        return p

    df: dict[int, float] = {s: 0.0}
    dr: dict[int, float] = {t: 0.0}
    predf: dict[int, int] = {}
    predr: dict[int, int] = {}
    qf: list[tuple[float, int]] = [(0.0, s)]
    qr: list[tuple[float, int]] = [(0.0, t)]
    best, meet = INF, -1

    while qf and qr:
        if qf[0][0] + qr[0][0] >= best:
            break
        if qf[0][0] <= qr[0][0]:
            d, u = heapq.heappop(qf)
            if d > df.get(u, INF):
                continue
            pu = pf(u)
            for arc, v in net.out_adj[u]:
                if blocked is not None and blocked[arc]:
                    continue
                nd = d + w[arc] - pu + pf(v)
                if nd < df.get(v, INF):
                    df[v] = nd
                    predf[v] = arc
                    heapq.heappush(qf, (nd, v))
                if v in dr and df[v] + dr[v] < best:
                    best, meet = df[v] + dr[v], v
        else:
            d, u = heapq.heappop(qr)
            if d > dr.get(u, INF):
                continue
            pu = pf(u)
            for arc, v in net.in_adj[u]:  # arc is v -> u
                if blocked is not None and blocked[arc]:
                    continue
                nd = d + w[arc] + pu - pf(v)
                if nd < dr.get(v, INF):
                    dr[v] = nd
                    predr[v] = arc
                    heapq.heappush(qr, (nd, v))
                if v in df and df[v] + dr[v] < best:
                    best, meet = df[v] + dr[v], v

    if meet < 0:
        return None
    arcs: list[int] = []
    v = meet
    while v != s:
        arc = predf[v]
        arcs.append(arc)
        v = int(net.arc_tail[arc])
    arcs.reverse()
    v = meet
    while v != t:
        arc = predr[v]
        arcs.append(arc)
        v = int(net.arc_head[arc])
    cost = float(sum(w[a] for a in arcs))
    return cost, arcs


def yen_k_shortest(net: Network, w: Sequence[float], s: int, t: int, k: int,
                   blocked: Sequence[bool] | None = None) -> list[tuple[float, list[int]]]:
    base_blocked = list(blocked) if blocked is not None else [False] * len(net.arc_tail)
    dist, pred = dijkstra(net, w, s, blocked=base_blocked)
    first = path_from_forward(net, pred, s, t)
    if first is None:
        return []
    found: list[tuple[float, list[int]]] = [(sum(w[a] for a in first), first)]
    candidates: list[tuple[float, list[int]]] = []
    seen = {tuple(first)}
    for _ in range(1, k):
        last = found[-1][1]
        last_nodes = [s] + [int(net.arc_head[a]) for a in last]
        for i in range(len(last)):
            spur = last_nodes[i]
            root = last[:i]
            blk = base_blocked.copy()
            for _, p in found:
                if p[:i] == root and len(p) > i:
                    blk[p[i]] = True
                    blk[p[i] ^ 1] = True  # also the reverse arc of the same corridor
            for node in last_nodes[:i]:  # remove root nodes to keep paths loopless
                for arc, _ in net.out_adj[node]:
                    blk[arc] = True
                for arc, _ in net.in_adj[node]:
                    blk[arc] = True
            d2, p2 = dijkstra(net, w, spur, blocked=blk)
            spur_path = path_from_forward(net, p2, spur, t)
            if spur_path is None:
                continue
            total = root + spur_path
            key = tuple(total)
            if key not in seen:
                seen.add(key)
                heapq.heappush(candidates, (sum(w[a] for a in total), total))
        if not candidates:
            break
        found.append(heapq.heappop(candidates))
    return found


def components(net: Network, closed_corridors: np.ndarray, down_nodes: set[int] | None = None) -> list[int]:
    """Union-find over open corridors. Returns component label per node (down nodes get their own label)."""
    parent = list(range(len(net.nodes)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    down = down_nodes or set()
    for k, (a, b) in enumerate(net.corridor_endpoints):
        if closed_corridors[k] or a in down or b in down:
            continue
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            parent[ra] = rb
    return [find(i) for i in range(len(net.nodes))]
