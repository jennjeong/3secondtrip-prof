"""영업시간 변환 — 없음(모름) / 일반 / 자정 넘김 / 24시간."""
from app.services.google_maps_service import map_opening_periods


def test_none_when_missing():
    assert map_opening_periods(None) is None
    assert map_opening_periods({}) is None
    assert map_opening_periods({"periods": []}) is None


def test_regular_hours():
    h = {"periods": [{"open": {"day": 1, "hour": 9, "minute": 30}, "close": {"day": 1, "hour": 18, "minute": 0}}]}
    assert map_opening_periods(h) == [{"d": 1, "o": 570, "c": 1080}]


def test_closes_after_midnight():
    h = {"periods": [{"open": {"day": 5, "hour": 18, "minute": 0}, "close": {"day": 6, "hour": 2, "minute": 0}}]}
    assert map_opening_periods(h) == [{"d": 5, "o": 1080, "c": 120}]


def test_closes_exactly_midnight():
    h = {"periods": [{"open": {"day": 2, "hour": 10, "minute": 0}, "close": {"day": 3, "hour": 0, "minute": 0}}]}
    assert map_opening_periods(h) == [{"d": 2, "o": 600, "c": 1440}]


def test_open_24h():
    h = {"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}]}
    assert map_opening_periods(h) == [{"d": 0, "o": 0, "c": 1440}]
