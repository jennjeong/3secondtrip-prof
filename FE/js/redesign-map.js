/* 3초 여행 — Day route map embedded inside the Schedule screen.
 *
 *  Single source of truth: redesign-schedule.js owns `activeDay` and the
 *  trip's day data.  Every mutation funnels through its renderSchedule()
 *  which dispatches `redesign:schedule-changed` (detail = { activeDay,
 *  generated }).  This module listens and re-renders the map.
 *
 *  Pipeline per render:
 *    1. Pick activities for activeDay from appState.generated.
 *    2. Normalize each place into { id, name, address, lat, lng, order, dayNumber }.
 *    3. For places missing lat/lng, resolve via backend /api/places/search.
 *    4. Draw numbered markers, clear any previous polyline, request route
 *       (origin = first, destination = last, intermediates = middle),
 *       decode encoded polyline, draw google.maps.Polyline, fit bounds.
 *
 *  Single Google Maps script load (loadGoogleMapsScript), single map
 *  instance reused across days, careful cleanup before each redraw.
 *
 *  Public surface:
 *    - initMap(appState)           wire listeners + bind toolbar
 *    - initializeScheduleMap(d)    one-shot init for a day (also auto-fired)
 *    - renderDayRoute(d)           explicit render for a day
 *    - clearDayMap()               clear markers + polyline
 *
 *  Internal helpers exposed for testability:
 *    getPlacesForDay, normalizePlaceCoordinates, requestRouteFromBackend,
 *    decodePolyline, drawDayMarkers, drawDayPolyline, fitMapToMarkersAndRoute,
 *    updateRouteSummary, openDayRouteInGoogleMaps.
 */

import { api, API_URL } from './redesign-api-adapter.js';
import {
  $, $$, el, showToast,
  getSchedulePlaceName, getScheduleAddress,
} from './redesign-ui.js';

let appState = null;
let map = null;
let markers = [];
let polyline = null;
let activeDay = 0;
let travelMode = 'DRIVE';
let lastResolved = [];                 // [{ name, address, lat, lng, place_id, order }]
let mapsLoaded = false;
let mapsLoadingPromise = null;
let scriptInjected = false;

// Bumped from v2 → v3: v2 entries cached coords only (no name).  With the
// new "real name stamp-back" we need a fresh cache layout.  Old v2 entries
// remain in localStorage but no code reads them.
const PLACES_CACHE_KEY = 'tst_place_cache_v3';
const placesCache = new Map();          // "city|name" → resolved coords

/* ============================================================
 *  Init — bind toolbar, listen to schedule events
 * ============================================================ */
export function initMap(state) {
  appState = state;

  // Restore in-memory cache from localStorage
  try {
    const raw = localStorage.getItem(PLACES_CACHE_KEY);
    if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => placesCache.set(k, v));
  } catch (_) {}

  // Mode chips — re-fetch route with the newly chosen travel mode.
  // (Old code called _drawRoute() which no longer exists; the new
  //  smart-fallback path lives inside renderDayRoute.)
  $('#scheduleMapModeRow')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-travel-mode]');
    if (!b) return;
    if (travelMode === b.dataset.travelMode) return;          // already on this mode
    travelMode = b.dataset.travelMode;
    $$('#scheduleMapModeRow .chip').forEach(c => c.classList.toggle('is-active', c === b));
    // Show the loading overlay during the re-fetch so user sees feedback
    const loading = $('#scheduleMapLoading');
    if (loading) loading.hidden = false;
    renderDayRoute(activeDay).finally(() => {
      if (loading) loading.hidden = true;
    });
  });

  // External nav
  $('#scheduleMapOpenExt')?.addEventListener('click', openDayRouteInGoogleMaps);

  // Listen for schedule changes (day change / add / remove / edit / drag)
  document.addEventListener('redesign:schedule-changed', (e) => {
    const d = e.detail || {};
    if (typeof d.activeDay === 'number') activeDay = d.activeDay;
    // Only render if schedule page is active; otherwise wait for nav
    if (document.getElementById('schedulePage')?.classList.contains('is-active')) {
      renderDayRoute(activeDay);
    }
  });
}

/** Called from main.js on every nav to 'schedule'. */
export function renderMap() {
  renderDayRoute(activeDay);
}

/* ============================================================
 *  Public renderer for a given day
 * ============================================================ */
