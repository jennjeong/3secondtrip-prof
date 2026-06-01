"""FastAPI dependencies — JWT bearer auth + current_user loader."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                     db: Session = Depends(get_db)) -> User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(creds.credentials)
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.id == int(sub)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def get_current_user_optional(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                              db: Session = Depends(get_db)) -> User | None:
    if not creds or not creds.credentials:
        return None
    try:
        payload = decode_access_token(creds.credentials)
        sub = payload.get("sub")
        if not sub:
            return None
        return db.query(User).filter(User.id == int(sub)).first()
    except HTTPException:
        return None


def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """Require an authenticated admin (is_admin=True). 403 otherwise."""
    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    if not getattr(user, "is_active", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account deactivated")
    return user
