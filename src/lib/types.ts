export type Coordinate = [number, number];

interface BaseNode {
  id: string;
  name: string;
  coordinates: Coordinate;
  coordinateSource?: string | null;
}

export interface Hub extends BaseNode {
  kind: "hub";
  description: string | null;
  /** Suppliers are treated as unconstrained by the planner; null means "not tracked". */
  stockTonnes: number | null;
  air: boolean;
}

export interface Community extends BaseNode {
  kind: "community";
  people: number;
  demandTonnes: number;
  /** Client priority on a 1–5 scale (kept as `ipc` for backwards compatibility). */
  ipc: number;
  priority: number;
  foodDays: number | null;
  plannedHub: string;
  foodSecurityContext: string | null;
}

export interface Junction extends BaseNode {
  kind: "junction";
}

export interface Port extends BaseNode {
  kind: "port";
}

export type NetworkNode = Hub | Community | Junction | Port;

export type CorridorMode = "road" | "river" | "transfer";

export interface Corridor {
  id: string;
  from: string;
  to: string;
  hours: number;
  hoursReverse: number;
  name: string;
  mode: CorridorMode;
  surface: string;
  km: number;
  costPerTonne: number;
  risk: number | null;
  geometry: Coordinate[];
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
  attribution: string;
  version: number;
  nodes: NetworkNode[];
  corridors: Corridor[];
  scenarios: Scenario[];
}

export type DeliveryStatus = "on-plan" | "rerouted" | "supplier-changed" | "unreachable";
export type OptionKind = "planned" | "reroute" | "switch_supplier" | "airlift";

export interface RouteLeg {
  corridorId: string;
  name: string;
  mode: CorridorMode;
  from: string;
  to: string;
  km: number;
  hours: number;
  costPerTonne: number;
}

export interface Route {
  supplier: string;
  destination: string;
  nodes: string[];
  corridors: string[];
  km: number;
  hours: number;
  costPerTonne: number;
  modes: string[];
  legs: RouteLeg[];
  coordinates: Coordinate[];
}

export interface DeliveryOption {
  kind: OptionKind;
  supplier: string;
  costPerTonne: number;
  hours: number;
  totalCostUsd: number;
  route: Route | null;
  airKm: number | null;
}

export interface Delivery {
  communityId: string;
  name: string;
  people: number;
  requestedTonnes: number;
  assignedTonnes: number;
  ipc: number;
  priority: number;
  foodDays: number | null;
  plannedSupplierId: string;
  supplierId: string | null;
  status: DeliveryStatus;
  fallback: OptionKind;
  hours: number | null;
  costPerTonne: number;
  costUsd: number;
  plannedHours: number | null;
  plannedCostPerTonne: number | null;
  modes: string[];
  path: string[];
  roadIds: string[];
  coordinates: Coordinate[];
  airlift: DeliveryOption | null;
  reason: string;
}

export interface Plan {
  closedRoads: string[];
  objective: "cost" | "time";
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
    totalCostUsd: number;
    plannedCostUsd: number;
  };
}

export interface Itinerary {
  origin: string;
  destination: string;
  objective: "cost" | "time";
  tonnes: number;
  status: "on-plan" | "rerouted" | "supplier-changed" | "airlift";
  split: boolean;
  explanation: string;
  closedRoads: string[];
  baseline: Route | null;
  best: DeliveryOption;
  options: DeliveryOption[];
  destinationComponent: string[];
  reachableSuppliers: string[];
}

export interface Alert {
  id: string;
  title: string;
  body: string;
  source: string;
  url: string | null;
  publishedAt: string | null;
  isSample: boolean;
  createdAt: string;
}

export type Likelihood = "very_likely" | "likely" | "possible" | "unlikely";

export interface Issue {
  id: string;
  rank: number;
  title: string;
  kind: string;
  likelihood: Likelihood;
  severity: "low" | "medium" | "high";
  probability: number;
  affectedCorridorIds: string[];
  affectedNodeIds: string[];
  durationDays: number;
  rationale: string;
  evidenceAlertIds: string[];
}

export interface Analysis {
  id: string;
  engine: "claude" | "rules";
  model: string | null;
  engineNote: string | null;
  createdAt: string;
  summary: string;
  issues: Issue[];
  likelihoodBands: Record<Likelihood, number>;
  notice: string;
}

export interface SimulationTarget {
  origin: string;
  destination: string;
  tonnes: number;
  people: number;
  statusShare: Record<"on-plan" | "rerouted" | "supplier-changed" | "airlift", number>;
  pBaselineBlocked: number;
  costPerT: { mean: number; p50: number; p90: number };
  hours: { mean: number; p50: number; p90: number };
  baselineCostPerT: number | null;
  baselineHours: number | null;
  topPlans: { signature: string; kind: OptionKind; status: string; supplier: string; share: number; costPerT: number; hours: number; corridors: string[] }[];
  expectedSavings: { usdVsAirlift: number; peopleDaysVsWaiting: number; pLandFallbackWhenCut: number };
  topTrigger: string | null;
}

export interface PlaybookEntry {
  hazardId: string;
  title: string;
  kind: string;
  probability: number;
  closes: string[];
  degrades: string[];
  actions: { origin: string; destination: string; status: string; supplier: string; kind: OptionKind; costPerT: number; hours: number; baselineCostPerT: number | null; corridors: string[]; explanation: string }[];
}

export interface Simulation {
  id: string;
  createdAt: string;
  runs: number;
  seed: number;
  objective: "cost" | "time";
  uniqueStates: number;
  elapsedMs: number;
  pNetworkSplit: number;
  pAnyDisruption: number;
  expectedPeopleConnected: number;
  suppliers: { supplier: string; fallbackProbability: number; expectedFallbackTonnes: number; p90FallbackTonnes: number }[];
  hazards: { id: string; title: string; kind: string; probability: number; simulatedOccurrence: number }[];
  corridorClosure: Record<string, number>;
  targets: SimulationTarget[];
  planB: { supplier: string; corridors: string[]; nodes: string[]; modes: string[]; km: number; isPlanA: boolean; pOpen: number; costPerTIfOpen: number | null; hoursIfOpen: number | null; expectedCostPerT: number }[];
  playbook: PlaybookEntry[];
  impact: { expectedUsdSavedVsAirlift: number; expectedPeopleDaysProtectedVsWaiting: number; basis: string };
  modelNotes: string[];
}

export interface ImpactRow {
  destination: string;
  name: string;
  people: number;
  tonnes: number;
  status: string;
  plannedSupplier: string;
  plannedCostPerT: number | null;
  plannedHours: number | null;
  fallbackSupplier: string;
  fallbackKind: OptionKind;
  fallbackModes: string[];
  fallbackCostPerT: number;
  fallbackHours: number;
  usdSavedVsAirlift: number;
  extraUsdVsPlan: number;
  peopleDaysProtectedVsWaiting: number;
}

export interface Impact {
  closedRoads: string[];
  rows: ImpactRow[];
  totals: Record<string, number>;
  basis: { airCostPerT: number; closureDaysAssumed: number; rationKgPerPersonDay: number; cycleDays: number; statement: string };
}

export interface Assumption {
  key: string;
  value: number;
  unit: string;
  label: string;
  kind: "sourced" | "derived" | "estimate" | "client";
  source: string;
  url: string | null;
}
