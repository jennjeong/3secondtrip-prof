#!/bin/bash
# 3초 여행 — Redesign + Backend One-Click Launcher (macOS)
# 더블클릭하면:
#   1) 백엔드가 떠 있지 않으면 새 터미널에서 자동 실행
#   2) 캐시-OFF 정적 서버로 프론트 실행
#   3) 브라우저 자동 열기

set -e
cd "$(dirname "$0")"

FRONT_PORT=8080
BACK_PORT=8000
BACK_DIR="$(cd "../BE" 2>/dev/null && pwd || true)"

# ── 백엔드 살아 있나? ──
backend_alive() {
  curl -sf -m 1 "http://127.0.0.1:${BACK_PORT}/health" >/dev/null 2>&1
}

if ! backend_alive; then
  if [ -n "$BACK_DIR" ] && [ -f "$BACK_DIR/start-backend.command" ]; then
    echo "백엔드가 꺼져 있어요. 새 터미널에서 자동 시작합니다..."
    osascript <<APPLE
tell application "Terminal"
  do script "bash '${BACK_DIR}/start-backend.command'"
  activate
end tell
APPLE
    echo "백엔드 부팅 대기 중 (최대 30초)..."
    for i in $(seq 1 30); do
      if backend_alive; then
        echo "✅ 백엔드 준비됨"
        break
      fi
      sleep 1
    done
    if ! backend_alive; then
      echo "⚠️  백엔드가 30초 안에 응답하지 않아요. 새로 열린 터미널 창의 메시지를 확인해 주세요."
      echo "    (예: 의존성 설치가 처음이라 오래 걸릴 수 있어요)"
    fi
  else
    echo "⚠️  backend 폴더를 찾을 수 없어요. 수동으로 실행해 주세요:"
    echo "    cd \"3SecondTrip-fullstack 9/backend\" && bash start-backend.command"
  fi
fi

# ── 프론트엔드 ──
TS=$(date +%s)
URL="http://127.0.0.1:${FRONT_PORT}/index-redesign.html?v=${TS}#page=home"

# 기존 프론트 서버 정리
if lsof -ti ":${FRONT_PORT}" >/dev/null 2>&1; then
  echo "포트 ${FRONT_PORT} 사용 중 — 기존 프로세스 종료"
  lsof -ti ":${FRONT_PORT}" | xargs kill -9 2>/dev/null || true
  sleep 0.4
fi

echo ""
echo "================================================================"
echo "  3초 여행 · Redesign Preview (no-cache)"
echo "  ${URL}"
echo "  종료: Ctrl+C"
echo "================================================================"
echo ""

( sleep 1.2 && open "${URL}" ) &
exec python3 serve.py "${FRONT_PORT}"