export async function renderDayRoute(dayIdx) {
  activeDay = Math.max(0, Number(dayIdx) || 0);
  const card  = $('#scheduleMapCard');
  const empty = $('#scheduleMapEmpty');
  const warn  = $('#scheduleMapWarning');

  const g = appState?.generated;

  // No schedule generated at all → hide the map card entirely.  The
  // surrounding schedule page already shows its own "create a trip"
  // empty state in that case.
  if (!g || !g.days || g.days.length === 0) {
    if (card) card.hidden = true;
    return;
  }

  // Schedule exists — show the card under the day chips.
  if (card) card.hidden = false;
  if (warn) { warn.hidden = true; warn.textContent = ''; }

  // Day has zero places → empty state INSIDE the card (per spec #13).
  const places = getPlacesForDay(activeDay);
  if (!places.length) {
    if (empty) empty.hidden = false;
    clearDayMap();
    updateRouteSummary(activeDay, null);
    try {
      await loadGoogleMapsScript();
      await initializeScheduleMap(activeDay);
    } catch (e) {
      if (warn) { warn.hidden = false; warn.textContent = '지도를 불러올 수 없습니다 (' + (e?.message || 'unknown') + ')'; }
      console.warn('[map] load failed', e);
    }
    return;
  }
  if (empty) empty.hidden = true;

  // Make sure Maps JS is loaded + map instance exists
  try {
    await loadGoogleMapsScript();
    await initializeScheduleMap(activeDay);
  } catch (e) {
    // Loading failed — show inline warning but keep app running.
    if (warn) { warn.hidden = false; warn.textContent = '지도를 불러올 수 없습니다 (' + (e?.message || 'unknown') + ')'; }
    console.warn('[map] load failed', e);
    return;
  }

  // Resolve coordinates (skip places we can't locate).  Track whether
  // any activity's name/coords got updated — if so, ask schedule.js to
  // re-render so the cards immediately reflect the real Places-resolved
  // names.
  const resolved = [];
  const skipped = [];
  let anyUpdated = false;
  for (const p of places) {
    const beforeName = p._ref?.name;
    const beforeLat  = p._ref?.latitude;
    const r = await normalizePlaceCoordinates(p);
    if (r) {
      resolved.push(r);
      const afterName = p._ref?.name;
      const afterLat  = p._ref?.latitude;
      if (beforeName !== afterName || beforeLat !== afterLat) anyUpdated = true;
    } else {
      skipped.push(p.name);
    }
  }
  lastResolved = resolved;
  if (anyUpdated) {
    // Notify schedule.js — it will re-render the timeline cards with the
    // updated real names without re-entering this map render.
    document.dispatchEvent(new CustomEvent('redesign:activities-resolved'));
  }

  if (skipped.length) {
    if (warn) {
      warn.hidden = false;
      warn.textContent = `좌표를 찾지 못한 장소 ${skipped.length}곳은 지도에서 생략됐어요: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`;
    }
  }

  // Draw markers (always — even single-place day)
  drawDayMarkers(map, resolved);

  // 2+ places → request route (with smart fallback across modes)
  if (resolved.length >= 2) {
    const hasWaypoints = resolved.length > 2;
    console.log('[map] requesting route', {
      mode: travelMode,
      hasWaypoints,
      places: resolved.map(p => ({ name: p.name, lat: p.lat, lng: p.lng })),
    });
    // Build fallback order — current mode first, then sensible alternatives.
    // Constraint: Google Routes API does NOT accept intermediate waypoints
    // for TRANSIT mode, so we drop TRANSIT from the queue whenever the day
    // has more than 2 stops.  (TRANSIT can still be picked manually for a
    // 2-stop day; it just gets skipped automatically here.)
    const ALL_MODES = ['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT'];
    const tryOrder = [];
    for (const m of [travelMode, ...ALL_MODES]) {
      if (tryOrder.includes(m)) continue;
      if (m === 'TRANSIT' && hasWaypoints) continue;
      tryOrder.push(m);
    }

    let route = null;
    let usedMode = null;
    let lastErr = null;
    for (const m of tryOrder) {
      try {
        route = await requestRouteFromBackend(resolved, m);
        usedMode = m;
        break;
      } catch (e) {
        lastErr = e;
        // 4XX (no route / mode-not-supported / bad input) → try next mode.
        // 5XX (server/quota issue) → stop the cascade.
        if (e?.status && e.status >= 500) break;
      }
    }
    if (route) {
      const path = decodePolyline(route.encoded_polyline || '');
      drawDayPolyline(map, path);
      fitMapToMarkersAndRoute(map, resolved, path);
      updateRouteSummary(activeDay, route);
      if (usedMode && usedMode !== travelMode && warn) {
        warn.hidden = false;
        const label = ({ DRIVE:'자동차', WALK:'도보', TRANSIT:'대중교통', BICYCLE:'자전거' })[usedMode] || usedMode;
        if (travelMode === 'TRANSIT' && hasWaypoints) {
          warn.textContent = `대중교통은 중간 경유지를 지원하지 않아 ${label} 경로로 표시했어요.`;
        } else {
          warn.textContent = `${travelMode} 모드로는 경로가 없어 ${label} 경로로 표시했어요.`;
        }
      }
    } else {
      // All travel modes failed.  Fall back to a dashed straight line
      // between consecutive markers so the user at least sees the order.
      clearPolyline();
      drawStraightFallback(map, resolved);
      fitMapToMarkersAndRoute(map, resolved, resolved.map(p => ({ lat: p.lat, lng: p.lng })));
      updateRouteSummary(activeDay, { distanceMeters: null, durationSeconds: null, stops: resolved.length });
      if (warn) {
        warn.hidden = false;
        warn.innerHTML = '실제 도로 경로를 못 찾아서 <strong>방문 순서대로 직선</strong>으로 표시했어요. ' +
                         '편집 모드에서 더 구체적인 장소명(예: <strong>도쿄 타워</strong>)으로 바꾸면 실제 경로가 그려집니다.';
      }
      console.warn('[map] route compute failed across all modes', lastErr, 'places=', resolved);
    }
  } else {
    // Single place — center + zoom
    clearPolyline();
    map.setCenter({ lat: resolved[0].lat, lng: resolved[0].lng });
    map.setZoom(14);
    updateRouteSummary(activeDay, { stops: 1 });
  }
}

