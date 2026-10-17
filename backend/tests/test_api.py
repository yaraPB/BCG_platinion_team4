from __future__ import annotations


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").status_code == 200


def test_auth_required_and_bad_login(client):
    assert client.get("/v1/network").status_code == 401
    assert client.get("/v1/network", headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.post("/v1/auth/token", json={"email": "demo@foodbridge.app", "password": "wrong"})
    assert r.status_code == 401


def test_me_and_network(client, auth):
    me = client.get("/v1/me", headers=auth).json()
    assert me["email"] == "demo@foodbridge.app"
    net = client.get("/v1/network", headers=auth).json()
    assert {n["kind"] for n in net["nodes"]} == {"hub", "community", "junction", "port"}
    road = next(c for c in net["corridors"] if c["id"] == "juba-bor")
    assert road["from"] == "juba" and road["km"] > 150 and len(road["geometry"]) > 2
    assert any(s["id"] == "jonglei-floods" for s in net["scenarios"])


def test_plan_frontend_contract(client, auth):
    base = client.get("/v1/plan", headers=auth).json()
    assert base["summary"]["onPlan"] == len(base["deliveries"])
    d = base["deliveries"][0]
    for key in ("communityId", "name", "people", "requestedTonnes", "assignedTonnes", "ipc", "plannedSupplierId",
                "supplierId", "status", "hours", "path", "roadIds", "coordinates", "reason"):
        assert key in d
    r = client.post("/v1/plan", headers=auth, json={"closedRoads": ["river-nasir-malakal", "ulang-nasir"]}).json()
    nasir = next(x for x in r["deliveries"] if x["communityId"] == "nasir")
    assert nasir["status"] == "unreachable" and nasir["fallback"] == "airlift" and nasir["airlift"]["costPerTonne"] == 2700


def test_plan_rejects_unknown_corridor(client, auth):
    r = client.post("/v1/plan", headers=auth, json={"closedRoads": ["no-such-road"]})
    assert r.status_code == 400


def test_itinerary(client, auth):
    r = client.post("/v1/itineraries", headers=auth,
                    json={"origin": "juba", "destination": "bor", "closedRoads": ["juba-bor"]}).json()
    assert r["status"] == "rerouted"
    assert r["best"]["route"]["legs"][0]["corridorId"].startswith("transfer")
    assert r["options"][0]["costPerTonne"] <= r["options"][-1]["costPerTonne"]
    bad = client.post("/v1/itineraries", headers=auth, json={"origin": "bor", "destination": "juba"})
    assert bad.status_code == 400  # origin must be a supplier


def test_alerts_analysis_simulation_flow(client, auth):
    alerts = client.get("/v1/alerts", headers=auth).json()
    assert len(alerts) >= 5 and all(a["isSample"] for a in alerts)
    created = client.post("/v1/alerts", headers=auth, json={
        "title": "Bridge damaged on Juba–Yei road", "body": "A bridge on the Juba–Yei road was damaged; road closed.",
        "source": "Test"}).json()
    an = client.post("/v1/alerts/analyze", headers=auth, json={}).json()
    assert an["engine"] == "rules"  # no key in tests
    assert an["issues"] and all(0 < i["probability"] <= 1 for i in an["issues"])
    sim = client.post("/v1/simulations", headers=auth,
                      json={"analysisId": an["id"], "runs": 500, "seed": 5, "origin": "juba", "destination": "bor"}).json()
    assert sim["runs"] == 500 and sim["targets"][0]["destination"] == "bor"
    assert sim["planB"] and sim["playbook"] and "expectedUsdSavedVsAirlift" in sim["impact"]
    again = client.get(f"/v1/simulations/{sim['id']}", headers=auth).json()
    assert again["seed"] == 5
    assert client.delete(f"/v1/alerts/{created['id']}", headers=auth).status_code == 204


def test_simulation_with_manual_hazard_network_wide(client, auth):
    sim = client.post("/v1/simulations", headers=auth, json={
        "runs": 300, "seed": 1,
        "hazards": [{"title": "Jonglei floods", "kind": "flood", "likelihood": "likely",
                     "corridorIds": ["juba-bor", "bor-pibor", "pibor-akobo"]}]}).json()
    assert len(sim["targets"]) == 12
    assert client.post("/v1/simulations", headers=auth, json={"runs": 300}).status_code == 400
    assert client.post("/v1/simulations", headers=auth, json={"runs": 300, "origin": "juba"}).status_code == 422


def test_impact_and_assumptions(client, auth):
    imp = client.post("/v1/impact", headers=auth, json={"closedRoads": ["juba-bor"], "closureDays": 14}).json()
    rows = {r["destination"]: r for r in imp["rows"]}
    assert {"bor", "pibor", "akobo"} <= set(rows)  # Pibor and Akobo are supplied through Bor
    assert rows["bor"]["fallbackModes"] == ["river"] and rows["bor"]["usdSavedVsAirlift"] > 0
    assert imp["basis"]["airCostPerT"] == 2700
    a = client.get("/v1/assumptions", headers=auth).json()
    kinds = {x["kind"] for x in a["unitRates"]}
    assert {"sourced", "estimate"} <= kinds
    assert all(x["source"] for x in a["unitRates"])


def test_tenant_isolation(client, auth):
    from app.core.security import hash_password
    from app.db.models import Alert, Tenant, User
    from app.db.session import get_sessionmaker

    with get_sessionmaker()() as db:
        other = Tenant(slug="other", name="Other client")
        db.add(other)
        db.flush()
        db.add(User(tenant_id=other.id, email="other@example.com", password_hash=hash_password("pw-other-1")))
        secret = Alert(tenant_id=other.id, title="Other tenant secret", body="private", source="x")
        db.add(secret)
        db.commit()
        secret_id = secret.id
    titles = [a["title"] for a in client.get("/v1/alerts", headers=auth).json()]
    assert "Other tenant secret" not in titles
    assert client.delete(f"/v1/alerts/{secret_id}", headers=auth).status_code == 404
    tok = client.post("/v1/auth/token", json={"email": "other@example.com", "password": "pw-other-1"}).json()["accessToken"]
    r = client.get("/v1/network", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 404  # no network configured for that client


def test_demo_password_follows_configuration(client):
    """Changing VIAMENSA_DEMO_USER_PASSWORD rotates the existing demo user's password on the next startup."""
    from app.core.config import get_settings
    from app.db.bootstrap import seed_demo
    from app.db.session import get_sessionmaker

    settings = get_settings()
    original = settings.demo_user_password
    try:
        settings.demo_user_password = type(original)("rotated-pass-1")
        with get_sessionmaker()() as db:
            seed_demo(db)
        login = {"email": "demo@foodbridge.app"}
        assert client.post("/v1/auth/token", json={**login, "password": "rotated-pass-1"}).status_code == 200
        assert client.post("/v1/auth/token", json={**login, "password": "winners"}).status_code == 401
    finally:
        settings.demo_user_password = original
        with get_sessionmaker()() as db:
            seed_demo(db)
    assert client.post("/v1/auth/token", json={"email": "demo@foodbridge.app", "password": "winners"}).status_code == 200


def test_breaking_news_predicts_roads_and_suggests_new_supplier(client, auth):
    templates = client.get("/v1/alerts/templates", headers=auth).json()
    assert {t["id"] for t in templates} >= {"jonglei-crisis", "juba-bor-accident", "unity-checkpoints", "sobat-clashes"}
    brief = client.post("/v1/alerts/simulate", headers=auth, json={"templateId": "jonglei-crisis", "useLlm": False}).json()
    assert brief["alert"]["source"].startswith("Simulated")
    endangered = {e["corridorId"]: e["pClosed"] for e in brief["endangeredRoads"]}
    assert {"juba-bor", "river-juba-bor", "bor-pibor"} <= set(endangered)
    assert all(0 < p <= 1 for p in endangered.values())
    bor = next(s for s in brief["suggestions"] if s["destination"] == "bor")
    assert bor["action"] == "new_supplier" and bor["suggestedSupplier"] == "malakal" and bor["newSupplier"]
    assert "river-bor-malakal" in bor["untraveledCorridors"]
    # Applying the scenario the suggestions were computed from reproduces them.
    plan = client.post("/v1/plan", headers=auth, json={"closedRoads": brief["ifItHappens"]["closes"]}).json()
    assert next(d for d in plan["deliveries"] if d["communityId"] == "bor")["supplierId"] == "malakal"
    assert client.post("/v1/demo/reset", headers=auth).json()["removedAlerts"] >= 1
    assert not [a for a in client.get("/v1/alerts", headers=auth).json() if a["source"].startswith("Simulated")]


def test_breaking_news_unknown_template(client, auth):
    assert client.post("/v1/alerts/simulate", headers=auth, json={"templateId": "nope", "useLlm": False}).status_code == 404
