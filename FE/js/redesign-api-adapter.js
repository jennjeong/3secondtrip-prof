/* 3초 여행 — Redesign API Adapter
 * Thin adapter on top of the existing backend (FastAPI) and the legacy
 * frontend api.js token store.  No secrets ever live in the frontend —
 * OAuth client secrets, JWT_SECRET and the OpenAI API key all stay on
 * the backend (`/openai/chat` proxy etc).
 *
 * If the legacy `../../js/api.js` module is importable, we re-export
 * its helpers.  Otherwise we fall back to a self-contained fetch shim
 * with the same surface area so the redesign can run standalone.
 */

import { createWaker } from './redesign-wake.js';

const API_BASE_URL = (() => {
  // Priority order:
  //  1) window.__API_BASE_URL (set by a <script> in index-redesign.html for prod)
  //  2) localhost auto-detect for local dev
  //  3) empty (will throw on first call — caller sees clear error)
  if (typeof window !== 'undefined') {
    if (typeof window.__API_BASE_URL === 'string' && window.__API_BASE_URL) {
      return window.__API_BASE_URL.replace(/\/$/, '');
    }
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') {
      return 'http://localhost:8000';
    }
    console.error('[api-adapter] window.__API_BASE_URL is not set — backend calls will fail. '
                + 'Add <script>window.__API_BASE_URL="https://your-backend.onrender.com"</script> '
                + 'to index-redesign.html before redesign-main.js.');
    return '';
  }
  return 'http://localhost:8000';
})();

const TOKEN_KEY = 'tst_token_v1';

/* ============ Token storage ============ */
export function getAccessToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (_) { return null; }
}
export function setAccessToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (_) {}
}
export function clearAccessToken() { setAccessToken(null); }

/* ============ 서버 깨우기 안내 ============
 * 서버(Render 무료)는 한동안 접속이 없으면 잠들고, 첫 요청이 30~60초 걸린다.
 *  - 요청이 3초를 넘기면 화면 위에 '서버를 깨우는 중' 안내를 띄운다.
 *  - 읽기(GET 등)는 연결 실패·502/503/504 때 최대 약 1분 동안 다시 시도한다.
 *  - 쓰기(POST 등)는 게이트웨이가 502/503/504 로 답했을 때만 다시 시도한다
 *    (요청이 앱까지 가지 않았다는 뜻이라 두 번 저장될 걱정이 없다).
 */
const SLOW_MS = 3000;
const RETRY_DELAYS = [2000, 3000, 5000, 8000, 10000, 12000, 15000];   // 합계 약 55초
let slowCount = 0;
let bannerTimer = null;

function _banner() {
  let b = document.getElementById('wakeBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'wakeBanner';
    b.className = 'wake-banner';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.hidden = true;
    document.body.appendChild(b);
  }
  return b;
}
function _showWaking() {
  const b = _banner();
  clearTimeout(bannerTimer);
  b.classList.remove('is-error');
  b.innerHTML = '<span class="wake-spin" aria-hidden="true"></span><span>서버를 깨우는 중이에요 · 처음 열면 최대 1분 걸릴 수 있어요</span>';
  b.hidden = false;
}
function _hideWaking() {
  if (slowCount > 0) return;
  const b = document.getElementById('wakeBanner');
  if (b && !b.classList.contains('is-error')) b.hidden = true;
}
function _showWakeFailed() {
  const b = _banner();
  b.classList.add('is-error');
  b.textContent = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 잠시 뒤 다시 시도해 주세요.';
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; b.classList.remove('is-error'); }, 6000);
}
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

