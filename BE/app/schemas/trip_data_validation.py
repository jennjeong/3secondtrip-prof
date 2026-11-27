"""저장하는 일정(schedule_data) 검사.

일정은 화면에서 만들어 서버에 통째로 저장한다.  예전에 저장한 일정은 새 필드가
없을 수 있으므로 '있으면 검사'하는 느슨한 방식으로, 불가능한 값만 거절한다.
  - 금액: 숫자이고 0 이상 10억 원 이하. null 은 '비용 미확인'으로 허용
  - 날짜: YYYY-MM-DD, 여행 기간 1~31일
  - 인원 1~60명, 객실 1~30개, 예산 0 이상(없음 = 미입력)
  - 하루 장소 60개 이하, 전체 크기 1MB 이하
"""
import json
import re
from datetime import date
from typing import Any

MAX_MONEY = 1_000_000_000
MAX_DAYS = 31
MAX_ACTS = 60
MAX_BYTES = 1_000_000


def _money_ok(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return 0 <= v <= MAX_MONEY


def _date_ok(v: Any) -> bool:
    if v is None:
        return True
    try:
        date.fromisoformat(str(v))
        return True
    except ValueError:
        return False


_TIME = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")


def _time_ok(v: Any) -> bool:
    """시각은 'HH:MM'(00:00~23:59). 비어 있으면 '시각 미정'으로 본다."""
    return isinstance(v, str) and bool(_TIME.match(v.strip()))


def validate_trip_data(data: dict) -> None:
    """문제가 있으면 ValueError(한국어 안내)."""
    if not isinstance(data, dict):
        raise ValueError("일정 형식이 올바르지 않아요.")
    if len(json.dumps(data, ensure_ascii=False).encode("utf-8")) > MAX_BYTES:
        raise ValueError("일정이 너무 커요(1MB 이하).")
    days = data.get("days")
    if days is not None:
        if not isinstance(days, list) or not (1 <= len(days) <= MAX_DAYS):
            raise ValueError(f"여행 기간은 1~{MAX_DAYS}일이어야 해요.")
        for i, d in enumerate(days):
            if not isinstance(d, dict):
                raise ValueError(f"{i + 1}일차 형식이 올바르지 않아요.")
            if not _date_ok(d.get("date")):
                raise ValueError(f"{i + 1}일차 날짜 형식이 올바르지 않아요.")
            if not _money_ok(d.get("localTransport")):
                raise ValueError(f"{i + 1}일차 교통비가 올바르지 않아요.")
            acts = d.get("activities", [])
            if not isinstance(acts, list) or len(acts) > MAX_ACTS:
                raise ValueError(f"{i + 1}일차 장소는 {MAX_ACTS}곳 이하여야 해요.")
            for a in acts:
                if not isinstance(a, dict) or not _money_ok(a.get("cost")):
                    raise ValueError(f"{i + 1}일차 장소 비용이 올바르지 않아요.")
    for k in ("startDate", "endDate"):
        if not _date_ok(data.get(k)):
            raise ValueError("여행 날짜 형식이 올바르지 않아요.")
    s, e = data.get("startDate"), data.get("endDate")
    if s and e and _date_ok(s) and _date_ok(e) and date.fromisoformat(str(e)) < date.fromisoformat(str(s)):
        raise ValueError("귀국일이 출발일보다 빨라요.")
    if s and e and _date_ok(s) and _date_ok(e) and isinstance(days, list):
        # 출발·귀국일(둘 다 포함) 밖의 날짜는 있을 수 없다
        lo, hi = date.fromisoformat(str(s)), date.fromisoformat(str(e))
        for i, d in enumerate(days):
            ds = d.get("date")
            if ds and not (lo <= date.fromisoformat(str(ds)) <= hi):
                raise ValueError(f"{i + 1}일차 날짜가 여행 기간 밖이에요.")
    if isinstance(days, list):
        prev = None
        for i, d in enumerate(days):
            ds = d.get("date")
            if ds and _date_ok(ds):
                cur = date.fromisoformat(str(ds))
                if prev is not None and cur <= prev:
                    raise ValueError(f"{i + 1}일차 날짜({ds})가 앞 날과 같거나 빨라요. 날짜 순서대로 하루씩 넣어 주세요.")
                prev = cur
            for a in d.get("activities", []) or []:
                t = a.get("time")
                if t not in (None, "") and not _time_ok(t):
                    name = str(a.get("name") or "장소")[:30]
                    raise ValueError(f"{i + 1}일차 '{name}' 시각({str(t)[:10]})이 올바르지 않아요. 00:00~23:59 사이로 넣어 주세요.")
        if s and e and _date_ok(s) and _date_ok(e):
            span = (date.fromisoformat(str(e)) - date.fromisoformat(str(s))).days + 1
            if len(days) > span:
                raise ValueError(f"일정이 {len(days)}일인데 여행 기간은 {span}일이에요. 날짜를 늘리거나 남는 날을 지워 주세요.")
    if not _money_ok(data.get("budget")):
        raise ValueError("예산 금액이 올바르지 않아요.")
    people = data.get("people")
    if people is not None and (isinstance(people, bool) or not isinstance(people, int) or not (1 <= people <= 60)):
        raise ValueError("인원은 1~60명이어야 해요.")
    rooms = (data.get("budgetPlan") or {}).get("rooms") if isinstance(data.get("budgetPlan"), dict) else None
    if rooms is not None and (isinstance(rooms, bool) or not isinstance(rooms, int) or not (1 <= rooms <= 30)):
        raise ValueError("객실 수는 1~30개여야 해요.")
