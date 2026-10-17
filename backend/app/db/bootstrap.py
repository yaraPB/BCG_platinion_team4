"""Migrations + idempotent seed. Safe to run on every container start, including several replicas at once
(Postgres advisory lock serialises them)."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import Alert, NetworkDocument, Tenant, User
from app.db.session import get_engine, get_sessionmaker

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
SEED = Path(__file__).resolve().parents[1] / "seed"
LOCK_ID = 774_211_009


@contextmanager
def _migration_lock():
    engine = get_engine()
    if engine.dialect.name != "postgresql":
        yield None
        return
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": LOCK_ID})
        try:
            yield conn
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_ID})


def run_migrations() -> None:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    with _migration_lock():
        command.upgrade(cfg, "head")


def load_seed_network() -> dict:
    doc = json.loads((SEED / "networks" / "south_sudan.json").read_text())
    doc["scenarios"] = json.loads((SEED / "scenarios.json").read_text())
    return doc


def seed_demo(db: Session) -> None:
    s = get_settings()
    tenant = db.scalar(select(Tenant).where(Tenant.slug == s.demo_tenant_slug))
    if tenant is None:
        tenant = Tenant(slug=s.demo_tenant_slug, name=s.demo_tenant_name, settings={})
        db.add(tenant)
        db.flush()
        log.info("seeded demo tenant")
    user = db.scalar(select(User).where(User.email == s.demo_user_email.lower()))
    if user is None:
        db.add(User(tenant_id=tenant.id, email=s.demo_user_email.lower(), full_name="Demo planner", role="admin",
                    password_hash=hash_password(s.demo_user_password.get_secret_value())))
    seed_doc = load_seed_network()
    current = db.scalar(select(NetworkDocument).where(NetworkDocument.tenant_id == tenant.id,
                                                      NetworkDocument.is_active.is_(True)))
    if current is None or current.document != seed_doc:
        version = (current.version + 1) if current else 1
        if current:
            current.is_active = False
        db.add(NetworkDocument(tenant_id=tenant.id, name=seed_doc["region"], version=version, document=seed_doc))
    if db.scalar(select(Alert.id).where(Alert.tenant_id == tenant.id, Alert.is_sample.is_(True)).limit(1)) is None:
        now = datetime.now(UTC)
        for i, a in enumerate(json.loads((SEED / "alerts.json").read_text())):
            db.add(Alert(tenant_id=tenant.id, title=a["title"], body=a["body"], source=a["source"], is_sample=True,
                         published_at=now - timedelta(hours=6 * i)))
    db.commit()


def bootstrap() -> None:
    run_migrations()
    with _migration_lock(), get_sessionmaker()() as db:
        seed_demo(db)
