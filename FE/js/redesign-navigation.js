/* 3초 여행 — Redesign Navigation
 * Single-page navigation for the redesigned mobile shell.
 *  - bottom tab + center FAB + content [data-nav-to]
 *  - browser back/forward (history.pushState) preserved
 *  - swipe-left/right edge gestures (optional)
 *  - emits 'redesign:nav' event so feature modules can lazy-init
 */

const TABS = ['home', 'explore', 'create-trip', 'schedule', 'my'];
// 탭을 오가도 목록 위치를 지키는 화면
const KEEP_SCROLL = ['home', 'explore', 'my'];
// 상세·하위 화면이 어느 메뉴 아래인지
const PARENT = { 'roadmap-detail': 'explore', 'local-write': 'explore', 'my-saved': 'my', 'my-roadmaps': 'my', 'my-reviews': 'my', 'my-blogs': 'my',
  subscription: 'my', survey: 'my', feedback: 'my', blog: 'my', signup: 'auth', policy: 'auth' };
const PAGE_TITLES = {
  home: '3초 여행',
  explore: '여행 코스 탐색',
  'create-trip': '새 여행 만들기',
  schedule: '내 일정',
  my: '마이',
  auth: '로그인',
  signup: '회원가입',
  policy: '정책',
  'roadmap-detail': '여행 코스',
  blog: '블로그 쓰기',
  feedback: '의견 보내기',
  survey: '취향 분석',
  'my-saved': '계정에 보관한 일정',
  'my-roadmaps': '내가 쓴 코스',
  'local-write': '우리 동네 코스 쓰기',
  'my-reviews': '내 후기',
  'my-blogs': '내 블로그',
  subscription: '요금제',
};
const HOME_DOC_TITLE = document.title;

/* 방문 기록은 브라우저 history 하나만 쓴다.  각 항목에 idx 를 붙여
 * 앱 안의 뒤로 가기 버튼·스와이프·브라우저 뒤로/앞으로가 같은 기록을 따라가게 한다. */
const state = {
  current: 'home',
  idx: 0,        // 지금 보고 있는 기록의 순번(앱 안에서 처음 연 화면 = 0)
  byPop: false,  // 뒤로/앞으로 이동 중이면 기록을 새로 쌓지 않는다
  meta: {},      // 화면별 정보(예: roadmap-detail.id)
  booted: false, // 첫 화면에서는 초점을 옮기지 않는다
};

const listeners = new Set();
const scrollMemory = {};   // page → 마지막 스크롤 위치

/** Public API */
export function onNavChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getCurrent() { return state.current; }
export function getMeta() { return state.meta; }

/** Move to page. Returns false if page id is unknown. */
export function navigate(pageId, opts = {}) {
  const page = document.querySelector(`.app-page[data-page="${pageId}"]`);
  if (!page) {
    console.warn('[nav] unknown page', pageId);
    return false;
  }
  if (state.current === pageId && !opts.force) {
    // 같은 화면 — 정보(meta)가 바뀌었으면 주소만 덮어쓰고 다시 알린다
    if (opts.meta && !state.byPop) {
      state.meta = opts.meta;
      try { history.replaceState({ page: pageId, meta: state.meta, idx: state.idx }, '', _buildHash(pageId, state.meta)); } catch (_) {}
    }
    _emit(pageId, opts.meta || state.meta || {});
    return true;
  }
  // 떠나는 화면의 스크롤 위치를 기억해 뒤로 가기로 돌아오면 되살린다.
  const prevScroll = document.querySelector('.app-page.is-active .page-scroll');
  if (state.current && prevScroll) scrollMemory[state.current] = prevScroll.scrollTop;
  state.current = pageId;
  state.meta = opts.meta || {};

  document.querySelectorAll('.app-page').forEach(p => p.classList.remove('is-active'));
  page.classList.add('is-active');
  const scroller = page.querySelector('.page-scroll');
  const restoreTo = (state.byPop || KEEP_SCROLL.includes(pageId)) ? scrollMemory[pageId] : null;
  scroller?.scrollTo({ top: 0, behavior: 'instant' });

  _syncTabs(pageId);
  _syncTopbar(pageId);
  document.title = pageId === 'home' ? HOME_DOC_TITLE : `${PAGE_TITLES[pageId] || '3초 여행'} · 3초 여행`;

  if (!state.byPop) {
    try {
      if (opts.replace) history.replaceState({ page: pageId, meta: state.meta, idx: state.idx }, '', _buildHash(pageId, state.meta));
      else { state.idx += 1; history.pushState({ page: pageId, meta: state.meta, idx: state.idx }, '', _buildHash(pageId, state.meta)); }
    } catch (_) {}
  }

  _emit(pageId, state.meta);
  if (restoreTo && scroller) requestAnimationFrame(() => scroller.scrollTo({ top: restoreTo, behavior: 'instant' }));
  if (state.booted) _focusPage(page);
  return true;
}

