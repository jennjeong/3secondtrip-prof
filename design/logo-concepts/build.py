"""3초 여행 로고 시안 20개 — 심볼 + 워드마크 조합.  python3 build.py → preview.html, svg/*.svg
이전 아이콘 시안(design/icon-concepts: 3·핀·비행기·스톱워치·지구본 등)과 겹치지 않는 소재로 만든다."""
from pathlib import Path

HERE = Path(__file__).parent
B, B2, SKY, INK, WARM, BG = '#285CAA', '#1F4F94', '#7DB0EC', '#151C28', '#F2A541', '#F7F8FA'

# 각 심볼은 64×64 안에 그린다. c = 주 색, a = 보조 색
SYMBOLS = [
    ('경유 세 점', '출발·경유·도착 세 점을 오르는 선으로 이었어요. ‘3’과 ‘하루의 동선’을 함께 뜻해요.',
     lambda c, a, t='#fff': f'<path d="M12 48 L30 34 L50 16" fill="none" stroke="{a}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
                  f'<circle cx="12" cy="48" r="7" fill="{c}"/><circle cx="30" cy="34" r="6" fill="{c}"/><circle cx="50" cy="16" r="8" fill="{c}"/>'),
    ('일정 줄', '세 줄짜리 일정표. 첫 줄만 채운 점이라 ‘지금 할 일’이 먼저 읽혀요.',
     lambda c, a, t='#fff': ''.join(f'<circle cx="14" cy="{y}" r="5" fill="{c if i == 0 else "none"}" stroke="{c}" stroke-width="3"/>'
                          f'<rect x="24" y="{y-3}" width="{30 if i != 1 else 22}" height="6" rx="3" fill="{c if i == 0 else a}"/>' for i, y in enumerate((16, 32, 48)))
                  + f'<path d="M14 21 V27 M14 37 V43" stroke="{a}" stroke-width="2" stroke-dasharray="2 3"/>'),
    ('점선 3', '숫자 3을 점선 경로로 그렸어요. 이름과 여정이 한 획이에요.',
     lambda c, a, t='#fff': f'<path d="M18 14 H42 L30 30 C44 30 48 38 48 44 C48 52 40 56 32 56 C24 56 19 52 17 48" fill="none" stroke="{c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 10"/>'
                  f'<circle cx="18" cy="14" r="5" fill="{a}"/>'),
    ('접힌 리본 3', '두 번 접은 지도 리본이 3 모양을 만들어요. 계획을 펼치는 느낌이에요.',
     lambda c, a, t='#fff': f'<path d="M14 12 H40 C48 12 52 18 52 24 C52 30 46 33 40 33 H28" fill="none" stroke="{c}" stroke-width="8" stroke-linecap="round"/>'
                  f'<path d="M28 33 H40 C47 33 52 38 52 44 C52 51 46 54 40 54 H14" fill="none" stroke="{a}" stroke-width="8" stroke-linecap="round"/>'),
    ('책갈피', '여행 계획을 끼워 두는 책갈피. 아래 홈이 3초의 ‘3’ 끝을 닮았어요.',
     lambda c, a, t='#fff': f'<path d="M18 8 H46 V56 L32 44 L18 56 Z" fill="{c}"/><text x="32" y="33" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="22" text-anchor="middle" fill="{t}">3</text>'),
    ('S자 길', '출발점에서 도착점까지 굽은 길. ‘Second’의 S이기도 해요.',
     lambda c, a, t='#fff': f'<path d="M48 12 C20 12 16 30 32 32 C48 34 44 52 16 52" fill="none" stroke="{c}" stroke-width="7" stroke-linecap="round"/>'
                  f'<circle cx="48" cy="12" r="6" fill="{a}"/><circle cx="16" cy="52" r="6" fill="{c}"/><circle cx="16" cy="52" r="2.5" fill="{t}"/>'),
    ('왕복 고리', '가고 돌아오는 길을 하나의 고리로. 끊기지 않는 일정이에요.',
     lambda c, a, t='#fff': f'<path d="M32 32 C24 20 10 20 10 32 C10 44 24 44 32 32 C40 20 54 20 54 32 C54 44 40 44 32 32 Z" fill="none" stroke="{c}" stroke-width="6"/>'
                  f'<circle cx="54" cy="32" r="5" fill="{a}"/>'),
    ('지평선 해', '수평선 위로 떠오르는 해의 세 줄기. 아침에 시작하는 여행이에요.',
     lambda c, a, t='#fff': f'<path d="M8 44 H56" stroke="{c}" stroke-width="5" stroke-linecap="round"/><path d="M18 44 A14 14 0 0 1 46 44" fill="{a}"/>'
                  f'<path d="M32 12 V20 M16 20 L20 26 M48 20 L44 26" stroke="{c}" stroke-width="4" stroke-linecap="round"/><path d="M16 52 H48" stroke="{c}" stroke-width="4" stroke-linecap="round" opacity=".45"/>'),
    ('우표', '테두리가 톱니인 우표 안에 3. 여행의 기념과 기록을 뜻해요.',
     lambda c, a, t='#fff': f'<rect x="10" y="10" width="44" height="44" rx="3" fill="{c}"/>' + ''.join(f'<circle cx="{x}" cy="10" r="2.6" fill="{t}"/><circle cx="{x}" cy="54" r="2.6" fill="{t}"/><circle cx="10" cy="{x}" r="2.6" fill="{t}"/><circle cx="54" cy="{x}" r="2.6" fill="{t}"/>' for x in range(16, 52, 7))
                  + f'<rect x="17" y="17" width="30" height="30" rx="2" fill="none" stroke="{t}" stroke-width="2" opacity=".6"/><text x="32" y="41" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="22" text-anchor="middle" fill="{t}">3</text>'),
    ('이정표', '두 갈래 이정표. 어디로 갈지 바로 정해 주는 앱이에요.',
     lambda c, a, t='#fff': f'<path d="M30 8 V58" stroke="{c}" stroke-width="5" stroke-linecap="round"/><path d="M32 14 H50 L56 20 L50 26 H32 Z" fill="{c}"/><path d="M28 30 H12 L6 36 L12 42 H28 Z" fill="{a}"/>'),
    ('말풍선 3', '말하듯 묻고 답하는 일정 만들기. AI 대화 느낌을 담았어요.',
     lambda c, a, t='#fff': f'<path d="M10 14 H54 V44 H28 L16 54 V44 H10 Z" fill="{c}" stroke-linejoin="round"/><text x="32" y="38" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="22" text-anchor="middle" fill="{t}">3</text>'
                  f'<circle cx="50" cy="14" r="6" fill="{a}"/>'),
    ('한 번 탭', '손끝이 한 번 누르면 퍼지는 세 겹 물결. ‘3초 만에’를 뜻해요.',
     lambda c, a, t='#fff': ''.join(f'<circle cx="26" cy="26" r="{r}" fill="none" stroke="{c}" stroke-width="3" opacity="{o}"/>' for r, o in ((8, 1), (15, .55), (22, .25)))
                  + f'<path d="M30 30 L52 38 L42 42 L50 54 L45 57 L37 45 L30 52 Z" fill="{a}" stroke="{t}" stroke-width="2" stroke-linejoin="round"/>'),
    ('번개 핀', '번개 모양을 품은 위치 표시. 빠르게 정해지는 목적지예요.',
     lambda c, a, t='#fff': f'<path d="M32 58 C32 58 12 38 12 24 A20 20 0 0 1 52 24 C52 38 32 58 32 58 Z" fill="{c}"/><path d="M35 12 L24 28 H32 L29 40 L40 24 H32 Z" fill="{a}"/>'),
    ('세 봉우리', '서로 다른 높이의 봉우리 셋. 세 곳의 여행지를 한 번에 넘는다는 뜻이에요.',
     lambda c, a, t='#fff': f'<path d="M4 52 L20 28 L30 40 L40 18 L60 52 Z" fill="{c}"/><path d="M34 52 L44 36 L60 52 Z" fill="{a}"/><path d="M40 18 L44 26 L36 26 Z" fill="{t}"/>'),
    ('대괄호 3', '[3] — 정돈된 기하 형태. 일정이 칸에 맞게 들어간다는 인상이에요.',
     lambda c, a, t='#fff': f'<path d="M20 10 H12 V54 H20 M44 10 H52 V54 H44" fill="none" stroke="{a}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><text x="32" y="43" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="30" text-anchor="middle" fill="{c}">3</text>'),
    ('3초 모노그램', '한글 ‘3초’를 하나의 글자처럼 묶었어요. 한국어 서비스라는 게 바로 보여요.',
     lambda c, a, t='#fff': f'<rect x="4" y="4" width="56" height="56" rx="16" fill="{c}"/><text x="32" y="41" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="24" letter-spacing="-1" text-anchor="middle" fill="{t}">3초</text>'
                  f'<rect x="18" y="46" width="28" height="3" rx="1.5" fill="{a}"/>'),
    ('여권 도장', '둥근 입국 도장. 테두리 글자 ‘3SECOND TRIP’, 가운데 3.',
     lambda c, a, t='#fff': f'<circle cx="32" cy="32" r="27" fill="none" stroke="{c}" stroke-width="3"/><circle cx="32" cy="32" r="19" fill="none" stroke="{c}" stroke-width="1.5" stroke-dasharray="2 2"/>'
                  f'<defs><path id="ring" d="M32 32 m-23 0 a23 23 0 1 1 46 0 a23 23 0 1 1 -46 0"/></defs><text font-family="Pretendard Variable,Pretendard,sans-serif" font-size="6.2" font-weight="800" letter-spacing="1.6" fill="{c}"><textPath href="#ring">3SECOND TRIP · 3SECOND TRIP ·</textPath></text>'
                  f'<text x="32" y="40" font-family="Pretendard Variable,Pretendard,sans-serif" font-weight="900" font-size="22" text-anchor="middle" fill="{a}">3</text>'),
    ('세 화살', '앞으로 겹쳐 나아가는 꺾쇠 셋. 속도와 진행을 뜻해요.',
     lambda c, a, t='#fff': ''.join(f'<path d="M{x} 16 L{x+14} 32 L{x} 48" fill="none" stroke="{col}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' for x, col in ((10, a), (24, c), (38, c)))),
    ('모래 길', '모래시계 안의 모래가 길이 되어 흘러요. 짧은 시간, 긴 여정.',
     lambda c, a, t='#fff': f'<path d="M16 8 H48 M16 56 H48" stroke="{c}" stroke-width="5" stroke-linecap="round"/><path d="M20 10 C20 26 44 26 44 10 M20 54 C20 38 44 38 44 54" fill="none" stroke="{c}" stroke-width="3.5"/>'
                  f'<path d="M32 22 V44" stroke="{a}" stroke-width="3" stroke-dasharray="0.1 5" stroke-linecap="round"/><path d="M24 54 C26 46 38 46 40 54 Z" fill="{a}"/>'),
    ('겹친 카드', '세 장이 겹친 일정 카드. 하루하루를 넘겨 보는 앱이에요.',
     lambda c, a, t='#fff': f'<rect x="20" y="8" width="32" height="40" rx="7" fill="{a}" opacity=".45" transform="rotate(10 36 28)"/><rect x="16" y="12" width="32" height="40" rx="7" fill="{a}"/>'
                  f'<rect x="12" y="16" width="32" height="40" rx="7" fill="{c}"/><path d="M19 28 H37 M19 36 H31" stroke="{t}" stroke-width="3.5" stroke-linecap="round"/><circle cx="35" cy="47" r="3.5" fill="{t}"/>'),
]


