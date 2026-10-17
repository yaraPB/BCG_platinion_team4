import { palette } from "@/lib/presentation";
import type { Network as SourceNetwork, Plan as SourcePlan } from "@/lib/types";
import type {
  Coordinate,
  Hazard,
  HazardId,
  Network,
  Plan,
  TransportMode,
} from "./types";

/** Scenario areas the planner can tune in the risk forecast. Probabilities are
 *  user inputs, not forecasts; the server simulates them (see simulation.ts). */
const scenarioHazards: Hazard[] = [
  {
    id: "flood",
    title: "Rising water · Jonglei & Upper Nile",
    description: "Flooding of tracks and lowland crossings",
    probability: 0.55,
    center: [31.6, 7.4],
    radiusKm: 190,
    color: palette.hazard.flood,
  },
  {
    id: "rain",
    title: "Heavy rainfall · Equatoria",
    description: "Unpaved roads and last-mile access",
    probability: 0.35,
    center: [30.6, 4.8],
    radiusKm: 150,
    color: palette.hazard.rain,
  },
  {
    id: "security",
    title: "Insecurity · Sobat corridor",
    description: "Road and river access around Nasir and Ulang",
    probability: 0.3,
    center: [32.9, 8.6],
    radiusKm: 90,
    color: palette.hazard.security,
  },
];

/** Distance from a point to a polyline (km), local equirectangular projection. */
function distanceToLineKm([lon, lat]: Coordinate, line: Coordinate[]) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180),
    ky = 110.57;
  const pts = line.map(([x, y]) => [(x - lon) * kx, (y - lat) * ky]);
  if (pts.length === 1) return Math.hypot(pts[0][0], pts[0][1]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1],
      [bx, by] = pts[i],
      dx = bx - ax,
      dy = by - ay,
      n = dx * dx + dy * dy;
    const t = n ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / n)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Maps the API network to the display model. Geometry, distance and mode come
 *  from the API (OpenStreetMap roads, Overpass river lines). Port transfers stay
 *  in the routing model but are not drawn as corridors. Exposure to each
 *  scenario area is computed from the corridor geometry. */
export function displayNetwork(source: SourceNetwork): Network {
  const corridors = source.corridors
    .filter((road) => road.mode !== "transfer")
    .map((road) => {
      const coordinates =
        road.geometry?.length > 1
          ? road.geometry
          : [
              source.nodes.find((n) => n.id === road.from)!.coordinates,
              source.nodes.find((n) => n.id === road.to)!.coordinates,
            ];
      const exposure = Object.fromEntries(
        scenarioHazards
          .map((h) => [h.id, Math.max(0, 1 - distanceToLineKm(h.center, coordinates) / h.radiusKm)] as const)
          .filter(([, x]) => x > 0),
      ) as Partial<Record<HazardId, number>>;
      return {
        ...road,
        mode: road.mode as TransportMode,
        coordinates,
        distanceKm: road.km,
        geometrySource: "OpenStreetMap",
        exposure,
      };
    });
  return { ...source, corridors, hazards: scenarioHazards };
}

/** Connected groups of towns over open corridors (river ports fold into their town). */
export function components(network: Network, closed: string[]) {
  const town = (id: string) => (id.endsWith("-port") ? id.slice(0, -5) : id);
  const unseen = new Set(network.nodes.filter((n) => n.kind !== "port").map((n) => n.id)),
    groups: string[][] = [];
  while (unseen.size) {
    const first = unseen.values().next().value!,
      group = [first];
    unseen.delete(first);
    for (let i = 0; i < group.length; i++)
      for (const road of network.corridors) {
        if (closed.includes(road.id)) continue;
        const from = town(road.from),
          to = town(road.to);
        const next = from === group[i] ? to : to === group[i] ? from : null;
        if (next && unseen.delete(next)) group.push(next);
      }
    groups.push(group);
  }
  return groups;
}

export function displayPlan(source: SourcePlan, network: Network): Plan {
  return {
    ...source,
    components: components(network, source.closedRoads),
    deliveries: source.deliveries.map((d) => {
      const legs = d.roadIds.flatMap((id, i) => {
        const road = network.corridors.find((r) => r.id === id);
        if (!road) return []; // port transfer: part of the route, not drawn
        const forward = road.from === d.path[i];
        return [
          {
            corridorId: id,
            mode: road.mode,
            hours: forward ? road.hours : road.hoursReverse,
            coordinates: forward ? road.coordinates : [...road.coordinates].reverse(),
          },
        ];
      });
      return {
        ...d,
        legs,
        coordinates: legs.length
          ? legs.flatMap((leg, i) => (i ? leg.coordinates.slice(1) : leg.coordinates))
          : d.coordinates,
        distanceKm: Math.round(
          d.roadIds.reduce(
            (sum, id) => sum + (network.corridors.find((r) => r.id === id)?.distanceKm ?? 0),
            0,
          ),
        ),
      };
    }),
  };
}
