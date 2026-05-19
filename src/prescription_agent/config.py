from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    anthropic_api_key: str | None = None
    database_url: str = "sqlite:///./data/pharmacy.db"
    audit_log_path: Path = Path("artifacts/audit.log")
    docs_path: Path = Path("data/docs")
    benefits_path: Path = Path("data/pharmacy_benefits.json")
    chunk_size: int = 650
    chunk_overlap: int = 100

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
