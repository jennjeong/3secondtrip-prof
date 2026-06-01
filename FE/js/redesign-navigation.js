/* 3초 여행 — Redesign Navigation
 * Single-page navigation for the redesigned mobile shell.
 *  - bottom tab + center FAB + content [data-nav-to]
 *  - browser back/forward (history.pushState) preserved
 *  - swipe-left/right edge gestures (optional)
 *  - emits 'redesign:nav' event so feature modules can lazy-init
 */

const TABS = ['home', 'explore', 'create-trip', 'schedule', 'my'];
const PAGE_TITLES = {
  home: '3초 여행',
  explore: '탐색',
  'create-trip': '새 여행 만들기',
  schedule: '나의 일정',
  my: '마이',
  auth: '로그인',
  'roadmap-detail': '로드맵',
  blog: '블로그',
  feedback: '피드백',
  survey: '취향 분석',
  'my-saved': '저장한 일정',
  'my-roadmaps': '내 로드맵',
  'my-reviews': '내 후기',
  'my-blogs': '내 블로그',
  subscription: '구독 · 멤버십',
};

const state = {
  current: 'home',
  history: [],   // back stack
  forward: [],   // forward stack (cleared on new nav)
  byPop: false,  // true when popstate-driven (don't push)
  meta: {},      // optional per-page context (e.g. roadmap-detail.id)
};

const listeners = new Set();

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
    // Re-emit so modules can refresh
    _emit(pageId, opts.meta || {});
    return true;
  }
  if (!state.byPop) {
    if (state.current) state.history.push({ page: state.current, meta: { ...state.meta } });
    state.forward = [];
  }
  state.current = pageId;
  state.meta = opts.meta || {};

  // Toggle page visibility
  document.querySelectorAll('.app-page').forEach(p => p.classList.remove('is-active'));
  page.classList.add('is-active');
  page.querySelector('.page-scroll')?.scrollTo({ top: 0, behavior: 'instant' });

  _syncTabs(pageId);
  _syncTopbar(pageId);

  // Push to browser history
  if (!state.byPop && !opts.replace) {
    try { history.pushState({ page: pageId, meta: state.meta }, '', _buildHash(pageId, state.meta)); }
    catch (_) {}
  } else if (!state.byPop && opts.replace) {
    try { history.replaceState({ page: pageId, meta: state.meta }, '', _buildHash(pageId, state.meta)); } catch (_) {}
  }

  _emit(pageId, state.meta);
  return true;
}

/** Go back — uses internal history first, then natural Home fallback */
export function goBack() {
  if (state.history.length > 0) {
    const entry = state.history.pop();
    state.forward.push({ page: state.current, meta: { ...state.meta } });
    state.byPop = true;
    navigate(entry.page, { meta: entry.meta });
    state.byPop = false;
    try { history.back(); } catch (_) {}
    return true;
  }
  if (state.current !== 'home') { navigate('home'); return true; }
  return false;
}

/** Go forward — uses forward stack if available */
export function goForward() {
  if (state.forward.length === 0) return false;
  const entry = state.forward.pop();
  state.history.push({ page: state.current, meta: { ...state.meta } });
  state.byPop = true;
  navigate(entry.page, { meta: entry.meta });
  state.byPop = false;
  return true;
}

/* ============ Internals ============ */
function _emit(page, meta) {
  const ev = new CustomEvent('redesign:nav', { detail: { page, meta } });
  document.dispatchEvent(ev);
  listeners.forEach(cb => { try { cb(page, meta); } catch (_) {} });
}

function _syncTabs(pageId) {
  document.querySelectorAll('.bottom-tab-nav [data-nav-to]').forEach(btn => {
    const isActive = btn.dataset.navTo === pageId;
    btn.classList.toggle('is-active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function _syncTopbar(pageId) {
  const topbar = document.getElementById('appTopbar');
  const title = document.getElementById('topbarTitle');
  const back  = document.querySelector('.topbar-back');
  // .sr-only — visually hidden but used by screen readers via aria-live.
  if (title) title.textContent = PAGE_TITLES[pageId] || '3초 여행';
  const showBack = !TABS.includes(pageId);
  if (back) back.hidden = !showBack;
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
    const data = (e.state && e.state.page) ? e.state : _parseHash();
    if (!data) { state.byPop = true; navigate('home'); state.byPop = false; return; }
    state.byPop = true;
    navigate(data.page, { meta: data.meta || {} });
    state.byPop = false;
  });

  // Browser history sync — hashchange (fallback for Safari 트랙패드 백 제스처,
  // 일부 iOS 빌드의 hash-only 변경에서 popstate 가 안 쏘는 케이스 대비)
  window.addEventListener('hashchange', () => {
    const data = _parseHash();
    if (!data) return;
    if (state.current === data.page) return;     // already in sync — popstate already handled it
    state.byPop = true;
    navigate(data.page, { meta: data.meta || {} });
    state.byPop = false;
  });

  // Edge swipe — left edge = back, right edge = forward
  _initEdgeSwipe();

  // Initial route — honour hash if present
  const initial = _parseHash();
  if (initial && document.querySelector(`.app-page[data-page="${initial.page}"]`)) {
    navigate(initial.page, { meta: initial.meta, replace: true });
  } else {
    navigate('home', { replace: true });
  }
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
