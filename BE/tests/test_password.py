"""bcrypt 해싱 — passlib→bcrypt 전환 회귀 방지."""
from app.core.password import hash_password, verify_password


def test_hash_and_verify_roundtrip():
    h = hash_password("abc12345")
    assert h and h != "abc12345"
    assert verify_password("abc12345", h) is True


def test_verify_rejects_wrong_password():
    h = hash_password("abc12345")
    assert verify_password("wrongpass1", h) is False


def test_hash_is_salted_unique():
    # 같은 비밀번호라도 매번 다른 해시(솔트)여야 한다.
    assert hash_password("abc12345") != hash_password("abc12345")


def test_long_password_over_72_bytes_does_not_crash():
    # bcrypt 72바이트 한계 — 잘라서 처리하므로 예외 없이 동작해야 한다.
    pw = "a" * 200
    h = hash_password(pw)
    assert verify_password(pw, h) is True


def test_empty_inputs():
    assert verify_password("", "x") is False
    assert verify_password("x", "") is False
