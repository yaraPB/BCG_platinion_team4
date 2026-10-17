"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  BrainCircuit,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  History,
  LogOut,
  MapPinned,
  Navigation,
  Package,
  PanelRightOpen,
  Plane,
  ReceiptText,
  RotateCcw,
  Route,
  Search,
  Ship,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import type { Network as SourceNetwork, Plan as SourcePlan } from "@/lib/types";
import type {
  Delivery,
  Forecast,
  ForecastInput,
  HazardId,
  Network,
  SimulationClock,
} from "./model/types";
import { displayNetwork, displayPlan } from "./model/display-network";
import { simulateOutlook } from "./model/simulation";
import { formatNumber, statusMeta } from "@/lib/presentation";
import { StatusBadge } from "./status-badge";
import { TransportTimeline } from "./transport-timeline";
import {
  ForecastControls,
  OutlookChart,
  PlaybookReserves,
  PlaybookTable,
} from "./forecast-workspace";
import type { MapView } from "./map/network-map";
import { api, usd } from "@/lib/api";
import { ItineraryPanel } from "./itinerary-panel";
import { RiskPanel } from "./risk-panel";
import { ImpactPanel } from "./impact-panel";

const NetworkMap = dynamic(() => import("./map/network-map"), {
  ssr: false,
  loading: () => (
    <section className="map-stage" aria-label="South Sudan delivery map">
      <div className="map-loading">
        <span className="loading-ring" />
        <strong>Connecting the network</strong>
        <span>Preparing the South Sudan map</span>
      </div>
    </section>
  ),
});

