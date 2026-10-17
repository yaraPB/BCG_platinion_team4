"use client";

import { ArrowRight, Play, ShieldCheck, Warehouse } from "lucide-react";
import type { Forecast, ForecastInput, HazardId, Network } from "./model/types";
import { formatNumber, percent, statusMeta } from "@/lib/presentation";
import { StatusBadge } from "./status-badge";

const statuses = Object.keys(statusMeta) as (keyof typeof statusMeta)[];

/** Left column of the forecast view: assumptions, headline outlook and corridor exposure. */
export function ForecastControls({
  network,
  forecast,
  probabilities,
  horizon,
  pending,
  stale,
  onProbability,
  onHorizon,
  onRun,
  onApply,
  onHoverRoad,
}: {
  network: Network;
  forecast: Forecast | null;
  probabilities: Record<HazardId, number>;
  horizon: ForecastInput["horizon"];
  pending: boolean;
  stale: boolean;
  onProbability: (id: HazardId, p: number) => void;
  onHorizon: (h: ForecastInput["horizon"]) => void;
  onRun: () => void;
  onApply: () => void;
  onHoverRoad: (id: string | null) => void;
}) {
  return (
    <>
      <div className="side-section">
        <div className="side-head">
          <h2>Risk assumptions</h2>
          <span>Illustrative model</span>
        </div>
        <div className="horizon-control">
          <span>Planning horizon</span>
          <div className="segmented">
            {([24, 48, 72] as const).map((h) => (
              <button
                key={h}
                aria-pressed={horizon === h}
                onClick={() => onHorizon(h)}
              >
                {h} h
              </button>
            ))}
          </div>
        </div>
        {network.hazards.map((h) => (
          <label className="risk-slider" key={h.id}>
            <span>
              <strong>{h.title.split(" · ")[0]}</strong>
              <b>{percent(probabilities[h.id])}</b>
            </span>
            <small>{h.description}</small>
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              aria-label={`${h.title.split(" · ")[0]} probability`}
              value={probabilities[h.id]}
              onChange={(e) => onProbability(h.id, Number(e.target.value))}
            />
            <span className="range-endpoints">
              <span>Unlikely</span>
              <span>Very likely</span>
            </span>
          </label>
        ))}
        <button
          className="button primary wide"
          disabled={pending}
          onClick={onRun}
        >
          <Play size={14} />
          {pending ? "Exploring 2,000 scenarios" : "Run 2,000 scenarios"}
        </button>
        <p className="model-note">
          Hypothetical probabilities and independent corridor failures. No live
          weather or security feeds.
        </p>
      </div>
      {forecast && (
        <>
          <div className="side-section">
            <div className="side-head">
              <h2>Outlook</h2>
              {stale ? (
                <span className="stale-chip">Assumptions changed</span>
              ) : (
                <span>Next {forecast.horizon} hours</span>
              )}
            </div>
            <dl className="readout-list">
              <div>
                <dt>Expected people connected</dt>
                <dd>{formatNumber(forecast.expectedPeople)}</dd>
              </div>
              <div>
                <dt>Any delivery disrupted</dt>
                <dd>{percent(forecast.disruptionProbability)}</dd>
              </div>
              <div>
                <dt>Network splits in two</dt>
                <dd>{percent(forecast.splitProbability)}</dd>
              </div>
            </dl>
          </div>
          <div className="side-section">
            <div className="side-head">
              <h2>Corridor exposure</h2>
              <span>Closure probability</span>
            </div>
            <div className="exposure-bars">
              {forecast.roads
                .slice()
                .sort((a, b) => b.probability - a.probability)
                .slice(0, 6)
                .map((r) => (
                  <div
                    key={r.id}
                    onMouseEnter={() => onHoverRoad(r.id)}
                    onMouseLeave={() => onHoverRoad(null)}
                  >
                    <span>
                      {network.corridors.find((c) => c.id === r.id)?.name}
                    </span>
                    <i>
                      <b style={{ width: percent(r.probability) }} />
                    </i>
                    <strong>{percent(r.probability)}</strong>
                  </div>
                ))}
            </div>
            <button
              className="text-button"
              disabled={stale || pending}
              onClick={onApply}
            >
              Close every corridor at 50% or more
              <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
    </>
  );
}

/** Bottom strip of the forecast view: outcome probability per destination. */
export function OutlookChart({
  network,
  forecast,
  stale,
  pending,
  onRun,
}: {
  network: Network;
  forecast: Forecast | null;
  stale: boolean;
  pending: boolean;
  onRun: () => void;
}) {
  return (
    <section className="outlook-strip" aria-label="Delivery outlook">
      <div className="strip-head">
        <h2>
          Delivery outlook
          {forecast && <span>next {forecast.horizon} hours</span>}
        </h2>
        {forecast && stale && (
          <span className="stale-chip">Run again to refresh</span>
        )}
        <ul className="chart-legend">
          {statuses.map((status) => (
            <li key={status}>
              <i style={{ background: statusMeta[status].color }} />
              {statusMeta[status].label}
            </li>
          ))}
        </ul>
      </div>
      {forecast ? (
        <div className="outcome-rows">
          {forecast.destinations.map((d) => (
            <div className="outcome-row" key={d.communityId}>
              <span className="outcome-name">
                {network.nodes.find((n) => n.id === d.communityId)?.name}
              </span>
              <div
                className="stacked-bar"
                role="img"
                aria-label={statuses
                  .map(
                    (status) =>
                      `${statusMeta[status].label} ${percent(d.probabilities[status])}`,
                  )
                  .join(", ")}
              >
                {statuses.map((status) => {
                  const p = d.probabilities[status];
                  if (p <= 0) return null;
                  return (
                    <span
                      key={status}
                      style={{
                        flexBasis: percent(p),
                        background: statusMeta[status].color,
                      }}
                      title={`${statusMeta[status].label}: ${percent(p)}`}
                    >
                      {p >= 0.15 ? percent(p) : ""}
                    </span>
                  );
                })}
              </div>
              <strong>{percent(d.probabilities["on-plan"])}</strong>
            </div>
          ))}
          <div className="outcome-foot">
            <span>Share of scenarios by outcome</span>
            <span>On plan</span>
          </div>
        </div>
      ) : (
        <div className="strip-empty">
          <p>
            Set the assumptions, then run the simulation to see how closures
            could affect each community.
          </p>
          <button className="button primary" disabled={pending} onClick={onRun}>
            <Play size={14} />
            {pending ? "Exploring 2,000 scenarios" : "Run 2,000 scenarios"}
          </button>
        </div>
      )}
    </section>
  );
}

/** Left column of the playbook view: supply reserves to hold at each hub. */
export function PlaybookReserves({
  network,
  forecast,
  stale,
  onRefresh,
}: {
  network: Network;
  forecast: Forecast | null;
  stale: boolean;
  onRefresh: () => void;
}) {
  const name = (id: string | null) =>
    network.nodes.find((n) => n.id === id)?.name ?? "No available hub";
  return (
    <div className="side-section">
      <div className="side-head">
        <h2>Reserves to hold</h2>
        {forecast ? (
          stale ? (
            <span className="stale-chip">Forecast outdated</span>
          ) : (
            <span>90th percentile of fallback demand</span>
          )
        ) : (
          <span>Needs a forecast</span>
        )}
      </div>
      {forecast ? (
        <>
          <div className="reserve-list">
            {forecast.hubs.map((h) => (
              <article className="reserve-card" key={h.hubId}>
                <span className="reserve-icon">
                  <Warehouse size={16} />
                </span>
                <div>
                  <strong>{name(h.hubId)}</strong>
                  <span>Called on as a fallback in {percent(h.fallbackProbability)} of scenarios</span>
                  <i>
                    <b style={{ width: percent(h.fallbackProbability) }} />
                  </i>
                </div>
                <b className="reserve-tonnes">
                  {h.reserveTonnes}
                  <small>t</small>
                </b>
              </article>
            ))}
          </div>
          <p className="model-note">
            Simulated extra demand, not orders or confirmed inventory.
          </p>
        </>
      ) : (
        <div className="side-empty">
          <ShieldCheck size={22} />
          <p>Run a risk simulation to see where to pre-position food.</p>
        </div>
      )}
      <button className="button wide" onClick={onRefresh}>
        {forecast ? "Adjust forecast" : "Open risk forecast"}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

/** Bottom strip of the playbook view: the most likely contingency per community. */
export function PlaybookTable({
  network,
  forecast,
}: {
  network: Network;
  forecast: Forecast | null;
}) {
  const name = (id: string | null) =>
    network.nodes.find((n) => n.id === id)?.name ?? "No available hub";
  return (
    <section className="playbook-strip" aria-label="Fallback playbook">
      <div className="strip-head">
        <h2>Fallback per community</h2>
        <span className="strip-note">From the last simulation</span>
      </div>
      {forecast ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Community</th>
                <th>Most likely contingency</th>
                <th>Observed trigger</th>
                <th>Preparation</th>
              </tr>
            </thead>
            <tbody>
              {forecast.destinations.map((d) => (
                <tr key={d.communityId}>
                  <td>
                    <strong>{name(d.communityId)}</strong>
                  </td>
                  <td>
                    {d.contingency ? (
                      <span className="cell-status">
                        <StatusBadge status={d.contingency.status} />
                        <small>{percent(d.contingency.probability)} of scenarios</small>
                      </span>
                    ) : (
                      <span className="cell-status">
                        <StatusBadge status="on-plan" />
                        <small>Plan holds</small>
                      </span>
                    )}
                  </td>
                  <td>
                    {network.corridors.find((r) => r.id === d.triggerId)?.name ??
                      "No recurrent closure"}
                  </td>
                  <td>
                    {!d.contingency
                      ? "Maintain the planned dispatch."
                      : d.contingency.status === "unreachable"
                        ? "Review access and pre-position food."
                        : d.contingency.status === "supplier-changed"
                          ? `Prepare an allocation from ${name(d.contingency.hubId)}.`
                          : `Prepare an alternative route from ${name(d.contingency.hubId)}.`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="strip-empty">
          <p>The playbook fills in once a risk simulation has run.</p>
        </div>
      )}
    </section>
  );
}
