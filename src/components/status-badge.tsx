import { ArrowRightLeft, Check, CircleAlert, Route } from "lucide-react";
import { statusMeta } from "@/lib/presentation";
import type { DeliveryStatus } from "@/lib/types";

const icons = { "on-plan": Check, rerouted: Route, "supplier-changed": ArrowRightLeft, unreachable: CircleAlert };

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const Icon = icons[status];
  return <span className={`status-badge status-${status}`}><Icon size={12} aria-hidden="true" />{statusMeta[status].label}</span>;
}
