"""환경변수 로더 — backend/.env 만 읽음. 프론트엔드에서 직접 import 금지.

User information(이름·전화·일정·후기 등)은 SQLite 에만 저장.
이 파일은 서버 구성/시크릿(JWT_SECRET, OAuth Client Secret, OpenAI API Key 등)만 다룸.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ── 서버 ──────────────────────────────────────────────────────────
    app_env: str = "local"
    app_host: str = "http://localhost:8000"
    frontend_origin: str = "http://localhost:5500"
    frontend_callback_path: str = "/index-redesign.html"   # OAuth 콜백 시 hash 토큰을 받을 페이지

    # ── DB ────────────────────────────────────────────────────────────
    database_url: str = "sqlite:///./data/travel_app.sqlite3"

    # ── JWT ───────────────────────────────────────────────────────────
    jwt_secret: str = "replace_me_with_a_long_random_string_at_least_32_chars"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080  # 7 days

    # ── OAuth — Google ───────────────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/google/callback"

    # ── OAuth — Kakao ────────────────────────────────────────────────
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    kakao_redirect_uri: str = "http://localhost:8000/auth/kakao/callback"

    # ── OAuth — Naver ────────────────────────────────────────────────
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = "http://localhost:8000/auth/naver/callback"

    # ── OAuth — Apple ────────────────────────────────────────────────
    apple_client_id: str = ""
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key_path: str = ""
    apple_redirect_uri: str = "http://localhost:8000/auth/apple/callback"

    # ── OpenAI (server-side proxy) ───────────────────────────────────
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # ── HTTPS (optional local SSL) ───────────────────────────────────
    https_enabled: bool = False
    ssl_cert_file: str = ""
    ssl_key_file: str = ""

    # ── Google Maps Platform ─────────────────────────────────────────
    google_maps_server_key: str = ""
    google_maps_browser_key: str = ""

    # ── PII 컬럼 암호화 (Fernet 키 / .env DB_ENCRYPTION_KEY) ─────────
    db_encryption_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
