/* 3초 여행 — Redesign Roadmaps
 * 홈의 여행 코스 카드, 탐색 목록(검색·스타일·정렬), 코스 상세(#page=roadmap-detail&id=…).
 *
 * NOTE: loadRoadmaps() replaces the built-in list with GET /roadmaps.
 * The built-in list stays as the fallback while the server is waking up.
 */

import { navigate, getCurrent } from './redesign-navigation.js';
import { el, $, $$, setActiveByData, showToast } from './redesign-ui.js';
import { API_URL, api } from './redesign-api-adapter.js';
import { searchCities } from './redesign-cities.js';
import { prepare, prepareQuery, matchKey, sameText } from './redesign-search.js';
import { sampleCourseFor } from './redesign-course-samples.js';
import { publicLink, publicPath, shareLink } from './redesign-native.js';
import { askForm, showCopy } from './redesign-dialog.js';

// In-memory cache for landmark image URLs we've already verified loadable.
const LANDMARK_OK = new Set();
const LANDMARK_FAIL = new Set();
// 랜드마크 이미지 버전 — 이미지를 새로 생성하면 올린다.
// (BE가 immutable·30일 캐시로 내려보내 브라우저가 옛 이미지를 붙들기 때문에
//  내용이 바뀌면 URL 쿼리를 바꿔 강제로 새로 받게 한다.)
const IMG_VER = '20260609b';

/** Lazily attach an AI-generated landmark image to a roadmap card / cover.
 *  Falls back silently to the gradient if:
 *    - backend isn't running
 *    - OPENAI_API_KEY isn't set on the server
 *    - any network/decoding error
 */
