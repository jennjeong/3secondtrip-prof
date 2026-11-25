/* 3초 여행 — 같은 나라 안에서 기차·버스로 가는 구간 (화면과 무관한 순수 계산)
 *
 * 육로가 자연스러운 도시 쌍이면 역·터미널 이름, 걸리는 시간, 편도 운임을 돌려주고 아니면 null(= 지금처럼 항공).
 *  - 기차·전철: 구간 표에 같이 들어 있는 두 도시. 시간·운임은 앞 도시부터 더한 값의 차이다. 여러 줄에 있으면 위에 적은 줄.
 *  - 버스: 우리나라의 나머지 도시 쌍. 직선거리로 도로 거리·시간·운임을 어림한다.
 *  - 섬(제주·울릉·신안)과 다른 나라, 표에 없는 해외 도시 쌍은 다루지 않는다.
 * 모두 공개된 운임·소요 시간을 바탕으로 한 어림값이다. 배차와 실제 요금은 예매할 때 확인해야 한다.
 */

/* ── 이동 수단별 말 ── */
export const RIDE = {
  air:    { label: '항공', ticket: '항공권', fee: '항공비', hub: '공항',   vehicle: '항공편', sample: '예시 항공편' },
  train:  { label: '기차', ticket: '기차표', fee: '기차비', hub: '역',     vehicle: '기차',   sample: '예시 열차' },
  subway: { label: '전철', ticket: '전철',   fee: '전철비', hub: '역',     vehicle: '전철',   sample: '예시 전철' },
  bus:    { label: '버스', ticket: '버스표', fee: '버스비', hub: '터미널', vehicle: '버스',   sample: '예시 버스' },
};
/** 도착·출발 항목의 이동 수단 — 적혀 있지 않으면(예전 일정) 항공. */
export const rideMode = (a) => (a?.flightMeta?.mode && RIDE[a.flightMeta.mode] ? a.flightMeta.mode : 'air');
/** 여행 전체의 이동 수단. 아직 일정이 없는 계산에서는 g.ride 를 쓴다. */
export function rideOf(g) {
  if (g?.ride && RIDE[g.ride]) return g.ride;
  for (const d of g?.days || []) for (const a of d?.activities || []) if (a?.category === '이동' && a.flightMeta) return rideMode(a);
  return 'air';
}

/* ── 구간 표 ──  '도시 key:역 이름:누적 분:누적 운임(원)' · min 은 최저 운임 */
const L = (mode, label, row, min = 1500) => ({ mode, label, min,
  stops: row.split(', ').map(x => { const [key, name, m, f] = x.split(':'); return { key, name, min: +m, fare: +f }; }) });
