from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, health, impact, intel, network, simulation
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.bootstrap import bootstrap
from app.intel.claude import ClaudeAnalyzer

log = logging.getLogger("viamensa")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    bootstrap()
    key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
    app.state.analyzer = ClaudeAnalyzer(key, settings.anthropic_model, settings.anthropic_timeout_s) if key else None
    log.info("startup complete", extra={"path": "lifespan"})
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ViaMensa API",
        version="0.1.0",
        description=("Routing and disruption planning for food deliveries: reroute, switch supplier or airlift when "
                     "corridors are cut; correlated Monte Carlo of news-informed risks; savings vs. no fallback."),
        lifespan=lifespan,
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error", extra={"request_id": rid, "path": request.url.path})
            response = JSONResponse({"detail": "Internal server error", "requestId": rid}, status_code=500)
        response.headers["x-request-id"] = rid
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.url.path not in ("/healthz", "/readyz"):
            log.info("request", extra={"request_id": rid, "path": request.url.path, "method": request.method,
                                       "status": response.status_code,
                                       "duration_ms": round((time.perf_counter() - start) * 1000, 1)})
        return response

    for r in (health.router, auth.router, network.router, intel.router, simulation.router, impact.router):
        app.include_router(r)
    return app


app = create_app()
