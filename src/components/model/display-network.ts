import geometry from "@/lib/data/corridor-geometry.json";
import { palette } from "@/lib/presentation";
import type { Network as SourceNetwork, Plan as SourcePlan } from "@/lib/types";
import type {
  Coordinate,
  HazardId,
  Network,
  Plan,
  TransportMode,
} from "./types";

const shapes = geometry as unknown as Record<
  string,
  { coordinates: Coordinate[]; distanceKm: number; source: string }
>;
const exposure: Record<string, Partial<Record<HazardId, number>>> = {
  "juba-bor": { flood: 0.3, security: 0.8 },
  "bor-malakal": { flood: 0.9 },
  "malakal-renk": { flood: 0.3, security: 0.4 },
  "juba-rumbek": { rain: 0.5, security: 0.25 },
  "rumbek-wau": { rain: 0.4 },
  "rumbek-bentiu": { flood: 0.9, rain: 0.3 },
  "bentiu-malakal": { flood: 0.8, security: 0.3 },
  "wau-aweil": { rain: 0.4 },
  "bentiu-aweil": { flood: 0.6, security: 0.3 },
  "juba-mundri": { rain: 0.7 },
  "mundri-wau": { rain: 0.6 },
  "mundri-yei": { rain: 0.8, security: 0.2 },
  "juba-yei": { security: 0.7, rain: 0.5 },
  "juba-torit": { security: 0.25 },
  "torit-yei": { rain: 0.4, security: 0.3 },
};

/** Frontend presentation only; API data and route decisions are not modified. */
export function displayNetwork(source: SourceNetwork): Network {
  return {
    ...source,
    corridors: source.corridors.map((road) => ({
      ...road,
      mode: (road.id === "bor-malakal" || road.id === "bentiu-malakal"
        ? "river"
        : "road") as TransportMode,
      coordinates: shapes[road.id].coordinates,
      distanceKm: shapes[road.id].distanceKm,
      geometrySource: shapes[road.id].source,
      exposure: exposure[road.id],
    })),
    hazards: [
      {
        id: "flood",
        title: "Rising water · Upper Nile",
        description: "River access and lowland crossings",
        probability: 0.55,
        center: [30.75, 8.65],
        radiusKm: 135,
        color: palette.hazard.flood,
      },
      {
        id: "rain",
        title: "Heavy rainfall · Equatoria",
        description: "Unpaved roads and last-mile access",
        probability: 0.35,
        center: [30.2, 5.1],
        radiusKm: 100,
        color: palette.hazard.rain,
      },
      {
        id: "security",
        title: "Checkpoint risk · Central corridor",
        description: "Road access and travel disruption",
        probability: 0.3,
        center: [31.63, 5.65],
        radiusKm: 52,
        color: palette.hazard.security,
      },
    ],
  };
}

export function components(network: Network, closed: string[]) {
  const unseen = new Set(network.nodes.map((n) => n.id)),
    groups: string[][] = [];
  while (unseen.size) {
    const first = unseen.values().next().value!,
      group = [first];
    unseen.delete(first);
    for (let i = 0; i < group.length; i++)
      for (const road of network.corridors) {
        if (closed.includes(road.id)) continue;
        const next =
          road.from === group[i]
            ? road.to
            : road.to === group[i]
              ? road.from
              : null;
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
      const legs = d.roadIds.map((id, i) => {
        const road = network.corridors.find((r) => r.id === id)!;
        return {
          corridorId: id,
          mode: road.mode,
          hours: road.hours,
          coordinates:
            road.from === d.path[i]
              ? road.coordinates
              : [...road.coordinates].reverse(),
        };
      });
      return {
        ...d,
        legs,
        coordinates: legs.flatMap((leg, i) =>
          i ? leg.coordinates.slice(1) : leg.coordinates,
        ),
        distanceKm: Math.round(
          d.roadIds.reduce(
            (sum, id) =>
              sum + network.corridors.find((r) => r.id === id)!.distanceKm,
            0,
          ),
        ),
      };
    }),
  };
}
