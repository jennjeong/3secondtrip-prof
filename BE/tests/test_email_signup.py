"""이메일 가입 → 이메일 인증 → 로그인. 비밀번호 정책은 서버 한 곳에서 강제한다."""
import uuid

from app.core.password import hash_password, verify_password
from app.core.security import create_access_token
from app.db.database import SessionLocal
from app.models.user import User

AGREE = {"agree_terms": True, "agree_privacy": True, "agree_age": True}


def _new(tag="s"):
    s = uuid.uuid4().hex[:8]
    return f"{tag}_{s}@example.com", f"{tag}{s}"


def _signup(client, email, nick, pw="Trip-pass-2026", **extra):
    return client.post("/users/signup", json={"email": email, "password": pw, "nickname": nick, **AGREE, **extra})


def test_signup_needs_email_verification_before_login(client):
    email, nick = _new()
    r = _signup(client, email, nick)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "verification_required" and "access_token" not in body
    assert body["dev_code"] and len(body["dev_code"]) == 6          # 개발 환경에서만 실린다
    r = client.post("/users/login", json={"email": email, "password": "Trip-pass-2026"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
    r = client.post("/users/verify-email", json={"email": email, "code": body["dev_code"]})
    assert r.status_code == 200 and r.json()["access_token"]
    assert r.json()["user"]["email_verified_at"]
    assert client.post("/users/login", json={"email": email, "password": "Trip-pass-2026"}).status_code == 200


def test_consent_is_required_and_recorded(client):
    email, nick = _new("c")
    r = client.post("/users/signup", json={"email": email, "password": "Trip-pass-2026", "nickname": nick,
                                           "agree_terms": True, "agree_privacy": False, "agree_age": True})
    assert r.status_code == 422
    assert _signup(client, email, nick).status_code == 202
    db = SessionLocal()
    u = db.query(User).filter(User.email == email).one()
    assert u.terms_version and u.privacy_version and u.agreed_at and u.email_verified_at is None
    db.close()


def test_repeat_signup_keeps_one_account_and_respects_resend_wait(client):
    email, nick = _new("r")
    first = _signup(client, email, nick).json()
    again = _signup(client, email, nick, pw="Other-pass-2026")
    assert again.status_code == 202 and again.json()["dev_code"] is None and again.json()["resend_after"] > 0
    db = SessionLocal()
    assert db.query(User).filter(User.email_normalized == email.lower()).count() == 1
    db.close()
    # 처음 코드로 인증 → 마지막으로 보낸 비밀번호가 쓰인다
    assert client.post("/users/verify-email", json={"email": email, "code": first["dev_code"]}).status_code == 200
    assert client.post("/users/login", json={"email": email, "password": "Other-pass-2026"}).status_code == 200
    # 인증된 이메일로는 다시 가입할 수 없다
    assert _signup(client, email, nick + "x").status_code == 409


def test_wrong_code_locks_after_five_and_resend_recovers(client):
    email, nick = _new("w")
    _signup(client, email, nick)
    codes = [client.post("/users/verify-email", json={"email": email, "code": "000000"}).json()["detail"]["code"] for _ in range(5)]
    assert codes[-1] == "locked"
    r = client.post("/users/verify-email/resend", json={"email": email})
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_soon"
    db = SessionLocal()                     # 60초가 지난 것으로 — 마지막 발송 시각을 당긴다
    from datetime import timedelta
    from app.models.email_verification import EmailVerification
    row = db.query(EmailVerification).order_by(EmailVerification.id.desc()).first()
    row.created_at = row.created_at - timedelta(seconds=120); db.commit(); db.close()
    r = client.post("/users/verify-email/resend", json={"email": email})
    assert r.status_code == 202 and r.json()["dev_code"]
    assert client.post("/users/verify-email", json={"email": email, "code": r.json()["dev_code"]}).status_code == 200


def test_resend_does_not_reveal_unknown_email(client):
    r = client.post("/users/verify-email/resend", json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com"})
    assert r.status_code == 202


def test_link_token_verifies_once(client):
    from app.services import email_verification_service as ev
    email, nick = _new("l")
    _signup(client, email, nick)
    db = SessionLocal()
    u = db.query(User).filter(User.email == email).one()
    import secrets
    from app.models.email_verification import EmailVerification
    link = secrets.token_urlsafe(32)
    row = db.query(EmailVerification).filter(EmailVerification.user_id == u.id).order_by(EmailVerification.id.desc()).first()
    row.link_hash = ev._hash(link); db.commit(); db.close()
    assert client.post("/users/verify-email", json={"token": link}).status_code == 200
    r = client.post("/users/verify-email", json={"token": link})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_verified"
    assert client.post("/users/verify-email", json={"token": "x" * 40}).status_code == 400


def test_unverified_account_cannot_use_member_api(client):
    email, nick = _new("u")
    _signup(client, email, nick)
    db = SessionLocal()
    u = db.query(User).filter(User.email == email).one()
    token = create_access_token(user_id=u.id, token_version=u.token_version or 0)
    db.close()
    r = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403 and r.json()["detail"] == "email_unverified"


def test_password_policy(client):
    email, nick = _new("p")
    bad = {"short1a": 422, "abcdefghij": 422, "password123": 422, "aaaaaaaaaaaa1": 422, "x" * 129: 422}
    for pw, code in bad.items():
        assert _signup(client, email, nick, pw=pw).status_code == code, pw
    # 15자 이상 문장형은 숫자 없이도 된다 · 앞뒤 공백도 그대로 비밀번호다
    phrase = "  our little trip to the sea  "
    r = _signup(client, email, nick, pw=phrase)
    assert r.status_code == 202
    client.post("/users/verify-email", json={"email": email, "code": r.json()["dev_code"]})
    assert client.post("/users/login", json={"email": email, "password": phrase}).status_code == 200
    assert client.post("/users/login", json={"email": email, "password": phrase.strip()}).status_code == 401
    info = client.get("/users/password-policy").json()
    assert info["min"] == 8 and info["max"] == 128 and info["passphrase"] == 15


def test_long_passwords_are_not_truncated():
    a = "가" * 30 + "끝A1"            # 72바이트를 넘긴다(한글 3바이트)
    b = "가" * 30 + "끝B1"
    h = hash_password(a)
    assert h.startswith("v2$") and verify_password(a, h) and not verify_password(b, h)


def test_legacy_hash_still_logs_in_and_is_upgraded(client):
    import bcrypt
    email, nick = _new("g")
    db = SessionLocal()
    from datetime import datetime
    u = User(provider="local", provider_user_id=email, email=email, email_normalized=email, nickname=nick,
             password_hash=bcrypt.hashpw(b"Legacy-pass-1", bcrypt.gensalt()).decode(), email_verified_at=datetime.utcnow())
    db.add(u); db.commit(); uid = u.id; db.close()
    assert client.post("/users/login", json={"email": email, "password": "Legacy-pass-1"}).status_code == 200
    db = SessionLocal()
    assert db.get(User, uid).password_hash.startswith("v2$")
    db.close()


def test_stale_unverified_signups_are_purged(client):
    from datetime import datetime, timedelta
    email, nick = _new("o")
    _signup(client, email, nick)
    db = SessionLocal()
    u = db.query(User).filter(User.email == email).one()
    u.created_at = datetime.utcnow() - timedelta(days=8); db.commit(); db.close()
    _signup(client, *_new("o2"))                 # 다음 가입 요청 때 지워진다
    db = SessionLocal()
    assert db.query(User).filter(User.email == email).count() == 0
    db.close()


def test_provider_rejection_is_reported_and_can_be_retried_at_once(client, monkeypatch):
    """운영처럼 메일이 설정됐지만 제공자가 거절하면: 이유를 알려 주고, 60초를 기다리지 않고 다시 보낼 수 있다."""
    from app.services import mail_service
    calls = []
    monkeypatch.setattr(mail_service, "configured", lambda: True)
    monkeypatch.setattr(mail_service, "is_dev", lambda: False)
    monkeypatch.setattr(mail_service, "send_detailed", lambda *a, **k: calls.append(1) or "rejected")
    email, nick = _new("f")
    r = _signup(client, email, nick)
    assert r.status_code == 202 and r.json()["sent"] is False
    assert r.json()["send_error"] == "rejected" and r.json()["dev_code"] is None and r.json()["resend_after"] == 0
    r = client.post("/users/verify-email/resend", json={"email": email})
    assert r.status_code == 202 and r.json()["send_error"] == "rejected" and r.json()["resend_after"] == 0
    # 제공자가 다시 받아 주면 정상 발송, 그 뒤엔 60초 대기
    monkeypatch.setattr(mail_service, "send_detailed", lambda *a, **k: "")
    r = client.post("/users/verify-email/resend", json={"email": email})
    assert r.status_code == 202 and r.json()["sent"] is True and r.json()["resend_after"] > 0
    assert client.post("/users/verify-email/resend", json={"email": email}).status_code == 429
    assert len(calls) == 2


def test_mail_send_reasons(monkeypatch):
    from app.services import mail_service
    from app.core.config import settings
    monkeypatch.setattr(settings, "resend_api_key", "")
    assert mail_service.send_detailed("a@example.com", "s", "t") == "not_configured"
    monkeypatch.setattr(settings, "resend_api_key", "k"); monkeypatch.setattr(settings, "mail_from", "x <a@b.c>")

    class R:
        def __init__(self, code): self.status_code = code
    monkeypatch.setattr(mail_service.httpx, "post", lambda *a, **k: R(403))
    assert mail_service.send_detailed("a@example.com", "s", "t") == "rejected"
    def boom(*a, **k): raise TimeoutError()
    monkeypatch.setattr(mail_service.httpx, "post", boom)
    assert mail_service.send_detailed("a@example.com", "s", "t") == "network"
    monkeypatch.setattr(mail_service.httpx, "post", lambda *a, **k: R(200))
    assert mail_service.send_detailed("a@example.com", "s", "t") == ""


def test_features_shows_mail_status_without_secrets(client):
    f = client.get("/api/features").json()
    assert set(f["email"]) == {"configured", "link_base"} and f["email"]["link_base"].startswith("http")


def test_expired_code_is_refused_and_resend_recovers(client):
    from datetime import datetime, timedelta
    from app.models.email_verification import EmailVerification
    email, nick = _new("x")
    code = _signup(client, email, nick).json()["dev_code"]
    db = SessionLocal()
    u = db.query(User).filter(User.email == email).one()
    row = db.query(EmailVerification).filter(EmailVerification.user_id == u.id).order_by(EmailVerification.id.desc()).first()
    row.expires_at = datetime.utcnow() - timedelta(seconds=1)
    row.created_at = datetime.utcnow() - timedelta(minutes=16)
    db.commit(); db.close()
    r = client.post("/users/verify-email", json={"email": email, "code": code})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "expired"
    new = client.post("/users/verify-email/resend", json={"email": email}).json()["dev_code"]
    assert client.post("/users/verify-email", json={"email": email, "code": new}).status_code == 200
