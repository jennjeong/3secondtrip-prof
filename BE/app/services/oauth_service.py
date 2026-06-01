"""OAuth 헬퍼 — Google / Kakao / Apple."""
import time
import secrets as pysecrets
from typing import Any
from urllib.parse import urlencode

import httpx
from jose import jwt as jose_jwt

from app.core.config import settings


# ---------- 공통: state 생성 ----------
def make_state() -> str:
    return pysecrets.token_urlsafe(24)




# ── Helper: combine year + day into a date (Kakao/Naver give them separately) ──
def _to_birth_date(year, month_day):
    """year: '1995', month_day: 'MMDD' or 'MM-DD' → datetime.date or None."""
    if not year or not month_day:
        return None
    try:
        y = int(str(year)[:4])
        md = str(month_day).replace("-", "").replace("/", "").strip()
        if len(md) < 4:
            return None
        from datetime import date
        return date(y, int(md[:2]), int(md[2:4]))
    except (ValueError, TypeError):
        return None


# ============ GOOGLE ============
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"


def google_authorize_url(state: str) -> str:
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH}?{urlencode(params)}"


async def google_exchange_code(code: str) -> dict:
    data = {
        "code": code,
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "redirect_uri": settings.google_redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(GOOGLE_TOKEN, data=data)
        r.raise_for_status()
        return r.json()


async def google_fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
        r.raise_for_status()
        return r.json()


def google_map_user(profile: dict) -> dict:
    """Google OpenID userinfo → 통합 User 필드.

    Google 은 phone·birthday 를 안 줌 — name+email+사진만 받아옴.
    name(실명) 과 nickname(표시명) 을 분리해서 저장.
    """
    full_name = profile.get("name")
    nickname = profile.get("given_name") or full_name
    if not nickname and profile.get("email"):
        nickname = profile["email"].split("@", 1)[0]
    return {
        "provider": "google",
        "provider_user_id": str(profile.get("sub", "")),
        "email": profile.get("email"),
        "nickname": nickname,
        "name": full_name,                        # 실명 → DB 암호화 저장
        "profile_image_url": profile.get("picture"),
    }


# ============ KAKAO ============
KAKAO_AUTH = "https://kauth.kakao.com/oauth/authorize"
KAKAO_TOKEN = "https://kauth.kakao.com/oauth/token"
KAKAO_USERINFO = "https://kapi.kakao.com/v2/user/me"


def kakao_authorize_url(state: str) -> str:
    params = {
        "client_id": settings.kakao_client_id,
        "redirect_uri": settings.kakao_redirect_uri,
        "response_type": "code",
        "state": state,
    }
    return f"{KAKAO_AUTH}?{urlencode(params)}"


async def kakao_exchange_code(code: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.kakao_client_id,
        "client_secret": settings.kakao_client_secret or "",
        "redirect_uri": settings.kakao_redirect_uri,
        "code": code,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(KAKAO_TOKEN, data=data)
        r.raise_for_status()
        return r.json()


async def kakao_fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(KAKAO_USERINFO, headers={"Authorization": f"Bearer {access_token}"})
        r.raise_for_status()
        return r.json()


def kakao_map_user(profile: dict) -> dict:
    """Kakao 응답 → 통합 User 필드.

    Kakao 가 동의항목별로 따로 묶여서 옴:
      properties.nickname / profile_image
      kakao_account.email / name / phone_number / birthday(MMDD) / birthyear(YYYY)
    """
    props = profile.get("properties") or {}
    acct  = profile.get("kakao_account") or {}
    return {
        "provider": "kakao",
        "provider_user_id": str(profile.get("id") or ""),
        "email": acct.get("email"),
        "nickname": props.get("nickname") or acct.get("profile", {}).get("nickname"),
        "name": acct.get("name"),                                       # 실명 (동의 필요)
        "phone": acct.get("phone_number"),                              # 전화번호 (동의 필요)
        "birth_date": _to_birth_date(acct.get("birthyear"),
                                     acct.get("birthday")),             # 생년월일
        "profile_image_url": (props.get("profile_image")
                              or acct.get("profile", {}).get("profile_image_url")),
    }

# ============ APPLE ============
APPLE_AUTH = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN = "https://appleid.apple.com/auth/token"
APPLE_KEYS = "https://appleid.apple.com/auth/keys"


def apple_authorize_url(state: str) -> str:
    params = {
        "client_id": settings.apple_client_id,
        "redirect_uri": settings.apple_redirect_uri,
        "response_type": "code",
        "scope": "name email",
        "response_mode": "form_post",
        "state": state,
    }
    return f"{APPLE_AUTH}?{urlencode(params)}"


def _build_apple_client_secret() -> str:
    """Apple client_secret 은 자체 서명한 JWT — Team ID + Key ID + Client ID + .p8 필요."""
    if not all([settings.apple_team_id, settings.apple_key_id, settings.apple_client_id, settings.apple_private_key_path]):
        raise RuntimeError("Apple OAuth not configured (team/key id / client id / private key path)")
    with open(settings.apple_private_key_path, "r") as f:
        private_key = f.read()
    now = int(time.time())
    headers = {"kid": settings.apple_key_id, "alg": "ES256"}
    payload = {
        "iss": settings.apple_team_id,
        "iat": now,
        "exp": now + 60 * 60 * 24 * 180,   # 6개월 (Apple 최대)
        "aud": "https://appleid.apple.com",
        "sub": settings.apple_client_id,
    }
    return jose_jwt.encode(payload, private_key, algorithm="ES256", headers=headers)


async def apple_exchange_code(code: str) -> dict:
    client_secret = _build_apple_client_secret()
    data = {
        "client_id": settings.apple_client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": settings.apple_redirect_uri,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(APPLE_TOKEN, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        r.raise_for_status()
        return r.json()


APPLE_ISSUER = "https://appleid.apple.com"

# JWKS 캐시 (프로세스 메모리, TTL 1시간)
_apple_jwks_cache: dict | None = None
_apple_jwks_fetched_at: float = 0.0
_APPLE_JWKS_TTL = 3600


async def _fetch_apple_jwks() -> dict:
    """Apple 공개키 세트 fetch + 캐시."""
    global _apple_jwks_cache, _apple_jwks_fetched_at
    now = time.time()
    if _apple_jwks_cache and (now - _apple_jwks_fetched_at) < _APPLE_JWKS_TTL:
        return _apple_jwks_cache
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(APPLE_KEYS)
        r.raise_for_status()
        _apple_jwks_cache = r.json()
        _apple_jwks_fetched_at = now
    return _apple_jwks_cache


def _select_apple_jwk(jwks: dict, kid: str) -> dict:
    keys = (jwks or {}).get("keys") or []
    for k in keys:
        if k.get("kid") == kid:
            return k
    raise ValueError(f"Apple JWK not found for kid={kid}")


async def apple_validate_id_token(id_token: str) -> dict:
    """
    Apple id_token 서명 검증 + 클레임 검증.
      - 서명: Apple JWKS (RS256)
      - issuer: https://appleid.apple.com
      - audience: APPLE_CLIENT_ID
      - expiration: 라이브러리 자동 검증
      - sub: 존재해야 함 (없으면 ValueError)
    검증 실패 시 jose JWTError 또는 ValueError 발생.
    """
    if not settings.apple_client_id:
        raise RuntimeError("APPLE_CLIENT_ID not set — cannot verify audience")

    # 1) header 에서 kid 만 unverified 로 읽음 (key 선택 목적; 검증은 아래에서 별도)
    headers = jose_jwt.get_unverified_header(id_token)
    kid = headers.get("kid")
    if not kid:
        raise ValueError("Apple id_token has no kid")

    # 2) JWKS fetch + kid 매칭
    jwks = await _fetch_apple_jwks()
    jwk_dict = _select_apple_jwk(jwks, kid)

    # 3) 서명 + iss + aud + exp 검증
    claims = jose_jwt.decode(
        id_token,
        jwk_dict,
        algorithms=["RS256"],
        audience=settings.apple_client_id,
        issuer=APPLE_ISSUER,
        options={"verify_signature": True, "verify_aud": True, "verify_iss": True, "verify_exp": True},
    )

    # 4) sub 강제
    if not claims.get("sub"):
        raise ValueError("Apple id_token has no sub")

    return claims


def apple_map_user(claims: dict, user_payload: dict | None = None) -> dict:
    """Apple id_token 클레임 → 통합 User 필드.

    Apple 은 최초 로그인 때만 user_payload 에 name 을 보내고, 그 후엔
    sub + email 만 보냄.  name 은 그래서 첫 가입 시점에 꼭 저장해야 함.
    """
    email = claims.get("email")
    name  = None
    nickname = None
    if user_payload and isinstance(user_payload, dict):
        np = user_payload.get("name") or {}
        first = (np.get("firstName") or "").strip()
        last  = (np.get("lastName") or "").strip()
        if first or last:
            name = (first + " " + last).strip()
            nickname = first or last
    if not nickname and email:
        nickname = email.split("@", 1)[0]
    return {
        "provider": "apple",
        "provider_user_id": str(claims.get("sub", "")),
        "email": email,
        "nickname": nickname,
        "name": name,                              # 첫 로그인 때만 채워짐
        "profile_image_url": None,
    }

# ============ NAVER ============
NAVER_AUTH = "https://nid.naver.com/oauth2.0/authorize"
NAVER_TOKEN = "https://nid.naver.com/oauth2.0/token"
NAVER_USERINFO = "https://openapi.naver.com/v1/nid/me"


def naver_authorize_url(state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.naver_client_id,
        "redirect_uri": settings.naver_redirect_uri,
        "state": state,
    }
    return f"{NAVER_AUTH}?{urlencode(params)}"


async def naver_exchange_code(code: str, state: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.naver_client_id,
        "client_secret": settings.naver_client_secret,
        "code": code,
        "state": state,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(NAVER_TOKEN, data=data)
        r.raise_for_status()
        return r.json()


async def naver_fetch_userinfo(access_token: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(NAVER_USERINFO, headers=headers)
        r.raise_for_status()
        return r.json()


def naver_map_user(profile: dict) -> dict:
    """Naver 응답 → 통합 User 필드.

    response 안에: id / email / name / nickname / profile_image /
                   gender / age / birthday(MM-DD) / birthyear / mobile
    name·phone·birth_date 는 동의 항목에 따라 None 일 수 있음.
    """
    resp = profile.get("response") or {}
    return {
        "provider": "naver",
        "provider_user_id": str(resp.get("id") or ""),
        "email": resp.get("email"),
        "nickname": resp.get("nickname") or resp.get("name"),
        "name": resp.get("name"),                                   # 실명 → DB 암호화
        "phone": resp.get("mobile"),                                # 휴대폰 → DB 암호화
        "birth_date": _to_birth_date(resp.get("birthyear"),
                                     resp.get("birthday")),         # 생년월일 → DB 암호화
        "profile_image_url": resp.get("profile_image"),
    }
