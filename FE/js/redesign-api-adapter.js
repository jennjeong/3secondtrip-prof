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

/* ============ Request wrapper ============ */
export async function apiRequest(path, opts = {}) {
  const token = getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const url = path.startsWith('http') ? path : API_BASE_URL + path;
  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (netErr) {
    const e = new Error('NETWORK_ERROR');
    e.cause = netErr;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = (data && (data.detail || data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
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
    return apiRequest('/roadmaps' + (qs ? '?' + qs : ''));
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
  deleteReview:     (id) => apiRequest(`/reviews/${id}`, { method: 'DELETE' }).catch(() => null),
  submitReview:     (payload) => tolerant(apiRequest('/reviews', { method: 'POST', body: JSON.stringify(payload) })),
  saveReview:       (payload) => tolerant(apiRequest('/reviews', { method: 'POST', body: JSON.stringify(payload) })),
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

  // ===== 실시간 호텔 요금 (Amadeus) — 키는 백엔드, 무결과면 available:false =====
  hotelPrice: (payload) => apiRequest('/api/hotels/price', { method: 'POST', body: JSON.stringify(payload) }),

  // ===== Google Maps proxy — server-side keys, never exposed =====
  searchPlaces: (payload) => apiRequest('/api/places/search', { method: 'POST', body: JSON.stringify(payload) }),
  computeRoute: (payload) => apiRequest('/api/routes',        { method: 'POST', body: JSON.stringify(payload) }),
  saveTripPlacesBulk: (items) => apiRequest('/api/trip-places/bulk', { method: 'POST', body: JSON.stringify(items) }),
  listTripPlaces: (tripId, day) => apiRequest('/api/trip-places?trip_id=' + tripId + (day ? '&day_number=' + day : '')),
  getMapsConfig: () => fetch(API_URL + '/api/config/maps').then(r => r.json()),
};

export const API_URL = API_BASE_URL;

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