export const GROUND_LINES = [
  // 우리나라
  L('subway', '수도권 전철', 'seoul:서울역:0:0, incheon:인천역:70:2000'),
  L('subway', '수인분당선', 'suwon:수원역:0:0, incheon:인천역:75:2300'),
  L('train', 'KTX', 'seoul:서울역:0:0, daejeon:대전역:60:23700, daegu:동대구역:105:43500, gyeongju:경주역:125:49300, ulsan:울산역:140:53500, busan:부산역:160:59800', 8400),
  L('train', 'KTX', 'seoul:서울역:0:0, daejeon:대전역:60:23700, daegu:동대구역:105:43500, pohang:포항역:150:53600', 8400),
  L('train', 'KTX', 'seoul:서울역:0:0, daejeon:대전역:60:23700, daegu:동대구역:105:43500, jinju:진주역:210:57800', 8400),
  L('train', 'KTX', 'seoul:용산역:0:0, iksan:익산역:70:32000, jeonju:전주역:100:34400, namwon:남원역:125:39300, suncheon:순천역:160:44300, yeosu:여수엑스포역:185:47200', 8400),
  L('train', 'KTX', 'seoul:용산역:0:0, iksan:익산역:70:32000, jeongeup:정읍역:90:39500, gwangju:광주송정역:115:46800, mokpo:목포역:155:52800', 8400),
  L('train', 'KTX', 'seoul:서울역:0:0, pyeongchang:진부역:100:21900, gangneung:강릉역:120:27600', 8400),
  L('train', 'KTX', 'seoul:서울역:0:0, pyeongchang:진부역:100:21900, donghae:동해역:160:31300', 8400),
  L('train', 'KTX-이음', 'seoul:청량리역:0:0, yangpyeong:양평역:30:8400, jecheon:제천역:70:15400, danyang:단양역:85:17800, yeongju:영주역:105:21800, andong:안동역:130:25100', 8400),
  L('train', 'KTX-이음', 'andong:안동역:0:0, gyeongju:경주역:60:13000, ulsan:태화강역:85:18000, busan:부전역:120:24000', 8400),
  L('train', 'ITX-새마을', 'seoul:서울역:0:0, suwon:수원역:30:4800, daejeon:대전역:105:16000, daegu:동대구역:200:31400, busan:부산역:285:42600', 2700),
  L('train', 'ITX-청춘', 'seoul:용산역:0:0, gapyeong:가평역:60:7300, chuncheon:춘천역:80:9900', 2700),
  L('train', 'ITX-마음', 'gangneung:강릉역:0:0, donghae:동해역:40:4800, samcheok:삼척역:55:5900, uljin:울진역:100:12000, yeongdeok:영덕역:145:17500, pohang:포항역:170:20500, gyeongju:경주역:205:24500, ulsan:태화강역:240:28500, busan:부전역:295:34900', 2700),
  L('train', '새마을호', 'seoul:용산역:0:0, boryeong:대천역:150:17500', 2700),
  L('train', '무궁화호', 'seoul:청량리역:0:0, yeongwol:영월역:150:13500, taebaek:태백역:205:18500', 2600),
  // 일본
  L('train', 'JR 요코스카선', 'tokyo:도쿄역:0:0, yokohama:요코하마역:30:4500, kamakura:가마쿠라역:55:8800'),
  L('train', 'JR 신쾌속', 'kobe:산노미야역:0:0, osaka:오사카역:25:3900, kyoto:교토역:55:10500'),
  L('train', 'JR 나라선', 'kyoto:교토역:0:0, nara:나라역:45:7000'),
  L('train', 'JR 야마토지선', 'osaka:오사카역:0:0, nara:나라역:50:7600'),
  L('train', '신칸센', 'tokyo:도쿄역:0:0, yokohama:신요코하마역:20:27000, shizuoka:시즈오카역:60:57000, nagoya:나고야역:100:105000, kyoto:교토역:135:132000, osaka:신오사카역:150:137000, kobe:신코베역:165:142000, hiroshima:히로시마역:235:180000, fukuoka:하카타역:300:215000'),
  L('train', '규슈 신칸센', 'fukuoka:하카타역:0:0, kumamoto:구마모토역:40:49000, kagoshima:가고시마추오역:80:99000'),
  L('train', '특급 소닉', 'fukuoka:하카타역:0:0, beppu:벳푸역:115:57000, oita:오이타역:130:59000'),
  L('train', '특급 유후', 'fukuoka:하카타역:0:0, yufuin:유후인역:130:48000'),
  L('train', '신칸센', 'tokyo:도쿄역:0:0, sendai:센다이역:95:105000, aomori:신아오모리역:195:164000, hakodate:신하코다테호쿠토역:260:215000'),
  L('train', '신칸센', 'tokyo:도쿄역:0:0, karuizawa:가루이자와역:70:52000, toyama:도야마역:130:119000, kanazawa:가나자와역:150:132000'),
  L('train', '로망스카', 'tokyo:신주쿠역:0:0, hakone:하코네유모토역:85:23000'),
  L('train', '도부 특급', 'tokyo:아사쿠사역:0:0, nikko:도부닛코역:110:31000'),
  L('train', '특급 아즈사', 'tokyo:신주쿠역:0:0, matsumoto:마쓰모토역:155:62000'),
  L('train', '특급 오도리코', 'tokyo:도쿄역:0:0, izu:이즈큐시모다역:160:60000'),
  L('train', '특급 시나노', 'nagoya:나고야역:0:0, matsumoto:마쓰모토역:125:57000'),
  L('train', '특급 히다', 'nagoya:나고야역:0:0, takayama:다카야마역:145:58000'),
  L('train', 'JR 하코다테선', 'sapporo:삿포로역:0:0, otaru:오타루역:35:7500'),
  L('train', '특급 호쿠토', 'sapporo:삿포로역:0:0, noboribetsu:노보리베쓰역:75:45000, hakodate:하코다테역:225:91000'),
  L('train', 'JR 산요선', 'hiroshima:히로시마역:0:0, miyajima:미야지마구치역:30:3900'),
  L('bus', '고속버스', 'tokyo:신주쿠 고속버스터미널:0:0, fujikawaguchiko:가와구치코역 정류장:110:20000'),
  L('bus', '노히버스', 'takayama:다카야마 버스터미널:0:0, shirakawago:시라카와고 버스터미널:50:26000'),
  L('bus', '호쿠테쓰버스', 'kanazawa:가나자와역 정류장:0:0, shirakawago:시라카와고 버스터미널:75:26000'),
  // 대만·중국·동남아·인도
  L('train', '고속철도', 'taipei:타이베이역:0:0, kaohsiung:쭤잉역:95:65000'),
  L('train', '고속철도', 'beijing:베이징난역:0:0, tianjin:톈진역:30:11000'),
  L('train', '고속철도', 'beijing:베이징난역:0:0, nanjing:난징난역:200:92000, suzhou:쑤저우베이역:250:122000, shanghai:상하이훙차오역:270:128000'),
  L('train', '고속철도', 'shanghai:상하이훙차오역:0:0, hangzhou:항저우둥역:60:15000'),
  L('train', '고속철도', 'guangzhou:광저우난역:0:0, shenzhen:선전베이역:35:15000'),
  L('train', '고속철도', 'chengdu:청두둥역:0:0, chongqing:충칭베이역:90:30000'),
  L('bus', '리무진 버스', 'hanoi:미딘 터미널:0:0, sapa:사파 터미널:330:22000'),
  L('bus', '리무진 버스', 'hanoi:미딘 터미널:0:0, halongbay:바이짜이 터미널:150:15000'),
  L('train', '통일열차', 'hanoi:하노이역:0:0, ninhbinh:닌빈역:130:8000'),
  L('train', '통일열차', 'hue:후에역:0:0, danang:다낭역:165:7000'),
  L('bus', '버스', 'danang:다낭 터미널:0:0, hoian:호이안 터미널:50:8000'),
  L('bus', '리무진 버스', 'hochiminh:미엔동 터미널:0:0, muine:무이네 정류장:240:12000'),
  L('bus', '리무진 버스', 'hochiminh:미엔떠이 터미널:0:0, cantho:껀터 터미널:210:10000'),
  L('train', '태국 국철', 'bangkok:끄룽텝아피왓 중앙역:0:0, ayutthaya:아유타야역:75:3000'),
  L('train', '태국 국철', 'bangkok:끄룽텝아피왓 중앙역:0:0, huahin:후아힌역:200:10000'),
  L('bus', '고속버스', 'bangkok:에까마이 터미널:0:0, pattaya:파타야 터미널:150:6000'),
  L('bus', '미니밴', 'chiangmai:치앙마이 아케이드 터미널:0:0, pai:빠이 터미널:210:9000'),
  L('train', 'ETS', 'kualalumpur:KL 센트럴역:0:0, penang:버터워스역:250:25000'),
  L('train', '고속철도 후시', 'jakarta:할림역:0:0, bandung:파달라랑역:35:25000'),
  L('bus', '고속버스', 'phnompenh:프놈펜 터미널:0:0, siemreap:시엠립 터미널:330:22000'),
  L('train', '고속철도', 'vientiane:비엔티안역:0:0, luangprabang:루앙프라방역:120:35000'),
  L('train', '가티만 특급', 'delhi:하즈라트 니자무딘역:0:0, agra:아그라 칸트역:100:15000'),
  L('train', '샤타브디 특급', 'delhi:뉴델리역:0:0, jaipur:자이푸르역:270:18000'),
  L('train', '스리랑카 국철', 'colombo:콜롬보 포트역:0:0, kandy:캔디역:180:5000'),
  L('train', '스리랑카 국철', 'colombo:콜롬보 포트역:0:0, galle:골역:150:4000'),
  // 유럽
  L('train', 'TGV', 'paris:파리 리옹역:0:0, lyon:리옹 파르디외역:120:90000, avignon:아비뇽 TGV역:165:105000, marseille:마르세유 생샤를역:195:115000, cannes:칸역:315:125000, nice:니스역:345:135000'),
  L('train', 'TGV', 'paris:파리 동역:0:0, reims:랭스역:45:45000, strasbourg:스트라스부르역:110:95000'),
  L('train', 'TGV', 'paris:파리 몽파르나스역:0:0, tours:생피에르데코르역:70:55000, bordeaux:보르도 생장역:130:100000'),
  L('train', 'LNER', 'london:런던 킹스크로스역:0:0, york:요크역:115:110000, edinburgh:에든버러 웨이벌리역:260:140000'),
  L('train', 'Avanti', 'london:런던 유스턴역:0:0, manchester:맨체스터 피커딜리역:130:110000'),
  L('train', 'Avanti', 'london:런던 유스턴역:0:0, liverpool:리버풀 라임스트리트역:135:100000'),
  L('train', 'Avanti', 'london:런던 유스턴역:0:0, glasgow:글래스고 중앙역:270:140000'),
  L('train', 'GWR', 'london:런던 패딩턴역:0:0, oxford:옥스퍼드역:55:50000'),
  L('train', 'GWR', 'london:런던 패딩턴역:0:0, bath:바스 스파역:80:75000'),
  L('train', '영국 철도', 'london:런던 킹스크로스역:0:0, cambridge:케임브리지역:50:45000'),
  L('train', '영국 철도', 'london:런던 빅토리아역:0:0, brighton:브라이튼역:60:35000'),
  L('train', 'ScotRail', 'glasgow:글래스고 퀸스트리트역:0:0, edinburgh:에든버러 웨이벌리역:50:27000'),
  L('train', '이탈로·프레차로사', 'turin:토리노 포르타누오바역:0:0, milan:밀라노 중앙역:60:45000, bologna:볼로냐 중앙역:125:90000, florence:피렌체 산타마리아노벨라역:165:105000, rome:로마 테르미니역:260:150000'),
  L('train', '이탈로·프레차로사', 'milan:밀라노 중앙역:0:0, rome:로마 테르미니역:195:125000, naples:나폴리 중앙역:270:140000'),
  L('train', '이탈로·프레차로사', 'florence:피렌체 산타마리아노벨라역:0:0, naples:나폴리 중앙역:175:85000'),
  L('train', '이탈로·프레차로사', 'milan:밀라노 중앙역:0:0, verona:베로나 포르타누오바역:75:35000, venice:베네치아 산타루치아역:145:60000'),
  L('train', '이탈로·프레차로사', 'venice:베네치아 산타루치아역:0:0, bologna:볼로냐 중앙역:90:45000, florence:피렌체 산타마리아노벨라역:130:70000, rome:로마 테르미니역:230:115000'),
  L('train', '지역 열차', 'florence:피렌체 산타마리아노벨라역:0:0, pisa:피사 중앙역:60:15000'),
  L('train', '지역 열차', 'florence:피렌체 산타마리아노벨라역:0:0, siena:시에나역:90:16000'),
  L('train', '지역 열차', 'milan:밀라노 중앙역:0:0, como:코모 산조반니역:40:9000'),
  L('train', '인터시티', 'milan:밀라노 중앙역:0:0, genoa:제노바 피아차프린치페역:100:25000, cinqueterre:몬테로소역:180:45000'),
  L('train', 'AVE', 'madrid:마드리드 아토차역:0:0, cordoba:코르도바역:105:90000, seville:세비야 산타후스타역:155:105000'),
  L('train', 'AVE', 'madrid:마드리드 아토차역:0:0, cordoba:코르도바역:105:90000, malaga:말라가 마리아삼브라노역:160:110000'),
  L('train', 'AVE', 'madrid:마드리드 아토차역:0:0, barcelona:바르셀로나 산츠역:150:110000'),
  L('train', 'AVE', 'madrid:마드리드 차마르틴역:0:0, valencia:발렌시아 호아킨소로야역:110:75000'),
  L('train', 'AVE', 'madrid:마드리드 아토차역:0:0, granada:그라나다역:200:100000'),
  L('train', 'Avant', 'madrid:마드리드 아토차역:0:0, toledo:톨레도역:35:24000'),
  L('train', '유로메드', 'barcelona:바르셀로나 산츠역:0:0, valencia:발렌시아 호아킨소로야역:170:60000'),
  L('train', '알파 펜둘라르', 'lisbon:리스본 산타아폴로니아역:0:0, porto:포르투 캄파냐역:175:55000'),
  L('train', '포르투갈 철도', 'lisbon:리스본 호시우역:0:0, sintra:신트라역:40:4000'),
  L('train', '포르투갈 철도', 'lisbon:리스본 오리엔트역:0:0, lagos:라고스역:240:45000'),
  L('train', '네덜란드 철도', 'amsterdam:암스테르담 중앙역:0:0, thehague:헤이그 중앙역:50:22000, rotterdam:로테르담 중앙역:75:27000'),
  L('train', '벨기에 철도', 'brussels:브뤼셀 중앙역:0:0, antwerp:안트베르펜 중앙역:45:13000'),
  L('train', '벨기에 철도', 'brussels:브뤼셀 중앙역:0:0, bruges:브뤼헤역:60:27000'),
  L('train', '스위스 철도', 'geneva:제네바 코르나뱅역:0:0, bern:베른역:105:87000, zurich:취리히 중앙역:165:150000'),
  L('train', '스위스 철도', 'zurich:취리히 중앙역:0:0, lucerne:루체른역:45:45000, interlaken:인터라켄 동역:155:102000'),
  L('train', '스위스 철도', 'zurich:취리히 중앙역:0:0, basel:바젤 SBB역:55:58000'),
  L('train', '스위스 철도', 'basel:바젤 SBB역:0:0, bern:베른역:55:70000, interlaken:인터라켄 동역:110:120000'),
  L('train', 'ICE', 'berlin:베를린 중앙역:0:0, leipzig:라이프치히 중앙역:75:70000, nuremberg:뉘른베르크 중앙역:180:125000, munich:뮌헨 중앙역:245:165000'),
  L('train', 'ICE', 'frankfurt:프랑크푸르트 중앙역:0:0, stuttgart:슈투트가르트 중앙역:80:90000, munich:뮌헨 중앙역:195:140000'),
  L('train', 'ICE', 'frankfurt:프랑크푸르트 중앙역:0:0, cologne:쾰른 중앙역:65:95000'),
  L('train', 'ICE', 'frankfurt:프랑크푸르트 중앙역:0:0, heidelberg:하이델베르크 중앙역:50:40000'),
  L('train', 'ICE', 'frankfurt:프랑크푸르트 중앙역:0:0, berlin:베를린 중앙역:250:170000'),
  L('train', 'ICE', 'berlin:베를린 중앙역:0:0, hamburg:함부르크 중앙역:110:110000'),
  L('train', 'EC', 'berlin:베를린 중앙역:0:0, dresden:드레스덴 중앙역:115:65000'),
  L('train', 'ICE', 'cologne:쾰른 중앙역:0:0, hamburg:함부르크 중앙역:240:120000'),
  L('train', '독일 철도', 'cologne:쾰른 중앙역:0:0, bonn:본 중앙역:25:14000'),
  L('train', '레일젯', 'vienna:빈 중앙역:0:0, salzburg:잘츠부르크 중앙역:145:95000, innsbruck:인스브루크 중앙역:255:125000'),
  L('train', '레일젯', 'vienna:빈 중앙역:0:0, graz:그라츠 중앙역:155:65000'),
  L('train', '오스트리아 철도', 'salzburg:잘츠부르크 중앙역:0:0, hallstatt:할슈타트역:150:45000'),
  L('train', '폴란드 철도', 'warsaw:바르샤바 중앙역:0:0, krakow:크라쿠프 중앙역:150:55000'),
  L('train', '폴란드 철도', 'warsaw:바르샤바 중앙역:0:0, gdansk:그단스크 중앙역:165:55000'),
  L('train', '스웨덴 철도', 'stockholm:스톡홀름 중앙역:0:0, gothenburg:예테보리 중앙역:190:85000'),
  L('train', '스웨덴 철도', 'stockholm:스톡홀름 중앙역:0:0, malmo:말뫼 중앙역:270:100000'),
  L('train', '덴마크 철도', 'copenhagen:코펜하겐 중앙역:0:0, aarhus:오르후스 중앙역:180:85000'),
  L('train', '핀란드 철도', 'helsinki:헬싱키 중앙역:0:0, tampere:탐페레역:105:45000'),
  L('train', '아일랜드 철도', 'dublin:더블린 휴스턴역:0:0, galway:골웨이역:150:40000'),
  L('train', '리투아니아 철도', 'vilnius:빌뉴스역:0:0, kaunas:카우나스역:75:12000'),
  L('bus', '시외버스', 'ljubljana:류블랴나 터미널:0:0, bled:블레드 정류장:75:10000'),
  L('bus', '시외버스', 'sofia:소피아 중앙 터미널:0:0, plovdiv:플로브디프 남부 터미널:120:13000'),
  L('bus', '시외버스', 'split:스플리트 터미널:0:0, dubrovnik:두브로브니크 터미널:270:35000'),
  L('train', '보스니아 철도', 'sarajevo:사라예보역:0:0, mostar:모스타르역:120:11000'),
  L('train', '삽산', 'moscow:모스크바 레닌그라드역:0:0, stpetersburg:상트페테르부르크 모스크바역:240:100000'),
  // 미주·중동·오세아니아·그 밖
  L('train', '암트랙', 'boston:보스턴 사우스역:0:0, nyc:뉴욕 펜역:235:120000, philadelphia:필라델피아 30번가역:320:190000, washington:워싱턴 유니언역:440:260000'),
  L('train', 'VIA 레일', 'toronto:토론토 유니언역:0:0, ottawa:오타와역:270:110000'),
  L('train', 'VIA 레일', 'ottawa:오타와역:0:0, montreal:몬트리올 중앙역:120:65000'),
  L('train', 'VIA 레일', 'montreal:몬트리올 중앙역:0:0, quebec:퀘벡 팔레역:200:75000'),
  L('bus', '고속버스', 'vancouver:밴쿠버 시내 정류장:0:0, whistler:휘슬러 빌리지 정류장:120:45000'),
  L('bus', '고속버스', 'calgary:캘거리 시내 정류장:0:0, banff:밴프 정류장:110:70000'),
  L('bus', 'ADO 버스', 'cancun:칸쿤 ADO 터미널:0:0, playadelcarmen:플라야델카르멘 ADO 터미널:75:10000, tulum:툴룸 ADO 터미널:140:18000'),
  L('bus', '고속버스', 'santiagocl:산티아고 알라메다 터미널:0:0, valparaiso:발파라이소 터미널:105:9000'),
  L('train', '이스라엘 철도', 'telaviv:텔아비브 하가나역:0:0, jerusalem:예루살렘 나본역:40:9000'),
  L('bus', '시외버스', 'amman:암만 JETT 터미널:0:0, petra:페트라 정류장:240:25000'),
  L('bus', '시외버스', 'dubai:이븐바투타 정류장:0:0, abudhabi:아부다비 중앙 터미널:110:10000'),
  L('train', '모로코 철도', 'casablanca:카사 보야저역:0:0, marrakech:마라케시역:160:25000'),
  L('train', '모로코 철도', 'casablanca:카사 보야저역:0:0, fez:페즈역:225:25000'),
  L('train', '아프로시욥', 'tashkent:타슈켄트역:0:0, samarkand:사마르칸트역:130:25000, bukhara:부하라역:230:35000'),
  L('bus', '고속버스', 'sydney:시드니 센트럴 정류장:0:0, canberra:캔버라 졸리몬트 정류장:210:45000'),
  L('train', '골드코스트선', 'brisbane:브리즈번 로마스트리트역:0:0, goldcoast:헬렌스베일역:65:10000'),
  L('bus', '인터시티 버스', 'auckland:오클랜드 정류장:0:0, rotorua:로토루아 정류장:230:35000'),
];
// 기차로 이보다 오래 걸리면(해외) 비행기가 자연스럽다 — 예: 도쿄 → 후쿠오카 5시간
const TRAIN_MAX = 280;

