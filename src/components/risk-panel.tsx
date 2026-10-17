"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CircleAlert, Dices, Plus, Trash2 } from "lucide-react";
import { api, hours, pct, usd } from "@/lib/api";
import { formatNumber } from "@/lib/presentation";
import type { Alert, Analysis, Network, Simulation } from "@/lib/types";

const likelihoodLabel = { very_likely: "Very likely", likely: "Likely", possible: "Possible", unlikely: "Unlikely" };
const shareColors = { "on-plan": "#287b61", rerouted: "#547aa3", "supplier-changed": "#a97529", airlift: "#b74a43" } as const;

export function RiskPanel({ network, closedRoads, autoRunKey = 0 }: {
  network: Network;
  closedRoads: string[];
  /** Changing this number analyses all alerts and simulates them (demo guide). */
  autoRunKey?: number;
}) {
  const name = (id: string) => network.nodes.find((n) => n.id === id)?.name ?? network.corridors.find((c) => c.id === id)?.name ?? id;
  const hubs = network.nodes.filter((n) => n.kind === "hub");
  const communities = network.nodes.filter((n) => n.kind === "community");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState({ title: "", body: "", source: "" });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"network" | "itinerary">("network");
  const [origin, setOrigin] = useState(hubs[0]?.id ?? "");
  const [destination, setDestination] = useState(communities[0]?.id ?? "");
  const [runs, setRuns] = useState(5000);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState<null | "alert" | "analyze" | "simulate">(null);
  const [error, setError] = useState<string | null>(null);
  const results = useRef<HTMLDivElement>(null);
  const revealResults = useRef(false);

  useEffect(() => { api<Alert[]>("alerts").then(setAlerts).catch(() => setError("Unable to load alerts.")); }, []);
  useEffect(() => {
    if (!autoRunKey) return;
    let cancelled = false;
    api<Analysis>("alerts/analyze", { body: { horizonDays: 7 } })
      .then(async (result) => {
        if (cancelled) return;
        setAnalysis(result);
        setSelected(new Set(result.issues.map((i) => i.id)));
        const simulation = await api<Simulation>("simulations", { body: { analysisId: result.id, runs: 5000, closedRoads } });
        if (cancelled) return;
        revealResults.current = true;
        setSim(simulation);
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Request failed."); });
    return () => { cancelled = true; };
  }, [autoRunKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // After a demo auto-run, bring the simulation results into view.
    if (!sim || !revealResults.current) return;
    revealResults.current = false;
    results.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sim]);

  async function guard<T>(kind: "alert" | "analyze" | "simulate", fn: () => Promise<T>) {
    setBusy(kind);
    setError(null);
    try { return await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); } finally { setBusy(null); }
  }

  const addAlert = () => guard("alert", async () => {
    const created = await api<Alert>("alerts", { body: { ...draft, source: draft.source || "Pasted by planner" } });
    setAlerts((list) => [created, ...list]);
    setDraft({ title: "", body: "", source: "" });
  });
  const removeAlert = (id: string) => guard("alert", async () => { await api<void>(`alerts/${id}`, { method: "DELETE" }); setAlerts((l) => l.filter((a) => a.id !== id)); });
  const analyze = () => guard("analyze", async () => {
    const result = await api<Analysis>("alerts/analyze", { body: { horizonDays: 7 } });
    setAnalysis(result);
    setSelected(new Set(result.issues.map((i) => i.id)));
    setSim(null);
  });
  const simulate = () => guard("simulate", async () => {
    if (!analysis) return;
    const body: Record<string, unknown> = { analysisId: analysis.id, issueIds: [...selected], runs, closedRoads };
    if (scope === "itinerary") Object.assign(body, { origin, destination });
    setSim(await api<Simulation>("simulations", { body }));
  });

  return <section id="risk" className="tool-section">
    <div className="section-heading"><div><p className="eyebrow">RISK &amp; FALLBACK</p><h2>Read the news, prepare the fallback.</h2></div><p>Alerts → ranked issues mapped to your corridors → correlated simulation.</p></div>
    {error && <p className="error-banner" role="alert"><CircleAlert size={15} />{error}</p>}
    <div className="tool-grid">
      <div className="panel tool-panel">
        <h3>Alerts and news <span className="count">{alerts.length}</span></h3>
        <div className="alert-form">
          <input placeholder="Headline" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea placeholder="Paste the report or news text" rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="form-row"><input placeholder="Source (optional)" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /><button className="button" disabled={busy !== null || draft.title.length < 3 || draft.body.length < 3} onClick={() => void addAlert()}><Plus size={14} />Add alert</button></div>
        </div>
        <ul className="alert-list">{alerts.map((a) => <li key={a.id}><div><strong>{a.title}</strong><span className="muted">{a.source}{a.isSample ? "" : " · added"}</span><p>{a.body}</p></div><button className="icon-button" aria-label={`Delete alert ${a.title}`} disabled={busy !== null} onClick={() => void removeAlert(a.id)}><Trash2 size={14} /></button></li>)}</ul>
        <button className="button primary" disabled={busy !== null || !alerts.length} onClick={() => void analyze()}><BrainCircuit size={14} />{busy === "analyze" ? "Analysing…" : "Analyse alerts"}</button>
      </div>

      <div className="panel tool-panel">
        <h3>Ranked issues</h3>
        {!analysis && <p className="empty-state">Run the analysis to rank the issues that could disrupt your deliveries.</p>}
        {analysis && <>
          <p className="muted">{analysis.engine === "claude" ? `AI analyst (${analysis.model})` : "Rule-based analyst"}{analysis.engineNote ? ` · ${analysis.engineNote}` : ""}</p>
          <p className="summary">{analysis.summary}</p>
          <ul className="issue-list">{analysis.issues.map((i) => <li key={i.id}>
            <label><input type="checkbox" checked={selected.has(i.id)} onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(i.id); else next.delete(i.id); setSelected(next); }} />
              <span className="issue-rank">#{i.rank}</span><strong>{i.title}</strong></label>
            <div className="issue-meta"><span className={`chip chip-${i.likelihood}`}>{likelihoodLabel[i.likelihood]} · {pct(i.probability)}</span><span className="chip">{i.kind.replace("_", " ")}</span><span className="chip">{i.severity} impact</span><span className="chip">{i.durationDays} days</span></div>
            <p className="muted">{[...i.affectedCorridorIds, ...i.affectedNodeIds].map(name).join(" · ")}</p>
            <p>{i.rationale}</p>
          </li>)}</ul>
          <p className="muted basis">{analysis.notice}</p>
          <div className="form-row sim-controls">
            <label>Scope<select value={scope} onChange={(e) => setScope(e.target.value as "network" | "itinerary")}><option value="network">All deliveries</option><option value="itinerary">One itinerary</option></select></label>
            {scope === "itinerary" && <><label>From<select value={origin} onChange={(e) => setOrigin(e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
              <label>To<select value={destination} onChange={(e) => setDestination(e.target.value)}>{communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
            <label>Futures<select value={runs} onChange={(e) => setRuns(Number(e.target.value))}>{[1000, 5000, 20000].map((n) => <option key={n} value={n}>{formatNumber(n)}</option>)}</select></label>
            <button className="button primary" disabled={busy !== null || !selected.size} onClick={() => void simulate()}><Dices size={14} />{busy === "simulate" ? "Simulating…" : "Run simulation"}</button>
          </div>
        </>}
      </div>
    </div>

    {sim && <div ref={results} className="panel tool-panel sim-results">
      <div className="kpis">
        <div className="kpi"><span>Futures simulated</span><strong>{formatNumber(sim.runs)}</strong><small>{formatNumber(sim.uniqueStates)} distinct network states · {Math.round(sim.elapsedMs)} ms</small></div>
        <div className="kpi"><span>{closedRoads.length ? "Further network splits" : "Network splits"}</span><strong>{pct(sim.pNetworkSplit)}</strong><small>{closedRoads.length ? "of futures split it beyond the current closures" : "of futures cut the network into islands"}</small></div>
        <div className="kpi"><span>Expected saving vs airlift</span><strong>{usd(sim.impact.expectedUsdSavedVsAirlift)}</strong><small>per cycle, from prepared fallbacks</small></div>
        <div className="kpi"><span>People-days protected</span><strong>{formatNumber(sim.impact.expectedPeopleDaysProtectedVsWaiting)}</strong><small>vs waiting for roads to reopen</small></div>
      </div>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Delivery</th><th>Planned route cut</th><th>Outcome across futures</th><th>Expected cost / t</th><th>Most likely fallback</th></tr></thead>
        <tbody>{sim.targets.map((t) => { const fallback = t.topPlans.find((p) => p.kind !== "planned"); return <tr key={`${t.origin}-${t.destination}`}>
          <td>{name(t.origin)} → {name(t.destination)}</td><td>{pct(t.pBaselineBlocked)}</td>
          <td><div className="stack-bar" role="img" aria-label={Object.entries(t.statusShare).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}>{(Object.keys(shareColors) as (keyof typeof shareColors)[]).map((k) => t.statusShare[k] > 0 && <span key={k} title={`${k}: ${pct(t.statusShare[k])}`} style={{ width: `${t.statusShare[k] * 100}%`, background: shareColors[k] }} />)}</div></td>
          <td>{usd(t.costPerT.mean)}{t.baselineCostPerT !== null && <small className="muted"> (plan {usd(t.baselineCostPerT)})</small>}</td>
          <td>{fallback ? `${fallback.kind === "airlift" ? "Air" : name(fallback.supplier)} · ${pct(fallback.share)} of futures` : "—"}</td>
        </tr>; })}</tbody>
      </table></div>
      <div className="legend-row">{Object.entries(shareColors).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k.replace("-", " ")}</span>)}</div>

      {sim.planB.length > 0 && <><h3>Plan B: routes to commit to in advance</h3><div className="table-scroll"><table className="data-table">
        <thead><tr><th>Route</th><th>Modes</th><th>Stays open</th><th>Cost / t if open</th><th>Expected cost / t (airlift if cut)</th></tr></thead>
        <tbody>{sim.planB.map((p) => <tr key={p.corridors.join("|")}><td>{p.nodes.filter((n) => !n.endsWith("-port")).map(name).join(" → ")}{p.isPlanA && <span className="best-tag">plan A</span>}</td><td>{p.modes.join(" + ")}</td><td>{pct(p.pOpen)}</td><td>{p.costPerTIfOpen === null ? "—" : usd(p.costPerTIfOpen)}</td><td>{usd(p.expectedCostPerT)}</td></tr>)}</tbody>
      </table></div></>}

      <h3>Playbook: if an issue happens</h3>
      <ul className="playbook">{sim.playbook.map((pb) => <li key={pb.hazardId}><strong>{pb.title}</strong> <span className="muted">({pct(pb.probability)} · closes {pb.closes.length ? pb.closes.map(name).join(", ") : "nothing"})</span>
        {pb.actions.length ? <ul>{pb.actions.map((a) => <li key={a.destination}>{name(a.destination)}: {a.kind === "airlift" ? "air delivery" : `${name(a.supplier)} via ${a.corridors.length} legs`} · {usd(a.costPerT)}/t · {hours(a.hours)}</li>)}</ul> : <p className="muted">No delivery needs to change.</p>}
      </li>)}</ul>
      <details className="assumptions"><summary>How the simulation works</summary><ul>{sim.modelNotes.map((n) => <li key={n}>{n}</li>)}</ul></details>
    </div>}
  </section>;
}
