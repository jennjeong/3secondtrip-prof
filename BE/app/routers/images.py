"""AI-generated city landmark images (OpenAI image models).

* GET /api/images/landmark/{city}
    Returns a PNG of the city's famous landmark.  Generated once via the
    OpenAI image model (OPENAI_IMAGE_MODEL, default gpt-image-1), then
    cached in the DB (landmark_images) so subsequent requests are instant
    and survive Render free-tier restarts.

Only cities in LANDMARK_HINTS are generated.  The endpoint is public, so an
open list would let anyone spend the OpenAI budget and fill the DB.

OpenAI key stays in backend/.env (OPENAI_API_KEY).  If the key is
missing, the endpoint returns 503 cleanly so the frontend can fall back
to its gradient background.
"""
import asyncio
import base64
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.database import get_db
from app.models.landmark_image import LandmarkImage

logger = logging.getLogger("landmark_images")
router = APIRouter(prefix="/api/images", tags=["images"])

_generate_lock = asyncio.Lock()

# Curated prompts for the 8 seeded popular cities — produces consistently
# good results.  For any city not listed, falls back to a generic prompt.
LANDMARK_HINTS = {
    "도쿄":   "Tokyo skyline with Tokyo Tower under a clear blue daytime sky",
    "파리":   "the Eiffel Tower with the green Champ de Mars and bright blue sky, daytime Paris",
    "제주":   "Seongsan Ilchulbong tuff cone above turquoise ocean, Jeju Island, clear daytime",
    "오사카": "Osaka Castle with its green moat and blue sky, bright daytime",
    "방콕":   "Wat Arun temple beside the Chao Phraya river, bright daytime Bangkok",
    "서울":   "N Seoul Tower on Namsan with the city skyline and clear sky, daytime",
    "뉴욕":   "the Manhattan skyline with One World Trade Center under a clear blue sky, daytime",
    "시드니": "the Sydney Opera House and Harbour Bridge over deep blue water, bright daytime",
    # Common extras
    "후쿠오카": "Fukuoka Tower and Hakata Bay under a clear daytime sky",
    "교토":   "Kiyomizu-dera temple surrounded by lush green hills, Kyoto, daytime",
    "런던":   "Tower Bridge over the River Thames under a bright daytime sky, London",
    "로마":   "the Roman Colosseum under a clear blue sky, daytime Rome",
    "바르셀로나": "the Sagrada Familia against a bright blue sky, daytime Barcelona",
    "베네치아": "the Grand Canal of Venice with colorful buildings, bright daytime",
    "푸켓":   "Phi Phi islands with turquoise water and limestone cliffs, bright daytime",
    "치앙마이": "Doi Suthep temple complex among green mountains, daytime Chiang Mai",
    # 홈 히어로용 — 특정 도시가 아닌 '여행 그 자체' 무드
    "대표여행": "a breathtaking coastal travel destination from above — turquoise sea, "
                "dramatic cliffs and a picturesque whitewashed town, bright clear daytime, wanderlust mood",
}


def _build_prompt(city: str) -> str:
    subject = LANDMARK_HINTS.get(city.strip(), f"the most iconic landmark and scenery of {city}")
    return (
        f"A sophisticated editorial travel photograph of {subject}. "
        f"Professional magazine-quality travel photography, shot on a full-frame camera, "
        f"natural bright daylight, clear sky, crisp realistic detail, elegant cinematic composition, "
        f"balanced natural colors — avoid heavy orange or red sunset tones. "
        f"No text, no logos, no people, no watermarks."
    )


def _png_response(content: bytes) -> Response:
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )


def _load_cached(db: Session, city: str) -> bytes | None:
    row = db.get(LandmarkImage, city)
    return row.content if row else None


async def _generate(city: str) -> bytes:
    from openai import AsyncOpenAI

    model = settings.openai_image_model
    logger.info("[landmark] generating image for %s via %s", city, model)
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    gen_kwargs = dict(model=model, prompt=_build_prompt(city), size="1024x1024", n=1)
    # dall-e-* takes quality="standard"; gpt-image-* rejects it (uses low/medium/high/auto)
    if model.startswith("dall-e"):
        gen_kwargs["quality"] = "standard"
    res = await client.images.generate(**gen_kwargs)
    item = res.data[0]

    # gpt-image-* returns base64 (b64_json); dall-e-* returns a short-lived URL.
    b64 = getattr(item, "b64_json", None)
    if b64:
        return base64.b64decode(b64)
    url = getattr(item, "url", None)
    if not url:
        raise ValueError("image response had neither b64_json nor url")
    async with httpx.AsyncClient(timeout=30) as dl:
        r = await dl.get(url)
        r.raise_for_status()
    return r.content


@router.get("/landmark/{city}")
async def get_landmark_image(city: str, db: Session = Depends(get_db)):
    """Return a PNG of the city's famous landmark.  Cached forever per city."""
    city = city.strip()
    if city not in LANDMARK_HINTS:
        raise HTTPException(404, "No landmark image for this city")

    cached = _load_cached(db, city)
    if cached:
        return _png_response(cached)

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not configured — AI image generation unavailable.",
        )

    # 카드 8장이 동시에 요청해도 도시별로 한 번만 생성되도록 직렬화한다.
    async with _generate_lock:
        cached = _load_cached(db, city)
        if cached:
            return _png_response(cached)
        try:
            content = await _generate(city)
            db.add(LandmarkImage(city=city, content=content))
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("[landmark] generation failed for %s", city)
            raise HTTPException(503, "Image generation failed")

    return _png_response(content)
