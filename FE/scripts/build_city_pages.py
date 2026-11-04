#!/usr/bin/env python3
"""검색 노출용 도시 소개 페이지와 sitemap.xml 을 만든다.

사용법: python3 FE/scripts/build_city_pages.py
"""
from html import escape
from pathlib import Path

SITE = "https://3secondtrip-prof.vercel.app"
FE = Path(__file__).resolve().parent.parent

# BE/app/db/seed.py 의 인기 도시와 같은 목록
CITIES = [
    ("tokyo", "도쿄", "일본", 3, "시부야부터 아사쿠사까지"),
    ("paris", "파리", "프랑스", 4, "에펠탑·루브르·몽마르트"),
    ("jeju", "제주", "대한민국", 3, "바람·바다·돌담길"),
    ("osaka", "오사카", "일본", 3, "도톤보리·신세카이·우메다"),
    ("bangkok", "방콕", "태국", 4, "야경과 카페"),
    ("seoul", "서울", "대한민국", 2, "요즘 뜨는 동네"),
    ("newyork", "뉴욕", "미국", 5, "맨해튼 대표 코스"),
    ("sydney", "시드니", "호주", 4, "항구와 해안 산책"),
]

PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{city} 여행 일정 {days}일 추천 · 3초 여행</title>
<meta name="description" content="{city} {days}일 여행 일정을 3초 만에 만들어 보세요. {tagline}. 날짜와 예산에 맞춰 실제 장소로 코스를 짜 드려요."/>
<link rel="canonical" href="{site}/trips/{slug}.html"/>
<meta property="og:title" content="{city} 여행 일정 {days}일 추천 · 3초 여행"/>
<meta property="og:description" content="{tagline}"/>
<meta property="og:image" content="{site}/assets/og-image.png"/>
<link rel="icon" type="image/png" href="/assets/favicon.png"/>
<style>
body{{margin:0;background:#F2F4F7;color:#1D1D1F;font:16px/1.7 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}}
main{{max-width:560px;margin:0 auto;padding:48px 20px}}
h1{{font-size:28px;line-height:1.3;margin:0 0 12px}}
a.cta{{display:block;background:#2B3440;color:#fff;text-align:center;text-decoration:none;font-weight:700;padding:14px;border-radius:14px;margin:24px 0}}
ul{{padding-left:20px}}
</style>
</head>
<body>
<main>
<h1>{city} {days}일 여행 일정</h1>
<p>{country} {city} 여행을 계획 중이라면 3초 여행으로 일정을 만들어 보세요. {tagline}까지, 날짜와 예산에 맞춰 하루하루 코스를 짜 드립니다.</p>
<ul>
<li>실제 장소 데이터로 시간대별 코스 구성</li>
<li>지도에서 동선을 확인하고 순서 변경</li>
<li>날씨, 환율, 경비 기록, 준비물까지 한곳에서</li>
</ul>
<a class="cta" href="/index-redesign.html#page=create-trip">{city} 일정 만들기</a>
</main>
</body>
</html>
"""


def main() -> None:
    out = FE / "trips"
    out.mkdir(exist_ok=True)
    urls = [f"{SITE}/"]
    for slug, city, country, days, tagline in CITIES:
        html = PAGE.format(
            site=SITE, slug=slug, city=escape(city), country=escape(country),
            days=days, tagline=escape(tagline),
        )
        (out / f"{slug}.html").write_text(html, encoding="utf-8")
        urls.append(f"{SITE}/trips/{slug}.html")
    entries = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    (FE / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{entries}\n</urlset>\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