const _alive = (res, body) => res.ok || !!(body && typeof body === 'object' && 'detail' in body);   // 우리 서버가 직접 답했는지(앞단의 오류 화면이 아닌지)
const _waker = createWaker({
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  ping: async (signal) => {
    const early = typeof window !== 'undefined' ? window.__wake : null;      // 첫 HTML 에서 보낸 요청이 있으면 이어 쓴다
    if (early) { window.__wake = null; 
      const stop = new Promise(r => signal.addEventListener('abort', () => r(null), { once: true }));
      if ((await Promise.race([early, stop]))?.ok) return true;
      if (signal.aborted) return false;
    }
    const res = await fetch(API_BASE_URL + '/health', { cache: 'no-store', signal });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    return _alive(res, body);
  },
});
/** 앱을 열자마자 조용히 서버를 깨우고, 화면에 떠 있는 동안 잠들지 않게 한다(안내는 띄우지 않음). */
export function wakeServer() {
  if (!API_BASE_URL) return;
  _waker.wake();
  _waker.watch(document);
}
/** 서버가 깨어 있는 것을 확인한다 — 제한 시간이 있는 요청을 보내기 전에 부른다. 끝내 응답이 없으면 false. */
export const ensureAwake = (opts) => _waker.ensure(opts);

/* ============ Request wrapper ============ */
async function _once(url, opts, headers) {
  let res;
  try {
    const { quiet, ...fetchOpts } = opts;
    res = await fetch(url, { ...fetchOpts, headers });
  } catch (netErr) {
    const e = new Error('NETWORK_ERROR');
    e.cause = netErr;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (url.startsWith(API_BASE_URL) && _alive(res, data)) _waker.touch();
  if (!res.ok) {
    // 외부 제공처 오류는 detail 이 { code, message, retryable } 로 온다.
    const d = data && data.detail;
    const info = d && typeof d === 'object' && !Array.isArray(d) && d.code ? d : null;
    const msg = (info ? info.message : (data && (data.detail || data.message || data.error))) || `HTTP ${res.status}`;
    const err = new Error(msg);
    if (info) { err.code = info.code; err.retryable = !!info.retryable; err.provider = info.provider || ''; }
    err.status = res.status;
    err.body = data;
    // 우리 서버가 직접 답한 오류(JSON detail 있음, 예: '설정되지 않음' 503)인지,
    // 서버 앞단(Render 게이트웨이)이 대신 답한 것인지 구분한다 — 후자만 '깨우는 중'으로 본다.
    err.fromApp = !!(data && typeof data === 'object' && 'detail' in data);
    throw err;
  }
  return data;
}

export async function apiRequest(path, opts = {}) {
  const token = getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const url = path.startsWith('http') ? path : API_BASE_URL + path;
  const method = (opts.method || 'GET').toUpperCase();
  const safe = method === 'GET' || method === 'HEAD';
  const gateway = (e) => (e?.status === 502 || e?.status === 503 || e?.status === 504) && !e.fromApp;

  let slow = false;
  const markSlow = () => { if (slow) return; slow = true; slowCount++; _showWaking(); };   // 한 요청은 한 번만 센다
  // quiet: 기다리는 동안에도 화면에 볼 내용이 있는 요청(코스 목록·기능 확인·이벤트)은 안내를 띄우지 않는다.
  const slowTimer = opts.quiet ? null : setTimeout(markSlow, SLOW_MS);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await _once(url, opts, headers);
      } catch (e) {
        // 기기 자체가 오프라인이면 기다리지 않는다(오프라인 화면·기본 코스를 바로 보여 준다).
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        const retryable = !offline && (gateway(e) || (safe && e?.message === 'NETWORK_ERROR'));
        if (!retryable || attempt >= RETRY_DELAYS.length) {
          if (!opts.quiet && (retryable || slow)) _showWakeFailed();
          throw e;
        }
        if (!opts.quiet) markSlow();
        await _sleep(RETRY_DELAYS[attempt]);
      }
    }
  } finally {
    clearTimeout(slowTimer);
    if (slow) { slowCount = Math.max(0, slowCount - 1); _hideWaking(); }
  }
}

/* ============ Auth helpers ============
 * Backend OAuth routes are implemented for all four providers
 * (google/kakao/naver/apple) under /auth/{provider}/login.
 */