/** 화면이 바뀌면 그 화면의 제목으로 초점을 옮긴다(화면 낭독기가 새 화면을 읽기 시작하도록).
 *  화면 모듈이 이미 다른 곳(입력칸 등)에 초점을 두었으면 건드리지 않는다. */
function _focusPage(page) {
  requestAnimationFrame(() => {
    if (page.contains(document.activeElement) && document.activeElement !== page) return;
    const h = page.querySelector('h1, .page-title, h2');
    if (!h) return;
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  });
}

/** 뒤로 — 앱 안에서 쌓은 기록이 있으면 브라우저 뒤로와 같게, 없으면 홈으로. */
export function goBack() {
  if (state.idx > 0) { history.back(); return true; }
  // 공유 링크로 바로 들어온 상세 화면은 그 메뉴(예: 탐색)로 돌아간다.
  if (state.current !== 'home') {
    const up = PARENT[state.current];
    navigate(up && up !== 'auth' && up !== state.current ? up : 'home', { replace: true });
    return true;
  }
  return false;
}

/** 앞으로 — 브라우저 앞으로와 같다. */
export function goForward() {
  history.forward();
  return true;
}

/* ============ Internals ============ */
function _emit(page, meta) {
  const ev = new CustomEvent('redesign:nav', { detail: { page, meta } });
  document.dispatchEvent(ev);
  listeners.forEach(cb => { try { cb(page, meta); } catch (_) {} });
}

function _goByHistory(data) {
  state.byPop = true;
  try { navigate(data.page, { meta: data.meta || {} }); }
  finally { state.byPop = false; }
}