function _attachLandmarkImage(el, city, gradient) {
  if (!el || !city) return;
  if (LANDMARK_FAIL.has(city)) return;            // give up, gradient stays
  const url = `${API_URL}/api/images/landmark/${encodeURIComponent(city)}?v=${IMG_VER}`;
  const img = new Image();
  img.onload = () => {
    LANDMARK_OK.add(city);
    const grad = gradient || DEFAULT_GRADIENT;
    el.style.backgroundImage =
      `linear-gradient(to top, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 45%, rgba(0,0,0,0) 75%), url("${url}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.classList.add('has-landmark-img');
  };
  img.onerror = () => {
    LANDMARK_FAIL.add(city);                      // don't retry this session
  };
  img.src = url;
}

// 서버가 깨어나는 동안이나 연결 실패 시 보여줄 기본 목록.
export const POPULAR_ROADMAPS = [
  { id: 'tokyo-3d',   city: '도쿄',     country: '일본',     title: '도쿄 동네 산책 3일',   concept: '균형',     days: 3, likes: 1240, gradient: 'var(--g-tokyo)',   tagline: '야나카·기치조지·시모키타자와' },
  { id: 'paris-4d',   city: '파리',     country: '프랑스',   title: '파리 동네 시장과 골목 4일',     concept: '프리미엄', days: 4, likes:  980, gradient: 'var(--g-paris)',   tagline: '생마르탱 운하·벨빌·뷔트오카유' },
  { id: 'jeju-3d',    city: '제주',     country: '대한민국', title: '제주 마을길과 오름 3일',     concept: '힐링',     days: 3, likes:  870, gradient: 'var(--g-jeju)',    tagline: '하가리·송당리·종달리' },
  { id: 'osaka-3d',   city: '오사카',   country: '일본',     title: '오사카 동네 먹부림 3일',      concept: '가성비',   days: 3, likes:  760, gradient: 'var(--g-osaka)',   tagline: '덴진바시스지·나카자키초·가라호리' },
  { id: 'bangkok-4d', city: '방콕',     country: '태국',     title: '방콕 동네 시장과 골목 4일',       concept: '액티비티', days: 4, likes:  690, gradient: 'var(--g-bangkok)', tagline: '아리·왕랑·프라카농' },
  { id: 'seoul-2d',   city: '서울',     country: '대한민국', title: '서울 동네 골목 2일',          concept: '효율',     days: 2, likes:  640, gradient: 'var(--g-seoul)',   tagline: '망원·연희·성북·후암' },
  { id: 'newyork-5d', city: '뉴욕',     country: '미국',     title: '뉴욕 동네 5일',      concept: '프리미엄', days: 5, likes:  590, gradient: 'var(--g-newyork)', tagline: '그린포인트·잭슨하이츠·아서 애비뉴' },
  { id: 'sydney-4d',  city: '시드니',   country: '호주',     title: '시드니 동네와 해변 4일',       concept: '액티비티', days: 4, likes:  530, gradient: 'var(--g-sydney)',  tagline: '뉴타운·매릭빌·클로벨리' },
];

let appState = null;
let roadmaps = POPULAR_ROADMAPS.map(m => ({ ...m, isSample: true }));   // loadRoadmaps() 가 서버 데이터로 교체
let loaded = null;                 // loadRoadmaps() 진행 중인 Promise
let locals = [];                   // 동네 사람이 쓴 코스(운영자가 확인한 글)
const explore = {
  sort: 'popular',   // popular(좋아요 많은 순, 같으면 최신) | recent(게시일 최신 순)
  concept: 'all',
  query: '',
};
const STYLE_KEYS = ['가성비', '균형', '프리미엄', '효율', '힐링', '액티비티'];

/** 홈 히어로 카드에 세련된 여행 사진을 배경으로 입힌다(어두운 오버레이로 흰 글씨 가독성 유지). */
function _attachHeroImage() {
  const hero = document.querySelector('.hero-card');
  if (!hero) return;
  const url = `${API_URL}/api/images/landmark/${encodeURIComponent('대표여행')}?v=${IMG_VER}`;
  const img = new Image();
  img.onload = () => {
    hero.style.backgroundImage =
      'linear-gradient(115deg, rgba(12,26,36,.80) 0%, rgba(12,26,36,.50) 52%, rgba(12,26,36,.28) 100%), '
      + `url("${url}")`;
    hero.style.backgroundSize = 'cover';
    hero.style.backgroundPosition = 'center';
    hero.classList.add('has-photo');
  };
  img.src = url;   // 실패하면 기존 그라데이션과 경로 그래픽 유지
}

export function initRoadmaps(state) {
  appState = state;
  _attachHeroImage();
  loaded = loadRoadmaps().then(() => {
    renderHomeRoadmaps();
    renderExplore();
  });
  loadLocals();

  // 홈의 여행 스타일 칩·도시 바로가기 → 탐색으로 이동하며 조건 적용
  document.addEventListener('click', (e) => {
    const qc = e.target.closest?.('[data-quick-concept]');
    if (qc) {
      explore.concept = qc.dataset.quickConcept;
      explore.query = '';
      _goExplore();
      return;
    }
    const city = e.target.closest?.('[data-marquee-city]');
    if (city) {
      explore.query = city.dataset.marqueeCity;
      explore.concept = 'all';
      _goExplore();
      return;
    }
  });

  // 정렬
  $('#explorePage .sort-tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-sort]');
    if (!b) return;
    explore.sort = b.dataset.sort;
    _syncExploreUI();
    renderExplore();
  });

  // 여행 스타일 필터
  $('#exploreFilters')?.addEventListener('click', (e) => {
    const c = e.target.closest?.('[data-filter-concept]');
    if (!c) return;
    explore.concept = c.dataset.filterConcept;
    _syncExploreUI();
    renderExplore();
  });

  // 여행 스타일 칩은 검색칸을 눌렀을 때(또는 스타일·검색어가 걸려 있을 때)만 보인다.
  $('#exploreSearch')?.addEventListener('focus', () => { _filtersOpen = true; _paintFilterVis(); });
  // 누름이 끝난 뒤(click)에 접는다 — 누르는 순간 접으면 아래 카드가 밀려 탭이 빗나간다.
  document.addEventListener('click', (e) => {
    if (!_filtersOpen) return;
    if (e.target.closest?.('#explorePage .search-card, #exploreFilters')) return;
    _filtersOpen = false; _paintFilterVis();
  });

  // 검색 — 탐색은 입력할 때마다, 홈은 검색을 누르면 탐색으로 넘어간다.
  $('#exploreSearch')?.addEventListener('input', (e) => {
    explore.query = (e.target.value || '').trim();
    renderExplore();
  });
  // 홈 검색 — 비어 있으면 아이콘과 입력만, 입력하면 지우기와 검색이 보인다(키보드의 검색 키로도 확정).
  const _hs = $('#homeSearch');
  const _paintHomeSearch = () => {
    const has = !!(_hs?.value || '').trim();
    $('#homeSearchClear').hidden = !has;
    $('#homeSearchForm')?.classList.toggle('has-text', has);
  };
  _hs?.addEventListener('input', _paintHomeSearch);
  $('#homeSearchClear')?.addEventListener('click', () => { _hs.value = ''; _paintHomeSearch(); _hs.focus(); });
  _paintHomeSearch();
  $('#homeSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    explore.query = ($('#homeSearch')?.value || '').trim();
    explore.concept = 'all';
    _goExplore({ focusSearch: true });
  });

  $('#resetExplore')?.addEventListener('click', () => {
    explore.sort = 'popular'; explore.concept = 'all'; explore.query = '';
    _syncExploreUI();
    renderExplore();
    $('#exploreSearch')?.focus();
  });

  // 이 코스로 여행 만들기 — 도시·기간·스타일을 채운 뒤 사용자가 바꿀 수 있게 넘긴다.
  $('#useRoadmapBtn')?.addEventListener('click', () => {
    const m = window.__redesign?.__currentRoadmap;
    if (!m) { navigate('create-trip'); return; }
    navigate('create-trip', { meta: { prefill: true } });
    document.dispatchEvent(new CustomEvent('redesign:trip-prefill', {
      detail: { city: m.city, country: m.country, concept: m.concept, days: m.days, title: m.title },
    }));
  });
  $('#shareRoadmapBtn')?.addEventListener('click', _shareCurrent);
  $('#topbarShare')?.addEventListener('click', _shareCurrent);

  // 카드 → 상세 (주소에 코스 id 를 남겨 새로고침·공유가 되게 한다)
  document.addEventListener('click', (e) => {
    const card = e.target.closest?.('[data-roadmap-id]');
    if (!card) return;
    navigate('roadmap-detail', { meta: { id: card.dataset.roadmapId } });
  });

  document.addEventListener('redesign:nav', (e) => {
    const { page, meta } = e.detail || {};
    if (page === 'roadmap-detail') _openDetail(meta?.id, meta?.city);
    else if (page === 'explore') _syncExploreUI();   // 조건은 이 모듈이 기억한다(주소의 값은 첫 진입 때만 읽음)
    if (page !== 'roadmap-detail') _resetDocTitle();
  });
  // 주소로 바로 들어온 경우 — 첫 이동 알림이 이 모듈보다 먼저 지나간다.
  const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  if (h.get('page') === 'roadmap-detail') _openDetail(h.get('id'), h.get('city'));
  else if (h.get('page') === 'explore') { _applyExploreMeta(Object.fromEntries(h)); }
}

/** 탐색으로 이동. 조건은 주소에도 남겨 상세에서 돌아왔을 때·새로고침 때 그대로 보이게 한다. */
function _goExplore(opts = {}) {
  navigate('explore', { meta: _exploreMeta() });
  _syncExploreUI();
  renderExplore();
  if (opts.focusSearch) $('#exploreSearch')?.focus();
}

function _exploreMeta() {
  const m = {};
  if (explore.query) m.q = explore.query;
  if (explore.concept !== 'all') m.style = explore.concept;
  if (explore.sort !== 'popular') m.sort = explore.sort;
  return m;
}

function _applyExploreMeta(meta = {}) {
  if (meta.q != null || meta.style || meta.sort) {
    explore.query = meta.q || '';
    explore.concept = STYLE_KEYS.includes(meta.style) ? meta.style : 'all';
    explore.sort = meta.sort === 'recent' ? 'recent' : 'popular';
  }
  _syncExploreUI();
}

/** 탐색 조건이 바뀌면 주소를 덮어쓴다(방문 기록은 늘리지 않음). */
function _replaceExploreHash() {
  if (getCurrent() !== 'explore') return;
  const meta = _exploreMeta();
  const qs = new URLSearchParams({ page: 'explore', ...meta }).toString();
  try { history.replaceState({ ...(history.state || {}), page: 'explore', meta }, '', '#' + qs); } catch (_) {}
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #3A4652 0%, #111418 100%)';

/** Map an API roadmap to the card shape. */
function _fromApi(r) {
  const known = POPULAR_ROADMAPS.find(p => p.city === r.city);
  const sample = sampleCourseFor(r.city);
  const own = _parseDays(r.roadmap_data);
  // 작성자 없이 기본으로 들어간 코스는 운영팀 예시다 — 좋아요 수도 예시 값이다.
  const isSample = !r.user_id && !own;
  return {
    id: String(r.id),
    city: r.city,
    country: r.country || '',
    title: (isSample && sample?.title) || r.title,        // 작성자 없는 예시는 화면의 코스 내용과 같은 제목으로
    concept: r.concept || '균형',
    days: r.days || 1,
    likes: r.likes || 0,
    tagline: known?.tagline || sample?.tagline || '',
    gradient: known?.gradient || DEFAULT_GRADIENT,
    createdAt: r.created_at || '',
    isSample,
    plan: own || (isSample ? sample?.days : null) || null,
    cost: own ? (r.roadmap_data?.cost || null) : (isSample ? sample?.cost : null),
  };
}

/** 동네 사람이 쓴 코스 → 카드 모양. 좋아요는 없다. */
export function fromLocal(r) {
  const known = POPULAR_ROADMAPS.find(p => p.city === r.city);
  return {
    id: `l${r.id}`, isLocal: true, city: r.city, country: r.country || '', area: r.area || '', title: r.title, concept: r.concept || '균형',
    days: r.days.length, likes: 0, tagline: '', gradient: known?.gradient || DEFAULT_GRADIENT, createdAt: r.created_at || '', isSample: false,
    author: r.author, lived: r.lived, note: r.note, cost: null,
    plan: r.days.map(d => d.map(s => ({ time: s.time || '', name: s.name, cat: s.cat || '', tip: s.tip || '', move: '' }))),
  };
}
async function loadLocals() {
  try { locals = ((await api.listLocalCourses()) || []).map(fromLocal); }
  catch (e) { console.warn('[local-courses] 불러오지 못했어요:', e?.message); return; }
  renderExplore();
}

/** 서버 코스의 roadmap_data 에서 날짜별 장소 목록을 꺼낸다. 형식이 맞지 않으면 null. */
function _parseDays(data) {
  const days = data?.days;
  if (!Array.isArray(days) || !days.length) return null;
  const out = days.map(d => {
    const items = Array.isArray(d) ? d : (d?.items || d?.places || []);
    return items.filter(x => x && (x.name || x.title)).map(x => ({
      time: String(x.time || ''), name: String(x.name || x.title), cat: String(x.cat || x.category || ''), move: x.move ? String(x.move) : '',
    }));
  }).filter(d => d.length);
  return out.length ? out : null;
}

/** Fetch public roadmaps.  실패하거나 비어 있으면 기본 목록을 유지한다. */
let listState = 'loading';   // loading | ok | fallback — 탐색 화면 안내에 쓴다
function _attachSamples() {
  roadmaps.forEach(m => {
    if (m.plan === undefined) {           // 기본 목록(서버 연결 실패) — 예시 일정 연결
      const s = sampleCourseFor(m.city);
      m.plan = s?.days || null; m.cost = s?.cost || null;
    }
  });
}

export async function loadRoadmaps() {
  listState = 'loading';
  _paintListState();
  // 서버가 잠들어 있으면 응답이 늦다 — 3초가 지나면 예시 코스를 먼저 보여 주고, 오면 바꾼다.
  const early = setTimeout(() => {
    if (listState !== 'loading') return;
    listState = 'waking';
    _attachSamples();
    _paintListState();
    renderExplore();
  }, 3000);
  try {
    const rows = await api.getRoadmaps({ limit: 100 });
    const list = (rows || []).filter(r => r.city).map(_fromApi);
    if (list.length) roadmaps = list;
    listState = 'ok';
  } catch (e) {
    console.warn('[roadmaps] 서버 목록을 불러오지 못해 기본 목록을 표시합니다:', e?.message);
    listState = 'fallback';
  } finally {
    clearTimeout(early);
  }
  _paintListState();
  _attachSamples();
  return roadmaps;
}

/* ============ 검색·정렬 ============ */
// 코스마다 비교 키는 한 번만 만든다.
const _keyCache = new WeakMap();
function _keysOf(r) {
  const texts = [r.city, r.country, r.title, r.tagline, r.concept].filter(Boolean);
  const id = texts.join('\n');                // 제목을 고친 코스는 다시 만든다
  let k = _keyCache.get(r);
  if (k?.id !== id) { k = { id, keys: texts.map(prepare) }; _keyCache.set(r, k); }
  return k.keys;
}
/** 검색어에 맞는 코스인지 보는 함수 — 영문·현지어 도시 이름(Tokyo, 東京 …)과 조합 중인 한글(도ㅋ)도 같은 도시로 찾는다. */
function _matcher(query) {
  const q = prepareQuery(query);
  if (q.empty) return () => true;
  const cities = new Set(searchCities(query, 20).map(c => c.name));
  return (r) => cities.has(r.city) || _keysOf(r).some(k => matchKey(k, q) > 0);
}

function _byPopular(a, b) {
  const lk = (m) => m.isSample ? 0 : (Number(m.likes) || 0);   // 예시 코스의 좋아요는 실제 수가 아니다
  return (lk(b) - lk(a)) || (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title, 'ko');
}

function _filterAndSort(list) {
  const hit = _matcher(explore.query);
  let arr = list.filter(r => (explore.concept === 'all' || r.concept === explore.concept) && hit(r));
  if (explore.sort === 'recent') {
    arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || _byPopular(a, b));
  } else arr.sort(_byPopular);
  return arr;
}

/* ============ 카드 ============ */
function _daysLabel(d) {
  return d > 1 ? `${d - 1}박 ${d}일` : '당일치기';
}

/* 코스 한 건의 글자 조각 — 홈 목록·추천·노선도와 탐색 목록이 같은 조각을 쓴다. */
const _place = (m) => [m.country, m.city, m.area].filter(Boolean).join(' · ');
const _styleEl = (m) => el('span', { class: 'rc-style' }, [m.concept, m.isSample ? el('span', { class: 'rc-sample-tag' }, '예시') : null].filter(Boolean));
const _goEl = () => el('span', { class: 'rc-go', 'aria-hidden': 'true' });

/* 도시 이름을 그 나라 글자로 — 홈 카드의 그림 자리에 쓴다. 모르는 도시는 한글 그대로. */
const LOCAL_NAME = { 도쿄: '東京', 오사카: '大阪', 교토: '京都', 후쿠오카: '福岡', 삿포로: '札幌', 방콕: 'กรุงเทพ', 파리: 'Paris', 런던: 'London', 로마: 'Roma', 바르셀로나: 'Barcelona', 뉴욕: 'New York', 시드니: 'Sydney', 타이베이: '臺北', 홍콩: '香港', 상하이: '上海', 하노이: 'Hà Nội', 다낭: 'Đà Nẵng', 싱가포르: 'Singapore', 프라하: 'Praha' };
const CITY_HUE = { 도쿄: 215, 뉴욕: 28, 방콕: 330, 서울: 190, 시드니: 170, 오사카: 10, 제주: 145, 파리: 255 };
const _hue = (city) => CITY_HUE[city] ?? [...String(city)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);

/** 코스 카드 — 기본은 목록 행(탐색), 'glow'는 홈의 빛 카드. */
function _cardEl(m, opts = {}) {
  const glow = opts.variant === 'glow';
  // 예시 코스의 좋아요 수는 실제 기록이 아니라 보여 주지 않는다(서버에 올라온 코스만 실제 수).
  const likes = m.isSample || m.isLocal ? null : el('span', { class: 'rc-likes' }, [
    el('span', { 'aria-hidden': 'true' }, '♥ '), el('span', { class: 'sr-only' }, '좋아요 '), (Number(m.likes) || 0).toLocaleString('ko-KR'),
  ]);
  const card = el('button', { type: 'button', class: 'roadmap-card ' + (glow ? 'rc--glow' : 'rc--row'), dataset: { roadmapId: m.id } });
  const info = el('span', { class: 'rc-info' }, [el('span', { class: 'rc-days' }, _daysLabel(m.days)), _styleEl(m), likes].filter(Boolean));
  const main = el('span', { class: 'rc-main' }, [
    el('span', { class: 'rc-place' }, _place(m)), el('span', { class: 'rc-title' }, m.title),
    opts.reason ? el('span', { class: 'rc-reason-line' }, opts.reason) : null,
  ].filter(Boolean));
  if (!glow) { card.append(main, info, _goEl()); return card; }
  card.style.setProperty('--h', String(_hue(m.city)));
  const big = LOCAL_NAME[m.city] || m.city || '';
  // 도시는 그림에 크게 있으니 글은 제목 → 기간·스타일 → 나라·도시 순서로 읽힌다
  card.append(
    el('span', { class: 'rg-art', 'aria-hidden': 'true' }, [el('span', { class: 'rg-name' + (big.length > 14 ? ' is-long' : big.length > 9 ? ' is-mid' : '') }, big)]),
    el('span', { class: 'rg-cap' }, [
      el('span', { class: 'rc-title' }, m.title), info,
      el('span', { class: 'rc-place' }, _place(m)),
      opts.reason ? el('span', { class: 'rc-reason-line' }, opts.reason) : null,
    ].filter(Boolean)),
  );
  return card;
}

/* ============ 홈 일정 창 ============
 * 공개 코스 한 건의 실제 날짜별 일정. 날짜 탭을 누르면 그날 들르는 곳이 시각과 함께 나온다.
 * 일정 데이터(m.plan)에 있는 것만 쓴다 — 없는 장소·시간·비용은 만들지 않는다. */
let _winKey = '';

function _routeCourse(sorted) {
  const has = (m) => m.plan?.some(d => d?.length);
  return sorted.find(m => has(m) && m.plan.length === 3) || sorted.find(has) || sorted[0] || null;
}

function _renderWindow(m) {
  const box = document.getElementById('homeFeature');
  if (!box) return;
  box.hidden = !m;
  if (!m) { box.replaceChildren(); _winKey = ''; return; }
  const plan = (m.plan || []).filter(d => d?.length);
  const key = JSON.stringify([m.id, m.title, m.days, m.concept, plan]);
  if (key === _winKey) return;              // 같은 코스면 다시 그리지 않는다(고른 날짜가 풀리지 않게)
  _winKey = key;

  const list = el('ol', { class: 'hw-stops' });
  const panel = el('div', { class: 'hw-panel', id: 'hwPanel', role: plan.length ? 'tabpanel' : null, tabIndex: plan.length ? 0 : null });
  const tabs = plan.map((_, i) => el('button', {
    type: 'button', class: 'hw-tab', role: 'tab', id: `hwTab${i}`, 'aria-controls': 'hwPanel',
    onclick: () => pick(i),
    onkeydown: (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault(); const n = (i + d + plan.length) % plan.length; pick(n); tabs[n].focus();
    },
  }, `${i + 1}일차`));
  function pick(i) {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
    panel.setAttribute('aria-labelledby', `hwTab${i}`);
    const day = plan[i];
    const fresh = el('ol', { class: 'hw-stops' }, day.map((x, j) => el('li', { class: 'hw-stop' }, [
      el('span', { class: 'hw-time' }, x.time || ''), el('span', { class: 'hw-name' }, x.name),
      x.move && j < day.length - 1 ? el('span', { class: 'hw-move' }, `다음까지 ${x.move}`) : null,
    ].filter(Boolean))));
    panel.replaceChildren(fresh);
  }
  if (plan.length) pick(0);
  else { panel.removeAttribute('role'); panel.removeAttribute('tabindex'); panel.append(el('p', { class: 'hw-none' }, m.tagline || '날짜별 장소는 아직 공개되지 않았어요.')); }
  void list;

  box.replaceChildren(
    el('h2', { class: 'section-title', id: 'homeFeatureH' }, '일정은 이렇게 나와요'),
    el('div', { class: 'hw' }, [
      ...(plan.length ? [el('div', { class: 'hw-tabs', role: 'tablist', 'aria-label': `${m.title} 날짜` }, tabs)] : []),
      el('div', { class: 'hw-main' }, [
        el('p', { class: 'hw-place' }, _place(m)),
        el('h3', { class: 'hw-title' }, m.title),
        el('p', { class: 'hw-meta' }, [_daysLabel(m.days), m.concept, m.isSample ? '예시' : ''].filter(Boolean).join(' · ')),
        panel,
        el('button', { type: 'button', class: 'btn hw-go', dataset: { roadmapId: m.id }, 'aria-label': `${m.title} 코스 보기` }, '코스 보기'),
      ]),
    ]),
  );
  box.classList.toggle('is-plain', !plan.length);
}

/* 첫 화면 지구본 — 도시를 누르면 그 도시 검색으로(코스가 없으면 검색 결과에서 여행 만들기로) */
let _globe = null;
function _renderGlobe() {
  const cv = document.getElementById('homeGlobe');
  if (!cv) return;
  const cities = [...new Set(roadmaps.map(m => m.city).filter(Boolean))];
  if (_globe) { _globe.setCities(cities); return; }
  if (_globe === false) return;
  _globe = false;
  import('./redesign-globe.js').then(({ initGlobe }) => {
    _globe = initGlobe(cv, { cities, onCity: (city) => {
      explore.query = city; explore.concept = 'all'; _goExplore();
    } }) || false;
  }).catch((e) => console.warn('[home] 지구본을 그리지 못했어요', e?.message));
}

/** 이전에 만든 여행에서 고른 조건(스타일·나라·기간). 없으면 null. */
function _preference() {
  const g = appState?.generated || null;
  const t = appState?.trip || {};
  const concept = g?.concept || t.concept || '';
  const country = g?.country || t.country || '';
  const days = g?.days || t.days || 0;
  return (concept || country || days) ? { concept, country, days } : null;
}

function _reasonFor(m, pref) {
  if (!pref) return '';
  if (pref.concept && m.concept === pref.concept) return `‘${m.concept}’ 스타일`;
  if (pref.country && m.country === pref.country) return `${m.country} 여행`;
  if (pref.days && m.days === pref.days) return `${_daysLabel(m.days)} 일정`;
  return '';
}

export function renderHomeRoadmaps() {
  const sorted = [...roadmaps].sort(_byPopular);
  // 일정 창에 나온 코스는 아래 카드에서 되풀이하지 않는다.
  const route = _routeCourse(sorted);
  _renderWindow(route);
  _renderGlobe();
  const others = sorted.filter(m => m !== route);
  const merge = others.length <= 5;            // 코스가 적으면 인기·추천을 한 섹션으로
  const popular = merge ? others : others.slice(0, 4);
  const popSec = document.getElementById('popularSection');
  if (popSec) popSec.hidden = !popular.length;
  const grid = document.getElementById('popularRoadmaps');
  if (grid) grid.replaceChildren(...popular.map(m => _cardEl(m, { variant: 'glow' })));
  const popH = document.getElementById('popularH');
  if (popH) popH.textContent = merge ? '여행 코스' : '인기 여행 코스';

  // 추천 — 인기 섹션에 나온 코스는 빼고, 이전에 고른 조건과 맞는 코스를 먼저 보여 준다.
  const recoSec = document.getElementById('recoSection');
  const list = document.getElementById('recoRoadmaps');
  const rest = others.slice(popular.length);
  if (recoSec) recoSec.hidden = merge || !rest.length;
  if (list && !merge) {
    const pref = _preference();
    const scored = rest.map(m => ({ m, reason: _reasonFor(m, pref) }))
      .sort((a, b) => (b.reason ? 1 : 0) - (a.reason ? 1 : 0));
    list.replaceChildren(...scored.slice(0, 6).map(({ m, reason }) => _cardEl(m, { reason, variant: 'glow' })));
    const sub = document.getElementById('recoSub');
    if (sub) {
      const hit = scored.some(x => x.reason);
      sub.textContent = hit ? '이전에 고른 여행 스타일·나라·기간과 맞는 코스를 먼저 보여 드려요'
        : '여행을 만들면 비슷한 코스를 먼저 보여 드려요';
    }
  }
  _renderCityMarquee();
}

/* ============ 도시 바로가기 ============ */
// 도시 바로가기 — 도시마다 한 번, 움직이지 않는 칩(누르면 그 도시로 탐색)
function _renderCityMarquee() {
  const sec = document.getElementById('citySection');
  const wrap = document.getElementById('cityMarquee');
  if (!wrap) return;
  const cities = [...new Set(roadmaps.map(m => m.city).filter(Boolean))];
  if (sec) sec.hidden = cities.length < 4;
  wrap.classList.add('city-chips');
  wrap.replaceChildren(...cities.map(city => el('button', {
    type: 'button', class: 'chip city-chip', dataset: { marqueeCity: city }, 'aria-label': `${city} 여행 코스 보기`,
  }, city)));
  try { localStorage.removeItem('tst_marquee_paused'); } catch (_) {}
}

/* ============ 탐색 ============ */
/** 불러오는 중·불러오지 못함 안내 — 기본 코스를 보여 주는 동안에도 상황을 알린다. */
function _paintListState() {
  const bar = document.querySelector('#explorePage .explore-bar');
  if (!bar) return;
  let note = document.getElementById('exploreState');
  if (!note) {
    note = el('p', { id: 'exploreState', class: 'explore-state', role: 'status' });
    bar.after(note);
  }
  if (listState === 'loading') { note.hidden = false; note.replaceChildren('여행 코스를 불러오는 중이에요…'); }
  else if (listState === 'waking') { note.hidden = false; note.replaceChildren('서버를 깨우는 중이라 예시 코스를 먼저 보여 드려요. 최신 코스가 오면 바뀌어요.'); }
  else if (listState === 'fallback') {
    note.hidden = false;
    note.replaceChildren('최신 코스를 불러오지 못해 기본 예시 코스를 보여 드려요. ',
      el('button', { type: 'button', class: 'btn-text', onclick: () => { loaded = loadRoadmaps().then(() => { renderHomeRoadmaps(); renderExplore(); }); } }, '다시 시도'));
  } else note.hidden = true;
}

export function renderExplore() {
  const grid = document.getElementById('exploreGrid');
  const empty = document.getElementById('exploreEmpty');
  const count = document.getElementById('exploreCount');
  if (!grid) return;
  const items = _filterAndSort(roadmaps);
  const mine = _filterAndSort(locals);
  _renderLocals(mine);
  grid.replaceChildren(...items.map(m => _cardEl(m, { variant: 'glow' })));
  const total = items.length + mine.length;
  if (empty) empty.hidden = total > 0;
  // 아는 도시인데 코스가 없으면 그 도시로 바로 여행을 만들 수 있게 한다.
  const make = document.getElementById('exploreMake');
  if (make) {
    const q = explore.query.trim();
    const city = q ? searchCities(q, 3).find(c => [c.name, ...(c.aliases || [])].some(n => sameText(n, q))) : null;
    make.hidden = !city || total > 0;
    make.textContent = city ? `${city.name} 여행 만들기` : '';
    make.onclick = city ? () => { document.dispatchEvent(new CustomEvent('redesign:trip-prefill', { detail: { city: city.name } })); navigate('create-trip', { meta: { prefill: true } }); } : null;
    const msg = empty?.querySelector('.empty-text');
    if (msg) msg.textContent = city ? `${city.name} 코스는 아직 없어요. 바로 여행을 만들어 보세요.` : '조건에 맞는 여행 코스가 없어요. 다른 도시나 스타일로 찾아보세요.';
  }
  if (count) {
    const parts = [];
    if (explore.query) parts.push(`‘${explore.query}’`);
    if (explore.concept !== 'all') parts.push(`${explore.concept} 스타일`);
    count.textContent = (parts.length ? parts.join(' · ') + ' 결과 ' : '여행 코스 ') + `${total}개`;
  }
  const reset = document.getElementById('exploreResetInline');
  if (reset) reset.hidden = !(explore.query || explore.concept !== 'all' || explore.sort !== 'popular');
  _replaceExploreHash();
}

/** 동네 사람이 쓴 코스 — 있으면 맨 위에, 없으면 쓰기 안내 한 줄만. */
function _renderLocals(list) {
  const sec = document.getElementById('localSection');
  if (!sec) return;
  document.getElementById('localGrid').replaceChildren(...list.map(m => _cardEl(m, { variant: 'glow' })));
  document.getElementById('localHead').hidden = !list.length;
  document.getElementById('localGrid').hidden = !list.length;
}

let _filtersOpen = false;
function _paintFilterVis() {
  const show = _filtersOpen || explore.concept !== 'all' || !!explore.query;
  const f = document.getElementById('exploreFilters');
  if (f) f.hidden = !show;
}
function _syncExploreUI() {
  _paintFilterVis();
  setActiveByData(document.getElementById('exploreFilters'), 'data-filter-concept', explore.concept);
  $$('#exploreFilters [data-filter-concept]').forEach(c =>
    c.setAttribute('aria-pressed', String(c.dataset.filterConcept === explore.concept)));
  const input = document.getElementById('exploreSearch');
  if (input && input.value !== explore.query) input.value = explore.query;
  const home = document.getElementById('homeSearch');
  if (home && home.value !== explore.query) home.value = explore.query;
  $$('#explorePage .sort-tab').forEach(t => {
    const on = t.dataset.sort === explore.sort;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-pressed', String(on));
  });
}

/* ============ 상세 ============ */
const DOC_TITLE = document.title;
const DOC_DESC = document.querySelector('meta[name="description"]')?.content || '';
function _setDocMeta(title, desc) {
  document.title = title;
  const d = document.querySelector('meta[name="description"]');
  if (d) d.content = desc;
}
function _resetDocTitle() {
  const d = document.querySelector('meta[name="description"]');
  if (d && d.content !== DOC_DESC) d.content = DOC_DESC;
}

let detailSeq = 0;
async function _openDetail(id, city) {
  const seq = ++detailSeq;
  const body = document.getElementById('roadmapBody');
  // 공유용 코스 페이지(trips/*.html)에서는 도시로 들어온다 — 그 도시의 예시 코스를 연다.
  if (!id && city) {
    await loaded;
    if (seq !== detailSeq) return;
    const byCity = roadmaps.find(r => r.city === city && r.isSample) || roadmaps.find(r => r.city === city);
    if (byCity) {
      try { history.replaceState({ ...(history.state || {}), meta: { id: byCity.id } }, '', `#page=roadmap-detail&id=${encodeURIComponent(byCity.id)}`); } catch (_) {}
      id = byCity.id;
    }
  }
  if (!id) { _renderMissing(); return; }
  if (/^l\d+$/.test(String(id))) {
    let x = locals.find(r => r.id === id);
    if (!x) {
      body?.replaceChildren(el('p', { class: 'rd-loading', role: 'status' }, '코스를 불러오는 중이에요…'));
      $('#roadmapCover')?.replaceChildren(); $('#roadmapMeta')?.replaceChildren(); $('#roadmapCost')?.replaceChildren();
      _toggleDetailActions(false);
      try { x = fromLocal(await api.getLocalCourse(String(id).slice(1))); }
      catch (e) { if (seq === detailSeq) _renderMissing(e?.status === 404 ? {} : { retry: id }); return; }
    }
    if (seq !== detailSeq) return;
    window.__redesign = window.__redesign || {};
    window.__redesign.__currentRoadmap = x;
    _renderRoadmapDetail(x);
    return;
  }
  let m = roadmaps.find(r => r.id === String(id));
  if (!m) {
    body?.replaceChildren(el('p', { class: 'rd-loading', role: 'status' }, '코스를 불러오는 중이에요…'));
    $('#roadmapCover')?.replaceChildren();
    $('#roadmapMeta')?.replaceChildren(); $('#roadmapCost')?.replaceChildren();
    _toggleDetailActions(false);
    await loaded;
    m = roadmaps.find(r => r.id === String(id));
  }
  if (!m && /^\d+$/.test(String(id))) {
    try { m = _fromApi(await api.getRoadmap(id)); }
    catch (e) {
      if (seq !== detailSeq) return;
      if (e?.status === 404) { _renderMissing(); return; }
      _renderMissing({ retry: id }); return;
    }
  }
  if (seq !== detailSeq) return;
  if (!m) { _renderMissing(); return; }
  window.__redesign = window.__redesign || {};
  window.__redesign.__currentRoadmap = m;
  _renderRoadmapDetail(m);
}

