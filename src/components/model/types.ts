import type {
  Coordinate,
  Corridor as BaseCorridor,
  Delivery as BaseDelivery,
  Network as BaseNetwork,
  Plan as BasePlan,
  DeliveryStatus,
} from "@/lib/types";
export type { Coordinate, DeliveryStatus } from "@/lib/types";
export type TransportMode = "road" | "river";
export type HazardId = "flood" | "rain" | "security";
export interface Hazard {
  id: HazardId;
  title: string;
  description: string;
  probability: number;
  center: Coordinate;
  radiusKm: number;
  color: string;
}
export interface Corridor extends BaseCorridor {
  mode: TransportMode;
  coordinates: Coordinate[];
  distanceKm: number;
  geometrySource: string;
  exposure: Partial<Record<HazardId, number>>;
}
export interface Network extends Omit<BaseNetwork, "corridors"> {
  corridors: Corridor[];
  hazards: Hazard[];
}
export interface Delivery extends BaseDelivery {
  distanceKm: number;
  legs: {
    corridorId: string;
    mode: TransportMode;
    hours: number;
    coordinates: Coordinate[];
  }[];
}
export interface Plan extends Omit<BasePlan, "deliveries"> {
  deliveries: Delivery[];
  components: string[][];
}
export interface SimulationClock {
  hour: number;
}
export interface ForecastInput {
  closedRoads: string[];
  probabilities: Record<HazardId, number>;
  horizon: 24 | 48 | 72;
}
export interface Forecast {
  runs: number;
  horizon: number;
  expectedPeople: number;
  disruptionProbability: number;
  splitProbability: number;
  roads: { id: string; probability: number }[];
  destinations: {
    communityId: string;
    probabilities: Record<DeliveryStatus, number>;
    contingency: {
      status: DeliveryStatus;
      hubId: string | null;
      probability: number;
    } | null;
    triggerId: string | null;
  }[];
  hubs: {
    hubId: string;
    fallbackProbability: number;
    expectedFallbackTonnes: number;
    reserveTonnes: number;
  }[];
}
