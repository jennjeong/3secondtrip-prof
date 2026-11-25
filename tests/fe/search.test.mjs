// 다국어 자동완성 — 실행: node --test tests/fe/search.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex, matchRank, normalize, foldKey, sameText, toStrokes, RANK } from '../../FE/js/redesign-search.js';
import { CITIES, searchCities } from '../../FE/js/redesign-cities.js';

const names = (q, n = 8) => searchCities(q, n).map(c => c.name);
const cls = (text, q) => Math.floor(matchRank(text, q));
const WORLD = ['New York', 'Newcastle', 'Café de Flore', 'Cafe Central', 'Paris', 'São Paulo', '인천', '인제', '東京都', '東京タワー', '北京市', '京都市', 'القاهرة', 'กรุงเทพมหานคร', 'Москва', 'Đà Nẵng', 'दिल्ली', 'İstanbul', 'Straße 7'];
const ix = createSearchIndex(WORLD);
const find = (q) => ix.search(q).map(r => r.item);

test('요청한 검증 케이스', () => {
  assert.equal(find('new')[0], 'New York');
  assert.deepEqual(find('cafe').sort(), ['Cafe Central', 'Café de Flore'].sort());
  assert.equal(find('par')[0], 'Paris');
  assert.ok(find('인').includes('인천'));
  assert.deepEqual(find('인ㅊ'), ['인천']);
  assert.equal(find('東京')[0], '東京都');
  assert.ok(find('東京').includes('東京タワー'));
  assert.deepEqual(find('北京'), ['北京市']);
});

test('도시 검색에서도 같은 케이스', () => {
  assert.equal(names('new')[0], '뉴욕');
  assert.equal(names('NEW   york')[0], '뉴욕');
  assert.equal(names('par')[0], '파리');
  assert.equal(names('인')[0], '인천');
  assert.deepEqual(names('인ㅊ'), ['인천']);
  for (const q of ['東京', '東京都']) assert.equal(names(q)[0], '도쿄');
  for (const q of ['北京', '北京市']) assert.equal(names(q)[0], '베이징');
  for (const [q, n] of [['sao', '상파울루'], ['munchen', '뮌헨'], ['münch', '뮌헨'], ['xian', '시안'], ['القا', '카이로'], ['мос', '모스크바'], ['กรุง', '방콕'], ['दिल', '델리'], ['newyork', '뉴욕'], ['st. pe', '상트페테르부르크']]) assert.equal(names(q)[0], n, q);
});

test('정규화 — 대소문자·공백·전각·NFD·보이지 않는 글자', () => {
  assert.equal(normalize('  New   YORK '), 'new york');
  assert.equal(normalize('ＴＯＫＹＯ'), 'tokyo');
  assert.equal(normalize('인천'.normalize('NFD')), '인천');
  assert.equal(normalize('ﾄｳｷｮｳ'), 'トウキョウ');
  assert.equal(normalize('Par​is'), 'paris');
  assert.equal(names('인천'.normalize('NFD'))[0], '인천');
  assert.equal(normalize(null), '');
  assert.ok(sameText('café', 'CAFÉ'));
  assert.ok(sameText(' New  York', 'new york'));
  assert.ok(!sameText('Paris', 'Par'));
});

test('악센트는 라틴·그리스·키릴에서만 — 글자의 일부인 부호는 그대로', () => {
  assert.equal(foldKey(normalize('São Tomé')), 'sao tome');
  assert.equal(foldKey(normalize('İstanbul')), 'istanbul');
  assert.equal(foldKey(normalize('Straße')), 'strasse');
  assert.equal(foldKey(normalize('Łódź')), 'lodz');
  assert.equal(foldKey(normalize('Đà Nẵng')), 'da nang');
  assert.equal(foldKey(normalize('Αθήνα')), 'αθηνα');
  assert.equal(foldKey(normalize('Xi’an')), 'xian');
  assert.notEqual(foldKey('がっこう'), foldKey('かっこう'));
  assert.equal(foldKey('दिल्ली'), 'दिल्ली');
  assert.equal(foldKey('ภูเก็ต'), 'ภูเก็ต');
  assert.equal(foldKey('عمّان'), 'عمان');
});

test('순위 — 완전 일치 > 접두사 > 단어 접두사 > 한글 조합 > 부분 문자열', () => {
  assert.equal(cls('Paris', 'paris'), RANK.EXACT);
  assert.equal(cls('Paris', 'par'), RANK.PREFIX);
  assert.equal(cls('New York', 'yor'), RANK.WORD);
  assert.equal(cls('인천', '인ㅊ'), RANK.HANGUL);
  assert.equal(cls('Newport', 'por'), RANK.PART);
  assert.equal(cls('Paris', 'tok'), 0);
  const order = createSearchIndex(['Xyork', 'Old York', 'Yorkshire', 'York']).search('york').map(r => r.item);
  assert.deepEqual(order, ['York', 'Yorkshire', 'Old York', 'Xyork']);
  const ko = createSearchIndex(['서부산', '붓꽃마을', '부산', '부산역']).search('부산').map(r => r.item);
  assert.deepEqual(ko, ['부산', '부산역', '서부산']);
});

