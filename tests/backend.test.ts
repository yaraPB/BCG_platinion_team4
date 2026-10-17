import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { apiBaseUrl, BackendError, backendJson, backendUrl } from "../src/lib/server/backend";

afterEach(() => { delete process.env.VIAMENSA_API_URL; });

test("backend URL builder only allows plain /v1 paths", () => {
  process.env.VIAMENSA_API_URL = "https://api.example.test/";
  assert.equal(apiBaseUrl(), "https://api.example.test");
  assert.equal(backendUrl(["plan"]), "https://api.example.test/v1/plan");
  assert.equal(backendUrl(["alerts", "123e4567-e89b-12d3-a456-426614174000"]), "https://api.example.test/v1/alerts/123e4567-e89b-12d3-a456-426614174000");
  assert.equal(backendUrl(["analyses", "latest"], "?x=1"), "https://api.example.test/v1/analyses/latest?x=1");
  for (const bad of [[], [".."], ["plan", ".."], ["a/b"], ["%2e%2e"], ["http:"], ["x y"]]) {
    assert.throws(() => backendUrl(bad), /Invalid API path/, JSON.stringify(bad));
  }
});

test("backendJson attaches the bearer token and surfaces API errors", async () => {
  const original = globalThis.fetch;
  const seen: { url: string; auth: string | null; type: string | null }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen.push({ url, auth: headers.get("Authorization"), type: headers.get("Content-Type") });
    if (url.endsWith("/v1/fail")) return new Response(JSON.stringify({ detail: "Unknown corridor id(s): x" }), { status: 400 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    process.env.VIAMENSA_API_URL = "http://api";
    assert.deepEqual(await backendJson("/v1/plan", "tok", { method: "POST", body: "{}" }), { ok: true });
    assert.deepEqual(seen[0], { url: "http://api/v1/plan", auth: "Bearer tok", type: "application/json" });
    await assert.rejects(backendJson("/v1/fail", "tok"), (error: unknown) => error instanceof BackendError && error.status === 400 && error.message.startsWith("Unknown corridor"));
  } finally {
    globalThis.fetch = original;
  }
});
