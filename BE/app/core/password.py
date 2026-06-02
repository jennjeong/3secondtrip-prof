"""비밀번호 해싱 — bcrypt 직접 사용.  평문은 절대 저장/로그 금지.

passlib(1.7.4, 2020년 이후 미관리)는 bcrypt 4.1+ 와 호환되지 않으므로
(bcrypt.__about__ 제거 + 72바이트 처리 변경) bcrypt 라이브러리를 직접 쓴다.
"""
import bcrypt

# bcrypt 는 입력의 첫 72바이트만 사용한다.  더 긴 비밀번호는 잘라서
# 일관되게 처리한다(과거 passlib 동작과 동일 — 기존 해시 호환 유지).
_MAX_BYTES = 72


def _to_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_MAX_BYTES]


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password is required")
    return bcrypt.hashpw(_to_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        return bcrypt.checkpw(_to_bytes(password), password_hash.encode("utf-8"))
    except Exception:
        return False
