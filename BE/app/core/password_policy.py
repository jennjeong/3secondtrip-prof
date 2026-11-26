"""비밀번호 정책 — 가입·재설정·변경이 모두 이 규칙 하나를 쓴다. 화면(FE/js/redesign-auth-rules.js)도 같은 값.

- 길이 8~128자. 앞뒤 공백도 비밀번호의 일부로 그대로 쓴다(자르거나 지우지 않는다).
- 15자 미만이면 영문과 숫자를 모두 넣어야 한다. 15자 이상의 긴 문장형 비밀번호는 글자 종류를 묻지 않는다.
- 너무 흔한 비밀번호는 막는다(아래 목록 + 같은 글자 반복).
"""
import re

MIN_LEN = 8
MAX_LEN = 128
PASSPHRASE_LEN = 15
POLICY_VERSION = "2026-11-27"

# 유출 목록에 늘 오르는 비밀번호(소문자로 비교). 외부 조회 없이 서버 안에서만 확인한다.
COMMON = {
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "qwerty123", "qwer1234",
    "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "abcd1234", "asdf1234", "zxcv1234", "a1234567",
    "qwerty12", "iloveyou1", "letmein1", "welcome1", "admin123", "test1234", "12345678a", "a12345678",
    "q1w2e3r4", "q1w2e3r4t5", "sunshine1", "princess1", "football1", "baseball1", "dragon123", "monkey123",
    "korea1234", "love1234", "hello123", "hello1234", "pass1234", "secret123", "travel123", "trip12345",
}


def check(password: str) -> str | None:
    """정책에 맞으면 None, 아니면 사용자에게 보여 줄 짧은 이유."""
    if not isinstance(password, str) or len(password) < MIN_LEN:
        return f"비밀번호는 {MIN_LEN}자 이상이어야 해요."
    if len(password) > MAX_LEN:
        return f"비밀번호는 {MAX_LEN}자까지 쓸 수 있어요."
    if len(password) < PASSPHRASE_LEN and not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        return f"{PASSPHRASE_LEN}자 미만이면 영문과 숫자를 함께 넣어 주세요."
    low = password.lower()
    if low in COMMON or len(set(password)) <= 2:
        return "너무 흔해서 쉽게 추측되는 비밀번호예요. 다른 비밀번호를 정해 주세요."
    return None


def describe() -> dict:
    return {"min": MIN_LEN, "max": MAX_LEN, "passphrase": PASSPHRASE_LEN, "version": POLICY_VERSION}
