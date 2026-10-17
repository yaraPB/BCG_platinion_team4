"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Activity, ArrowDownToLine, ArrowRight, ChartNoAxesCombined, Check, ChevronDown, CircleAlert, ClipboardList, Compass, MapPinned, Package, RotateCcw, Route, Search, Ship, Truck, Users, Warehouse, X } from "lucide-react";
import type { Network as SourceNetwork, Plan as SourcePlan } from "@/lib/types";
import type { Delivery, Forecast, ForecastInput, HazardId, Network, SimulationClock } from "./model/types";
import { displayNetwork, displayPlan } from "./model/display-network";
import { simulateOutlook } from "./model/simulation";
import { formatNumber, statusMeta } from "@/lib/presentation";
import { StatusBadge } from "./status-badge";
import { TransportTimeline } from "./transport-timeline";
import { ForecastWorkspace, PlaybookWorkspace } from "./forecast-workspace";

const NetworkMap = dynamic(() => import("./map/network-map"), { ssr: false, loading: () => <div className="map-loading"><Compass size={28} /><span>Preparing the South Sudan network…</span></div> });
const tabs = [{ id: "tower", label: "Control tower", icon: MapPinned }, { id: "forecast", label: "Risk forecast", icon: ChartNoAxesCombined }, { id: "playbook", label: "Fallback playbook", icon: ClipboardList }, { id: "corridors", label: "Corridors", icon: Route }] as const;
const subscribeMotion = (callback: () => void) => { const query = window.matchMedia("(prefers-reduced-motion: reduce)"); query.addEventListener("change", callback); return () => query.removeEventListener("change", callback); };
const probabilityDefaults = (network: Network) => Object.fromEntries(network.hazards.map(h => [h.id, h.probability])) as Record<HazardId, number>;

