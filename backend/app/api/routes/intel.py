from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas as s
from app.api.deps import Principal, current_principal, tenant_planner
from app.core.config import get_settings
from app.core.security import rate_limiter
from app.db.models import Alert, Analysis
from app.db.session import get_db
from app.engine.assumptions import LIKELIHOOD_BANDS
from app.engine.planner import Planner
from app.intel.claude import call_with_fallback
from app.intel.rules import analyze_rules
from app.intel.schemas import AlertInput

router = APIRouter(prefix="/v1", tags=["alerts & analysis"])
NOTICE = ("Likelihood is qualitative (from the alerts' wording and credibility). The probability used in simulation "
          "comes from the likelihood bands shown here, which are tunable modelling choices, not forecasts.")


@router.get("/alerts", response_model=list[s.AlertOut], summary="Alerts and news items for this client")
def list_alerts(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> list[Alert]:
    return list(db.scalars(select(Alert).where(Alert.tenant_id == p.tenant.id).order_by(Alert.created_at.desc())
                           .limit(100)))


@router.post("/alerts", response_model=s.AlertOut, status_code=201, summary="Add an alert (paste news or field report)")
def add_alert(body: s.AlertIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Alert:
    alert = Alert(tenant_id=p.tenant.id, title=body.title, body=body.body, source=body.source, url=body.url,
                  published_at=body.published_at, is_sample=False)
    db.add(alert)
    db.commit()
    return alert


@router.delete("/alerts/{alert_id}", status_code=204, summary="Delete an alert")
def delete_alert(alert_id: uuid.UUID, p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> None:
    alert = db.get(Alert, alert_id)
    if alert is None or alert.tenant_id != p.tenant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    db.delete(alert)
    db.commit()


def _analysis_out(a: Analysis) -> s.AnalysisOut:
    r = a.result
    return s.AnalysisOut(id=a.id, engine=a.engine, model=a.model, engine_note=r.get("engineNote"), created_at=a.created_at,
                         summary=r["summary"], issues=r["issues"], likelihood_bands=r["likelihoodBands"], notice=NOTICE)


@router.post("/alerts/analyze", response_model=s.AnalysisOut,
             summary="Rank the issues in the alerts that could disrupt deliveries (LLM, rules fallback)")
async def analyze(body: s.AnalyzeIn, request: Request, p: Principal = Depends(current_principal),
                  planner: Planner = Depends(tenant_planner), db: Session = Depends(get_db)) -> s.AnalysisOut:
    settings = get_settings()
    if not rate_limiter.allow(f"analyze:{p.tenant.id}", settings.rate_limit_analyze_per_min):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Analysis rate limit reached; try again shortly")
    q = select(Alert).where(Alert.tenant_id == p.tenant.id)
    if body.alert_ids:
        q = q.where(Alert.id.in_(body.alert_ids))
    alerts = list(db.scalars(q.order_by(Alert.created_at.desc()).limit(30)))
    if not alerts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No alerts to analyse")
    inputs = [AlertInput(id=str(a.id), title=a.title, body=a.body, source=a.source,
                         published_at=a.published_at.isoformat() if a.published_at else None) for a in alerts]
    net = planner.net
    planned = {r.destination: r.baseline.corridors for r in planner.plan_network() if r.baseline}

    analyzer = request.app.state.analyzer if body.use_llm else None
    extraction, note = await call_with_fallback(analyzer, net, inputs, planned, body.horizon_days)
    engine, model = ("claude", analyzer.model) if extraction is not None else ("rules", None)
    if extraction is None:
        extraction = analyze_rules(net, inputs)
        if not body.use_llm:
            note = "Rule-based analysis requested."

    issues = []
    for rank, i in enumerate(extraction.issues, start=1):
        issues.append({
            "id": f"issue-{rank}", "rank": rank, "title": i.title, "kind": i.kind, "likelihood": i.likelihood,
            "severity": i.severity, "probability": LIKELIHOOD_BANDS[i.likelihood],
            "affectedCorridorIds": i.affected_corridor_ids, "affectedNodeIds": i.affected_node_ids,
            "durationDays": i.duration_days, "rationale": i.rationale, "evidenceAlertIds": i.evidence_alert_ids,
        })
    record = Analysis(tenant_id=p.tenant.id, engine=engine, model=model, alert_ids=[x.id for x in inputs],
                      created_by=p.user.id,
                      result={"summary": extraction.summary, "issues": issues, "engineNote": note,
                              "likelihoodBands": LIKELIHOOD_BANDS})
    db.add(record)
    db.commit()
    return _analysis_out(record)


@router.get("/analyses/latest", response_model=s.AnalysisOut, summary="Most recent analysis")
def latest_analysis(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> s.AnalysisOut:
    a = db.scalar(select(Analysis).where(Analysis.tenant_id == p.tenant.id).order_by(Analysis.created_at.desc()).limit(1))
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No analysis yet")
    return _analysis_out(a)


@router.get("/analyses/{analysis_id}", response_model=s.AnalysisOut, summary="An analysis by id")
def get_analysis(analysis_id: uuid.UUID, p: Principal = Depends(current_principal),
                 db: Session = Depends(get_db)) -> s.AnalysisOut:
    a = db.get(Analysis, analysis_id)
    if a is None or a.tenant_id != p.tenant.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Analysis not found")
    return _analysis_out(a)
