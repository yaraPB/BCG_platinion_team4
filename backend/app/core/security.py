from __future__ import annotations

import time
import uuid
from collections import defaultdict, deque

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

_hasher = PasswordHasher()
ISSUER = "viamensa"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID, tenant_id: uuid.UUID, role: str) -> tuple[str, int]:
    s = get_settings()
    now = int(time.time())
    exp = now + s.jwt_expires_minutes * 60
    token = jwt.encode(
        {"sub": str(user_id), "tid": str(tenant_id), "role": role, "iat": now, "exp": exp, "iss": ISSUER},
        s.jwt_secret.get_secret_value(), algorithm="HS256",
    )
    return token, exp - now


def decode_access_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret.get_secret_value(), algorithms=["HS256"], issuer=ISSUER,
                      options={"require": ["sub", "tid", "exp", "iat"]})


class RateLimiter:
    """Sliding-window limiter, in-process. Behind multiple replicas each replica limits independently
    (acceptable for abuse protection; swap for Redis if strict global limits are needed)."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_s: float = 60.0) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > window_s:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


rate_limiter = RateLimiter()
