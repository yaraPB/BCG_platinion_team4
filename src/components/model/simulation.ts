import type {
  DeliveryStatus,
  Forecast,
  ForecastInput,
  Network,
  Plan,
} from "./types";

/** Browser-only scenario preview. Synthetic exposure, never a live risk forecast. */
export async function simulateOutlook(
  network: Network,
  baseline: Plan,
  input: ForecastInput,
  signal: AbortSignal,
): Promise<Forecast> {
  const runs = 2000,
    nodes = network.nodes,
    count = nodes.length;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const hubs = nodes.filter((n) => n.kind === "hub");
  const roads = network.corridors.map((road) => ({
    id: road.id,
    probability: input.closedRoads.includes(road.id)
      ? 1
      : 1 -
        Math.pow(
          Object.entries(road.exposure).reduce(
            (remaining, [hazard, exposure]) =>
              remaining *
              (1 -
                input.probabilities[
                  hazard as keyof typeof input.probabilities
                ] *
                  exposure),
            1,
          ),
          input.horizon / 72,
        ),
  }));
  let seed = 417,
    people = 0,
    disrupted = 0,
    splits = 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const outcomes = baseline.deliveries.map(() => ({
    "on-plan": 0,
    rerouted: 0,
    "supplier-changed": 0,
    unreachable: 0,
  }));
  const contingencies = baseline.deliveries.map(
    () => new Map<string, number>(),
  );
  const triggers = baseline.deliveries.map(() => new Map<string, number>());
  const fallbackSamples = Object.fromEntries(
    hubs.map((h) => [h.id, [] as number[]]),
  );
  for (let run = 0; run < runs; run++) {
    if (run % 100 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
    }
    const closed = new Set(
      roads.filter((r) => random() < r.probability).map((r) => r.id),
    );
    const distances = Array.from({ length: count }, (_, i) =>
      Array.from({ length: count }, (_, j) => (i === j ? 0 : Infinity)),
    );
    const paths: string[][][] = Array.from({ length: count }, () =>
      Array.from({ length: count }, () => []),
    );
    for (const r of network.corridors)
      if (!closed.has(r.id)) {
        const a = index.get(r.from)!,
          b = index.get(r.to)!;
        distances[a][b] = distances[b][a] = r.hours;
        paths[a][b] = paths[b][a] = [r.id];
      }
    for (let k = 0; k < count; k++)
      for (let i = 0; i < count; i++)
        for (let j = 0; j < count; j++)
          if (distances[i][k] + distances[k][j] < distances[i][j]) {
            distances[i][j] = distances[i][k] + distances[k][j];
            paths[i][j] = [...paths[i][k], ...paths[k][j]];
          }
    if (distances[0].some((d) => !Number.isFinite(d))) splits++;
    const stock = Object.fromEntries(hubs.map((h) => [h.id, h.stockTonnes]));
    const fallback = Object.fromEntries(hubs.map((h) => [h.id, 0]));
    let changed = false;
    baseline.deliveries.forEach((delivery, d) => {
      const destination = index.get(delivery.communityId)!;
      const options = hubs
        .filter(
          (h) =>
            Number.isFinite(distances[index.get(h.id)!][destination]) &&
            stock[h.id] >= delivery.requestedTonnes,
        )
        .sort(
          (a, b) =>
            distances[index.get(a.id)!][destination] -
              distances[index.get(b.id)!][destination] ||
            a.id.localeCompare(b.id),
        );
      const hub =
        options.find((h) => h.id === delivery.plannedSupplierId) ?? options[0];
      const status: DeliveryStatus = !hub
        ? "unreachable"
        : hub.id !== delivery.plannedSupplierId
          ? "supplier-changed"
          : paths[index.get(hub.id)!][destination].join() !==
              delivery.roadIds.join()
            ? "rerouted"
            : "on-plan";
      outcomes[d][status]++;
      if (hub) {
        stock[hub.id] -= delivery.requestedTonnes;
        people += delivery.people;
      }
      if (status !== "on-plan") {
        changed = true;
        const key = `${status}|${hub?.id ?? ""}`;
        contingencies[d].set(key, (contingencies[d].get(key) ?? 0) + 1);
        for (const id of delivery.roadIds.filter((id) => closed.has(id)))
          triggers[d].set(id, (triggers[d].get(id) ?? 0) + 1);
        if (status === "supplier-changed" && hub)
          fallback[hub.id] += delivery.requestedTonnes;
      }
    });
    if (changed) disrupted++;
    hubs.forEach((h) => fallbackSamples[h.id].push(fallback[h.id]));
  }
  return {
    runs,
    horizon: input.horizon,
    expectedPeople: Math.round(people / runs),
    disruptionProbability: disrupted / runs,
    splitProbability: splits / runs,
    roads: roads.sort((a, b) => b.probability - a.probability),
    destinations: baseline.deliveries.map((d, i) => {
      const top = [...contingencies[i]].sort((a, b) => b[1] - a[1])[0];
      return {
        communityId: d.communityId,
        probabilities: Object.fromEntries(
          Object.entries(outcomes[i]).map(([key, value]) => [
            key,
            value / runs,
          ]),
        ) as Record<DeliveryStatus, number>,
        contingency: top
          ? {
              status: top[0].split("|")[0] as DeliveryStatus,
              hubId: top[0].split("|")[1] || null,
              probability: top[1] / runs,
            }
          : null,
        triggerId: [...triggers[i]].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      };
    }),
    hubs: hubs.map((h) => {
      const samples = fallbackSamples[h.id].sort((a, b) => a - b);
      return {
        hubId: h.id,
        fallbackProbability: samples.filter((n) => n > 0).length / runs,
        expectedFallbackTonnes: Math.round(
          samples.reduce((a, b) => a + b, 0) / runs,
        ),
        reserveTonnes: samples[Math.floor(runs * 0.9)],
      };
    }),
  };
}
