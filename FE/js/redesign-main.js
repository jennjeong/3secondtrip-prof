/* 3초 여행 — Redesign Main bootstrap */

import { handleOAuthCallbackToken, getAccessToken } from './redesign-api-adapter.js';
import { initNavigation, navigate, onNavChange } from './redesign-navigation.js';
import { initAuth, refreshCurrentUser } from './redesign-auth.js';
import { initRoadmaps, renderHomeRoadmaps, renderExplore } from './redesign-roadmaps.js';
import { initTripFlow } from './redesign-trip-flow.js';
import { initSchedule, renderSchedule, importSharedTripFromURL } from './redesign-schedule.js';
import { initBooking } from './redesign-booking.js';
import { initBlog } from './redesign-blog.js';
import { initFeedback } from './redesign-feedback.js';
import { initReviews, renderReviewPreview, renderReviewSection } from './redesign-reviews.js';
import { initSurvey, renderSurvey } from './redesign-survey.js';
import { initLanguage } from './redesign-ui.js';
import { showToast } from './redesign-ui.js';
import { initCalendar } from './redesign-calendar.js';
import { initSettings } from './redesign-settings.js';
import { initMap, renderMap } from './redesign-map.js';
import { initMyPages } from './redesign-my-pages.js';
import { initSubscription } from './redesign-subscription.js';

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
  initSettings();
  initAuth(appState);
  initRoadmaps(appState);
  initTripFlow(appState);
  initSchedule(appState);
  initBooking(appState);
  initBlog(appState);
  initFeedback(appState);
  initReviews(appState);
  initSurvey(appState);
  initMap(appState);
  initMyPages(appState);
  initSubscription();

  // 5) Initial paint
  renderHomeRoadmaps();
  renderReviewPreview();

  // 6) Auth bootstrap (best-effort)
  if (getAccessToken()) {
    try { await refreshCurrentUser(); } catch (_) { /* offline / 401 — proceed as guest */ }
  }

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
        renderSchedule();      // emits redesign:schedule-changed → map module renders
        renderReviewSection();
        break;
      case 'survey':
        renderSurvey();
        break;
      default:
        break;
    }
  });

  // 8) Persist schedule mutations.  schedule.js dispatches this after every
  //    renderSchedule() call, which covers: day chip click, edit save,
  //    delete, add place, drag-and-drop reorder, touch-drag reorder.
  document.addEventListener('redesign:schedule-changed', saveAppState);

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
