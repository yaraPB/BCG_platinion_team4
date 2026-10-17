import type { DeliveryStatus } from "./types";

export const statusMeta: Record<DeliveryStatus, { label: string; color: string }> = {
  "on-plan": { label: "On plan", color: "#287b61" },
  rerouted: { label: "Rerouted", color: "#547aa3" },
  "supplier-changed": { label: "New supplier", color: "#a97529" },
  unreachable: { label: "Unreachable", color: "#b74a43" },
};

export const formatNumber = (value: number) => new Intl.NumberFormat("en-US").format(value);
