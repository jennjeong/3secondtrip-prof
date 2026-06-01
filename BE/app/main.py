import os

"""FastAPI 진입점 — 모든 라우터 등록 + CORS + DB 초기화."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.init_db import init_db

# 라우터
from app.routers import auth as auth_router
from app.routers import users as users_router
from app.routers import trips as trips_router
from app.routers import schedules as schedules_router
from app.routers import bookings as bookings_router
from app.routers import roadmaps as roadmaps_router
from app.routers import blogs as blogs_router
from app.routers import reviews as reviews_router
from app.routers import feedback as feedback_router
from app.routers import surveys as surveys_router
from app.routers import routes_api as routes_api_router
from app.routers import places as places_router
from app.routers import images as images_router
from app.routers import openai_proxy as openai_router
from app.routers import admin as admin_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(title="3초 여행 Backend", version="2.0.0")

# ── CORS — 로컬 + 프로덕션(Netlify 등) 둘 다 지원 ─────────────────
#   CORS_ORIGINS 환경변수에 콤마 구분으로 추가 (예: "https://myapp.netlify.app,https://www.foo.com")
_DEFAULT_ALLOWED = {
    settings.frontend_origin,
    "http://localhost:5500", "http://127.0.0.1:5500",
    "https://localhost:5500", "https://127.0.0.1:5500",
    "http://localhost:8080", "http://127.0.0.1:8080",
    "http://localhost:8090", "http://127.0.0.1:8090",   # admin panel
}
_extra = [o.strip() for o in (os.getenv("CORS_ORIGINS") or "").split(",") if o.strip()]
_ALLOWED = _DEFAULT_ALLOWED.union(_extra)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(o for o in _ALLOWED if o),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health():
    return {"ok": True, "env": settings.app_env, "version": app.version}


# ── Routers ─────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(users_router.router)
app.include_router(trips_router.router)
app.include_router(schedules_router.router)
app.include_router(roadmaps_router.router)
app.include_router(bookings_router.router)
app.include_router(blogs_router.router)
app.include_router(reviews_router.router)
app.include_router(feedback_router.router)
app.include_router(surveys_router.router)
app.include_router(routes_api_router.router)
app.include_router(places_router.router)
app.include_router(images_router.router)
app.include_router(openai_router.router)
app.include_router(admin_router.router)


@app.get("/api/config/maps")
def maps_config():
    """Return the browser-facing Maps key.  This key is restricted by
    HTTP referrer at GCP Console — that's the security boundary.  The
    server-side key (Routes/Places) is NEVER returned here.
    """
    return {"browserKey": settings.google_maps_browser_key or ""}
