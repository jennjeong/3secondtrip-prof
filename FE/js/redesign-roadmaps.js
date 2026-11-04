/* 3초 여행 — Redesign Roadmaps
 * Popular roadmap cards (home), full Explore list with sort/filter,
 * and Roadmap Detail navigation.
 *
 * NOTE: loadRoadmaps() replaces the built-in list with GET /roadmaps.
 * The built-in list stays as the fallback while the server is waking up.
 */

import { navigate } from './redesign-navigation.js';
import { el, $, $$, setActiveByData } from './redesign-ui.js';
import { API_URL, api } from './redesign-api-adapter.js';

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
    const grad = gradient || 'linear-gradient(135deg, rgba(255,154,158,.85), rgba(250,208,196,.85))';
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
let roadmaps = POPULAR_ROADMAPS;   // loadRoadmaps() 가 서버 데이터로 교체
const explore = {
  sort: 'popular',
  concept: 'all',
  query: '',
};

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
    const ill = hero.querySelector('.hero-illust');
    if (ill) ill.style.display = 'none';   // 사진이 있으면 장식 버블 숨김
  };
  img.src = url;   // 실패하면 기존 그라데이션 유지
}

export function initRoadmaps(state) {
  appState = state;
  _attachHeroImage();
  loadRoadmaps().then(() => {
    renderHomeRoadmaps();
    renderExplore();
  });

  // Quick-concept chips → jump to Explore with filter applied
  document.addEventListener('click', (e) => {
    const qc = e.target.closest?.('[data-quick-concept]');
    if (qc) {
      explore.concept = qc.dataset.quickConcept;
      navigate('explore');
      _syncExploreUI();
      renderExplore();
      return;
    }
    const city = e.target.closest?.('[data-marquee-city]');
    if (city) {
      explore.query = city.dataset.marqueeCity.toLowerCase();
      navigate('explore');
      _syncExploreUI();
      renderExplore();
    }
  });

  // Explore sort
  $('#explorePage .sort-tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-sort]');
    if (!b) return;
    explore.sort = b.dataset.sort;
    $$('#explorePage .sort-tab').forEach(t => {
      const on = t === b;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    renderExplore();
  });

  // Explore filter chips
  $('#exploreFilters')?.addEventListener('click', (e) => {
    const c = e.target.closest?.('[data-filter-concept]');
    if (!c) return;
    explore.concept = c.dataset.filterConcept;
    _syncExploreUI();
    renderExplore();
  });

  // Search
  $('#exploreSearch')?.addEventListener('input', (e) => {
    explore.query = (e.target.value || '').trim().toLowerCase();
    renderExplore();
  });
  $('#homeSearch')?.addEventListener('input', (e) => {
    const q = (e.target.value || '').trim().toLowerCase();
    explore.query = q;
    if (q.length >= 1) {
      navigate('explore');
      _syncExploreUI();
      renderExplore();
    }
  });

  $('#resetExplore')?.addEventListener('click', () => {
    explore.sort = 'popular'; explore.concept = 'all'; explore.query = '';
    _syncExploreUI();
    renderExplore();
  });

  // Use roadmap button
  $('#useRoadmapBtn')?.addEventListener('click', () => {
    const m = window.__redesign?.__currentRoadmap;
    if (!m) { navigate('create-trip'); return; }
    if (appState?.trip) {
      appState.trip.cityName = m.city;
      appState.trip.country = m.country;
      appState.trip.concept = m.concept;
      appState.trip.days = m.days;
    }
    navigate('create-trip', { meta: { prefill: true } });
    document.dispatchEvent(new CustomEvent('redesign:trip-prefill'));
  });

  // Bind opening roadmap detail via delegation (cards rendered dynamically)
  document.addEventListener('click', (e) => {
    const card = e.target.closest?.('[data-roadmap-id]');
    if (card) {
      const id = card.dataset.roadmapId;
      const m = roadmaps.find(r => r.id === id);
      if (!m) return;
      window.__redesign = window.__redesign || {};
      window.__redesign.__currentRoadmap = m;
      _renderRoadmapDetail(m);
      navigate('roadmap-detail');
    }
  });
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #4f6d8a 0%, #2b3440 100%)';
// 사용자가 만든 공개 로드맵의 값이 그대로 CSS 로 들어가므로 단색 그라데이션만 허용.
const SAFE_GRADIENT = /^linear-gradient\([\w\s#%.,-]+\)$/;

/** Map an API roadmap to the card shape.  기본 목록에만 있는 tagline 은 도시로 찾아 채운다. */
function _fromApi(r) {
  const known = POPULAR_ROADMAPS.find(p => p.city === r.city);
  return {
    id: String(r.id),
    city: r.city,
    country: r.country || '',
    title: r.title,
    concept: r.concept || '균형',
    days: r.days || 1,
    likes: r.likes || 0,
    tagline: known?.tagline || r.title,
    gradient: SAFE_GRADIENT.test(r.gradient || '') ? r.gradient : DEFAULT_GRADIENT,
    createdAt: r.created_at || '',
  };
}

/** Fetch public roadmaps.  실패하거나 비어 있으면 기본 목록을 유지한다. */
export async function loadRoadmaps() {
  try {
    const rows = await api.getRoadmaps({ limit: 100 });
    const list = (rows || []).filter(r => r.city).map(_fromApi);
    if (list.length) roadmaps = list;
  } catch (e) {
    console.warn('[roadmaps] 서버 목록을 불러오지 못해 기본 목록을 표시합니다:', e?.message);
  }
  return roadmaps;
}

/** Fisher–Yates shuffle (returns a new array, leaves the source intact). */
function _shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _filterAndSort(list) {
  let arr = [...list];
  if (explore.concept && explore.concept !== 'all') arr = arr.filter(r => r.concept === explore.concept);
  if (explore.query) {
    const q = explore.query;
    arr = arr.filter(r =>
      r.city.toLowerCase().includes(q) ||
      r.country.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.concept.toLowerCase().includes(q)
    );
  }
  switch (explore.sort) {
    case 'likes':  arr.sort((a, b) => b.likes - a.likes); break;
    case 'recent': arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); break;
    default:       arr.sort((a, b) => b.likes - a.likes);
  }
  return arr;
}

function _cardEl(m) {
  const card = el('button', {
    type: 'button',
    class: 'roadmap-card',
    dataset: { roadmapId: m.id },
    style: { background: m.gradient },
  }, [
    el('div', { class: 'rc-top' }, [
      el('span', { class: 'rc-concept-badge' }, m.concept),
      el('span', { class: 'rc-likes' }, '♥ ' + m.likes.toLocaleString('ko-KR')),
    ]),
    el('div', { class: 'rc-bottom' }, [
      el('div', { class: 'rc-city' }, m.city),
      el('div', { class: 'rc-tagline' }, m.tagline),
      el('div', { class: 'rc-days' }, m.days + '일'),
    ]),
  ]);
  // Lazy-load AI landmark image, fades in over the gradient when ready.
  _attachLandmarkImage(card, m.city, m.gradient);
  return card;
}

export function renderHomeRoadmaps() {
  const grid = document.getElementById('popularRoadmaps');
  if (grid) {
    grid.innerHTML = '';
    roadmaps.slice(0, 4).forEach(m => grid.appendChild(_cardEl(m)));
  }
  // 추천 로드맵 — 홈에 진입할 때마다 랜덤 도시로 섞어서 보여준다.
  const list = document.getElementById('recoRoadmaps');
  if (list) {
    list.innerHTML = '';
    _shuffle(roadmaps).slice(0, 6).forEach(m => list.appendChild(_cardEl(m)));
  }
  _renderCityMarquee();
}

// 도시 이름 띠 — 끊김 없이 돌도록 같은 묶음을 두 번 놓고, 두 번째는 화면에서만 보이게 한다.
function _renderCityMarquee() {
  const wrap = document.getElementById('cityMarquee');
  if (!wrap) return;
  const cities = [...new Set(roadmaps.map(m => m.city))];
  wrap.hidden = cities.length < 4;
  const group = (copy) => el('div', { class: 'city-marquee-group', 'aria-hidden': copy ? 'true' : null },
    cities.map(city => el('button', {
      type: 'button',
      class: 'city-marquee-item',
      tabIndex: copy ? -1 : 0,
      dataset: { marqueeCity: city },
    }, city)));
  wrap.replaceChildren(el('div', { class: 'city-marquee-track' }, [group(false), group(true)]));
}

export function renderExplore() {
  const grid = document.getElementById('exploreGrid');
  const empty = document.getElementById('exploreEmpty');
  if (!grid) return;
  const items = _filterAndSort(roadmaps);
  grid.innerHTML = '';
  if (items.length === 0) { if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true;
  items.forEach(m => grid.appendChild(_cardEl(m)));
}

function _syncExploreUI() {
  setActiveByData(document.getElementById('exploreFilters'), 'data-filter-concept', explore.concept);
  const input = document.getElementById('exploreSearch');
  if (input && input.value !== explore.query) input.value = explore.query;
  $$('#explorePage .sort-tab').forEach(t => {
    const on = t.dataset.sort === explore.sort;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  });
}

function _renderRoadmapDetail(m) {
  const cover = document.getElementById('roadmapCover');
  const meta  = document.getElementById('roadmapMeta');
  const body  = document.getElementById('roadmapBody');
  if (cover) {
    cover.style.background = m.gradient;
    cover.innerHTML = '';
    cover.append(
      el('div', { class: 'rd-city' }, m.city),
      el('div', { class: 'rd-tag' }, m.title),
    );
    // Same AI landmark on the detail cover.
    _attachLandmarkImage(cover, m.city, m.gradient);
  }
  if (meta) {
    meta.innerHTML = '';
    [`${m.country}`, `${m.days}일`, m.concept, `♥ ${m.likes.toLocaleString('ko-KR')}`].forEach(t => {
      meta.appendChild(el('span', { class: 'meta-pill' }, t));
    });
  }
  if (body) {
    body.innerHTML = '';
    body.appendChild(el('p', { style: { fontSize: '14px', color: 'var(--c-text-soft)', lineHeight: 1.7, margin: '4px 0 16px' } },
      `${m.city}에서의 ${m.days}일은 ${m.concept} 컨셉으로 구성된 인기 루트입니다. 아래 버튼을 눌러 이 일정을 기반으로 나만의 여행을 만들어보세요.`));
    const sample = [
      { time: 'Day 1 · 오전', name: '도착 · 호텔 체크인', cat: '숙박' },
      { time: 'Day 1 · 오후', name: m.tagline.split('·')[0]?.trim() || '핵심 코스', cat: '관광' },
      { time: 'Day 1 · 저녁', name: '현지 인기 맛집', cat: '식사' },
    ];
    sample.forEach(s => {
      body.appendChild(el('div', { class: 'timeline-item', style: { marginBottom: '8px' } }, [
        el('div', { class: 'ti-time' }, s.time),
        el('div', { class: 'ti-body' }, [
          el('div', { class: 'ti-name' }, s.name),
          el('div', { class: 'ti-cat' }, s.cat),
        ]),
        el('div', {}),
      ]));
    });
  }
}