export function clearDayMap() {
  clearMarkers();
  clearPolyline();
}

/* ============================================================
 *  Google Maps JS API loader — single-shot
 * ============================================================ */
export function loadGoogleMapsScript() {
  if (mapsLoaded) return Promise.resolve(window.google?.maps);
  if (mapsLoadingPromise) return mapsLoadingPromise;

  // Google calls this GLOBAL when the key fails auth (invalid, referrer
  // not allowed, API not enabled, billing missing).  Surface a clear
  // toast + warning so the user knows where to look (GCP Console).
  if (!window.gm_authFailure) {
    window.gm_authFailure = () => {
      const w = $('#scheduleMapWarning');
      if (w) {
        w.hidden = false;
        w.innerHTML = 'Google 지도 인증 실패 — GCP Console 에서 (1) Maps JavaScript API 활성화, '
                    + '(2) Cloud Billing 등록, (3) Browser 키 referrer 에 '
                    + '<code>http://localhost:8080/*</code> 추가 여부를 확인하세요.';
      }
      try { showToast('Google Maps 키 인증 실패'); } catch (_) {}
    };
  }

  const loading = $('#scheduleMapLoading');
  if (loading) loading.hidden = false;

  mapsLoadingPromise = (async () => {
    if (window.google?.maps) { mapsLoaded = true; return window.google.maps; }
    // 1) Fetch the browser-restricted key from backend (referrer-restricted at GCP).
    //    Distinguish three failure modes so users know what to fix:
    //      a) backend not reachable        → "백엔드(:8000)가 꺼져 있어요…"
    //      b) backend ok, key empty        → "GOOGLE_MAPS_BROWSER_KEY 가 비어있어요…"
    //      c) backend ok, fetch raised     → original network error
    let key = '';
    let backendOk = false;
    let lastErr = null;
    try {
      const res = await fetch(API_URL + '/api/config/maps');
      backendOk = res.ok;
      if (res.ok) {
        const cfg = await res.json();
        key = cfg?.browserKey || '';
      }
    } catch (e) {
      lastErr = e;
    }
    if (!backendOk) {
      if (loading) loading.hidden = true;
      const where = API_URL.replace(/^https?:\/\//, '');
      throw new Error(`백엔드(${where}) 에 연결할 수 없어요. backend 폴더의 start-backend.command 를 실행해 주세요.`);
    }
    if (!key) {
      if (loading) loading.hidden = true;
      throw new Error('GOOGLE_MAPS_BROWSER_KEY 가 backend/.env 에 비어 있어요. 키를 넣고 백엔드를 재시작해 주세요.');
    }
    // 2) Inject the loader script exactly once
    if (!scriptInjected) {
      scriptInjected = true;
      await new Promise((resolve, reject) => {
        const cbName = '__gmInitCb_' + Date.now();
        window[cbName] = () => { delete window[cbName]; resolve(); };
        const s = document.createElement('script');
        s.async = true; s.defer = true;
        s.onerror = (e) => { scriptInjected = false; delete window[cbName]; reject(new Error('Maps script load failed')); };
        s.src = 'https://maps.googleapis.com/maps/api/js'
              + '?key=' + encodeURIComponent(key)
              + '&libraries=geometry&v=quarterly&language=ko&region=KR'
              + '&callback=' + cbName;
        document.head.appendChild(s);
      });
    } else {
      // Script tag already in DOM but flag wasn't flipped — wait briefly
      await new Promise(r => setTimeout(r, 200));
    }
    mapsLoaded = true;
    if (loading) loading.hidden = true;
    return window.google.maps;
  })();
  return mapsLoadingPromise;
}

/* ============================================================
 *  Map instance — single, reused across days
 * ============================================================ */
export async function initializeScheduleMap(dayNumber) {
  if (map) return map;
  const canvas = $('#scheduleMapCanvas');
  if (!canvas) throw new Error('#scheduleMapCanvas not found');
  map = new google.maps.Map(canvas, {
    center: { lat: 37.5665, lng: 126.9780 },
    zoom: 11,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });
  return map;
}

/* ============================================================
 *  Data helpers
 * ============================================================ */
export function getPlacesForDay(dayIdx) {
  const g = appState?.generated;
  if (!g || !g.days?.[dayIdx]) return [];
  const acts = g.days[dayIdx].activities || [];
  // Use the same helpers as the schedule card so marker titles match
  return acts.map((a, i) => ({
    id:        a.placeId || a.id || a.fsq_id || `${dayIdx}_${i}`,
    name:      getSchedulePlaceName(a),
    address:   getScheduleAddress(a),
    lat:       (a.latitude != null ? Number(a.latitude) : (a.lat != null ? Number(a.lat) : null)),
    lng:       (a.longitude != null ? Number(a.longitude) : (a.lng != null ? Number(a.lng) : null)),
    order:     Number(a.place_order || i + 1),
    dayNumber: dayIdx + 1,
    _ref:      a,            // backref so we can stamp resolved coords back
    googleMapsQuery: a.googleMapsQuery,
  }));
}

/** Detects "mock template" names so we can force a re-resolution.
 *  Examples: "호텔 조식 · 도쿄", "Place name not available", or a name
 *  that's literally a category-style word + the city name. */
function _isMockName(name, city) {
  if (!name || typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed === 'Place name not available') return true;
  if (trimmed === '장소명 없음') return true;
  if (city && trimmed.endsWith(' · ' + city)) return true;   // "호텔 조식 · 도쿄"
  if (city && trimmed.endsWith(' ' + city)) return true;     // "호텔 조식 도쿄"
  return false;
}

/** Resolve and cache the destination city's centre so we can pass it as
 *  Places API locationBias.  This stops "Tokyo restaurant" searches from
 *  returning Seoul results.  Cached on appState.generated.cityCenter. */
async function _ensureCityCenter() {
  const g = appState?.generated;
  if (!g) return null;
  if (g.cityCenter && Number.isFinite(g.cityCenter.lat) && Number.isFinite(g.cityCenter.lng)) {
    return g.cityCenter;
  }
  if (!g.city) return null;
  try {
    const res = await api.searchPlaces({
      query: g.city,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(g.country),
      max_results: 1,
    });
    const c = res?.places?.[0];
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      g.cityCenter = { lat: c.latitude, lng: c.longitude };
      return g.cityCenter;
    }
  } catch (e) {
    console.warn('[map] city centre resolve failed:', e?.message);
  }
  return null;
}

/** Returns the place with valid lat/lng and the *real* place name.
 *  Resolves via /api/places/search when:
 *    (a) coords are missing, OR
 *    (b) the current name looks like a mock template ("호텔 조식 · 도쿄")
 *  In both cases, the activity's `name`, `latitude`, `longitude`,
 *  `address`, `placeId` are overwritten with what Places API returns.
 *  That's how the schedule card can show real names like "도쿄 타워".
 */
export async function normalizePlaceCoordinates(p) {
  const g = appState?.generated;
  const city = g?.city || '';
  const looksMock = _isMockName(p.name, city);
  const hasCoords = Number.isFinite(p.lat) && Number.isFinite(p.lng);

  // Valid coords AND name doesn't look mock → nothing to do.
  if (hasCoords && !looksMock) return p;

  // Cache lookup — key by city + current (possibly mock) name.
  // Only honour the cache if it has a *real* name on it; otherwise
  // invalidate the entry and fall through to a fresh Places call.
  const key = `${city}|${p.name}`;
  if (placesCache.has(key)) {
    const c = placesCache.get(key);
    if (c.name && !_isMockName(c.name, city)) {
      if (p._ref) {
        p._ref.name      = c.name;
        p._ref.latitude  = c.lat;
        p._ref.longitude = c.lng;
        p._ref.placeId   = c.place_id;
        p._ref.address   = c.address;
      }
      return {
        ...p,
        name: c.name,
        lat: c.lat, lng: c.lng,
        place_id: c.place_id,
        address: c.address || p.address,
      };
    }
    // Stale / mock-named cache entry — drop it and re-resolve below.
    placesCache.delete(key);
    _persistCache();
  }

  // Build a search query that drops the " · 도쿄" suffix if present —
  // we want Places to search for the category-word + city, not the exact
  // mock template.
  let query = (p.googleMapsQuery || p.name || p.address || '').trim();
  if (looksMock && city) {
    query = query.replace(new RegExp(' · ' + city + '$'), '');
    query = query.replace(new RegExp(' ' + city + '$'), '');
    query = `${city} ${query}`.trim();    // bias the query toward the city
  }
  if (!query) return null;

  const cityCenter = await _ensureCityCenter();
  console.log('[map] re-resolving', p.name, '→ query:', query, 'centre:', cityCenter);

  try {
    const res = await api.searchPlaces({
      query,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(g?.country),
      max_results: 1,
      center_lat: cityCenter?.lat,
      center_lng: cityCenter?.lng,
    });
    const first = res?.places?.[0];
    console.log('[map]   → Places returned:', first?.name, `(${first?.latitude},${first?.longitude})`);
    if (!first) return hasCoords ? p : null;
    const out = {
      ...p,
      name:     first.name || p.name,           // ← REAL name
      lat:      first.latitude,
      lng:      first.longitude,
      place_id: first.place_id,
      address:  first.address || p.address,
    };
    placesCache.set(key, {
      name: out.name,
      lat: out.lat, lng: out.lng,
      place_id: out.place_id, address: out.address,
    });
    _persistCache();
    if (p._ref) {
      p._ref.name      = out.name;              // ← STAMP REAL NAME BACK
      p._ref.latitude  = out.lat;
      p._ref.longitude = out.lng;
      p._ref.placeId   = out.place_id;
      p._ref.address   = out.address;
    }
    return out;
  } catch (e) {
    console.warn('[map] place resolve failed:', p.name, e?.message || e);
    return hasCoords ? p : null;
  }
}

/* ============================================================
 *  Route request — backend proxy
 * ============================================================ */
export async function requestRouteFromBackend(places, mode) {
  const origin = { lat: places[0].lat, lng: places[0].lng };
  const destination = { lat: places[places.length - 1].lat, lng: places[places.length - 1].lng };
  const waypoints = places.slice(1, -1).map(w => ({ lat: w.lat, lng: w.lng }));
  return await api.computeRoute({
    origin, destination, waypoints,
    travel_mode: mode || 'DRIVE',
    language: 'ko',
    region: _guessRegion(appState?.generated?.country),
  });
}

/* ============================================================
 *  Drawing
 * ============================================================ */
export function drawDayMarkers(mapInst, places) {
  clearMarkers();
  if (!places?.length) return;
  places.forEach((p, i) => {
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: mapInst,
      label: { text: String(i + 1), color: '#ffffff', fontWeight: '900' },
      title: p.name,
    });
    markers.push(m);
  });
}

export function drawDayPolyline(mapInst, decodedPath) {
  clearPolyline();
  if (!decodedPath?.length) return;
  polyline = new google.maps.Polyline({
    path: decodedPath,
    strokeColor: '#FF8E5C',
    strokeOpacity: 0.95,
    strokeWeight: 5,
    map: mapInst,
  });
}

