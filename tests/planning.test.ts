import assert from "node:assert/strict";
import { test } from "node:test";
import { network } from "../src/lib/data/network";
import { calculatePlan, parsePlanInput, PlanInputError } from "../src/lib/server/planning";

test("baseline reaches every community and conserves hub inventory", () => {
  const plan = calculatePlan();
  assert.equal(plan.summary.onPlan, 7);
  assert.equal(plan.summary.reachablePeople, 110400);
  assert.equal(plan.summary.assignedTonnes, 168);
  for (const hub of network.nodes.filter((node) => node.kind === "hub")) {
    const used = plan.deliveries.filter((delivery) => delivery.supplierId === hub.id).reduce((sum, delivery) => sum + delivery.assignedTonnes, 0);
    assert.equal(used + plan.stockRemaining[hub.id], hub.stockTonnes);
  }
});

test("every scenario uses only open, contiguous corridors and never overspends stock", () => {
  for (const scenario of network.scenarios) {
    const plan = calculatePlan(scenario.closedRoads);
    assert.ok(Object.values(plan.stockRemaining).every((value) => value >= 0));
    for (const delivery of plan.deliveries) {
      assert.ok(delivery.roadIds.every((id) => !scenario.closedRoads.includes(id)));
      if (!delivery.supplierId) {
        assert.equal(delivery.assignedTonnes, 0);
        assert.equal(delivery.hours, null);
        assert.deepEqual(delivery.path, []);
        continue;
      }
      assert.equal(delivery.path[0], delivery.supplierId);
      assert.equal(delivery.path.at(-1), delivery.communityId);
      let hours = 0;
      for (const [index, id] of delivery.roadIds.entries()) {
        const road = network.corridors.find((candidate) => candidate.id === id)!;
        assert.deepEqual(new Set([road.from, road.to]), new Set(delivery.path.slice(index, index + 2)));
        hours += road.hours;
      }
      assert.equal(delivery.hours, hours);
    }
  }
});

test("presets demonstrate rerouting, supplier changes and isolation", () => {
  const plans = Object.fromEntries(network.scenarios.map((scenario) => [scenario.id, calculatePlan(scenario.closedRoads)]));
  assert.equal(plans.bor.deliveries.find((d) => d.communityId === "bor")?.status, "rerouted");
  assert.equal(plans.flood.deliveries.find((d) => d.communityId === "bor")?.status, "unreachable");
  assert.equal(plans.flood.summary.reachablePeople, 92000);
  assert.equal(plans.compound.summary.supplierChanged, 2);
});

test("scarce stock is reserved for the most urgent feasible community", () => {
  const scarce = structuredClone(network);
  for (const node of scarce.nodes) if (node.kind === "hub") node.stockTonnes = node.id === "juba" ? 40 : 0;
  const plan = calculatePlan([], scarce);
  assert.equal(plan.deliveries[0].communityId, "bentiu");
  assert.equal(plan.deliveries[0].assignedTonnes, 34);
  assert.equal(plan.deliveries[0].supplierId, "juba");
  assert.equal(plan.summary.assignedTonnes, 34);
  assert.equal(plan.stockRemaining.juba, 6);
});

test("closing the entire network leaves inventory untouched and every destination unserved", () => {
  const plan = calculatePlan(network.corridors.map((road) => road.id));
  assert.equal(plan.summary.unreachable, 7);
  assert.equal(plan.summary.assignedTonnes, 0);
  assert.equal(plan.summary.reachablePeople, 0);
});

test("requests reject unknown roads and invalid shape; repeated requests do not mutate the network", () => {
  assert.throws(() => calculatePlan(["missing"]), PlanInputError);
  for (const invalid of [null, [], {}, { closedRoads: "juba-bor" }, { closedRoads: [2] }]) assert.throws(() => parsePlanInput(invalid), PlanInputError);
  assert.deepEqual(parsePlanInput({ closedRoads: ["juba-bor", "juba-bor"] }), ["juba-bor"]);
  const before = calculatePlan();
  calculatePlan(network.corridors.map((road) => road.id));
  assert.deepEqual(calculatePlan(), before);
});
