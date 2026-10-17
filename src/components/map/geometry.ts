import type { FeatureCollection, LineString, Point } from "geojson";
import type { Coordinate, Network, Plan } from "@/lib/types";

export const emptyCollection = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

export function networkFeatures(network: Network, plan: Plan, selectedId: string) {
  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  const roads: FeatureCollection<LineString> = { type: "FeatureCollection", features: network.corridors.map((road) => ({ type: "Feature", properties: { id: road.id, closed: plan.closedRoads.includes(road.id) }, geometry: { type: "LineString", coordinates: [nodes.get(road.from)!.coordinates, nodes.get(road.to)!.coordinates] } })) };
  const points: FeatureCollection<Point> = { type: "FeatureCollection", features: network.nodes.map((node) => ({ type: "Feature", properties: { id: node.id, name: node.name, kind: node.kind, selected: node.id === selectedId }, geometry: { type: "Point", coordinates: node.coordinates } })) };
  const paths: FeatureCollection<LineString> = { type: "FeatureCollection", features: plan.deliveries.filter((delivery) => delivery.supplierId).map((delivery) => ({ type: "Feature", properties: { id: delivery.communityId, status: delivery.status, selected: delivery.communityId === selectedId }, geometry: { type: "LineString", coordinates: delivery.coordinates } })) };
  return { roads, points, paths };
}

export function pointAlongRoute(coordinates: Coordinate[], fraction: number): Coordinate {
  if (coordinates.length < 2) return coordinates[0];
  const lengths = coordinates.slice(1).map((b, i) => {
    const a = coordinates[i];
    return Math.hypot((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]);
  });
  let remaining = fraction * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const progress = lengths[i] ? Math.min(1, remaining / lengths[i]) : 0;
      const a = coordinates[i], b = coordinates[i + 1];
      return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress];
    }
    remaining -= lengths[i];
  }
  return coordinates[coordinates.length - 1];
}

export function vehicleFeatures(plan: Plan, phase: number): FeatureCollection<Point> {
  return { type: "FeatureCollection", features: plan.deliveries.filter((delivery) => delivery.supplierId).map((delivery, i) => ({ type: "Feature", properties: { id: delivery.communityId }, geometry: { type: "Point", coordinates: pointAlongRoute(delivery.coordinates, (phase + i * 0.13) % 1) } })) };
}
