"""Users router — local email/password signup + duplicate checks + profile."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import policies
from app.core.password import hash_password, needs_rehash, verify_password
from app.core.rate_limit import RateLimiter
from app.core.security import create_access_token
from app.db.database import get_db
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.user_schema import (
    AccountDeleteRequest, PasswordChangeRequest, PasswordResetConfirm, PasswordResetRequest,
    PasswordSignupRequest, PasswordLoginRequest, ResendVerificationRequest, SignupPending, VerifyEmailRequest,
    SignupResponse, CheckDuplicateResponse, UserPublic, UserUpdateRequest,
)
from app.services import account_service, email_verification_service as ev, password_reset_service, user_service

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/check-nickname", response_model=CheckDuplicateResponse)
def check_nickname(nickname: str = Query(min_length=2, max_length=30), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_nickname_available(db, nickname))

@router.get("/check-email", response_model=CheckDuplicateResponse)
def check_email(email: str = Query(min_length=3, max_length=255), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_email_available(db, email))

_signup_limit = RateLimiter(per_ip=10, total=300, window_seconds=600)
_login_limit = RateLimiter(per_ip=20, total=600, window_seconds=600)
_verify_limit = RateLimiter(per_ip=30, total=600, window_seconds=600)

def _pending(db: Session, user: User, issued: dict | None) -> SignupPending:
    return SignupPending(
        email=user.email, expires_in=int(ev.CODE_TTL.total_seconds()),
        resend_after=ev.seconds_until_resend(db, user),
        sent=bool(issued and issued.get("sent")), dev_code=(issued or {}).get("dev_code"),
        send_error=(issued or {}).get("send_error"),
    )

@router.post("/signup", response_model=SignupPending, status_code=202, dependencies=[Depends(_signup_limit)])
def signup(payload: PasswordSignupRequest, db: Session = Depends(get_db)):
    """가입 요청 — 인증 전 계정을 만들고 인증 코드를 보낸다. 로그인 토큰은 인증을 마친 뒤에만 준다.
    같은 이메일로 다시 보내도 계정은 하나이고, 60초 안에는 코드를 다시 보내지 않는다."""
    if not ev.is_enabled():
        raise HTTPException(status_code=503, detail="인증 메일을 보낼 수 없어 지금은 가입할 수 없어요. 잠시 뒤 다시 해 주세요.")
    ev.purge_stale(db)
    user = user_service.upsert_pending_user(
        db, email=payload.email, password=payload.password, nickname=payload.nickname,
        terms_version=policies.TERMS_VERSION, privacy_version=policies.PRIVACY_VERSION,
    )
    issued = ev.issue(db, user) if ev.seconds_until_resend(db, user) == 0 else None
    return _pending(db, user, issued)

@router.post("/verify-email", response_model=SignupResponse, dependencies=[Depends(_verify_limit)])
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    """인증 — 6자리 코드(이메일과 함께) 또는 메일 속 링크 토큰. 성공하면 로그인 토큰을 준다."""
    if payload.token:
        result, user = ev.verify_link(db, payload.token)
        if result == "used":
            raise HTTPException(status_code=409, detail={"code": "already_verified", "message": "이미 인증을 마친 링크예요. 로그인해 주세요."})
        if result != "ok" or not user:
            raise HTTPException(status_code=400, detail={"code": result, "message": "링크가 만료되었거나 올바르지 않아요. 가입 화면에서 코드를 다시 받아 주세요."})
    else:
        if not payload.email or not payload.code:
            raise HTTPException(status_code=422, detail={"code": "missing", "message": "이메일과 6자리 코드를 넣어 주세요."})
        user = db.query(User).filter(User.email_normalized == user_service.normalize_email(payload.email), User.provider == "local").first()
        if user and user.email_verified_at is not None:
            raise HTTPException(status_code=409, detail={"code": "already_verified", "message": "이미 인증된 계정이에요. 로그인해 주세요."})
        result = ev.verify_code(db, user, payload.code) if user else "none"
        if result != "ok":
            msg = {
                "invalid": "코드가 맞지 않아요. 메일의 6자리 코드를 다시 확인해 주세요.",
                "expired": "코드가 만료됐어요. 새 코드를 받아 주세요.",
                "locked": "여러 번 틀려서 이 코드는 더 쓸 수 없어요. 새 코드를 받아 주세요.",
                "none": "인증할 가입 요청을 찾지 못했어요. 이메일을 확인하거나 다시 가입해 주세요.",
            }[result]
            raise HTTPException(status_code=400, detail={"code": result, "message": msg})
    token = create_access_token(user_id=user.id, token_version=user.token_version or 0)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)

@router.post("/verify-email/resend", status_code=202, dependencies=[Depends(_verify_limit)])
def resend_verification(payload: ResendVerificationRequest, db: Session = Depends(get_db)):
    """코드 다시 받기 — 가입 여부를 드러내지 않도록 없는 주소도 같은 모양으로 답한다."""
    user = db.query(User).filter(User.email_normalized == user_service.normalize_email(payload.email), User.provider == "local").first()
    if not user or user.email_verified_at is not None:
        return {"ok": True, "resend_after": int(ev.RESEND_AFTER.total_seconds())}
    wait = ev.seconds_until_resend(db, user)
    if wait > 0:
        raise HTTPException(status_code=429, detail={"code": "too_soon", "message": f"{wait}초 뒤에 다시 받을 수 있어요.", "retry_after": wait})
    issued = ev.issue(db, user)
    wait_next = 0 if issued.get("send_error") else int(ev.RESEND_AFTER.total_seconds())   # 못 보냈으면 바로 다시 시도
    return {"ok": True, "resend_after": wait_next, "sent": issued["sent"], "dev_code": issued["dev_code"],
            "send_error": issued.get("send_error")}

@router.post("/login", response_model=SignupResponse, dependencies=[Depends(_login_limit)])
def login(payload: PasswordLoginRequest, db: Session = Depends(get_db)):
    en = user_service.normalize_email(payload.email)
    user = db.query(User).filter(User.email_normalized == en, User.provider == "local").first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    if not ev.is_verified(user):
        raise HTTPException(status_code=403, detail={"code": "email_unverified", "message": "이메일 인증을 마쳐야 로그인할 수 있어요.",
                                                     "resend_after": ev.seconds_until_resend(db, user)})
    if needs_rehash(user.password_hash):          # 예전(72바이트) 해시를 새 방식으로
        user.password_hash = hash_password(payload.password)
        db.commit()
    token = create_access_token(user_id=user.id, token_version=user.token_version or 0)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)

@router.get("/password-policy")
def password_policy_info():
    from app.core import password_policy
    return password_policy.describe()

_reset_limit = RateLimiter(per_ip=5, total=100, window_seconds=600)

@router.post("/password-reset/request", status_code=202, dependencies=[Depends(_reset_limit)])
def password_reset_request(payload: PasswordResetRequest, db: Session = Depends(get_db)):
    """가입 여부를 드러내지 않도록 항상 같은 응답을 준다."""
    if not password_reset_service.is_enabled():
        raise HTTPException(status_code=503, detail="비밀번호 재설정 메일을 아직 보낼 수 없어요.")
    password_reset_service.request_reset(db, payload.email)
    return {"ok": True}

@router.post("/password-reset/confirm", dependencies=[Depends(_reset_limit)])
def password_reset_confirm(payload: PasswordResetConfirm, db: Session = Depends(get_db)):
    if not password_reset_service.confirm_reset(db, payload.token, payload.password):
        raise HTTPException(status_code=400, detail="링크가 만료되었거나 이미 사용되었어요. 다시 요청해 주세요.")
    return {"ok": True}

_change_limit = RateLimiter(per_ip=5, total=200, window_seconds=600)

@router.post("/me/password", dependencies=[Depends(_change_limit)])
def change_password(payload: PasswordChangeRequest, current: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    """로그인한 상태에서 비밀번호 변경.  다른 기기의 로그인은 모두 끊고,
    지금 기기는 새 토큰으로 로그인 상태를 유지한다."""
    if current.provider != "local" or not current.password_hash:
        raise HTTPException(status_code=400, detail="소셜 로그인 계정은 비밀번호가 없어요. 가입한 서비스에서 관리해 주세요.")
    if not verify_password(payload.current_password, current.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않아요.")
    if verify_password(payload.new_password, current.password_hash):
        raise HTTPException(status_code=400, detail="지금 쓰는 비밀번호와 다른 비밀번호를 정해 주세요.")
    current.password_hash = hash_password(payload.new_password)
    current.token_version = int(current.token_version or 0) + 1
    db.commit()
    return {"ok": True, "access_token": create_access_token(user_id=current.id, token_version=current.token_version)}

@router.post("/me/logout-all")
def logout_all(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """이 기기를 포함해 모든 기기의 로그인을 끊는다."""
    current.token_version = int(current.token_version or 0) + 1
    db.commit()
    return {"ok": True}

@router.post("/me/delete", dependencies=[Depends(_change_limit)])
def delete_me(payload: AccountDeleteRequest, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """계정을 지운다.  확인 문구('계정 삭제')를 그대로 적어야 하고, 이메일 가입 계정은 비밀번호도 맞아야 한다.
    지운 뒤에는 이 계정으로 발급된 모든 로그인 토큰이 거절된다(사용자가 없으므로)."""
    if payload.confirm.strip() != account_service.CONFIRM_TEXT:
        raise HTTPException(status_code=400, detail=f"확인 문구 '{account_service.CONFIRM_TEXT}'를 그대로 입력해 주세요.")
    if current.provider == "local" and current.password_hash:
        if not payload.password or not verify_password(payload.password, current.password_hash):
            raise HTTPException(status_code=400, detail="비밀번호가 올바르지 않아요.")
    if current.is_admin:
        raise HTTPException(status_code=400, detail="관리자 계정은 여기서 삭제할 수 없어요. 관리자 권한을 먼저 넘겨 주세요.")
    counts = account_service.delete_account(db, current)
    return {"ok": True, "deleted": counts}

@router.get("/me", response_model=UserPublic)
def get_me(current: User = Depends(get_current_user)):
    return UserPublic.model_validate(current)

@router.patch("/me", response_model=UserPublic)
def update_me(payload: UserUpdateRequest, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = user_service.update_profile(db, current, **payload.model_dump(exclude_unset=True))
    return UserPublic.model_validate(user)

@router.post("/logout")
def logout(_: User = Depends(get_current_user)):
    """Stateless JWT — frontend just drops the token. Echo for symmetry."""
    return {"ok": True}