const views: { id: MapView; label: string; title: string; icon: typeof MapPinned }[] = [
  { id: "tower", label: "Tower", title: "Control tower", icon: MapPinned },
  { id: "itinerary", label: "Route A→B", title: "Itinerary planner", icon: Navigation },
  { id: "alerts", label: "Alerts", title: "Alerts and AI analysis", icon: BrainCircuit },
  { id: "forecast", label: "Forecast", title: "Risk forecast", icon: ChartNoAxesCombined },
  { id: "playbook", label: "Playbook", title: "Fallback playbook", icon: ClipboardList },
  { id: "savings", label: "Savings", title: "Savings vs no fallback", icon: ReceiptText },
  { id: "corridors", label: "Corridors", title: "Corridor access", icon: Route },
];
// Views rendered as a sheet over the map (the map stays mounted underneath).
const sheetViews: MapView[] = ["itinerary", "alerts", "savings"];
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
// Deep links: /?view=forecast or /#forecast opens that view. Read as an
// external store so the server renders the default and the client corrects it
// after hydration without a mismatch.
const subscribeUrl = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
};
const subscribeNarrow = (callback: () => void) => {
  const query = window.matchMedia("(max-width: 760px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const readUrlView = (): MapView | null => {
  const requested =
    new URLSearchParams(window.location.search).get("view") ??
    window.location.hash.slice(1);
  return views.some((v) => v.id === requested) ? (requested as MapView) : null;
};
const probabilityDefaults = (network: Network) =>
  Object.fromEntries(
    network.hazards.map((h) => [h.id, h.probability]),
  ) as Record<HazardId, number>;
const clockLabel = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function Dashboard({
  network: sourceNetwork,
  initialPlan: sourcePlan,
  user,
}: {
  network: SourceNetwork;
  initialPlan: SourcePlan;
  user?: { name: string; tenant: string };
}) {
  const network = useMemo(() => displayNetwork(sourceNetwork), [sourceNetwork]);
  const initialPlan = useMemo(
    () => displayPlan(sourcePlan, network),
    [sourcePlan, network],
  );
  const urlView = useSyncExternalStore(subscribeUrl, readUrlView, () => null);
  const [pickedView, setPickedView] = useState<MapView | null>(null);
  const view: MapView = pickedView ?? urlView ?? "tower";
  const selectView = useCallback((id: MapView) => {
    setPickedView(id);
    window.history.replaceState(window.history.state, "", `#${id}`);
  }, []);
  const [plan, setPlan] = useState(initialPlan);
  const [selectedId, setSelectedId] = useState("bor");
  const [scenarioId, setScenarioId] = useState("open");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [probabilities, setProbabilities] = useState(
    probabilityDefaults(network),
  );
  const [horizon, setHorizon] = useState<ForecastInput["horizon"]>(72);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastPending, setForecastPending] = useState(false);
  const [forecastKey, setForecastKey] = useState("");
  const [logOpen, setLogOpen] = useState(false);
  // Open by default on wide screens; on phones the inspector would cover the map.
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 760px)").matches,
    () => false,
  );
  const [inspectorChoice, setInspectorOpen] = useState<boolean | null>(null);
  const inspectorOpen = inspectorChoice ?? !narrow;
  const [hoverRoad, setHoverRoad] = useState<string | null>(null);
  const [events, setEvents] = useState([
    {
      id: 0,
      title: "Dispatch plan ready",
      detail: `${sourcePlan.deliveries.length} communities connected to ${sourceNetwork.nodes.filter((n) => n.kind === "hub").length} suppliers.`,
      time: "Start",
    },
  ]);
  const clock = useRef<SimulationClock>({ hour: 3 });
  const seek = useCallback((hour: number) => {
    clock.current.hour = hour;
  }, []);
  const planRequest = useRef<AbortController | null>(null);
  const forecastRequest = useRef<AbortController | null>(null);
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const selected = plan.deliveries.find((d) => d.communityId === selectedId)!;
  const input: ForecastInput = {
    closedRoads: plan.closedRoads,
    probabilities,
    horizon,
  };
  const staleForecast = forecastKey !== JSON.stringify(input);
  const attention = plan.deliveries.length - plan.summary.onPlan;
  const filtered = plan.deliveries.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) &&
      (!attentionOnly || d.status !== "on-plan"),
  );
  const name = (id: string | null) =>
    network.nodes.find((n) => n.id === id)?.name ?? "Awaiting supply";
  const latest = events[0];

  useEffect(
    () => () => {
      planRequest.current?.abort();
      forecastRequest.current?.abort();
    },
    [],
  );

  const applyPlan = useCallback(
    async (closedRoads: string[], nextScenario: string, title: string) => {
      planRequest.current?.abort();
      const request = new AbortController();
      planRequest.current = request;
      setPending(true);
      setError(null);
      try {
        const result = await api<SourcePlan>("plan", {
          body: { closedRoads },
          signal: request.signal,
        });
        if (request.signal.aborted) return;
        const next = displayPlan(result, network);
        setPlan(next);
        setScenarioId(nextScenario);
        seek(1);
        const detail = `${next.summary.rerouted} rerouted, ${next.summary.supplierChanged} supplier changes, ${next.summary.unreachable} unreachable`;
        setEvents((previous) =>
          [{ id: Date.now(), title, detail, time: clockLabel() }, ...previous].slice(0, 8),
        );
      } catch (cause) {
        if (!request.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to update the plan.",
          );
      } finally {
        if (!request.signal.aborted) setPending(false);
      }
    },
    [network, seek],
  );

  const toggleRoad = useCallback(
    (id: string) => {
      if (pending) return;
      const closed = new Set(plan.closedRoads);
      const reopening = closed.delete(id);
      if (!reopening) closed.add(id);
      void applyPlan(
        [...closed],
        "custom",
        `${network.corridors.find((r) => r.id === id)?.name} ${reopening ? "reopened" : "closed"}`,
      );
    },
    [plan.closedRoads, pending, network.corridors, applyPlan],
  );

  async function runForecast() {
    forecastRequest.current?.abort();
    const request = new AbortController();
    forecastRequest.current = request;
    const key = JSON.stringify(input);
    setForecastPending(true);
    setError(null);
    try {
      const result = await simulateOutlook(
        network,
        initialPlan,
        input,
        request.signal,
      );
      if (!request.signal.aborted) {
        setForecast(result);
        setForecastKey(key);
        setEvents((previous) =>
          [
            {
              id: Date.now(),
              title: `Forecast run for ${input.horizon} hours`,
              detail: `${formatNumber(result.expectedPeople)} people expected, ${Math.round(result.disruptionProbability * 100)}% chance of any disruption`,
              time: clockLabel(),
            },
            ...previous,
          ].slice(0, 8),
        );
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to simulate the forecast.",
        );
    } finally {
      if (!request.signal.aborted) setForecastPending(false);
    }
  }

  function exportPlan() {
    const rows = [
      [
        "Community",
        "Supplier",
        "Status",
        "People served",
        "Tonnes",
        "Travel hours",
        "Distance km",
        "Route",
      ],
      ...plan.deliveries.map((d) => [
        d.name,
        name(d.supplierId),
        statusMeta[d.status].label,
        d.supplierId ? d.people : 0,
        d.assignedTonnes,
        d.hours ?? "",
        d.distanceKm,
        d.path.map(name).join(" > "),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "viamensa-dispatch-plan.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const current = views.find((v) => v.id === view)!;

  return (
    <div
      className={`app-shell view-${view} ${pending || forecastPending ? "busy" : ""}`}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <div className="ticker">
        <i className={`pulse ${pending || forecastPending ? "busy" : ""}`} aria-hidden="true" />
        <p role="status" aria-live="polite">
          <time>{latest.time}</time>
          <strong>{latest.title}</strong>
          <span>{latest.detail}</span>
        </p>
        <button
          className="ticker-history"
          aria-expanded={logOpen}
          aria-controls="operations-log"
          onClick={() => setLogOpen(!logOpen)}
        >
          <History size={13} />
          History
          <b>{events.length}</b>
        </button>
        {logOpen && (
          <div className="log-popover" id="operations-log" role="dialog" aria-label="Operations log">
            <div className="popover-head">
              <span>Operations log, this session</span>
              <button
                className="icon-button"
                aria-label="Close operations log"
                onClick={() => setLogOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            {events.map((event) => (
              <article key={event.id}>
                <time>{event.time}</time>
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <nav className="navigation-rail" aria-label="Views">
        <a className="rail-logo" href="#main" aria-label="ViaMensa home">
          <Route size={22} strokeWidth={2.2} />
        </a>
        {views.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "rail-item active" : "rail-item"}
            title={item.title}
            aria-pressed={view === item.id}
            onClick={() => selectView(item.id)}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
          </button>
        ))}
        <span className="rail-bottom">Team 4</span>
      </nav>

      <header className="app-header">
        <div className="wordmark">
          <strong>ViaMensa</strong>
          <span>{current.title}, South Sudan</span>
        </div>
        <div className="scenario-control">
          <label htmlFor="scenario">Scenario</label>
          <span className="select-wrap">
            <select
              id="scenario"
              value={scenarioId}
              disabled={pending}
              onChange={(event) => {
                const scenario = network.scenarios.find(
                  (s) => s.id === event.target.value,
                );
                if (scenario)
                  void applyPlan(scenario.closedRoads, scenario.id, scenario.label);
              }}
            >
              {network.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              {scenarioId === "custom" && (
                <option value="custom">Custom closures</option>
              )}
            </select>
            <ChevronDown className="select-chevron" size={14} aria-hidden="true" />
          </span>
          <button
            className="button"
            disabled={pending || !plan.closedRoads.length}
            onClick={() => void applyPlan([], "open", "All corridors reopened")}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
        <div className="readouts" aria-label="Network summary">
          <Readout
            label="People connected"
            value={formatNumber(plan.summary.reachablePeople)}
            note={`${Math.round((plan.summary.reachablePeople / plan.summary.totalPeople) * 100)}% of demand`}
          />
          <Readout
            label="Food allocated"
            value={String(plan.summary.assignedTonnes)}
            unit="t"
            note={`of ${plan.summary.totalTonnes} t requested`}
          />
          <Readout
            label="On plan"
            value={String(plan.summary.onPlan)}
            unit={`/ ${plan.deliveries.length}`}
            note="deliveries"
          />
          <Readout
            label="Need attention"
            value={String(attention)}
            note={
              plan.summary.unreachable
                ? `${plan.summary.unreachable} without a route`
                : attention
                  ? "reroutes and supplier changes"
                  : "all on plan"
            }
            alert={attention > 0}
          />
        </div>
        <button className="button export-button" onClick={exportPlan}>
          <ArrowDownToLine size={14} />
          Export CSV
        </button>
        <span className="avatar" title={user ? `${user.name}, ${user.tenant}` : undefined} aria-hidden="true">
          {(user?.name ?? "T4").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <button
          className="icon-button"
          aria-label="Sign out"
          title="Sign out"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.assign("/");
          }}
        >
          <LogOut size={14} />
        </button>
      </header>

      <main id="main" className="workspace">
        <aside className="side-column" aria-label={current.title}>
          {view === "tower" && (
            <>
              <div className="side-section grow">
                <div className="side-head">
                  <h2>Deliveries</h2>
                  <span>{plan.deliveries.length} this cycle</span>
                </div>
                <div className="side-controls">
                  <div className="segmented">
                    <button
                      aria-pressed={!attentionOnly}
                      onClick={() => setAttentionOnly(false)}
                    >
                      All
                    </button>
                    <button
                      aria-pressed={attentionOnly}
                      onClick={() => setAttentionOnly(true)}
                    >
                      Attention <b>{attention}</b>
                    </button>
                  </div>
                  <label className="search-field">
                    <Search size={14} />
                    <input
                      aria-label="Search communities"
                      placeholder="Find a community"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                </div>
                <div className="delivery-list" aria-busy={pending}>
                  {filtered.length ? (
                    filtered.map((delivery) => (
                      <DeliveryRow
                        key={delivery.communityId}
                        delivery={delivery}
                        selected={selectedId === delivery.communityId}
                        supplier={name(delivery.supplierId)}
                        index={plan.deliveries.indexOf(delivery)}
                        onSelect={() => {
                          setSelectedId(delivery.communityId);
                          setInspectorOpen(true);
                        }}
                      />
                    ))
                  ) : (
                    <p className="empty-state">
                      No deliveries match this filter.
                    </p>
                  )}
                </div>
              </div>
              <div className="side-section reserves">
                <div className="side-head">
                  <h2>Suppliers</h2>
                  <span>deliveries served</span>
                </div>
                {network.nodes
                  .filter((n) => n.kind === "hub")
                  .map((hub) => {
                    const served = plan.deliveries.filter((d) => d.supplierId === hub.id).length;
                    return (
                      <div className="hub-reserve" key={hub.id}>
                        <span>{hub.name}</span>
                        <i>
                          <b style={{ width: `${(served / Math.max(1, plan.deliveries.length)) * 100}%` }} />
                        </i>
                        <strong>{served}</strong>
                      </div>
                    );
                  })}
                {plan.summary.unreachable > 0 && (
                  <div className="hub-reserve">
                    <span>
                      <Plane size={11} /> Air (last resort)
                    </span>
                    <i>
                      <b style={{ width: `${(plan.summary.unreachable / plan.deliveries.length) * 100}%` }} />
                    </i>
                    <strong>{plan.summary.unreachable}</strong>
                  </div>
                )}
              </div>
            </>
          )}
          {view === "forecast" && (
            <ForecastControls
              network={network}
              forecast={forecast}
              probabilities={probabilities}
              horizon={horizon}
              pending={forecastPending}
              stale={staleForecast}
              onProbability={(id, p) =>
                setProbabilities((currentValues) => ({ ...currentValues, [id]: p }))
              }
              onHorizon={setHorizon}
              onRun={runForecast}
              onApply={() => {
                if (!forecast) return;
                const closed = forecast.roads
                  .filter((r) => r.probability >= 0.5)
                  .map((r) => r.id);
                void applyPlan(closed, "custom", "Forecast closures applied");
                selectView("tower");
              }}
              onHoverRoad={setHoverRoad}
            />
          )}
          {view === "playbook" && (
            <PlaybookReserves
              network={network}
              forecast={forecast}
              stale={staleForecast}
              onRefresh={() => selectView("forecast")}
            />
          )}
          {sheetViews.includes(view) && (
            <div className="side-section grow">
              <div className="side-head">
                <h2>Current closures</h2>
                <span>{plan.closedRoads.length} closed</span>
              </div>
              <p className="side-intro">
                {view === "itinerary"
                  ? "Itineraries are planned on the network as it is now. Close a corridor here, on the map or in the Corridors view, then re-plan."
                  : view === "alerts"
                    ? "Simulations run on top of these closures. Analyse the alerts, pick issues, then simulate."
                    : "The savings table compares these closures with operating without a prepared fallback."}
              </p>
              <div className="corridor-list" aria-busy={pending}>
                {plan.closedRoads.length === 0 && <p className="side-intro">All corridors are open.</p>}
                {plan.closedRoads.map((id) => {
                  const road = network.corridors.find((r) => r.id === id);
                  return (
                    <div className="corridor-item closed" key={id}>
                      <div className="corridor-main">
                        <strong>{road?.name ?? id}</strong>
                        <span>{road ? `${road.mode === "river" ? "River" : "Road"}, ${Math.round(road.distanceKm)} km` : "transfer"}</span>
                      </div>
                      <button className="button small" disabled={pending} onClick={() => toggleRoad(id)}>
                        Reopen
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {view === "corridors" && (
            <div className="side-section grow">
              <div className="side-head">
                <h2>Corridor access</h2>
                <span>
                  {plan.closedRoads.length} closed of {network.corridors.length}
                </span>
              </div>
              <p className="side-intro">
                Closing a corridor recalculates every delivery on the server.
              </p>
              <div className="corridor-list" aria-busy={pending}>
                {network.corridors.map((road) => {
                  const closed = plan.closedRoads.includes(road.id);
                  return (
                    <div
                      className={`corridor-item ${closed ? "closed" : ""}`}
                      key={road.id}
                      onMouseEnter={() => setHoverRoad(road.id)}
                      onMouseLeave={() => setHoverRoad(null)}
                      onFocus={() => setHoverRoad(road.id)}
                      onBlur={() => setHoverRoad(null)}
                    >
                      <div className="corridor-main">
                        <strong>{road.name}</strong>
                        <span>
                          {road.mode === "river" ? <Ship size={12} /> : <Truck size={12} />}
                          {road.mode === "river" ? "River barge" : "Road convoy"},{" "}
                          {Math.round(road.distanceKm)} km, {road.hours} h
                        </span>
                      </div>
                      <span className={`access-state ${closed ? "closed" : ""}`}>
                        <i />
                        {closed ? "Closed" : "Open"}
                      </span>
                      <button
                        className="button small"
                        disabled={pending}
                        aria-label={`${closed ? "Reopen" : "Close"} ${road.name}`}
                        onClick={() => toggleRoad(road.id)}
                      >
                        {closed ? "Reopen" : "Close"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <NetworkMap
          network={network}
          plan={plan}
          baseline={initialPlan}
          selectedId={selectedId}
          clock={clock}
          reducedMotion={reducedMotion}
          onSelect={(id) => {
            setSelectedId(id);
            setInspectorOpen(true);
          }}
          onToggleRoad={toggleRoad}
          probabilities={probabilities}
          view={view}
          roadRisk={forecast?.roads ?? null}
          highlightRoadId={hoverRoad}
        >
          {error && (
            <div className="error-banner" role="alert">
              <CircleAlert size={16} />
              <span>{error} Your previous results are still shown.</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {sheetViews.includes(view) && (
            <div className="tool-sheet">
              {view === "itinerary" && <ItineraryPanel network={sourceNetwork} closedRoads={plan.closedRoads} />}
              {view === "alerts" && <RiskPanel network={sourceNetwork} closedRoads={plan.closedRoads} />}
              {view === "savings" && <ImpactPanel network={sourceNetwork} closedRoads={plan.closedRoads} />}
            </div>
          )}
          {view === "tower" &&
            (inspectorOpen ? (
              <JourneyInspector
                delivery={selected}
                network={network}
                onClose={() => setInspectorOpen(false)}
              />
            ) : (
              <button
                className="inspector-reveal"
                onClick={() => setInspectorOpen(true)}
              >
                <PanelRightOpen size={14} />
                Journey details
              </button>
            ))}
        </NetworkMap>

        {view !== "corridors" && !sheetViews.includes(view) && (
          <section className="bottom-strip">
            {view === "tower" && (
              <TransportTimeline
                plan={plan}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setInspectorOpen(true);
                }}
                clock={clock}
                onSeek={seek}
                playing={playing && !reducedMotion}
                reducedMotion={reducedMotion}
                onPlaying={() => setPlaying(!playing)}
                speed={speed}
                onSpeed={setSpeed}
              />
            )}
            {view === "forecast" && (
              <OutlookChart
                network={network}
                forecast={forecast}
                stale={staleForecast}
                pending={forecastPending}
                onRun={runForecast}
              />
            )}
            {view === "playbook" && (
              <PlaybookTable network={network} forecast={forecast} />
            )}
          </section>
        )}
      </main>

      <p className="sr-only" role="status">
        {pending
          ? "Recalculating deliveries."
          : `${plan.summary.onPlan} on plan, ${plan.summary.rerouted} rerouted, ${plan.summary.supplierChanged} supplier changes, ${plan.summary.unreachable} unreachable.`}
      </p>
    </div>
  );
}

function Readout({
  label,
  value,
  unit,
  note,
  alert,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  alert?: boolean;
}) {
  return (
    <div className={`readout ${alert ? "alert" : ""}`}>
      <span className="readout-label">{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      <span className="readout-note">{note}</span>
    </div>
  );
}

function DeliveryRow({
  delivery,
  selected,
  supplier,
  index,
  onSelect,
}: {
  delivery: Delivery;
  selected: boolean;
  supplier: string;
  index: number;
  onSelect: () => void;
}) {
  const river = delivery.legs.some((l) => l.mode === "river");
  return (
    <button
      className={`delivery-item ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="delivery-code">{String(index + 1).padStart(2, "0")}</span>
      <span className="delivery-body">
        <span className="delivery-top">
          <strong>{delivery.name}</strong>
          <StatusBadge status={delivery.status} />
        </span>
        <span className="delivery-sub">
          {river ? <Ship size={12} /> : <Truck size={12} />}
          <span>{supplier}</span>
          <ArrowRight size={11} aria-hidden="true" />
          <span>{delivery.name}</span>
        </span>
        <span className="delivery-figures">
          <b>
            {delivery.assignedTonnes}
            <small>t</small>
          </b>
          <span>{formatNumber(delivery.people)} people</span>
          <span>
            {delivery.hours == null ? "Awaiting route" : `${delivery.hours} h`}
          </span>
        </span>
      </span>
    </button>
  );
}

function JourneyInspector({
  delivery,
  network,
  onClose,
}: {
  delivery: Delivery;
  network: Network;
  onClose: () => void;
}) {
  const name = (id: string | null) =>
    network.nodes.find((n) => n.id === id)?.name ?? "Unassigned";
  return (
    <section className="journey-inspector" aria-label="Selected delivery details">
      <div className="inspector-head">
        <div>
          <span>Journey</span>
          <h2>{delivery.name}</h2>
        </div>
        <StatusBadge status={delivery.status} />
        <button
          className="icon-button"
          aria-label="Hide journey details"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className="journey-path">
        {delivery.path.length ? (
          delivery.path.filter((id) => !id.endsWith("-port")).map((id, i, path) => (
            <span key={`${id}-${i}`}>
              {i > 0 && <ArrowRight size={12} aria-hidden="true" />}
              {i === 0 && <Warehouse size={13} aria-hidden="true" />}
              <strong>{name(id)}</strong>
              {i === path.length - 1 && <Package size={13} aria-hidden="true" />}
            </span>
          ))
        ) : (
          <span className="path-missing">
            <CircleAlert size={13} />
            No available supply route
          </span>
        )}
      </div>
      <dl className="journey-facts">
        <div>
          <dt>Food assigned</dt>
          <dd>
            {delivery.assignedTonnes}
            <small> of {delivery.requestedTonnes} t</small>
          </dd>
        </div>
        <div>
          <dt>Travel estimate</dt>
          <dd>
            {delivery.hours ?? "—"}
            <small> hours</small>
          </dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            {delivery.distanceKm}
            <small> km</small>
          </dd>
        </div>
        <div>
          <dt>Cost per tonne</dt>
          <dd>
            {usd(delivery.costPerTonne)}
            <small>
              {delivery.plannedCostPerTonne !== null && delivery.plannedCostPerTonne !== delivery.costPerTonne
                ? ` plan ${usd(delivery.plannedCostPerTonne)}`
                : ` ${delivery.modes.join(" + ")}`}
            </small>
          </dd>
        </div>
      </dl>
      <p className="decision-reason">
        <Check size={14} aria-hidden="true" />
        {delivery.reason}
      </p>
    </section>
  );
}
