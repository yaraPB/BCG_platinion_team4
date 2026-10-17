"""Build the South Sudan demo network from OpenStreetMap data.

Sources
- Town coordinates: Nominatim (OpenStreetMap), with a fallback to the listed coordinates.
- Road legs: OSRM public demo server (OpenStreetMap road network). Distance and geometry are kept;
  legs whose road distance exceeds MAX_DETOUR x the straight-line distance are dropped because OSM
  has no direct road between the two places.
- River legs: Overpass API waterway geometry (White Nile, Bahr al Jabal, Sobat, Bahr el Zeraf),
  shortest path along the river line between the two ports.

The output is committed (app/seed/networks/south_sudan.json) so the API never calls these services
at runtime. Map data © OpenStreetMap contributors, ODbL.

Run: uv run python scripts/build_network.py
"""

from __future__ import annotations

import heapq
import json
import math
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
OUT = ROOT.parent / "app" / "seed" / "networks" / "south_sudan.json"
UA = {"User-Agent": "FoodBridge-hackathon/0.1 (BCG Platinion team 4)"}
MAX_DETOUR = 2.2
SIMPLIFY_DEG = 0.004  # ~400 m

# Suppliers are the demo client's warehouses; communities are its delivery points.
# caseload = people the client plans to serve this cycle (client input, demo values).
# context = published food-security notes for the area (sourced), or None.
NODES = [
    ("juba", "Juba", "hub", 31.5713, 4.8594, {"description": "Main warehouse (capital)", "air": True, "port": True}),
    ("nimule", "Nimule", "hub", 32.0636, 3.5967, {"description": "Border depot on the Uganda corridor"}),
    ("wau", "Wau", "hub", 27.9953, 7.7029, {"description": "Regional depot (west)", "air": True}),
    ("malakal", "Malakal", "hub", 31.6605, 9.5334, {"description": "River hub (north-east)", "air": True, "port": True}),
    ("rumbek", "Rumbek", "hub", 29.6833, 6.8000, {"description": "Central depot", "air": True}),
    ("bor", "Bor", "community", 31.5589, 6.2092, {"caseload": 18000, "priority": 3, "port": True}),
    ("bentiu", "Bentiu", "community", 29.8000, 9.2333, {"caseload": 25000, "priority": 4}),
    ("aweil", "Aweil", "community", 27.3999, 8.7672, {"caseload": 16000, "priority": 3}),
    ("yei", "Yei", "community", 30.6779, 4.0951, {"caseload": 12000, "priority": 3}),
    ("renk", "Renk", "community", 32.8000, 11.7500, {"caseload": 14000, "priority": 4, "port": True}),
    ("torit", "Torit", "community", 32.5700, 4.4133, {"caseload": 10000, "priority": 3}),
    ("nasir", "Nasir", "community", 33.0667, 8.6000, {"caseload": 17000, "priority": 5, "port": True}),
    ("ulang", "Ulang", "community", 32.7000, 8.6500, {"caseload": 9000, "priority": 5}),
    ("akobo", "Akobo", "community", 33.0000, 7.7833, {"caseload": 11000, "priority": 5}),
    ("pibor", "Pibor", "community", 33.1333, 6.8000, {"caseload": 9000, "priority": 4}),
    ("leer", "Leer", "community", 30.1417, 8.3017, {"caseload": 12000, "priority": 4}),
    ("fangak", "Old Fangak", "community", 30.8800, 9.0700, {"caseload": 11000, "priority": 5, "port": True}),
    ("mundri", "Mundri", "junction", 30.3333, 5.3500, {}),
    ("tonj", "Tonj", "junction", 28.6822, 7.2731, {}),
    ("yirol", "Yirol", "junction", 30.5000, 6.5500, {}),
    ("ayod", "Ayod", "junction", 31.4167, 8.1167, {}),
    ("kuajok", "Kuajok", "junction", 27.9900, 8.3100, {}),
    ("mayom", "Mayom", "junction", 29.1667, 9.2333, {}),
]

