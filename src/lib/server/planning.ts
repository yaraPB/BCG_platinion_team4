import { network } from "../data/network";
import type { Community, Delivery, Hub, Network, Plan } from "../types";

type Previous = Map<string, { nodeId: string; roadId: string }>;

export class PlanInputError extends Error {}

export function parsePlanInput(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlanInputError("Request body must be a JSON object.");
  }
  const closed = (value as Record<string, unknown>).closedRoads;
  if (!Array.isArray(closed) || !closed.every((id) => typeof id === "string")) {
    throw new PlanInputError("closedRoads must be an array of corridor IDs.");
  }
  if (closed.length > network.corridors.length) {
    throw new PlanInputError(`Provide at most ${network.corridors.length} corridor IDs.`);
  }
  return [...new Set(closed)];
}

function shortestPaths(start: string, closed: Set<string>, model: Network) {
  const distance = new Map<string, number>([[start, 0]]);
  const previous: Previous = new Map();
  const unvisited = new Set(model.nodes.map((node) => node.id));

  // Dijkstra is intentionally simple for this small demonstration graph.
  while (unvisited.size) {
    let current: string | undefined;
    let minimum = Infinity;
    for (const id of unvisited) {
      if ((distance.get(id) ?? Infinity) < minimum) {
        current = id;
        minimum = distance.get(id)!;
      }
    }
    if (!current) break;
    unvisited.delete(current);

    for (const road of model.corridors) {
      if (closed.has(road.id)) continue;
      const neighbor = road.from === current ? road.to : road.to === current ? road.from : undefined;
      if (!neighbor || !unvisited.has(neighbor)) continue;
      const candidate = minimum + road.hours;
      if (candidate < (distance.get(neighbor) ?? Infinity)) {
        distance.set(neighbor, candidate);
        previous.set(neighbor, { nodeId: current, roadId: road.id });
      }
    }
  }
  return { distance, previous };
}

function traceFromHub(previous: Previous, hubId: string, destinationId: string) {
  const path = [hubId];
  const roadIds: string[] = [];
  let current = hubId;
  while (current !== destinationId) {
    const step = previous.get(current)!;
    path.push(step.nodeId);
    roadIds.push(step.roadId);
    current = step.nodeId;
  }
  return { path, roadIds };
}

function allocate(closed: Set<string>, model: Network, baseline?: Map<string, Delivery>): Plan {
  const hubs = model.nodes.filter((node): node is Hub => node.kind === "hub");
  const communities = model.nodes
    .filter((node): node is Community => node.kind === "community")
    .sort((a, b) => b.ipc - a.ipc || a.foodDays - b.foodDays || a.id.localeCompare(b.id));
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const stockRemaining = Object.fromEntries(hubs.map((hub) => [hub.id, hub.stockTonnes]));

  const deliveries: Delivery[] = communities.map((community) => {
    const { distance, previous } = shortestPaths(community.id, closed, model);
    const candidates = hubs
      .filter((hub) => distance.has(hub.id) && stockRemaining[hub.id] >= community.demandTonnes)
      .sort((a, b) => distance.get(a.id)! - distance.get(b.id)! || a.id.localeCompare(b.id));
    const supplier = candidates.find((hub) => hub.id === community.plannedHub) ?? candidates[0];
    const { path, roadIds } = supplier
      ? traceFromHub(previous, supplier.id, community.id)
      : { path: [], roadIds: [] };
    let status: Delivery["status"] = supplier ? "on-plan" : "unreachable";
    if (supplier && supplier.id !== community.plannedHub) status = "supplier-changed";
    else if (supplier && baseline && roadIds.join() !== baseline.get(community.id)?.roadIds.join()) status = "rerouted";
    if (supplier) stockRemaining[supplier.id] -= community.demandTonnes;

    const reason = status === "unreachable"
      ? "No reachable hub has enough stock for this community's full allocation."
      : status === "supplier-changed"
        ? `${supplier.name} is the nearest reachable hub with enough stock; the planned supplier cannot fulfil this allocation.`
        : status === "rerouted"
          ? "The planned supplier can still deliver using a different open path."
          : "The planned supplier and shortest open path are available.";

    return {
      communityId: community.id, name: community.name, people: community.people,
      requestedTonnes: community.demandTonnes, assignedTonnes: supplier ? community.demandTonnes : 0,
      ipc: community.ipc, foodDays: community.foodDays, plannedSupplierId: community.plannedHub,
      supplierId: supplier?.id ?? null, status, hours: supplier ? distance.get(supplier.id)! : null,
      path, roadIds, coordinates: path.map((id) => nodes.get(id)!.coordinates), reason,
    };
  });

  return {
    closedRoads: [...closed].sort(), deliveries, stockRemaining,
    summary: {
      reachablePeople: deliveries.filter((d) => d.supplierId).reduce((sum, d) => sum + d.people, 0),
      totalPeople: deliveries.reduce((sum, d) => sum + d.people, 0),
      assignedTonnes: deliveries.reduce((sum, d) => sum + d.assignedTonnes, 0),
      totalTonnes: deliveries.reduce((sum, d) => sum + d.requestedTonnes, 0),
      onPlan: deliveries.filter((d) => d.status === "on-plan").length,
      rerouted: deliveries.filter((d) => d.status === "rerouted").length,
      supplierChanged: deliveries.filter((d) => d.status === "supplier-changed").length,
      unreachable: deliveries.filter((d) => d.status === "unreachable").length,
    },
  };
}

export function calculatePlan(closedRoads: string[] = [], model: Network = network): Plan {
  const closed = new Set(closedRoads);
  const known = new Set(model.corridors.map((road) => road.id));
  const unknown = [...closed].filter((id) => !known.has(id));
  if (unknown.length) throw new PlanInputError(`Unknown corridor IDs: ${unknown.join(", ")}`);
  const baseline = closed.size
    ? new Map(allocate(new Set(), model).deliveries.map((delivery) => [delivery.communityId, delivery]))
    : undefined;
  return allocate(closed, model, baseline);
}