export function Dashboard({ network: sourceNetwork, initialPlan: sourcePlan }: { network: SourceNetwork; initialPlan: SourcePlan }) {
  const network = useMemo(() => displayNetwork(sourceNetwork), [sourceNetwork]);
  const initialPlan = useMemo(() => displayPlan(sourcePlan, network), [sourcePlan, network]);
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("tower");
  const [plan, setPlan] = useState(initialPlan);
  const [selectedId, setSelectedId] = useState("bor");
  const [scenarioId, setScenarioId] = useState("open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [probabilities, setProbabilities] = useState(probabilityDefaults(network));
  const [horizon, setHorizon] = useState<ForecastInput["horizon"]>(72);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastPending, setForecastPending] = useState(false);
  const [forecastKey, setForecastKey] = useState("");
  const [events, setEvents] = useState([{ id: 0, title: "Dispatch plan ready", detail: "Seven communities connected to three supply hubs.", time: "START" }]);
  const clock = useRef<SimulationClock>({ hour: 3 });
  const seek = useCallback((hour: number) => { clock.current.hour = hour; }, []);
  const planRequest = useRef<AbortController | null>(null);
  const forecastRequest = useRef<AbortController | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const selected = plan.deliveries.find(d => d.communityId === selectedId)!;
  const input: ForecastInput = { closedRoads: plan.closedRoads, probabilities, horizon };
  const staleForecast = forecastKey !== JSON.stringify(input);
  const attention = plan.deliveries.length - plan.summary.onPlan;
  const filtered = plan.deliveries.filter(d => d.name.toLowerCase().includes(search.toLowerCase()) && (!attentionOnly || d.status !== "on-plan"));
  const name = (id: string | null) => network.nodes.find(n => n.id === id)?.name ?? "Awaiting supply";

  useEffect(() => () => { planRequest.current?.abort(); forecastRequest.current?.abort(); }, []);

  const applyPlan = useCallback(async (closedRoads: string[], nextScenario: string, title: string) => {
    planRequest.current?.abort();
    const request = new AbortController(); planRequest.current = request;
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closedRoads }), signal: request.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update the plan.");
      if (request.signal.aborted) return;
      const next = displayPlan(result as SourcePlan, network);
      setPlan(next); setScenarioId(nextScenario);
      const detail = `${next.summary.rerouted} rerouted · ${next.summary.supplierChanged} supplier changes · ${next.summary.unreachable} unreachable`;
      setEvents(previous => [{ id: Date.now(), title, detail, time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }, ...previous].slice(0, 6));
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to update the plan."); }
    finally { if (!request.signal.aborted) setPending(false); }
  }, [network]);

  const toggleRoad = useCallback((id: string) => {
    if (pending) return;
    const closed = new Set(plan.closedRoads);
    const reopening = closed.delete(id);
    if (!reopening) closed.add(id);
    void applyPlan([...closed], "custom", `${network.corridors.find(r => r.id === id)?.name} ${reopening ? "reopened" : "closed"}`);
  }, [plan.closedRoads, pending, network.corridors, applyPlan]);

  async function runForecast() {
    forecastRequest.current?.abort();
    const request = new AbortController(); forecastRequest.current = request;
    const key = JSON.stringify(input);
    setForecastPending(true); setError(null);
    try {
      const result = await simulateOutlook(network, initialPlan, input, request.signal);
      if (!request.signal.aborted) { setForecast(result); setForecastKey(key); }
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to simulate the forecast."); }
    finally { if (!request.signal.aborted) setForecastPending(false); }
  }

  function exportPlan() {
    const rows = [["Community", "Supplier", "Status", "People served", "Tonnes", "Travel hours", "Distance km", "Route"], ...plan.deliveries.map(d => [d.name, name(d.supplierId), statusMeta[d.status].label, d.supplierId ? d.people : 0, d.assignedTonnes, d.hours ?? "", d.distanceKm, d.path.map(name).join(" > ")])];
    const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "viamensa-dispatch-plan.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="navigation-rail" aria-label="Workspace navigation">
      <a className="rail-logo" href="#main" aria-label="ViaMensa home"><Route size={25} strokeWidth={2} /></a>
      <div className="rail-divider" />
      {tabs.map(item => <button key={item.id} className={tab === item.id ? "rail-item active" : "rail-item"} title={item.label} aria-label={item.label} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}><item.icon size={21} /></button>)}
      <span className="rail-bottom">V<span>4</span></span>
    </aside>
    <div className="app-body">
      <header className="app-header"><a className="wordmark" href="#main">ViaMensa<span>FOOD ACCESS NETWORK</span></a><div className="header-divider" /><span className="header-location">Operations <span>/</span> South Sudan</span><div className="header-right"><span className="simulation-badge"><i />Planning simulation</span><span className="avatar">T4</span></div></header>
      <main id="main" className="workspace">
        <section className="workspace-heading"><div><p className="eyebrow">FROM SUPPLY TO COMMUNITY</p><h1>Keep food moving<span>.</span></h1><p>A clear route. A ready fallback. Food where it matters.</p></div><button className="button export-button" onClick={exportPlan}><ArrowDownToLine size={15} />Export plan</button></section>
        <section className="metric-strip" aria-label="Network summary">
          <Metric icon={<Users />} label="People connected" value={formatNumber(plan.summary.reachablePeople)} suffix="people" foot={`${Math.round(plan.summary.reachablePeople / plan.summary.totalPeople * 100)}% of network demand`} />
          <Metric icon={<Package />} label="Food allocated" value={String(plan.summary.assignedTonnes)} suffix="tonnes" foot={`of ${plan.summary.totalTonnes} t requested`} />
          <Metric icon={<Truck />} label="Deliveries on plan" value={`${plan.summary.onPlan}`} suffix={`/ ${plan.deliveries.length}`} foot="Priority-based dispatch" />
          <Metric icon={<Activity />} label="Need attention" value={String(attention)} suffix="deliveries" foot={plan.summary.unreachable ? `${plan.summary.unreachable} without a supply route` : "Reroutes & supplier changes"} alert={attention > 0} />
        </section>
        <div className="workspace-tabs" role="tablist" aria-label="Operations views">{tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`view-${item.id}`} id={`tab-${item.id}`} onClick={() => setTab(item.id)}><item.icon size={16} />{item.label}</button>)}<span className="region-label"><i />SOUTH SUDAN</span></div>
        {error && <div className="error-banner" role="alert"><CircleAlert size={18} /><span>{error} Your previous results are still available.</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button></div>}

        {tab === "tower" && <section id="view-tower" role="tabpanel" aria-labelledby="tab-tower">
          <div className="scenario-toolbar"><div className="scenario-title"><span className="scenario-symbol"><Compass size={18} /></span><div><strong>Explore a disruption</strong><span>Close a corridor. Watch the network adapt.</span></div></div><div className="scenario-controls"><label className="sr-only" htmlFor="scenario">Scenario</label><select id="scenario" value={scenarioId} disabled={pending} onChange={event => { const scenario = network.scenarios.find(s => s.id === event.target.value); if (scenario) void applyPlan(scenario.closedRoads, scenario.id, scenario.label); }}>{network.scenarios.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}{scenarioId === "custom" && <option value="custom">Custom closures</option>}</select><ChevronDown className="select-chevron" size={14} /><button className="button reset-button" disabled={pending || !plan.closedRoads.length} aria-label="Reset scenario" onClick={() => void applyPlan([], "open", "All corridors reopened")}><RotateCcw size={14} />Reset</button></div></div>
          <div className="operations-grid" aria-busy={pending}>
            <aside className="dispatch-rail" aria-label="Dispatch board">
              <div className="dispatch-heading"><div><h2>Deliveries</h2><span>THIS DISPATCH CYCLE</span></div><b>{plan.deliveries.length}</b></div>
              <div className="dispatch-controls"><div className="segmented"><button aria-pressed={!attentionOnly} onClick={() => setAttentionOnly(false)}>All deliveries</button><button aria-pressed={attentionOnly} onClick={() => setAttentionOnly(true)}>Attention <span>{attention}</span></button></div><label className="search-field"><Search size={15} /><input aria-label="Search communities" placeholder="Find a community…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
              <div className="delivery-list">{filtered.length ? filtered.map(delivery => <Shipment key={delivery.communityId} delivery={delivery} selected={selectedId === delivery.communityId} supplier={name(delivery.supplierId)} index={plan.deliveries.indexOf(delivery)} onSelect={() => setSelectedId(delivery.communityId)} />) : <p className="empty-state">No deliveries match this view.</p>}</div>
              <div className="rail-stock"><div><Warehouse size={15} /><strong>Supply reserves</strong><span>after allocation</span></div>{network.nodes.filter(n => n.kind === "hub").map(hub => <div className="hub-reserve" key={hub.id}><span>{hub.name}</span><i><b style={{ width: `${plan.stockRemaining[hub.id] / hub.stockTonnes * 100}%` }} /></i><strong>{plan.stockRemaining[hub.id]}<small> t</small></strong></div>)}</div>
            </aside>
            <div className="map-and-timeline">
              <NetworkMap network={network} plan={plan} baseline={initialPlan} selectedId={selectedId} clock={clock} reducedMotion={reducedMotion} onSelect={setSelectedId} onToggleRoad={toggleRoad} probabilities={probabilities} />
              <TransportTimeline plan={plan} selectedId={selectedId} onSelect={setSelectedId} clock={clock} onSeek={seek} playing={playing && !reducedMotion} reducedMotion={reducedMotion} onPlaying={() => setPlaying(!playing)} speed={speed} onSpeed={setSpeed} />
            </div>
          </div>
          <p className="sr-only" role="status">{pending ? "Recalculating deliveries." : `${plan.summary.onPlan} on plan, ${plan.summary.rerouted} rerouted, ${plan.summary.supplierChanged} supplier changes, ${plan.summary.unreachable} unreachable.`}</p>
          <div className="decision-grid"><JourneyDetail delivery={selected} network={network} /><section className="event-panel"><div className="section-label"><Activity size={15} /><h2>Operations log</h2><span>THIS SESSION</span></div><div className="event-list">{events.map(event => <article key={event.id}><time>{event.time}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}</div></section></div>
        </section>}
        {tab === "forecast" && <section id="view-forecast" role="tabpanel" aria-labelledby="tab-forecast"><ForecastWorkspace network={network} forecast={forecast} probabilities={probabilities} horizon={horizon} pending={forecastPending} stale={staleForecast} onProbability={(id, p) => setProbabilities(current => ({ ...current, [id]: p }))} onHorizon={setHorizon} onRun={runForecast} onApply={() => { if (!forecast) return; const closed = forecast.roads.filter(r => r.probability >= .5).map(r => r.id); void applyPlan(closed, "custom", "Forecast closures applied"); setTab("tower"); }} /></section>}
        {tab === "playbook" && <section id="view-playbook" role="tabpanel" aria-labelledby="tab-playbook"><PlaybookWorkspace network={network} forecast={forecast} stale={staleForecast} onRefresh={() => setTab("forecast")} /></section>}
        {tab === "corridors" && <section id="view-corridors" role="tabpanel" aria-labelledby="tab-corridors" className="corridor-workspace"><div className="view-heading"><div><p className="eyebrow">NETWORK CONNECTIONS</p><h2>Every corridor, in view.</h2><p>Manage road and river access. Changes recalculate the entire dispatch plan.</p></div><span className="view-count">{plan.closedRoads.length} closed / {network.corridors.length} total</span></div><div className="table-scroll"><table><thead><tr><th>Corridor</th><th>Transport</th><th>Distance</th><th>Travel estimate</th><th>Access</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{network.corridors.map(road => <tr key={road.id}><td><strong>{road.name}</strong></td><td><span className="mode-label">{road.mode === "river" ? <Ship size={15} /> : <Truck size={15} />}{road.mode === "river" ? "River barge" : "Road convoy"}</span></td><td>{Math.round(road.distanceKm)} km</td><td>{road.hours} h</td><td><span className={`access-state ${plan.closedRoads.includes(road.id) ? "closed" : ""}`}><i />{plan.closedRoads.includes(road.id) ? "Closed" : "Open"}</span></td><td><button className="button" disabled={pending} aria-label={`${plan.closedRoads.includes(road.id) ? "Reopen" : "Close"} ${road.name}`} onClick={() => toggleRoad(road.id)}>{plan.closedRoads.includes(road.id) ? "Reopen" : "Close corridor"}</button></td></tr>)}</tbody></table></div></section>}
        <footer className="app-footer"><span><Route size={14} />ViaMensa <b>·</b> Team 4</span><p>{network.notice}</p><a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">Map data © OpenStreetMap</a></footer>
      </main>
    </div>
  </div>;
}

