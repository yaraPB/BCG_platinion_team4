from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.engine.risk import KINDS

Likelihood = Literal["very_likely", "likely", "possible", "unlikely"]
Severity = Literal["low", "medium", "high"]


class AlertInput(BaseModel):
    id: str
    title: str
    body: str
    source: str = ""
    published_at: str | None = None


class ExtractedIssue(BaseModel):
    title: str = Field(max_length=200)
    kind: str
    likelihood: Likelihood
    severity: Severity
    affected_corridor_ids: list[str]
    affected_node_ids: list[str]
    duration_days: int
    rationale: str
    evidence_alert_ids: list[str]


class Extraction(BaseModel):
    summary: str
    issues: list[ExtractedIssue]


def extraction_schema(corridor_ids: list[str], node_ids: list[str], alert_ids: list[str]) -> dict:
    """JSON schema for structured output. Enums pin the model to IDs that exist in this client's network."""

    def id_array(values: list[str]) -> dict:
        items = {"type": "string", "enum": values} if values else {"type": "string"}
        return {"type": "array", "items": items}

    issue = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short operational title"},
            "kind": {"type": "string", "enum": list(KINDS)},
            "likelihood": {"type": "string", "enum": ["very_likely", "likely", "possible", "unlikely"]},
            "severity": {"type": "string", "enum": ["low", "medium", "high"]},
            "affected_corridor_ids": id_array(corridor_ids),
            "affected_node_ids": id_array(node_ids),
            "duration_days": {"type": "integer", "description": "Expected duration of the disruption in days"},
            "rationale": {"type": "string", "description": "One or two sentences grounded in the alerts"},
            "evidence_alert_ids": id_array(alert_ids),
        },
        "required": ["title", "kind", "likelihood", "severity", "affected_corridor_ids", "affected_node_ids",
                     "duration_days", "rationale", "evidence_alert_ids"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "Two-sentence situation summary for the planner"},
            "issues": {"type": "array", "items": issue, "description": "Ranked, most important first"},
        },
        "required": ["summary", "issues"],
        "additionalProperties": False,
    }
