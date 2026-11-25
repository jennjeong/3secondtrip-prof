"""시작 화면 이미지 — 웹의 시작 화면(#bootSplash)과 같은 남색 배경·로고 배치로 만들어, 이미지에서 애니메이션으로 끊김 없이 이어지게 한다.

python3 design/brand/build_splash.py
  - FE/assets/splash/*.png (iOS 홈 화면 앱 — 밝은·어두운 테마 같은 그림)
  - app/ios Splash.imageset (1600², 화면 높이에 맞춰 채우므로 모든 값을 높이 비율로 둔다)
  - app/android 의 splash.png
"""
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
STOPS = [(0.0, (0x06, 0x40, 0x6F)), (0.42, (0x04, 0x20, 0x3F)), (1.0, (0x02, 0x0A, 0x1E))]   # index-redesign.html·boot-flight.js 와 같은 값


def color(t):
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(round(x + (y - x) * k) for x, y in zip(ca, cb))
    return STOPS[-1][1]


def splash(w, h):
    wide = w > h
    gx, gy, r = (w * 0.92 if wide else w / 2 + h * 0.24), h * 0.06, h * 0.95
    k = max(1, round(max(w, h) / 900))
    small = Image.new('RGB', (math.ceil(w / k), math.ceil(h / k)))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            px[x, y] = color(min(1, math.hypot((x + .5) * k - gx, (y + .5) * k - gy) / r))
    im = small.resize((w, h), Image.BICUBIC)
    logo = Image.open(ROOT / 'FE/assets/logo-3secondtrip.png').convert('RGBA')
    lw = round(min(h * 0.195, w * 0.5))
    logo = logo.resize((lw, round(lw * logo.height / logo.width)), Image.LANCZOS)
    white = Image.new('RGB', logo.size, 'white')
    im.paste(white, (round(w / 2 - lw / 2), round(h * 0.145 - logo.height / 2)), logo.getchannel('A'))
    return im


def main():
    ios = splash(1600, 1600)              # 시작 화면은 메모리 한도(약 25MB)를 넘으면 검게 나온다 — 2732² 는 넘는다
    for p in sorted((ROOT / 'app/ios/App/App/Assets.xcassets/Splash.imageset').glob('*.png')):
        ios.save(p, optimize=True)
    done = {}
    targets = sorted((ROOT / 'FE/assets/splash').glob('*.png')) + sorted((ROOT / 'app/android/app/src/main/res').glob('drawable*/splash.png'))
    for p in targets:
        size = Image.open(p).size
        done.setdefault(size, None)
        if done[size] is None:
            done[size] = splash(*size)
        done[size].save(p, optimize=True)
    print('시작 화면 이미지', len(targets) + 3, '개')


if __name__ == '__main__':
    main()
