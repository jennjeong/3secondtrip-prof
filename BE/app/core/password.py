"""비밀번호 해싱 — bcrypt.  평문은 절대 저장/로그 금지."""
from passlib.context import CryptContext

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password is required")
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        return _pwd.verify(password, password_hash)
    except Exception:
        return False
