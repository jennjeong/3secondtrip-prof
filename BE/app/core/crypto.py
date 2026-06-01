"""Symmetric encryption for sensitive user PII columns.

Algorithm: Fernet (AES-128 in CBC mode + HMAC-SHA256, urlsafe-base64 ciphertext).
The DB_ENCRYPTION_KEY lives in backend/.env only — NEVER commit.

If the key is missing or invalid, encrypt/decrypt become no-ops (graceful
degrade) and a warning is logged at startup.  This way the app keeps
running even without a key, but the columns aren\'t protected.

Existing plaintext rows in the DB stay readable — decrypt() detects
non-Fernet input and returns it as-is.
"""
import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

logger = logging.getLogger("crypto")

_fernet: Optional[Fernet] = None


def _init() -> Optional[Fernet]:
    global _fernet
    key = (settings.db_encryption_key or "").strip()
    if not key:
        logger.warning("DB_ENCRYPTION_KEY not set — PII columns stored in plaintext")
        return None
    try:
        _fernet = Fernet(key.encode("ascii"))
        logger.info("PII encryption ENABLED")
    except Exception as e:
        logger.error("DB_ENCRYPTION_KEY invalid (%s) — encryption disabled", e)
        _fernet = None
    return _fernet


_init()


def encrypt_str(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt a string for at-rest storage.  Returns plaintext if no key."""
    if plaintext is None or plaintext == "":
        return plaintext
    if _fernet is None:
        return plaintext
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_str(ciphertext: Optional[str]) -> Optional[str]:
    """Decrypt a Fernet token.  Returns input unchanged for plaintext rows."""
    if ciphertext is None or ciphertext == "":
        return ciphertext
    if _fernet is None:
        return ciphertext
    try:
        return _fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeDecodeError):
        # Legacy plaintext rows — not encrypted yet.  Return as-is.
        return ciphertext
    except Exception:
        return ciphertext


def is_encrypted(value: Optional[str]) -> bool:
    """Quick predicate — does this string look like a Fernet token?"""
    return isinstance(value, str) and value.startswith("gAAAAA")


def generate_key() -> str:
    """Generate a new Fernet key (32 url-safe base64-encoded bytes)."""
    return Fernet.generate_key().decode("ascii")
