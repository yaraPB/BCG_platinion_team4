"use client";

import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Check, ChevronDown, Newspaper, Plane, Route, Sparkles, Truck, Ship, Warehouse, X } from "lucide-react";
import { api, hours, pct, usd } from "@/lib/api";
import type { BreakingNews, IncidentSuggestion, Network as SourceNetwork, NewsTemplate } from "@/lib/types";

/** Header control: pick a simulated news story and publish it. */
export function NewsTrigger({ pending, onTrigger }: { pending: boolean; onTrigger: (templateId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<NewsTemplate[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || templates) return;
    api<NewsTemplate[]>("alerts/templates").then(setTemplates).catch(() => setTemplates([]));
  }, [open, templates]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="news-trigger" ref={box}>
      <button className="button news-button" disabled={pending} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Newspaper size={14} />
        {pending ? "Analysing news…" : "Breaking news"}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="news-menu" role="menu">
          <p>Publish a simulated news alert. ViaMensa analyses it, predicts endangered roads and suggests fallbacks.</p>
          {templates === null && <span className="news-loading">Loading stories…</span>}
          {templates?.map((t) => (
            <button key={t.id} role="menuitem" onClick={() => { setOpen(false); onTrigger(t.id); }}>
              <strong>{t.teaser}</strong>
              <span>{t.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const actionMeta: Record<IncidentSuggestion["action"], { label: string; icon: typeof Route; tone: string }> = {
  new_supplier: { label: "New supplier", icon: Warehouse, tone: "amber" },
  switch_supplier: { label: "Switch supplier", icon: Warehouse, tone: "amber" },
  reroute: { label: "Reroute", icon: Route, tone: "river" },
  airlift: { label: "Airlift", icon: Plane, tone: "coral" },
};

/** Map overlay: the incident brief for the latest simulated news alert. */
export function IncidentCard({ brief, network, applied, pending, onApply, onClose, onFocus }: {
  brief: BreakingNews;
  network: SourceNetwork;
  applied: boolean;
  pending: boolean;
  onApply: () => void;
  onClose: () => void;
  onFocus: (communityId: string) => void;
}) {
  const name = (id: string | null) => network.nodes.find((n) => n.id === id)?.name ?? network.corridors.find((c) => c.id === id)?.name ?? id ?? "";
  const engine = brief.analysis.engine === "claude" ? "AI analyst" : "Rule-based analyst";
  const [expanded, setExpanded] = useState(false);
  if (applied && !expanded) {
    // Collapsed after applying, so the reroute animation on the map stays visible.
    return (
      <section className="incident-card compact" aria-label="Breaking news incident brief">
        <header>
          <span className="breaking-tag"><i />Breaking · applied</span>
          <button className="icon-button" aria-label="Close incident brief" onClick={onClose}><X size={14} /></button>
        </header>
        <h2>{brief.alert.title}</h2>
        <p className="applied"><Check size={14} /> {brief.ifItHappens.closes.length} roads closed · {brief.suggestions.length} deliveries re-planned</p>
        <div className="compact-chips">
          {brief.suggestions.map((sg) => (
            <button key={sg.destination} className={`badge badge-${actionMeta[sg.action].tone}`} onClick={() => onFocus(sg.destination)}>
              {sg.name}: {actionMeta[sg.action].label}
            </button>
          ))}
        </div>
        <button className="text-link" onClick={() => setExpanded(true)}>Show the full brief</button>
      </section>
    );
  }
  return (
    <section className="incident-card" aria-label="Breaking news incident brief">
      <header>
        <span className="breaking-tag"><i />Breaking · simulated</span>
        <button className="icon-button" aria-label="Close incident brief" onClick={onClose}><X size={14} /></button>
      </header>
      <h2>{brief.alert.title}</h2>
      <p className="incident-body">{brief.alert.body}</p>
      <p className="incident-meta"><BrainCircuit size={12} /> {engine} · {brief.analysis.issues.length} issues · {brief.simulation.runs.toLocaleString()} futures simulated in {Math.round(brief.simulation.elapsedMs)} ms</p>

      <h3>Endangered roads</h3>
      <ul className="endangered-list">
        {brief.endangeredRoads.slice(0, 5).map((e) => (
          <li key={e.corridorId}>
            <span>{e.mode === "river" ? <Ship size={12} /> : <Truck size={12} />}{e.name}</span>
            <i><b style={{ width: pct(e.pClosed) }} /></i>
            <strong>{pct(e.pClosed)}</strong>
          </li>
        ))}
        {!brief.endangeredRoads.length && <li className="muted">No road on your network is affected.</li>}
      </ul>

      <h3>If it happens <span className="muted">· {brief.ifItHappens.closes.length} roads close</span></h3>
      <ul className="suggestion-list">
        {brief.suggestions.map((sg) => {
          const meta = actionMeta[sg.action];
          return (
            <li key={sg.destination} className={`tone-${meta.tone}`}>
              <button className="suggestion-head" onClick={() => onFocus(sg.destination)} title="Show on map">
                <meta.icon size={14} />
                <strong>{sg.name}</strong>
                <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
                {sg.untraveledCorridors.length > 0 && <span className="badge badge-new"><Sparkles size={10} />Untraveled route</span>}
              </button>
              <p>
                {sg.action === "airlift"
                  ? <>No supplier can reach {sg.name} by road or river: air from {name(sg.suggestedSupplier)}.</>
                  : <>{sg.newSupplier ? <>Consider <b>{name(sg.suggestedSupplier)}</b>, which has never supplied {sg.name}, </> : <>{name(sg.suggestedSupplier)} </>}
                    via {sg.modes.join(" + ")}{sg.untraveledCorridors.length > 0 && <> using {sg.untraveledCorridors.map(name).join(", ")}</>}.</>}
              </p>
              <dl>
                <div><dt>Cost</dt><dd>{usd(sg.costPerT)}/t{sg.currentCostPerT !== null && <small> now {usd(sg.currentCostPerT)}</small>}</dd></div>
                <div><dt>Time</dt><dd>{hours(sg.hours)}</dd></div>
                <div><dt>Route cut</dt><dd>{pct(sg.pRouteCut)}</dd></div>
              </dl>
            </li>
          );
        })}
        {!brief.suggestions.length && <li className="muted">No delivery needs to change.</li>}
      </ul>

      <div className="incident-actions">
        {applied ? (
          <span className="applied"><Check size={14} /> Scenario applied: watch the vehicles take their new routes.</span>
        ) : (
          <button className="button primary" disabled={pending || !brief.ifItHappens.closes.length} onClick={onApply}>
            Apply scenario &amp; re-plan
          </button>
        )}
      </div>
    </section>
  );
}
