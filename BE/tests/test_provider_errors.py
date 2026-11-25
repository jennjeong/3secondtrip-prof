"""외부 제공처 실패·지연을 모의로 재현한다(실제 호출 없음)."""
import httpx
import pytest

from app.core.config import settings
from app.services import google_maps_service, serpapi_flights_service, serpapi_service

FLIGHT = {"departure_id": "ICN", "arrival_id": "NRT", "outbound_date": "2027-03-01", "return_date": "2027-03-03"}
HOTEL = {"query": "도쿄", "check_in_date": "2027-03-01", "check_out_date": "2027-03-03"}
PLACE = {"query": "도쿄 맛집"}
CASES = [("/api/flights/search", FLIGHT, "google_flights"), ("/api/hotels/search", HOTEL, "google_hotels"), ("/api/places/search", PLACE, "google_places")]


@pytest.fixture()
def keys(monkeypatch):
    monkeypatch.setattr(settings, "serpapi_api_key", "test-key")
    monkeypatch.setattr(settings, "google_maps_server_key", "test-key")


def fake(monkeypatch, handler):
    real = httpx.AsyncClient

    def make(*a, **k):
        k["transport"] = httpx.MockTransport(handler)
        return real(*a, **k)
    for m in (serpapi_flights_service, serpapi_service, google_maps_service):
        monkeypatch.setattr(m.httpx, "AsyncClient", make)


def boom(exc):
    def h(request):
        raise exc("x", request=request)
    return h


@pytest.mark.parametrize("path,body,name", CASES)
def test_timeout_is_retryable(client, keys, monkeypatch, path, body, name):
    fake(monkeypatch, boom(httpx.ReadTimeout))
    r = client.post(path, json=body)
    assert r.status_code == 504
    d = r.json()["detail"]
    assert d["code"] == "timeout" and d["retryable"] is True and d["provider"] == name


@pytest.mark.parametrize("path,body,name", CASES)
def test_network_error(client, keys, monkeypatch, path, body, name):
    fake(monkeypatch, boom(httpx.ConnectError))
    r = client.post(path, json=body)
    assert r.status_code == 502 and r.json()["detail"]["code"] == "network"


@pytest.mark.parametrize("path,body,name", CASES)
@pytest.mark.parametrize("status,code,retryable", [(429, "quota", True), (500, "upstream", True), (403, "unconfigured", False), (400, "rejected", False)])
def test_upstream_status(client, keys, monkeypatch, path, body, name, status, code, retryable):
    fake(monkeypatch, lambda req: httpx.Response(status, json={"error": {"message": "secret upstream text"}}))
    r = client.post(path, json=body)
    d = r.json()["detail"]
    assert d["code"] == code and d["retryable"] is retryable
    assert "secret" not in r.text          # 제공처 원문은 사용자에게 보내지 않는다


@pytest.mark.parametrize("path,body,name", CASES)
def test_not_configured(client, monkeypatch, path, body, name):
    monkeypatch.setattr(settings, "serpapi_api_key", "")
    monkeypatch.setattr(settings, "google_maps_server_key", "")
    r = client.post(path, json=body)
    assert r.status_code == 503 and r.json()["detail"] == {"code": "unconfigured", "provider": name, "message": r.json()["detail"]["message"], "retryable": False}


def test_flight_times_and_meta(client, keys, monkeypatch):
    payload = {"best_flights": [{"price": 412300, "total_duration": 260, "flights": [
        {"airline": "A", "flight_number": "A 1", "departure_airport": {"time": "2027-03-01 22:30"}, "arrival_airport": {"time": "2027-03-01 23:40"}},
        {"airline": "A", "flight_number": "A 2", "departure_airport": {"time": "2027-03-02 00:30"}, "arrival_airport": {"time": "2027-03-02 02:50"}}]}]}
    fake(monkeypatch, lambda req: httpx.Response(200, json=payload))
    j = client.post("/api/flights/search", json=FLIGHT).json()
    assert j["lowest_price"] == 412300
    assert j["cheapest"]["departure_time"] == "2027-03-01 22:30" and j["cheapest"]["arrival_time"] == "2027-03-02 02:50"
    assert j["cheapest"]["stops"] == 1 and j["meta"]["status"] == "live" and j["meta"]["latency_ms"] >= 0


def test_no_result_is_not_retryable(client, keys, monkeypatch):
    fake(monkeypatch, lambda req: httpx.Response(200, json={"error": "Google hasn't returned any results"}))
    r = client.post("/api/flights/search", json=FLIGHT)
    assert r.status_code == 404 and r.json()["detail"]["code"] == "no_result"


def test_places_empty_meta(client, keys, monkeypatch):
    fake(monkeypatch, lambda req: httpx.Response(200, json={}))
    j = client.post("/api/places/search", json=PLACE).json()
    assert j["places"] == [] and j["meta"]["status"] == "empty"