const SUPPORTED_PROVIDERS = ['google', 'kakao', 'apple', 'naver'];

export function startSocialLogin(provider) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) return;
  window.location.href = `${API_BASE_URL}/auth/${provider}/login`;
}

/** Read ?token= or #token= from URL after OAuth redirect.
 * Saves to localStorage and rewrites the URL so the token doesn't linger.
 */
/**
 * URL 해시에서 한 번만 쓰는 값(#login_error=…, #reset_token=…)을 꺼내고 주소에서 지운다.
 * 토큰·오류 코드가 주소창·방문 기록에 남지 않게 한다.
 */
export function takeHashParam(name) {
  if (!window.location.hash) return null;
  const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const v = hp.get(name);
  if (v == null) return null;
  hp.delete(name);
  const rem = hp.toString();
  try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (rem ? '#' + rem : '')); } catch (_) {}
  return v;
}

export function handleOAuthCallbackToken() {
  let token = null;
  if (window.location.hash) {
    const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    token = hp.get('token');
  }
  if (!token) {
    const qp = new URLSearchParams(window.location.search);
    token = qp.get('token');
  }
  if (!token) return false;
  setAccessToken(token);
  // Clean URL
  const qp = new URLSearchParams(window.location.search);
  qp.delete('token');
  let newHash = '';
  if (window.location.hash) {
    const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    hp.delete('token');
    const rem = hp.toString();
    newHash = rem ? '#' + rem : '';
  }
  const newSearch = qp.toString();
  const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + newHash;
  try { window.history.replaceState({}, '', newUrl); } catch (_) {}
  return true;
}

/* ============ Domain API surface ============
 * Endpoints match `backend/app/routers/*` exactly.  All endpoints that
 * require auth automatically receive the Bearer JWT via apiRequest().
 * Network/server errors propagate as thrown Error with .status; the
 * "stub-tolerant" calls below swallow 404/501 from optional backends so
 * the UI degrades to local-cache mode.
 */
let _featuresPromise = null;
const tolerant = (p) => p.catch((e) => {
  if (e && (e.status === 404 || e.status === 501)) return null;
  throw e;
});

