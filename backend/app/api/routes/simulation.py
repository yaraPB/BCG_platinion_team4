from __future__ import annotations

import secrets
import uuid
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas as s
from app.api.deps import Principal, current_principal, tenant_planner
from app.api.serializers import hazard_in_to_hazard, issues_to_hazards, require_node, validate_state
from app.core.config import get_settings
from app.db.models import Analysis, SimulationRun
from app.db.session import get_db
from app.engine.planner import Planner
from app.engine.simulation import run_simulation

router = APIRouter(prefix="/v1", tags=["simulation"])

MODEL_NOTES = [
    "Hazards occur jointly via a Gaussian copula (hazards that tend to co-occur are correlated).",
    "Within a hazard's footprint, corridors fail together through a shared shock whose strength depends on the "
    "hazard kind (floods: strongly correlated; accidents: independent).",
    "Consequences differ by hazard kind and road surface: closure, delay, or cost surcharge.",
    "Each sampled future is re-planned: cheapest of reroute (bidirectional A*), supplier switch (reverse Dijkstra), "
    "or airlift. Identical futures are solved once and cached.",
    "Savings compare with no pre-computed fallback: emergency airlift at the WFP rate, or waiting for reopening.",
]


def _camel(d: dict) -> dict:
    out = {}
    for k, v in d.items():
        parts = k.split("_")
        out[parts[0] + "".join(p.title() for p in parts[1:])] = v
    return out


@router.post("/simulations", response_model=s.SimulationOut,
             summary="Monte Carlo of correlated disruptions → fallback plans, Plan B, playbook, savings")
def simulate(body: s.SimulationIn, p: Principal = Depends(current_principal), planner: Planner = Depends(tenant_planner),
             db: Session = Depends(get_db)) -> s.SimulationOut:
    net = planner.net
    settings = get_settings()
    base = validate_state(net, body.closed_roads, body.down_nodes)
    hazards = []
    if body.analysis_id:
        a = db.get(Analysis, body.analysis_id)
        if a is None or a.tenant_id != p.tenant.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found")
        issues = [i for i in a.result["issues"] if body.issue_ids is None or i["id"] in body.issue_ids]
        hazards += issues_to_hazards(net, issues)
    hazards += [hazard_in_to_hazard(net, h, i) for i, h in enumerate(body.hazards)]
    if not hazards:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Give an analysisId or at least one hazard to simulate")
    targets = None
    if body.origin:
        require_node(net, body.origin, "hub")
        require_node(net, body.destination)
        targets = [(body.origin, body.destination)]
    runs = min(body.runs, settings.max_simulation_runs)
    seed = body.seed if body.seed is not None else secrets.randbelow(2**31 - 1)
    res = run_simulation(planner, hazards, runs=runs, seed=seed, objective=body.objective, base=base, targets=targets)

    target_dicts = [_camel(asdict(t)) for t in res.targets]
    impact = {
        "expectedUsdSavedVsAirlift": round(sum(t.expected_savings["usdVsAirlift"] for t in res.targets), 0),
        "expectedPeopleDaysProtectedVsWaiting": round(sum(t.expected_savings["peopleDaysVsWaiting"] for t in res.targets), 0),
        "perTarget": [{"destination": t.destination, "pPlannedRouteCut": t.p_baseline_blocked, **t.expected_savings}
                      for t in res.targets],
        "basis": "Expected value over simulated futures; unit rates in /v1/assumptions.",
    }
    hazards_out = [{"id": h.id, "title": h.title, "kind": h.kind, "probability": h.probability,
                    "severity": h.severity, "corridorIds": h.corridor_ids, "nodeIds": h.node_ids,
                    "simulatedOccurrence": res.hazard_occurrence.get(h.id, 0.0)} for h in hazards]
    run = SimulationRun(tenant_id=p.tenant.id, request=body.model_dump(mode="json", by_alias=True), runs=runs,
                        elapsed_ms=res.elapsed_ms, created_by=p.user.id, result={})
    db.add(run)
    db.flush()
    out = s.SimulationOut(
        id=run.id, created_at=run.created_at, runs=runs, seed=seed, objective=body.objective,
        unique_states=res.unique_states, elapsed_ms=round(res.elapsed_ms, 1), p_network_split=res.p_network_split,
        p_any_disruption=res.p_any_disruption, expected_people_connected=round(res.expected_people_connected, 0),
        suppliers=res.suppliers, hazards=hazards_out, corridor_closure=res.corridor_closure, targets=target_dicts,
        plan_b=res.plan_b, playbook=res.playbook, impact=impact,
        model_notes=MODEL_NOTES + [f"{res.unique_states} distinct network states solved for {runs} runs."],
    )
    run.result = out.model_dump(mode="json", by_alias=True)
    db.commit()
    return out


@router.get("/simulations", summary="Recent simulation runs")
def list_runs(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(SimulationRun).where(SimulationRun.tenant_id == p.tenant.id)
                      .order_by(SimulationRun.created_at.desc()).limit(20))
    return [{"id": str(r.id), "createdAt": r.created_at.isoformat(), "runs": r.runs, "elapsedMs": r.elapsed_ms,
             "request": r.request} for r in rows]


@router.get("/simulations/{run_id}", response_model=s.SimulationOut, summary="A simulation run by id")
def get_run(run_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    r = db.get(SimulationRun, run_id)
    if r is None or r.tenant_id != p.tenant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Simulation not found")
    return r.result