function _toggleDetailActions(on) {
  const row = document.querySelector('#roadmapDetailPage .roadmap-cta-row');
  if (row) row.hidden = !on;
  const share = document.getElementById('topbarShare');
  if (share) share.hidden = !on;
}

function _renderMissing(opts = {}) {
  window.__redesign && (window.__redesign.__currentRoadmap = null);
  $('#roadmapCover')?.replaceChildren();
  $('#roadmapMeta')?.replaceChildren(); $('#roadmapCost')?.replaceChildren();
  _toggleDetailActions(false);
  _setDocMeta('여행 코스를 찾을 수 없어요 · 3초 여행', DOC_DESC);
  const retry = opts.retry;
  $('#roadmapBody')?.replaceChildren(el('div', { class: 'empty-state rd-missing' }, [
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '🧭'),
    el('h1', { class: 'empty-title', tabIndex: -1 }, retry ? '코스를 불러오지 못했어요' : '여행 코스를 찾을 수 없어요'),
    el('p', { class: 'empty-text' }, retry ? '연결이 잠시 불안정해요. 잠시 뒤 다시 시도해 주세요.' : '삭제되었거나 주소가 잘못되었을 수 있어요.'),
    retry ? el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _openDetail(retry) }, '다시 시도') : null,
    el('button', { type: 'button', class: 'btn btn-primary', onclick: () => navigate('explore', { meta: _exploreMeta() }) }, '다른 여행 코스 보기'),
  ].filter(Boolean)));
}