test('한글 — 부산을 치는 동안 모든 중간 상태에서 부산이 나온다', () => {
  for (const q of ['ㅂ', '부', '붓', '부사', '부산']) assert.ok(names(q, 20).includes('부산'), q);
  for (const q of ['ㅇ', '이', '인', '인ㅊ', '인처', '인천']) assert.ok(names(q, 60).includes('인천'), q);
  for (const q of ['ㄱ', '고', '과', '광', '광ㅈ', '광주']) assert.ok(names(q, 60).includes('광주'), q);
});
test('한글 — 초성, 초성과 글자를 섞은 입력, 겹자음, 첫가끝 자모', () => {
  assert.equal(names('ㅇㅊ')[0], '인천');
  assert.equal(names('제ㅈ')[0], '제주');
  assert.equal(names('ㅂㅅ')[0], '부산');
  assert.equal(names('ㅄ')[0], '부산');             // ㅄ 로 합쳐져 들어와도
  assert.equal(names('인ᄎ')[0], '인천');           // 첫가끝 ㅊ
  assert.equal(names('도ㅋ')[0], '도쿄');
  assert.equal(toStrokes('값'), 'ㄱㅏㅂㅅ');
  assert.equal(toStrokes('과'), 'ㄱㅗㅏ');
  assert.equal(matchRank('인천', '인ㅈ'), 0);
  assert.equal(matchRank('인천', 'ㅏ'), 0);
});

test('임의 번역·로마자 변환으로는 찾지 않는다', () => {
  const only = createSearchIndex(['인천', '東京都', 'Москва']);
  for (const q of ['incheon', 'tokyo', 'moskva', '도쿄', '동경']) assert.deepEqual(only.search(q), [], q);
});

test('빈 입력·기호·이상한 입력에도 조용히', () => {
  for (const q of ['', '   ', null, undefined, '???', '[', '(.*)', '\\', '😀', '​']) assert.deepEqual(searchCities(q), [], String(q));
});

test('기존 동작 — 도시 객체 배열, 개수 제한, 중복 없음, 나라 이름은 뒤에', () => {
  const r = searchCities('a', 8);
  assert.equal(r.length, 8);
  assert.equal(new Set(r).size, 8);
  assert.ok(r.every(c => CITIES.includes(c)));
  assert.ok(searchCities('일본', 5).every(c => c.country === '일본'));
  assert.ok(searchCities('japan', 5).every(c => c.country === '일본'));
  assert.equal(names('싱가포르')[0], '싱가포르');
});
test('모든 도시는 자기 이름과 별칭으로 찾아진다', () => {
  for (const c of CITIES) for (const n of [c.name, ...(c.aliases || [])]) assert.ok(searchCities(n, 12).includes(c), `${c.name} ← ${n}`);
});

test('대량 데이터 — 10만 건에서도 빠르다', () => {
  const syl = ['ka', 'to', 'mi', 'né', 'su', 'ro', 'wa', 'lé', 'pi', 'zo', 'ha', 'ru', 'ge', 'no', 'da', 'vi', 'xe', 'bo'];
  const kor = ['가', '나', '도', '리', '마', '부', '산', '서', '인', '천', '주', '하'];
  const big = [];
  for (let i = 0; i < 100000; i++) {
    const p = (arr, n, k) => Array.from({ length: n }, (_, j) => arr[Math.floor(i / arr.length ** j + k) % arr.length]).join('');
    big.push(i % 3 ? `${p(syl, 4, 0)} ${p(syl, 3, 5)}${i}` : `${p(kor, 4, 1)}${i}`);
  }
  big.push('New York', '인천', '東京都', 'Café Ω');
  const t0 = performance.now();
  const bx = createSearchIndex(big);
  const built = performance.now() - t0;
  bx.search('zzzz');                                     // 부분 문자열 색인 준비
  const qs = ['new y', 'cafe Ω', '인ㅊ', '東京', 'kato', 'ㅂㅅ', '부사', 'nesu99', '9999', 'york', 'né'];
  const times = qs.map(q => { const a = performance.now(); bx.search(q); return performance.now() - a; });
  assert.equal(bx.search('new y')[0].item, 'New York');
  assert.equal(bx.search('cafe ω')[0].item, 'Café Ω');
  assert.equal(bx.search('東京')[0].item, '東京都');
  const med = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(`  색인 ${built.toFixed(0)}ms · 검색 ${qs.map((q, i) => `${q} ${times[i].toFixed(1)}`).join(', ')}ms`);
  assert.ok(med < 60 && Math.max(...times) < 400, `느림: ${times.map(t => t.toFixed(0))}`);
});
