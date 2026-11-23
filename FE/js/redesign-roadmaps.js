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
import { sampleCourseFor } from './redesign-course-samples.js';

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
  { id: 'tokyo-3d',   city: '도쿄',     country: '일본',     title: '도쿄 3일 감성 로드맵',   concept: '균형',     days: 3, likes: 1240, gradient: 'var(--g-tokyo)',   tagline: '시부야부터 아사쿠사까지' },
  { id: 'paris-4d',   city: '파리',     country: '프랑스',   title: '파리 첫 여행 로드맵',     concept: '프리미엄', days: 4, likes:  980, gradient: 'var(--g-paris)',   tagline: '에펠탑·루브르·몽마르트' },
  { id: 'jeju-3d',    city: '제주',     country: '대한민국', title: '제주 힐링 드라이브',     concept: '힐링',     days: 3, likes:  870, gradient: 'var(--g-jeju)',    tagline: '바람·바다·돌담길' },
  { id: 'osaka-3d',   city: '오사카',   country: '일본',     title: '오사카 먹부림 3일',      concept: '가성비',   days: 3, likes:  760, gradient: 'var(--g-osaka)',   tagline: '도톤보리·신세카이·우메다' },
  { id: 'bangkok-4d', city: '방콕',     country: '태국',     title: '방콕 야경 & 카페',       concept: '액티비티', days: 4, likes:  690, gradient: 'var(--g-bangkok)', tagline: '카오산·짜오프라야' },
  { id: 'seoul-2d',   city: '서울',     country: '대한민국', title: '서울 핫플 2일',          concept: '효율',     days: 2, likes:  640, gradient: 'var(--g-seoul)',   tagline: '성수·한남·홍대' },
  { id: 'newyork-5d', city: '뉴욕',     country: '미국',     title: '뉴욕 5일 시그니처',      concept: '프리미엄', days: 5, likes:  590, gradient: 'var(--g-newyork)', tagline: '브로드웨이·MoMA·하이라인' },
  { id: 'sydney-4d',  city: '시드니',   country: '호주',     title: '시드니 자연 탐험',       concept: '액티비티', days: 4, likes:  530, gradient: 'var(--g-sydney)',  tagline: '오페라하우스·본다이' },
];

let appState = null;
let roadmaps = POPULAR_ROADMAPS.map(m => ({ ...m, isSample: true }));   // loadRoadmaps() 가 서버 데이터로 교체
let loaded = null;                 // loadRoadmaps() 진행 중인 Promise
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
    const pause = e.target.closest?.('#marqueePause');
    if (pause) _toggleMarquee();
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

  // 검색 — 탐색은 입력할 때마다, 홈은 검색을 누르면 탐색으로 넘어간다.
  $('#exploreSearch')?.addEventListener('input', (e) => {
    explore.query = (e.target.value || '').trim();
    renderExplore();
  });
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
    title: r.title,
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
const _norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

function _matches(r, q) {
  const n = _norm(q);
  if (!n) return true;
  if ([r.city, r.country, r.title, r.tagline, r.concept].some(v => _norm(v).includes(n))) return true;
  // 영문·현지어 도시 이름(Tokyo, 東京 …)도 같은 도시로 찾는다.
  const cities = searchCities(q, 20);
  return cities.some(c => c.name === r.city);
}

function _byPopular(a, b) {
  const lk = (m) => m.isSample ? 0 : (Number(m.likes) || 0);   // 예시 코스의 좋아요는 실제 수가 아니다
  return (lk(b) - lk(a)) || (b.createdAt || '').localeCompare(a.createdAt || '') || a.title.localeCompare(b.title, 'ko');
}

function _filterAndSort(list) {
  let arr = list.filter(r =>
    (explore.concept === 'all' || r.concept === explore.concept) && _matches(r, explore.query));
  if (explore.sort === 'recent') {
    arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || _byPopular(a, b));
  } else arr.sort(_byPopular);
  return arr;
}

/* ============ 카드 ============ */
function _daysLabel(d) {
  return d > 1 ? `${d - 1}박 ${d}일` : '당일치기';
}

