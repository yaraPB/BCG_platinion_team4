from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_ip, current_principal
from app.api.schemas import LoginIn, MeOut, TokenOut
from app.core.config import get_settings
from app.core.security import create_access_token, rate_limiter, verify_password
from app.db.models import Tenant, User
from app.db.session import get_db

router = APIRouter(prefix="/v1", tags=["auth"])


@router.post("/auth/token", response_model=TokenOut, summary="Sign in and get a bearer token")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> TokenOut:
    if not rate_limiter.allow(f"login:{client_ip(request)}", get_settings().rate_limit_login_per_min):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many sign-in attempts; try again in a minute")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    tenant = db.get(Tenant, user.tenant_id)
    user.last_login_at = datetime.now(UTC)
    db.commit()
    token, expires_in = create_access_token(user.id, user.tenant_id, user.role)
    return TokenOut(access_token=token, expires_in=expires_in, tenant=tenant.name, user=user.full_name or user.email)


@router.get("/me", response_model=MeOut, summary="Current user and client")
def me(p: Principal = Depends(current_principal)) -> MeOut:
    return MeOut(id=p.user.id, email=p.user.email, full_name=p.user.full_name, role=p.user.role,
                 tenant_id=p.tenant.id, tenant_name=p.tenant.name)
