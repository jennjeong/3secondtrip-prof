"""AI-generated city landmark images (OpenAI image models).

* GET /api/images/landmark/{city}
    Returns a PNG of the city's famous landmark.  Generated once via the
    OpenAI image model (OPENAI_IMAGE_MODEL, default gpt-image-1), then
    cached on disk forever at data/landmark_images/ so subsequent
    requests are instant.

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


def _slug(city: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9가-힣]+", "_", city.strip())[:32] or "x"
    h = hashlib.md5(city.encode("utf-8")).hexdigest()[:8]
    return f"{safe}_{h}"


def _build_prompt(city: str) -> str:
    subject = LANDMARK_HINTS.get(city.strip(), f"the most iconic landmark and scenery of {city}")
    return (
        f"A sophisticated editorial travel photograph of {subject}. "
        f"Professional magazine-quality travel photography, shot on a full-frame camera, "
        f"natural bright daylight, clear sky, crisp realistic detail, elegant cinematic composition, "
        f"balanced natural colors — avoid heavy orange or red sunset tones. "
        f"No text, no logos, no people, no watermarks."
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

    model = settings.openai_image_model
    prompt = _build_prompt(city)
    logger.info("[landmark] generating image for %s via %s — prompt=%r", city, model, prompt[:80])

    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        gen_kwargs = dict(model=model, prompt=prompt, size="1024x1024", n=1)
        # dall-e-* takes quality="standard"; gpt-image-* rejects it (uses low/medium/high/auto)
        if model.startswith("dall-e"):
            gen_kwargs["quality"] = "standard"
        res = await client.images.generate(**gen_kwargs)
        item = res.data[0]
    except Exception as e:
        logger.exception("[landmark] OpenAI generation failed for %s", city)
        raise HTTPException(503, f"Image generation failed: {e}")

    # gpt-image-* returns base64 (b64_json); dall-e-* returns a short-lived URL.
    try:
        b64 = getattr(item, "b64_json", None)
        if b64:
            import base64
            cached.write_bytes(base64.b64decode(b64))
        else:
            url = getattr(item, "url", None)
            if not url:
                raise ValueError("image response had neither b64_json nor url")
            async with httpx.AsyncClient(timeout=30) as dl:
                r = await dl.get(url)
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