function _won(n) {
  if (n >= 10000) return `약 ${Math.round(n / 10000).toLocaleString('ko-KR')}만 원`;
  return `약 ${n.toLocaleString('ko-KR')}원`;
}


function _renderRoadmapDetail(m) {
  _toggleDetailActions(true);
  const cover = document.getElementById('roadmapCover');
  const meta  = document.getElementById('roadmapMeta');
  const body  = document.getElementById('roadmapBody');
  const place = _place(m);
  _setDocMeta(`${m.title} · 3초 여행`, `${place} ${_daysLabel(m.days)} ${m.concept} 여행 코스${m.tagline ? ' — ' + m.tagline : ''}`);
  if (cover) {
    cover.style.background = m.gradient;
    cover.classList.remove('has-landmark-img');
    cover.closest('.night-band')?.style.setProperty('--h', String(_hue(m.city)));
    cover.replaceChildren(...[
      el('p', { class: 'rd-native', 'aria-hidden': 'true' }, LOCAL_NAME[m.city] || m.city || ''),
      el('p', { class: 'rd-city' }, place),
      el('h1', { class: 'rd-title', id: 'roadmapTitle', tabIndex: -1 }, m.title),
      m.tagline ? el('p', { class: 'rd-tag' }, m.tagline) : null,
    ].filter(Boolean));
    _attachLandmarkImage(cover, m.city, m.gradient);
  }
  if (meta) {
    const pills = [
      ['기간', _daysLabel(m.days)],
      ['여행 스타일', m.concept],
      m.isLocal ? ['작성자', '동네 사람이 씀'] : ['좋아요', `♥ ${m.likes.toLocaleString('ko-KR')}`],
    ];
    meta.replaceChildren(...pills.map(([k, v]) => el('span', { class: 'meta-pill' }, [el('span', { class: 'sr-only' }, k + ' '), v])),
      ...(m.isSample && !m.cost?.amount ? [el('span', { class: 'meta-pill meta-pill--sample' }, '예시')] : []));
  }
  if (!body) return;
  const parts = [];
  // 예상 비용 — 금액(먼저) · 포함 항목(보조) · 추정 근거(펼침)
  const costBox = document.getElementById('roadmapCost');
  if (costBox) costBox.replaceChildren();
  if (m.cost?.amount) {
    (costBox ? (x => costBox.append(x)) : (x => parts.push(x)))(el('section', { class: 'rd-cost', 'aria-labelledby': 'rdCostH' }, [
      el('h2', { class: 'rd-h', id: 'rdCostH' }, m.isSample ? '예상 비용 · 예시' : '예상 비용'),
      el('p', { class: 'rd-cost-num' }, [_won(m.cost.amount), el('span', { class: 'rd-cost-who' }, ' 성인 1명')]),
      m.cost.note ? el('p', { class: 'rd-cost-note' }, m.cost.note) : null,
      el('details', { class: 'rd-source' }, [
        el('summary', {}, '금액 기준'),
        el('p', {}, m.isSample
          ? '운영팀이 만든 예시 코스예요. 3초 여행 예시 기준(2026년, 대중교통·중간 가격대 숙소)이고, 실제 가격은 날짜와 환율에 따라 달라요. 좋아요 수도 예시 값이에요.'
          : '코스 작성자가 입력한 금액이에요.'),
      ]),
    ]));
  } else if (m.isSample) {
    parts.push(el('p', { class: 'rd-note' }, '운영팀이 만든 예시 코스예요. 좋아요 수는 예시 값이에요.'));
  }

  if (m.isLocal) parts.push(el('section', { class: 'rd-author', 'aria-labelledby': 'rdAuthorH' }, [
    el('h2', { class: 'rd-author-h', id: 'rdAuthorH' }, [m.author, el('span', {}, ` · ${m.city} ${m.lived === '나고 자랐어요' ? '토박이' : `${m.lived} 거주`}`)]),
    el('p', { class: 'rd-author-note' }, m.note),
    el('p', { class: 'rd-author-src' }, '거주 기간은 작성자가 밝힌 것이고, 운영팀이 확인하지는 않았어요.'),
  ]));

  // 날짜별 코스
  const plan = m.plan || [];
  const partial = plan.length > 0 && plan.length < m.days;
  parts.push(el('h2', { class: 'rd-h' }, partial ? '1일차 미리보기' : '날짜별 코스'));
  if (!plan.length) {
    parts.push(el('p', { class: 'rd-note' }, '이 코스는 날짜별 장소가 아직 공개되지 않았어요. ‘이 코스로 여행 만들기’를 누르면 같은 도시·기간·스타일로 일정을 만들어 드려요.'));
  }
  const shown = partial ? plan.slice(0, 1) : plan;
  shown.forEach((day, i) => {
    const items = [];
    day.forEach((s, j) => {
      items.push(el('li', { class: 'rd-stop' }, [
        el('span', { class: 'rd-time' }, s.time),
        el('span', { class: 'rd-node', 'aria-hidden': 'true' }),
        el('span', { class: 'rd-name' }, [s.name, s.tip ? el('span', { class: 'rd-tip' }, s.tip) : null]),
        s.cat ? el('span', { class: 'rd-cat' }, s.cat) : null,
      ]));
      if (s.move && j < day.length - 1) items.push(el('li', { class: 'rd-move' }, [el('span', { class: 'sr-only' }, '다음 장소까지 '), s.move]));
    });
    parts.push(el('section', { class: 'rd-day', 'aria-labelledby': `rdDay${i}` }, [
      el('h3', { class: 'rd-day-h', id: `rdDay${i}` }, `${i + 1}일차`),
      el('ol', { class: 'rd-stops' }, items),
    ]));
  });
  if (partial) parts.push(el('p', { class: 'rd-note' }, `나머지 ${m.days - 1}일은 이 코스로 여행을 만들면 채워져요.`));
  if (m.isLocal) parts.push(el('p', { class: 'rd-report' }, [el('button', { type: 'button', class: 'btn-text', onclick: () => _report(m) }, '이 코스 신고')]));
  body.replaceChildren(...parts);
}

