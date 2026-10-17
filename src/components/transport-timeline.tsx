"use client";

import { useEffect, useState, type RefObject } from "react";
import { Pause, Play, RotateCcw, Truck } from "lucide-react";
import type { Plan, SimulationClock } from "./model/types";

export function TransportTimeline({ plan, selectedId, onSelect, clock, onSeek, playing, reducedMotion, onPlaying, speed, onSpeed }: { plan: Plan; selectedId: string; onSelect: (id: string) => void; clock: RefObject<SimulationClock>; onSeek: (hour: number) => void; playing: boolean; reducedMotion: boolean; onPlaying: () => void; speed: number; onSpeed: (speed: number) => void }) {
  const [hour, setHour] = useState(3);
  useEffect(() => {
    let frame = 0, previous = performance.now(), lastLabel = 0;
    const tick = (now: number) => {
      if (playing) onSeek((clock.current.hour + Math.min(now - previous, 100) / 1000 * .2 * speed) % 48);
      previous = now;
      if (now - lastLabel > 120) { setHour(clock.current.hour); lastLabel = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, playing, speed, onSeek]);
  const visible = [...plan.deliveries].sort((a, b) => Number(b.communityId === selectedId) - Number(a.communityId === selectedId)).slice(0, 3);
  const label = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor(hour % 1 * 60)).padStart(2, "0")}`;
  return <section className="transport-timeline" aria-label="Transport simulation">
    <div className="timeline-heading"><h2><Truck size={15} />Transport progress <span>SIMULATION</span></h2><div className="playback"><button className="icon-button" aria-label={playing ? "Pause transport" : "Play transport"} disabled={reducedMotion} onClick={onPlaying}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button className="icon-button" aria-label="Restart transport" onClick={() => { onSeek(0); setHour(0); }}><RotateCcw size={13} /></button><button className="speed-button" onClick={() => onSpeed(speed === 4 ? 1 : speed * 2)} aria-label={`Playback speed ${speed} times`}>{speed}×</button><time>+{label}</time></div></div>
    <div className="timeline-axis"><span>Departure</span><div>{[0, 12, 24, 36, 48].map(n => <span key={n}>{n} h</span>)}</div></div>
    <div className="timeline-tracks">{visible.map(d => { const index = plan.deliveries.indexOf(d), start = index * .6; const progress = Math.max(0, Math.min(1, (hour - start) / (d.hours || 1))); return <button className={`timeline-row ${d.communityId === selectedId ? "selected" : ""}`} key={d.communityId} onClick={() => onSelect(d.communityId)}><span>{d.name}</span><div className="timeline-track">{d.hours !== null ? <><i className="timeline-duration" style={{ left: `${start / 48 * 100}%`, width: `${d.hours / 48 * 100}%` }}><b style={{ width: `${progress * 100}%` }} /></i><span className="timeline-arrival" style={{ left: `${Math.min(95, (start + d.hours) / 48 * 100)}%` }}>{d.hours} h</span></> : <span className="timeline-unavailable">Awaiting an open corridor</span>}</div></button>; })}<div className="timeline-playhead" style={{ left: `calc(var(--track-label) + (100% - var(--track-label)) * ${hour / 48})` }} /></div>
    <label className="timeline-scrubber"><span className="sr-only">Simulation time in hours</span><input type="range" min="0" max="48" step=".1" value={hour} onChange={event => { const next = Number(event.target.value); onSeek(next); setHour(next); }} /></label>
  </section>;
}
