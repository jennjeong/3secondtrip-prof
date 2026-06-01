# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**3초 여행 (3 Second Trip)** — an AI-assisted mobile travel-roadmap planner. Users enter a destination city, dates, budget, and taste preferences; the app generates a day-by-day itinerary from real Google Places data and renders it on a map with drag-to-reorder editing.

The repo holds three independent deployables that talk over HTTP:

| Dir      | What                          | Stack                              | Local port |
| -------- | ----------------------------- | ---------------------------------- | ---------- |
| `BE/`    | API server                    | FastAPI + SQLAlchemy 2 + SQLite    | 8000       |
| `FE/`    | End-user SPA                  | Vanilla ES-module JS, no build step| 8080       |
| `admin/` | Admin panel                   | Static HTML/JS                     | 8090       |

> **Only `BE/` is a git repository.** `FE/` and `admin/` are not version-controlled, and the project root is not a git repo. If asked to commit FE/admin work, surface this first.

## Running

Each folder has a macOS `.command` double-click launcher, but from the terminal:

```bash
# Backend (creates .venv, installs deps, runs uvicorn with reload scoped to app/)
cd BE && bash start-backend.command
#   …or manually:
cd BE && source .venv/bin/activate && python -m uvicorn app.main:app --reload --reload-dir app --port 8000

# Frontend — MUST be served by the no-cache server (browsers aggressively cache the redesign-*.js modules)
cd FE && python3 serve.py 8080      # → http://127.0.0.1:8080/index-redesign.html

# Admin
cd admin && python3 serve.py 8090

# Local HTTPS backend (reads HTTPS_ENABLED / SSL_* from .env)
cd BE && python run_https.py
```

`FE/start-redesign.command` auto-boots the backend in a new Terminal if `:8000/health` is down, then opens the browser — the one-click full-stack start.

**Important:** `uvicorn --reload` must only watch `app/` (`--reload-dir app`). Watching `.venv/` or `data/` causes a restart loop during pip install or on every SQLite write.

### Grant admin rights
```bash
cd BE && source .venv/bin/activate
python make_admin.py <email-or-user-id>          # add --off to revoke
```

There is **no test suite, linter, or build pipeline** in this repo. Don't invent commands for them.

## Configuration & secrets

- `BE/.env` is the only secret source — loaded by `app/core/config.py` (`Settings`). Frontend code must never read it. Copy from `BE/.env.example`.
- The frontend learns the backend URL from `window.__API_BASE_URL` (set by a `<script>` in `index-redesign.html` for prod); on localhost it auto-detects `http://localhost:8000`. See `FE/js/redesign-api-adapter.js`.
- Google Maps keys are split: the **browser key** (referrer-restricted) is the only thing served to the client, via `GET /api/config/maps`. The **server key** (Places/Routes) never leaves the backend.
- Deployment target is Render (`BE/render.yaml`, Blueprint). Note the free tier has **ephemeral disk** — SQLite resets on every deploy/cold start; switch `DATABASE_URL` to Render Postgres for persistence.

## Backend architecture (`BE/app/`)

Standard layered FastAPI app. `main.py` registers all 15 routers and runs `init_db()` on startup.

- **`routers/`** — one file per domain (auth, users, trips, schedules, roadmaps, bookings, blogs, reviews, feedback, surveys, places, routes_api, images, openai_proxy, admin). Prefixes vary: most are `/<domain>`, but Maps/Places/routes live under `/api/...` and `/api/config/maps` is defined directly in `main.py`.
- **`routers/dependencies.py`** — the auth gate. `get_current_user` (401 if no/bad Bearer JWT), `get_current_user_optional` (returns None instead of raising — used by public-read endpoints), `get_current_admin` (403 unless `is_admin`). Inject these rather than re-parsing tokens.
- **PII is encrypted at rest.** Models use `EncryptedString` / `EncryptedDate` (`models/_crypto_type.py`, backed by Fernet in `core/crypto.py`, keyed by `DB_ENCRYPTION_KEY`). The Python attribute stays plaintext (`str`/`date`) — encryption is transparent on read/write. Legacy plaintext rows are returned as-is. **Encrypted columns cannot be queried with SQL `WHERE` / `LIKE`** — that's why `User` carries a separate `email_normalized` lookup column.
- **`db/init_db.py`** runs on every startup: `create_all`, then best-effort auto-migrations (`migrate_admin_flag` adds missing columns to old DBs) and idempotent seeding (`seed.seed_roadmaps_if_empty`). Migration/seed failures are logged but never block startup. There is **no Alembic** — schema evolution is hand-rolled ALTER scripts in `db/migrate_*.py`.
- **External calls are proxied, never client-side:** `openai_proxy.py` (`POST /openai/chat`, auth-required) and `services/google_maps_service.py` (Places search). Keys stay server-side.
- **OAuth** (`routers/auth.py`, `services/oauth_service.py`): Google / Kakao / Apple implemented, Naver is a stub. Flow ends by redirecting to the frontend with the JWT in the URL hash.

## Frontend architecture (`FE/`)

A **single-page app in `index-redesign.html`** with hash-based routing (`#page=...`) and **no framework or bundler** — plain ES-module `import`s loaded directly by the browser. Files are `js/redesign-*.js` and `css/redesign-*.css`.

- **`redesign-main.js` is the bootstrap.** It defines the shared mutable `appState` (current trip form, `generated` schedule, expenses, currentUser, survey preferences), restores it from localStorage, then calls each feature module's `init*(appState)`. Every module mutates this one shared object.
- **`redesign-api-adapter.js`** is the single backend boundary: `apiRequest()` wrapper (attaches Bearer JWT, normalizes errors), the `api.*` method surface (mirrors the router endpoints 1:1), token storage (`tst_token_v1`), and OAuth-callback token capture. "Tolerant" wrappers swallow 404/501 from optional endpoints so the UI degrades to local-cache mode. Add new endpoints here, not via raw `fetch` in feature modules.
- **Itinerary generation runs client-side** in `redesign-trip-flow.js::_generateSchedule()`, NOT via the OpenAI proxy. It resolves the city centre first, then makes one `api.searchPlaces()` call per time-slot biased to a 30 km circle around that centre (Haversine-filters out-of-city hits), and finally writes `appState.generated`. `redesign-cities.js` is a large pure-data worldwide city dataset (key/name/country/region/tier) driving autocomplete and budget suggestions.
- **State persistence & cache-busting:** `appState` is snapshotted to `localStorage` (`tst_app_state_v1`) on every `redesign:schedule-changed` event. `BUILD_VERSION` in `redesign-main.js` gates a migration — **bump it whenever the schedule/state schema changes** so stale saved schedules and place caches are wiped on next load (auth/language/theme are preserved). Modules communicate render triggers through DOM `CustomEvent`s (e.g. schedule mutation → map re-render) rather than direct calls.

When editing JS, match the existing style: each module is an IIFE-free ES module exporting `init*` + render functions, heavy inline comments explaining *why*, and Korean user-facing strings.
