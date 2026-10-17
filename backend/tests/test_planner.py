from __future__ import annotations

from app.engine.planner import NetworkState


def test_baseline_is_on_plan(planner):
    r = planner.plan("juba", "bor")
    assert r.status == "on-plan" and r.best.kind == "planned"
    assert r.best.route.modes == ["road"]


def test_road_cut_reroutes_by_river(planner):
    r = planner.plan("juba", "bor", NetworkState(closed={"juba-bor"}))
    assert r.status == "rerouted"
    assert r.best.supplier == "juba"
    assert "river" in r.best.route.modes
    assert "juba-bor" not in r.best.route.corridors
    assert not r.split


def test_cheapest_option_wins_between_detour_and_switch(planner):
    # Closing Rumbek–Leer makes Wau (via Mayom) cheaper than any Rumbek detour.
    r = planner.plan("rumbek", "bentiu", NetworkState(closed={"rumbek-leer"}))
    assert r.status == "supplier-changed"
    assert r.best.supplier == "wau"
    costs = [o.cost_per_t for o in r.options]
    assert costs == sorted(costs)


def test_split_network_falls_back_to_airlift_when_isolated(planner):
    r = planner.plan("malakal", "nasir", NetworkState(closed={"river-nasir-malakal", "ulang-nasir"}))
    assert r.split
    assert r.status == "airlift"
    assert r.best.cost_per_t == planner.net.params.air_cost_per_t
    assert "nasir" in r.destination_component and "malakal" not in r.destination_component


def test_split_with_supplier_on_destination_side(planner):
    # Cut Rumbek off from the west (Tonj) and from Leer; Wau stays connected on Bentiu's side of the split.
    r = planner.plan("rumbek", "bentiu", NetworkState(closed={"rumbek-leer", "leer-bentiu", "rumbek-tonj"}))
    assert r.split
    assert r.status == "supplier-changed"
    assert r.best.supplier in r.reachable_suppliers


def test_down_supplier_is_never_used(planner):
    r = planner.plan("juba", "torit", NetworkState(down_nodes={"juba"}))
    assert r.best.supplier != "juba"


def test_time_objective_prefers_faster_route(planner):
    cost = planner.plan("juba", "bor", NetworkState(closed={"juba-bor"}), objective="cost")
    fast = planner.plan("juba", "bor", NetworkState(closed={"juba-bor"}), objective="time")
    assert fast.best.hours <= cost.best.hours


def test_fast_path_agrees_with_full_planner(planner):
    import numpy as np

    from app.engine.planner import objective_weights

    net = planner.net
    for closed in (set(), {"juba-bor"}, {"rumbek-leer"}, {"river-nasir-malakal", "ulang-nasir"}):
        blocked, hours, cost, closed_c = NetworkState(closed=closed).arrays(net)
        wl = objective_weights("cost", hours, cost).tolist()
        for c in net.communities:
            o = net.node_ix[planner.primary_supplier[net.nodes[c].id]]
            full = planner.plan_arrays(o, c, blocked, hours, cost, closed_c, set())
            status, kind, sup, _, c_t, h = planner.best_fast(o, c, blocked.tolist(), wl, hours, cost, set(), "cost")
            assert np.isclose(full.best.cost_per_t, c_t) and status == full.status and sup == full.best.supplier


def test_network_plan_orders_by_priority(planner):
    results = planner.plan_network()
    prios = [planner.net.node(r.destination).priority for r in results]
    assert prios == sorted(prios, reverse=True)
    assert all(r.status == "on-plan" for r in results)
