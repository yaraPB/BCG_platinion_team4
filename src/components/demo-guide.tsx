"use client";

import { ChevronLeft, ChevronRight, Play, RotateCcw, X } from "lucide-react";

export interface DemoStep {
  id: string;
  title: string;
  say: string;
  action: string;
}

/** Presenter panel: one-click steps through the story, with talking points. Keyboard: → next, ← back, R reset. */
export function DemoGuide({ steps, index, busy, onRun, onIndex, onReset, onClose }: {
  steps: DemoStep[];
  index: number;
  busy: boolean;
  onRun: (index: number) => void;
  onIndex: (index: number) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const step = steps[index];
  return (
    <aside className="demo-guide" aria-label="Demo guide">
      <header>
        <span className="demo-tag">Demo · step {index + 1} of {steps.length}</span>
        <div className="demo-dots" aria-hidden="true">
          {steps.map((s, i) => <i key={s.id} className={i < index ? "done" : i === index ? "current" : ""} />)}
        </div>
        <button className="icon-button" aria-label="Close demo guide" onClick={onClose}><X size={14} /></button>
      </header>
      <h2>{step.title}</h2>
      <p>{step.say}</p>
      <div className="demo-controls">
        <button className="button small" disabled={index === 0 || busy} onClick={() => onIndex(index - 1)} aria-label="Previous step"><ChevronLeft size={14} /></button>
        <button className="button primary" disabled={busy} onClick={() => onRun(index)}>
          <Play size={13} />{busy ? "Working…" : step.action}
        </button>
        <button className="button small" disabled={index === steps.length - 1 || busy} onClick={() => onIndex(index + 1)} aria-label="Next step"><ChevronRight size={14} /></button>
        <button className="button small" disabled={busy} onClick={onReset} title="Reset demo (R)"><RotateCcw size={13} />Reset</button>
      </div>
      <p className="demo-keys"><kbd>→</kbd> run next · <kbd>←</kbd> back · <kbd>N</kbd> breaking news · <kbd>R</kbd> reset · <kbd>D</kbd> hide</p>
    </aside>
  );
}
