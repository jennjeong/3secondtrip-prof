from app.core.config import settings


def test_features_reports_configuration_without_secrets(client, monkeypatch):
    monkeypatch.setattr(settings, "serpapi_api_key", "")
    monkeypatch.setattr(settings, "openai_api_key", "secret-value")
    r = client.get("/api/features")
    assert r.status_code == 200
    body = r.json()
    assert body["live_flights"] is False and body["live_hotels"] is False
    assert body["ai_summary"] is True
    assert "secret-value" not in r.text


def test_ai_summary_without_key_is_service_unavailable(client, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    r = client.post("/openai/chat", json={"prompt": "hi"})
    assert r.status_code == 503
