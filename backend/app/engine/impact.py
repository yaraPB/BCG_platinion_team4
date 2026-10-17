"""Savings tables: FoodBridge's fallback vs operating without a pre-computed fallback.

Comparisons (both stated in the API response so nobody has to guess what "savings" means):
- vs emergency airlift: when the planned route is cut and no land alternative was prepared, food goes by air
  (WFP South Sudan: ~$2,700/t). Saving = tonnes x (air cost - FoodBridge cost).
- vs waiting: the delivery waits for the road to reopen. People-days without the delivery avoided =
  people x max(0, closure days - FoodBridge delivery days).
- extra cost vs plan: what the fallback costs over the original plan (it is never free).

All money uses the unit rates in assumptions.py; tonnes = caseload x ration x cycle days.
"""

from __future__ import annotations

from dataclasses import dataclass

from .network import Network
from .planner import ItineraryResult


@dataclass
class ImpactRow:
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


def impact_table(net: Network, results: list[ItineraryResult], *, closure_days: float) -> dict:
    air = net.params.air_cost_per_t
    rows: list[ImpactRow] = []
    for r in results:
        if r.status == "on-plan":
            continue
        node = net.node(r.destination)
        b = r.best
        tonnes = r.tonnes
        planned_cost = r.baseline.cost_per_t if r.baseline else None
        planned_hours = r.baseline.hours if r.baseline else None
        land = b.kind != "airlift"
        rows.append(ImpactRow(
            destination=r.destination, name=node.name, people=node.caseload, tonnes=round(tonnes, 1), status=r.status,
            planned_supplier=r.origin, planned_cost_per_t=planned_cost, planned_hours=planned_hours,
            fallback_supplier=b.supplier, fallback_kind=b.kind,
            fallback_modes=b.route.modes if b.route else ["air"],
            fallback_cost_per_t=b.cost_per_t, fallback_hours=b.hours,
            usd_saved_vs_airlift=(air - b.cost_per_t) * tonnes if land else 0.0,
            extra_usd_vs_plan=(b.cost_per_t - planned_cost) * tonnes if planned_cost is not None else 0.0,
            people_days_protected_vs_waiting=(node.caseload * max(0.0, closure_days - b.hours / 24.0)) if land else 0.0,
        ))
    totals = {
        "deliveriesDisrupted": len(rows),
        "deliveriesWithLandFallback": sum(1 for x in rows if x.fallback_kind != "airlift"),
        "tonnesDisrupted": round(sum(x.tonnes for x in rows), 1),
        "usdSavedVsAirlift": round(sum(x.usd_saved_vs_airlift for x in rows), 0),
        "extraUsdVsPlan": round(sum(x.extra_usd_vs_plan for x in rows), 0),
        "peopleDaysProtectedVsWaiting": round(sum(x.people_days_protected_vs_waiting for x in rows), 0),
    }
    return {
        "rows": rows,
        "totals": totals,
        "basis": {
            "airCostPerT": air,
            "closureDaysAssumed": closure_days,
            "rationKgPerPersonDay": net.params.ration_kg_per_person_day,
            "cycleDays": net.params.cycle_days,
            "statement": ("Savings compare FoodBridge's fallback with operating without a pre-computed fallback: an "
                          "emergency airlift at the WFP South Sudan air rate, or waiting for the road to reopen. "
                          "Unit rates and their sources: /v1/assumptions."),
        },
    }
