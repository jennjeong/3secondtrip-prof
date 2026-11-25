// 실행: node --test tests/fe/local.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from '../../FE/js/redesign-cities.js';
import { localQuery, localScore, rankLocal, famousIndex, langOf, slotKind, cityInLang, localMix, modeOf } from '../../FE/js/redesign-local.js';
import { SAMPLE_COURSES } from '../../FE/js/redesign-course-samples.js';

const city = (n) => CITIES.find(c => c.name === n);
const P = (o) => ({ place_id: o.name, latitude: 35.7, longitude: 139.7, types: ['restaurant'], rating: 4.3, user_rating_count: 300, ...o });

test('현지어로 묻는다 — 일본은 일본어, 국내는 한국어, 모르는 나라는 영어', () => {
  assert.match(localQuery('lunch', { city: city('도쿄'), country: '일본' }), /定食|大衆/);
  assert.match(localQuery('lunch', { city: city('강릉'), country: '대한민국' }), /^강릉 .*(동네|노포)/);
  assert.equal(langOf('아이슬란드'), 'en');
  assert.match(cityInLang(city('교토'), 'ja'), /京都/);
});
test('모든 도시·모든 자리에 검색어가 있고, 관광지를 부르는 말이 없다', () => {
  const bad = /관광 ?명소|랜드마크|landmark|tourist attraction|観光名所|景点 排行|mirador turístico/i;
  for (const c of CITIES) for (const s of ['morning', 'forenoon', 'lunch', 'afternoon', 'evening', 'dinner', 'activity', 'spa', 'shopping', 'premium']) for (const round of [0, 1]) {
    const q = localQuery(s, { city: c, country: c.country, round });
    assert.ok(q.length > 4 && q.length < 120 && !bad.test(q), `${c.name} ${s}: ${q}`);
  }
});
test('세부 스타일이 실제로 검색어를 바꾼다', () => {
  assert.equal(slotKind('evening', ['사진 명소']), 'photo');
  assert.equal(slotKind('forenoon', ['자연 중심']), 'nature');
  assert.equal(slotKind('afternoon', ['맛집 중심']), 'food');
  assert.equal(slotKind('forenoon', ['쇼핑 중심']), 'shopping');
  assert.equal(slotKind('evening', []), 'evening');
});
test('식사 조건은 식당 자리에만 붙는다', () => {
  assert.match(localQuery('dinner', { city: city('파리'), country: '프랑스', needs: ['veg'] }), /vegetarian/);
  assert.doesNotMatch(localQuery('forenoon', { city: city('파리'), country: '프랑스', needs: ['veg'] }), /vegetarian/);
});
test('대표 관광지·후기가 지나치게 많은 곳·체인·기념품점은 뒤로, 동네 가게는 앞으로', () => {
  const famous = famousIndex([P({ name: '센소지', types: ['tourist_attraction'], user_rating_count: 90000 })]);
  const list = [
    P({ name: '센소지', types: ['tourist_attraction', 'park'], user_rating_count: 90000 }),
    P({ name: '스타벅스 시부야', types: ['coffee_shop'], user_rating_count: 5000 }),
    P({ name: '도쿄 투어 기념품', types: ['gift_shop'], user_rating_count: 200 }),
    P({ name: '네즈 동네 식당', types: ['diner'], user_rating_count: 240 }),
    P({ name: '캡슐 호텔', types: ['hotel'], user_rating_count: 240 }),
  ];
  const out = rankLocal(list, { famous, food: true });
  assert.equal(out[0].name, '네즈 동네 식당');
  assert.equal(out[0]._local.kind, 'local');
  assert.ok(!out.some(p => p.name === '센소지'));
  assert.equal(localScore(list[0], { famous }).kind, 'famous');
  assert.ok(localScore(list[1], { famous, food: true }).score < 0);
});
test('유명한 곳뿐이면 비우지 않고 그대로 둔다', () => {
  const one = [P({ name: '에펠탑', types: ['tourist_attraction'], user_rating_count: 400000 })];
  assert.equal(rankLocal(one, { famous: famousIndex(one) }).length, 1);
});
test('구성 요약과 기본값', () => {
  assert.equal(modeOf({}), 'local'); assert.equal(modeOf({ placeMode: 'mix' }), 'mix');
  assert.deepEqual(localMix({ days: [{ activities: [{ category: '식사', local: 'local' }, { category: '관광', local: 'famous' }, { category: '숙박' }, { category: '식사', sample: true }] }] }), { total: 2, local: 1, famous: 1 });
});
test('예시 코스에 대표 관광지가 없다', () => {
  const all = JSON.stringify(SAMPLE_COURSES);
  for (const n of ['스카이트리', '센소지', '에펠탑', '루브르', '성산일출봉', '도톤보리', '유니버설', '왓 포', '경복궁', '타임스스퀘어', '자유의 여신상', '오페라하우스', '본다이']) assert.ok(!all.includes(n), n);
});
