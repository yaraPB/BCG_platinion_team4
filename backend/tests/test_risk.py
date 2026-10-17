from __future__ import annotations

import numpy as np

from app.engine.risk import Hazard, hazard_correlation, sample_states
from app.engine.simulation import run_simulation

JONGLEI = ["juba-bor", "bor-pibor", "pibor-akobo", "bor-ayod"]


def test_occurrence_frequency_matches_probability(net):
    hz = [Hazard("a", "flood", "f", 0.3, corridor_ids=JONGLEI)]
    st = sample_states(net, hz, 40000, np.random.default_rng(1))
    assert abs(st.occurred[:, 0].mean() - 0.3) < 0.01


def test_flood_closures_are_correlated_accidents_are_not(net):
    rng = np.random.default_rng(2)
    a, b = net.corr_ix["bor-pibor"], net.corr_ix["pibor-akobo"]
    flood = sample_states(net, [Hazard("f", "flood", "f", 1.0, severity=0.6, corridor_ids=JONGLEI)], 40000, rng)
    acc = sample_states(net, [Hazard("x", "accident", "x", 1.0, corridor_ids=JONGLEI)], 40000, rng)

    def corr(st):
        return np.corrcoef(st.closed[:, a].astype(float), st.closed[:, b].astype(float))[0, 1]

    assert corr(flood) > 0.5  # floods close neighbouring tracks together
    assert abs(corr(acc)) < 0.05  # accidents are independent


def test_floods_spare_the_river_and_fuel_shortage_closes_nothing(net):
    rng = np.random.default_rng(3)
    river = net.corr_ix["river-juba-bor"]
    st = sample_states(net, [Hazard("f", "flood", "f", 1.0, corridor_ids=["river-juba-bor", "juba-bor"])], 5000, rng)
    assert not st.closed[:, river].any()
    fuel = sample_states(net, [Hazard("u", "fuel_shortage", "u", 1.0, node_ids=["wau"])], 5000, rng)
    assert not fuel.closed.any()
    assert fuel.cost_mult.max() > 1.5


def test_hazard_correlation_is_valid(net):
    hz = [Hazard("a", "flood", "", 0.5, corridor_ids=JONGLEI), Hazard("b", "landslide", "", 0.5, corridor_ids=["juba-bor"]),
          Hazard("c", "conflict", "", 0.5, node_ids=["nasir"]), Hazard("d", "checkpoint", "", 0.5, node_ids=["nasir"])]
    r = hazard_correlation(net, hz, [h.exposure(net) for h in hz])
    assert np.allclose(np.diag(r), 1) and np.allclose(r, r.T)
    assert np.linalg.eigvalsh(r).min() > 0
    assert r[0, 1] > 0 and r[2, 3] > 0 and r[0, 2] >= 0


def test_correlated_hazards_co_occur(net):
    hz = [Hazard("a", "conflict", "", 0.5, node_ids=["nasir"]), Hazard("b", "checkpoint", "", 0.5, node_ids=["nasir"])]
    st = sample_states(net, hz, 40000, np.random.default_rng(4))
    both = (st.occurred[:, 0] & st.occurred[:, 1]).mean()
    assert both > 0.25 + 0.05  # independent would be 0.25


def test_simulation_is_reproducible_and_reports_fallbacks(planner):
    hz = [Hazard("a", "conflict", "Sobat", 0.6, corridor_ids=["river-nasir-malakal", "ulang-nasir"])]
    r1 = run_simulation(planner, hz, runs=3000, seed=11, targets=[("malakal", "nasir")])
    r2 = run_simulation(planner, hz, runs=3000, seed=11, targets=[("malakal", "nasir")])
    t1, t2 = r1.targets[0], r2.targets[0]
    assert t1.status_share == t2.status_share
    assert t1.status_share["airlift"] > 0
    assert abs(sum(t1.status_share.values()) - 1) < 1e-9
    assert r1.unique_states < 3000  # memoisation works
    assert r1.plan_b and all(0 <= p["pOpen"] <= 1 for p in r1.plan_b)
    assert r1.playbook[0]["actions"][0]["status"] == "airlift"


def test_playbook_reports_only_changes_from_current_state(planner):
    from app.engine.planner import NetworkState

    hz = [Hazard("a", "flood", "Jonglei", 0.6, corridor_ids=["bor-pibor", "pibor-akobo"])]
    base = NetworkState(closed={"river-nasir-malakal", "ulang-nasir"})  # Nasir already cut before the issue
    res = run_simulation(planner, hz, runs=200, seed=1, base=base)
    changed = {a["destination"] for a in res.playbook[0]["actions"]}
    assert "nasir" not in changed  # already disrupted by the base state, not by this issue
    assert {"pibor", "akobo"} <= changed


def test_network_aggregates_and_triggers(planner):
    hz = [Hazard("a", "conflict", "Sobat", 0.7, corridor_ids=["river-nasir-malakal", "ulang-nasir"])]
    res = run_simulation(planner, hz, runs=1000, seed=3)
    assert 0 < res.p_any_disruption <= 1
    total_people = sum(t.people for t in res.targets)
    assert 0 < res.expected_people_connected < total_people
    nasir = next(t for t in res.targets if t.destination == "nasir")
    assert nasir.top_trigger == "ulang-nasir"
    assert {s["supplier"] for s in res.suppliers} == {"juba", "nimule", "wau", "malakal", "rumbek"}
