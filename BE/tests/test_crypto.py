"""Fernet PII 암호화 라운드트립 + 평문 호환."""
from app.core.crypto import encrypt_str, decrypt_str, is_encrypted


def test_encrypt_decrypt_roundtrip():
    plain = "홍길동 010-1234-5678"
    enc = encrypt_str(plain)
    assert enc != plain
    assert is_encrypted(enc)
    assert decrypt_str(enc) == plain


def test_none_and_empty_passthrough():
    assert encrypt_str(None) is None
    assert encrypt_str("") == ""
    assert decrypt_str(None) is None
    assert decrypt_str("") == ""


def test_legacy_plaintext_row_returns_as_is():
    # 암호화되지 않은 기존 행은 그대로 반환되어야 한다(마이그레이션 호환).
    assert decrypt_str("그냥평문이름") == "그냥평문이름"


def test_ciphertext_is_not_human_readable():
    enc = encrypt_str("secret@example.com")
    assert "secret" not in enc
