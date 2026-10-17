"use client";

import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { formatNumber } from "@/lib/presentation";
import type { Network, Plan } from "@/lib/types";
import { StatusBadge } from "./status-badge";

interface Props { network: Network; plan: Plan; selectedId: string; onSelect: (id: string) => void }

export function DispatchBoard({ network, plan, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [search, setSearch] = useState("");
  const attention = plan.deliveries.filter((d) => d.status !== "on-plan").length;
  const deliveries = plan.deliveries.filter((d) => (filter === "all" || d.status !== "on-plan") && d.name.toLowerCase().includes(search.toLowerCase()));

  return <aside className="panel dispatch-panel" aria-label="Dispatch board">
    <div className="panel-heading"><div><p className="eyebrow">DISPATCH BOARD</p><h2>Community deliveries</h2></div><span className="count">{plan.deliveries.length}</span></div>
    <div className="dispatch-controls">
      <div className="segmented" aria-label="Filter deliveries">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All deliveries</button>
        <button aria-pressed={filter === "attention"} onClick={() => setFilter("attention")}>Attention <span>{attention}</span></button>
      </div>
      <label className="search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search communities" placeholder="Find a community…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    </div>
    <div className="delivery-list">
      {deliveries.map((delivery) => {
        const supplier = network.nodes.find((n) => n.id === delivery.supplierId);
        return <button className={`delivery-item ${selectedId === delivery.communityId ? "selected" : ""}`} key={delivery.communityId} aria-pressed={selectedId === delivery.communityId} onClick={() => onSelect(delivery.communityId)}>
          <span className="delivery-first"><strong>{delivery.name}</strong><StatusBadge status={delivery.status} /></span>
          <span className="delivery-journey">{supplier?.name ?? "No available hub"}<ArrowRight size={12} aria-hidden="true" />{delivery.name}</span>
          <span className="delivery-last"><span>{formatNumber(delivery.people)} people</span><span>{delivery.assignedTonnes} t <i>·</i> {delivery.hours === null ? "No ETA" : `${delivery.hours} h`}</span></span>
        </button>;
      })}
      {!deliveries.length && <p className="empty-state">{search ? "No communities match your search." : "All deliveries are on plan."}</p>}
    </div>
    <div className="dispatch-foot"><span className="small-dot" /> Ranked by food insecurity and days of food left</div>
  </aside>;
}
