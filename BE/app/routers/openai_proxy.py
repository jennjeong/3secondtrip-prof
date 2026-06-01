"""OpenAI 프록시 — 키는 백엔드만, 인증된 사용자만 호출 가능."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.config import settings
from app.routers.dependencies import get_current_user
from app.models.user import User

logger = logging.getLogger("openai_proxy")
router = APIRouter(prefix="/openai", tags=["openai"])


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)


class ChatResponse(BaseModel):
    output_text: str


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, _: User = Depends(get_current_user)):
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI is not configured on server")
    try:
        # openai>=1.0 sync client; ASGI 워커가 적당해서 sync 호출도 OK
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        resp = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": "You are a helpful travel planning assistant. Respond in the user's language."},
                {"role": "user", "content": req.prompt},
            ],
            temperature=0.8,
        )
        text = resp.choices[0].message.content or ""
        return ChatResponse(output_text=text)
    except HTTPException:
        raise
    except Exception:
        logger.exception("openai chat failed")
        raise HTTPException(status_code=502, detail="OpenAI request failed")