def sym(i, c=B, a=SKY, size=64):
    return f'<svg viewBox="0 0 64 64" width="{size}" height="{size}" aria-hidden="true">{SYMBOLS[i][2](c, a)}</svg>'


def tile(i, size=96, dark=False):
    """앱 아이콘 모양 — 흰 심볼을 파란 바탕에(심볼 자체가 바탕이 있는 것은 반전)"""
    bg = INK if dark else B
    inner = SYMBOLS[i][2]('#FFFFFF', SKY if not dark else '#7DB0EC', bg)
    return (f'<svg viewBox="0 0 64 64" width="{size}" height="{size}" aria-hidden="true"><rect width="64" height="64" rx="14" fill="{bg}"/>'
            f'<g transform="translate(8 8) scale(.75)">{inner}</g></svg>')


def lockup(i, dark=False):
    ink = '#EEF2F6' if dark else INK
    return (f'<div class="lock {"is-dark" if dark else ""}">{sym(i, "#9CC2F2" if dark else B, SKY if not dark else "#5B8FD6", 40)}'
            f'<span class="wm" style="color:{ink}"><b>3초</b> 여행</span></div>')


cards = []
(HERE / 'svg').mkdir(exist_ok=True)
for i, (name, desc, _) in enumerate(SYMBOLS):
    n = f'{i + 1:02d}'
    (HERE / 'svg' / f'{n}-symbol.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">{SYMBOLS[i][2](B, SKY)}</svg>', encoding='utf-8')
    (HERE / 'svg' / f'{n}-appicon.svg').write_text(tile(i).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ', 1), encoding='utf-8')
    cards.append(f'''<article class="card">
  <div class="hero">{sym(i, size=112)}</div>
  {lockup(i)}
  {lockup(i, dark=True)}
  <div class="sizes"><span>{tile(i, 56)}</span><span class="lt">{tile(i, 32)}{tile(i, 16)}</span><span class="dk">{tile(i, 32, True)}{tile(i, 16, True)}</span></div>
  <h2><em>{n}</em> {name}</h2>
  <p>{desc}</p>
</article>''')

html = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>3초 여행 로고 시안</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<style>
:root{{--bg:{BG};--ink:{INK};--mute:#556277;--line:#E1E6ED}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Pretendard Variable",Pretendard,system-ui,sans-serif}}
main{{max-width:1320px;margin:0 auto;padding:40px 24px 56px}}
h1{{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}} .lead{{margin:0 0 28px;color:var(--mute);font-size:15px;line-height:1.55}}
.grid{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}}
@media (max-width:1100px){{.grid{{grid-template-columns:repeat(2,minmax(0,1fr))}}}} @media (max-width:560px){{.grid{{grid-template-columns:1fr}}}}
.card{{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:12px}}
.hero{{display:grid;place-items:center;height:150px;background:var(--bg);border-radius:12px}}
.lock{{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px}}
.lock.is-dark{{background:#151C28;border-color:#151C28}}
.wm{{font-size:24px;font-weight:600;letter-spacing:-.03em}} .wm b{{font-weight:900}}
.sizes{{display:flex;align-items:center;gap:10px}} .sizes span{{display:inline-flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px}}
.sizes .lt{{background:var(--bg)}} .sizes .dk{{background:#151C28}}
h2{{font-size:17px;margin:4px 0 0}} h2 em{{font-style:normal;color:{B};font-size:13px;margin-right:4px}}
.card p{{margin:0;color:var(--mute);font-size:14px;line-height:1.5}}
</style></head><body><main>
<h1>3초 여행 로고 시안 20개</h1>
<p class="lead">심볼과 ‘3초 여행’ 글자를 함께 놓은 로고예요. 지난 아이콘 시안(3·핀·비행기·스톱워치·지구본 등)과 겹치지 않는 소재로 만들었어요.<br>
각 시안 아래에 밝은·어두운 바탕의 가로 로고, 앱 아이콘(56px)과 실제 탭 크기(32·16px)를 함께 보여 줘요. 번호를 알려 주시면 앱 아이콘·시작 화면·웹 로고로 다듬어 적용할게요.</p>
<div class="grid">{''.join(cards)}</div></main></body></html>'''
(HERE / 'preview.html').write_text(html, encoding='utf-8')
print('preview.html, svg/ 만들었어요:', len(SYMBOLS), '개')
