from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.models import NetworkDocument, Tenant, User
from app.db.session import get_db
from app.engine.assumptions import default_params
from app.engine.network import Network
from app.engine.planner import Planner

bearer = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    user: User
    tenant: Tenant


def current_principal(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                      db: Session = Depends(get_db)) -> Principal:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = decode_access_token(creds.credentials)
        user_id, tenant_id = uuid.UUID(claims["sub"]), uuid.UUID(claims["tid"])
    except (InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token",
                            headers={"WWW-Authenticate": "Bearer"}) from None
    user = db.get(User, user_id)
    if user is None or user.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user", headers={"WWW-Authenticate": "Bearer"})
    tenant = db.get(Tenant, tenant_id)
    return Principal(user=user, tenant=tenant)


class PlannerRegistry:
    """Process-wide LRU of compiled planners keyed by (tenant, network version). Building one parses the network,
    computes arc weights and baselines; reusing it keeps requests fast. Thread-safe."""

    def __init__(self, capacity: int = 32):
        self._items: OrderedDict[tuple[uuid.UUID, int], Planner] = OrderedDict()
        self._lock = threading.Lock()
        self.capacity = capacity

    def get(self, tenant_id: uuid.UUID, doc: NetworkDocument) -> Planner:
        key = (tenant_id, doc.version)
        with self._lock:
            planner = self._items.get(key)
            if planner is not None:
                self._items.move_to_end(key)
                return planner
        planner = Planner(Network(doc.document, default_params()))
        with self._lock:
            self._items[key] = planner
            self._items.move_to_end(key)
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)
        return planner


registry = PlannerRegistry()


def tenant_planner(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Planner:
    doc = db.scalar(select(NetworkDocument).where(NetworkDocument.tenant_id == p.tenant.id,
                                                  NetworkDocument.is_active.is_(True)))
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No active network configured for this client")
    return registry.get(p.tenant.id, doc)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