function _syncTabs(pageId) {
  // 상세·하위 화면에서도 어느 메뉴 아래인지 보이게 한다.
  const parent = PARENT[pageId] || pageId;
  document.querySelectorAll('.bottom-tab-nav [data-nav-to], .topbar-nav [data-nav-to]').forEach(btn => {
    if (btn.classList.contains('topbar-cta')) return;
    const isActive = btn.dataset.navTo === parent;
    btn.classList.toggle('is-active', isActive);
    if (btn.dataset.navTo === pageId) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function _syncTopbar(pageId) {
  const brand = document.querySelector('.topbar-brand');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#05070D');
  if (brand) { if (pageId === 'home') brand.setAttribute('aria-current', 'page'); else brand.removeAttribute('aria-current'); }
  const topbar = document.getElementById('appTopbar');
  const title = document.getElementById('topbarTitle');
  const back  = document.querySelector('.topbar-back');
  // .sr-only — visually hidden but used by screen readers via aria-live.
  if (title) title.textContent = PAGE_TITLES[pageId] || '3초 여행';
  document.documentElement.dataset.page = pageId;   // 화면별 앱 셸 모양(로고/제목·뒤로/전용 흐름)
  // 여행 만들기는 하단 탭 없이 여는 전용 흐름 — 왼쪽 위 버튼으로 닫는다(작성 내용은 초안으로 남는다).
  const flow = pageId === 'create-trip';
  const showBack = !TABS.includes(pageId) || flow;
  if (back) {
    back.hidden = !showBack;
    back.setAttribute('aria-label', flow ? '여행 만들기 닫기 — 작성한 내용은 남아요' : '뒤로 가기');
    back.classList.toggle('is-close', flow);
  }
  // Class fallback for browsers without :has() — collapses the empty
  // topbar on tab pages so there is no wasted top space.
  if (topbar) topbar.classList.toggle('topbar--collapsed', !showBack);
}

function _buildHash(page, meta) {
  const m = meta && Object.keys(meta).length ? '&' + new URLSearchParams(meta).toString() : '';
  return `#page=${encodeURIComponent(page)}${m}`;
}

function _parseHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const page = params.get('page');
  if (!page) return null;
  const meta = {};
  for (const [k, v] of params.entries()) if (k !== 'page') meta[k] = v;
  return { page, meta };
}

/* ============ Setup ============ */
export function initNavigation() {
  // Maps the My page's data-my-nav tiles to actual destination pages.
  // (data-my-nav exists on tiles like "저장한 일정", "내 후기", etc.  Before
  //  this handler existed, clicking them did nothing.)
  const MY_NAV_MAP = {
    saved:    'my-saved',
    roadmaps: 'my-roadmaps',
    blog:     'my-blogs',
    reviews:  'my-reviews',
    survey:   'survey',
    feedback: 'feedback',
  };

  // Click delegation for any [data-nav-to] / [data-my-nav] / [data-action="goBack"]
  document.addEventListener('click', (e) => {
    // 1) data-nav-to — standard page navigation
    const navEl = e.target.closest?.('[data-nav-to]');
    if (navEl) {
      e.preventDefault();
      const target = navEl.dataset.navTo;
      const meta = {};
      for (const a of navEl.attributes) {
        if (a.name.startsWith('data-meta-')) meta[a.name.slice('data-meta-'.length)] = a.value;
      }
      navigate(target, { meta });
      return;
    }

    // 2) data-my-nav — My page tiles
    const myEl = e.target.closest?.('[data-my-nav]');
    if (myEl) {
      e.preventDefault();
      const kind = myEl.dataset.myNav;
      const target = MY_NAV_MAP[kind];
      if (target) navigate(target, { meta: { from: 'my', kind } });
      return;
    }

    // 3) data-action="goBack"
    const back = e.target.closest?.('[data-action="goBack"]');
    if (back) { e.preventDefault(); goBack(); }
  });

  // Browser history sync — popstate (primary)
  window.addEventListener('popstate', (e) => {
    const data = (e.state && e.state.page) ? e.state : (_parseHash() || { page: 'home', meta: {} });
    state.idx = Number.isInteger(e.state?.idx) ? e.state.idx : 0;
    _goByHistory(data);
  });

  // Browser history sync — hashchange (fallback for Safari 트랙패드 백 제스처,
  // 일부 iOS 빌드의 hash-only 변경에서 popstate 가 안 쏘는 케이스 대비)
  window.addEventListener('hashchange', () => {
    const data = _parseHash();
    if (!data) return;
    if (state.current === data.page) return;     // already in sync — popstate already handled it
    _goByHistory(data);
  });

  // Edge swipe — left edge = back, right edge = forward
  _initEdgeSwipe();

  // Initial route — honour hash if present
  const initial = _parseHash();
  state.idx = Number.isInteger(history.state?.idx) ? history.state.idx : 0;
  if (initial && document.querySelector(`.app-page[data-page="${initial.page}"]`)) {
    navigate(initial.page, { meta: initial.meta, replace: true, force: true });
  } else {
    navigate('home', { replace: true, force: true });
  }
  state.booted = true;
}

/* Edge swipe — Safari/iOS-style 좌측 엣지에서 오른쪽으로 끌면 뒤로,
 *               우측 엣지에서 왼쪽으로 끌면 앞으로.
 *
 *  - 시작점이 좌/우측 EDGE 픽셀 안 (30px) 에서 터치 시작해야 트래킹 시작
 *  - 단, 가로 스크롤러(.chip-row 류) 위에서 시작한 터치는 무시 → 그 스크롤러의
 *    가로 스크롤이 우선이라 사용자 의도가 "스와이프 백" 이 아니라 "리스트 스크롤"
 *  - 손가락이 50px 이상 좌/우로 움직이면 트리거
 *  - 세로 이동이 60px 초과면 (스크롤 의도) 트리거 안 함
 */
function _initEdgeSwipe() {
  let startX = 0, startY = 0, tracking = false, startInScroller = false;
  const EDGE = 30;
  const THRESH = 50;
  const SCROLLER_SEL = '.chip-row, .day-chips, .roadmap-list, .recent-list, .review-preview-list, .sheet-filters, .cal-grid, .cal-weekdays, .lang-menu';

  document.addEventListener('touchstart', (e) => {
    if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
    const t = e.touches[0];
    startInScroller = !!(e.target && e.target.closest && e.target.closest(SCROLLER_SEL));
    if (startInScroller) { tracking = false; return; }
    if (t.clientX <= EDGE || t.clientX >= window.innerWidth - EDGE) {
      startX = t.clientX; startY = t.clientY; tracking = true;
    } else tracking = false;
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) { tracking = false; return; }
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    tracking = false;
    if (dy > 60) return;                         // user was scrolling vertically
    if (startX <= EDGE && dx > THRESH) {
      if (window.__redesign?.debug) console.log('[nav] swipe-back', { dx, dy });
      goBack();
    } else if (startX >= window.innerWidth - EDGE && dx < -THRESH) {
      if (window.__redesign?.debug) console.log('[nav] swipe-forward', { dx, dy });
      goForward();
    }
  }, { passive: true });

  // Cancel tracking if the gesture is interrupted (e.g. iOS native back takes over)
  document.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
}
