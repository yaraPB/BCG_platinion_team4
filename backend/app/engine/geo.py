from __future__ import annotations

import math
from collections.abc import Sequence

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def point_to_polyline_km(lon: float, lat: float, line: Sequence[Sequence[float]]) -> float:
    """Distance from a point to a polyline. Local equirectangular projection; accurate to ~1% within 1,000 km."""
    kx = 111.320 * math.cos(math.radians(lat))
    ky = 110.574
    best = math.inf
    pts = [((x - lon) * kx, (y - lat) * ky) for x, y in line]
    if len(pts) == 1:
        return math.hypot(*pts[0])
    for (ax, ay), (bx, by) in zip(pts, pts[1:], strict=False):
        dx, dy = bx - ax, by - ay
        norm = dx * dx + dy * dy
        t = 0.0 if norm == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / norm))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best
