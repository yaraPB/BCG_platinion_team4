import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../src/app/api/plan/route";
import { GET as getNetwork } from "../src/app/api/network/route";

const request = (body: string, contentType = "application/json") => new Request("http://localhost/api/plan", { method: "POST", headers: { "Content-Type": contentType }, body });

test("network and baseline endpoints return the shared server model", async () => {
  const model = await getNetwork().json();
  assert.equal(model.region, "South Sudan");
  assert.equal(model.corridors.length, 15);
  const response = GET();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).summary.onPlan, 7);
});

test("POST calculates a changed plan", async () => {
  const response = await POST(request(JSON.stringify({ closedRoads: ["juba-bor"] })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).summary.rerouted, 1);
});

test("POST responds clearly to malformed or unknown input", async () => {
  for (const body of ["{", "[]", "null", "{}", '{"closedRoads":["missing"]}']) {
    const response = await POST(request(body));
    assert.equal(response.status, 400, body);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal((await POST(request("{}", "text/plain"))).status, 415);
  assert.equal((await POST(request("{}", "application/jsonp"))).status, 415);
  assert.equal((await POST(request(" ".repeat(4097)))).status, 413);
});
