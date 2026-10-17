from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VIAMENSA_", env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "sqlite:///./viamensa.db"
    jwt_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    jwt_expires_minutes: int = 12 * 60
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    log_level: str = "INFO"

    demo_tenant_slug: str = "demo-food-distributor"
    demo_tenant_name: str = "Demo client: food distributor (South Sudan)"
    demo_user_email: str = "demo@foodbridge.app"
    demo_user_password: SecretStr = SecretStr("winners")

    anthropic_api_key: SecretStr | None = Field(
        default=None, validation_alias=AliasChoices("ANTHROPIC_API_KEY", "VIAMENSA_ANTHROPIC_API_KEY"))
    anthropic_model: str = "claude-opus-5-5"
    anthropic_timeout_s: float = 90.0

    max_simulation_runs: int = 20000
    rate_limit_login_per_min: int = 10
    rate_limit_analyze_per_min: int = 20

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.is_production and s.jwt_secret.get_secret_value().startswith("dev-only"):
        raise RuntimeError("VIAMENSA_JWT_SECRET must be set in production")
    return s
