"""새 앱 아이콘(비행기 경로) 원본 → 웹·앱에서 쓰는 모든 아이콘·시작 화면 이미지.

python3 design/brand/build_icon_plane.py
  1) icon-plane-source.png 의 둥근 모서리 바깥(검정)을 주변 배경색으로 채워 꽉 찬 정사각형을 만든다
     → design/brand/icon-plane-1024.png  (iOS·Android 원본, 투명 없음)
  2) FE/assets: icon-192/512, icon-maskable-512(안전 영역 안으로 축소), apple-touch-icon(180),
     favicon(512), favicon-32, favicon.svg(둥근 모서리 PNG 를 담은 SVG)
  3) FE/assets/splash/*.png: 예전 아이콘 자리를 찾아 새 아이콘(둥근 모서리)으로 바꿔 끼운다
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'design/brand'
ASSETS = ROOT / 'FE/assets'
RADIUS = 0.22  # 원본의 둥근 모서리 비율(273/1254)


def full_bleed(src: Image.Image) -> Image.Image:
    """모서리 바깥(검정)을 모서리 원의 중심에서 바깥으로 뻗은 방향의 안쪽 배경색으로 이어 칠한다."""
    im = src.convert('RGB')
    w, h = im.size
    r = round(w * RADIUS)
    inset = 34                      # 가장자리 테두리 띠를 피해 이만큼 안쪽 색을 가져온다
    out = im.copy()
    o, a = out.load(), im.load()
    for cx, cy in ((r, r), (w - 1 - r, r), (r, h - 1 - r), (w - 1 - r, h - 1 - r)):
        xs = range(0, r + 1) if cx == r else range(w - 1 - r, w)
        ys = range(0, r + 1) if cy == r else range(h - 1 - r, h)
        for y in ys:
            for x in xs:
                dx, dy = x - cx, y - cy
                d = (dx * dx + dy * dy) ** .5
                if d <= r - inset:
                    continue
                k = (r - inset) / d
                o[x, y] = a[round(cx + dx * k), round(cy + dy * k)]
    # 바뀐 곳만 살짝 흐려 방사형 줄무늬를 없앤다
    blur = out.filter(ImageFilter.GaussianBlur(10))
    m = Image.new('L', (w, h), 255)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=0)
    m = m.filter(ImageFilter.MaxFilter(2 * inset + 1)).filter(ImageFilter.GaussianBlur(8))
    return Image.composite(blur, out, m)


def rounded(im: Image.Image, size: int) -> Image.Image:
    big = im.resize((size * 4, size * 4), Image.LANCZOS)
    m = Image.new('L', big.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, big.width - 1, big.height - 1), round(big.width * RADIUS), fill=255)
    out = big.convert('RGBA'); out.putalpha(m)
    return out.resize((size, size), Image.LANCZOS)


def maskable(full: Image.Image, size=512, scale=0.80) -> Image.Image:
    """원형 마스크에서도 비행기·출발 고리가 잘리지 않게 가운데로 줄이고, 바깥은 가장자리 색을 그대로 늘려 채운다."""
    inner = round(size * scale)
    pic = full.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    out = Image.new('RGB', (size, size))
    o, p = out.load(), pic.load()
    for y in range(size):
        for x in range(size):
            o[x, y] = p[min(inner - 1, max(0, x - off)), min(inner - 1, max(0, y - off))]
    band = Image.new('L', (size, size), 255)
    ImageDraw.Draw(band).rectangle((off + 6, off + 6, off + inner - 7, off + inner - 7), fill=0)
    band = band.filter(ImageFilter.GaussianBlur(6))
    return Image.composite(out.filter(ImageFilter.GaussianBlur(14)), out, band)


def replace_in_splash(path: Path, icon: Image.Image):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    bg = im.getpixel((0, 0))
    px = im.load()

    def differs(x, y):
        p = px[x, y]
        return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2]) > 12

    rows = [y for y in range(h) if any(differs(x, y) for x in range(0, w, 3))]
    # 첫 번째 연속 구간 = 아이콘(그 아래 떨어져 있는 구간은 글자)
    top = rows[0]; bot = top
    for y in rows[1:]:
        if y - bot > 4:
            break
        bot = y
    cols = [x for x in range(w) if any(differs(x, y) for y in range(top, bot + 1, 2))]
    left, right = cols[0], cols[-1]
    side = max(right - left, bot - top) + 1
    cx, cy = (left + right) / 2, (top + bot) / 2
    pad = max(4, side // 40)
    ImageDraw.Draw(im).rectangle((left - pad, top - pad, right + pad, bot + pad), fill=bg)
    ic = rounded(icon, side)
    im.paste(ic, (round(cx - side / 2), round(cy - side / 2)), ic)
    im.save(path, optimize=True)
    return side


def main():
    src = Image.open(BRAND / 'icon-plane-source.png')
    full = full_bleed(src).resize((1024, 1024), Image.LANCZOS)
    full.save(BRAND / 'icon-plane-1024.png', optimize=True)
    on_bg = Image.new('RGB', (1024, 1024), (0xF7, 0xF8, 0xFA))
    ic = rounded(full, 1024); on_bg.paste(ic, (0, 0), ic)
    on_bg.save(BRAND / 'icon-plane-splash.png', optimize=True)  # 앱 시작 화면용(둥근 모서리)

    for n, s in (('icon-192.png', 192), ('icon-512.png', 512), ('favicon.png', 512), ('apple-touch-icon.png', 180)):
        full.resize((s, s), Image.LANCZOS).save(ASSETS / n, optimize=True)
    rounded(full, 32).save(ASSETS / 'favicon-32.png', optimize=True)
    maskable(full).save(ASSETS / 'icon-maskable-512.png', optimize=True)

    buf = io.BytesIO(); rounded(full, 128).save(buf, 'PNG', optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    (ASSETS / 'favicon.svg').write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
        f'<image href="data:image/png;base64,{b64}" width="64" height="64"/></svg>\n', encoding='utf-8')

    for p in sorted((ASSETS / 'splash').glob('*.png')):
        print(p.name, replace_in_splash(p, full))


if __name__ == '__main__':
    main()