function Metric({ icon, label, value, suffix, foot, alert }: { icon: React.ReactNode; label: string; value: string; suffix: string; foot: string; alert?: boolean }) {
  return <article className={`metric ${alert ? "metric-alert" : ""}`}><div className="metric-icon">{icon}</div><div><p>{label}</p><strong>{value}<small>{suffix}</small></strong><span>{foot}</span></div></article>;
}

function Shipment({ delivery, selected, supplier, index, onSelect }: { delivery: Delivery; selected: boolean; supplier: string; index: number; onSelect: () => void }) {
  const river = delivery.legs.some(l => l.mode === "river");
  return <button className={`delivery-item ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}><div className="shipment-top"><span>VM-{String(index + 1).padStart(3, "0")}</span><StatusBadge status={delivery.status} /></div><div className="shipment-name">{delivery.name}<span>{delivery.assignedTonnes}<small> t</small></span></div><div className="shipment-route">{river ? <Ship size={13} /> : <Truck size={13} />}<span>{supplier}</span><ArrowRight size={12} /><span>{delivery.name}</span></div><div className="shipment-bottom"><span>{formatNumber(delivery.people)} people</span><b>{delivery.hours == null ? "Awaiting route" : `${delivery.hours} h journey`}</b></div></button>;
}

function JourneyDetail({ delivery, network }: { delivery: Delivery; network: Network }) {
  const name = (id: string | null) => network.nodes.find(n => n.id === id)?.name ?? "Unassigned";
  return <section className="journey-panel" aria-label="Selected delivery details"><div className="section-label"><Route size={16} /><h2>Journey to {delivery.name}</h2><StatusBadge status={delivery.status} /></div><div className="journey-content"><div className="journey-path">{delivery.path.length ? delivery.path.map((id, i) => <span key={`${id}-${i}`}>{i > 0 && <ArrowRight size={14} />}{i === 0 && <Warehouse size={17} />}<strong>{name(id)}</strong>{i === delivery.path.length - 1 && <Package size={17} />}</span>) : <span><CircleAlert size={17} />No available supply route</span>}</div><div className="journey-facts"><span><small>FOOD ASSIGNED</small><strong>{delivery.assignedTonnes} <em>/ {delivery.requestedTonnes} t</em></strong></span><span><small>TRAVEL ESTIMATE</small><strong>{delivery.hours ?? "—"} <em>hours</em></strong></span><span><small>DISTANCE</small><strong>{delivery.distanceKm} <em>km</em></strong></span><span><small>FOOD AT DESTINATION</small><strong>{delivery.foodDays} <em>days left</em></strong></span></div><p className="decision-reason"><Check size={16} />{delivery.reason}</p></div></section>;
}
