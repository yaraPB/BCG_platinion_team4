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
  ChartNoAxesCombined,
  ChevronDown,
  CircleAlert,
  History,
  Info,
  LogOut,
  MapPinned,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  ReceiptText,
  RotateCcw,
  Route,
  Search,
  Ship,
  Siren,
  Truck,
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
import { TransportTimeline, type StripSize } from "./transport-timeline";
import { ForecastControls, OutlookChart } from "./forecast-workspace";
import type { MapView } from "./map/network-map";
import { api } from "@/lib/api";
import { ItineraryPanel } from "./itinerary-panel";
import { ImpactPanel } from "./impact-panel";
import { DemoGuide, type DemoStep } from "./demo-guide";
import type { BreakingNews, NewsTemplate } from "@/lib/types";

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
  { id: "forecast", label: "Forecast", title: "Risk forecast", icon: ChartNoAxesCombined },
  { id: "savings", label: "Savings", title: "Savings vs no fallback", icon: ReceiptText },
];
// Views rendered as a sheet over the map (the map stays mounted underneath).
const sheetViews: MapView[] = ["itinerary", "savings"];
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
// Deep links: /?view=savings or /#savings opens that view. Read as an
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
const subscribeShort = (callback: () => void) => {
  const query = window.matchMedia("(max-height: 820px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const readUrlView = (): MapView | null => {
  const requested =
    new URLSearchParams(window.location.search).get("view") ??
    window.location.hash.slice(1);
  return views.some((v) => v.id === requested) ? (requested as MapView) : null;
};
const readUrlDemo = () => new URLSearchParams(window.location.search).get("demo") === "1";
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
  const [sideOpen, setSideOpen] = useState(true);
  // The transport strip starts collapsed on short screens (laptops, projectors) so the map keeps its height.
  const short = useSyncExternalStore(
    subscribeShort,
    () => window.matchMedia("(max-height: 820px)").matches,
    () => false,
  );
  const [stripChoice, setStrip] = useState<StripSize | null>(null);
  const strip: StripSize = stripChoice ?? (short ? "collapsed" : "normal");
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

  // ---- Alert drill: a simulated news alert shows for 2 s, then the roads it predicts close and the network re-plans ----
  const [templates, setTemplates] = useState<NewsTemplate[]>([]);
  const [alertIndex, setAlertIndex] = useState(0);
  const [alertPending, setAlertPending] = useState(false);
  const [toast, setToast] = useState<{ key: number; title: string; roads: string[] } | null>(null);
  const [endangered, setEndangered] = useState<{ id: string; probability: number }[] | null>(null);
  useEffect(() => {
    api<NewsTemplate[]>("alerts/templates").then(setTemplates).catch(() => setTemplates([]));
  }, []);
  async function triggerAlert() {
    if (alertPending || pending) return;
    setAlertPending(true);
    setError(null);
    selectView("tower");
    const template = templates.length ? templates[alertIndex % templates.length] : undefined;
    try {
      const brief = await api<BreakingNews>("alerts/simulate", {
        body: { templateId: template?.id, closedRoads: plan.closedRoads },
      });
      setAlertIndex((i) => i + 1);
      const closes = brief.ifItHappens.closes.filter((id) => !plan.closedRoads.includes(id));
      const roadName = (id: string) => sourceNetwork.corridors.find((c) => c.id === id)?.name ?? id;
      setToast({ key: Date.now(), title: brief.alert.title, roads: closes.map(roadName) });
      setEndangered(
        brief.endangeredRoads
          .filter((e) => closes.includes(e.corridorId))
          .map((e) => ({ id: e.corridorId, probability: e.pClosed })),
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setToast(null);
      setEndangered(null);
      if (!closes.length) {
        setEvents((previous) =>
          [{ id: Date.now(), title: `Alert: ${brief.alert.title}`, detail: "No new road closures", time: clockLabel() }, ...previous].slice(0, 8),
        );
        return;
      }
      await applyPlan([...plan.closedRoads, ...closes], "custom", `Alert: ${brief.alert.title}`);
      const focus = brief.suggestions.find((sg) => sg.action !== "airlift") ?? brief.suggestions[0];
      if (focus) setSelectedId(focus.destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to simulate the alert.");
    } finally {
      setAlertPending(false);
    }
  }
  async function resetNetwork(title = "All corridors reopened") {
    setToast(null);
    setEndangered(null);
    setAlertIndex(0);
    await Promise.allSettled([api("demo/reset", { body: {} }), applyPlan([], "open", title)]);
  }

  // ---- Demo guide: scripted one-click steps for presenting ----
  const urlDemo = useSyncExternalStore(subscribeUrl, readUrlDemo, () => false);
  const [demoChoice, setDemoOpen] = useState<boolean | null>(null);
  const demoOpen = demoChoice ?? urlDemo;
  const [demoStep, setDemoStep] = useState(0);
  const [demoBusy, setDemoBusy] = useState(false);
  const [itineraryRun, setItineraryRun] = useState(0);
  const [demoFocus, setDemoFocus] = useState<string | undefined>(undefined);
  async function resetDemo() {
    setForecast(null);
    setDemoStep(0);
    selectView("tower");
    await resetNetwork("Demo reset: all corridors open");
  }
  const demoSteps: DemoStep[] = [
    { id: "network", title: "One network, real roads", action: "Show the network",
      say: "Five client warehouses and twelve communities in South Sudan, on OpenStreetMap roads and Nile barge legs. Every delivery has a planned route; trucks and barges move along it." },
    { id: "alert", title: "An alert comes in", action: "Simulate the alert",
      say: "A newswire alert: floods on the Juba–Bor road and attacks on Nile barges. The analyst maps the text to exact roads and predicts which will close. The roads close and every delivery is re-planned: Bor switches to Malakal, a supplier that has never served it, over a Nile leg the plan never used. Pibor and Akobo need air." },
    { id: "options", title: "Compare every option", action: "Open Bor's options",
      say: "For any delivery: the planned route, the detours, every supplier switch and air, ranked by cost per tonne and time." },
    { id: "forecast", title: "Prepare for what's next", action: "Run the forecast",
      say: "Correlated disruptions over 2,000 futures: each road's chance of closing and each delivery's outlook, on top of today's closures." },
    { id: "value", title: "What the fallback is worth", action: "Show the savings",
      say: "Against an emergency airlift at WFP's published $2,700 per tonne, or waiting for the road to reopen. Every rate has a source." },
  ];
  async function runDemoStep(index: number) {
    setDemoBusy(true);
    try {
      const id = demoSteps[index].id;
      if (id === "network") await resetDemo();
      if (id === "alert") await triggerAlert();
      if (id === "options") {
        setDemoFocus("bor");
        selectView("itinerary");
        setItineraryRun((n) => n + 1);
      }
      if (id === "forecast") {
        selectView("forecast");
        await runForecast();
      }
      if (id === "value") selectView("savings");
      setDemoStep(Math.min(index + 1, demoSteps.length - 1));
    } finally {
      setDemoBusy(false);
    }
  }
  // Keyboard shortcuts read the latest handlers through a ref, so the listener is attached once.
  const onKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "d") setDemoOpen(!demoOpen);
      else if (key === "n") void triggerAlert();
      else if (key === "r" && !demoBusy) void resetDemo();
      else if (demoOpen && event.key === "ArrowRight" && !demoBusy) void runDemoStep(demoStep);
      else if (demoOpen && event.key === "ArrowLeft") setDemoStep((i) => Math.max(0, i - 1));
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onKeyRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    link.download = "foodbridge-dispatch-plan.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const current = views.find((v) => v.id === view)!;

  return (
    <div
      className={`app-shell view-${view} strip-${strip} ${sideOpen ? "" : "side-closed"} ${pending || forecastPending ? "busy" : ""}`}
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
        <a className="rail-logo" href="#main" aria-label="FoodBridge home">
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
        <div className="rail-account">
          <button
            className={`rail-icon ${demoOpen ? "active" : ""}`}
            aria-pressed={demoOpen}
            aria-label="Guided tour and shortcuts"
            title="Guided tour and shortcuts (D)"
            onClick={() => setDemoOpen(!demoOpen)}
          >
            <Info size={18} />
          </button>
          <span className="avatar" title={user ? `${user.name}, ${user.tenant}` : undefined} aria-hidden="true">
            {(user?.name ?? "T4").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <button
            className="rail-icon"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.assign("/");
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      <header className="app-header">
        <button
          className="icon-button side-toggle"
          aria-label={sideOpen ? "Hide side panel" : "Show side panel"}
          aria-expanded={sideOpen}
          aria-controls="side-panel"
          title={sideOpen ? "Hide side panel" : "Show side panel"}
          onClick={() => setSideOpen(!sideOpen)}
        >
          {sideOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <div className="wordmark">
          <strong>FoodBridge</strong>
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
            onClick={() => void resetNetwork()}
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
      </header>

      <main id="main" className="workspace">
        <aside className="side-column" id="side-panel" aria-label={current.title}>
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
                        onSelect={() => setSelectedId(delivery.communityId)}
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
          {sheetViews.includes(view) && (
            <div className="side-section grow">
              <div className="side-head">
                <h2>Current closures</h2>
                <span>{plan.closedRoads.length} closed</span>
              </div>
              <p className="side-intro">
                {view === "itinerary"
                  ? "Itineraries are planned on the network as it is now. Click a corridor on the map to close it, then re-plan."
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
        </aside>

        <NetworkMap
          network={network}
          plan={plan}
          baseline={initialPlan}
          selectedId={selectedId}
          clock={clock}
          reducedMotion={reducedMotion}
          onSelect={setSelectedId}
          onToggleRoad={toggleRoad}
          probabilities={probabilities}
          view={view}
          roadRisk={forecast?.roads ?? null}
          highlightRoadId={hoverRoad}
          endangered={endangered}
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
          {view === "tower" && (
            <button
              className="alert-trigger"
              disabled={alertPending || pending}
              title="Simulate a news alert (N)"
              onClick={() => void triggerAlert()}
            >
              <Siren size={15} />
              {alertPending ? (toast ? "Alert in progress" : "Reading the alert…") : "Simulate alert"}
            </button>
          )}
          {toast && (
            <div className="alert-toast" key={toast.key} role="alert">
              <span className="alert-toast-tag">
                <Siren size={12} />
                Alert · simulated newswire
              </span>
              <strong>{toast.title}</strong>
              <span>{toast.roads.length ? `Closing: ${toast.roads.join(", ")}` : "No new road closures"}</span>
            </div>
          )}
          {sheetViews.includes(view) && (
            <div className="tool-sheet">
              {view === "itinerary" && <ItineraryPanel key={demoFocus ?? "default"} network={sourceNetwork} closedRoads={plan.closedRoads} initialDestination={demoFocus} autoRunKey={itineraryRun} />}
              {view === "savings" && <ImpactPanel network={sourceNetwork} closedRoads={plan.closedRoads} />}
            </div>
          )}
        </NetworkMap>

        {!sheetViews.includes(view) && (
          <section className="bottom-strip">
            {view === "tower" && (
              <TransportTimeline
                plan={plan}
                selectedId={selectedId}
                onSelect={setSelectedId}
                clock={clock}
                onSeek={seek}
                playing={playing && !reducedMotion}
                reducedMotion={reducedMotion}
                onPlaying={() => setPlaying(!playing)}
                speed={speed}
                onSpeed={setSpeed}
                size={strip}
                onSize={setStrip}
                supplierName={(id) => network.nodes.find((n) => n.id === id)?.name ?? ""}
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
          </section>
        )}
      </main>

      {demoOpen && (
        <DemoGuide
          steps={demoSteps}
          index={demoStep}
          busy={demoBusy || pending || alertPending}
          onRun={(i) => void runDemoStep(i)}
          onIndex={setDemoStep}
          onReset={() => void resetDemo()}
          onClose={() => setDemoOpen(false)}
        />
      )}
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
