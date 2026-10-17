import { Check, CircleSlash, Warehouse } from "lucide-react";
import { statusMeta } from "@/lib/presentation";
import type { DeliveryStatus, Hub, Network, Plan } from "@/lib/types";

interface Props { network: Network; plan: Plan; pending: boolean; onToggle: (id: string) => void }

export function Insights({ network, plan, pending, onToggle }: Props) {
  const outcomes: [DeliveryStatus, number][] = [["on-plan", plan.summary.onPlan], ["rerouted", plan.summary.rerouted], ["supplier-changed", plan.summary.supplierChanged], ["unreachable", plan.summary.unreachable]];
  const hubs = network.nodes.filter((node): node is Hub => node.kind === "hub");
  return <section id="insights" className="insights-section">
    <div className="section-heading"><div><p className="eyebrow">NETWORK INSIGHTS</p><h2>Every route has a human outcome.</h2></div><p>Results update with the current scenario.</p></div>
    <div className="insights-grid">
      <article className="panel insight-card"><h3>Delivery outcomes</h3><p className="muted">Across {plan.deliveries.length} community allocations</p>
        <div className="outcome-bars">{outcomes.map(([status, count]) => <div className="bar-row" key={status}><div><span>{statusMeta[status].label}</span><strong>{count}<small> / {plan.deliveries.length}</small></strong></div><div className="bar-track" role="img" aria-label={`${statusMeta[status].label}: ${count} of ${plan.deliveries.length}`}><span style={{ width: `${100 * count / plan.deliveries.length}%`, background: statusMeta[status].color }} /></div></div>)}</div>
      </article>
      <article className="panel insight-card"><h3>Supply at the hubs</h3><p className="muted">Available stock after planned allocations</p>
        <div className="inventory-list">{hubs.map((hub) => <div className="inventory-item" key={hub.id}><span className="inventory-icon"><Warehouse size={17} /></span><div><strong>{hub.name}</strong><span>{hub.description}</span></div><div className="inventory-stock"><strong>{plan.stockRemaining[hub.id]}<small> t</small></strong><span>of {hub.stockTonnes} t</span></div></div>)}</div>
      </article>
      <article className="panel insight-card exposure-card"><h3>Corridor exposure</h3><p className="muted">Top five illustrative disruption probabilities · 72 h</p>
        <div className="risk-list">{[...network.corridors].sort((a, b) => b.risk - a.risk).slice(0, 5).map((road) => <div className="risk-row" key={road.id}><span>{road.name}</span><div className="bar-track"><span style={{ width: `${road.risk * 100}%` }} /></div><strong>{Math.round(road.risk * 100)}%</strong></div>)}</div>
      </article>
    </div>
    <details className="panel corridor-panel"><summary>Manage individual corridors <span>{plan.closedRoads.length} closed / {network.corridors.length} total</span></summary><p className="muted">Close or reopen any connection. The server recalculates the dispatch plan.</p><div className="table-scroll"><table><thead><tr><th>Corridor</th><th>Travel time</th><th>72 h exposure</th><th>State</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{network.corridors.map((road) => {
      const closed = plan.closedRoads.includes(road.id);
      return <tr key={road.id}><td>{road.name}</td><td>{road.hours} h</td><td>{Math.round(road.risk * 100)}%</td><td><span className={`corridor-state ${closed ? "closed" : ""}`}>{closed ? <CircleSlash size={13} /> : <Check size={13} />}{closed ? "Closed" : "Open"}</span></td><td><button className="text-button" disabled={pending} aria-label={`${closed ? "Reopen" : "Close"} ${road.name}`} onClick={() => onToggle(road.id)}>{closed ? "Reopen" : "Close corridor"}</button></td></tr>;
    })}</tbody></table></div></details>
  </section>;
}
