"""Auth 라우터 — Google / Kakao / Apple OAuth + JWT 발급."""
import json
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.db.database import get_db
from app.routers.dependencies import get_current_user
from app.services import oauth_service as oauth
from app.services.user_service import get_or_create_oauth_user
from app.models.user import User

logger = logging.getLogger("auth")
router = APIRouter(prefix="/auth", tags=["auth"])


# state 는 보안상 외부 저장소(redis 등) 권장 — 개인 로컬용은 세션 미들웨어 또는 메모리
# 여기서는 cookie 에 임시로 저장 (HttpOnly, SameSite=Lax)
STATE_COOKIE = "oauth_state"


def _redirect_with_token(token: str) -> RedirectResponse:
    """OAuth 성공 후 프론트로 토큰 전달.
    URL hash fragment(`#token=...`) 사용 — referrer / 서버 로그에 토큰 미노출.
    state cookie 도 함께 삭제 (one-time use).
    """
    resp = RedirectResponse(f"{settings.frontend_origin}{settings.frontend_callback_path}#token={token}", status_code=302)
    resp.delete_cookie(STATE_COOKIE, path="/")
    return resp


def _set_state_cookie(response: RedirectResponse, state: str) -> RedirectResponse:
    response.set_cookie(STATE_COOKIE, state, httponly=True, samesite="lax", max_age=600, path="/")
    return response


def _check_state(request: Request, state: str | None) -> None:
    """OAuth state 강제 검증.
    - state 미존재 → 400
    - cookie 미존재 또는 불일치 → 400
    - 통과 시 호출자가 cookie 를 삭제 (응답 객체에서) — 본 함수는 검증만.
    """
    if not state:
        raise HTTPException(status_code=400, detail="Missing OAuth state")
    cookie_state = request.cookies.get(STATE_COOKIE)
    if not cookie_state or cookie_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")


# ============ GOOGLE ============
@router.get("/google/login")
async def google_login():
    if not settings.google_client_id:
        raise HTTPException(status_code=501, detail="Google OAuth not configured")
    state = oauth.make_state()
    url = oauth.google_authorize_url(state)
    resp = RedirectResponse(url, status_code=302)
    return _set_state_cookie(resp, state)


@router.get("/google/callback")
async def google_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    _check_state(request, state)
    try:
        token_resp = await oauth.google_exchange_code(code)
        access_token = token_resp.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Google token exchange failed")
        profile = await oauth.google_fetch_userinfo(access_token)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[google] callback failed")
        raise HTTPException(status_code=500, detail="Google login failed")
    mapped = oauth.google_map_user(profile)
    if not mapped["provider_user_id"]:
        raise HTTPException(status_code=500, detail="Invalid Google profile")
    user = get_or_create_oauth_user(db, **mapped)
    jwt_token = create_access_token(user_id=user.id)
    return _redirect_with_token(jwt_token)


# ============ KAKAO ============
@router.get("/kakao/login")
async def kakao_login():
    if not settings.kakao_client_id:
        raise HTTPException(status_code=501, detail="Kakao OAuth not configured")
    state = oauth.make_state()
    url = oauth.kakao_authorize_url(state)
    resp = RedirectResponse(url, status_code=302)
    return _set_state_cookie(resp, state)


@router.get("/kakao/callback")
async def kakao_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    _check_state(request, state)
    try:
        token_resp = await oauth.kakao_exchange_code(code)
        access_token = token_resp.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Kakao token exchange failed")
        profile = await oauth.kakao_fetch_userinfo(access_token)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[kakao] callback failed")
        raise HTTPException(status_code=500, detail="Kakao login failed")
    mapped = oauth.kakao_map_user(profile)
    if not mapped["provider_user_id"]:
        raise HTTPException(status_code=500, detail="Invalid Kakao profile")
    user = get_or_create_oauth_user(db, **mapped)
    jwt_token = create_access_token(user_id=user.id)
    return _redirect_with_token(jwt_token)


# ============ APPLE ============
@router.get("/apple/login")
async def apple_login():
    if not settings.apple_client_id:
        raise HTTPException(status_code=501, detail="Apple OAuth not configured")
    state = oauth.make_state()
    url = oauth.apple_authorize_url(state)
    resp = RedirectResponse(url, status_code=302)
    return _set_state_cookie(resp, state)


@router.post("/apple/callback")
async def apple_callback_post(
    request: Request,
    code: str = Form(...),
    state: str = Form(...),
    user: str | None = Form(None),     # Apple 첫 로그인 시 form_post 로 보냄
    id_token: str | None = Form(None),
    db: Session = Depends(get_db),
):
    _check_state(request, state)
    try:
        token_resp = await oauth.apple_exchange_code(code)
        id_tok = token_resp.get("id_token") or id_token
        if not id_tok:
            raise HTTPException(status_code=400, detail="Apple id_token missing")
        claims = await oauth.apple_validate_id_token(id_tok)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[apple] callback failed")
        raise HTTPException(status_code=500, detail="Apple login failed")
    user_payload = None
    if user:
        try: user_payload = json.loads(user)
        except Exception: user_payload = None
    mapped = oauth.apple_map_user(claims, user_payload)
    if not mapped["provider_user_id"]:
        raise HTTPException(status_code=500, detail="Invalid Apple claims")
    db_user = get_or_create_oauth_user(db, **mapped)
    jwt_token = create_access_token(user_id=db_user.id)
    return _redirect_with_token(jwt_token)


@router.get("/apple/callback")
async def apple_callback_get(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    """일부 환경에서 GET 콜백을 사용할 경우 — POST 와 동일 흐름. state 필수."""
    return await apple_callback_post(request, code=code, state=state, user=None, id_token=None, db=db)


# ============ USER INFO + LOGOUT ============
@router.get("/me")
async def me(current: User = Depends(get_current_user)):
    return {
        "id": current.id,
        "provider": current.provider,
        "email": current.email,
        "nickname": current.nickname,
        "profile_image_url": current.profile_image_url,
        "created_at": current.created_at.isoformat() if current.created_at else None,
    }


@router.post("/logout")
async def logout(current: User = Depends(get_current_user)):
    """JWT 는 stateless — 클라이언트가 토큰 폐기. 서버는 응답만."""
    return {"ok": True}


# ============ NAVER ============
@router.get("/naver/login")
async def naver_login():
    if not settings.naver_client_id:
        raise HTTPException(status_code=501, detail="Naver OAuth not configured")
    state = oauth.make_state()
    url = oauth.naver_authorize_url(state)
    resp = RedirectResponse(url, status_code=302)
    return _set_state_cookie(resp, state)


@router.get("/naver/callback")
async def naver_callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    _check_state(request, state)
    try:
        token_resp = await oauth.naver_exchange_code(code, state)
        access_token = token_resp.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="Naver token exchange failed")
        profile = await oauth.naver_fetch_userinfo(access_token)
    except HTTPException:
        raise
    except Exception:
        logger.exception("[naver] callback failed")
        raise HTTPException(status_code=500, detail="Naver login failed")
    mapped = oauth.naver_map_user(profile)
    if not mapped["provider_user_id"]:
        raise HTTPException(status_code=500, detail="Invalid Naver profile")
    user = get_or_create_oauth_user(db, **mapped)
    jwt_token = create_access_token(user_id=user.id)
    return _redirect_with_token(jwt_token)
