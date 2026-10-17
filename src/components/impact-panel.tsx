"use client";

import { useEffect, useState } from "react";
import { CircleAlert, ExternalLink } from "lucide-react";
import { api, hours, usd } from "@/lib/api";
import { formatNumber } from "@/lib/presentation";
import type { Assumption, Impact, Network } from "@/lib/types";

export function ImpactPanel({ network, closedRoads }: { network: Network; closedRoads: string[] }) {
  const name = (id: string) => network.nodes.find((n) => n.id === id)?.name ?? id;
  const [closureDays, setClosureDays] = useState(14);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<Assumption[] | null>(null);
  const closedKey = closedRoads.join(",");

  useEffect(() => {
    if (!closedRoads.length) return;
    const controller = new AbortController();
    api<Impact>("impact", { body: { closedRoads, closureDays }, signal: controller.signal })
      .then((result) => { setImpact(result); setError(null); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to compute savings."); });
    return () => controller.abort();
  }, [closedKey, closureDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = closedRoads.length ? impact : null;
  const t = shown?.totals;
  return <section id="savings" className="tool-section">
    <div className="section-heading"><div><p className="eyebrow">SAVINGS</p><h2>What the fallback is worth.</h2></div><p>For the current closures, compared with no prepared fallback.</p></div>
    <div className="panel tool-panel">
      {!closedRoads.length && <p className="empty-state">Close a corridor or choose a scenario in the control tower to see the savings table.</p>}
      {error && <p className="error-banner" role="alert"><CircleAlert size={15} />{error}</p>}
      {shown && t && <>
        <div className="form-row"><label>Assumed closure length (days)<input type="number" min={1} max={365} value={closureDays} onChange={(e) => setClosureDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} /></label></div>
        <div className="kpis">
          <div className="kpi"><span>Deliveries disrupted</span><strong>{t.deliveriesDisrupted}</strong><small>{t.deliveriesWithLandFallback} with a road/river fallback</small></div>
          <div className="kpi"><span>Saved vs emergency airlift</span><strong>{usd(t.usdSavedVsAirlift)}</strong><small>air at {usd(shown.basis.airCostPerT)}/t (WFP)</small></div>
          <div className="kpi"><span>Extra cost vs plan</span><strong>{usd(t.extraUsdVsPlan)}</strong><small>the fallback is not free</small></div>
          <div className="kpi"><span>People-days of food protected</span><strong>{formatNumber(t.peopleDaysProtectedVsWaiting)}</strong><small>vs waiting {shown.basis.closureDaysAssumed} days for reopening</small></div>
        </div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Community</th><th>People</th><th>Tonnes</th><th>Planned</th><th>Fallback</th><th>Fallback time</th><th>Saved vs airlift</th><th>Extra vs plan</th><th>People-days protected</th></tr></thead>
          <tbody>{shown.rows.map((r) => <tr key={r.destination}>
            <td>{r.name}</td><td>{formatNumber(r.people)}</td><td>{r.tonnes}</td>
            <td>{name(r.plannedSupplier)} · {r.plannedCostPerT === null ? "—" : `${usd(r.plannedCostPerT)}/t`}</td>
            <td>{r.fallbackKind === "airlift" ? "Air (last resort)" : `${name(r.fallbackSupplier)} · ${r.fallbackModes.join(" + ")}`} · {usd(r.fallbackCostPerT)}/t</td>
            <td>{hours(r.fallbackHours)}</td><td>{usd(r.usdSavedVsAirlift)}</td><td>{usd(r.extraUsdVsPlan)}</td><td>{formatNumber(Math.round(r.peopleDaysProtectedVsWaiting))}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="muted basis">{shown.basis.statement} Tonnes = caseload × {shown.basis.rationKgPerPersonDay} kg/person/day × {shown.basis.cycleDays} days.</p>
      </>}
      <details className="assumptions" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !assumptions) void api<{ unitRates: Assumption[] }>("assumptions").then((a) => setAssumptions(a.unitRates)); }}>
        <summary>Unit rates and sources</summary>
        {assumptions ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Value</th><th>Basis</th><th>Source</th></tr></thead><tbody>
          {assumptions.map((a) => <tr key={a.key}><td>{a.label}</td><td>{a.value} {a.unit}</td><td><span className={`chip chip-${a.kind}`}>{a.kind}</span></td><td>{a.source}{a.url && <> <a href={a.url} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink size={11} /></a></>}</td></tr>)}
        </tbody></table></div> : <p className="muted">Loading…</p>}
      </details>
    </div>
  </section>;
}
