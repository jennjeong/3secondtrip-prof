"""Auth schemas."""
from pydantic import BaseModel
from app.schemas.user_schema import UserPublic


class TokenResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"
