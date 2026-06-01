# 3초 여행 (3 Second Trip) ✈️

> 도시·날짜·예산·취향만 입력하면 **3초 만에** 실제 명소 데이터로 하루하루 여행 일정을 만들어 주는 모바일 여행 로드맵 플래너.

생성된 일정은 지도 위에 표시되고, 드래그로 순서를 바꾸거나 장소를 추가·편집할 수 있습니다.

---

## ✨ 주요 기능

- **자동 일정 생성** — 도시 중심을 기준으로 시간대별 명소를 실제 Google Places 데이터에서 검색해 하루 코스를 구성
- **전 세계 도시 검색** — 한글/별칭 자동완성, 도시 등급(tier) 기반 예산 추천
- **지도 + 타임라인 편집** — Google Maps 딥링크, 드래그 앤 드롭 순서 변경, 장소 추가/수정/삭제
- **소셜 로그인** — Google / Kakao / Apple (Naver 준비 중)
- **취향 설문 · 로드맵 공유 · 후기 · 예약 · 블로그** 등 여행 커뮤니티 기능
- **관리자 패널** — 사용자/콘텐츠 관리
- **개인정보 암호화** — 이름·전화·일정 등 PII는 DB에 Fernet으로 암호화 저장

---

## 🗂 구성

HTTP로 통신하는 3개의 독립 모듈로 이루어져 있습니다.

| 폴더      | 역할              | 스택                                | 로컬 포트 |
| --------- | ----------------- | ----------------------------------- | -------- |
| `BE/`     | API 서버          | FastAPI + SQLAlchemy 2 + SQLite     | 8000     |
| `FE/`     | 사용자 웹앱(SPA)  | 바닐라 ES module JS (빌드 도구 없음) | 8080     |
| `admin/`  | 관리자 패널       | 정적 HTML/JS                        | 8090     |

> ℹ️ 현재 `BE/`만 git 저장소이며, `FE/`·`admin/`은 버전 관리에 포함되어 있지 않습니다.

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

프론트엔드는 백엔드 주소를 `index-redesign.html`의 `window.__API_BASE_URL`에서 읽으며, localhost에서는 `http://localhost:8000`을 자동 감지합니다.

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

Render Blueprint(`BE/render.yaml`)로 백엔드를 배포합니다.

1. `BE/`를 Git 저장소에 push
2. Render 대시보드 → New → Blueprint → 저장소 연결
3. 시크릿 환경변수(`JWT_SECRET`, `GOOGLE_*`, `OPENAI_API_KEY` 등)를 대시보드에서 직접 입력 (`.env`는 커밋 금지)

> ⚠️ Render 무료 티어는 디스크가 휘발성이라 **SQLite가 재배포/콜드스타트마다 초기화**됩니다. 데이터 영속화가 필요하면 Render Postgres로 전환하고 `DATABASE_URL`을 변경하세요.

프론트엔드는 Netlify 등 정적 호스팅에 올리고, `window.__API_BASE_URL`을 배포된 백엔드 주소로 설정합니다.

---

## 📌 참고

- 테스트 스위트·린터·빌드 파이프라인은 아직 없습니다.
- 아키텍처 상세는 [`CLAUDE.md`](./CLAUDE.md)를 참고하세요.
