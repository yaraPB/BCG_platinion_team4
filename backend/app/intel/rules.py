"""Deterministic fallback analyzer: used when no LLM key is configured or the LLM call fails.

Sentence by sentence: an alert often mentions several roads with different certainty ("the road is closed ...;
the track could become impassable"). Each sentence is matched against the network gazetteer (town names), river
vocabulary (to pick river legs rather than roads), and keyword lists for kind, likelihood and severity. Sentences
without their own kind or severity inherit the alert's. Transparent and predictable; less nuanced than the LLM,
which is why the response always says which engine produced it.
"""

from __future__ import annotations

import re

from app.engine.network import Network

from .schemas import AlertInput, ExtractedIssue, Extraction

KIND_WORDS = {
    "flood": ["flood", "rain", "impassable", "washed", "standing water", "waterlog", "inundat", "submerged", "high water"],
    "conflict": ["clash", "fighting", "attack", "armed", "insecurity", "violence", "shoot", "looting"],
    "accident": ["overturn", "accident", "crash", "breakdown", "collision", "caught fire"],
    "landslide": ["landslide", "mudslide"],
    "storm": ["storm", "wind"],
    "fuel_shortage": ["fuel shortage", "fuel stations", "shortage of fuel", "fuel prices"],
    "strike": ["strike", "protest", "demonstration"],
    "checkpoint": ["checkpoint", "levy", "roadblock"],
}
RIVER_WORDS = ["river", "barge", "convoys on the", "boat", "sobat", "nile", "port"]
LIKELIHOOD_WORDS = [
    ("very_likely", ["reported", "ongoing", "blocked", "closed", "paused", "suspended", "overturned", "already",
                     "submerged", "turning back", "attacked", "broke out", "have "]),
    ("likely", ["expected", "expect", "forecast", "will", "indicate"]),
    ("possible", ["may", "might", "possible", "risk", "warn", "could"]),
]
SEVERITY_WORDS = [("high", ["impassable", "suspended", "paused", "fighting", "clashes", "closed", "submerged",
                            "blocking", "blocked", "turning back", "attacked"]),
                  ("low", ["slowly", "one lane", "minor", "delays"])]
DURATION = {"flood": 21, "conflict": 14, "accident": 2, "fuel_shortage": 14, "checkpoint": 7, "strike": 5}
RANK = {"very_likely": 4, "likely": 3, "possible": 2, "unlikely": 1}
SEV = {"high": 3, "medium": 2, "low": 1}


def _find(words: list[str], text: str) -> bool:
    return any(w in text for w in words)


def _kind(text: str) -> str | None:
    return next((k for k, ws in KIND_WORDS.items() if _find(ws, text)), None)


def _sentences(text: str) -> list[str]:
    # Sentences and semicolon clauses: "convoys paused; the Ulang–Nasir road is suspended" names two corridors.
    return [s.strip() for s in re.split(r"(?<=[.!?;])\s+", text) if s.strip()]


def _sentence_issue(net: Network, names: dict[str, str], sentence: str, alert: AlertInput, alert_kind: str,
                    alert_sev: str, single: bool) -> ExtractedIssue | None:
    original, sentence = sentence, sentence.lower()
    mentioned = [nid for nid, nm in names.items() if re.search(rf"\b{re.escape(nm)}\b", sentence)]
    if not mentioned:
        return None
    river = _find(RIVER_WORDS, sentence)
    corridors = []
    for c in net.corridors:
        if c.mode == "transfer" or (c.mode == "river") != river:
            continue
        if {c.a.removesuffix("-port"), c.b.removesuffix("-port")} <= set(mentioned):
            corridors.append(c.id)
    kind = _kind(sentence) or alert_kind
    likelihood = next((lv for lv, ws in LIKELIHOOD_WORDS if _find(ws, sentence)), "possible")
    severity = next((sv for sv, ws in SEVERITY_WORDS if _find(ws, sentence)), alert_sev)
    places = ", ".join(net.node(n).name for n in mentioned)
    return ExtractedIssue(
        title=(alert.title if single else original[:1].upper() + original[1:]).rstrip(".")[:200],
        kind=kind, likelihood=likelihood, severity=severity,
        affected_corridor_ids=corridors, affected_node_ids=[] if corridors else mentioned,
        duration_days=DURATION.get(kind, 7),
        rationale=f"Keyword match ({kind}, {likelihood.replace('_', ' ')}) in the alert text naming {places}.",
        evidence_alert_ids=[alert.id],
    )


def analyze_rules(net: Network, alerts: list[AlertInput]) -> Extraction:
    names = {n.id: n.name.lower() for n in net.nodes if n.kind != "port"}
    issues: list[ExtractedIssue] = []
    for a in alerts:
        full = f"{a.title}. {a.body}".lower()
        alert_kind = _kind(full) or "other"
        alert_sev = next((sv for sv, ws in SEVERITY_WORDS if _find(ws, full)), "medium")
        sentences = _sentences(a.body)
        found = [i for s in sentences
                 if (i := _sentence_issue(net, names, s, a, alert_kind, alert_sev, len(sentences) == 1)) is not None]
        # Keep sentences that name a corridor; a sentence that only names a place adds nothing if another names a road.
        with_roads = [i for i in found if i.affected_corridor_ids]
        found = with_roads or found
        if not found:  # body names nothing on the network: try the headline
            title_issue = _sentence_issue(net, names, a.title, a, alert_kind, alert_sev, True)
            found = [title_issue] if title_issue else []
        issues.extend(found)
    # Merge duplicates (same kind and corridors), keeping the most certain wording.
    merged: dict[tuple, ExtractedIssue] = {}
    for i in issues:
        key = (i.kind, tuple(sorted(i.affected_corridor_ids)), tuple(sorted(i.affected_node_ids)))
        if key not in merged or RANK[i.likelihood] > RANK[merged[key].likelihood]:
            merged[key] = i
    out = sorted(merged.values(), key=lambda i: (-RANK[i.likelihood] * SEV[i.severity], -len(i.affected_corridor_ids)))
    summary = (f"{len(out)} issue(s) matched to the network from {len(alerts)} alert(s) using keyword rules."
               if out else "No alert could be matched to the network.")
    return Extraction(summary=summary, issues=out)