function _cardEl(m, opts = {}) {
  // 사진(없으면 같은 크기의 브랜드 배경) 영역은 비율을 고정하고, 글은 아래 본문 영역에 둔다.
  const media = el('div', { class: 'rc-media', style: { background: m.gradient }, 'aria-hidden': 'true' }, [
    el('div', { class: 'rc-top' }, [
      m.isSample ? el('span', { class: 'rc-sample' }, '예시') : null,
    ].filter(Boolean)),
  ]);
  const card = el('button', {
    type: 'button',
    class: 'roadmap-card',
    dataset: { roadmapId: m.id },
  }, [
    media,
    el('div', { class: 'rc-bottom' }, [
      el('div', { class: 'rc-place' }, [m.city, m.country].filter(Boolean).join(' · ')),
      el('div', { class: 'rc-title' }, m.title),
      el('div', { class: 'rc-info' }, [el('span', { class: 'nowrap' }, _daysLabel(m.days)), ' · ', el('span', { class: 'nowrap' }, m.concept)]),
      opts.reason ? el('div', { class: 'rc-reason-line' }, `추천 이유 · ${opts.reason}`) : null,
      // 예시 코스의 좋아요 수는 실제 기록이 아니라 보여 주지 않는다(서버에 올라온 코스만 실제 수).
      m.isSample ? null : el('div', { class: 'rc-likes' }, [
        el('span', { 'aria-hidden': 'true' }, '♥ '),
        el('span', { class: 'sr-only' }, '좋아요 '),
        (Number(m.likes) || 0).toLocaleString('ko-KR'),
      ]),
    ]),
  ]);
  _attachLandmarkImage(media, m.city, m.gradient);
  // 화면 낭독기에는 예시 여부·추천 이유도 읽어 준다(사진 영역은 장식이라 숨김).
  if (m.isSample || opts.reason) card.appendChild(el('span', { class: 'sr-only' }, [m.isSample ? '예시 코스' : '', opts.reason ? '추천 이유 ' + opts.reason : ''].filter(Boolean).join(' · ')));
  return card;
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
  const merge = sorted.length <= 6;            // 코스가 적으면 인기·추천을 한 섹션으로
  const popular = merge ? sorted : sorted.slice(0, 4);
  const grid = document.getElementById('popularRoadmaps');
  if (grid) grid.replaceChildren(...popular.map(m => _cardEl(m)));
  const popH = document.getElementById('popularH');
  if (popH) popH.textContent = merge ? '여행 코스' : '인기 여행 코스';

  // 추천 — 인기 섹션에 나온 코스는 빼고, 이전에 고른 조건과 맞는 코스를 먼저 보여 준다.
  const recoSec = document.getElementById('recoSection');
  const list = document.getElementById('recoRoadmaps');
  const rest = sorted.slice(popular.length);
  if (recoSec) recoSec.hidden = merge || !rest.length;
  if (list && !merge) {
    const pref = _preference();
    const scored = rest.map(m => ({ m, reason: _reasonFor(m, pref) }))
      .sort((a, b) => (b.reason ? 1 : 0) - (a.reason ? 1 : 0));
    list.replaceChildren(...scored.slice(0, 6).map(({ m, reason }) => _cardEl(m, { reason })));
    const sub = document.getElementById('recoSub');
    if (sub) {
      const hit = scored.some(x => x.reason);
      sub.textContent = hit ? '이전에 고른 여행 스타일·나라·기간과 맞는 코스를 먼저 보여 드려요'
        : '여러 도시와 기간의 코스를 골랐어요. 여행을 만들면 비슷한 코스를 먼저 추천해요';
    }
  }
  _renderCityMarquee();
}

/* ============ 도시 바로가기 ============ */
let marqueePaused = false;
function _toggleMarquee(force) {
  marqueePaused = typeof force === 'boolean' ? force : !marqueePaused;
  const wrap = document.getElementById('cityMarquee');
  wrap?.classList.toggle('is-paused', marqueePaused);
  const b = document.getElementById('marqueePause');
  if (b) {
    b.setAttribute('aria-pressed', String(marqueePaused));
    b.textContent = marqueePaused ? '▶ 움직이기' : '❚❚ 멈추기';
  }
  try { localStorage.setItem('tst_marquee_paused', marqueePaused ? '1' : '0'); } catch (_) {}
}

// 끊김 없이 돌도록 같은 묶음을 두 번 놓고, 두 번째는 화면에서만 보이게(키보드·낭독 제외) 한다.
function _renderCityMarquee() {
  const sec = document.getElementById('citySection');
  const wrap = document.getElementById('cityMarquee');
  if (!wrap) return;
  const cities = [...new Set(roadmaps.map(m => m.city))];
  if (sec) sec.hidden = cities.length < 4;
  const group = (copy) => el('div', { class: 'city-marquee-group', 'aria-hidden': copy ? 'true' : null },
    cities.map(city => el('button', {
      type: 'button',
      class: 'city-marquee-item',
      tabIndex: copy ? -1 : 0,
      dataset: { marqueeCity: city },
      'aria-label': copy ? null : `${city} 여행 코스 보기`,
    }, city)));
  wrap.replaceChildren(el('div', { class: 'city-marquee-track' }, [group(false), group(true)]));
  let saved = false;
  try { saved = localStorage.getItem('tst_marquee_paused') === '1'; } catch (_) {}
  _toggleMarquee(saved);
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
  grid.replaceChildren(...items.map(m => _cardEl(m)));
  if (empty) empty.hidden = items.length > 0;
  if (count) {
    const parts = [];
    if (explore.query) parts.push(`‘${explore.query}’`);
    if (explore.concept !== 'all') parts.push(`${explore.concept} 스타일`);
    count.textContent = (parts.length ? parts.join(' · ') + ' 결과 ' : '여행 코스 ') + `${items.length}개`;
  }
  const reset = document.getElementById('exploreResetInline');
  if (reset) reset.hidden = !(explore.query || explore.concept !== 'all' || explore.sort !== 'popular');
  _replaceExploreHash();
}