/* ── 우리나라 버스 ──  key: 위도, 경도, 터미널, 서울에서 타는 터미널 */
const [E, C, K, N] = ['동서울종합터미널', '센트럴시티터미널', '서울고속버스터미널', '서울남부터미널'];
const BUS = {
  seoul: [37.5665, 126.978, K], busan: [35.1796, 129.0756, '부산종합버스터미널', K], gangneung: [37.7519, 128.8761, '강릉고속버스터미널', K],
  gyeongju: [35.8562, 129.2247, '경주고속버스터미널', K], sokcho: [38.207, 128.5918, '속초고속버스터미널', K], jeonju: [35.8242, 127.148, '전주고속버스터미널', C],
  yeosu: [34.7604, 127.6622, '여수종합버스터미널', C], incheon: [37.4563, 126.7052, '인천종합터미널', K], daegu: [35.8714, 128.6014, '동대구터미널', K],
  daejeon: [36.3504, 127.3845, '대전복합터미널', K], gwangju: [35.1595, 126.8526, '광주종합버스터미널', C], ulsan: [35.5384, 129.3114, '울산고속버스터미널', K],
  suwon: [37.2636, 127.0286, '수원종합버스터미널', K], chuncheon: [37.8813, 127.7298, '춘천시외버스터미널', E], andong: [36.5684, 128.7294, '안동터미널', E],
  pohang: [36.019, 129.3435, '포항고속버스터미널', K], tongyeong: [34.8544, 128.4332, '통영종합버스터미널', N], geoje: [34.8806, 128.6211, '거제고현버스터미널', N],
  namhae: [34.8375, 127.8924, '남해공용터미널', N], cheongju: [36.6424, 127.489, '청주고속버스터미널', K], danyang: [36.9845, 128.3655, '단양시외버스터미널', E],
  chungju: [36.991, 127.9259, '충주공용버스터미널', E], yangyang: [38.0754, 128.6189, '양양종합여객터미널', K], pyeongchang: [37.6355, 128.5594, '진부시외버스터미널', E],
  jeongseon: [37.3806, 128.6608, '정선버스터미널', E], donghae: [37.5247, 129.1143, '동해종합버스터미널', K], samcheok: [37.4499, 129.1652, '삼척종합버스터미널', K],
  gunsan: [35.9676, 126.7369, '군산고속버스터미널', C], iksan: [35.9483, 126.9576, '익산고속버스터미널', C], buyeo: [36.2757, 126.9098, '부여시외버스터미널', N],
  gongju: [36.4465, 127.119, '공주종합버스터미널', K], boryeong: [36.3334, 126.6128, '보령종합터미널', C], taean: [36.7456, 126.298, '태안공영버스터미널', C],
  seosan: [36.7849, 126.4503, '서산공용버스터미널', C], gapyeong: [37.8315, 127.5097, '가평터미널', E], yangpyeong: [37.4917, 127.4874, '양평시외버스터미널', E],
  ganghwa: [37.7468, 126.4879, '강화여객자동차터미널', '신촌 광역버스 정류장'], mokpo: [34.8118, 126.3922, '목포종합버스터미널', C], damyang: [35.3212, 126.9882, '담양공용버스터미널', C],
  suncheon: [34.9506, 127.4872, '순천종합버스터미널', C], goesan: [36.8154, 127.7867, '괴산시외버스터미널', E], inje: [38.0697, 128.1707, '인제시외버스터미널', E],
  hongcheon: [37.6971, 127.8885, '홍천종합버스터미널', E], jinju: [35.18, 128.1076, '진주고속버스터미널', K], gimhae: [35.2285, 128.8894, '김해여객터미널', K],
  jinhae: [35.1497, 128.66, '진해시외버스터미널', N], sacheon: [34.93, 128.07, '삼천포터미널', N], hadong: [35.0672, 127.7514, '하동버스터미널', N],
  gwangyang: [34.9407, 127.6959, '광양버스터미널', C], boseong: [34.7714, 127.08, '보성버스터미널', C], haenam: [34.5735, 126.5993, '해남종합버스터미널', C],
  wando: [34.311, 126.755, '완도공용버스터미널', C], jindo: [34.4869, 126.2635, '진도공용터미널', C], namwon: [35.4164, 127.3904, '남원고속버스터미널', C],
  jeongeup: [35.5699, 126.856, '정읍공용버스터미널', C], buan: [35.7317, 126.7332, '부안종합버스터미널', C], jecheon: [37.1326, 128.191, '제천터미널', E],
  yeongwol: [37.1837, 128.4618, '영월버스터미널', E], taebaek: [37.164, 128.9856, '태백버스터미널', E], yeongdeok: [36.415, 129.3657, '영덕터미널', E],
  uljin: [36.9931, 129.4004, '울진종합버스터미널', E], yeongju: [36.8057, 128.6241, '영주종합터미널', E], 'goseong-gw': [38.3806, 128.4679, '간성터미널', E],
};
const up = (n, unit) => Math.ceil(n / unit) * unit;
function busRoute(from, to) {
  const a = BUS[from], b = BUS[to];
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const s = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  const road = 2 * 6371 * Math.asin(Math.sqrt(s)) * 1.1 + 30;     // 도로 거리 어림
  return { mode: 'bus', label: '고속·시외버스', from: from === 'seoul' ? b[3] : a[2], to: to === 'seoul' ? a[3] : b[2],
    minutes: Math.max(30, up(10 + road / 88 * 60, 5)), fare: Math.max(2000, up(road * 110, 100)) };
}

/** 육로 구간 — { mode, label, from, to, minutes, fare(1인 편도·원) } 또는 null */
export function groundRoute(t) {
  const from = t?.origin, to = t?.city;
  if (!from || !to || from === to) return null;
  for (const l of GROUND_LINES) {
    const a = l.stops.find(s => s.key === from), b = l.stops.find(s => s.key === to);
    if (!a || !b) continue;
    const minutes = Math.abs(a.min - b.min);
    if (l.mode === 'train' && !BUS[from] && minutes > TRAIN_MAX) continue;
    return { mode: l.mode, label: l.label, from: a.name, to: b.name, minutes, fare: Math.max(l.min, Math.abs(a.fare - b.fare)) };
  }
  return busRoute(from, to);
}
