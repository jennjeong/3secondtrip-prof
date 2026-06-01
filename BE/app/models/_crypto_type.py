"""SQLAlchemy TypeDecorators for transparent at-rest PII encryption."""
from datetime import date
from typing import Optional

from sqlalchemy.types import String, TypeDecorator

from app.core.crypto import encrypt_str, decrypt_str


class EncryptedString(TypeDecorator):
    """A String column whose value is Fernet-encrypted in the database.

    On write : plaintext → Fernet ciphertext
    On read  : ciphertext → plaintext  (legacy plaintext rows return as-is)

    Use a generous length: Fernet ciphertext is ~57+ chars per input char,
    base64-encoded.  255 is enough for typical names/phones; for free-text
    fields use 1024 or Text.
    """
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_str(value)

    def process_result_value(self, value, dialect):
        return decrypt_str(value)


class EncryptedDate(TypeDecorator):
    """A Date column stored as an encrypted ISO-8601 string.

    The Python attribute on the model remains a datetime.date so callers
    don\'t need to change.  Pydantic schemas with `date` fields keep working.
    """
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None or value == "":
            return None
        if isinstance(value, date):
            return encrypt_str(value.isoformat())
        if isinstance(value, str):
            return encrypt_str(value)
        return encrypt_str(str(value))

    def process_result_value(self, value, dialect):
        if value is None or value == "":
            return None
        plain = decrypt_str(value)
        if not plain:
            return None
        try:
            return date.fromisoformat(plain[:10])
        except (ValueError, TypeError):
            return None