function _syncExploreUI() {
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
  let m = roadmaps.find(r => r.id === String(id));
  if (!m) {
    body?.replaceChildren(el('p', { class: 'rd-loading', role: 'status' }, '코스를 불러오는 중이에요…'));
    $('#roadmapCover')?.replaceChildren();
    $('#roadmapMeta')?.replaceChildren();
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
}

function _renderMissing(opts = {}) {
  window.__redesign && (window.__redesign.__currentRoadmap = null);
  $('#roadmapCover')?.replaceChildren();
  $('#roadmapMeta')?.replaceChildren();
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

const CAT_ICON = { 관광: '📍', 식사: '🍽️', 숙박: '🏨', 쇼핑: '🛍️', 이동: '🚆' };

function _renderRoadmapDetail(m) {
  _toggleDetailActions(true);
  const cover = document.getElementById('roadmapCover');
  const meta  = document.getElementById('roadmapMeta');
  const body  = document.getElementById('roadmapBody');
  const place = [m.city, m.country].filter(Boolean).join(' · ');
  _setDocMeta(`${m.title} · 3초 여행`, `${place} ${_daysLabel(m.days)} ${m.concept} 여행 코스${m.tagline ? ' — ' + m.tagline : ''}`);
  if (cover) {
    cover.style.background = m.gradient;
    cover.classList.remove('has-landmark-img');
    cover.replaceChildren(
      el('p', { class: 'rd-city' }, place),
      el('h1', { class: 'rd-title', id: 'roadmapTitle', tabIndex: -1 }, m.title),
      m.tagline ? el('p', { class: 'rd-tag' }, m.tagline) : null,
    );
    _attachLandmarkImage(cover, m.city, m.gradient);
  }
  if (meta) {
    const pills = [
      ['기간', _daysLabel(m.days)],
      ['여행 스타일', m.concept],
      ['좋아요', `♥ ${m.likes.toLocaleString('ko-KR')}`],
    ];
    meta.replaceChildren(...pills.map(([k, v]) => el('span', { class: 'meta-pill' }, [el('span', { class: 'sr-only' }, k + ' '), v])),
      ...(m.isSample ? [el('span', { class: 'meta-pill meta-pill--sample' }, '예시')] : []));
  }
  if (!body) return;
  const parts = [];
  if (m.isSample) {
    parts.push(el('p', { class: 'rd-note' }, '운영팀이 만든 예시 코스예요. 좋아요 수와 금액은 참고용 예시 값이에요.'));
  }

  // 예상 비용과 출처
  if (m.cost?.amount) {
    parts.push(el('section', { class: 'rd-cost', 'aria-labelledby': 'rdCostH' }, [
      el('h2', { class: 'rd-h', id: 'rdCostH' }, '예상 비용'),
      el('p', { class: 'rd-cost-num' }, [`성인 1명 ${_won(m.cost.amount)}`]),
      el('p', { class: 'rd-cost-note' }, m.cost.note || ''),
      el('p', { class: 'rd-source' }, m.isSample
        ? '출처: 3초 여행 예시 기준(2026년, 대중교통·중간 가격대 숙소). 실제 가격은 날짜와 환율에 따라 달라요.'
        : '출처: 코스 작성자가 입력한 금액이에요.'),
    ]));
  }

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
        el('span', { class: 'rd-ico', 'aria-hidden': 'true' }, CAT_ICON[s.cat] || '📍'),
        el('span', { class: 'rd-name' }, [s.name, s.cat ? el('small', {}, s.cat) : null].filter(Boolean)),
      ]));
      if (s.move && j < day.length - 1) items.push(el('li', { class: 'rd-move' }, `다음 장소까지 ${s.move}`));
    });
    parts.push(el('section', { class: 'rd-day', 'aria-labelledby': `rdDay${i}` }, [
      el('h3', { class: 'rd-day-h', id: `rdDay${i}` }, `${i + 1}일차`),
      el('ol', { class: 'rd-stops' }, items),
    ]));
  });
  if (partial) parts.push(el('p', { class: 'rd-note' }, `나머지 ${m.days - 1}일은 이 코스로 여행을 만들면 채워져요.`));
  body.replaceChildren(...parts);
}

// 예시 코스는 미리보기(제목·설명)가 붙는 정적 코스 페이지 주소로 공유한다.
const COURSE_PAGE = { 도쿄: 'tokyo', 파리: 'paris', 제주: 'jeju', 오사카: 'osaka', 방콕: 'bangkok', 서울: 'seoul', 뉴욕: 'newyork', 시드니: 'sydney' };

async function _shareCurrent() {
  const m = window.__redesign?.__currentRoadmap;
  if (!m) return;
  const slug = m.isSample ? COURSE_PAGE[m.city] : null;
  const url = slug ? `${location.origin}/trips/${slug}.html`
    : `${location.origin}${location.pathname}#page=roadmap-detail&id=${encodeURIComponent(m.id)}`;
  const data = { title: m.title, text: `${m.city} ${_daysLabel(m.days)} 여행 코스`, url };
  try {
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); showToast('코스 주소를 복사했어요'); }
  catch (_) { window.prompt('이 주소를 복사해 공유하세요', url); }
}
