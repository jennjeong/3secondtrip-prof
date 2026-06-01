/* 3초 여행 — Redesign UI helpers
 * Toast notifications, language switcher, small DOM utilities.
 */

const LANGS = [
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'ja', flag: '🇯🇵', label: '日本語' },
  { code: 'zh', flag: '🇨🇳', label: '中文' },
];
const LANG_KEY = 'tst_lang_v1';

let toastTimer = null;

export function showToast(message, ms = 1800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = message;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node) { try { node[k] = v; } catch (_) { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function formatCurrency(value, currency = 'KRW') {
  const n = Number(value) || 0;
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); }
  catch (_) { return n.toLocaleString('ko-KR') + '원'; }
}

export function diffDays(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO); const e = new Date(endISO);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

/** Minimal i18n table.  Add more strings here as the app grows. */
export const I18N = {
  ko: {
    departureCityLabel: '출발 도시',
    departureCityPlaceholder: '예: 서울, 부산, 인천',
    departureCityRequired: '출발 도시를 입력해주세요.',
    placeNameMissing: '장소명 없음',
  },
  en: {
    departureCityLabel: 'Departure City',
    departureCityPlaceholder: 'e.g. Seoul, Busan, Incheon',
    departureCityRequired: 'Please enter your departure city.',
    placeNameMissing: 'Place name unavailable',
  },
  ja: {
    departureCityLabel: '出発都市',
    departureCityPlaceholder: '例: ソウル、釜山、仁川',
    departureCityRequired: '出発都市を入力してください。',
    placeNameMissing: '場所名なし',
  },
  zh: {
    departureCityLabel: '出发城市',
    departureCityPlaceholder: '例如：首尔、釜山、仁川',
    departureCityRequired: '请输入出发城市。',
    placeNameMissing: '无名称',
  },
};

/** Translate a key into the current language; falls back to Korean. */
export function t(key) {
  const code = (document.documentElement.lang || 'ko');
  const bundle = I18N[code] || I18N.ko;
  return bundle[key] ?? I18N.ko[key] ?? key;
}

/** Apply current language: <html lang> + any [data-i18n] / [data-i18n-placeholder] nodes. */
export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
}

/** Apply persisted language to <html lang>.  The picker lives in Settings. */
export function initLanguage() {
  let code = null;
  try { code = localStorage.getItem(LANG_KEY); } catch (_) {}
  const current = LANGS.find(l => l.code === code) || LANGS[0];
  document.documentElement.lang = current.code;
  applyI18n();
  // Re-apply whenever the user changes language via Settings
  document.addEventListener('redesign:lang', applyI18n);
}

/* ============================================================
 *  Schedule-item field extraction helpers
 *
 *  Different data sources use different field names (mock data, our
 *  /api/places/search response, Google Places (New) API responses,
 *  legacy frontend payloads, OAuth user profile snippets, etc.).  These
 *  helpers normalise that into one shape so every render site agrees
 *  on what to display.
 * ============================================================ */

/** Safely extract a printable string from any value.
 *  Skips undefined / null / NaN / empty / "[object Object]" / numbers
 *  that aren't finite.  Handles Google Places "displayName" objects
 *  which look like { text: "Tokyo Tower", languageCode: "en" }.
 */
function _stringy(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text.trim();         // Google Places displayName
    if (typeof v.value === 'string') return v.value.trim();
    if (v.displayName && typeof v.displayName.text === 'string') return v.displayName.text.trim();
  }
  return '';
}

/** Extract the best place name for a schedule item.
 *  Tries an exhaustive list of common field names and a few nested
 *  shapes (Google Places result, generic location wrapper).  Falls back
 *  to "Place name not available" so the UI never renders empty / null /
 *  undefined / "[object Object]".
 */
export function getSchedulePlaceName(item) {
  if (!item || typeof item !== 'object') return 'Place name not available';
  const candidates = [
    item.place_name, item.placeName,
    item.name, item.title,
    item.location_name, item.locationName,
    item.displayName, item.google_place_name, item.googlePlaceName,
    item.venue_name, item.venueName,
    item.restaurant_name, item.restaurantName,
    item.hotel_name, item.hotelName,
    item.attraction_name, item.attractionName,
    item.activity_name, item.activityName,
    // Nested shapes
    item.place?.name,
    item.place?.displayName?.text,
    item.place?.displayName,
    item.location?.name,
    item.googlePlace?.displayName?.text,
    item.googlePlace?.displayName,
  ];
  for (const c of candidates) {
    const s = _stringy(c);
    if (s) return s;
  }
  return 'Place name not available';
}

/** Extract the category/type label (or empty string). */
export function getScheduleCategory(item) {
  if (!item || typeof item !== 'object') return '';
  return _stringy(item.category) || _stringy(item.type) ||
         _stringy(item.place_type) || _stringy(item.placeType) ||
         _stringy(item.kind) || '';
}

/** Extract a formatted address (or empty string). */
export function getScheduleAddress(item) {
  if (!item || typeof item !== 'object') return '';
  const candidates = [
    item.address,
    item.formattedAddress, item.formatted_address,
    item.place?.formattedAddress, item.place?.address,
    item.location?.address, item.location?.formattedAddress,
    item.googlePlace?.formattedAddress,
  ];
  for (const c of candidates) {
    const s = _stringy(c);
    if (s) return s;
  }
  return '';
}

/** Extract a time / time-range label, or empty if absent. */
export function getScheduleTime(item) {
  if (!item || typeof item !== 'object') return '';
  return _stringy(item.time) || _stringy(item.time_range) || _stringy(item.timeRange) ||
         _stringy(item.startTime) || _stringy(item.start_time) || '';
}

/** Convert any schedule-item-like input into a uniform shape. */
export function normalizeScheduleItem(item, idx = 0) {
  const lat = Number(item?.latitude ?? item?.lat ?? item?.location?.latitude);
  const lng = Number(item?.longitude ?? item?.lng ?? item?.location?.longitude);
  const orderRaw = item?.order ?? item?.place_order ?? item?.sequence;
  const order = Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : (idx + 1);
  const costRaw = item?.cost ?? item?.estimated_cost ?? item?.estimatedCost;
  const cost = Number.isFinite(Number(costRaw)) ? Number(costRaw) : null;
  return {
    id:        item?.id ?? item?.placeId ?? item?.place_id ?? `idx-${idx}`,
    order,
    time:      getScheduleTime(item),
    category:  getScheduleCategory(item),
    placeName: getSchedulePlaceName(item),
    address:   getScheduleAddress(item),
    memo:      _stringy(item?.memo) || _stringy(item?.note) || _stringy(item?.description),
    cost,
    lat:       Number.isFinite(lat) ? lat : null,
    lng:       Number.isFinite(lng) ? lng : null,
    placeId:   item?.placeId ?? item?.place_id ?? item?.google_place_id ?? null,
    _raw:      item,
  };
}

export function setActiveByData(container, attr, value, classes = 'is-active') {
  if (!container) return;
  container.querySelectorAll(`[${attr}]`).forEach(b => b.classList.toggle(classes, b.getAttribute(attr) === value));
}

export function setMultiActive(container, attr, values, classes = 'is-active') {
  if (!container) return;
  container.querySelectorAll(`[${attr}]`).forEach(b => b.classList.toggle(classes, values.includes(b.getAttribute(attr))));
}
