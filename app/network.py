"""Illustrative South Sudan food corridor model. No operational data is implied."""

from __future__ import annotations

from heapq import heappop, heappush


NODES = [
    dict(id="juba", name="Juba", kind="hub", role="National logistics hub", lon=31.5825, lat=4.8594, stock=115),
    dict(id="wau", name="Wau", kind="hub", role="Regional depot", lon=27.989, lat=7.703, stock=90),
    dict(id="malakal", name="Malakal", kind="hub", role="River transfer hub", lon=31.66, lat=9.533, stock=85),
    dict(id="bor", name="Bor", kind="community", lon=31.56, lat=6.21, people=18400, need=28, ipc=4, days=6, planned="juba"),
    dict(id="rumbek", name="Rumbek", kind="community", lon=29.68, lat=6.81, people=15200, need=23, ipc=3, days=9, planned="juba"),
    dict(id="bentiu", name="Bentiu", kind="community", lon=29.83, lat=9.23, people=22600, need=34, ipc=4, days=5, planned="malakal"),
    dict(id="aweil", name="Aweil", kind="community", lon=27.397, lat=8.769, people=17100, need=26, ipc=3, days=8, planned="wau"),
    dict(id="yei", name="Yei", kind="community", lon=30.677, lat=4.095, people=13900, need=21, ipc=4, days=7, planned="juba"),
    dict(id="renk", name="Renk", kind="community", lon=32.797, lat=11.749, people=12400, need=19, ipc=3, days=11, planned="malakal"),
    dict(id="torit", name="Torit", kind="community", lon=32.567, lat=4.411, people=10800, need=17, ipc=3, days=10, planned="juba"),
    dict(id="mundri", name="Mundri", kind="junction", lon=30.33, lat=5.35),
]

# Connections and times are an illustrative planning network, not mapped road geometry.
ROADS = [
    ("juba-bor", "juba", "bor", 5.0, "Juba–Bor corridor", 0.17),
    ("bor-malakal", "bor", "malakal", 9.0, "Bor–Malakal corridor", 0.24),
    ("malakal-renk", "malakal", "renk", 7.0, "Upper Nile corridor", 0.19),
    ("juba-rumbek", "juba", "rumbek", 10.0, "Juba–Rumbek corridor", 0.14),
    ("rumbek-wau", "rumbek", "wau", 7.0, "Rumbek–Wau corridor", 0.12),
    ("rumbek-bentiu", "rumbek", "bentiu", 9.0, "Rumbek–Bentiu link", 0.29),
    ("bentiu-malakal", "bentiu", "malakal", 8.0, "Bentiu–Malakal link", 0.27),
    ("wau-aweil", "wau", "aweil", 5.0, "Wau–Aweil corridor", 0.15),
    ("bentiu-aweil", "bentiu", "aweil", 10.0, "Bentiu–Aweil link", 0.23),
    ("juba-mundri", "juba", "mundri", 6.0, "Juba–Mundri link", 0.11),
    ("mundri-wau", "mundri", "wau", 12.0, "Mundri–Wau corridor", 0.18),
    ("mundri-yei", "mundri", "yei", 8.0, "Mundri–Yei link", 0.21),
    ("juba-yei", "juba", "yei", 5.0, "Juba–Yei corridor", 0.22),
    ("juba-torit", "juba", "torit", 6.0, "Juba–Torit corridor", 0.13),
    ("torit-yei", "torit", "yei", 12.0, "Torit–Yei link", 0.16),
]

SCENARIOS = [
    dict(id="open", label="All corridors open", closed=[]),
    dict(id="bor", label="Bor corridor disrupted", closed=["juba-bor"]),
    dict(id="flood", label="Flood exposure", closed=["bor-malakal", "rumbek-bentiu"]),
    dict(id="south", label="Southern access disrupted", closed=["juba-yei", "mundri-yei"]),
    dict(id="compound", label="Compound disruption", closed=["juba-bor", "rumbek-bentiu", "bentiu-malakal", "juba-yei"]),
]

