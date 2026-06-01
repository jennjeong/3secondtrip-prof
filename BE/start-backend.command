#!/bin/bash
# 3초 여행 — Backend Launcher (macOS)
# 더블클릭하면 가상환경 만들고 의존성 설치하고 uvicorn 을 실행합니다.
#
# 중요: --reload 가 .venv 까지 감시하면 pip 설치 도중 파일이 바뀔 때마다
# 서버가 재시작되는 무한 루프가 생깁니다.  --reload-dir app 으로 감시
# 대상을 우리 코드 폴더(app/)로만 한정합니다.

set -e
cd "$(dirname "$0")"

PORT=8000

# 기존 8000 포트 사용 중이면 정리
if lsof -ti ":${PORT}" >/dev/null 2>&1; then
  echo "포트 ${PORT} 사용 중 — 기존 프로세스 종료"
  lsof -ti ":${PORT}" | xargs kill -9 2>/dev/null || true
  sleep 0.4
fi

# Python 찾기
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python 이 없어요. https://www.python.org 에서 설치해 주세요."
  read -r -p "엔터로 종료" _
  exit 1
fi

# .venv 가 없으면 생성
if [ ! -d ".venv" ]; then
  echo "가상환경(.venv) 생성 중..."
  $PY -m venv .venv
fi

# 활성화
# shellcheck disable=SC1091
source .venv/bin/activate

# 의존성 확인 + 설치 (한 번만, 이때 --reload 절대 켜지 말 것)
if ! python -c "import fastapi, uvicorn, sqlalchemy, httpx, passlib, jose, multipart" >/dev/null 2>&1; then
  echo "의존성 설치 중... (한 번만, 1~2분 소요)"
  pip install -q --upgrade pip
  pip install -q -r requirements.txt
  # 설치 직후 filesystem 안정화 잠깐 대기 — watcher 가 시작하자마자 reload 못하게
  sleep 1
fi

# .env 존재 확인
if [ ! -f ".env" ]; then
  echo "⚠️  .env 가 없어요. .env.example 을 복사해서 키를 채워 주세요:"
  echo "    cp .env.example .env"
  read -r -p "엔터로 종료" _
  exit 1
fi

echo ""
echo "================================================================"
echo "  3초 여행 · Backend (FastAPI)"
echo "  http://localhost:${PORT}/health"
echo "  종료: Ctrl+C"
echo "================================================================"
echo ""

# 핵심: --reload-dir app  ← .venv / data / __pycache__ 는 절대 감시 안 함
# 추가 보호: --reload-exclude 패턴 으로 혹시 모를 경로도 차단
exec python -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port ${PORT} \
  --reload \
  --reload-dir app \
  --reload-exclude ".venv/*" \
  --reload-exclude "data/*" \
  --reload-exclude "__pycache__/*" \
  --reload-exclude "*.pyc"
