"""비밀번호 해싱 — bcrypt 직접 사용.  평문은 절대 저장/로그 금지.

passlib(1.7.4, 2020년 이후 미관리)는 bcrypt 4.1+ 와 호환되지 않으므로 bcrypt 라이브러리를 직접 쓴다.

bcrypt 는 입력의 첫 72바이트만 쓴다.  긴 문장형 비밀번호가 조용히 잘리지 않도록
새 해시는 비밀번호 전체를 SHA-256 → base64(44바이트)로 줄인 뒤 bcrypt 에 넣는다("v2$" 접두어).
접두어가 없는 예전 해시는 예전 방식(앞 72바이트)으로 확인하고, 로그인에 성공하면 새 방식으로 바꿔 둔다.
"""
import base64
import hashlib

import bcrypt

_V2 = "v2$"
_LEGACY_MAX_BYTES = 72


def _v2_input(password: str) -> bytes:
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def _legacy_input(password: str) -> bytes:
    return password.encode("utf-8")[:_LEGACY_MAX_BYTES]


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("password is required")
    return _V2 + bcrypt.hashpw(_v2_input(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        if password_hash.startswith(_V2):
            return bcrypt.checkpw(_v2_input(password), password_hash[len(_V2):].encode("utf-8"))
        return bcrypt.checkpw(_legacy_input(password), password_hash.encode("utf-8"))
    except Exception:
        return False


def needs_rehash(password_hash: str) -> bool:
    return bool(password_hash) and not password_hash.startswith(_V2)
