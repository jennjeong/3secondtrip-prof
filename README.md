# 3초 여행 (3 Second Trip) ✈️

> 도시·날짜·예산·취향만 입력하면 **3초 만에** 실제 명소 데이터로 하루하루 여행 일정을 만들어 주는 모바일 여행 로드맵 플래너.

생성된 일정은 지도 위에 표시되고, 드래그로 순서를 바꾸거나 장소를 추가·편집할 수 있습니다.

---

## ✨ 주요 기능

- **자동 일정 생성** — 도시 중심을 기준으로 시간대별 명소를 실제 Google Places 데이터에서 검색해 하루 코스를 구성
- **전 세계 도시 검색** — 한글/별칭 자동완성, 도시 등급(tier) 기반 예산 추천
- **지도 + 타임라인 편집** — Google Maps 딥링크, 드래그 앤 드롭 순서 변경, 장소 추가/수정/삭제
- **소셜 로그인** — Google / Kakao / Naver / Apple (각 제공자 자격증명을 `.env`에 채우면 활성화)
- **취향 설문 · 로드맵 공유 · 후기 · 예약 · 블로그** 등 여행 커뮤니티 기능
- **관리자 패널** — 사용자/콘텐츠 관리
- **개인정보 암호화** — 이름·전화·일정 등 PII는 DB에 Fernet으로 암호화 저장

---

## 🗂 구성

한 Git 저장소(`jennjeong/3secondtrip-prof`)에 아래 폴더가 모두 들어 있습니다.

| 폴더      | 역할                         | 스택                                         | 로컬 포트 | 운영 배포 |
| --------- | ---------------------------- | -------------------------------------------- | -------- | -------- |
| `BE/`     | API 서버                     | FastAPI + SQLAlchemy 2 (로컬 SQLite / 운영 Postgres) | 8000     | Render (main 푸시 시 자동) |
| `FE/`     | 사용자 웹앱(SPA)·PWA          | 바닐라 ES module JS (빌드 도구 없음) + 서비스 워커 | 8080     | Vercel (CLI로 직접 배포, 아래 참고) |
| `admin/`  | 관리자 패널                  | 정적 HTML/JS                                 | 8090     | — |
| `app/`    | iOS·Android 앱 껍데기        | Capacitor (`app/www`에 FE 묶음)               | —        | 스토어 빌드 |
| `tests/`  | 화면 로직 테스트             | `node --test`                                | —        | CI |
| `design/` | 로고·아이콘 시안             | —                                            | —        | — |

> ℹ️ 예전에는 `BE/`만 Git으로 관리했지만, 지금은 위 폴더가 모두 커밋돼 있습니다. `.env`·로컬 DB(`*.sqlite3`)는 `.gitignore`로 빠집니다.

---

## 🚀 빠른 시작 (macOS)

각 폴더의 `.command` 파일을 더블클릭하면 가장 간단하게 실행됩니다.

가장 추천하는 방법 — `FE/start-redesign.command` 더블클릭:
1. 백엔드가 꺼져 있으면 새 터미널에서 자동 실행
2. 캐시 OFF 정적 서버로 프론트 실행
3. 브라우저 자동 오픈

### 터미널에서 직접 실행

**1) 백엔드**
```bash
cd BE
bash start-backend.command          # .venv 생성 + 의존성 설치 + uvicorn 실행
# → http://localhost:8000/health
```
또는 수동으로:
```bash
cd BE
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --reload-dir app --port 8000
```

**2) 프론트엔드** (반드시 no-cache 서버로 — 브라우저가 JS 모듈을 강하게 캐싱함)
```bash
cd FE
python3 serve.py 8080
# → http://127.0.0.1:8080/index-redesign.html
```

**3) 관리자 패널**
```bash
cd admin
python3 serve.py 8090
# → http://127.0.0.1:8090/
```

---

## ⚙️ 환경 설정

백엔드 설정·시크릿은 **`BE/.env`** 한 곳에서만 읽습니다 (`app/core/config.py`). 예시 파일을 복사해 키를 채워 주세요.

```bash
cd BE
cp .env.example .env
```

주요 환경변수:

| 키 | 설명 |
| --- | --- |
| `JWT_SECRET` | JWT 서명 키 (32자 이상 랜덤) |
| `DB_ENCRYPTION_KEY` | PII 컬럼 암호화용 Fernet 키 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google OAuth |
| `KAKAO_*` / `APPLE_*` | 소셜 로그인 |
| `GOOGLE_MAPS_SERVER_KEY` | 서버 전용 (Places/Routes) — 클라이언트에 절대 노출 안 됨 |
| `GOOGLE_MAPS_BROWSER_KEY` | 브라우저용 (HTTP referrer 제한) — `GET /api/config/maps`로만 제공 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI 프록시 (`/openai/chat`) |
| `FRONTEND_ORIGIN` / `CORS_ORIGINS` | CORS 허용 출처 |
| `DATABASE_URL` | 기본값 `sqlite:///./data/travel_app.sqlite3` |

