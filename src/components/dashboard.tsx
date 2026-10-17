"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownToLine, ArrowUpRight, CircleAlert, Layers3, MapPin, Package, Pause, Play, RotateCcw, Route, Users, X } from "lucide-react";
import { formatNumber, statusMeta } from "@/lib/presentation";
import type { Network, Plan } from "@/lib/types";
import { DispatchBoard } from "./dispatch-board";
import { DeliveryDetail } from "./delivery-detail";
import { Insights } from "./insights";

const NetworkMap = dynamic(() => import("./map/network-map"), { ssr: false, loading: () => <div className="map-loading">Loading map…</div> });
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};

export function Dashboard({ network, initialPlan }: { network: Network; initialPlan: Plan }) {
  const [plan, setPlan] = useState(initialPlan);
  const [selectedId, setSelectedId] = useState("bor");
  const [scenarioId, setScenarioId] = useState("open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const selected = plan.deliveries.find((delivery) => delivery.communityId === selectedId) ?? plan.deliveries[0];
  const activeScenario = network.scenarios.find((scenario) => scenario.id === scenarioId);
  const summary = plan.summary;
  const attention = summary.rerouted + summary.supplierChanged + summary.unreachable;

  useEffect(() => () => controller.current?.abort(), []);

  const applyPlan = useCallback(async (closedRoads: string[], nextScenario: string) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closedRoads }), signal: request.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update the plan.");
      if (request.signal.aborted) return;
      setPlan(result as Plan);
      setScenarioId(nextScenario);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to update the plan.");
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  }, []);

  const toggleRoad = useCallback((roadId: string) => {
    if (pending) return;
    const closed = new Set(plan.closedRoads);
    if (closed.has(roadId)) closed.delete(roadId); else closed.add(roadId);
    void applyPlan([...closed], "custom");
  }, [pending, plan.closedRoads, applyPlan]);

  function exportPlan() {
    const rows = [["Community", "Supplier", "Status", "People served", "Tonnes", "Travel hours", "Route"], ...plan.deliveries.map((d) => [d.name, network.nodes.find((n) => n.id === d.supplierId)?.name ?? "", statusMeta[d.status].label, d.supplierId ? d.people : 0, d.assignedTonnes, d.hours ?? "", d.path.join(" > ")])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "viamensa-dispatch-plan.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="app-header"><a className="brand" href="#main" aria-label="ViaMensa home"><span className="brand-mark"><Route size={23} strokeWidth={1.8} /></span><span>ViaMensa<span className="brand-caption">FOOD ACCESS INTELLIGENCE</span></span></a><nav aria-label="Main navigation"><a href="#main">Overview</a><a href="#control-tower">Control tower</a><a href="#insights">Insights</a></nav><span className="demo-tag"><span />Illustrative scenario</span></header>
    <main id="main" className="workspace">
      <section className="page-heading"><div><p className="breadcrumb">Humanitarian operations <span>/</span> South Sudan</p><h1>Food corridor control tower<span>.</span></h1><p>Follow the food. Understand the disruption. Keep communities connected.</p></div><button className="button export-button" onClick={exportPlan}><ArrowDownToLine size={15} />Export plan</button></section>
      <section className="metrics" aria-label="Network summary">
        <Metric label="People reachable" value={formatNumber(summary.reachablePeople)} foot={`of ${formatNumber(summary.totalPeople)} people in this cycle`} icon={<Users size={18} />} />
        <Metric label="Food assigned" value={`${summary.assignedTonnes}`} unit="t" foot={`${summary.totalTonnes} tonnes requested across the network`} icon={<Package size={18} />} />
        <Metric label="Deliveries on plan" value={`${summary.onPlan}`} unit={`/ ${plan.deliveries.length}`} foot={`${summary.rerouted} rerouted · ${summary.supplierChanged} new supplier`} icon={<Route size={18} />} />
        <Metric label="Need attention" value={String(attention)} foot={summary.unreachable ? `${summary.unreachable} ${summary.unreachable === 1 ? "destination" : "destinations"} without a supply route` : "Changed deliveries or unreachable communities"} icon={<CircleAlert size={18} />} alert={attention > 0} />
      </section>
      <section id="control-tower" className="control-tower" aria-busy={pending}>
        <div className="tower-toolbar"><div><h2>Network operations</h2><p>{activeScenario?.description ?? "Custom corridor closures are applied to this plan."}</p></div><div className="scenario-controls"><label htmlFor="scenario">Scenario</label><select id="scenario" value={scenarioId} disabled={pending} onChange={(event) => { const scenario = network.scenarios.find((s) => s.id === event.target.value); if (scenario) void applyPlan(scenario.closedRoads, scenario.id); }}>{network.scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}{scenarioId === "custom" && <option value="custom">Custom closures</option>}</select><button className="icon-button" aria-label="Reset scenario" title="Reset scenario" disabled={pending || !plan.closedRoads.length} onClick={() => void applyPlan([], "open")}><RotateCcw size={16} /></button></div></div>
        {error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error} The previous plan is still displayed.</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}
        <div className="operation-grid"><div className="panel map-panel"><div className="map-heading"><div><MapPin size={16} /><strong>South Sudan</strong><span className="map-caption">3 hubs · 7 communities</span></div><div><span className={`network-state ${plan.closedRoads.length ? "disrupted" : ""}`}>{pending ? "Recalculating…" : plan.closedRoads.length ? `${plan.closedRoads.length} ${plan.closedRoads.length === 1 ? "corridor" : "corridors"} closed` : "All corridors open"}</span><button className="icon-button" aria-label={playing && !reducedMotion ? "Pause transport animation" : "Play transport animation"} title={reducedMotion ? "Animation respects reduced motion settings" : playing ? "Pause transport animation" : "Play transport animation"} disabled={reducedMotion} aria-pressed={playing && !reducedMotion} onClick={() => setPlaying(!playing)}>{playing && !reducedMotion ? <Pause size={15} /> : <Play size={15} />}</button></div></div>
          <NetworkMap network={network} plan={plan} selectedId={selectedId} playing={playing && !reducedMotion} onSelect={setSelectedId} onToggleRoad={toggleRoad} />
          <div className="map-legend"><span><i className="legend-hub" />Supply hub</span><span><i className="legend-community" />Community</span><span><i className="legend-route" />Selected route</span><span><i className="legend-closed" />Closed corridor</span><span className="map-note"><Layers3 size={12} />Schematic routes · illustrative movement</span></div>
        </div><DispatchBoard network={network} plan={plan} selectedId={selectedId} onSelect={setSelectedId} /></div>
        <p className="sr-only" role="status">{pending ? "Recalculating deliveries." : `${summary.onPlan} deliveries on plan, ${summary.rerouted} rerouted, ${summary.supplierChanged} with new suppliers, ${summary.unreachable} unreachable.`}</p>
        <DeliveryDetail network={network} plan={plan} delivery={selected} />
      </section>
      <Insights network={network} plan={plan} pending={pending} onToggle={toggleRoad} />
      <footer className="app-footer"><span className="footer-brand">ViaMensa <ArrowUpRight size={13} /></span><p>{network.notice}</p><span>Team 4 · BCG Platinion hackathon</span></footer>
    </main>
  </>;
}

function Metric({ label, value, unit, foot, icon, alert = false }: { label: string; value: string; unit?: string; foot: string; icon: React.ReactNode; alert?: boolean }) {
  return <article className={`metric ${alert ? "metric-alert" : ""}`}><div className="metric-label">{label}<span>{icon}</span></div><div className="metric-value">{value}<small>{unit}</small></div><p>{foot}</p></article>;
}
