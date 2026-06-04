"""손상된/빈 JSON 컬럼을 안전하게 파싱하는 헬퍼.

DB에 저장된 *_json 문자열이 NULL이거나 손상됐을 때 json.loads가 던지는
예외로 조회 엔드포인트 전체가 500이 되는 것을 막는다. 파싱 실패 시 기본값을
반환하고 경고만 남긴다(데모 중 한 행이 깨져도 목록이 통째로 죽지 않도록)."""
import json
import logging

logger = logging.getLogger("jsonsafe")


def loads(raw, default):
    """raw(JSON 문자열|None)를 파싱. 실패하면 default를 반환."""
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("손상된 JSON 컬럼 — 기본값으로 대체: %r", (raw or "")[:80])
        return default
