import { ArrowRight, PackageCheck, Warehouse } from "lucide-react";
import { formatNumber } from "@/lib/presentation";
import type { Delivery, Network, Plan } from "@/lib/types";
import { StatusBadge } from "./status-badge";

export function DeliveryDetail({ delivery, network, plan }: { delivery: Delivery; network: Network; plan: Plan }) {
  const supplier = network.nodes.find((node) => node.id === delivery.supplierId);
  const path = delivery.path.map((id) => network.nodes.find((node) => node.id === id)!.name);
  return <section className="panel delivery-detail" aria-label="Selected delivery details">
    <div className="detail-top"><div><p className="eyebrow">SELECTED DELIVERY</p><h2>{supplier ? `${supplier.name} to ${delivery.name}` : `${delivery.name} · awaiting a route`}</h2></div><StatusBadge status={delivery.status} /></div>
    <div className="detail-grid">
      <div className="journey-summary"><div className="journey-path"><span className="journey-icon"><Warehouse size={18} /></span><span>{path.length ? path.map((name, index) => <span className="journey-place" key={`${name}-${index}`}>{index > 0 && <ArrowRight size={13} aria-hidden="true" />}{name}</span>) : "No open supply path"}</span><span className="journey-icon destination"><PackageCheck size={18} /></span></div><p>{delivery.reason}</p></div>
      <dl className="detail-facts">
        <div><dt>Food assigned</dt><dd>{delivery.assignedTonnes}<small> / {delivery.requestedTonnes} t</small></dd></div>
        <div><dt>Travel estimate</dt><dd>{delivery.hours ?? "—"}<small>{delivery.hours !== null && " hours"}</small></dd></div>
        <div><dt>People served</dt><dd>{delivery.supplierId ? formatNumber(delivery.people) : "0"}</dd></div>
        <div><dt>Food remaining</dt><dd>{delivery.foodDays}<small> days</small></dd></div>
      </dl>
    </div>
    <div className="detail-foot"><span>Priority: IPC phase {delivery.ipc}</span><span>{supplier ? `${plan.stockRemaining[supplier.id]} t left at ${supplier.name} after this cycle's allocations` : "Review alternative transport or pre-positioned supply"}</span></div>
  </section>;
}
