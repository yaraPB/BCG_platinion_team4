import assert from "node:assert/strict";
import test from "node:test";
import { network } from "../src/lib/data/network";
import { calculatePlan } from "../src/lib/server/planning";
import {
  displayNetwork,
  displayPlan,
} from "../src/components/model/display-network";
import { pointAlong, vehiclePosition } from "../src/components/map/geometry";
import { simulateOutlook } from "../src/components/model/simulation";

const model = displayNetwork(network);
const baseline = displayPlan(calculatePlan(), model);

test("display geometry preserves dispatch decisions and connects every delivery leg", () => {
  for (const scenario of network.scenarios) {
    const source = calculatePlan(scenario.closedRoads),
      displayed = displayPlan(source, model);
    for (let i = 0; i < source.deliveries.length; i++) {
      const original = source.deliveries[i],
        delivery = displayed.deliveries[i];
      assert.equal(delivery.supplierId, original.supplierId);
      assert.deepEqual(delivery.roadIds, original.roadIds);
      assert.equal(delivery.assignedTonnes, original.assignedTonnes);
      for (let j = 0; j < delivery.legs.length; j++) {
        assert.deepEqual(
          delivery.legs[j].coordinates[0],
          network.nodes.find((n) => n.id === delivery.path[j])!.coordinates,
        );
        assert.deepEqual(
          delivery.legs[j].coordinates.at(-1),
          network.nodes.find((n) => n.id === delivery.path[j + 1])!.coordinates,
        );
        assert.ok(delivery.legs[j].coordinates.length > 10);
      }
    }
  }
});

test("transport interpolation follows distance and changes mode with each leg", () => {
  assert.deepEqual(
    pointAlong(
      [
        [0, 0],
        [1, 0],
        [3, 0],
      ],
      0.5,
    ).point,
    [1.5, 0],
  );
  const delivery = displayPlan(
    calculatePlan(["juba-bor"]),
    model,
  ).deliveries.find((d) => d.communityId === "bor")!;
  const river = delivery.legs.findIndex((l) => l.mode === "river");
  const riverStart = delivery.legs
    .slice(0, river)
    .reduce((sum, leg) => sum + leg.hours, 0);
  assert.equal(vehiclePosition(delivery, 0, riverStart + 0.1)?.mode, "river");
  const arrival = vehiclePosition(delivery, 0, 999)!.point;
  const destination = delivery.coordinates.at(-1)!;
  assert.ok(Math.hypot(arrival[0] - destination[0], arrival[1] - destination[1]) < 1e-8);
});

test("zero-risk browser preview preserves access and baseline outcomes", async () => {
  const forecast = await simulateOutlook(
    model,
    baseline,
    {
      closedRoads: [],
      probabilities: { flood: 0, rain: 0, security: 0 },
      horizon: 72,
    },
    new AbortController().signal,
  );
  assert.equal(forecast.expectedPeople, baseline.summary.totalPeople);
  assert.equal(forecast.disruptionProbability, 0);
  assert.equal(forecast.splitProbability, 0);
  assert.ok(
    forecast.destinations.every((d) => d.probabilities["on-plan"] === 1),
  );
});

test("browser preview honors explicit closures even with zero hazard probability", async () => {
  const forecast = await simulateOutlook(
    model,
    baseline,
    {
      closedRoads: model.corridors.map((r) => r.id),
      probabilities: { flood: 0, rain: 0, security: 0 },
      horizon: 24,
    },
    new AbortController().signal,
  );
  assert.equal(forecast.expectedPeople, 0);
  assert.equal(forecast.disruptionProbability, 1);
  assert.ok(
    forecast.destinations.every((d) => d.probabilities.unreachable === 1),
  );
});
