#!/bin/bash
# 3초 여행 Admin 페이지 (포트 8090)
cd "$(dirname "$0")"

PORT=8090
URL="http://127.0.0.1:${PORT}/?v=$(date +%s)"

# 기존 admin 서버 정리
if lsof -ti ":${PORT}" >/dev/null 2>&1; then
  lsof -ti ":${PORT}" | xargs kill -9 2>/dev/null || true
  sleep 0.3
fi

echo "================================================================"
echo "  3초 여행 · Admin 페이지"
echo "  ${URL}"
echo "================================================================"

( sleep 1.2 && open "${URL}" ) &
exec python3 serve.py "${PORT}"
