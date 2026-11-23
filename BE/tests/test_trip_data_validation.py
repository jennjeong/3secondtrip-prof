"""저장 일정 검사 — 불가능한 값은 거절, 예전 형식은 그대로 저장."""
import uuid

import pytest

from app.schemas.trip_data_validation import validate_trip_data


def _day(date="2026-12-07", cost=10000, n=1):
    return {"date": date, "localTransport": 12000, "activities": [{"name": "x", "time": "10:00", "cost": cost}] * n}


def _trip(**kw):
    t = {"city": "도쿄", "startDate": "2026-12-07", "endDate": "2026-12-09", "budget": 200000, "people": 1,
         "days": [_day("2026-12-07"), _day("2026-12-08"), _day("2026-12-09")]}
    t.update(kw)
    return t


def test_valid_trip_passes():
    validate_trip_data(_trip())


def test_old_trip_without_new_fields_passes():
    validate_trip_data({"city": "도쿄", "days": [{"date": "2025-06-01", "activities": [{"name": "a", "cost": 5000}]}]})


@pytest.mark.parametrize("cost", [None, 0, 1, 999_999_999])
def test_cost_null_zero_and_large_allowed(cost):
    validate_trip_data(_trip(days=[_day(cost=cost)]))


@pytest.mark.parametrize("cost", [-1, "1000", True, 2_000_000_000])
def test_bad_costs_rejected(cost):
    with pytest.raises(ValueError):
        validate_trip_data(_trip(days=[_day(cost=cost)]))


@pytest.mark.parametrize("kw", [
    {"budget": -5}, {"people": 0}, {"people": 61}, {"people": 1.5},
    {"startDate": "2026-13-40"}, {"endDate": "2026-12-01"},
    {"days": []}, {"days": [_day()] * 32},
    {"budgetPlan": {"rooms": 0}}, {"budgetPlan": {"rooms": 31}},
])
def test_impossible_values_rejected(kw):
    with pytest.raises(ValueError):
        validate_trip_data(_trip(**kw))


def test_budget_none_means_not_entered():
    validate_trip_data(_trip(budget=None))
    validate_trip_data(_trip(budget=0))


def test_too_many_activities_rejected():
    with pytest.raises(ValueError):
        validate_trip_data(_trip(days=[_day(n=61)]))


def _signup(client):
    s = uuid.uuid4().hex[:8]
    r = client.post("/users/signup", json={"email": f"v_{s}@example.com", "password": "abc12345", "nickname": f"v_{s}"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_schedule_api_rejects_negative_cost(client):
    h = _signup(client)
    r = client.post("/schedules", json={"title": "t", "schedule_data": _trip(days=[_day(cost=-100)])}, headers=h)
    assert r.status_code == 422


def test_schedule_api_accepts_unknown_cost(client):
    h = _signup(client)
    r = client.post("/schedules", json={"title": "t", "schedule_data": _trip(days=[_day(cost=None)])}, headers=h)
    assert r.status_code in (200, 201), r.text


def test_schedule_update_validates_too(client):
    h = _signup(client)
    r = client.post("/schedules", json={"title": "t", "schedule_data": _trip()}, headers=h)
    sid = r.json()["id"]
    r = client.patch(f"/schedules/{sid}", json={"schedule_data": _trip(people=0)}, headers=h)
    assert r.status_code == 422