NODE_BY_ID = {node["id"]: node for node in NODES}
ROAD_BY_ID = {road[0]: road for road in ROADS}
HUBS = [node for node in NODES if node["kind"] == "hub"]
COMMUNITIES = [node for node in NODES if node["kind"] == "community"]


def shortest(start: str, closed: set[str]):
    queue = [(0.0, start)]
    distance = {start: 0.0}
    previous = {}
    adjacency = {node["id"]: [] for node in NODES}
    for road_id, a, b, hours, *_ in ROADS:
        if road_id not in closed:
            adjacency[a].append((b, road_id, hours))
            adjacency[b].append((a, road_id, hours))
    while queue:
        hours, current = heappop(queue)
        if hours != distance[current]:
            continue
        for neighbor, road_id, weight in adjacency[current]:
            candidate = hours + weight
            if candidate < distance.get(neighbor, float("inf")):
                distance[neighbor] = candidate
                previous[neighbor] = (current, road_id)
                heappush(queue, (candidate, neighbor))
    return distance, previous


def trace(previous: dict, start: str, end: str):
    nodes = [end]
    roads = []
    current = end
    while current != start:
        current, road_id = previous[current]
        nodes.append(current)
        roads.append(road_id)
    return list(reversed(nodes)), list(reversed(roads))


def calculate(closed: set[str]):
    if unknown := closed - ROAD_BY_ID.keys():
        raise ValueError(f"Unknown corridor: {', '.join(sorted(unknown))}")
    baseline = {d["id"]: d for d in _allocate(set(), None)["deliveries"]} if closed else None
    return _allocate(closed, baseline)


def _allocate(closed: set[str], baseline: dict | None):
    stock = {hub["id"]: hub["stock"] for hub in HUBS}
    deliveries = []
    for dest in sorted(COMMUNITIES, key=lambda n: (-n["ipc"], n["days"])):
        distance, previous = shortest(dest["id"], closed)
        preferred = dest["planned"]
        candidates = sorted(
            (hub for hub in HUBS if hub["id"] in distance and stock[hub["id"]] >= dest["need"]),
            key=lambda hub: (distance[hub["id"]], hub["id"]),
        )
        chosen = preferred if preferred in [hub["id"] for hub in candidates] else (candidates[0]["id"] if candidates else None)
        if chosen:
            nodes, roads = trace(previous, dest["id"], chosen)
            nodes.reverse()
            roads.reverse()
            stock[chosen] -= dest["need"]
            status = "fallback" if chosen != preferred else "onplan"
            if baseline and status == "onplan" and roads != baseline[dest["id"]]["roads"]:
                status = "rerouted"
            hours = distance[chosen]
        else:
            nodes, roads, hours, status = [], [], None, "isolated"
        deliveries.append(dict(
            id=dest["id"], name=dest["name"], people=dest["people"], need=dest["need"],
            ipc=dest["ipc"], days=dest["days"], planned=preferred, supplier=chosen,
            status=status, hours=hours, nodes=nodes, roads=roads,
            coordinates=[[NODE_BY_ID[n]["lon"], NODE_BY_ID[n]["lat"]] for n in nodes],
        ))
    result = dict(
        closed=sorted(closed), deliveries=deliveries, stock_remaining=stock,
        summary=dict(
            people_reachable=sum(d["people"] for d in deliveries if d["status"] != "isolated"),
            total_people=sum(d["people"] for d in deliveries),
            tonnes_dispatched=sum(d["need"] for d in deliveries if d["status"] != "isolated"),
            onplan=sum(d["status"] == "onplan" for d in deliveries),
            rerouted=sum(d["status"] == "rerouted" for d in deliveries),
            fallback=sum(d["status"] == "fallback" for d in deliveries),
            isolated=sum(d["status"] == "isolated" for d in deliveries),
        ),
    )
    return result


def network():
    return dict(
        region="South Sudan", data_notice="Illustrative planning scenario. Locations are approximate; corridors, travel times, risk, stocks, and people served are synthetic. No live conflict or access data.",
        nodes=NODES,
        roads=[dict(id=i, from_node=a, to_node=b, hours=h, name=name, risk=risk) for i, a, b, h, name, risk in ROADS],
        scenarios=SCENARIOS,
    )