GEOCODE_QUERY = {
    "bor": "Bor, Jonglei, South Sudan", "nasir": "Nasir, Upper Nile, South Sudan", "ulang": "Ulang, South Sudan",
    "fangak": "Old Fangak, South Sudan", "leer": "Leer, Unity, South Sudan", "mayom": "Mayom, South Sudan",
}

CONTEXT = {
    "nasir": "IPC: ~17,000 people in Catastrophe (Phase 5) in Luakpiny/Nasir, Sep–Nov 2025; risk of Famine flagged.",
    "fangak": "IPC: ~11,000 people in Catastrophe (Phase 5) in Fangak, Sep–Nov 2025.",
    "ulang": "FEWS NET (Feb 2026): credible risk of Famine (IPC Phase 5) in Ulang.",
    "akobo": "FEWS NET (Feb 2026): credible risk of Famine (IPC Phase 5) in Akobo.",
}

# (a, b, surface, name). surface: paved | unpaved | track
ROADS = [
    ("juba", "nimule", "paved", "Juba–Nimule (A43)"),
    ("juba", "torit", "unpaved", "Juba–Torit"),
    ("nimule", "torit", "unpaved", "Nimule–Magwi–Torit"),
    ("juba", "yei", "unpaved", "Juba–Yei"),
    ("juba", "mundri", "unpaved", "Juba–Mundri"),
    ("mundri", "rumbek", "unpaved", "Mundri–Mvolo–Rumbek"),
    ("yei", "mundri", "unpaved", "Yei–Mundri"),
    ("juba", "bor", "unpaved", "Juba–Bor"),
    ("bor", "pibor", "track", "Bor–Pibor"),
    ("pibor", "akobo", "track", "Pibor–Akobo"),
    ("bor", "ayod", "track", "Bor–Duk–Ayod"),
    ("ayod", "fangak", "track", "Ayod–Fangak"),
    ("rumbek", "yirol", "unpaved", "Rumbek–Yirol"),
    ("rumbek", "tonj", "unpaved", "Rumbek–Tonj"),
    ("tonj", "wau", "unpaved", "Tonj–Wau"),
    ("wau", "aweil", "unpaved", "Wau–Aweil"),
    ("wau", "kuajok", "unpaved", "Wau–Kuajok"),
    ("kuajok", "mayom", "track", "Kuajok–Abiemnhom–Mayom"),
    ("mayom", "bentiu", "unpaved", "Mayom–Bentiu"),
    ("rumbek", "leer", "track", "Rumbek–Leer"),
    ("leer", "bentiu", "unpaved", "Leer–Bentiu"),
    ("bentiu", "malakal", "track", "Bentiu–Malakal"),
    ("malakal", "renk", "unpaved", "Malakal–Renk"),
    ("malakal", "ulang", "track", "Malakal–Ulang"),
    ("ulang", "nasir", "track", "Ulang–Nasir"),
    ("nasir", "akobo", "track", "Nasir–Akobo"),
    ("aweil", "bentiu", "track", "Aweil–Bentiu"),
]