async function _report(m) {
  const v = await askForm({ title: '이 코스를 신고할까요?', text: '운영팀이 내용을 다시 확인해요.', ok: '신고', fields: [
    { name: 'reason', label: '이유', type: 'choice', options: ['광고', '사실과 달라요', '부적절해요', '개인정보'], check: (x) => x ? '' : '이유를 골라 주세요' },
  ] });
  if (!v) return;
  try { await api.reportLocalCourse(m.id.slice(1), v.reason); showToast('신고했어요. 운영팀이 확인할게요', 2600); }
  catch (e) { showToast(e?.status === 429 ? '잠시 뒤 다시 시도해 주세요' : '신고하지 못했어요. 잠시 뒤 다시 시도해 주세요'); }
}

// 예시 코스는 미리보기(제목·설명)가 붙는 정적 코스 페이지 주소로 공유한다.
const COURSE_PAGE = { 도쿄: 'tokyo', 파리: 'paris', 제주: 'jeju', 오사카: 'osaka', 방콕: 'bangkok', 서울: 'seoul', 뉴욕: 'newyork', 시드니: 'sydney' };

async function _shareCurrent() {
  const m = window.__redesign?.__currentRoadmap;
  if (!m) return;
  const slug = m.isSample ? COURSE_PAGE[m.city] : null;
  const url = slug ? publicPath(`trips/${slug}.html`)
    : publicLink(`#page=roadmap-detail&id=${encodeURIComponent(m.id)}`);
  const data = { title: m.title, text: `${m.city} ${_daysLabel(m.days)} 여행 코스`, url };
  if (await shareLink(data)) return;
  try { await navigator.clipboard.writeText(url); showToast('코스 주소를 복사했어요'); }
  catch (_) { showCopy('이 주소를 복사해 공유하세요', url); }
}
