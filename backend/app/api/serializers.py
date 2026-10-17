from __future__ import annotations

from fastapi import HTTPException, status

from app.engine.assumptions import LIKELIHOOD_BANDS, SEVERITY_FACTOR
from app.engine.network import Network
from app.engine.planner import ItineraryResult, NetworkState, Option, Planner, Route, explain
from app.engine.risk import Hazard

from . import schemas as s


def validate_state(net: Network, closed: list[str], down: list[str]) -> NetworkState:
    unknown = [c for c in closed if c not in net.corr_ix]
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown corridor id(s): {', '.join(unknown[:10])}")
    unknown_n = [n for n in down if n not in net.node_ix]
    if unknown_n:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown node id(s): {', '.join(unknown_n[:10])}")
    return NetworkState(closed=set(closed), down_nodes=set(down))


def require_node(net: Network, node_id: str, kind: str | None = None) -> None:
    if node_id not in net.node_ix:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown node id: {node_id}")
    if kind and net.node(node_id).kind != kind:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{node_id} is a {net.node(node_id).kind}, expected a {kind}")


def network_out(planner: Planner) -> s.NetworkOut:
    net = planner.net
    p = net.params
    nodes = []
    for n in net.nodes:
        extra = {}
        if n.kind == "community":
            extra = dict(people=n.caseload, demand_tonnes=round(p.tonnes_for(n.caseload), 1), priority=n.priority,
                         ipc=n.priority, planned_hub=planner.primary_supplier.get(n.id))
        nodes.append(s.NodeOut(id=n.id, name=n.name, kind=n.kind, coordinates=(n.lon, n.lat),
                               description=n.description, air=n.air, food_security_context=n.context,
                               coordinate_source=n.coordinate_source, **extra))
    corridors = [
        s.CorridorOut(**{"from": c.a}, id=c.id, to=c.b, name=c.name, mode=c.mode, surface=c.surface, km=c.km,
                      hours=round(float(net.arc_hours[2 * k]), 2), hours_reverse=round(float(net.arc_hours[2 * k + 1]), 2),
                      cost_per_tonne=round(float(net.arc_cost[2 * k]), 2), geometry=list(c.geometry))
        for k, c in enumerate(net.corridors)
    ]
    scenarios = [s.ScenarioOut(id=x["id"], label=x["label"], description=x["description"],
                               closed_roads=x["closedRoads"]) for x in net.scenarios]
    return s.NetworkOut(region=net.region, notice=net.notice, attribution=net.attribution, version=net.version,
                        nodes=nodes, corridors=corridors, scenarios=scenarios)


def route_out(net: Network, r: Route | None) -> s.RouteOut | None:
    if r is None:
        return None
    legs, coords = [], []
    for arc in r.arcs:
        c = net.corridors[int(net.arc_corr[arc])]
        legs.append(s.LegOut(**{"from": net.nodes[int(net.arc_tail[arc])].id}, corridor_id=c.id, name=c.name,
                             mode=c.mode, to=net.nodes[int(net.arc_head[arc])].id, km=c.km,
                             hours=round(float(net.arc_hours[arc]), 2), cost_per_tonne=round(float(net.arc_cost[arc]), 2)))
        pts = net.oriented_geometry(arc)
        coords.extend(pts if not coords else pts[1:])
    return s.RouteOut(supplier=r.supplier, destination=r.destination, nodes=r.nodes, corridors=r.corridors,
                      km=round(r.km, 1), hours=round(r.hours, 2), cost_per_tonne=round(r.cost_per_t, 2), modes=r.modes,
                      legs=legs, coordinates=[(x, y) for x, y in coords])


def option_out(net: Network, o: Option, tonnes: float) -> s.OptionOut:
    return s.OptionOut(kind=o.kind, supplier=o.supplier, cost_per_tonne=round(o.cost_per_t, 2), hours=round(o.hours, 2),
                       total_cost_usd=round(o.cost_per_t * tonnes, 0), route=route_out(net, o.route),
                       air_km=round(o.air_km, 1) if o.air_km is not None else None)


