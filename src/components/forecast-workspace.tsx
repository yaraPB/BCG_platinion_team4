"use client";

import { ArrowRight, Play } from "lucide-react";
import type { Forecast, ForecastInput, HazardId, Network } from "./model/types";
import { formatNumber, percent, statusMeta } from "@/lib/presentation";

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
          Your scenario probabilities, simulated on the server: corridors inside
          a hazard area fail together, with consequences by hazard and road
          surface. For a news alert, use Simulate alert in the Tower view.
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
                <dt>Network splits further</dt>
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
