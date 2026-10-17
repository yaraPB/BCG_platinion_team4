"""Deterministic fallback analyzer: used when no LLM key is configured or the LLM call fails.

Gazetteer matching (node names in text) + keyword classification. Transparent and predictable; less nuanced than
the LLM, which is why the response always says which engine produced it.
"""

from __future__ import annotations

import re

from app.engine.network import Network

from .schemas import AlertInput, ExtractedIssue, Extraction

KIND_WORDS = {
    "flood": ["flood", "rain", "impassable", "washed", "standing water", "waterlog", "inundat"],
    "conflict": ["clash", "fighting", "attack", "armed", "insecurity", "violence", "shoot"],
    "accident": ["overturn", "accident", "crash", "breakdown", "collision"],
    "landslide": ["landslide", "mudslide"],
    "storm": ["storm", "wind"],
    "fuel_shortage": ["fuel"],
    "strike": ["strike", "protest", "demonstration"],
    "checkpoint": ["checkpoint", "levy", "roadblock"],
}
LIKELIHOOD_WORDS = [
    ("very_likely", ["reported", "ongoing", "blocked", "closed", "paused", "suspended", "overturned", "already"]),
    ("likely", ["expected", "forecast", "will", "indicate"]),
    ("possible", ["may", "might", "possible", "risk", "warn", "could"]),
]
SEVERITY_WORDS = [("high", ["impassable", "suspended", "paused", "fighting", "clashes", "closed"]),
                  ("low", ["slowly", "one lane", "minor", "delays"])]
RANK = {"very_likely": 4, "likely": 3, "possible": 2, "unlikely": 1}
SEV = {"high": 3, "medium": 2, "low": 1}


def _find(words: list[str], text: str) -> bool:
    return any(w in text for w in words)


def analyze_rules(net: Network, alerts: list[AlertInput]) -> Extraction:
    names = {n.id: n.name.lower() for n in net.nodes if n.kind != "port"}
    issues: list[ExtractedIssue] = []
    for a in alerts:
        text = f"{a.title}. {a.body}".lower()
        kind = next((k for k, ws in KIND_WORDS.items() if _find(ws, text)), "other")
        mentioned = [nid for nid, nm in names.items() if re.search(rf"\b{re.escape(nm)}\b", text)]
        corridors = []
        for c in net.corridors:
            if c.mode == "transfer":
                continue
            ends = {c.a.removesuffix("-port"), c.b.removesuffix("-port")}
            if ends <= set(mentioned):
                if c.mode == "river" and not _find(["river", "barge", "convoy", "boat", "sobat", "nile"], text):
                    continue
                corridors.append(c.id)
        nodes = [] if corridors else mentioned
        likelihood = next((lv for lv, ws in LIKELIHOOD_WORDS if _find(ws, text)), "possible")
        severity = next((sv for sv, ws in SEVERITY_WORDS if _find(ws, text)), "medium")
        if not corridors and not nodes:
            continue
        duration = {"flood": 21, "conflict": 14, "accident": 1, "fuel_shortage": 14, "checkpoint": 7}.get(kind, 7)
        issues.append(ExtractedIssue(
            title=a.title[:200], kind=kind, likelihood=likelihood, severity=severity,
            affected_corridor_ids=corridors, affected_node_ids=nodes, duration_days=duration,
            rationale=f"Keyword match ({kind}) on alert text mentioning {', '.join(net.node(n).name for n in mentioned)}.",
            evidence_alert_ids=[a.id],
        ))
    issues.sort(key=lambda i: (-RANK[i.likelihood] * SEV[i.severity], -len(i.affected_corridor_ids)))
    summary = (f"{len(issues)} issue(s) matched to the network from {len(alerts)} alert(s) using keyword rules."
               if issues else "No alert could be matched to the network.")
    return Extraction(summary=summary, issues=issues)
