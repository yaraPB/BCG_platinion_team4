export type Coordinate = [number, number];

interface BaseNode {
  id: string;
  name: string;
  coordinates: Coordinate;
}

export interface Hub extends BaseNode {
  kind: "hub";
  description: string;
  stockTonnes: number;
}

export interface Community extends BaseNode {
  kind: "community";
  people: number;
  demandTonnes: number;
  ipc: number;
  foodDays: number;
  plannedHub: string;
}

export interface Junction extends BaseNode {
  kind: "junction";
}

export type NetworkNode = Hub | Community | Junction;

export interface Corridor {
  id: string;
  from: string;
  to: string;
  hours: number;
  name: string;
  risk: number;
}

export interface Scenario {
  id: string;
  label: string;
  description: string;
  closedRoads: string[];
}

export interface Network {
  region: string;
  notice: string;
  nodes: NetworkNode[];
  corridors: Corridor[];
  scenarios: Scenario[];
}

export type DeliveryStatus = "on-plan" | "rerouted" | "supplier-changed" | "unreachable";

export interface Delivery {
  communityId: string;
  name: string;
  people: number;
  requestedTonnes: number;
  assignedTonnes: number;
  ipc: number;
  foodDays: number;
  plannedSupplierId: string;
  supplierId: string | null;
  status: DeliveryStatus;
  hours: number | null;
  path: string[];
  roadIds: string[];
  coordinates: Coordinate[];
  reason: string;
}

export interface Plan {
  closedRoads: string[];
  deliveries: Delivery[];
  stockRemaining: Record<string, number>;
  summary: {
    reachablePeople: number;
    totalPeople: number;
    assignedTonnes: number;
    totalTonnes: number;
    onPlan: number;
    rerouted: number;
    supplierChanged: number;
    unreachable: number;
  };
}