프론트엔드는 백엔드 주소를 `index-redesign.html`의 `window.__API_BASE_URL`에서 읽습니다. 배포된 화면은 운영 서버(`https://threesecondtrip-prof.onrender.com`)를 쓰고, localhost에서는 브라우저 저장값 `tst_dev_api`에 넣은 주소를 씁니다(예: 개발자 도구 콘솔에서 `localStorage.setItem('tst_dev_api','http://localhost:8000')`). 값이 없으면 서버 호출을 하지 않습니다.

이메일 가입·비밀번호 재설정 메일은 `RESEND_API_KEY`와 `MAIL_FROM`(Resend에서 인증한 도메인의 주소)이 **둘 다** 있어야 운영에서 열립니다. 하나라도 없으면 `/api/features`의 `email_signup`이 `false`가 되고 가입 버튼이 잠깁니다. `APP_ENV=development`에서는 메일 대신 화면에 인증 코드를 보여 줍니다.

### 관리자 권한 부여
```bash
cd BE && source .venv/bin/activate
python make_admin.py <이메일-또는-사용자ID>     # 해제는 끝에 --off
```

---

## 🔐 보안 설계 요점

- **키는 서버에만** — OpenAI, Google Maps 서버 키, OAuth 시크릿은 백엔드 프록시 뒤에 있고 클라이언트로 나가지 않습니다.
- **PII 암호화** — 사용자 이름/전화/날짜 등은 `EncryptedString`/`EncryptedDate`(Fernet)로 저장됩니다. 암호화 컬럼은 SQL 검색이 안 되므로 조회용 `email_normalized` 컬럼을 별도로 둡니다.
- **JWT 인증** — Bearer 토큰, 로그인/회원가입은 bcrypt 해시.

---

## ☁️ 배포

Render Blueprint(`BE/render.yaml`)로 백엔드 + Postgres를 한 번에 배포합니다.

1. 저장소를 GitHub에 push (Blueprint의 `rootDir`은 `BE`)
2. Render 대시보드 → New → Blueprint → 저장소 연결 → confirm
   - Blueprint가 **무료 Postgres DB(`3sec-trip-db`)** 를 자동 생성하고, `DATABASE_URL`을 웹 서비스에 자동 주입합니다 (수동 입력 불필요).
3. 시크릿 환경변수(`JWT_SECRET`, `DB_ENCRYPTION_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `FRONTEND_ORIGIN`, `GOOGLE_*`, `OPENAI_API_KEY` 등)를 대시보드에서 직접 입력 (`.env`는 커밋 금지)
4. 배포 뒤 `https://<서버>/api/features`의 `email.configured`가 `true`인지, `email.link_base`가 공개 화면 주소인지 확인합니다(키 값은 나오지 않습니다).

> 💾 **데이터 영속성**: 앱은 `DATABASE_URL`만 보고 DB를 고릅니다 — 로컬은 SQLite, 프로덕션은 Postgres. Render 웹 서비스 디스크는 휘발성이지만 데이터는 별도 Postgres에 저장되므로 **재배포/콜드스타트에도 보존**됩니다. (코드가 `postgres://` 스킴을 psycopg3로 자동 정규화 — `app/db/database.py`)

프론트엔드(`FE/`)는 Vercel 프로젝트 `3secondtrip-prof`에 올립니다. 이 프로젝트는 GitHub와 연결돼 있지 않아 푸시만으로는 배포되지 않습니다. 커밋한 `FE/`를 꺼내 Vercel CLI로 배포합니다.

```bash
git archive HEAD FE | tar -x -C /tmp/fe-deploy && cd /tmp/fe-deploy/FE
npx vercel@latest link --yes --project 3secondtrip-prof
npx vercel@latest deploy --prod --yes
```

화면 파일을 바꾸면 `FE/sw.js`의 `CACHE` 이름(예: `tst-shell-v47`)을 올려야 설치된 앱도 새 파일 묶음으로 바뀝니다. 서버와 화면을 같이 바꿨다면 **서버를 먼저** 배포합니다.

---

## 📌 참고

- 테스트: 서버 `cd BE && .venv/bin/python -m pytest -q`, 화면 `node --test tests/fe/*.test.mjs` · `node tests/fe/check-shell.mjs`. GitHub Actions(`.github/workflows/ci.yml`)가 main 푸시·PR마다 둘 다 돌립니다.
- 서버 설정 값의 기본값과 설명은 `BE/app/core/config.py`, 배포 환경변수 목록은 `BE/render.yaml`에 있습니다.
