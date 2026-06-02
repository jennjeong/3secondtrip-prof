"""JWT 발급/검증."""
import pytest
from fastapi import HTTPException

from app.core.security import create_access_token, decode_access_token


def test_create_and_decode_roundtrip():
    token = create_access_token(user_id=123)
    claims = decode_access_token(token)
    assert claims["sub"] == "123"
    assert "exp" in claims


def test_custom_data_claims():
    token = create_access_token(data={"sub": "9", "scope": "admin"})
    claims = decode_access_token(token)
    assert claims["sub"] == "9" and claims["scope"] == "admin"


def test_invalid_token_raises_401():
    with pytest.raises(HTTPException) as ei:
        decode_access_token("not.a.jwt")
    assert ei.value.status_code == 401


def test_tampered_token_rejected():
    token = create_access_token(user_id=1)
    with pytest.raises(HTTPException):
        decode_access_token(token + "tamper")
