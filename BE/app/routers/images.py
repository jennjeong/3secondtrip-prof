"""AI-generated city landmark images (OpenAI DALL-E).

* GET /api/images/landmark/{city}
    Returns a PNG of the city's famous landmark.  Generated once via
    OpenAI DALL-E, then cached on disk forever at data/landmark_images/
    so subsequent requests are instant.

OpenAI key stays in backend/.env (OPENAI_API_KEY).  If the key is
missing, the endpoint returns 503 cleanly so the frontend can fall back
to its gradient background.
"""
import hashlib
import logging
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings

logger = logging.getLogger("landmark_images")
router = APIRouter(prefix="/api/images", tags=["images"])

LANDMARK_DIR = Path("data/landmark_images")
LANDMARK_DIR.mkdir(parents=True, exist_ok=True)

# Curated prompts for the 8 seeded popular cities — produces consistently
# good results.  For any city not listed, falls back to a generic prompt.
LANDMARK_HINTS = {
    "도쿄":   "Tokyo Tower at golden hour with cherry blossoms, cinematic skyline view",
    "파리":   "Eiffel Tower at sunset, romantic Paris cityscape with golden light",
    "제주":   "Seongsan Ilchulbong sunrise peak on Jeju Island, dramatic ocean cliffs",
    "오사카": "Osaka Castle at twilight with cherry blossoms and traditional Japanese architecture",
    "방콕":   "Wat Arun temple at sunset along the Chao Phraya river in Bangkok",
    "서울":   "N Seoul Tower from Namsan mountain at night, glittering city lights",
    "뉴욕":   "Manhattan skyline from Brooklyn Bridge at sunset, iconic New York view",
    "시드니": "Sydney Opera House at golden hour with harbour bridge in background",
    # Common extras
    "후쿠오카": "Fukuoka Tower and Hakata bay at twilight",
    "교토":   "Fushimi Inari shrine red torii gates at sunrise, Kyoto",
    "런던":   "Big Ben and Tower Bridge at golden hour, iconic London",
    "로마":   "Roman Colosseum at sunset with warm golden light",
    "바르셀로나": "Sagrada Familia cathedral at golden hour, Barcelona",
    "베네치아": "Grand Canal of Venice with gondolas at sunset",
    "푸켓":   "Phi Phi islands turquoise water and limestone cliffs",
    "치앙마이": "Doi Suthep temple golden stupa at sunrise, Chiang Mai",
}


def _slug(city: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9가-힣]+", "_", city.strip())[:32] or "x"
    h = hashlib.md5(city.encode("utf-8")).hexdigest()[:8]
    return f"{safe}_{h}"


def _build_prompt(city: str) -> str:
    subject = LANDMARK_HINTS.get(city.strip(), f"the most famous landmark of {city}")
    return (
        f"A vibrant travel poster illustration of {subject}. "
        f"Cinematic lighting, postcard style, painterly, vivid saturated colors, "
        f"wide composition, atmospheric. No text, no logos, no people, no watermarks."
    )


@router.get("/landmark/{city}")
async def get_landmark_image(city: str):
    """Return a PNG of the city's famous landmark.  Cached forever per city."""
    if not city or len(city) > 80:
        raise HTTPException(400, "Invalid city")

    cached = LANDMARK_DIR / f"{_slug(city)}.png"
    if cached.exists():
        return FileResponse(
            cached,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=2592000, immutable"},
        )

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY not configured — AI image generation unavailable.",
        )

    prompt = _build_prompt(city)
    logger.info("[landmark] generating image for %s — prompt=%r", city, prompt[:80])

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        res = await client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            size="1024x1024",
            quality="standard",
            n=1,
        )
        url = res.data[0].url
    except Exception as e:
        logger.exception("[landmark] OpenAI generation failed for %s", city)
        raise HTTPException(503, f"Image generation failed: {e}")

    # Download immediately — DALL-E URLs expire ~1 hour after generation
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url)
            r.raise_for_status()
        cached.write_bytes(r.content)
    except Exception as e:
        logger.exception("[landmark] failed to cache image for %s", city)
        raise HTTPException(503, f"Failed to cache image: {e}")

    return FileResponse(
        cached,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )
