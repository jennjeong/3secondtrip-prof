/* 3초 여행 — Redesign Main bootstrap */

import { handleOAuthCallbackToken, getAccessToken } from './redesign-api-adapter.js';
import { initNavigation, navigate, onNavChange, getCurrent } from './redesign-navigation.js';
import { initAuth, refreshCurrentUser, handleAuthReturn, captureAuthHash } from './redesign-auth.js';
import { initRoadmaps, renderHomeRoadmaps, renderExplore } from './redesign-roadmaps.js';
import { initTripFlow } from './redesign-trip-flow.js';
import { initSchedule, renderSchedule, importSharedTripFromURL } from './redesign-schedule.js';
import { initBlog } from './redesign-blog.js';
import { initFeedback } from './redesign-feedback.js';
import { initReviews, renderReviewPreview, renderReviewSection } from './redesign-reviews.js';
import { initSurvey, renderSurvey } from './redesign-survey.js';
import { initLanguage } from './redesign-ui.js';
import { showToast, initDialogs } from './redesign-ui.js';
import { initCalendar } from './redesign-calendar.js';
import { initSettings } from './redesign-settings.js';
import { initMyPages } from './redesign-my-pages.js';
import { initSubscription } from './redesign-subscription.js';
import { initCollab } from './redesign-collab.js';
import { initAppShell } from './redesign-app-shell.js';

/** 결과 화면에서만 쓰는 지도·여행 도구(날씨·환율·내보내기)·예약 모듈은 필요할 때 불러온다.
 *  첫 화면(홈)에 필요한 코드만 먼저 받게 해 휴대폰에서 더 빨리 뜨게 한다. */
let _resultModules = null;
function _loadResultModules() {
  if (!_resultModules) {
    _resultModules = Promise.all([
      import('./redesign-map.js'),
      import('./redesign-trip-tools.js'),
      import('./redesign-booking.js'),
    ]).then(([map, tools, booking]) => {
      map.initMap(appState);
      tools.initTripTools(appState);
      booking.initBooking(appState);
    }).catch((e) => { _resultModules = null; console.warn('[main] 결과 화면 모듈을 불러오지 못했어요', e?.message); });
  }
  return _resultModules;
}

/** Shared app state (mutable, observable via custom events) */
export const appState = {
  trip: {
    country: '',
    city: '',
    cityName: '',
    startDate: null,
    endDate: null,
    days: 0,
    companion: 'couple',
    concept: '',
    styles: [],
    budget: 120,             // 만원
    budgetLevel: '보통',
    currency: 'KRW',
  },
  generated: null,           // schedule object
  expenses: {},
  currentUser: null,
  preferences: null,         // taste survey result
};

/** Expose for debugging */
if (typeof window !== 'undefined') window.__redesign = { appState };

/* ────────────────────────────────────────────────────────────────
 * Persist the most important user-visible state so reload doesn't
 * wipe a generated schedule.  We snapshot generated + expenses + trip
 * form into localStorage on every schedule mutation and restore on
 * startup before any module renders.
 * ──────────────────────────────────────────────────────────────── */
const STATE_KEY = 'tst_app_state_v1';

/* ─────────────────────────────────────────────────────────────────
 * BUILD_VERSION — bump this whenever the schedule/state schema changes
 * so old saved data doesn't break new code.  On mismatch, the schedule
 * + place cache are wiped automatically.  Auth, language, dark mode and
 * drafts are preserved so users don't get logged out.
 * ───────────────────────────────────────────────────────────────── */
const BUILD_VERSION = '20260604-serpapi-hotel-price-no-correction';
const BUILD_VERSION_KEY = 'tst_build_version';

function migrateStaleState() {
  try {
    const prev = localStorage.getItem(BUILD_VERSION_KEY);
    if (prev !== BUILD_VERSION) {
      const toClear = [
        STATE_KEY,
        'tst_place_cache_v3', 'tst_place_cache_v2', 'tst_place_cache_v1',
      ];
      toClear.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      localStorage.setItem(BUILD_VERSION_KEY, BUILD_VERSION);
      console.log('[main] build version changed → cleared stale state. now:', BUILD_VERSION, '/ was:', prev);
    }
  } catch (_) { /* private mode etc. — ignore */ }
}

function saveAppState() {
  try {
    const snap = {
      generated: appState.generated,
      expenses:  appState.expenses || {},
      trip:      appState.trip,
      savedAt:   Date.now(),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(snap));
  } catch (_) { /* quota / private mode — ignore */ }
}

/** 오프라인 안내 — 연결이 끊기면 이 기기에 저장된 일정을 보여 준다는 것과 마지막 저장 시각을 알린다. */
function paintOffline() {
  const bar = document.getElementById('offlineBanner');
  if (!bar) return;
  if (navigator.onLine !== false) { bar.hidden = true; return; }
  let at = null;
  try { at = JSON.parse(localStorage.getItem(STATE_KEY) || '{}').savedAt || null; } catch (_) {}
  const when = at ? new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  bar.textContent = appState.generated
    ? `인터넷 연결이 없어요. 이 기기에 저장된 일정·주소·준비물을 보여 드려요${when ? ` (마지막 저장 ${when})` : ''}. 지도·날씨·계정 저장은 연결되면 다시 돼요.`
    : '인터넷 연결이 없어요. 연결되면 일정을 만들 수 있어요.';
  bar.hidden = false;
}

function restoreAppState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.generated && typeof s.generated === 'object') appState.generated = s.generated;
    if (s.expenses  && typeof s.expenses  === 'object') appState.expenses  = s.expenses;
    if (s.trip      && typeof s.trip      === 'object') appState.trip      = { ...appState.trip, ...s.trip };
  } catch (_) {}
}

function updateDeviceClass() {
  const w = window.innerWidth;
  const b = document.body;
  if (!b) return;
  b.classList.toggle('is-small-mobile', w < 375);
  b.classList.toggle('is-mobile',       w >= 375 && w < 768);
  b.classList.toggle('is-tablet',       w >= 768 && w < 1024);
  b.classList.toggle('is-laptop',       w >= 1024 && w < 1280);
  b.classList.toggle('is-desktop',      w >= 1280);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1) OAuth callback — capture token before anything else
  handleOAuthCallbackToken();
  captureAuthHash();   // #login_error / #reset_token — 첫 화면 이동 전에 꺼내 둔다

  // 1.5) Device-class hint for optional behavior (CSS still owns layout)
  updateDeviceClass();
  window.addEventListener('resize', updateDeviceClass, { passive: true });

  // 1.7) Restore persisted state (generated schedule etc.) BEFORE any module
  //      reads from appState.  This way, a reload of #page=schedule still
  //      shows the previously generated itinerary + its map.
  migrateStaleState();   // ← clears old schedules on version bump
  restoreAppState();

  // 2) Init UI helpers (language, toasts) — independent of state
  initLanguage();

  // 1.8) 공유 링크(#page=schedule&trip=…)로 들어왔으면 URL에서 일정을 복원.
  //      최초 렌더 전에 appState.generated를 채워야 그 일정이 바로 그려진다.
  importSharedTripFromURL(appState);

  // 3) Init navigation (registers click delegation + popstate)
  initNavigation();

  // 4) Init feature modules
  initCalendar();
  initSettings(appState);
  initAuth(appState);
  initRoadmaps(appState);
  initTripFlow(appState);
  initSchedule(appState);
  initBlog(appState);
  initFeedback(appState);
  initReviews(appState);
  initSurvey(appState);
  initMyPages(appState);
  initSubscription(appState);
  initCollab(appState, renderSchedule);
  initAppShell();
  initDialogs();
  // 소셜 로그인 취소·실패(#login_error), 비밀번호 재설정 링크(#reset_token) 처리
  handleAuthReturn();

  // 휴대폰 키보드가 올라오면 입력칸(과 그 아래 오류 문구)이 화면 안에 남도록 가운데로 옮긴다.
  if (matchMedia('(pointer: coarse)').matches) {
    const keepVisible = (t) => {
      if (!t?.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select')) return;
      const err = t.closest('.form-row, .trip-flow-field')?.querySelector('.form-error:not([hidden]), [role="alert"]:not([hidden])');
      (err || t).scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    document.addEventListener('focusin', (e) => setTimeout(() => keepVisible(e.target), 320));
    window.visualViewport?.addEventListener('resize', () => keepVisible(document.activeElement));
  }

  // 5) Initial paint
  renderHomeRoadmaps();
  renderReviewPreview();

  // 6) Auth bootstrap (best-effort)
  if (getAccessToken()) {
    try { await refreshCurrentUser(); } catch (_) { /* offline / 401 — proceed as guest */ }
  }
  // 로그인 상태를 확인한 뒤 — 주소로 바로 들어온 화면(저장한 일정 등)이 다시 그리도록 알린다.
  document.dispatchEvent(new CustomEvent('redesign:auth-ready'));

  // 7) Refresh views on nav
  onNavChange((page) => {
    switch (page) {
      case 'home':
        renderHomeRoadmaps();
        renderReviewPreview();
        break;
      case 'explore':
        renderExplore();
        break;
      case 'schedule':
        renderSchedule();      // 목록을 먼저 그리고
        renderReviewSection();
        _loadResultModules().then(() => { if (getCurrent() === 'schedule') renderSchedule(); });   // 지도·도구가 준비되면 다시
        break;
      case 'survey':
        renderSurvey();
        break;
      default:
        break;
    }
  });

  // 결과 화면으로 바로 들어온 경우, 그리고 첫 화면이 다 그려진 뒤 미리 받아 두기
  if (getCurrent() === 'schedule') _loadResultModules().then(renderSchedule);
  else (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => setTimeout(_loadResultModules, 2500));

  // 8) Persist schedule mutations.  schedule.js dispatches this after every
  //    renderSchedule() call, which covers: day chip click, edit save,
  //    delete, add place, drag-and-drop reorder, touch-drag reorder.
  document.addEventListener('redesign:schedule-changed', saveAppState);
  document.addEventListener('redesign:trip-changed', saveAppState);   // 작성 중인 여행 임시 저장
  window.addEventListener('online', () => { paintOffline(); showToast('다시 연결됐어요'); });
  window.addEventListener('offline', paintOffline);
  paintOffline();

  // 8.5) Surface friendly errors
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.message && /NETWORK_ERROR|Failed to fetch/.test(e.reason.message)) {
      showToast('네트워크에 연결할 수 없어요');
    }
  });

  // 9) Initial schedule render — so if the user lands directly on
  //    #page=schedule after restore, the timeline + map paint right away.
  if (appState.generated) {
    try { renderSchedule(); } catch (_) {}
  }
});
