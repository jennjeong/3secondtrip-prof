"""프로세스 메모리 기반의 간단한 요청 제한.

서버가 재시작되면 초기화된다.  로그인 없이 쓰는 쓰기 API의 남용을 막는 용도다.
X-Forwarded-For 는 위조될 수 있어 IP별 제한과 함께 전체 제한도 둔다.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


MAX_TRACKED_IPS = 10_000


class RateLimiter:
    def __init__(self, per_ip: int, total: int, window_seconds: int = 60):
        self.per_ip = per_ip
        self.total = total
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()

    def _trim(self, hits: deque[float], now: float) -> None:
        while hits and hits[0] <= now - self.window:
            hits.popleft()

    def __call__(self, request: Request) -> None:
        forwarded = request.headers.get("x-forwarded-for", "")
        ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        now = time.monotonic()
        if len(self._hits) > MAX_TRACKED_IPS:  # 위조된 IP로 메모리가 늘어나는 것을 막는다
            self._hits.clear()
        hits = self._hits[ip]
        self._trim(hits, now)
        self._trim(self._all, now)
        if len(hits) >= self.per_ip or len(self._all) >= self.total:
            raise HTTPException(429, "Too many requests")
        hits.append(now)
        self._all.append(now)