def itinerary_out(net: Network, r: ItineraryResult, closed: list[str]) -> s.ItineraryOut:
    return s.ItineraryOut(
        origin=r.origin, destination=r.destination, objective=r.objective, tonnes=round(r.tonnes, 2), status=r.status,
        split=r.split, explanation=explain(net, r), closed_roads=closed, baseline=route_out(net, r.baseline),
        best=option_out(net, r.best, r.tonnes), options=[option_out(net, o, r.tonnes) for o in r.options],
        destination_component=r.destination_component, reachable_suppliers=r.reachable_suppliers,
    )


def plan_out(planner: Planner, results: list[ItineraryResult], closed: list[str], objective: str) -> s.PlanOut:
    net = planner.net
    deliveries = []
    for r in results:
        node = net.node(r.destination)
        b = r.best
        land = b.kind != "airlift"
        rt = route_out(net, b.route) if land else None
        status = "unreachable" if not land else r.status
        deliveries.append(s.DeliveryOut(
            community_id=node.id, name=node.name, people=node.caseload, requested_tonnes=round(r.tonnes, 1),
            assigned_tonnes=round(r.tonnes, 1) if land else 0.0, ipc=node.priority, priority=node.priority,
            planned_supplier_id=r.origin, supplier_id=b.supplier if land else None, status=status, fallback=b.kind,
            hours=round(b.hours, 2) if land else None, cost_per_tonne=round(b.cost_per_t, 2),
            cost_usd=round(b.cost_per_t * r.tonnes, 0),
            planned_hours=round(r.baseline.hours, 2) if r.baseline else None,
            planned_cost_per_tonne=round(r.baseline.cost_per_t, 2) if r.baseline else None,
            modes=b.route.modes if b.route else ["air"], path=b.route.nodes if b.route else [],
            road_ids=b.route.corridors if b.route else [], coordinates=rt.coordinates if rt else [],
            airlift=None if land else option_out(net, b, r.tonnes), reason=explain(net, r),
        ))
    reach = [d for d in deliveries if d.status != "unreachable"]
    summary = s.PlanSummary(
        reachable_people=sum(d.people for d in reach), total_people=sum(d.people for d in deliveries),
        assigned_tonnes=round(sum(d.assigned_tonnes for d in deliveries), 1),
        total_tonnes=round(sum(d.requested_tonnes for d in deliveries), 1),
        on_plan=sum(d.status == "on-plan" for d in deliveries), rerouted=sum(d.status == "rerouted" for d in deliveries),
        supplier_changed=sum(d.status == "supplier-changed" for d in deliveries),
        unreachable=sum(d.status == "unreachable" for d in deliveries),
        total_cost_usd=round(sum(d.cost_usd for d in deliveries), 0),
        planned_cost_usd=round(sum((d.planned_cost_per_tonne or 0) * d.requested_tonnes for d in deliveries), 0),
    )
    return s.PlanOut(closed_roads=closed, objective=objective, deliveries=deliveries, summary=summary)


def issues_to_hazards(net: Network, issues: list[dict]) -> list[Hazard]:
    out = []
    for i in issues:
        out.append(Hazard(
            id=i["id"], kind=i["kind"], title=i["title"], probability=i["probability"],
            severity=SEVERITY_FACTOR.get(i.get("severity", "high"), 1.0),
            corridor_ids=[c for c in i.get("affectedCorridorIds", []) if c in net.corr_ix],
            node_ids=[n for n in i.get("affectedNodeIds", []) if n in net.node_ix],
            duration_days=i.get("durationDays"),
        ))
    return out


def hazard_in_to_hazard(net: Network, h: s.HazardIn, idx: int) -> Hazard:
    unknown = [c for c in h.corridor_ids if c not in net.corr_ix] + [n for n in h.node_ids if n not in net.node_ix]
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown id(s) in hazard '{h.title}': {', '.join(unknown[:10])}")
    prob = h.probability if h.probability is not None else LIKELIHOOD_BANDS[h.likelihood]
    return Hazard(id=h.id or f"manual-{idx + 1}", kind=h.kind, title=h.title, probability=prob,
                  severity=SEVERITY_FACTOR[h.severity], corridor_ids=h.corridor_ids, node_ids=h.node_ids,
                  circle=h.circle, duration_days=h.duration_days)
