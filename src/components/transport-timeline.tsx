"use client";

import { useEffect, useState, type RefObject } from "react";
import { CircleAlert, Pause, Play, RotateCcw, Ship, Truck } from "lucide-react";
import type { Plan, SimulationClock } from "./model/types";

export function TransportTimeline({
  plan,
  selectedId,
  onSelect,
  clock,
  onSeek,
  playing,
  reducedMotion,
  onPlaying,
  speed,
  onSpeed,
}: {
  plan: Plan;
  selectedId: string;
  onSelect: (id: string) => void;
  clock: RefObject<SimulationClock>;
  onSeek: (hour: number) => void;
  playing: boolean;
  reducedMotion: boolean;
  onPlaying: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
}) {
  const [hour, setHour] = useState(3);
  const duration = Math.max(
    12,
    Math.ceil(
      (Math.max(...plan.deliveries.map((d, i) => (d.hours ?? 0) + i * 0.6)) +
        1) /
        4,
    ) * 4,
  );
  useEffect(() => {
    let frame = 0,
      previous = performance.now(),
      lastLabel = 0;
    const tick = (now: number) => {
      if (playing)
        onSeek(
          (clock.current.hour +
            (Math.min(now - previous, 100) / 1000) * 0.2 * speed) %
            duration,
        );
      previous = now;
      if (now - lastLabel > 120) {
        setHour(clock.current.hour);
        lastLabel = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, playing, speed, onSeek, duration]);
  const label = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`;
  const ticks = [0, duration / 4, duration / 2, duration * 0.75, duration];
  return (
    <section className="transport-timeline" aria-label="Transport simulation">
      <div className="strip-head">
        <h2>Transport progress</h2>
        <span className="strip-note">Illustrative timing, not live tracking</span>
        <div className="playback">
          <button
            className="icon-button"
            aria-label={playing ? "Pause transport" : "Play transport"}
            disabled={reducedMotion}
            onClick={onPlaying}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            className="icon-button"
            aria-label="Restart transport"
            onClick={() => {
              onSeek(0);
              setHour(0);
            }}
          >
            <RotateCcw size={12} />
          </button>
          <button
            className="speed-button"
            onClick={() => onSpeed(speed === 4 ? 1 : speed * 2)}
            aria-label={`Playback speed ${speed} times`}
          >
            {speed}×
          </button>
          <time>+{label}</time>
        </div>
      </div>
      <div className="timeline-body">
        <div className="timeline-axis" aria-hidden="true">
          <span className="timeline-corner">Dispatch order</span>
          <div>
            {ticks.map((n) => (
              <span key={n}>{n} h</span>
            ))}
          </div>
        </div>
        <div className="timeline-tracks">
          {plan.deliveries.map((d, index) => {
            const start = index * 0.6;
            const progress = Math.max(
              0,
              Math.min(1, (hour - start) / (d.hours || 1)),
            );
            const river = d.legs.some((l) => l.mode === "river");
            const legs = d.legs.map((leg) => (
              <i
                key={leg.corridorId}
                className={`leg leg-${leg.mode}`}
                style={{ flexBasis: `${(leg.hours / (d.hours || 1)) * 100}%` }}
              />
            ));
            return (
              <button
                className={`timeline-row ${d.communityId === selectedId ? "selected" : ""} ${d.hours === null ? "unavailable" : ""}`}
                key={d.communityId}
                aria-pressed={d.communityId === selectedId}
                onClick={() => onSelect(d.communityId)}
              >
                <span className="timeline-name">
                  {river ? <Ship size={12} /> : <Truck size={12} />}
                  {d.name}
                </span>
                <span className="timeline-track">
                  {d.hours !== null ? (
                    <>
                      <span
                        className="timeline-legs dim"
                        style={{
                          left: `${(start / duration) * 100}%`,
                          width: `${(d.hours / duration) * 100}%`,
                        }}
                      >
                        {legs}
                      </span>
                      <span
                        className="timeline-legs lit"
                        style={{
                          left: `${(start / duration) * 100}%`,
                          width: `${(d.hours / duration) * 100}%`,
                          clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
                        }}
                      >
                        {legs}
                      </span>
                      <em
                        className="timeline-arrival"
                        style={{
                          left: `${Math.min(94, ((start + d.hours) / duration) * 100)}%`,
                        }}
                      >
                        {d.hours} h
                      </em>
                    </>
                  ) : (
                    <span className="timeline-unavailable">
                      <CircleAlert size={12} />
                      Awaiting an open corridor
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <div
            className="timeline-playhead"
            aria-hidden="true"
            style={{
              left: `calc(var(--track-label) + (100% - var(--track-label)) * ${hour / duration})`,
            }}
          />
        </div>
        <label className="timeline-scrubber">
          <span className="sr-only">Simulation time in hours</span>
          <input
            type="range"
            min="0"
            max={duration}
            step=".1"
            value={hour}
            onChange={(event) => {
              const next = Number(event.target.value);
              onSeek(next);
              setHour(next);
            }}
          />
        </label>
      </div>
    </section>
  );
}