/** Last-resort: a dashed straight line that just connects markers in
 *  visit order.  Used only when Routes API returns no route for every
 *  travel mode (impossible-to-route coords).  Gives the user some
 *  visual continuity instead of a totally bare map. */
export function drawStraightFallback(mapInst, places) {
  clearPolyline();
  if (!places || places.length < 2) return;
  polyline = new google.maps.Polyline({
    path: places.map(p => ({ lat: p.lat, lng: p.lng })),
    strokeColor: '#A78BFA',
    strokeOpacity: 0,                                  // outline invisible
    strokeWeight: 2,
    map: mapInst,
    icons: [{                                          // dotted line via icon repeat
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
      offset: '0',
      repeat: '12px',
    }],
  });
}

export function fitMapToMarkersAndRoute(mapInst, places, decodedPath) {
  const bounds = new google.maps.LatLngBounds();
  let any = false;
  (decodedPath || []).forEach(p => { bounds.extend(p); any = true; });
  (places || []).forEach(p => { bounds.extend({ lat: p.lat, lng: p.lng }); any = true; });
  if (any) mapInst.fitBounds(bounds, 56);
}

/** Standard Google encoded polyline decoder. */
export function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1); lat += dlat;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1); lng += dlng;
    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }
  return points;
}

/* ============================================================
 *  Cleanup
 * ============================================================ */
function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
}
function clearPolyline() {
  if (polyline) { polyline.setMap(null); polyline = null; }
}

/* ============================================================
 *  Route summary HUD
 * ============================================================ */
export function updateRouteSummary(dayIdx, route) {
  const distEl = $('#riDistance');
  const durEl  = $('#riDuration');
  const stopsEl = $('#riStops');
  if (!route) {
    if (distEl)  distEl.textContent  = '-';
    if (durEl)   durEl.textContent   = '-';
    if (stopsEl) stopsEl.textContent = (lastResolved.length || '-') + (lastResolved.length ? '곳' : '');
    return;
  }
  if (route.distance_meters != null) {
    distEl.textContent = (route.distance_meters >= 1000)
      ? (route.distance_meters / 1000).toFixed(1) + ' km'
      : route.distance_meters + ' m';
  } else if (distEl) distEl.textContent = '-';
  if (route.duration_seconds != null) {
    durEl.textContent = _fmtDuration(route.duration_seconds);
  } else if (durEl) durEl.textContent = '-';
  if (stopsEl) stopsEl.textContent = (route.stops != null ? route.stops : lastResolved.length) + '곳';
}

/* ============================================================
 *  External Google Maps deep link
 * ============================================================ */
export function openDayRouteInGoogleMaps() {
  if (!lastResolved.length) { showToast('표시할 장소가 없어요'); return; }
  const o = lastResolved[0];
  const d = lastResolved[lastResolved.length - 1];
  const mode = ({ DRIVE: 'driving', WALK: 'walking', TRANSIT: 'transit', BICYCLE: 'bicycling' })[travelMode] || 'driving';
  const params = new URLSearchParams({
    api: '1',
    origin: `${o.lat},${o.lng}`,
    destination: `${d.lat},${d.lng}`,
    travelmode: mode,
  });
  if (lastResolved.length > 2) {
    const wp = lastResolved.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
    params.set('waypoints', wp);
  }
  window.open('https://www.google.com/maps/dir/?' + params.toString(), '_blank', 'noopener,noreferrer');
}

/* ============================================================
 *  Helpers
 * ============================================================ */
function _persistCache() {
  try { localStorage.setItem(PLACES_CACHE_KEY, JSON.stringify(Object.fromEntries(placesCache))); } catch (_) {}
}
function _fmtDuration(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.round((s - h * 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
function _guessRegion(country) {
  return ({
    '대한민국': 'KR', '일본': 'JP', '프랑스': 'FR', '미국': 'US', '태국': 'TH',
    '호주': 'AU', '이탈리아': 'IT', '베트남': 'VN', '중국': 'CN', '영국': 'GB',
    '독일': 'DE', '스페인': 'ES', '포르투갈': 'PT', '대만': 'TW', '홍콩': 'HK',
    '싱가포르': 'SG', '인도네시아': 'ID', '필리핀': 'PH', '캐나다': 'CA',
  })[country] || null;
}