# (a_port, b_port, name). Direction a->b is downstream.
RIVERS = [
    ("juba", "bor", "Juba–Bor (Bahr al Jabal)"),
    ("bor", "malakal", "Bor–Malakal (Bahr al Jabal / White Nile)"),
    ("malakal", "renk", "Malakal–Renk (White Nile)"),
    ("nasir", "malakal", "Nasir–Malakal (Sobat)"),
    ("fangak", "malakal", "Old Fangak–Malakal (Bahr el Zeraf / White Nile)"),
]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def simplify(points: list[list[float]], tol: float) -> list[list[float]]:
    """Douglas–Peucker on lon/lat degrees; keeps endpoints."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = points[i]
        bx, by = points[j]
        dx, dy = bx - ax, by - ay
        norm = dx * dx + dy * dy
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            px, py = points[k]
            t = 0.0 if norm == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / norm))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, idx = d, k
        if best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [[round(x, 5), round(y, 5)] for (x, y), k in zip(points, keep, strict=True) if k]


def cached_get(name: str, url: str, params: dict | None = None, method: str = "GET", data: dict | None = None) -> dict:
    path = CACHE / name
    if path.exists():
        return json.loads(path.read_text())
    for attempt in range(4):
        try:
            if method == "GET":
                r = httpx.get(url, params=params, headers=UA, timeout=180)
            else:
                r = httpx.post(url, data=data, headers={**UA, "Accept": "application/json"}, timeout=180)
            r.raise_for_status()
            payload = r.json()
            path.write_text(json.dumps(payload))
            time.sleep(1.1)  # Nominatim / OSRM fair-use
            return payload
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            print(f"  retry {attempt + 1} for {name}: {exc}")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {name}")


def geocode(node_id: str, name: str, approx: tuple[float, float]) -> tuple[tuple[float, float], str]:
    query = GEOCODE_QUERY.get(node_id, f"{name}, South Sudan")
    res = cached_get(f"geo2_{node_id}.json", "https://nominatim.openstreetmap.org/search",
                     {"q": query, "format": "jsonv2", "limit": 5, "countrycodes": "ss", "featureType": "settlement"})
    # Only settlements: the first hit is often the county boundary centroid, tens of km from the town.
    for hit in res:
        pt = (float(hit["lon"]), float(hit["lat"]))
        if hit.get("category") == "place" and haversine_km(pt, approx) < 25:
            return (round(pt[0], 5), round(pt[1], 5)), "nominatim"
    return approx, "manual"


def osrm_route(a_id: str, b_id: str, a: tuple[float, float], b: tuple[float, float]) -> dict:
    url = f"https://router.project-osrm.org/route/v1/driving/{a[0]},{a[1]};{b[0]},{b[1]}"
    key = f"osrm_{a_id}_{b_id}_{a[0]:.4f}_{a[1]:.4f}_{b[0]:.4f}_{b[1]:.4f}.json"
    res = cached_get(key, url, {"overview": "full", "geometries": "geojson"})
    if res.get("code") != "Ok" or not res.get("routes"):
        raise RuntimeError(f"OSRM: no route {a_id}-{b_id}")
    return res["routes"][0]


def river_graph() -> tuple[dict[int, tuple[float, float]], dict[int, list[tuple[int, float]]]]:
    query = """[out:json][timeout:170];
