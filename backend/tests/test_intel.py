from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from app.intel.claude import ClaudeAnalyzer, call_with_fallback
from app.intel.rules import analyze_rules
from app.intel.schemas import AlertInput


def alerts():
    return [
        AlertInput(id="a1", title="Clashes reported near Nasir; river convoys paused",
                   body="Fighting around Nasir. River convoys between Malakal and Nasir paused; Ulang–Nasir road suspended."),
        AlertInput(id="a2", title="Fuel shortage in Wau", body="Stations in Wau report shortages."),
        AlertInput(id="a3", title="Football results", body="Nothing to do with logistics."),
    ]


def test_rules_map_alerts_to_network(net):
    ex = analyze_rules(net, alerts())
    kinds = {i.kind for i in ex.issues}
    assert {"conflict", "fuel_shortage"} <= kinds
    nasir = next(i for i in ex.issues if i.kind == "conflict")
    assert "river-nasir-malakal" in nasir.affected_corridor_ids and "ulang-nasir" in nasir.affected_corridor_ids
    assert nasir.likelihood == "very_likely"
    assert all(i.evidence_alert_ids for i in ex.issues)


class FakeMessages:
    def __init__(self, payload, stop_reason="end_turn"):
        self.payload, self.stop_reason, self.kwargs = payload, stop_reason, None

    async def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(stop_reason=self.stop_reason,
                               content=[SimpleNamespace(type="text", text=json.dumps(self.payload))])


def make_analyzer(payload, stop_reason="end_turn"):
    a = ClaudeAnalyzer.__new__(ClaudeAnalyzer)
    a.model = "claude-opus-5-5"
    fake = FakeMessages(payload, stop_reason)
    a.client = SimpleNamespace(beta=SimpleNamespace(messages=fake))
    return a, fake


def test_claude_analyzer_uses_structured_output_and_filters_ids(net):
    payload = {"summary": "s", "issues": [{
        "title": "Nasir clashes", "kind": "conflict", "likelihood": "very_likely", "severity": "high",
        "affected_corridor_ids": ["river-nasir-malakal", "made-up-road"], "affected_node_ids": ["nasir"],
        "duration_days": 500, "rationale": "r", "evidence_alert_ids": ["a1", "zzz"]}]}
    analyzer, fake = make_analyzer(payload)
    ex, note = asyncio.run(call_with_fallback(analyzer, net, alerts(), {}, 7))
    assert note is None
    issue = ex.issues[0]
    assert issue.affected_corridor_ids == ["river-nasir-malakal"]
    assert issue.evidence_alert_ids == ["a1"] and issue.duration_days == 120
    fmt = fake.kwargs["output_config"]["format"]
    assert fmt["type"] == "json_schema"
    enum = fmt["schema"]["properties"]["issues"]["items"]["properties"]["affected_corridor_ids"]["items"]["enum"]
    assert "juba-bor" in enum and not any(c.startswith("transfer-") for c in enum)
    assert fake.kwargs["model"] == "claude-opus-5-5" and fake.kwargs["fallbacks"] == "default"


def test_refusal_falls_back(net):
    analyzer, _ = make_analyzer({"summary": "", "issues": []}, stop_reason="refusal")
    ex, note = asyncio.run(call_with_fallback(analyzer, net, alerts(), {}, 7))
    assert ex is None and "rule-based" in note


def test_no_key_falls_back(net):
    ex, note = asyncio.run(call_with_fallback(None, net, alerts(), {}, 7))
    assert ex is None and "No LLM API key" in note
