import { api } from "@/lib/api";
import type { Simulation } from "@/lib/types";
import type { DeliveryStatus, Forecast, ForecastInput, HazardId, Network, Plan } from "./types";

const kindOf: Record<HazardId, string> = { flood: "flood", rain: "storm", security: "conflict" };

/**
 * Runs the forecast on the server: correlated disruption model (hazards co-occur; corridors inside a hazard area fail
 * together with kind-specific consequences), every future re-planned. The response is mapped to the view model.
 * Probabilities are the planner's 72-hour assumptions; shorter horizons scale survival by the horizon ratio.
 */
export async function simulateOutlook(network: Network, baseline: Plan, input: ForecastInput, signal: AbortSignal): Promise<Forecast> {
  const hazards = network.hazards.filter(h => input.probabilities[h.id] > 0).map(h => ({
    id: h.id, title: h.title, kind: kindOf[h.id], severity: "high",
    probability: 1 - Math.pow(1 - input.probabilities[h.id], input.horizon / 72),
    circle: [h.center[0], h.center[1], h.radiusKm],
  }));
  if (!hazards.length) throw new Error("Set at least one hazard above 0% to run the forecast.");
  const sim = await api<Simulation>("simulations", { body: { hazards, closedRoads: input.closedRoads, runs: 2000, seed: 417 }, signal });

  const closure = new Map(Object.entries(sim.corridorClosure));
  const roads = network.corridors.map(r => ({ id: r.id, probability: input.closedRoads.includes(r.id) ? 1 : closure.get(r.id) ?? 0 }))
    .sort((a, b) => b.probability - a.probability);
  const byDestination = new Map(sim.targets.map(t => [t.destination, t]));
  const destinations = baseline.deliveries.map(d => {
    const t = byDestination.get(d.communityId);
    const share = t?.statusShare ?? { "on-plan": 1, rerouted: 0, "supplier-changed": 0, airlift: 0 };
    const probabilities: Record<DeliveryStatus, number> = { "on-plan": share["on-plan"], rerouted: share.rerouted, "supplier-changed": share["supplier-changed"], unreachable: share.airlift };
    const top = t?.topPlans.find(p => p.kind !== "planned");
    const status: DeliveryStatus | null = top ? (top.kind === "airlift" ? "unreachable" : top.kind === "reroute" ? "rerouted" : "supplier-changed") : null;
    return { communityId: d.communityId, probabilities, contingency: top && status ? { status, hubId: top.kind === "airlift" ? null : top.supplier, probability: top.share } : null, triggerId: t?.topTrigger ?? null };
  });
  const hubs = sim.suppliers.map(s => ({ hubId: s.supplier, fallbackProbability: s.fallbackProbability, expectedFallbackTonnes: Math.round(s.expectedFallbackTonnes), reserveTonnes: Math.round(s.p90FallbackTonnes) }));
  return { runs: sim.runs, horizon: input.horizon, expectedPeople: Math.round(sim.expectedPeopleConnected), disruptionProbability: sim.pAnyDisruption, splitProbability: sim.pNetworkSplit, roads, destinations, hubs };
}
