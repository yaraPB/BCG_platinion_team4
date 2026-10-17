from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends

from app.api import schemas as s
from app.api.deps import current_principal, tenant_planner
from app.api.serializers import validate_state
from app.engine.assumptions import ASSUMPTIONS, LIKELIHOOD_BANDS, SEVERITY_FACTOR
from app.engine.impact import impact_table
from app.engine.planner import Planner
from app.engine.risk import CONSEQUENCES

router = APIRouter(prefix="/v1", tags=["impact & assumptions"])


@router.post("/impact", response_model=s.ImpactOut,
             summary="Savings table for a closure scenario: fallback vs airlift / waiting")
def impact(body: s.ImpactIn, planner: Planner = Depends(tenant_planner)) -> s.ImpactOut:
    state = validate_state(planner.net, body.closed_roads, body.down_nodes)
    results = planner.plan_network(state, objective=body.objective)
    table = impact_table(planner.net, results, closure_days=body.closure_days)
    return s.ImpactOut(closed_roads=body.closed_roads, rows=[asdict(r) for r in table["rows"]], totals=table["totals"],
                       basis=table["basis"])


@router.get("/assumptions", response_model=s.AssumptionsOut, dependencies=[Depends(current_principal)],
            summary="Every unit rate and model parameter, with its source")
def assumptions() -> s.AssumptionsOut:
    return s.AssumptionsOut(
        unit_rates=[a.to_dict() for a in ASSUMPTIONS],
        likelihood_bands=LIKELIHOOD_BANDS,
        severity_factor=SEVERITY_FACTOR,
        hazard_consequences={k: asdict(v) for k, v in CONSEQUENCES.items()},
        notes=[
            "kind=sourced: published figure (see url). derived: computed from sourced figures. estimate: modelling "
            "assumption, tunable. client: client input (demo values in the seed).",
            "Hazard consequence parameters (closure probability by surface, delay/cost factors, correlation) are "
            "modelling estimates; calibrate with the client's incident history.",
        ],
    )
