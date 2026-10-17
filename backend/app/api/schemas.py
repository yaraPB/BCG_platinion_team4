"""Request/response models. Field names are camelCase on the wire (the frontend's TypeScript types)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.engine.risk import KINDS

Objective = Literal["cost", "time"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---- auth --------------------------------------------------------------------------------------------------
class LoginIn(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenOut(CamelModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    tenant: str
    user: str


class MeOut(CamelModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    tenant_id: uuid.UUID
    tenant_name: str


# ---- network ------------------------------------------------------------------------------------------------
class NodeOut(CamelModel):
    id: str
    name: str
    kind: Literal["hub", "community", "junction", "port"]
    coordinates: tuple[float, float]
    description: str | None = None
    air: bool = False
    stock_tonnes: float | None = None  # suppliers are treated as unconstrained; kept for frontend compatibility
    people: int | None = None
    demand_tonnes: float | None = None
    priority: int | None = None
    ipc: int | None = Field(default=None, description="Deprecated alias of priority (client 1–5 scale)")
    food_days: float | None = None
    planned_hub: str | None = None
    food_security_context: str | None = None
    coordinate_source: str | None = None


class CorridorOut(CamelModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    name: str
    mode: str
    surface: str
    km: float
    hours: float
    hours_reverse: float
    cost_per_tonne: float
    risk: float | None = None
    geometry: list[tuple[float, float]]


class ScenarioOut(CamelModel):
    id: str
    label: str
    description: str
    closed_roads: list[str]


class NetworkOut(CamelModel):
    region: str
    notice: str
    attribution: str
    version: int
    nodes: list[NodeOut]
    corridors: list[CorridorOut]
    scenarios: list[ScenarioOut]


# ---- planning -----------------------------------------------------------------------------------------------
class ClosureMixin(CamelModel):
    closed_roads: list[str] = Field(default_factory=list, max_length=500)
    down_nodes: list[str] = Field(default_factory=list, max_length=200)
    objective: Objective = "cost"

    @field_validator("closed_roads", "down_nodes")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class PlanIn(ClosureMixin):
    pass


class ItineraryIn(ClosureMixin):
    origin: str
    destination: str
    tonnes: float | None = Field(default=None, gt=0, le=1_000_000)


class LegOut(CamelModel):
    corridor_id: str
    name: str
    mode: str
    from_: str = Field(alias="from")
    to: str
    km: float
    hours: float
    cost_per_tonne: float


class RouteOut(CamelModel):
    supplier: str
    destination: str
    nodes: list[str]
    corridors: list[str]
    km: float
    hours: float
    cost_per_tonne: float
    modes: list[str]
    legs: list[LegOut]
    coordinates: list[tuple[float, float]]


class OptionOut(CamelModel):
    kind: Literal["planned", "reroute", "switch_supplier", "airlift"]
    supplier: str
    cost_per_tonne: float
    hours: float
    total_cost_usd: float
    route: RouteOut | None = None
    air_km: float | None = None


class ItineraryOut(CamelModel):
    origin: str
    destination: str
    objective: Objective
    tonnes: float
    status: Literal["on-plan", "rerouted", "supplier-changed", "airlift"]
    split: bool
    explanation: str
    closed_roads: list[str]
    baseline: RouteOut | None
    best: OptionOut
    options: list[OptionOut]
    destination_component: list[str]
    reachable_suppliers: list[str]


class DeliveryOut(CamelModel):
    community_id: str
    name: str
    people: int
    requested_tonnes: float
    assigned_tonnes: float
    ipc: int
    priority: int
    food_days: float | None = None
    planned_supplier_id: str
    supplier_id: str | None
    status: Literal["on-plan", "rerouted", "supplier-changed", "unreachable"]
    fallback: Literal["planned", "reroute", "switch_supplier", "airlift"]
    hours: float | None
    cost_per_tonne: float
    cost_usd: float
    planned_hours: float | None
    planned_cost_per_tonne: float | None
    modes: list[str]
    path: list[str]
    road_ids: list[str]
    coordinates: list[tuple[float, float]]
    airlift: OptionOut | None = None
    reason: str


class PlanSummary(CamelModel):
    reachable_people: int
    total_people: int
    assigned_tonnes: float
    total_tonnes: float
    on_plan: int
    rerouted: int
    supplier_changed: int
    unreachable: int
    total_cost_usd: float
    planned_cost_usd: float


class PlanOut(CamelModel):
    closed_roads: list[str]
    objective: Objective
    deliveries: list[DeliveryOut]
    stock_remaining: dict[str, float] = Field(default_factory=dict)
    summary: PlanSummary


# ---- alerts & analysis --------------------------------------------------------------------------------------
class AlertIn(CamelModel):
    title: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=3, max_length=8000)
    source: str = Field(default="", max_length=200)
    url: str | None = Field(default=None, max_length=1000)
    published_at: datetime | None = None


class AlertOut(CamelModel):
    id: uuid.UUID
    title: str
    body: str
    source: str
    url: str | None
    published_at: datetime | None
    is_sample: bool
    created_at: datetime


class AnalyzeIn(CamelModel):
    alert_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)
    horizon_days: int = Field(default=7, ge=1, le=60)
    use_llm: bool = True


class IssueOut(CamelModel):
    id: str
    rank: int
    title: str
    kind: str
    likelihood: Literal["very_likely", "likely", "possible", "unlikely"]
    severity: Literal["low", "medium", "high"]
    probability: float
    affected_corridor_ids: list[str]
    affected_node_ids: list[str]
    duration_days: int
    rationale: str
    evidence_alert_ids: list[str]


class AnalysisOut(CamelModel):
    id: uuid.UUID
    engine: Literal["claude", "rules"]
    model: str | None
    engine_note: str | None
    created_at: datetime
    summary: str
    issues: list[IssueOut]
    likelihood_bands: dict[str, float]
    notice: str


# ---- simulation ---------------------------------------------------------------------------------------------
class HazardIn(CamelModel):
    id: str | None = Field(default=None, max_length=60)
    title: str = Field(max_length=200)
    kind: str
    probability: float | None = Field(default=None, ge=0, le=1)
    likelihood: Literal["very_likely", "likely", "possible", "unlikely"] | None = None
    severity: Literal["low", "medium", "high"] = "high"
    corridor_ids: list[str] = Field(default_factory=list, max_length=200)
    node_ids: list[str] = Field(default_factory=list, max_length=100)
    circle: tuple[float, float, float] | None = None
    duration_days: float | None = Field(default=None, gt=0, le=365)

    @field_validator("kind")
    @classmethod
    def _kind(cls, v: str) -> str:
        if v not in KINDS:
            raise ValueError(f"kind must be one of {list(KINDS)}")
        return v

    @model_validator(mode="after")
    def _prob(self) -> HazardIn:
        if self.probability is None and self.likelihood is None:
            raise ValueError("give either probability or likelihood")
        if not (self.corridor_ids or self.node_ids or self.circle):
            raise ValueError("a hazard needs corridorIds, nodeIds or a circle")
        return self


class SimulationIn(ClosureMixin):
    origin: str | None = None
    destination: str | None = None
    analysis_id: uuid.UUID | None = None
    issue_ids: list[str] | None = None
    hazards: list[HazardIn] = Field(default_factory=list, max_length=50)
    runs: int = Field(default=2000, ge=100, le=50000)
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)

    @model_validator(mode="after")
    def _pair(self) -> SimulationIn:
        if (self.origin is None) != (self.destination is None):
            raise ValueError("give both origin and destination, or neither (network-wide simulation)")
        return self


class SimulationOut(CamelModel):
    id: uuid.UUID
    created_at: datetime
    runs: int
    seed: int
    objective: Objective
    unique_states: int
    elapsed_ms: float
    p_network_split: float
    p_any_disruption: float
    expected_people_connected: float
    suppliers: list[dict[str, Any]]
    hazards: list[dict[str, Any]]
    corridor_closure: dict[str, float]
    targets: list[dict[str, Any]]
    plan_b: list[dict[str, Any]]
    playbook: list[dict[str, Any]]
    impact: dict[str, Any]
    model_notes: list[str]


# ---- impact -------------------------------------------------------------------------------------------------
class ImpactIn(ClosureMixin):
    closure_days: float = Field(default=14, gt=0, le=365)


class ImpactRowOut(CamelModel):
    destination: str
    name: str
    people: int
    tonnes: float
    status: str
    planned_supplier: str
    planned_cost_per_t: float | None
    planned_hours: float | None
    fallback_supplier: str
    fallback_kind: str
    fallback_modes: list[str]
    fallback_cost_per_t: float
    fallback_hours: float
    usd_saved_vs_airlift: float
    extra_usd_vs_plan: float
    people_days_protected_vs_waiting: float


class ImpactOut(CamelModel):
    closed_roads: list[str]
    rows: list[ImpactRowOut]
    totals: dict[str, float]
    basis: dict[str, Any]


class AssumptionOut(CamelModel):
    key: str
    value: float
    unit: str
    label: str
    kind: str
    source: str
    url: str | None


class AssumptionsOut(CamelModel):
    unit_rates: list[AssumptionOut]
    likelihood_bands: dict[str, float]
    severity_factor: dict[str, float]
    hazard_consequences: dict[str, dict[str, Any]]
    notes: list[str]
