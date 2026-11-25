#!/usr/bin/env python3
"""공유 미리보기 이미지(FE/assets/og-image.png, 1200×630)를 만든다.

앱과 같은 밤하늘 지구본 배경에 지금 쓰는 앱 아이콘(icon-plane-1024.png)과
워드마크(FE/assets/logo-3secondtrip.png)를 올린다. 대륙 윤곽은 홈 지구본과 같은 자료를 읽는다.
카카오톡은 가운데를 2:1 로 잘라 보여 주므로 위아래 15px 안에는 아무것도 두지 않는다.

사용법: python3 design/brand/build_og_image.py
"""
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FE = ROOT / "FE"
W, H, S = 1200, 630, 2                      # 두 배로 그려 줄인다
CX, CY, R = 968, 770, 500                   # 지구본 중심·반지름
LON, LAT = 121, -10                        # 보는 방향 — 동아시아


def land():
    src = (FE / "js/redesign-globe.js").read_text(encoding="utf-8")
    raw = re.search(r"const LAND = (\[.*?\n\]);", src, re.S).group(1)
    return json.loads(re.sub(r",(\s*\])", r"\1", raw))


def inside(la, lo, poly):
    r, j = False, len(poly) - 1
    for i in range(len(poly)):
        a, b = poly[i]
        c, d = poly[j]
        if (a > la) != (c > la) and lo < (d - b) * (la - a) / (c - a) + b:
            r = not r
        j = i
    return r


def vec(la, lo):
    la, lo = math.radians(la), math.radians(lo)
    return math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)


def project(v):
    a, t = math.radians(-LON), math.radians(LAT)
    x = v[0] * math.cos(a) + v[2] * math.sin(a)
    z = -v[0] * math.sin(a) + v[2] * math.cos(a)
    return CX + x * R, CY - (v[1] * math.cos(t) - z * math.sin(t)) * R, v[1] * math.sin(t) + z * math.cos(t)


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def background():
    """밤하늘 + 지구본 테두리의 푸른 빛(작게 그려 늘리면 부드럽다)."""
    k = 4
    im = Image.new("RGB", (W // k, H // k))
    px = im.load()
    night, deep = (5, 7, 13), (8, 17, 40)
    for y in range(H // k):
        for x in range(W // k):
            X, Y = x * k, y * k
            d = math.hypot(X - CX, Y - CY) / R
            c = lerp(night, deep, 1 - d / 2.1)
            if d >= 1:
                c = lerp(c, (74, 126, 246), 0.62 * math.exp(-(d - 1) * 7.5))
            else:
                top = math.hypot(X - CX, Y - (CY - R)) / (R * 1.15)
                c = lerp((43, 88, 172), (6, 12, 30), top)
            px[x, y] = c
    return im.resize((W * S, H * S), Image.Resampling.BICUBIC)


def main():
    im = background().convert("RGBA")
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    polys = land()
    la = -56.0
    while la <= 80:
        n = round(232 * math.cos(math.radians(la)))
        for i in range(n):
            lo = -180 + 360 * i / n
            if not any(inside(la, lo, p) for p in polys):
                continue
            x, y, z = project(vec(la, lo))
            if z < 0.03 or not (-5 < x < W + 5 and -5 < y < H + 5):
                continue
            r = 2.2 * (0.62 + z * 0.5) * S
            d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=(158, 196, 255, round(255 * min(0.9, 0.2 + z * 0.8))))
        la += 1.55
    # 서울에서 이어지는 항로 — 앱 아이콘처럼 둥근 점
    seoul = vec(37.57, 126.98)
    cities = {"도쿄": (35.68, 139.69), "방콕": (13.76, 100.5), "하노이": (21.03, 105.85), "싱가포르": (1.35, 103.82), "삿포로": (43.06, 141.35), "타이베이": (25.03, 121.57), "파리": (48.86, 2.35), "괌": (13.44, 144.79)}
    for name, pos in cities.items():
        e = vec(*pos)
        om = math.acos(max(-1, min(1, sum(p * q for p, q in zip(seoul, e)))))
        steps = max(8, round(om * 40))
        lift = min(0.17, 0.04 + om * 0.09)
        for i in range(steps + 1):
            t = i / steps
            a, b, k = math.sin((1 - t) * om) / math.sin(om), math.sin(t * om) / math.sin(om), 1 + lift * math.sin(math.pi * t)
            x, y, z = project(tuple((p * a + q * b) * k for p, q in zip(seoul, e)))
            if math.hypot(x - CX, y - CY) < R and z < 0:
                continue
            if x < 640 and y < 520:          # 글자 뒤로는 지나가지 않게
                continue
            r = (3.1 if i % 7 == 3 else 1.9) * S
            d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=(226, 238, 255, 235 if i % 7 == 3 else 150))
    font = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 22 * S, index=4)
    for name, pos in {**cities, "서울": (37.57, 126.98)}.items():
        x, y, z = project(vec(*pos))
        if z < 0.15 or not (560 < x < W - 60 and y < H - 34):
            continue
        for r, f in ((9, (120, 170, 255, 95)), (4.6, (255, 255, 255, 255))):
            d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=f)
        if name in ("서울", "도쿄", "방콕", "타이베이", "싱가포르", "괌"):
            left = name == "서울"
            tw = d.textlength(name, font=font) / S
            d.text(((x - 16 - tw if left else x + 15) * S, (y - 14) * S), name, font=font, fill=(255, 255, 255, 245), stroke_width=3 * S, stroke_fill=(10, 26, 64, 200))
    # 지평선
    d.ellipse([(CX - R) * S, (CY - R) * S, (CX + R) * S, (CY + R) * S], outline=(190, 216, 255, 190), width=2 * S)
    im = Image.alpha_composite(im, lay)

    # 앱 아이콘
    size = 148 * S
    icon = Image.open(ROOT / "design/brand/icon-plane-1024.png").convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size * 2, size * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 2 - 1, size * 2 - 1], radius=round(size * 2 * 0.225), fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    pos = (84 * S, 118 * S)
    glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle([pos[0] - 4, pos[1] + 10, pos[0] + size + 4, pos[1] + size + 22], radius=round(size * 0.24), fill=(40, 96, 220, 130))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(26 * S)))
    icon.putalpha(ImageChops.multiply(icon.getchannel("A"), mask))
    im.alpha_composite(icon, pos)
    edge = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle([pos[0], pos[1], pos[0] + size - 1, pos[1] + size - 1], radius=round(size * 0.225), outline=(255, 255, 255, 46), width=S)
    im = Image.alpha_composite(im, edge)

    # 워드마크 — 흰색
    logo = Image.open(FE / "assets/logo-3secondtrip.png").convert("RGBA")
    lw = 500 * S
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.Resampling.LANCZOS)
    white = Image.new("RGBA", logo.size, (255, 255, 255, 255))
    white.putalpha(logo.getchannel("A"))
    im.alpha_composite(white, (84 * S, 318 * S))

    d = ImageDraw.Draw(im)
    f = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 30 * S, index=2)
    d.text((86 * S, 424 * S), "도시·날짜·예산만 고르면", font=f, fill=(226, 236, 255, 255))
    d.text((86 * S, 466 * S), "하루하루 일정이 완성돼요", font=f, fill=(226, 236, 255, 255))

    out = im.convert("RGB").resize((W, H), Image.Resampling.LANCZOS)
    out.save(FE / "assets/og-image.png", optimize=True)
    print("og-image.png", out.size, (FE / "assets/og-image.png").stat().st_size)


if __name__ == "__main__":
    main()
