"""Users router — local email/password signup + duplicate checks + profile."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.password import hash_password, verify_password
from app.core.rate_limit import RateLimiter
from app.core.security import create_access_token
from app.db.database import get_db
from app.models.user import User
from app.routers.dependencies import get_current_user
from app.schemas.user_schema import (
    AccountDeleteRequest, PasswordChangeRequest, PasswordResetConfirm, PasswordResetRequest,
    PasswordSignupRequest, PasswordLoginRequest,
    SignupResponse, CheckDuplicateResponse, UserPublic, UserUpdateRequest,
)
from app.services import account_service, password_reset_service, user_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/check-nickname", response_model=CheckDuplicateResponse)
def check_nickname(nickname: str = Query(min_length=2, max_length=30), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_nickname_available(db, nickname))


@router.get("/check-email", response_model=CheckDuplicateResponse)
def check_email(email: str = Query(min_length=3, max_length=255), db: Session = Depends(get_db)):
    return CheckDuplicateResponse(available=user_service.is_email_available(db, email))


@router.post("/signup", response_model=SignupResponse)
def signup(payload: PasswordSignupRequest, db: Session = Depends(get_db)):
    user = user_service.create_password_user(
        db,
        email=payload.email, password=payload.password, nickname=payload.nickname,
        name=payload.name, phone=payload.phone, birth_date=payload.birth_date,
    )
    token = create_access_token(user_id=user.id, token_version=user.token_version or 0)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)


@router.post("/login", response_model=SignupResponse)
def login(payload: PasswordLoginRequest, db: Session = Depends(get_db)):
    en = user_service.normalize_email(payload.email)
    user = db.query(User).filter(User.email_normalized == en, User.provider == "local").first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    token = create_access_token(user_id=user.id, token_version=user.token_version or 0)
    return SignupResponse(user=UserPublic.model_validate(user), access_token=token)


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
