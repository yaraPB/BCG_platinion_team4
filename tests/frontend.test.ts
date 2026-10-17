import assert from "node:assert/strict";
import test from "node:test";
import type { Network as SourceNetwork, Plan as SourcePlan } from "../src/lib/types";
import { displayNetwork, displayPlan } from "../src/components/model/display-network";
import { pointAlong, vehiclePosition } from "../src/components/map/geometry";
import { simulateOutlook } from "../src/components/model/simulation";
// Recorded responses of the ViaMensa API (GET /v1/network, POST /v1/plan). Regenerate with backend/scripts if the
// network changes.
import networkFixture from "./fixtures/api-network.json";
import plansFixture from "./fixtures/api-plans.json";

const network = networkFixture as unknown as SourceNetwork;
const plans = plansFixture as unknown as Record<"open" | "juba-bor" | "sobat", SourcePlan>;
const model = displayNetwork(network);
const baseline = displayPlan(plans.open, model);
const close = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

test("display model draws API geometry, hides port transfers and keeps dispatch decisions", () => {
  assert.ok(model.corridors.every((r) => r.mode === "road" || r.mode === "river"));
  assert.ok(model.corridors.some((r) => r.mode === "river"));
  assert.ok(model.corridors.find((r) => r.id === "juba-bor")!.coordinates.length > 10);
  for (const source of Object.values(plans)) {
    const displayed = displayPlan(source, model);
    source.deliveries.forEach((original, i) => {
      const delivery = displayed.deliveries[i];
      assert.equal(delivery.supplierId, original.supplierId);
      assert.deepEqual(delivery.roadIds, original.roadIds);
      // Consecutive drawn legs connect (ports share their town's coordinates, so skipped transfers leave no gap).
      for (let j = 1; j < delivery.legs.length; j++) {
        assert.ok(close(delivery.legs[j - 1].coordinates.at(-1)!, delivery.legs[j].coordinates[0]));
      }
      if (delivery.legs.length) {
        const start = network.nodes.find((n) => n.id === original.supplierId)!.coordinates;
        const end = network.nodes.find((n) => n.id === original.communityId)!.coordinates;
        assert.ok(close(delivery.legs[0].coordinates[0], start), `${original.name} starts at its supplier`);
        assert.ok(close(delivery.legs.at(-1)!.coordinates.at(-1)!, end), `${original.name} ends at the community`);
      }
    });
  }
});

test("transport interpolation follows distance and switches to the barge when the road is cut", () => {
  assert.deepEqual(pointAlong([[0, 0], [1, 0], [3, 0]], 0.5).point, [1.5, 0]);
  const bor = displayPlan(plans["juba-bor"], model).deliveries.find((d) => d.communityId === "bor")!;
  assert.equal(bor.status, "rerouted");
  const river = bor.legs.findIndex((l) => l.mode === "river");
  assert.ok(river >= 0, "Juba–Bor closed: Bor is supplied by river");
  const riverStart = bor.legs.slice(0, river).reduce((sum, leg) => sum + leg.hours, 0);
  assert.equal(vehiclePosition(bor, 0, riverStart + 0.1)?.mode, "river");
  const arrival = vehiclePosition(bor, 0, 9999)!.point;
  assert.ok(close(arrival, bor.coordinates.at(-1)!));
});

test("network split is visible in the display components", () => {
  const sobat = displayPlan(plans.sobat, model);
  const nasir = sobat.components.find((g) => g.includes("nasir"))!;
  assert.ok(!nasir.includes("malakal"), "Nasir is cut off from Malakal");
  assert.equal(sobat.deliveries.find((d) => d.communityId === "nasir")!.status, "unreachable");
});

test("forecast is computed on the server and mapped to the view model", async () => {
  const original = globalThis.fetch;
  let sent: { hazards: { kind: string; probability: number; circle: number[] }[]; closedRoads: string[] } | null = null;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    const target = (destination: string, share: Record<string, number>, top: object[], trigger: string | null) => ({
      origin: "juba", destination, tonnes: 10, people: 1000, statusShare: share, pBaselineBlocked: 0.4,
      costPerT: { mean: 1, p50: 1, p90: 1 }, hours: { mean: 1, p50: 1, p90: 1 }, baselineCostPerT: 1, baselineHours: 1,
      topPlans: top, expectedSavings: { usdVsAirlift: 0, peopleDaysVsWaiting: 0, pLandFallbackWhenCut: 0 }, topTrigger: trigger,
    });
    return new Response(JSON.stringify({
      id: "x", createdAt: "", runs: 2000, seed: 417, objective: "cost", uniqueStates: 10, elapsedMs: 5,
      pNetworkSplit: 0.3, pAnyDisruption: 0.6, expectedPeopleConnected: 123456,
      suppliers: [{ supplier: "malakal", fallbackProbability: 0.2, expectedFallbackTonnes: 12.4, p90FallbackTonnes: 40.6 }],
      hazards: [], corridorClosure: { "juba-bor": 0.55 }, planB: [], playbook: [], modelNotes: [],
      impact: { expectedUsdSavedVsAirlift: 0, expectedPeopleDaysProtectedVsWaiting: 0, basis: "" },
      targets: [
        target("bor", { "on-plan": 0.4, rerouted: 0.5, "supplier-changed": 0, airlift: 0.1 },
          [{ kind: "planned", supplier: "juba", share: 0.4 }, { kind: "reroute", supplier: "juba", share: 0.5 }], "juba-bor"),
        target("nasir", { "on-plan": 0.7, rerouted: 0, "supplier-changed": 0, airlift: 0.3 },
          [{ kind: "airlift", supplier: "malakal", share: 0.3 }], "ulang-nasir"),
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const forecast = await simulateOutlook(model, baseline,
      { closedRoads: ["bor-pibor"], probabilities: { flood: 0.5, rain: 0, security: 0.2 }, horizon: 24 },
      new AbortController().signal);
    // request: only non-zero hazards, horizon-scaled probabilities, circle footprints, closures passed through
    assert.deepEqual(sent!.hazards.map((h) => h.kind), ["flood", "conflict"]);
    assert.ok(Math.abs(sent!.hazards[0].probability - (1 - Math.pow(0.5, 24 / 72))) < 1e-9);
    assert.equal(sent!.hazards[0].circle.length, 3);
    assert.deepEqual(sent!.closedRoads, ["bor-pibor"]);
    // response mapping
    assert.equal(forecast.expectedPeople, 123456);
    assert.equal(forecast.disruptionProbability, 0.6);
    assert.equal(forecast.roads[0].id, "bor-pibor"); // explicitly closed sorts first (probability 1)
    const bor = forecast.destinations.find((d) => d.communityId === "bor")!;
    assert.equal(bor.contingency?.status, "rerouted");
    assert.equal(bor.triggerId, "juba-bor");
    const nasir = forecast.destinations.find((d) => d.communityId === "nasir")!;
    assert.equal(nasir.probabilities.unreachable, 0.3);
    assert.equal(nasir.contingency?.hubId, null); // air delivery has no road supplier
    assert.deepEqual(forecast.hubs[0], { hubId: "malakal", fallbackProbability: 0.2, expectedFallbackTonnes: 12, reserveTonnes: 41 });
  } finally {
    globalThis.fetch = original;
  }
});

test("forecast refuses to run with every hazard at zero", async () => {
  await assert.rejects(
    simulateOutlook(model, baseline, { closedRoads: [], probabilities: { flood: 0, rain: 0, security: 0 }, horizon: 72 },
      new AbortController().signal),
    /at least one hazard/,
  );
});