way["waterway"="river"]["name"~"Nile|Jabal|Jebel|Sobat|Zaraf|Zeraf|Bahr|النيل",i](3.4,29.5,12.2,34.0);
out geom;"""
    res = cached_get("overpass_rivers.json", "https://overpass-api.de/api/interpreter", method="POST", data={"data": query})
    coords: dict[int, tuple[float, float]] = {}
    adj: dict[int, list[tuple[int, float]]] = {}
    for way in res["elements"]:
        ids, geom = way.get("nodes", []), way.get("geometry", [])
        for nid, g in zip(ids, geom, strict=False):
            coords[nid] = (g["lon"], g["lat"])
        for u, v in zip(ids, ids[1:], strict=False):
            if u in coords and v in coords:
                d = haversine_km(coords[u], coords[v])
                adj.setdefault(u, []).append((v, d))
                adj.setdefault(v, []).append((u, d))
    # Bridge small gaps between way endpoints (mapping breaks at confluences / channels).
    ends = [nid for nid, nbrs in adj.items() if len(nbrs) == 1]
    for i, u in enumerate(ends):
        for v in ends[i + 1:]:
            d = haversine_km(coords[u], coords[v])
            if d < 3.0:
                adj[u].append((v, d))
                adj[v].append((u, d))
    return coords, adj


def river_path(coords, adj, a: tuple[float, float], b: tuple[float, float]) -> tuple[list[list[float]], float]:
    def nearest(p):
        return min(adj, key=lambda n: (coords[n][0] - p[0]) ** 2 + (coords[n][1] - p[1]) ** 2)

    s, t = nearest(a), nearest(b)
    dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t:
            break
        if d > dist.get(u, math.inf):
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    if t not in dist:
        raise RuntimeError("river path not connected")
    path, cur = [t], t
    while cur != s:
        cur = prev[cur]
        path.append(cur)
    path.reverse()
    pts = [list(a)] + [list(coords[n]) for n in path] + [list(b)]
    km = dist[t] + haversine_km(a, coords[s]) + haversine_km(coords[t], b)
    return pts, km


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    nodes, pos = [], {}
    for node_id, name, kind, lon, lat, extra in NODES:
        (lon2, lat2), how = geocode(node_id, name, (lon, lat))
        pos[node_id] = (lon2, lat2)
        node = {"id": node_id, "name": name, "kind": kind, "coordinates": [lon2, lat2], "coordinateSource": how}
        node.update({k: v for k, v in extra.items() if k not in ("port",)})
        if node_id in CONTEXT:
            node["foodSecurityContext"] = CONTEXT[node_id]
        nodes.append(node)
        print(f"{node_id:8s} {how:9s} {lon2:.4f},{lat2:.4f}")

    corridors = []
    for a, b, surface, name in ROADS:
        route = osrm_route(a, b, pos[a], pos[b])
        km = route["distance"] / 1000
        straight = haversine_km(pos[a], pos[b])
        ratio = km / straight
        if ratio > MAX_DETOUR:
            print(f"DROP road {a}-{b}: {km:.0f} km vs {straight:.0f} km straight (x{ratio:.1f}) — no direct OSM road")
            continue
        geom = simplify([[pos[a][0], pos[a][1]], *route["geometry"]["coordinates"], [pos[b][0], pos[b][1]]], SIMPLIFY_DEG)
        corridors.append({
            "id": f"{a}-{b}", "from": a, "to": b, "name": name, "mode": "road", "surface": surface,
            "km": round(km, 1), "osrmHours": round(route["duration"] / 3600, 2), "geometry": geom,
            "geometrySource": "osrm",
        })
        print(f"road  {a}-{b}: {km:6.1f} km (x{ratio:.2f}) {len(geom)} pts")

    coords, adj = river_graph()
    for a, b, name in RIVERS:
        pts, km = river_path(coords, adj, pos[a], pos[b])
        straight = haversine_km(pos[a], pos[b])
        geom = simplify(pts, SIMPLIFY_DEG)
        corridors.append({
            "id": f"river-{a}-{b}", "from": f"{a}-port", "to": f"{b}-port", "name": name, "mode": "river",
            "surface": "river", "km": round(km, 1), "downstream": "from-to", "geometry": geom,
            "geometrySource": "overpass",
        })
        print(f"river {a}-{b}: {km:6.1f} km (straight {straight:.0f}) {len(geom)} pts")

    river_legs = [c for c in corridors if c["mode"] == "river"]
    ports = sorted({c["from"][:-5] for c in river_legs} | {c["to"][:-5] for c in river_legs})
    for town in ports:
        town_name = next(n["name"] for n in nodes if n["id"] == town)
        nodes.append({"id": f"{town}-port", "name": f"{town_name} river port",
                      "kind": "port", "coordinates": list(pos[town]), "coordinateSource": "town"})
        corridors.append({"id": f"transfer-{town}", "from": town, "to": f"{town}-port", "name": f"{town.title()} port transfer",
                          "mode": "transfer", "surface": "transfer", "km": 0.0, "geometry": [list(pos[town]), list(pos[town])],
                          "geometrySource": "town"})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "id": "south-sudan", "region": "South Sudan", "version": 1,
        "notice": ("Real towns and OpenStreetMap road/river geometry. Warehouses, caseloads and priorities are demo "
                   "client inputs. Costs use published unit rates (see /v1/assumptions)."),
        "attribution": "Map data © OpenStreetMap contributors (ODbL), routed with OSRM; river lines via Overpass API.",
        "nodes": nodes, "corridors": corridors,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(f"wrote {OUT} — {len(nodes)} nodes, {len(corridors)} corridors")


if __name__ == "__main__":
    main()