export const api = {
  // ===== Auth / Users =====
  me:               () => apiRequest('/auth/me'),
  getCurrentUser:   () => apiRequest('/auth/me'),
  logout:           () => apiRequest('/auth/logout', { method: 'POST' }),
  checkNickname:    (nickname) => apiRequest('/users/check-nickname?nickname=' + encodeURIComponent(nickname)),
  checkEmail:       (email)    => apiRequest('/users/check-email?email='       + encodeURIComponent(email)),
  signup:           (payload) => apiRequest('/users/signup', { method: 'POST', body: JSON.stringify(payload) }),
  loginEmail:       (payload) => apiRequest('/users/login',  { method: 'POST', body: JSON.stringify(payload) }),
  updateMe:         (payload) => apiRequest('/users/me',     { method: 'PATCH', body: JSON.stringify(payload) }),

  // Social login is a top-level redirect; expose a helper that doesn't fetch
  startSocialLogin: (provider) => {
    const allowed = ['google', 'kakao', 'naver', 'apple'];
    if (!allowed.includes(provider)) return;
    window.location.href = `${API_BASE_URL}/auth/${provider}/login`;
  },

  // ===== Trips =====
  listTrips:  () => apiRequest('/trips'),
  getTrips:   () => apiRequest('/trips'),
  createTrip: (trip) => apiRequest('/trips', { method: 'POST', body: JSON.stringify(trip) }),
  saveTrip:   (trip) => apiRequest('/trips', { method: 'POST', body: JSON.stringify(trip) }),
  updateTrip: (id, trip) => apiRequest(`/trips/${id}`, { method: 'PATCH', body: JSON.stringify(trip) }),
  deleteTrip: (id) => apiRequest(`/trips/${id}`, { method: 'DELETE' }),

  // ===== Schedules =====
  listSchedules:   () => apiRequest('/schedules'),
  getSchedules:    () => apiRequest('/schedules'),
  createSchedule:  (payload) => apiRequest('/schedules', { method: 'POST', body: JSON.stringify(payload) }),
  updateSchedule:  (id, payload) => apiRequest(`/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSchedule:  (id) => apiRequest(`/schedules/${id}`, { method: 'DELETE' }),
  saveSchedule:    (id) => apiRequest(`/schedules/${id}/save`, { method: 'POST' }),
  unsaveSchedule:  (id) => apiRequest(`/schedules/${id}/save`, { method: 'DELETE' }),

  // ===== Roadmaps (public read, login write) =====
  getRoadmaps:        (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return apiRequest('/roadmaps' + (qs ? '?' + qs : ''), { quiet: true });   // 예시 코스가 먼저 보이므로 조용히
  },
  getPopularRoadmaps: (limit = 8) => apiRequest(`/roadmaps/popular?limit=${limit}`),
  getRoadmap:         (id) => apiRequest(`/roadmaps/${id}`),

  // ===== Bookings =====
  saveBooking: (payload) => apiRequest('/bookings', { method: 'POST', body: JSON.stringify(payload) }),
  listBookings: () => apiRequest('/bookings'),

  // ===== Blogs =====
  saveBlog:    (payload) => tolerant(apiRequest('/blogs', { method: 'POST', body: JSON.stringify(payload) })),
  listBlogs:   (q = {}) => {
    const qs = new URLSearchParams(q).toString();
    return tolerant(apiRequest('/blogs' + (qs ? '?' + qs : ''))) || [];
  },

  // ===== Reviews =====
  deleteReview:     (id) => apiRequest(`/reviews/${id}`, { method: 'DELETE' }),
  updateReview:     (id, payload) => apiRequest(`/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  submitReview:     (payload) => tolerant(apiRequest('/reviews', { method: 'POST', body: JSON.stringify(payload) })),
  saveReview:       (payload) => apiRequest('/reviews', { method: 'POST', body: JSON.stringify(payload) }),
  listReviews:      (q = {}) => {
    const qs = new URLSearchParams(q).toString();
    return tolerant(apiRequest('/reviews' + (qs ? '?' + qs : '')));
  },
  getRecentReviews: (limit = 8) => tolerant(apiRequest(`/reviews/recent?limit=${limit}`)),

  // ===== Feedback =====
  submitFeedback: (payload) => tolerant(apiRequest('/feedback', { method: 'POST', body: JSON.stringify(payload) })),
  saveFeedback:   (payload) => tolerant(apiRequest('/feedback', { method: 'POST', body: JSON.stringify(payload) })),

  // ===== Surveys (taste preferences) =====
  saveSurvey:     (payload) => apiRequest('/surveys/me', { method: 'POST', body: JSON.stringify(payload) }),
  getSurvey:      () => apiRequest('/surveys/me'),

  // ===== OpenAI proxy — API key stays on backend =====
  openaiChat: (prompt) => apiRequest('/openai/chat', { method: 'POST', body: JSON.stringify({ prompt }) }),
  // 서버에 연결된 외부 기능(실시간 항공·숙소 요금, AI 요약). 결과는 한 번만 받아 둔다.
  // 예전 서버처럼 이 주소가 없으면 모두 켜진 것으로 보고, 실패하면 각 호출의 대체 처리가 맡는다.
  features: ({ fresh = false } = {}) => { if (fresh) _featuresPromise = null; return (_featuresPromise ||= apiRequest('/api/features', { quiet: true })
    .then(f => ({ liveFlights: !!f.live_flights, liveHotels: !!f.live_hotels, ai: !!f.ai_summary, places: f.places !== false,
                  passwordReset: !!f.password_reset, oauth: f.oauth || null, checkedAt: new Date().toISOString() }))
    // 서버 상태를 알 수 없으면 외부 기능은 꺼진 것으로 본다(실패할 호출을 미리 하지 않고 추정치를 쓴다).
    .catch(() => { _featuresPromise = null; return { liveFlights: false, liveHotels: false, ai: false, places: true, passwordReset: false, oauth: null, checkedAt: null, unknown: true }; })); },
  // 로그인한 상태에서 비밀번호 변경(다른 기기는 로그아웃) · 모든 기기에서 로그아웃
  changePassword: (current_password, new_password) => apiRequest('/users/me/password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  logoutAll: () => apiRequest('/users/me/logout-all', { method: 'POST' }),
  // 계정 삭제 — 확인 문구 '계정 삭제' + (이메일 가입 계정이면) 비밀번호
  deleteAccount: (confirm, password) => apiRequest('/users/me/delete', { method: 'POST', body: JSON.stringify({ confirm, password: password || null }) }),
  // 비밀번호 재설정 — 가입 여부와 상관없이 같은 응답(202)
  requestPasswordReset: (email) => apiRequest('/users/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) }),
  confirmPasswordReset: (token, password) => apiRequest('/users/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) }),

  // ===== SerpApi Google Hotels proxy — real nightly prices, server-side key =====
  // Tolerant: 404 (no results) / 501 → null so the trip flow falls back to estimate.
  searchHotels: (payload) => tolerant(apiRequest('/api/hotels/search', { method: 'POST', body: JSON.stringify(payload) })),

  // ===== SerpApi Google Flights proxy — real round-trip fares, server-side key =====
  // Tolerant: 404/501 → null so the trip flow falls back to the estimate formula.
  searchFlights: (payload) => tolerant(apiRequest('/api/flights/search', { method: 'POST', body: JSON.stringify(payload) })),

  // ===== 함께 편집 — 토큰을 아는 사람만 접근 =====
  createSharedTrip: (payload) => apiRequest('/api/shared-trips', { method: 'POST', body: JSON.stringify(payload) }),
  getSharedTrip:    (token) => apiRequest(`/api/shared-trips/${encodeURIComponent(token)}`),
  updateSharedTrip: (token, payload) => apiRequest(`/api/shared-trips/${encodeURIComponent(token)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  revokeSharedTrip: (token, manageKey) => apiRequest(`/api/shared-trips/${encodeURIComponent(token)}`, { method: 'DELETE', headers: { 'X-Manage-Key': manageKey } }),

  // ===== Google Maps proxy — server-side keys, never exposed =====
  searchPlaces: (payload) => apiRequest('/api/places/search', { method: 'POST', body: JSON.stringify(payload) }),
  computeRoute: (payload) => apiRequest('/api/routes',        { method: 'POST', body: JSON.stringify(payload) }),
  saveTripPlacesBulk: (items) => apiRequest('/api/trip-places/bulk', { method: 'POST', body: JSON.stringify(items) }),
  listTripPlaces: (tripId, day) => apiRequest('/api/trip-places?trip_id=' + tripId + (day ? '&day_number=' + day : '')),
  getMapsConfig: () => fetch(API_URL + '/api/config/maps').then(r => r.json()),
};

export const API_URL = API_BASE_URL;

/** 이용 통계 — 실패해도 사용자 동작에 영향을 주지 않는다. */
export function trackEvent(name) {
  apiRequest('/api/events', { method: 'POST', body: JSON.stringify({ name }), keepalive: true, quiet: true }).catch(() => {});
}

/* ============ Bridge to legacy frontend (if mounted side-by-side) ============
 * Some installs include the original ../../js/api.js loaded by the old shell.
 * If it has set window.__tst_legacy, we adopt its token so users stay logged in.
 */
try {
  if (typeof window !== 'undefined' && window.__tst_legacy && typeof window.__tst_legacy.getAccessToken === 'function') {
    const legacyTok = window.__tst_legacy.getAccessToken();
    if (legacyTok && !getAccessToken()) setAccessToken(legacyTok);
  }
} catch (_) {}
