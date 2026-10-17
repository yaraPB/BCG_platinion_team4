"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Navigation, Split } from "lucide-react";
import { api, hours, usd } from "@/lib/api";
import type { DeliveryOption, Itinerary, Network } from "@/lib/types";

const kindLabel: Record<DeliveryOption["kind"], string> = { planned: "Planned route", reroute: "Detour, same supplier", switch_supplier: "Switch supplier", airlift: "Air delivery" };

export function ItineraryPanel({ network, closedRoads }: { network: Network; closedRoads: string[] }) {
  const hubs = network.nodes.filter((n) => n.kind === "hub");
  const communities = network.nodes.filter((n) => n.kind === "community");
  const name = (id: string) => network.nodes.find((n) => n.id === id)?.name ?? id;
  const [origin, setOrigin] = useState(hubs[0]?.id ?? "");
  const [destination, setDestination] = useState(communities[0]?.id ?? "");
  const [objective, setObjective] = useState<"cost" | "time">("cost");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      setResult(await api<Itinerary>("itineraries", { body: { origin, destination, objective, closedRoads } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to plan the itinerary.");
    } finally {
      setPending(false);
    }
  }, [origin, destination, objective, closedRoads]);

  // Re-plan automatically when the closures change after a first run (state is only set in the async callback).
  const closedKey = closedRoads.join(",");
  const hasRun = useRef(false);
  useEffect(() => { hasRun.current = result !== null; }, [result]);
  useEffect(() => {
    if (!hasRun.current) return;
    const controller = new AbortController();
    api<Itinerary>("itineraries", { body: { origin, destination, objective, closedRoads }, signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to plan the itinerary."); });
    return () => controller.abort();
  }, [closedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <section id="itinerary" className="tool-section">
    <div className="section-heading"><div><p className="eyebrow">ITINERARY</p><h2>Plan a delivery from A to B.</h2></div><p>Uses the current closures ({closedRoads.length}). Cheapest option wins: detour or another supplier.</p></div>
    <div className="panel tool-panel">
      <div className="form-row">
        <label>From supplier<select value={origin} onChange={(e) => setOrigin(e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label>To community<select value={destination} onChange={(e) => setDestination(e.target.value)}>{communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Optimise for<select value={objective} onChange={(e) => setObjective(e.target.value as "cost" | "time")}><option value="cost">Lowest cost</option><option value="time">Fastest</option></select></label>
        <button className="button primary" onClick={() => void run()} disabled={pending}><Navigation size={14} />{pending ? "Planning…" : "Plan itinerary"}</button>
      </div>
      {error && <p className="error-banner" role="alert"><CircleAlert size={15} />{error}</p>}
      {result && <>
        <div className="result-head">
          <span className={`chip chip-${result.status}`}>{result.status.replace("-", " ")}</span>
          <p>{result.explanation}</p>
          {result.split && <p className="split-note"><Split size={14} />Network split: {name(result.destination)} is only connected to {result.destinationComponent.filter((id) => network.nodes.find((n) => n.id === id)?.kind === "hub").map(name).join(", ") || "no supplier"}.</p>}
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Option</th><th>Supplier</th><th>Route</th><th>Distance</th><th>Time</th><th>Cost / t</th><th>Total ({result.tonnes.toFixed(0)} t)</th></tr></thead>
          <tbody>
            {result.baseline && <tr className="row-muted"><td>Plan (all roads open)</td><td>{name(result.baseline.supplier)}</td><td>{result.baseline.modes.join(" + ")}</td><td>{Math.round(result.baseline.km)} km</td><td>{hours(result.baseline.hours)}</td><td>{usd(result.baseline.costPerTonne)}</td><td>{usd(result.baseline.costPerTonne * result.tonnes)}</td></tr>}
            {result.options.slice(0, 6).map((o, i) => <tr key={`${o.kind}-${o.supplier}`} className={i === 0 ? "row-best" : ""}>
              <td>{kindLabel[o.kind]}{i === 0 && <span className="best-tag">best</span>}</td><td>{name(o.supplier)}</td>
              <td title={o.route?.nodes.map(name).join(" → ")}>{o.route ? o.route.modes.join(" + ") : "air"}</td>
              <td>{o.route ? `${Math.round(o.route.km)} km` : `${Math.round(o.airKm ?? 0)} km (air)`}</td><td>{hours(o.hours)}</td><td>{usd(o.costPerTonne)}</td><td>{usd(o.totalCostUsd)}</td>
            </tr>)}
          </tbody>
        </table></div>
        {result.best.route && <p className="muted route-line">Route: {result.best.route.nodes.map(name).join(" → ")}</p>}
      </>}
    </div>
  </section>;
}
