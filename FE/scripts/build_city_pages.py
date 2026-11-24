#!/usr/bin/env python3
"""공유·검색용 여행 코스 페이지(trips/*.html)와 sitemap.xml 을 만든다.

앱의 코스 상세는 #주소라서 카카오톡·슬랙 같은 미리보기가 코스마다 다른 제목을 읽지 못한다.
그래서 예시 코스마다 정적 페이지를 만들어 제목·설명·미리보기와 날짜별 코스를 담고,
앱의 같은 코스로 이어지는 버튼을 둔다.  코스 상세의 '공유'는 이 주소를 보낸다.

날짜별 일정은 앱과 같은 데이터(js/redesign-course-samples.js)를 node 로 읽어 쓴다.

사용법: python3 FE/scripts/build_city_pages.py
"""
import json
import subprocess
from html import escape
from pathlib import Path

SITE = "https://3secondtrip-prof.vercel.app"
FE = Path(__file__).resolve().parent.parent

# BE/app/db/seed.py 의 예시 코스와 같은 목록 (slug, 도시, 나라, 일수, 제목, 여행 스타일)
COURSES = [
    ("tokyo", "도쿄", "일본", 3, "도쿄 3일 감성 로드맵", "균형"),
    ("paris", "파리", "프랑스", 4, "파리 첫 여행 로드맵", "프리미엄"),
    ("jeju", "제주", "대한민국", 3, "제주 힐링 드라이브", "힐링"),
    ("osaka", "오사카", "일본", 3, "오사카 먹부림 3일", "가성비"),
    ("bangkok", "방콕", "태국", 4, "방콕 야경 & 카페", "액티비티"),
    ("seoul", "서울", "대한민국", 2, "서울 핫플 2일", "효율"),
    ("newyork", "뉴욕", "미국", 5, "뉴욕 5일 시그니처", "프리미엄"),
    ("sydney", "시드니", "호주", 4, "시드니 자연 탐험", "액티비티"),
]

NODE_READ = r"""
const fs = require('fs');
let src = fs.readFileSync(process.argv[1], 'utf8').replace(/export\s+(const|function)/g, '$1');
const SAMPLE_COURSES = new Function(src + '; return SAMPLE_COURSES;')();
process.stdout.write(JSON.stringify(SAMPLE_COURSES));
"""

PAGE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{title} · {place} {nights} 여행 코스 · 3초 여행</title>
<meta name="description" content="{desc}"/>
<link rel="canonical" href="{url}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="3초 여행"/>
<meta property="og:title" content="{title} · {nights} 여행 코스"/>
<meta property="og:description" content="{desc}"/>
<meta property="og:url" content="{url}"/>
<meta property="og:image" content="{site}/assets/og-image.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg?v=plane1"/>
<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=plane1"/>
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png?v=plane1"/>
<style>
body{{margin:0;background:#F5F6F8;color:#15181D;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif}}
main{{max-width:640px;margin:0 auto;padding:40px 16px 56px}}
.place{{margin:0;color:#5F6670;font-weight:600}}
h1{{font-size:28px;line-height:1.25;margin:4px 0 8px}}
.meta{{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;padding:0;list-style:none}}
.meta li{{background:#fff;border:1px solid #E2E5EA;border-radius:999px;padding:4px 12px;font-size:14px}}
.note{{font-size:14px;color:#5F6670}}
.cost{{background:#fff;border:1px solid #E2E5EA;border-radius:16px;padding:14px 16px;margin:16px 0}}
.cost strong{{font-size:20px}}
.cost p{{margin:4px 0;font-size:14px;color:#5F6670}}
h2{{font-size:18px;margin:24px 0 8px}}
ol{{list-style:none;margin:0;padding:0}}
li.stop{{background:#fff;border:1px solid #E2E5EA;border-radius:14px;padding:10px 14px;margin:0 0 6px;display:flex;gap:12px}}
li.stop b{{min-width:48px;font-variant-numeric:tabular-nums}}
li.stop small{{display:block;color:#646B75}}
li.move{{margin:0 0 6px 24px;padding-left:12px;border-left:2px dashed #E2E5EA;font-size:13px;color:#5F6670}}
a.cta{{display:block;background:#111418;color:#fff;text-align:center;text-decoration:none;font-weight:700;padding:14px;border-radius:14px;margin:28px 0 10px}}
a.sub{{display:block;text-align:center;color:#15181D;font-weight:600;padding:12px}}
a:focus-visible{{outline:2px solid #3A6EA5;outline-offset:2px}}
</style>
</head>
<body>
<main>
<p class="place">{place}</p>
<h1>{title}</h1>
<ul class="meta"><li>{nights}</li><li>{concept} 스타일</li><li>예시 코스</li></ul>
<p class="note">{tagline}. 3초 여행 운영팀이 만든 예시 코스예요.</p>
<section class="cost" aria-labelledby="costH">
<h2 id="costH" style="margin:0 0 4px;font-size:15px;color:#5F6670">예상 비용</h2>
<strong>성인 1명 약 {cost}만 원</strong>
<p>{cost_note}</p>
<p>출처: 3초 여행 예시 기준(2026년, 대중교통·중간 가격대 숙소). 실제 가격은 날짜와 환율에 따라 달라요.</p>
</section>
{days_html}
<a class="cta" href="/index-redesign.html#page=roadmap-detail&amp;city={city_q}">이 코스를 앱에서 보기</a>
<a class="sub" href="/index-redesign.html#page=create-trip">내 날짜와 예산으로 새 여행 만들기</a>
</main>
</body>
</html>
"""


def nights_label(days: int) -> str:
    return f"{days - 1}박 {days}일" if days > 1 else "당일치기"


def days_html(plan) -> str:
    out = []
    for i, day in enumerate(plan):
        rows = []
        for j, s in enumerate(day):
            rows.append(f'<li class="stop"><b>{escape(s["time"])}</b><span>{escape(s["name"])}<small>{escape(s["cat"])}</small></span></li>')
            if s.get("move") and j < len(day) - 1:
                rows.append(f'<li class="move">다음 장소까지 {escape(s["move"])}</li>')
        out.append(f'<section><h2>{i + 1}일차</h2><ol>{"".join(rows)}</ol></section>')
    return "\n".join(out)


def main() -> None:
    samples = json.loads(subprocess.check_output(
        ["node", "-e", NODE_READ, str(FE / "js" / "redesign-course-samples.js")], text=True))
    out = FE / "trips"
    out.mkdir(exist_ok=True)
    urls = [f"{SITE}/"]
    for slug, city, country, days, title, concept in COURSES:
        s = samples[city]
        url = f"{SITE}/trips/{slug}.html"
        nights = nights_label(days)
        desc = f"{city} {nights} {concept} 여행 코스 — {s['tagline']}. 날짜별 장소와 이동 시간, 예상 비용을 확인하고 내 일정으로 만들어 보세요."
        html = PAGE.format(
            site=SITE, url=url, title=escape(title), place=escape(f"{city} · {country}"),
            nights=nights, concept=escape(concept), tagline=escape(s["tagline"]), desc=escape(desc),
            cost=round(s["cost"]["amount"] / 10000), cost_note=escape(s["cost"]["note"]),
            days_html=days_html(s["days"]), city_q=escape(city),
        )
        (out / f"{slug}.html").write_text(html, encoding="utf-8")
        urls.append(url)
    entries = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    (FE / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{entries}\n</urlset>\n',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
