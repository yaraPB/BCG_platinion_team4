from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

# Isolate tests: temp SQLite DB and never call a real LLM.
_TMP = tempfile.mkdtemp(prefix="viamensa-test-")
os.environ["VIAMENSA_DATABASE_URL"] = os.environ.get("VIAMENSA_TEST_DATABASE_URL", f"sqlite:///{_TMP}/test.db")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("VIAMENSA_ANTHROPIC_API_KEY", None)
os.environ["VIAMENSA_RATE_LIMIT_LOGIN_PER_MIN"] = "1000"

from app.engine.assumptions import default_params  # noqa: E402
from app.engine.network import Network  # noqa: E402
from app.engine.planner import Planner  # noqa: E402

SEED = Path(__file__).resolve().parents[1] / "app" / "seed" / "networks" / "south_sudan.json"


@pytest.fixture(scope="session")
def net() -> Network:
    return Network(json.loads(SEED.read_text()), default_params())


@pytest.fixture(scope="session")
def planner(net: Network) -> Planner:
    return Planner(net)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture(scope="session")
def auth(client) -> dict:
    r = client.post("/v1/auth/token", json={"email": "demo@viamensa.app", "password": "viamensa-demo"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}
