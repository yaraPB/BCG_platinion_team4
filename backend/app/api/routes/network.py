from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.api import schemas as s
from app.api.deps import tenant_planner
from app.api.serializers import itinerary_out, network_out, plan_out, require_node, validate_state
from app.engine.planner import Planner

router = APIRouter(prefix="/v1", tags=["network & routing"])
NO_STORE = {"Cache-Control": "no-store"}


@router.get("/network", response_model=s.NetworkOut, summary="Client network: suppliers, communities, corridors")
def get_network(planner: Planner = Depends(tenant_planner)) -> s.NetworkOut:
    return network_out(planner)


@router.get("/plan", response_model=s.PlanOut, summary="Baseline delivery plan (all corridors open)")
def get_plan(response: Response, planner: Planner = Depends(tenant_planner)) -> s.PlanOut:
    response.headers.update(NO_STORE)
    return plan_out(planner, planner.plan_network(), [], "cost")


@router.post("/plan", response_model=s.PlanOut, summary="Re-plan every delivery under closures")
def post_plan(body: s.PlanIn, response: Response, planner: Planner = Depends(tenant_planner)) -> s.PlanOut:
    response.headers.update(NO_STORE)
    state = validate_state(planner.net, body.closed_roads, body.down_nodes)
    return plan_out(planner, planner.plan_network(state, objective=body.objective), body.closed_roads, body.objective)


@router.post("/itineraries", response_model=s.ItineraryOut,
             summary="Best itinerary A→B under closures: reroute, switch supplier, or airlift")
def itinerary(body: s.ItineraryIn, response: Response, planner: Planner = Depends(tenant_planner)) -> s.ItineraryOut:
    response.headers.update(NO_STORE)
    net = planner.net
    require_node(net, body.origin, "hub")
    require_node(net, body.destination)
    state = validate_state(net, body.closed_roads, body.down_nodes)
    result = planner.plan(body.origin, body.destination, state, objective=body.objective, tonnes=body.tonnes)
    return itinerary_out(net, result, body.closed_roads)
