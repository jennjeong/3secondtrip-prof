/* 3초 여행 — Redesign Trip Creation Flow (v2)
 * 4-step survey with:
 *   - Global city autocomplete (CITIES dataset)
 *   - Custom bottom-sheet calendar (past dates blocked)
 *   - Direct budget input with auto level + smart suggestion (city×days×season×companion)
 */

import { navigate } from './redesign-navigation.js';
import { el, $, $$, setActiveByData, setMultiActive, diffDays, showToast, formatCurrency, escapeHtml } from './redesign-ui.js';
import { createSearchIndex, prepareQuery, matchKey, prepare, normalize, sameText, RANK } from './redesign-search.js';
import { CITIES, listCountries, citiesIn, searchCities, findCity, timeZoneFor, utcOffsetMin } from './redesign-cities.js';
import { openCalendar } from './redesign-calendar.js';
import { api, trackEvent, ensureAwake } from './redesign-api-adapter.js';
import { PLACE_MODES, modeOf, langOf, LANG_NAME, localQuery, rankLocal, localScore, famousIndex, shownCategory } from './redesign-local.js';
import { mustPlaceholder } from './redesign-landmarks.js';
import { checkTrip, repairTrip, timeToMin, minToTime, travelMinutes, dwellMinutes, landingMinutes, beforeFlight, STATION_MIN, josa } from './redesign-plan-check.js';
import { groundRoute, RIDE, rideOf } from './redesign-ground.js';
import { COMPONENTS, costBreakdown, costScope, scopeText, projectCost, compareCost, diffReasons } from './redesign-plan-cost.js';
import { openState, stayState } from './redesign-hours.js';

const CONCEPTS = [
  { key: '가성비',   emoji: '💰', desc: '합리적인 가격으로 알차게' },
  { key: '균형',     emoji: '⚖️', desc: '관광·음식·휴식을 골고루' },
  { key: '프리미엄', emoji: '✨', desc: '럭셔리·편안함 중심' },
  { key: '효율',     emoji: '🚀', desc: '짧은 시간에 핵심만' },
  { key: '힐링',     emoji: '🌿', desc: '여유롭고 편안한 일정' },
  { key: '액티비티', emoji: '⚡', desc: '액티브·경험 중심' },
];

const STYLES = ['맛집 중심','쇼핑 중심','자연 중심','사진 명소','여유로운 일정','빽빽한 일정'];
// 예전에 고르던 스타일 — 지금은 ‘어떤 곳 위주로’(placeMode)로 바뀌었다.
const OLD_STYLES = { '로컬 감성': 'local', '유명 관광지': 'famous' };
function _modernStyles(t) {
  (t.styles || []).forEach(x => { if (OLD_STYLES[x] && !t.placeMode) t.placeMode = OLD_STYLES[x]; });
  t.styles = (t.styles || []).filter(x => !OLD_STYLES[x]);
}
const STYLE_CONFLICT = { '여유로운 일정': '빽빽한 일정', '빽빽한 일정': '여유로운 일정' };

const QUICK_DEST = [
  { name: '도쿄',   emoji: '🗼' },
  { name: '파리',   emoji: '🗼' },
  { name: '제주',   emoji: '🏝️' },
  { name: '오사카', emoji: '🏯' },
  { name: '방콕',   emoji: '🛕' },
  { name: '서울',   emoji: '🏙️' },
];

let appState = null;
let step = 1;

export function initTripFlow(state) {
  appState = state;
  // Add origin field to state if not present (departure city)
  if (appState.trip && appState.trip.origin == null) appState.trip.origin = '';
  if (appState.trip && appState.trip.originName == null) appState.trip.originName = '';
  // 항공·호텔 옵션 기본값
  const t = appState.trip;
  if (!t.flight)  t.flight  = { route: 'any', classType: 'any', airlines: [] };
  if (!t.hotelP)  t.hotelP  = { types: [], locations: [], amenities: [] };

  _buildCountries();
  _buildConcepts();
  _buildStyles();
  _initCheckAdds();
  _initQuickDates();
  _initNeeds();
  _buildQuickDest();
  _bindPlaceSearch('origin');
  _bindPlaceSearch('dest');
  _bindAdvancedSelect();
  _bindStepHandlers();
  _bindFormHandlers();
  _bindDateTriggers();
  _bindBudgetHandlers();
  // 폼 안에서 무엇이든 바꾸면 임시 저장
  const page = document.getElementById('createTripPage');
  ['change', 'click'].forEach(ev => page?.addEventListener(ev, () => setTimeout(_saveDraft, 0)));
  // 휴대폰에서 글자를 입력하는 동안에는 아래 메뉴를 숨겨 키보드·버튼과 겹치지 않게 한다.
  const typing = (on) => document.body.classList.toggle('is-typing', on);
  page?.addEventListener('focusin', (e) => {
    if (e.target.matches('input:not([type=checkbox]):not([type=radio]), textarea') && matchMedia('(pointer: coarse)').matches) typing(true);
  });
  page?.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches?.('input:not([type=checkbox]):not([type=radio]), textarea')) typing(false);
  }, 60));

  // 코스 상세의 '이 코스로 여행 만들기' — 도시·기간·스타일을 채우고 나머지는 사용자가 고른다.
  // 홈의 '이어 하던 여행' 카드
  document.addEventListener('redesign:nav', (e) => { if (e.detail?.page === 'home') _paintHomeTrip(); });
  ['redesign:auth-ready', 'redesign:schedule-changed', 'redesign:trip-changed'].forEach(ev => document.addEventListener(ev, _paintHomeTrip));
  setTimeout(_paintHomeTrip, 0);

  document.addEventListener('redesign:trip-prefill', (e) => {
    const d = e.detail || {};
    _resetTripState();
    const t = appState.trip;
    const c = d.city ? findCity(x => x.name === d.city) : null;
    if (c) { t.cityName = c.name; t.city = c.key; t.country = c.country; t.cityTier = c.tier; t.cityFlag = c.flag; }
    else if (d.city) t._cityText = d.city;
    if (CONCEPTS.some(x => x.key === d.concept)) t.concept = d.concept;
    const n = Math.max(1, Math.min(MAX_TRIP_DAYS, Number(d.days) || 0));
    if (d.days) {
      // 날짜는 코스 기간에 맞춰 2주 뒤로 임시로 넣고, 2단계에서 바꿀 수 있게 알려 준다.
      const s0 = new Date(); s0.setDate(s0.getDate() + 14);
      const e0 = new Date(s0); e0.setDate(e0.getDate() + n - 1);
      t.startDate = _isoLocal(s0); t.endDate = _isoLocal(e0);
    }
    t._draft = true;
    step = 1; _showStep(); _applyState();
    _showDraftBanner(false);
    _showPrefillBanner(d.title);
    _saveDraft();
  });

  document.addEventListener('redesign:nav', (e) => {
    if (e.detail.page === 'create-trip') _enterCreateTrip(e.detail.meta);
  });
  // 주소로 바로 들어오거나 새로고침한 경우 — 첫 이동 알림이 이 모듈보다 먼저 지나가므로 직접 시작한다.
  if (/page=create-trip/.test(location.hash)) _enterCreateTrip({});
}

/** 여행 만들기 진입. 작성 중이던 여행이 있으면 이어서, 없으면 새로 시작한다.
 *  meta.prefill — 코스 상세 등에서 미리 채워 둔 값 보존 / meta.fresh — 무조건 새로 시작 */
function _enterCreateTrip(meta = {}) {
  const t = appState.trip;
  if (!meta.prefill) document.getElementById('prefillBanner')?.remove();
  const resume = !meta.prefill && !meta.fresh && !!t._draft;
  if (!meta.prefill && !resume) _resetTripState();
  if (!t.concept) t.concept = '균형';   // 예전 초안에도 기본 스타일을 채운다
  step = resume ? Math.min(4, Math.max(1, t._draftStep || 1)) : 1;
  _showStep(); _applyState();
  _showDraftBanner(resume);
  _showDeviceTrip();
  if (meta.focusCity) requestAnimationFrame(() => $('#tripCitySearch')?.focus());
}

/** 이 기기에 만들어 둔 일정 — 게스트는 '내 일정' 메뉴가 없으므로 만들기에서 다시 연다. 저장 상태를 함께 보여 준다. */
/** 홈 — 이 기기에서 보던 일정이나 만들던 여행을 바로 이어서 연다. */
function _paintHomeTrip() {
  const box = document.getElementById('homeTripCard');
  if (!box) return;
  const g = appState.generated, t = appState.trip || {};
  let title = '', state = '', go = null, label = '';
  if (g?.days?.length) {
    const city = g.city || g.trip?.cityName || '만든 일정';
    title = `${city} · ${g.days.length > 1 ? `${g.days.length - 1}박 ${g.days.length}일` : '당일치기'}`;
    state = g.savedScheduleId && appState.currentUser ? '계정에 저장됨' : '이 기기에만 보관';
    label = '일정 열기'; go = () => navigate('schedule');
  } else if (t._draft && (t.cityName || t._cityText)) {
    title = `${t.cityName || t._cityText} 여행`;
    state = '만들던 중 · 이어서 만들기';
    label = '이어서 만들기'; go = () => navigate('create-trip');
  }
  box.hidden = !go;
  box.replaceChildren(...(go ? [el('button', { type: 'button', class: 'home-trip', onclick: go, 'aria-label': `${title} ${label}` }, [
    el('span', { class: 'ht-text' }, [el('b', {}, title), el('span', { class: 'ht-state' }, state)]),
    el('span', { class: 'ht-go', 'aria-hidden': 'true' }, '›'),
  ])] : []));
}

function _showDeviceTrip() {
  document.getElementById('deviceTripCard')?.remove();
  const g = appState.generated;
  if (!g?.days?.length) return;
  const t = g.trip || appState.trip || {};
  const where = [t.originName || t.origin || '', t.cityName || t.city || g.city || ''].filter(Boolean).join(' → ') || '만든 일정';
  const days = g.days.length > 1 ? `${g.days.length - 1}박 ${g.days.length}일` : '당일치기';
  const saved = !!g.savedScheduleId && !!appState.currentUser;
  const card = el('div', { id: 'deviceTripCard', class: 'draft-banner device-trip', role: 'group', 'aria-label': '이 기기의 일정' }, [
    el('span', { class: 'dt-text' }, [
      el('b', {}, `${where} · ${days}`),
      el('span', { class: 'dt-state' }, saved ? '계정에 저장됨' : '이 기기에만 보관'),
    ]),
    el('button', { type: 'button', class: 'btn-text', onclick: () => navigate('schedule') }, '열기'),
  ]);
  $('#tripStepProgress')?.before(card);
}

/* ============ Builders ============ */
function _buildCountries() {
  const sel = $('#tripCountry');
  if (!sel) return;
  sel.innerHTML = '<option value="">국가 선택</option>';
  listCountries().forEach(c => {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = `${c.flag} ${c.name}`;
    sel.appendChild(o);
  });
}
function _buildCities(country) {
  const sel = $('#tripCity');
  if (!sel) return;
  sel.innerHTML = '<option value="">도시 선택</option>';
  citiesIn(country).forEach(c => {
    const o = document.createElement('option');
    o.value = c.key; o.textContent = `${c.flag} ${c.name}`;
    sel.appendChild(o);
  });
}
function _buildQuickDest() {
  const wrap = $('#destQuick');
  if (!wrap) return;
  wrap.innerHTML = '';
  QUICK_DEST.forEach(d => {
    wrap.appendChild(el('button', {
      type: 'button',
      dataset: { destQuick: d.name },
      ariaLabel: `도착 도시로 ${d.name} 선택`,
      onclick: () => _applyCity(findCity(c => c.name === d.name), null, { from: 'quick' }),
    }, d.name));
  });
}
function _buildConcepts() {
  const grid = $('#conceptGrid');
  if (!grid) return;
  grid.innerHTML = '';
  CONCEPTS.forEach(c => {
    grid.appendChild(el('button', {
      type: 'button',
      class: 'concept-card',
      dataset: { conceptKey: c.key },
      onclick: () => {
        appState.trip.concept = c.key;
        appState.trip._prefApplied = false; const ph = $('#prefHint'); if (ph) ph.hidden = true;
        setActiveByData(grid, 'data-concept-key', c.key);
        const err = $('#conceptError'); if (err) err.hidden = true;
        _refreshBudget(); // concept doesn't change suggestion but keeps UI fresh
      }
    }, [
      el('span', { class: 'cc-emoji' }, c.emoji),
      el('div', { class: 'cc-title' }, c.key),
      el('div', { class: 'cc-desc' }, c.desc),
    ]));
  });
}
/* ============ 빠른 날짜 · 이동·식사 조건 · 꼭 갈 장소 ============ */
function _setDates(start, end, label) {
  const t = appState.trip;
  t.startDate = _isoLocal(start); t.endDate = _isoLocal(end);
  t.days = Math.round((end - start) / 86400000) + 1;
  _refreshDateTriggers(); _refreshDuration(); _saveDraft();
  const e = $('#dateError'); if (e) e.hidden = true;
  showToast(`${label}로 골랐어요 · 달력에서 바꿀 수 있어요`);
}
function _initQuickDates() {
  $('#quickDates')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-quick]');
    if (!b) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dow = today.getDay();                       // 0=일 ... 6=토
    const sat = new Date(today); sat.setDate(today.getDate() + ((6 - dow + 7) % 7));
    if (dow === 0) sat.setDate(today.getDate() + 6);   // 일요일이면 다음 토요일
    if (b.dataset.quick === 'weekend') { const sun = new Date(sat); sun.setDate(sat.getDate() + 1); _setDates(sat, sun, '이번 주말(1박 2일)'); }
    if (b.dataset.quick === 'nextweekend') { const s2 = new Date(sat); s2.setDate(sat.getDate() + 7); const e2 = new Date(s2); e2.setDate(s2.getDate() + 1); _setDates(s2, e2, '다음 주말(1박 2일)'); }
    if (b.dataset.quick === 'nextmonth') {
      const first = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const fri = new Date(first); fri.setDate(1 + ((5 - first.getDay() + 7) % 7));
      const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
      _setDates(fri, sun, '다음 달 첫 금~일(2박 3일)');
    }
  });
}
/** 어떤 곳 위주로 — 동네 위주 · 반반 · 유명한 곳 위주 */
function _syncPlaceMode() {
  const m = modeOf(appState?.trip);
  $$('#placeMode [data-place-mode]').forEach(b => { const on = b.dataset.placeMode === m; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  const h = $('#placeModeHint'); if (h) h.textContent = PLACE_MODES.find(x => x[0] === m)?.[2] || '';
}
function _initNeeds() {
  $('#placeMode')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-place-mode]');
    if (!b) return;
    appState.trip.placeMode = b.dataset.placeMode; _syncPlaceMode(); _saveDraft();
  });
  ['#needsMove', '#needsDiet'].forEach(sel => $(sel)?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-need]');
    if (!b) return;
    const t = appState.trip;
    t.needs = Array.isArray(t.needs) ? t.needs : [];
    const k = b.dataset.need;
    const i = t.needs.indexOf(k);
    if (i >= 0) t.needs.splice(i, 1); else t.needs.push(k);
    const on = t.needs.includes(k);
    b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
    _saveDraft();
  }));
  $('#mustVisit')?.addEventListener('input', (e) => {
    const t = appState.trip;
    t.mustVisit = e.target.value;
    // 목록에서 빠진 이름의 확인 결과는 버린다
    if (t.mustResolved) { const keep = new Set(_mustList(t)); Object.keys(t.mustResolved).forEach(k => { if (!keep.has(k)) delete t.mustResolved[k]; }); }
    const box = $('#mustList'); if (box && box.childElementCount) box.textContent = '';
    _saveDraft();
  });
  $('#mustResolve')?.addEventListener('click', () => { _resolveMust().finally(() => { const b = $('#mustResolve'); if (b) b.disabled = false; }); });
}
/** 꼭 갈 장소를 실제 장소로 찾아 고르게 한다 — 이름마다 후보 3개 + '이름만 넣기'. */
async function _resolveMust() {
  const t = appState.trip;
  const box = $('#mustList');
  const names = _mustList(t);
  if (!box) return;
  box.textContent = '';
  if (!names.length) { box.textContent = '먼저 장소 이름을 적어 주세요.'; return; }
  if (!t.cityName) { box.textContent = '1단계에서 여행지를 먼저 골라 주세요.'; return; }
  let feats = null;
  try { feats = await api.features(); } catch (_) { feats = null; }
  if (feats && feats.places === false) { box.textContent = '지금은 장소 검색을 쓸 수 없어요. 이름만 넣어 일정을 만들어요.'; return; }
  const btn = $('#mustResolve'); if (btn) btn.disabled = true;
  box.textContent = '찾는 중…';
  t.mustResolved = t.mustResolved && typeof t.mustResolved === 'object' ? t.mustResolved : {};
  const rows = [];
  for (const name of names) {
    let cands = [];
    try {
      const res = await api.searchPlaces({ query: `${t.cityName} ${name}`, language_code: 'ko', language: 'ko', region: _guessRegion(t.country), max_results: 3 });
      cands = (res?.places || []).filter(p => Number.isFinite(p.latitude)).slice(0, 3);
    } catch (_) { cands = []; }
    rows.push({ name, cands });
  }
  box.textContent = '';
  let found = 0;
  rows.forEach(({ name, cands }, i) => {
    const id = `mustSel${i}`;
    const prev = t.mustResolved[name]?.place_id;
    if (!cands.length) {
      delete t.mustResolved[name];
      box.appendChild(el('p', { class: 'must-row is-miss' }, `‘${name}’ — 찾지 못했어요. 이름만 넣을게요.`));
      return;
    }
    found++;
    const sel = el('select', { id, class: 'form-input' }, [
      ...cands.map(c => el('option', { value: c.place_id }, `${c.name}${c.address ? ' · ' + c.address.slice(0, 40) : ''}`)),
      el('option', { value: '' }, '이름만 넣기'),
    ]);
    sel.value = cands.some(c => c.place_id === prev) ? prev : cands[0].place_id;
    const apply = () => {
      const c = cands.find(x => x.place_id === sel.value);
      if (c) t.mustResolved[name] = { name: c.name, place_id: c.place_id, latitude: c.latitude, longitude: c.longitude, address: c.address || '', opening_periods: c.opening_periods || null, step_free: c.step_free ?? null };
      else delete t.mustResolved[name];
      _saveDraft();
    };
    sel.addEventListener('change', apply);
    apply();
    box.appendChild(el('div', { class: 'must-row' }, [el('label', { for: id }, `‘${name}’`), sel]));
  });
  trackEvent('must_visit_resolved');
  if (btn) btn.disabled = false;
  if (!found) showToast('찾은 장소가 없어요. 이름만 넣어 일정을 만들어요');
}

function _mustList(t) {
  return [...new Set(String(t.mustVisit || '').split(/[,，\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 5);
}

/** 체크 목록 항목 상태(세부 스타일·이동·식사 조건 공통) */
function _syncChecks(wrap, attr, values) {
  wrap?.querySelectorAll('[' + attr + ']').forEach(b => {
    const on = values.includes(b.getAttribute(attr));
    b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on));
  });
}
function _buildStyles() {
  const wrap = $('#styleChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  const custom = (appState?.trip?.styles || []).filter(s => !STYLES.includes(s));
  [...STYLES, ...custom].forEach(s => {
    wrap.appendChild(el('button', {
      type: 'button',
      class: 'check-opt' + (STYLES.includes(s) ? '' : ' is-custom'),
      'aria-pressed': 'false',
      dataset: { styleKey: s },
      onclick: (e) => {
        const k = e.currentTarget.dataset.styleKey;
        const arr = appState.trip.styles;
        const idx = arr.indexOf(k);
        const hint = $('#styleHint');
        if (idx >= 0) arr.splice(idx, 1);
        else {
          arr.push(k);
          // 서로 반대인 항목은 하나만 — 새로 고른 쪽을 남긴다.
          const other = STYLE_CONFLICT[k];
          const oi = other ? arr.indexOf(other) : -1;
          if (oi >= 0) {
            arr.splice(oi, 1);
            if (hint) hint.textContent = `‘${k}’와 ‘${other}’는 함께 고를 수 없어서 ‘${other}’ 선택을 풀었어요.`;
          }
        }
        _syncChecks(wrap, 'data-style-key', arr);
        _saveDraft();
      }
    }, s));
  });
  _syncChecks(wrap, 'data-style-key', appState?.trip?.styles || []);
}
/** 이동·식사 조건의 ‘기타’(직접 입력) — 이동은 'custom:글자', 식사는 'diet:글자' 로 저장한다. */
const _NEED_CUSTOM = [['#needsMove', 'custom:'], ['#needsDiet', 'diet:']];
function _renderCustomNeeds() {
  _NEED_CUSTOM.forEach(([sel, pre]) => {
    const wrap = $(sel);
    if (!wrap) return;
    wrap.querySelectorAll('.is-custom').forEach(b => b.remove());
    (appState?.trip?.needs || []).filter(n => n.startsWith(pre)).forEach(n => {
      wrap.appendChild(el('button', { type: 'button', class: 'check-opt is-custom is-active', 'aria-pressed': 'true', dataset: { need: n } }, n.slice(pre.length)));
    });
  });
}
function _initCheckAdds() {
  const add = (formSel, inputSel, onAdd) => {
    $(formSel)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $(inputSel);
      const v = (inp?.value || '').replace(/[<>]/g, '').trim().slice(0, 20);
      if (!v) { inp?.focus(); return; }
      onAdd(v); inp.value = ''; inp.focus();
    });
  };
  add('#styleAdd', '#styleAddInput', (v) => {
    const t = appState.trip; t.styles = Array.isArray(t.styles) ? t.styles : [];
    if (!t.styles.includes(v)) t.styles.push(v);
    _buildStyles(); _saveDraft();
  });
  const addNeed = (pre) => (v) => {
    const t = appState.trip; t.needs = Array.isArray(t.needs) ? t.needs : [];
    if (!t.needs.includes(pre + v)) t.needs.push(pre + v);
    _renderCustomNeeds(); _saveDraft();
  };
  add('#moveAdd', '#moveAddInput', addNeed('custom:'));
  add('#dietAdd', '#dietAddInput', addNeed('diet:'));
}

/* ============ 출발·도착 검색 (도시·국가·공항 코드·현지어·한글 별칭) ============
 * 입력한 글자는 '검색어'일 뿐이고, 목록에서 고르거나 이름이 정확히 하나와 맞을 때만
 * 도시가 '확정'된다.  확정 전에는 다음 단계로 넘어가지 않는다.
 */
const _FIELDS = {
  origin: { input: '#tripOrigin',     sugg: '#originSuggestions', clear: '#originClear', msg: '#originMessage' },
  dest:   { input: '#tripCitySearch', sugg: '#citySuggestions',   clear: '#cityClear',   msg: '#citySelectedHint' },
};
const _suggFocus = { origin: -1, dest: -1 };

let _airportIdx = null;
// 주요 공항 영문 이름 — 'narita', 'incheon' 으로도 찾게.
const _AIRPORT_EN = { NRT: 'narita', HND: 'haneda', KIX: 'kansai', ITM: 'itami', ICN: 'incheon', GMP: 'gimpo', PUS: 'gimhae',
  CJU: 'jeju', CDG: 'charles de gaulle', ORY: 'orly', LHR: 'heathrow', LGW: 'gatwick', JFK: 'john f kennedy', LGA: 'laguardia',
  EWR: 'newark', FCO: 'fiumicino', BKK: 'suvarnabhumi', DMK: 'don mueang', TPE: 'taoyuan', TSA: 'songshan', FUK: 'fukuoka',
  CTS: 'new chitose', OKA: 'naha', NGO: 'chubu', DPS: 'ngurah rai', SIN: 'changi', HKG: 'chek lap kok', LAX: 'los angeles' };

function _airportIndex() {
  if (_airportIdx) return _airportIdx;
  const idx = [];
  Object.entries(_CITY_AIRPORTS).forEach(([key, list]) => list.forEach(([iata, ko]) => idx.push({ key, iata, ko })));
  Object.entries(_CITY_IATA).forEach(([key, iata]) => {
    if (!_CITY_AIRPORTS[key] && findCity(c => c.key === key)) idx.push({ key, iata, ko: null });
  });
  return (_airportIdx = idx);
}
let _airportSearch = null;
const _airportSearchIndex = () => (_airportSearch ||= createSearchIndex(_airportIndex(), { textsOf: a => [a.ko, a.ko && `${a.ko} 공항`, _AIRPORT_EN[a.iata]] }));

/** 검색 결과 [{ c, airport? }] — 공항 코드나 공항 이름이 맞으면 그 공항을 먼저 보여 준다. */
function _searchPlaces(query, kind) {
  const q = (query || '').trim();
  if (!q) return kind === 'origin' ? CITIES.filter(c => c.country === '대한민국').slice(0, 6).map(c => ({ c })) : [];
  const key = prepareQuery(q);
  const out = [];
  const seen = new Set();
  const toRow = (a) => {
    const c = findCity(x => x.key === a.key);
    if (!c || seen.has(a.iata)) return null;
    seen.add(a.iata);
    return { c, airport: { iata: a.iata, ko: a.ko || c.name } };
  };
  _airportIndex().forEach(a => { if (a.iata.toLowerCase() === key.base) out.push(toRow(a)); });
  // 공항 이름은 두 글자(라틴 글자는 세 글자)부터 — 이름 앞부분과 한글 조합 상태까지만, 가운데 글자로는 찾지 않는다.
  const later = [];
  if (key.compact.length >= (/^[a-z]/.test(key.compact) ? 3 : 2)) {
    _airportSearchIndex().search(q, { limit: 8, maxRank: RANK.HANGUL }).forEach(r => {
      // 영문 이름의 일부만 맞은 공항(new → New Chitose)은 이름이 그렇게 시작하는 도시(New York) 다음에
      (/^[a-z]/i.test(r.text) && r.rank >= RANK.PREFIX ? later : out).push(toRow(r.item));
    });
  }
  const cities = searchCities(q, 8);
  const lead = later.length ? cities.filter(c => [c.name, ...(c.aliases || [])].some(n => { const r = matchKey(prepare(n), key); return r > 0 && r < RANK.WORD; })).slice(0, 4) : [];
  out.push(...lead.map(c => ({ c })), ...later, ...cities.filter(c => !lead.includes(c)).map(c => ({ c })));
  return out.filter(Boolean).slice(0, 8);
}

function _openList(kind) {
  const f = _FIELDS[kind];
  const s = $(f.sugg); if (s) s.hidden = false;
  $(f.input)?.setAttribute('aria-expanded', 'true');
}
function _closeList(kind) {
  const f = _FIELDS[kind];
  const s = $(f.sugg); if (s) s.hidden = true;
  const i = $(f.input);
  i?.setAttribute('aria-expanded', 'false');
  i?.removeAttribute('aria-activedescendant');
}

function _renderPlaceList(kind, query) {
  const f = _FIELDS[kind];
  const sugg = $(f.sugg); const input = $(f.input);
  if (!sugg || !input) return;
  const results = _searchPlaces(query, kind);
  _suggFocus[kind] = -1;
  input.removeAttribute('aria-activedescendant');
  sugg.innerHTML = '';
  if (!results.length) {
    if (!String(query || '').trim()) { _closeList(kind); return; }
    const empty = el('div', { class: 'city-sug-empty', role: 'status' }, [
      el('span', {}, `‘${String(query).trim()}’에 맞는 도시나 공항이 없어요. `),
    ]);
    if (kind === 'dest') {
      empty.append(el('button', {
        type: 'button', class: 'btn-text',
        onclick: () => { const d = $('#destAdvanced'); if (d) d.open = true; _closeList(kind); $('#tripCountry')?.focus(); },
      }, '국가·도시 직접 선택'));
    } else {
      empty.append(el('span', {}, '영문 이름이나 공항 코드로 찾아보세요.'));
    }
    sugg.append(empty);
    _openList(kind);
    return;
  }
  const nameCount = {};
  results.forEach(r => { if (!r.airport) nameCount[r.c.name] = (nameCount[r.c.name] || 0) + 1; });
  let n = 0;
  const option = (cls, children, onPick) => el('button', {
    type: 'button', class: cls, role: 'option', id: `${kind}-opt-${n++}`,
    ariaSelected: 'false', tabIndex: -1, onclick: onPick,
  }, children);
  results.forEach(({ c, airport }) => {
    const pick = (ap) => () => (kind === 'origin' ? _applyOrigin(c, ap) : _applyCity(c, ap));
    if (airport) {
      sugg.append(option('city-sug-item is-airport', [
        el('span', { class: 'csa-icon', ariaHidden: 'true' }),
        el('div', { class: 'csi-text' }, [
          el('span', { class: 'csi-name' }, `${airport.ko} 공항`),
          el('span', { class: 'csi-country' }, `${c.name}, ${c.country}`),
        ]),
        el('span', { class: 'csa-code' }, airport.iata),
      ], pick(airport)));
      return;
    }
    sugg.append(option('city-sug-item', [
      el('span', { class: 'csi-flag', ariaHidden: 'true' }, c.flag),
      el('div', { class: 'csi-text' }, [
        el('span', { class: 'csi-name' }, c.name),
        el('span', { class: 'csi-country' }, `${c.country}${nameCount[c.name] > 1 ? ` · ${c.region}` : ''}`),
      ]),
      el('span', { class: 'csi-region' }, c.region),
    ], pick(null)));
    // 공항이 여러 개인 도시는 공항도 고를 수 있게 (예: 서울 → 인천 · 김포)
    (_CITY_AIRPORTS[c.key] || []).forEach(([iata, ko]) => {
      sugg.append(option('city-sug-airport', [
        el('span', { class: 'csa-icon', ariaHidden: 'true' }),
        el('span', { class: 'csa-name' }, `${ko} 공항`),
        el('span', { class: 'csa-code' }, iata),
      ], pick({ iata, ko })));
    });
  });
  _openList(kind);
  _announce(`검색 결과 ${n}개. 위아래 방향키로 고르고 Enter 로 선택하세요.`);
}

/** 화면 낭독기에 짧게 알린다(검색 결과 수 등). */
function _announce(text) {
  let live = document.getElementById('srAnnounce');
  if (!live) {
    live = el('p', { id: 'srAnnounce', class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

function _bindPlaceSearch(kind) {
  const f = _FIELDS[kind];
  const input = $(f.input); const sugg = $(f.sugg); const clear = $(f.clear);
  if (!input || !sugg) return;

  input.addEventListener('input', () => {
    const q = input.value;
    if (clear) clear.hidden = !q;
    _unconfirm(kind, q);
    _renderPlaceList(kind, q);
  });
  input.addEventListener('focus', () => {
    if (input.value || kind === 'origin') _renderPlaceList(kind, input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;       // 입력기로 글자를 짜는 중의 Enter·방향키는 입력기 것이다
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (sugg.hidden) _renderPlaceList(kind, input.value);
      const items = $$('[role=option]', sugg);
      if (!items.length) return;
      _suggFocus[kind] = Math.max(0, Math.min(items.length - 1, _suggFocus[kind] + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((it, i) => {
        const on = i === _suggFocus[kind];
        it.classList.toggle('is-focus', on);
        it.setAttribute('aria-selected', String(on));
        if (on) { input.setAttribute('aria-activedescendant', it.id); it.scrollIntoView({ block: 'nearest' }); }
      });
    } else if (e.key === 'Enter') {
      const items = $$('[role=option]', sugg);
      const target = items[_suggFocus[kind]] || (items.length === 1 ? items[0] : null);
      if (target && !sugg.hidden) { e.preventDefault(); target.click(); }
    } else if (e.key === 'Escape') {
      _closeList(kind);
    }
  });
  input.addEventListener('blur', () => setTimeout(() => _autoConfirm(kind), 180));
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) _closeList(kind);
  });
  clear?.addEventListener('click', () => {
    input.value = ''; clear.hidden = true;
    _closeList(kind);
    _unconfirm(kind, '');
    input.focus();
  });
}

function _bindAdvancedSelect() {
  $('#tripCountry')?.addEventListener('change', (e) => _buildCities(e.target.value));
  $('#tripCity')?.addEventListener('change', (e) => {
    const c = findCity(x => x.key === e.target.value);
    if (c) _applyCity(c);
  });
}

function _isConfirmed(kind) {
  const t = appState.trip;
  return kind === 'origin' ? !!t.origin : !!t.city;
}

/** 글자를 고치면 확정을 풀고 '검색 중' 상태로 돌린다. */
function _unconfirm(kind, typed) {
  const t = appState.trip;
  if (kind === 'origin') {
    t.origin = ''; t.originName = ''; t.originCountry = undefined;
    t.departureAirport = ''; t.departureAirportName = '';
    t._originText = typed;
    _setFieldMsg('origin', typed ? '목록에서 골라야 출발 도시가 정해져요.' : '', 'hint');
  } else {
    t.city = ''; t.cityName = ''; t.country = ''; t.cityTier = undefined; t.cityFlag = undefined;
    t.arrivalAirport = ''; t.arrivalAirportName = '';
    t._cityText = typed;
    setActiveByData($('#destQuick'), 'data-dest-quick', '');
    _setFieldMsg('dest', typed ? '목록에서 골라야 도착 도시가 정해져요.' : '', 'hint');
  }
  $(_FIELDS[kind].input)?.removeAttribute('aria-invalid');
  _refreshBudget();
}

/** 입력한 이름이 도시 하나와 정확히 같으면 목록을 고르지 않아도 확정한다. */
function _autoConfirm(kind) {
  if (_isConfirmed(kind)) return;
  const q = ($(_FIELDS[kind].input)?.value || '').trim();
  if (!q) return;
  const exact = _searchPlaces(q, kind).filter(r => !r.airport &&
    [r.c.name, ...(r.c.aliases || [])].some(nm => sameText(nm, q)));
  if (exact.length === 1) (kind === 'origin' ? _applyOrigin(exact[0].c) : _applyCity(exact[0].c));
}

function _setFieldMsg(kind, text, type) {
  const m = $(_FIELDS[kind].msg);
  if (!m) return;
  m.hidden = !text;
  m.textContent = text || '';
  m.classList.toggle('is-error', type === 'error');
  m.classList.toggle('city-selected-hint', type === 'ok');
}

/** 다음으로 갈 수 없는 이유를 입력 바로 아래에 쓰고 그 칸으로 초점을 옮긴다. */
function _fieldError(kind, text) {
  _setFieldMsg(kind, text, 'error');
  const input = $(_FIELDS[kind].input);
  input?.setAttribute('aria-invalid', 'true');
  input?.focus();
}

function _applyOrigin(c, airport) {
  if (!c) return;
  const t = appState.trip;
  t.origin = c.key; t.originName = c.name; t.originCountry = c.country; t._originText = '';
  t.departureAirport = airport?.iata || ''; t.departureAirportName = airport?.ko || '';
  const input = $('#tripOrigin');
  if (input) { input.value = airport ? `${c.name} · ${airport.ko}(${airport.iata})` : c.name; input.removeAttribute('aria-invalid'); }
  const clr = $('#originClear'); if (clr) clr.hidden = false;
  _closeList('origin');
  _setFieldMsg('origin', `✓ ${c.flag} ${airport ? `${airport.ko} 공항(${airport.iata}) · ` : ''}${c.name}, ${c.country}에서 출발`, 'ok');
  _refreshLocalNote();
  _refreshBudget();
}

function _applyCity(c, airport, opts = {}) {
  if (!c) return;
  const t = appState.trip;
  t.cityName = c.name; t.city = c.key; t.country = c.country;
  t.cityTier = c.tier; t.cityFlag = c.flag; t._cityText = '';
  t.arrivalAirport = airport?.iata || ''; t.arrivalAirportName = airport?.ko || '';
  const input = $('#tripCitySearch');
  if (input) { input.value = airport ? `${c.name} · ${airport.ko}(${airport.iata})` : c.name; input.removeAttribute('aria-invalid'); }
  const clr = $('#cityClear'); if (clr) clr.hidden = false;
  _closeList('dest');
  const cSel = $('#tripCountry'); const citySel = $('#tripCity');
  if (cSel) { cSel.value = c.country; _buildCities(c.country); }
  if (citySel) citySel.value = c.key;
  setActiveByData($('#destQuick'), 'data-dest-quick', c.name);
  _updateSelectedHint(c, airport, opts.from);
  if (opts.from === 'quick') {
    // 인기 도시를 누르면 도착 도시 칸이 바뀐 것을 바로 보이게 한다.
    const row = input?.closest('.form-row');
    if (row) { row.classList.remove('is-updated'); void row.offsetWidth; row.classList.add('is-updated'); }
  }
  _refreshBudget();
}

function _updateSelectedHint(c, airport, from) {
  if (!c) { _setFieldMsg('dest', '', ''); return; }
  const t = appState.trip;
  const where = `${c.flag} ${airport ? `${airport.ko} 공항(${airport.iata}) · ` : ''}${c.name}, ${c.country}`;
  const r = _groundOf(t);
  const local = t.origin && t.origin === c.key ? ' — 출발 도시와 같아서 항공 없이 현지 여행으로 계산해요.'
    : r ? ` — ${r.label} 약 ${_hm(r.minutes)} (${r.from} → ${r.to})` : '';
  _setFieldMsg('dest', `✓ ${from === 'quick' ? '도착 도시를 바꿨어요: ' : ''}${where}${local}`, 'ok');
}

/** 출발 도시를 바꾼 뒤 '같은 도시' 안내를 다시 맞춘다. */
function _refreshLocalNote() {
  const t = appState.trip;
  if (!t.city) return;
  const c = findCity(x => x.key === t.city);
  if (c) _updateSelectedHint(c, t.arrivalAirport ? { iata: t.arrivalAirport, ko: t.arrivalAirportName } : null);
}

/* ============ Date triggers + calendar ============ */
function _bindDateTriggers() {
  $('#tripStartTrigger')?.addEventListener('click', () => _openCal('start'));
  $('#tripEndTrigger')?.addEventListener('click', () => _openCal('end'));
}
const MAX_TRIP_DAYS = 30;
function _openCal(focus) {
  openCalendar({
    start: appState.trip.startDate,
    end:   appState.trip.endDate,
    focus,
    maxDays: MAX_TRIP_DAYS,
    returnFocus: focus === 'end' ? $('#tripEndTrigger') : $('#tripStartTrigger'),
    onApply: ({ start, end }) => {
      appState.trip.startDate = start;
      appState.trip.endDate   = end;
      const err = $('#dateError'); if (err) err.hidden = true;
      _refreshDuration();
      _refreshDateTriggers();
      _refreshBudget();
      _saveDraft();
    },
  });
}
function _refreshDateTriggers() {
  const sBtn = $('#tripStartTrigger'); const eBtn = $('#tripEndTrigger');
  const sLbl = $('#tripStartLabel');   const eLbl = $('#tripEndLabel');
  if (sLbl) sLbl.textContent = appState.trip.startDate ? _fmt(appState.trip.startDate) : '날짜 선택';
  if (eLbl) eLbl.textContent = appState.trip.endDate   ? _fmt(appState.trip.endDate)   : '날짜 선택';
  sBtn?.classList.toggle('is-empty', !appState.trip.startDate);
  eBtn?.classList.toggle('is-empty', !appState.trip.endDate);
}
function _fmt(iso) {
  const [y,m,d] = iso.split('-');
  const w = ['일','월','화','수','목','금','토'][new Date(+y, +m-1, +d).getDay()];
  return `${+m}.${+d} (${w})`;
}

/* ============ Bindings ============ */
function _bindFormHandlers() {
  document.querySelectorAll('[data-companion]').forEach(b => {
    b.addEventListener('click', () => {
      const t = appState.trip;
      t.companion = b.dataset.companion;
      const [adults, children] = _COMPANION_DEFAULT[t.companion] || [2, 0];
      t.adults = adults; t.children = children;
      t.rooms = Math.max(1, Math.ceil((adults + children) / 2));
      t._roomsTouched = false;
      setActiveByData(b.parentElement, 'data-companion', t.companion);
      _syncPeopleRow();
      _refreshBudget();
    });
  });

  // 성인·아동·객실 — 동행 유형과 따로 실제 인원을 받는다.
  $('#peopleBox')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-people-field]');
    if (!b || b.disabled) return;
    const t = appState.trip;
    _ensurePeople(t);
    const field = b.dataset.peopleField;
    t[field] = (t[field] || 0) + Number(b.dataset.delta);
    _clampPeople(t, field);
    _syncPeopleRow();
    _refreshBudget();
  });
  $('#tripCurrency')?.addEventListener('change', (e) => {
    appState.trip.currency = e.target.value;
    _refreshSummary();
    _saveDraft();
  });

  // ── 항공 노선 (단일 선택) ──
  $('#flightRouteChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-flight-route]'); if (!b) return;
    appState.trip.flight.route = b.dataset.flightRoute;
    _syncSingleChip('#flightRouteChips', '[data-flight-route]', b.dataset.flightRoute);
    _refreshBudget();
    _refreshSummary();
  });

  // ── 항공사 등급 (단일 선택) ──
  $('#flightClassChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-flight-class]'); if (!b) return;
    appState.trip.flight.classType = b.dataset.flightClass;
    _syncSingleChip('#flightClassChips', '[data-flight-class]', b.dataset.flightClass);
    _refreshAirlineChipFilter();
    _refreshBudget();
    _refreshSummary();
  });

  // ── 항공사 (다중 선택, classType 필터 적용) ──
  $('#airlineChips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-airline]'); if (!b) return;
    const name = b.dataset.airline;
    const arr = appState.trip.flight.airlines;
    const idx = arr.indexOf(name);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(name);
    b.classList.toggle('is-active', arr.includes(name));
    _refreshAirlineMeta();
    _refreshBudget();
    _refreshSummary();
  });
  $('#airlineSearch')?.addEventListener('input', (e) => _filterAirlines(e.target.value));
  $('#airlineReset')?.addEventListener('click', () => {
    appState.trip.flight.airlines = [];
    setMultiActive($('#airlineChips'), 'data-airline', []);
    _refreshAirlineMeta();
    _filterAirlines($('#airlineSearch')?.value || '');
    _refreshBudget();
    _refreshSummary();
    $('#airlineSearch')?.focus();
  });
  $('#hotelReset')?.addEventListener('click', () => {
    appState.trip.hotelP = { types: [], locations: [], amenities: [] };
    ['#hotelTypeChips', '#hotelLocChips', '#hotelAmenChips'].forEach(sel => setMultiActive($(sel), sel === '#hotelTypeChips' ? 'data-hotel-type' : sel === '#hotelLocChips' ? 'data-hotel-loc' : 'data-hotel-amen', []));
    _refreshBudget(); _refreshSummary(); _refreshMoreMeta();
    _saveDraft();
  });

  // ── 호텔 유형/위치/편의시설 (다중 선택) ──
  const hotelGroups = [
    ['#hotelTypeChips', 'data-hotel-type', 'types'],
    ['#hotelLocChips',  'data-hotel-loc',  'locations'],
    ['#hotelAmenChips', 'data-hotel-amen', 'amenities'],
  ];
  hotelGroups.forEach(([sel, attr, key]) => {
    $(sel)?.addEventListener('click', (e) => {
      const dsKey = attr.replace('data-hotel-', '').replace('-', '');
      const b = e.target.closest(`[${attr}]`); if (!b) return;
      const dataKey = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = b.dataset[dataKey];
      const arr = appState.trip.hotelP[key];
      const idx = arr.indexOf(val);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(val);
      b.classList.toggle('is-active', arr.includes(val));
      _refreshBudget();
      _refreshSummary();
    });
  });
}

/** 단일 선택 칩 동기화 — attr 는 'data-xxx' 또는 '[data-xxx]' 둘 다 허용 */
function _syncSingleChip(rootSel, attr, value) {
  const cleanAttr = String(attr).replace(/^\[|\]$/g, '');     // 브래킷 제거
  $$(rootSel + ' [' + cleanAttr + ']').forEach(b => {
    const on = b.getAttribute(cleanAttr) === value;
    b.classList.toggle('is-active', on);
  });
}

/** 선택한 항공사 수와 이름 요약 — 아무것도 안 고르면 모든 항공사를 고려한다. */
function _refreshAirlineMeta() {
  const arr = appState.trip.flight?.airlines || [];
  const c = $('#airlineCount');
  if (c) {
    c.textContent = arr.length
      ? `${arr.length}개 선택 · ${arr.slice(0, 3).join(', ')}${arr.length > 3 ? ` 외 ${arr.length - 3}곳` : ''}`
      : '선택 안 함 · 모든 항공사를 고려해요';
  }
  const r = $('#airlineReset'); if (r) r.hidden = !arr.length;
}
/** 이름·'저가'·'대형'으로 항공사 칩을 거른다. 고른 항공사는 항상 보인다. */
function _filterAirlines(q) {
  const query = normalize(q);
  const key = prepareQuery(q);
  const typeWord = /저가|lcc/.test(query) ? 'lcc' : (/대형|fsc/.test(query) ? 'fsc' : null);
  let matches = 0;
  $$('#airlineChips [data-airline]').forEach(b => {
    const hit = !query || matchKey(prepare(b.textContent), key) > 0 || matchKey(prepare(b.dataset.airline), key) > 0 || (typeWord && b.dataset.airlineType === typeWord);
    if (hit) matches++;
    b.hidden = !(hit || b.classList.contains('is-active'));
  });
  const e = $('#airlineEmpty'); if (e) e.hidden = !query || matches > 0;
}

/** 항공사 등급 변경 시 LCC/FSC 칩 비활성화·필터 */
function _refreshAirlineChipFilter() {
  const cls = appState.trip.flight.classType;  // 'any' | 'lcc' | 'fsc'
  $$('#airlineChips [data-airline]').forEach(b => {
    const t = b.dataset.airlineType;
    const dim = (cls === 'lcc' && t === 'fsc') || (cls === 'fsc' && t === 'lcc');
    b.classList.toggle('is-dim', dim);
    // 비활성화된 항공사는 선택 해제
    if (dim) {
      const arr = appState.trip.flight.airlines;
      const i = arr.indexOf(b.dataset.airline);
      if (i >= 0) { arr.splice(i, 1); b.classList.remove('is-active'); }
    }
  });
  _refreshAirlineMeta();
}

const _STEP_EVENTS = { 1: 'trip_step_city', 2: 'trip_step_dates', 3: 'trip_step_concept' };

function _bindStepHandlers() {
  $('#stepPrev')?.addEventListener('click', () => { if (step > 1) { step--; _showStep(); _stepTop(); } else { navigate('home'); } });
  $('#stepNext')?.addEventListener('click', () => {
    if (!_validateStep()) return;
    trackEvent(_STEP_EVENTS[step]);
    if (step < 4) { step++; _showStep(); _stepTop(); }
  });
  $('#stepGenerate')?.addEventListener('click', async () => {
    // 저장해 둔 초안으로 4단계에 바로 왔을 수 있다 — 지난 날짜·지워진 도시까지 앞 단계를 모두 다시 확인한다.
    for (let s = 1; s <= 3; s++) {
      step = s;
      if (!_validateStep()) { _showStep(); _stepTop(); _validateStep(); return; }
    }
    step = 4;
    if (!_validateStep()) return;
    trackEvent('trip_step_budget');
    // 실패하면 _generateSchedule 이 '다시 시도' 화면을 띄운다.
    if (await _generateSchedule()) trackEvent('trip_created');
  });
}

/* ============ Budget — direct input + smart suggestion ============ */
function _seasonMult(startISO) {
  if (!startISO) return 1.0;
  const m = parseInt(startISO.split('-')[1], 10);
  if ([7,8,12,1].includes(m)) return 1.25;   // peak
  if ([4,5,9,10,11].includes(m)) return 1.05; // shoulder
  return 0.9;                                 // off
}
function _round10(n) { return Math.max(10, Math.round(n / 10) * 10); }
function _manwon(krw) { return Math.ceil((Number(krw) || 0) / 10000); }
function _won(krw) { return formatCurrency(Math.round(krw || 0), 'KRW'); }

/** 예산 단계: 추천 예산(만원)과 낮음·보통·높음 구성을 실제 계산으로 만든다. */
function _computeSuggested() {
  const t = appState.trip;
  const includes = { includeFlight: t.includeFlight !== false, includeHotel: t.includeHotel !== false };
  const userTypes = t.hotelP?.types?.length ? null : undefined;   // 사용자가 숙소 유형을 골랐으면 그 유형 그대로
  const low  = _estimatePlan(t, { ...includes, hotelType: userTypes === null ? null : 'budget',   level: '낮음', flightClass: 'lcc' });
  const mid  = _estimatePlan(t, { ...includes, hotelType: userTypes === null ? null : 'midscale', level: '보통' });
  const high = _estimatePlan(t, { ...includes, hotelType: userTypes === null ? null : 'upscale',  level: '높음', flightClass: 'fsc' });
  t._suggestedPlans = { low, mid, high };
  return { low: _round10(_manwon(low.total)), mid: _round10(_manwon(mid.total)), high: _round10(_manwon(high.total)) };
}

/** ‘741만 원’ — 자세한 금액은 title 에 둔다. */
function _wonShort(v) {
  const n = Math.round((Number(v) || 0) / 1000) * 1000;
  if (n >= 1000000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만 원`;
  const man = Math.floor(n / 10000), cheon = Math.round((n % 10000) / 1000);
  if (n === 0) return Number(v) > 0 ? '1천 원 미만' : '0원';
  return n < 10000 ? `${cheon}천 원` : `${man}만${cheon ? ` ${cheon}천` : ''} 원`;
}

function _refreshBudget() {
  const t = appState.trip;
  const sug = _computeSuggested();
  const plan = t._suggestedPlans.mid;
  t._suggested = sug;

  const inp = $('#tripBudgetInput');
  if (inp && document.activeElement !== inp) inp.value = t.budget ? String(t.budget) : '';
  _fitBudgetInput();

  const people = _peopleCount(t);
  const days = Math.max(1, t.days || 1);
  const sumEl = $('#budgetTripSummary');
  if (sumEl) {
    const route = `${t.originName || '출발지 미선택'} → ${t.cityName || '도착지 미선택'}`;
    sumEl.innerHTML = `<strong>${escapeHtml(route)}</strong><span>${escapeHtml(_durationLabel(days))} · ${people}명</span>`;
  }
  _syncRideTexts();
  const ground = _groundOf(t);
  const fn = $('#includeFlightNote');
  if (fn) fn.textContent = _isLocalTrip(t) ? '같은 도시 여행이라 필요 없어요' : `${ground ? `${ground.label} ` : ''}왕복 · ${people}명`;
  const hn = $('#includeHotelNote');
  if (hn) hn.textContent = days > 1 ? `${days - 1}박 · 객실 ${_roomCount(t)}개` : '당일치기라 필요 없어요';

  const rows = $('#budgetSuggestRows');
  if (rows) {
    const items = [
      [RIDE[plan.ride].label, plan.flight, `왕복 ${people}명`], ['숙소', plan.hotel, `${plan.nights}박 · ${plan.rooms}실`], ['식비', plan.food],
      ['쇼핑', plan.shopping], ['입장·체험', plan.entry], ['현지 교통', plan.transport],
    ].filter(x => x[1] > 0);
    const total = $('#budgetSuggestTotal');
    if (total) { total.title = _won(plan.total); total.textContent = `약 ${sug.mid.toLocaleString('ko-KR')}만 원`; }
    $('#budgetSuggestBar')?.replaceChildren(...items.map(([, v], k) => {
      const bar = el('i', { class: `bs-c${k + 1}` });
      bar.style.flexGrow = String(Math.max(1, Math.round(v / plan.total * 100)));
      return bar;
    }));
    rows.replaceChildren(...items.map(([label, v, note], k) => el('div', { class: 'bs-item' }, [
      el('dt', {}, [el('i', { class: `bs-dot bs-c${k + 1}`, 'aria-hidden': 'true' }), label, note ? el('small', {}, note) : null].filter(Boolean)),
      el('dd', { title: _won(v) }, _wonShort(v)),
    ])));
  }
  const sText = $('#budgetSuggestText');
  if (sText) {
    const sm = _seasonMult(t.startDate);
    const season = sm > 1.2 ? '성수기' : (sm < 1 ? '비수기' : '준성수기');
    const tier = ({ high: '물가 높은 도시', mid: '물가 보통 도시', low: '물가 낮은 도시' })[t.cityTier] || '';
    sText.textContent = `${[t.cityName, tier, season, t.concept && `${t.concept} 스타일`].filter(Boolean).join(' · ')} · 보통 지출 기준 추정치예요. 실제 요금과 다를 수 있어요.`;
  }
  const lowEl = $('#bmLow'); const midEl = $('#bmMid'); const highEl = $('#bmHigh');
  if (lowEl)  lowEl.textContent  = `${sug.low}만원`;
  if (midEl)  midEl.textContent  = `${sug.mid}만원`;
  if (highEl) highEl.textContent = `${sug.high}만원`;
  _refreshLevelBadge();
}

function _durationLabel(days) {
  return days <= 1 ? '당일치기' : `${days - 1}박 ${days}일`;
}

/** 입력 예산 검사 — 오류 문구를 돌려주고, 괜찮으면 null. */
function _budgetError(raw) {
  const v = String(raw ?? '').replace(/[,\s]/g, '');
  if (!v) return '총 여행 예산을 입력해 주세요.';
  if (!/^\d+$/.test(v)) return '숫자만 입력해 주세요. (예: 80)';
  const n = Number(v);
  if (n <= 0) return '0원보다 큰 금액을 입력해 주세요.';
  if (n > 100000) return '10억 원(100,000만원) 이하로 입력해 주세요.';
  return null;
}

function _refreshLevelBadge() {
  const t = appState.trip;
  const badge = $('#budgetLevelBadge');
  const per = $('#budgetPerPerson');
  const people = _peopleCount(t);
  if (per) per.textContent = t.budget > 0 ? `${people}명 기준 1인당 약 ${Math.round(t.budget / people)}만원` : '';
  if (!badge) return;
  const sug = t._suggested || {};
  if (!sug.mid || !t.budget) { badge.textContent = ''; return; }
  const ratio = t.budget / sug.mid;
  let lvl, text;
  if (t.budget < sug.low) { lvl = '낮음'; text = '추천 예산보다 많이 낮아요. 숙소 등급과 지출을 최대한 줄여 맞춰 보고, 그래도 넘으면 대안을 알려 드릴게요.'; }
  else if (ratio < 0.9)   { lvl = '낮음'; text = '추천 예산보다 조금 낮아요. 숙소 등급이나 현지 지출을 낮춰 맞출게요.'; }
  else if (ratio <= 1.15) { lvl = '보통'; text = '추천 예산과 비슷해요.'; }
  else                    { lvl = '높음'; text = '추천 예산보다 여유 있어요. 더 좋은 숙소와 식당을 고를게요.'; }
  t.budgetLevel = lvl;
  badge.textContent = text;
  badge.dataset.level = lvl;
}

/** 입력칸을 글자 수만큼만 넓혀 ‘숫자 + 만원’이 늘 가운데에 오게 한다. */
function _fitBudgetInput() {
  const inp = $('#tripBudgetInput');
  if (!inp) return;
  const v = inp.value.trim();
  const ch = v ? Math.min(8, Math.max(1, Array.from(v).reduce((n, c) => n + (/[0-9]/.test(c) ? 1 : c === ',' ? 0.5 : 1.6), 0))) : 3.7;
  inp.style.setProperty('--ch', String(ch));
}

function _setBudget(v) {
  const t = appState.trip;
  t.budget = v;
  const inp = $('#tripBudgetInput');
  if (inp) inp.value = v ? String(v) : '';
  _fitBudgetInput();
  const err = $('#budgetError');
  if (err) { err.hidden = true; err.textContent = ''; }
  inp?.removeAttribute('aria-invalid');
  _refreshLevelBadge();
  _refreshSummary();
  _saveDraft();
}

function _bindBudgetHandlers() {
  $('#tripBudgetInput')?.addEventListener('input', (e) => {
    _fitBudgetInput();
    const raw = e.target.value;
    const err = _budgetError(raw);
    appState.trip.budget = err ? 0 : Number(String(raw).replace(/[,\s]/g, ''));
    const errEl = $('#budgetError');
    // 입력 중에는 형식 오류만 바로 보여 주고, 빈 값 안내는 다음 버튼을 누를 때 보여 준다.
    if (errEl) {
      const show = err && String(raw).trim() !== '';
      errEl.hidden = !show; errEl.textContent = show ? err : '';
      e.target.toggleAttribute('aria-invalid', !!show);
    }
    _refreshLevelBadge();
    _refreshSummary();
    _saveDraft();
  });
  $('#budgetApplyBtn')?.addEventListener('click', () => {
    const sug = appState.trip._suggested || {};
    if (!sug.mid) return;
    _setBudget(sug.mid);
    showToast(`추천 예산 ${sug.mid}만원을 넣었어요`);
  });
  document.querySelectorAll('[data-budget-level]').forEach(b => {
    b.addEventListener('click', () => {
      const lvl = b.dataset.budgetLevel;
      const sug = appState.trip._suggested || {};
      const v = lvl === '낮음' ? sug.low : (lvl === '높음' ? sug.high : sug.mid);
      if (!v) return;
      setActiveByData(b.parentElement, 'data-budget-level', lvl);
      _setBudget(v);
    });
  });
  $('#includeFlight')?.addEventListener('change', (e) => { appState.trip.includeFlight = e.target.checked; _refreshBudget(); _saveDraft(); });
  $('#includeHotel')?.addEventListener('change', (e) => { appState.trip.includeHotel = e.target.checked; _refreshBudget(); _saveDraft(); });
}

/** 작성 중인 여행을 기기에 바로 저장 — 새로고침·이탈 후에도 이어서 쓸 수 있게. */
/** 접힌 ‘세부 조건’ 상자에 무엇을 골랐는지 요약해, 열지 않아도 보이게 한다. */
function _refreshMoreMeta() {
  const t = appState.trip;
  if (!t) return;
  const h = t.hotelP || {};
  const hn = (h.types?.length || 0) + (h.locations?.length || 0) + (h.amenities?.length || 0);
  const hc = $('#hotelCount'); if (hc) hc.textContent = hn ? `${hn}개 선택` : '선택 안 함 · 예산에 맞는 숙소를 골라요';
  const hr = $('#hotelReset'); if (hr) hr.hidden = !hn;
  const hm = $('#hotelMoreMeta'); if (hm) hm.textContent = hn ? `${hn}개 선택` : '선택 안 함';
  const f = t.flight || {};
  const fn = (f.airlines?.length || 0) + (f.route && f.route !== 'any' ? 1 : 0) + (f.classType && f.classType !== 'any' ? 1 : 0);
  const fm = $('#flightMoreMeta'); if (fm) fm.textContent = fn ? `${fn}개 선택` : '선택 안 함';
  const parts = [];
  const ground = _groundOf(t);
  if (t.includeFlight === false) parts.push(`${RIDE[ground?.mode || 'air'].ticket} 제외`);
  if (t.includeHotel === false) parts.push('숙소 제외');
  if (t.currency && t.currency !== 'KRW') parts.push(`${t.currency}로 표시`);
  if (fn && !ground) parts.push(`항공 ${fn}개`);
  if (hn) parts.push(`숙소 ${hn}개`);
  const bm = $('#budgetMoreMeta'); if (bm) bm.textContent = parts.length ? parts.join(' · ') : '선택 · 바꾸지 않아도 돼요';
  const sn = (t.styles || []).length;
  const sm = $('#styleH .form-label-meta'); if (sm) sm.textContent = sn ? `선택 · ${sn}개 선택됨` : '선택 · 여러 개 가능';
}

function _saveDraft() {
  const t = appState.trip;
  if (!t) return;
  _refreshMoreMeta();
  t._draft = !!(t.cityName || t.originName || t._originText || t._cityText || t.startDate || (t.concept && t.concept !== '균형') || t.budget);
  t._draftStep = step;
  _syncPressed();
  document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
}

/** 이어서 작성할 때 위쪽에 '새로 시작' 선택지를 보여 준다. */
function _showDraftBanner(show) {
  let bar = document.getElementById('draftBanner');
  if (!show) { bar?.remove(); return; }
  if (!bar) {
    bar = el('div', { id: 'draftBanner', class: 'draft-banner', role: 'status' }, [
      el('span', {}, '작성하던 여행을 이어서 보여 드려요 · 이 기기에만 보관 중'),
      el('button', { type: 'button', class: 'btn-text', onclick: () => {
        _resetTripState(); step = 1; _showStep(); _applyState(); _showDraftBanner(false);
        showToast('새 여행을 처음부터 시작해요');
      } }, '새로 시작'),
    ]);
    $('#tripStepProgress')?.before(bar);
  }
}

function _showPrefillBanner(title) {
  document.getElementById('prefillBanner')?.remove();
  if (!title) return;
  const bar = el('div', { id: 'prefillBanner', class: 'draft-banner', role: 'status' }, [
    el('span', {}, `‘${title}’에서 도시·기간·스타일을 가져왔어요. 날짜는 임시라 2단계에서 바꿔 주세요.`),
    el('button', { type: 'button', class: 'btn-text', onclick: () => bar.remove() }, '닫기'),
  ]);
  $('#tripStepProgress')?.before(bar);
}

/* ============ Duration / Summary / Steps ============ */
function _refreshDuration() {
  const { startDate: s0, endDate: e0 } = appState.trip;
  const d = (s0 && e0 && e0 >= s0) ? diffDays(s0, e0) : 0;
  appState.trip.days = d;
  const t = $('#tripDuration');
  if (t) t.textContent = d ? `${_durationLabel(d)} (${appState.trip.startDate} → ${appState.trip.endDate})` : '날짜를 골라 주세요';
}

function _refreshSummary() {
  const s = $('#tripSummary');
  if (!s) return;
  const t = appState.trip;
  const f = t.flight || {};
  const h = t.hotelP || {};
  const routeLbl = { any: '노선 상관없음', direct: '직항만', transit: '경유 포함' }[f.route] || '노선 미선택';
  const clsLbl   = { any: '등급 상관없음', lcc: '저가 (LCC)', fsc: '대형 (FSC)' }[f.classType] || '등급 미선택';
  const hotelTypeLbl = {
    luxury: '5성급', upscale: '4성급', midscale: '3성급', budget: '2성급', boutique: '부티크',
    resort: '리조트', ryokan: '료칸', bnb: 'B&B', hostel: '호스텔', apt: '아파트', capsule: '캡슐',
  };
  const hotelLocLbl = {
    downtown: '시내중심', station: '역근처', airport: '공항', beach: '해변', nature: '자연', shopping: '쇼핑가',
  };
  const hotelAmenLbl = {
    breakfast: '조식', pool: '수영장', spa: '스파', gym: '피트니스', parking: '주차',
    petfriendly: '반려동물', kitchen: '취사', laundry: '세탁', kids: '키즈',
  };
  const types = (h.types || []).map(x => hotelTypeLbl[x] || x).join(', ');
  const locs  = (h.locations || []).map(x => hotelLocLbl[x]  || x).join(', ');
  const amens = (h.amenities || []).map(x => hotelAmenLbl[x] || x).join(', ');
  // 고른 것만 — 비어 있는 항목은 줄을 만들지 않는다
  const flight = [f.route && f.route !== 'any' ? routeLbl : '', f.classType && f.classType !== 'any' ? clsLbl : '', (f.airlines || []).join(', ')].filter(Boolean).join(', ');
  const ground = _groundOf(t);
  const rows = [
    ['장소', (PLACE_MODES.find(x => x[0] === modeOf(t)) || [])[1]],
    ['여행 스타일', [t.concept, ...(t.styles || [])].filter(Boolean).join(', ')],
    ['함께', t.companion ? _companionLabel(t.companion) : ''],
    ['예산', Number(t.budget) > 0 ? `${t.budget}만원` : ''],
    ground ? ['오가는 길', `${ground.label} · ${ground.from} → ${ground.to} 약 ${_hm(ground.minutes)}`] : ['항공', flight],
    ['숙소', [types, locs, amens].filter(Boolean).join(', ')],
  ].filter(([, v]) => v && v !== '-');
  s.hidden = !rows.length;
  s.innerHTML = `<dl class="ts-rows">${rows.map(([k, v]) => `<div class="ts-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function _companionLabel(k) { return ({ solo:'혼자', friend:'친구', couple:'커플', family:'가족', group:'단체' })[k] || '-'; }
function _companionLabelShort(k) { return ({ solo:'1인', friend:'친구', couple:'커플', family:'가족', group:'단체' })[k] || ''; }

/** 단계를 넘기면 맨 위에서 시작한다. */
function _stepTop() {
  const sc = $('#createTripPage .page-scroll');
  if (sc) sc.scrollTop = 0;
  window.scrollTo(0, 0);
}

function _showStep() {
  $$('#tripStepProgress .step-dot').forEach(d => {
    const n = Number(d.dataset.step);
    d.classList.toggle('is-active', n === step);
    d.classList.toggle('is-done', n < step);
  });
  $$('#tripStepProgress .step-line').forEach((line, i) => {
    line.classList.toggle('is-done', i < step - 1);
  });
  const names = ['여행지', '날짜·인원', '스타일', '예산'];
  $('#tripStepProgress')?.setAttribute('aria-label', `전체 4단계 중 ${step}단계 · ${names[step - 1]}`);
  const sc = $('#stepCompact');
  if (sc) {
    sc.querySelector('.stc-count').textContent = `${step}/4`;
    sc.querySelector('.stc-name').textContent = names[step - 1];
    sc.querySelector('.stc-bar i').style.width = `${step * 25}%`;
  }
  $$('#createTripPage .step-pane').forEach(p => {
    const on = Number(p.dataset.stepPane) === step;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
  // 질문은 위쪽 밤하늘에 크게 — 화면 안의 같은 제목은 숨긴다
  const q = $('#createQ');
  if (q) q.textContent = $(`#createTripPage [data-step-pane="${step}"] .step-h`)?.textContent || names[step - 1];
  // 첫 단계는 앱바의 닫기(×)와 결과가 같으므로 하단 ‘취소’를 두지 않는다.
  $('#stepPrev').textContent = '이전';
  $('#stepPrev').hidden = step === 1;
  $('#stepNext').hidden = step === 4;
  $('#stepGenerate').hidden = step !== 4;
  const mv = $('#mustVisit'); if (mv) mv.placeholder = mustPlaceholder(appState.trip?.city, appState.trip?.cityName);
  if (step === 4) { _refreshBudget(); _refreshSummary(); }
  _saveDraft();
}

function _validateStep() {
  const t = appState.trip;
  if (step === 1) {
    _autoConfirm('origin'); _autoConfirm('dest');
    if (!t.city) {
      _fieldError('dest', $('#tripCitySearch')?.value.trim()
        ? '검색 결과에서 도착 도시를 선택해 주세요. 없으면 아래 ‘국가·도시 직접 선택’을 써 보세요.'
        : '도착 도시를 입력하거나 인기 도시를 골라 주세요.');
      return false;
    }
    if (!t.origin) {
      _fieldError('origin', $('#tripOrigin')?.value.trim()
        ? '검색 결과에서 출발 도시를 선택해 주세요.'
        : '출발 도시를 입력해 주세요.');
      return false;
    }
  }
  if (step === 2) {
    const err = _dateError(t);
    if (err) {
      const e = $('#dateError'); if (e) { e.hidden = false; e.textContent = err; }
      (t.startDate && !/출국일/.test(err) ? $('#tripEndTrigger') : $('#tripStartTrigger'))?.focus();
      return false;
    }
  }
  if (step === 3) {
    if (!t.concept) {
      const e = $('#conceptError'); if (e) { e.hidden = false; e.textContent = '여행 스타일을 한 가지 골라 주세요.'; }
      $('#conceptGrid .concept-card')?.focus();
      return false;
    }
  }
  if (step === 4) {
    const inp = $('#tripBudgetInput');
    const err = _budgetError(inp ? inp.value : t.budget);
    if (err) {
      const errEl = $('#budgetError');
      if (errEl) { errEl.hidden = false; errEl.textContent = err; }
      inp?.setAttribute('aria-invalid', 'true');
      inp?.focus();
      return false;
    }
  }
  return true;
}

/** 날짜 순서·지난 날짜·최대 기간을 검사한다. 문제가 없으면 빈 문자열. */
function _dateError(t) {
  if (!t.startDate) return '출국일을 골라 주세요.';
  if (!t.endDate) return '귀국일을 골라 주세요. 당일치기라면 출국일과 같은 날을 고르면 돼요.';
  if (t.endDate < t.startDate) return '귀국일이 출국일보다 빨라요. 날짜를 다시 골라 주세요.';
  if (t.startDate < _isoLocal(new Date())) return '출국일이 이미 지났어요. 오늘 이후 날짜로 다시 골라 주세요.';
  if (diffDays(t.startDate, t.endDate) > MAX_TRIP_DAYS) return `여행 기간은 최대 ${MAX_TRIP_DAYS}일까지 만들 수 있어요.`;
  return '';
}

/** 취향 분석 결과를 새 여행의 '스타일' 단계에 미리 골라 둔다(사용자가 바꿀 수 있음).
 *  반영: 예산 선호 → 여행 컨셉, 여행 페이스·음식·활동 → 세부 스타일.  이동 선호는 아직 반영하지 않는다. */
export const PREF_APPLIED_TO = '새 여행 만들기 › 스타일 단계 (컨셉 · 세부 스타일)';
function _applyPreferences(t) {
  const p = appState?.preferences || {};
  const concept = { '절약': '가성비', '균형': '균형', '프리미엄': '프리미엄' }[p.budget];
  const styles = new Set();
  if (p.pace === '느긋하게') styles.add('여유로운 일정');
  if (p.pace === '빡빡하게') styles.add('빽빽한 일정');
  if (p.food === '로컬 맛집' || p.food === '유명 맛집') styles.add('맛집 중심');
  const act = { '자연': '자연 중심', '쇼핑': '쇼핑 중심', '사진': '사진 명소' }[p.activity];
  t.placeMode = p.food === '유명 맛집' || p.activity === '문화' ? 'mix' : 'local';
  if (act) styles.add(act);
  t._prefApplied = !!(concept || styles.size);
  if (concept) t.concept = concept;
  if (styles.size) t.styles = [...styles];
}

function _resetTripState() {
  // 트립 상태 초기화 — 홈에서 "새 여행 만들기" 진입 시 깨끗한 폼을 보장.
  if (!appState?.trip) return;
  const t = appState.trip;
  t.country = ''; t.city = ''; t.cityName = '';
  t.cityTier = undefined; t.cityFlag = undefined;
  t.arrivalAirport = ''; t.arrivalAirportName = '';
  t.origin = ''; t.originName = ''; t.originCountry = undefined;
  t.departureAirport = ''; t.departureAirportName = '';
  t.startDate = null; t.endDate = null; t.days = 0;
  t.companion = 'couple';
  t.adults = 2; t.children = 0; t.rooms = 1; t._roomsTouched = false;
  t._originText = ''; t._cityText = '';
  t.concept = '균형';   // 기본값 — 스타일 단계에서 바꿀 수 있다
  t.styles = [];
  t.mustVisit = '';
  t.placeMode = 'local';
  t.mustResolved = {};
  t.needs = [];
  t.budget = 0;
  t.budgetLevel = '보통';
  t._suggested = undefined;
  t.includeFlight = true;
  t.includeHotel = true;
  t._draft = false;
  t._draftStep = 1;
  t.flight = { route: 'any', classType: 'any', airlines: [] };
  t.hotelP = { types: [], locations: [], amenities: [] };
  // (currency 는 사용자 선택이라 유지)
  _applyPreferences(t);
  step = 1;

  // UI 입력 필드 비우기
  const reset = (sel, val = '') => { const el = $(sel); if (el) el.value = val; };
  reset('#tripOrigin');
  reset('#tripCitySearch');
  reset('#tripBudgetInput');
  const oc = $('#originClear'); if (oc) oc.hidden = true;
  const cc = $('#cityClear');   if (cc) cc.hidden = true;
  _setFieldMsg('origin', '', ''); _setFieldMsg('dest', '', '');
  ['#tripOrigin', '#tripCitySearch', '#tripBudgetInput'].forEach(sel => $(sel)?.removeAttribute('aria-invalid'));
  ['#dateError', '#conceptError', '#budgetError'].forEach(sel => { const e = $(sel); if (e) e.hidden = true; });
  const sh = $('#styleHint'); if (sh) sh.textContent = '‘여유로운 일정’과 ‘빽빽한 일정’은 둘 중 하나만 고를 수 있어요.';
  const as = $('#airlineSearch'); if (as) as.value = '';
  _filterAirlines('');
  _refreshAirlineMeta();
  const sLbl = $('#tripStartLabel'); if (sLbl) sLbl.textContent = '날짜 선택';
  const eLbl = $('#tripEndLabel');   if (eLbl) eLbl.textContent = '날짜 선택';
  const dur  = $('#tripDuration');   if (dur)  dur.textContent = '날짜를 골라 주세요';
  const sBtn = $('#tripStartTrigger'); if (sBtn) sBtn.classList.add('is-empty');
  const eBtn = $('#tripEndTrigger');   if (eBtn) eBtn.classList.add('is-empty');

  // 컨셉/스타일/동행 칩 active 해제
  $$('#conceptGrid .concept-card').forEach(b => b.classList.remove('is-active'));
  _buildStyles();
  _renderCustomNeeds();
  $$('[data-companion]').forEach(b => b.classList.toggle('is-active', b.dataset.companion === 'couple'));
  _syncPeopleRow();   // couple → 인원 입력칸 숨김 + people 초기화
  $$('[data-dest-quick]').forEach(b => b.classList.remove('is-active'));
  // 항공·호텔 chip 초기화
  $$('#flightRouteChips .chip, #flightClassChips .chip').forEach(b => b.classList.remove('is-active'));
  $$('#airlineChips .chip').forEach(b => { b.classList.remove('is-active'); b.classList.remove('is-dim'); });
  $$('#hotelTypeChips .chip, #hotelLocChips .chip, #hotelAmenChips .chip').forEach(b => b.classList.remove('is-active'));
}

function _applyState() {
  _modernStyles(appState.trip); _syncPlaceMode();
  const ph = $('#prefHint'); if (ph) ph.hidden = !appState.trip?._prefApplied;
  const t = appState.trip;
  // 출발·도착 — 확정된 도시(공항 포함)를 되살리고, 검색 중이던 글자는 글자대로 둔다.
  const oc0 = t.origin ? findCity(x => x.key === t.origin) : (t.originName ? findCity(x => x.name === t.originName) : null);
  if (oc0) _applyOrigin(oc0, t.departureAirport ? { iata: t.departureAirport, ko: t.departureAirportName } : null);
  else if (t._originText || t.originName) {
    const oi = $('#tripOrigin'); if (oi) oi.value = t._originText || t.originName;
    const ocl = $('#originClear'); if (ocl) ocl.hidden = false;
  }
  const cc0 = (t.city || t.cityName) ? findCity(x => x.key === t.city || x.name === t.cityName) : null;
  if (cc0) _applyCity(cc0, t.arrivalAirport ? { iata: t.arrivalAirport, ko: t.arrivalAirportName } : null);
  else if (t._cityText || t.cityName) {
    const ci = $('#tripCitySearch'); if (ci) ci.value = t._cityText || t.cityName;
    const ccl = $('#cityClear'); if (ccl) ccl.hidden = false;
  }
  _refreshDateTriggers();
  _refreshDuration();
  if (t.companion) setActiveByData(document.querySelector('.choice-grid'), 'data-companion', t.companion);
  _syncPeopleRow();   // 복원 시 가족/단체면 인원 입력칸 + 값 복원
  if (t.concept) setActiveByData(document.getElementById('conceptGrid'), 'data-concept-key', t.concept);
  _buildStyles();
  _renderCustomNeeds();
  const mv = $('#mustVisit'); if (mv) mv.value = t.mustVisit || '';
  $$('.needs-list [data-need]').forEach(b => { const on = (t.needs || []).includes(b.dataset.need); b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  if (t.currency) $('#tripCurrency').value = t.currency;

  // 항공·호텔 상태 → UI 복원
  if (t.flight) {
    _syncSingleChip('#flightRouteChips', 'data-flight-route', t.flight.route || 'any');
    _syncSingleChip('#flightClassChips', 'data-flight-class', t.flight.classType || 'any');
    setMultiActive($('#airlineChips'), 'data-airline', t.flight.airlines || []);
    _refreshAirlineChipFilter();
  }
  if (t.hotelP) {
    setMultiActive($('#hotelTypeChips'), 'data-hotel-type', t.hotelP.types || []);
    setMultiActive($('#hotelLocChips'),  'data-hotel-loc',  t.hotelP.locations || []);
    setMultiActive($('#hotelAmenChips'), 'data-hotel-amen', t.hotelP.amenities || []);
  }

  _refreshBudget();
  const fi = $('#includeFlight'); if (fi) fi.checked = t.includeFlight !== false;
  const hi = $('#includeHotel');  if (hi) hi.checked = t.includeHotel !== false;
  _refreshAirlineMeta();
  _syncPressed();
}

/** 눌린 상태를 스크린 리더에도 알린다 (카드·칩·인기 도시). */
function _syncPressed() {
  $$('#createTripPage .chip, #createTripPage .concept-card, #createTripPage .choice-card, #destQuick button')
    .forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('is-active'))));
}

/* ============ Generation ============
 *
 * Each "slot" runs a Google Places Text Search via the backend proxy
 * (/api/places/search) — so the schedule shows *real* named places
 * (Tokyo Tower, Shibuya Sky, Tsukiji Market, …) with valid lat/lng/
 * place_id stamped directly onto each activity.  That means the map
 * page never has to re-resolve coords, the Routes API gets real
 * routable points, and the user sees Google-quality place names.
 *
 * If Places API isn't configured (no GOOGLE_MAPS_SERVER_KEY, or backend
 * down), we fall back to the legacy mock-name generator so the trip
 * flow keeps working offline.
 */

// Search queries per slot — chosen to match Google Places "type" semantics.
// Concept (가성비 / 프리미엄 / 힐링 …) and budget level bias the query.
const SLOT_QUERIES = {
  morning:   ['카페 브런치', '아침 산책 명소', '인기 베이커리', '전통 시장'],
  forenoon:  ['관광 명소', '박물관', '랜드마크', '미술관'],
  lunch:     ['점심 맛집', '인기 식당', '현지 추천 식당'],
  afternoon: ['카페', '쇼핑 거리', '전망 명소'],
  evening:   ['야경 명소', '전망대', '인기 거리'],
  dinner:    ['저녁 맛집', '인기 레스토랑', '바'],
  // Slot types that only some concepts use:
  activity:  ['액티비티 체험', '클래스 체험', '테마파크', '관광 투어'],
  spa:       ['스파', '온천', '마사지', '힐링 카페'],
  shopping:  ['쇼핑몰', '편집숍', '백화점', '아울렛'],
  premium:   ['미슐랭', '파인 다이닝', '고급 레스토랑'],
};
const CATEGORY_BY_SLOT = {
  morning: '식사', forenoon: '관광', lunch: '식사',
  afternoon: '쇼핑', evening: '관광', dinner: '식사',
  activity: '액티비티', spa: '액티비티', shopping: '쇼핑', premium: '식사',
};

/* ════════════════════════════════════════════════════════════════
 * 항공권 가격 시뮬레이션
 *   실제 OTA API (Amadeus / Skyscanner) 연동 전 단계 — 사용자 선택과
 *   도시·시즌·항공사 등을 기반으로 시각화 가능한 일관 가격을 산출.
 *   장래 백엔드에 /api/flights/price 엔드포인트가 생기면 fetch 로 교체.
 * ════════════════════════════════════════════════════════════════ */

// 도시 등급별 왕복 항공권 기본가 (원, 단일 성인 이코노미)
const _CITY_TIER_BASE_KRW = {
  high: 850000,  // 도쿄, 파리, 뉴욕, 런던, 시드니 등
  mid:  450000,  // 방콕, 하노이, 베이징, 발리 등
  low:  280000,  // 제주, 부산 등 국내·근거리
};

// 항공사별 가격 계수 (FSC=1.0 기준)
const _AIRLINE_MULT = {
  // 한국 FSC
  '대한항공': 1.10, '아시아나': 1.08,
  // 한국 LCC
  '제주항공': 0.65, '진에어': 0.62, '에어부산': 0.65, '티웨이': 0.60,
  '에어서울': 0.62, '이스타항공': 0.58, '에어프레미아': 0.78,
  // 일본
  'JAL': 1.15, 'ANA': 1.18, '피치': 0.55, '집에어': 0.58,
  // 동남아
  '에어아시아': 0.50, '비엣젯': 0.48, '베트남항공': 0.92, '타이항공': 0.95,
  '타이에어아시아': 0.52, '말레이시아항공': 0.90, '필리핀항공': 0.88,
  '세부퍼시픽': 0.55, '가루다인도네시아': 0.95, '스쿠트': 0.60, '젯스타': 0.62,
  '싱가포르': 1.25,
  // 중화권
  '캐세이퍼시픽': 1.20, '중화항공': 0.95, '에바항공': 1.00,
  '중국국제항공': 0.92, '중국동방항공': 0.88, '중국남방항공': 0.85,
  // 중동
  '에미레이트': 1.30, '카타르항공': 1.32, '에티하드': 1.20, '터키항공': 1.10,
  // 유럽
  '루프트한자': 1.20, '에어프랑스': 1.18, 'KLM': 1.18, '영국항공': 1.22,
  '핀에어': 1.10, '스위스국제항공': 1.20, '알이탈리아': 1.05,
  '라이언에어': 0.45, '이지젯': 0.50,
  // 북미
  '델타': 1.15, '유나이티드': 1.10, '아메리칸': 1.10, '에어캐나다': 1.08,
  '제트블루': 0.75, '사우스웨스트': 0.70, '하와이안항공': 1.05, '알래스카항공': 0.75,
  // 오세아니아
  '콴타스': 1.20, '에어뉴질랜드': 1.15, '버진오스트레일리아': 1.05,
  // 인도/기타
  '에어인디아': 0.92, '인디고': 0.55, '에티오피아항공': 0.95, '에어로플로트': 0.90,
};

// 시즌 가중 (월 → 배율). 7·8·12·1 성수, 4·5·9·10·11 준성수, 나머지 비수기
function _seasonFlightMult(startISO) {
  if (!startISO) return 1.0;
  const m = parseInt(String(startISO).split('-')[1], 10);
  if ([7, 8, 12, 1].includes(m)) return 1.45;
  if ([4, 5, 9, 10, 11].includes(m)) return 1.10;
  return 0.85;
}

function _cityTierKeyForFlight(t) {
  // origin 이 한국 내부면 국내·일본·동남아 가격 사용
  // 거리 추정: cityTier 토큰을 우선, 없으면 도시명 기반 휴리스틱
  if (t.cityTier === 'high') return 'high';
  if (t.cityTier === 'mid')  return 'mid';
  if (t.cityTier === 'low')  return 'low';
  return 'mid';
}

// 동행에 따른 기본 인원수 (가족/단체는 사용자 입력으로 덮어씀)
const _PEOPLE_COUNT = {
  solo: 1, friend: 2, couple: 2, family: 4, group: 6,
};
const _PEOPLE_MAX = 20;

const _COMPANION_DEFAULT = { solo: [1, 0], couple: [2, 0], friend: [2, 0], family: [2, 2], group: [6, 0] };

/** 예전 형식(동행 유형 + 가족/단체 인원)으로 저장된 여행도 성인·아동·객실로 맞춘다. */
function _ensurePeople(t) {
  if (Number.isFinite(t.adults)) return;
  const legacy = ((t.companion === 'family' || t.companion === 'group') && t.people)
    ? t.people : (_PEOPLE_COUNT[t.companion] || 1);
  t.adults = Math.max(1, Math.min(_PEOPLE_MAX, legacy));
  t.children = 0;
  t.rooms = Math.max(1, Math.ceil(t.adults / 2));
}
function _clampPeople(t, changed) {
  t.adults = Math.max(1, Math.min(_PEOPLE_MAX, t.adults || 1));
  t.children = Math.max(0, Math.min(_PEOPLE_MAX - t.adults, t.children || 0));
  const total = t.adults + t.children;
  if (changed === 'rooms') t._roomsTouched = true;
  else if (!t._roomsTouched) t.rooms = Math.ceil(total / 2);
  t.rooms = Math.max(1, Math.min(total, t.rooms || 1));
}

/** 실제 인원수 = 성인 + 아동. */
function _peopleCount(t) {
  _ensurePeople(t);
  return Math.max(1, (t.adults || 0) + (t.children || 0));
}
/** 객실 수 — 직접 고르지 않았으면 2인 1실. */
function _roomCount(t) {
  _ensurePeople(t);
  return Math.max(1, Math.min(_peopleCount(t), t.rooms || Math.ceil(_peopleCount(t) / 2)));
}

/** 인원·객실 숫자와 버튼 상태, 계산 기준 안내를 화면에 맞춘다. */
function _syncPeopleRow() {
  const t = appState.trip;
  _ensurePeople(t);
  _clampPeople(t, null);
  t.people = t.adults + t.children;
  const total = t.people;
  const put = (id, v) => { const o = document.getElementById(id); if (o) o.textContent = String(v); };
  put('adultsVal', t.adults); put('childrenVal', t.children); put('roomsVal', t.rooms);
  $$('#peopleBox [data-people-field]').forEach(b => {
    const f = b.dataset.peopleField; const down = Number(b.dataset.delta) < 0; const v = t[f] || 0;
    b.disabled = f === 'rooms' ? (down ? v <= 1 : v >= total)
      : (down ? v <= (f === 'adults' ? 1 : 0) : total >= _PEOPLE_MAX);
  });
  const s = document.getElementById('peopleSummary');
  if (s) {
    s.textContent = `총 ${total}명${t.children ? ` (성인 ${t.adults} · 아동 ${t.children})` : ''} · 객실 ${t.rooms}개. `
      + `${RIDE[_groundOf(t)?.mode || 'air'].label}·식비·입장료는 인원수로, 숙소는 객실 수로 계산해요.`
      + (t.children ? ' 아동 요금은 성인과 같게 어림해요.' : '');
  }
}

// 비행시간(분)별 1인 왕복 기본가 (피크가 아닌 평시)
function _flightBaseByDuration(durationMin) {
  if (durationMin < 60)   return 150000;    // 매우 가까운 국내선·근거리
  if (durationMin < 120)  return 280000;    // 일본 후쿠오카·삿포로 등
  if (durationMin < 180)  return 380000;    // 도쿄·오사카·중국 동부
  if (durationMin < 300)  return 580000;    // 동남아 단거리, 베트남
  if (durationMin < 420)  return 780000;    // 방콕·발리·필리핀
  if (durationMin < 600)  return 1100000;   // 호주·인도
  if (durationMin < 800)  return 1550000;   // 유럽
  if (durationMin < 1000) return 1850000;   // 미주 동부·중부
  return 2100000;                            // 초장거리
}

// 최소 가격 floor (LCC 비수기 transit 도 이 아래로는 안 내려감)
function _flightMinFloor(durationMin) {
  if (durationMin < 60)   return 80000;
  if (durationMin < 120)  return 150000;
  if (durationMin < 180)  return 220000;
  if (durationMin < 300)  return 350000;
  if (durationMin < 420)  return 480000;
  if (durationMin < 600)  return 700000;
  if (durationMin < 800)  return 850000;
  if (durationMin < 1000) return 1050000;
  return 1200000;
}

/**
 * 왕복 항공권 총 가격 (인원수 반영, 원화).
 * 도착·출발에 절반씩 배분되어 일정에 들어감.
 */
// 도시 key → 대표 공항 IATA (SerpApi Google Flights 연동용).
// 없는 도시는 실시간 미조회 → 추정 폴백.
const _CITY_IATA = {
  // 한국
  seoul:'ICN', busan:'PUS', jeju:'CJU', yeosu:'RSU',
  // 일본
  tokyo:'HND', osaka:'KIX', kyoto:'KIX', nara:'KIX', kobe:'KIX', fukuoka:'FUK',
  sapporo:'CTS', nagoya:'NGO', yokohama:'HND', okinawa:'OKA', hiroshima:'HIJ',
  takamatsu:'TAK', kagoshima:'KOJ', kumamoto:'KMJ', sendai:'SDJ', hakodate:'HKD',
  // 중화권 · 동남아
  beijing:'PEK', shanghai:'PVG', chengdu:'CTU', hongkong:'HKG', taipei:'TPE',
  kaohsiung:'KHH', macau:'MFM', bangkok:'BKK', phuket:'HKT', chiangmai:'CNX',
  hanoi:'HAN', danang:'DAD', hochiminh:'SGN', singapore:'SIN', kualalumpur:'KUL',
  bali:'DPS', jakarta:'CGK', manila:'MNL', cebu:'CEB', siemreap:'REP', phnompenh:'PNH',
  vientiane:'VTE', yangon:'RGN', delhi:'DEL', mumbai:'BOM',
  // 유럽
  paris:'CDG', london:'LHR', rome:'FCO', milan:'MXP', venice:'VCE', barcelona:'BCN',
  madrid:'MAD', lisbon:'LIS', amsterdam:'AMS', brussels:'BRU', zurich:'ZRH',
  berlin:'BER', munich:'MUC', frankfurt:'FRA', vienna:'VIE', prague:'PRG',
  budapest:'BUD', warsaw:'WAW', stockholm:'ARN', copenhagen:'CPH', oslo:'OSL',
  helsinki:'HEL', reykjavik:'KEF', dublin:'DUB', athens:'ATH', istanbul:'IST',
  // 미주 · 오세아니아 · 중동
  newyork:'JFK', losangeles:'LAX', sanfrancisco:'SFO', lasvegas:'LAS', chicago:'ORD',
  toronto:'YYZ', vancouver:'YVR', mexicocity:'MEX', cancun:'CUN', saopaulo:'GRU',
  sydney:'SYD', melbourne:'MEL', auckland:'AKL', guam:'GUM', saipan:'SPN',
  dubai:'DXB', doha:'DOH', cairo:'CAI', honolulu:'HNL', bangkok2:'DMK',
};

// 공항이 여러 개인 도시 → [IATA, 한글명] 목록 (도착 도시 검색 시 선택지로 노출).
// 첫 번째가 대표 공항. 여기 없는 도시는 _CITY_IATA 의 단일 공항을 사용.
const _CITY_AIRPORTS = {
  seoul:    [['ICN', '인천'], ['GMP', '김포']],
  tokyo:    [['NRT', '나리타'], ['HND', '하네다']],
  osaka:    [['KIX', '간사이'], ['ITM', '이타미']],
  bangkok:  [['BKK', '수완나품'], ['DMK', '돈므앙']],
  shanghai: [['PVG', '푸둥'], ['SHA', '훙차오']],
  beijing:  [['PEK', '서우두'], ['PKX', '다싱']],
  taipei:   [['TPE', '타오위안'], ['TSA', '쑹산']],
  paris:    [['CDG', '샤를드골'], ['ORY', '오를리']],
  london:   [['LHR', '히드로'], ['LGW', '개트윅']],
  milan:    [['MXP', '말펜사'], ['LIN', '리나테']],
  newyork:  [['JFK', '존 F. 케네디'], ['EWR', '뉴어크'], ['LGA', '라과디아']],
};

/** 기차·버스로 가는 구간(같은 나라 안에서 육로가 자연스러운 도시 쌍). 항공으로 갈 여행이면 null.
 *  공항을 직접 고른 여행은 두 도시 모두 공항이 있을 때만 비행기로 간다. */
function _groundOf(t) {
  if (!t || t._air) return null;
  if ((t.departureAirport || t.arrivalAirport) && (t.departureAirport || _CITY_IATA[t.origin]) && (t.arrivalAirport || _CITY_IATA[t.city])) return null;
  return groundRoute(t);
}
const _hm = (min) => [Math.floor(min / 60) ? `${Math.floor(min / 60)}시간` : '', min % 60 ? `${min % 60}분` : ''].filter(Boolean).join(' ');

/** 오가는 교통이 기차·버스면 예산 단계의 항공 글과 항공편 선택을 그에 맞춘다. */
function _syncRideTexts() {
  const r = _groundOf(appState.trip);
  const W = RIDE[r?.mode || 'air'];
  const name = $('#includeFlightName'); if (name) name.textContent = W.ticket;
  const opt = $('#flightOptions'); if (opt) opt.hidden = !!r;
  const desc = { '낮음': `${r ? W.label : '저가 항공'}·2성급·간단한 식사`, '보통': `${r ? W.label : '일반 항공'}·3성급·현지 평균`, '높음': `${r ? W.label : '대형 항공사'}·4성급·좋은 식당` };
  $$('[data-budget-level] .bm-desc').forEach(x => { const v = desc[x.closest('[data-budget-level]').dataset.budgetLevel]; if (v) x.textContent = v; });
}

/** 왕복 교통비(전체 인원) — 기차·버스는 편도 운임 × 2 × 인원, 아니면 항공 추정. */
function _calcFlightPrice(t) {
  const ground = _groundOf(t);
  if (ground) return ground.fare * 2 * _peopleCount(t);
  const f = t.flight || {};
  // 비행 시간 — 데이터 없으면 도시 등급에서 추정
  let durationMin = _CITY_FLIGHT_DURATION_MIN[t.cityName];
  if (!durationMin) {
    durationMin = (t.cityTier === 'high' ? 420 : t.cityTier === 'mid' ? 270 : 90);
  }
  const base = _flightBaseByDuration(durationMin);
  const minFloor = _flightMinFloor(durationMin);
  const season = _seasonFlightMult(t.startDate);

  // 노선 가중
  const routeMult = f.route === 'transit' ? 0.78 : (f.route === 'direct' ? 1.00 : 0.92);

  // 항공사 평균 multiplier
  let airlineMult;
  if (f.airlines && f.airlines.length) {
    const sum = f.airlines.reduce((a, n) => a + (_AIRLINE_MULT[n] || 1.0), 0);
    airlineMult = sum / f.airlines.length;
  } else if (f.classType === 'lcc') airlineMult = 0.60;
  else if (f.classType === 'fsc')   airlineMult = 1.10;
  else                              airlineMult = 0.85;

  // 1인 왕복 가격 (최소 floor 보장)
  const perPersonRaw = base * season * routeMult * airlineMult;
  const perPerson = Math.max(minFloor, perPersonRaw);

  // 인원수 곱 (가족/단체는 사용자 입력 반영)
  const people = _peopleCount(t);
  // 단체는 그룹 할인 -5%
  const groupDisc = t.companion === 'group' ? 0.95 : 1.0;
  const total = perPerson * people * groupDisc;

  return Math.round(total / 100) * 100;   // 100원 단위 round
}

// ── 호텔 1박 추정 가격 (KRW) ──
// 도시 등급별 3성급 기본 → 사용자 선택 유형/편의시설로 가중
const _HOTEL_TIER_BASE_KRW = { high: 180000, mid: 80000, low: 50000 };

// 유형별 multiplier (3성=1.0 기준)
const _HOTEL_TYPE_MULT = {
  luxury:   2.80,   // 5성급
  upscale:  1.80,   // 4성급
  midscale: 1.00,   // 3성급 (기본)
  budget:   0.60,   // 2성급·이코노미
  boutique: 1.70,   // 부티크·디자인
  resort:   2.20,   // 리조트
  ryokan:   1.50,   // 료칸·전통숙
  bnb:      0.70,   // B&B·민박
  hostel:   0.25,   // 호스텔
  apt:      0.85,   // 아파트·에어비앤비
  capsule:  0.30,   // 캡슐
};

function _calcHotelPerNight(t) {
  const tier = (t.cityTier === 'high' || t.cityTier === 'mid' || t.cityTier === 'low')
    ? t.cityTier : 'mid';
  const base = _HOTEL_TIER_BASE_KRW[tier];
  const h = t.hotelP || {};
  // 선택된 유형 평균값 (없으면 1.0)
  let typeMult = 1.0;
  if (h.types && h.types.length) {
    const sum = h.types.reduce((a, k) => a + (_HOTEL_TYPE_MULT[k] || 1.0), 0);
    typeMult = sum / h.types.length;
  }
  // 편의시설 1개당 +5%, 최대 +30%
  const amenMult = 1 + Math.min(0.30, (h.amenities?.length || 0) * 0.05);
  // 위치 우선순위 — 시내중심·역근처는 +10% 평균
  let locMult = 1.0;
  if (h.locations && h.locations.length) {
    const premiums = (h.locations.includes('downtown') ? 0.10 : 0)
                   + (h.locations.includes('station')  ? 0.05 : 0)
                   + (h.locations.includes('beach')    ? 0.08 : 0);
    locMult = 1 + Math.min(0.20, premiums);
  }
  return Math.round(base * typeMult * amenMult * locMult / 1000) * 1000;   // 1000원 단위
}

// ── 항공사 IATA 코드 매핑 ──
const _AIRLINE_CODE = {
  '대한항공': 'KE', '아시아나': 'OZ', '제주항공': '7C', '진에어': 'LJ',
  '에어부산': 'BX', '티웨이': 'TW', '에어서울': 'RS', '이스타항공': 'ZE',
  '에어프레미아': 'YP',
  'JAL': 'JL', 'ANA': 'NH', '피치': 'MM', '집에어': 'ZG',
  '에어아시아': 'AK', '비엣젯': 'VJ', '베트남항공': 'VN', '타이항공': 'TG',
  '타이에어아시아': 'FD', '말레이시아항공': 'MH', '필리핀항공': 'PR',
  '세부퍼시픽': '5J', '가루다인도네시아': 'GA', '스쿠트': 'TR', '젯스타': 'JQ',
  '싱가포르': 'SQ',
  '캐세이퍼시픽': 'CX', '중화항공': 'CI', '에바항공': 'BR',
  '중국국제항공': 'CA', '중국동방항공': 'MU', '중국남방항공': 'CZ',
  '에미레이트': 'EK', '카타르항공': 'QR', '에티하드': 'EY', '터키항공': 'TK',
  '루프트한자': 'LH', '에어프랑스': 'AF', 'KLM': 'KL', '영국항공': 'BA',
  '핀에어': 'AY', '스위스국제항공': 'LX', '알이탈리아': 'AZ',
  '라이언에어': 'FR', '이지젯': 'U2',
  '델타': 'DL', '유나이티드': 'UA', '아메리칸': 'AA', '에어캐나다': 'AC',
  '제트블루': 'B6', '사우스웨스트': 'WN', '하와이안항공': 'HA', '알래스카항공': 'AS',
  '콴타스': 'QF', '에어뉴질랜드': 'NZ', '버진오스트레일리아': 'VA',
  '에어인디아': 'AI', '인디고': '6E', '에티오피아항공': 'ET', '에어로플로트': 'SU',
};

// ── 도시별 인천 출발 비행시간 (분) ──
const _CITY_FLIGHT_DURATION_MIN = {
  // 일본 (1.5~3시간)
  '도쿄': 145, '오사카': 110, '교토': 115, '나고야': 120, '후쿠오카': 90,
  '삿포로': 155, '나하': 145, '오키나와': 145, '히로시마': 100,
  // 중국 (1.5~4시간)
  '베이징': 120, '상하이': 110, '광저우': 220, '청두': 240, '시안': 195,
  '항저우': 130, '선전': 220, '쑤저우': 115, '하얼빈': 130,
  // 동남아 (4~7시간)
  '방콕': 350, '하노이': 270, '호치민': 320, '싱가포르': 390, '쿠알라룸푸르': 360,
  '발리': 430, '마닐라': 240, '세부': 250, '푸켓': 380, '치앙마이': 360,
  '호이안': 310, '나트랑': 300, '코타키나발루': 320,
  // 대만/홍콩
  '타이베이': 150, '홍콩': 230, '마카오': 230, '가오슝': 170,
  // 미주 (10~14시간)
  '뉴욕': 800, '로스앤젤레스': 650, '샌프란시스코': 620, '시애틀': 580,
  '시카고': 760, '라스베이거스': 700, '호놀룰루': 540, '토론토': 800,
  '밴쿠버': 580, '보스턴': 800, '워싱턴DC': 800,
  // 유럽 (10~12시간)
  '파리': 720, '런던': 760, '로마': 720, '암스테르담': 720,
  '베를린': 720, '뮌헨': 720, '바르셀로나': 740, '마드리드': 750,
  '프라하': 720, '비엔나': 700, '리스본': 760, '취리히': 720,
  // 오세아니아 (10~11시간)
  '시드니': 620, '멜버른': 630, '오클랜드': 700, '괌': 280,
  // 중동/인도
  '두바이': 580, '도하': 640, '뭄바이': 530, '델리': 480, '이스탄불': 720,
};

/** 항공편 정보 생성 — 결정적 (도시+항공사+날짜 기반). */
/** 실시간 항공편이 없을 때 쓰는 예상 항공 정보.
 *  도착 항목은 카드 시각이 '현지 도착 시각', 출발 항목은 '출발 시각'이 되도록 계산한다.
 *  지어낸 편명은 쓰지 않는다(실제 편명처럼 보이면 안 됨). */
function _flightMinutes(t) {
  const known = _CITY_FLIGHT_DURATION_MIN[t.cityName]
    || (t.originCountry && t.originCountry !== t.country ? _CITY_FLIGHT_DURATION_MIN[t.originName] : null);   // 비행 시간표는 서울 기준 — 돌아오는 방향도 같다
  return (known || (t.cityTier === 'high' ? 420 : t.cityTier === 'mid' ? 270 : 90)) + ((t.flight || {}).route === 'transit' ? 120 : 0);
}
const _offCache = new Map();
/** 도착지 시차 − 출발지 시차(분) */
function _flightOffset(t) {
  const key = [t.cityName, t.country, t.originName, t.originCountry, t.startDate].join('|');
  if (!_offCache.has(key)) {
    const dest = utcOffsetMin(timeZoneFor(t.cityName, t.country), t.startDate) ?? 0;
    const from = utcOffsetMin(timeZoneFor(t.originName || '서울', t.originCountry || '대한민국'), t.startDate) ?? 0;
    _offCache.set(key, dest - from);
  }
  return _offCache.get(key);
}
/** 예상 항공 시각 — 시각은 모두 여행지 현지.
 *  가는 편: 여행 첫날 출발지 08:00 이후에 떠난다(전날 밤 출발 금지). 자정을 넘겨 도착하면 arrDay = 1.
 *  오는 편: 19:30 출발, 그날 안에 돌아올 수 있으면 더 이른 시각. */
function _plannedFlights(t) {
  const ground = _groundOf(t);
  if (ground) {      // 기차·버스 — 아침에 나서고, 밤 10시 반까지 돌아온다
    const dur = ground.minutes;
    const arr = Math.max(timeToMin(FIRST_DAY_ARRIVAL), 8 * 60 + dur);
    return { dur, off: 0, arrDay: 0, arr, back: Math.min(19 * 60 + 30, Math.floor((22 * 60 + 30 - dur) / 30) * 30), live: false, ground, ride: ground.mode };
  }
  const dur = _flightMinutes(t), off = _flightOffset(t);
  const arrAbs = Math.max(timeToMin(FIRST_DAY_ARRIVAL), 8 * 60 + dur + off);
  let back = 19 * 60 + 30;
  if (back + dur - off >= 24 * 60) { const x = Math.floor((23 * 60 + 30 - dur + off) / 30) * 30; if (x >= 14 * 60 && x < back) back = x; }
  return { dur, off, arrDay: arrAbs >= 24 * 60 ? 1 : 0, arr: arrAbs % (24 * 60), back, live: false };
}
/** 하루에 들어갈 자리 [시각, 종류, 머무는 시간] — 예산 추정과 일정 생성이 같이 쓴다. */
function _daySlots(t, di, totalDays, fl, localTrip) {
  const base = _slotTimesFor(t);
  const g = { country: t.country, originCountry: t.originCountry, ride: fl.ride };
  const access = fl.ride ? STATION_MIN : 45;       // 공항·역 ↔ 시내
  let from = 0, until = 24 * 60;
  if (!localTrip) {
    const arrivalDay = totalDays > 1 ? fl.arrDay : 0;
    if (di < arrivalDay) return [];
    if (di === arrivalDay) from = fl.arr + landingMinutes(g) + access + (totalDays > 1 ? 35 : 0);      // 입국 + 공항→시내 + 짐 맡기기
    if (di === totalDays - 1) until = fl.back - beforeFlight(g) - access - (totalDays > 1 ? 35 : 0);   // 짐 찾기 + 시내→공항 + 탑승 전
  }
  const kept = [];
  base.forEach(([time, slot], i) => {
    let m = timeToMin(time);
    const next = base[i + 1] ? timeToMin(base[i + 1][0]) : 24 * 60;
    if (m < from) { if (from + 45 + 20 > next || from - m > 75) return; m = Math.ceil(from / 5) * 5; }   // 조금 늦추면 들어가는 자리는 살린다
    if (m + 45 > until + 10) return;
    kept.push([m, slot]);
  });
  return kept.map(([m, slot], i) => {
    const limit = kept[i + 1] ? kept[i + 1][0] - m - 20 : until - m;
    const stay = Math.max(45, Math.min(dwellMinutes(CATEGORY_BY_SLOT[slot] || '관광'), Math.floor(limit / 5) * 5));
    return [minToTime(m), slot, stay];
  });
}

/** 항공편 한 줄 설명. 출발은 출발지, 도착은 도착지 현지 시각. fl.live 면 조회한 시각이다. */
function _flightLine(t, isArrival, fl) {
  const f = t.flight || {};
  const airline = (f.airlines && f.airlines.length) ? f.airlines[0] : (f.classType === 'lcc' ? '제주항공' : '대한항공');
  const dep = isArrival ? (fl.live ? fl.dep : fl.arr + fl.arrDay * 1440 - fl.dur - fl.off) : fl.back;
  const arr = isArrival ? fl.arr + fl.arrDay * 1440 : dep + fl.dur - fl.off;
  const fmt = (m) => minToTime(((m % 1440) + 1440) % 1440);
  const day = (m) => m < 0 ? -1 : Math.floor(m / 1440);
  const note = (m) => m < 0 ? ' (전날)' : m >= 1440 ? ' (다음 날)' : '';
  const route = f.route === 'transit' ? '경유' : f.route === 'direct' ? '직항' : '';
  if (fl.ground) {
    const r = fl.ground, [from, to] = isArrival ? [r.from, r.to] : [r.to, r.from];
    return { airline: r.label, depTime: fmt(dep), arrTime: fmt(arr), depDayOffset: day(dep), arrDayOffset: day(arr),
      head: [RIDE[r.mode].sample, r.label], tail: [`${from} 출발 ${fmt(dep)} → ${to} 도착 ${fmt(arr)} (예상)`, _hm(fl.dur)] };
  }
  const live = isArrival && fl.live;
  return {
    airline, depTime: fmt(dep), arrTime: fmt(arr), depDayOffset: day(dep), arrDayOffset: day(arr),
    head: ['예시 항공편', airline, route].filter(Boolean),
    tail: [`출발 ${fmt(dep)}${note(dep)} → 도착 ${fmt(arr)}${note(arr)} ${live ? '(조회한 시각, 각 현지 시각)' : '(예상, 각 현지 시각)'}`,
      `${Math.floor(fl.dur / 60)}시간${fl.dur % 60 ? ' ' + (fl.dur % 60) + '분' : ''}`],
  };
}

function _strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// ── Concept multipliers — make Step 3 selection actually change cost & pace ──
const CONCEPT_MULT = {
  '가성비':   0.65,    // budget-conscious, ~35% lower than baseline
  '균형':     1.00,    // baseline
  '프리미엄': 1.85,    // luxury — ~85% more
  '효율':     1.10,    // pay a bit more for skip-the-line, optimised tours
  '힐링':     0.95,    // moderate spending but fewer activities
  '액티비티': 1.25,    // experiences and admissions cost more
};

// ── Per-concept slot lists — pace and slot mix differ by concept ──
const SLOT_TIMES_DEFAULT = [
  ['09:00','morning'],['11:00','forenoon'],['13:00','lunch'],
  ['15:30','afternoon'],['19:00','evening'],['20:30','dinner'],
];
const CONCEPT_SLOTS = {
  // 6-stop budget pacing — adds free attractions & evening stroll
  '가성비':   [
    ['09:00','morning'],
    ['11:00','forenoon'],
    ['13:00','lunch'],
    ['15:30','afternoon'],
    ['18:30','evening'],
    ['20:00','dinner'],
  ],
  '균형':     SLOT_TIMES_DEFAULT,                                    // 6 slots
  // 6-stop slow premium pacing — late starts, fine dining, leisurely shopping
  '프리미엄': [
    ['10:30','forenoon'],
    ['12:30','premium'],
    ['15:00','afternoon'],
    ['17:00','shopping'],
    ['19:30','premium'],
    ['21:30','evening'],
  ],
  // 7 packed slots, early start — maximise sightseeing per day
  '효율':     [
    ['08:00','morning'],['10:00','forenoon'],['12:00','lunch'],
    ['14:00','afternoon'],['16:00','forenoon'],['18:00','evening'],['20:00','dinner'],
  ],
  // 6 relaxed slots, spa-heavy, late start
  '힐링':     [
    ['10:30','morning'],
    ['12:00','forenoon'],
    ['13:30','lunch'],
    ['15:30','spa'],
    ['17:30','afternoon'],
    ['19:30','dinner'],
  ],
  // 6 active slots, two activity blocks
  '액티비티': [
    ['08:30','morning'],
    ['10:30','activity'],
    ['13:00','lunch'],
    ['15:00','activity'],
    ['17:30','afternoon'],
    ['19:30','dinner'],
  ],
};

// ─── 스타일 오버라이드: "여유로운 일정" / "빽빽한 일정" ──────────────
// CATEGORY_BY_SLOT 기준 식사(=morning/lunch/dinner/premium) 외의 슬롯 개수로 카운트.
//
//   여유로운 일정 — 식사 제외 3곳 (총 6슬롯, 푹 쉬는 페이스)
//   빽빽한 일정 — 식사 제외 7곳 (총 10슬롯, 풀로 채우는 페이스)
const RELAXED_SLOTS = [
  ['11:00','morning'],     // 늦은 아침 · 브런치 (식사)
  ['14:00','afternoon'],   // 오후 활동 1 (비식사)
  ['17:00','evening'],     // 늦은 오후 · 야경 (비식사)
  ['19:30','dinner'],      // 저녁 (식사)
];
const PACKED_SLOTS = [
  ['08:00','morning'],     // 조식
  ['09:30','forenoon'],    // 관광 1
  ['11:00','afternoon'],   // 쇼핑 2
  ['12:30','lunch'],       // 점심
  ['14:00','forenoon'],    // 관광 3
  ['15:30','afternoon'],   // 관광 4
  ['17:00','evening'],     // 관광 5
  ['19:00','dinner'],      // 저녁
  ['20:30','evening'],     // 야경 6
  ['22:00','evening'],     // 관광 7
];
const BUDGET_HINT = {              // appended to the search query
  '낮음': '가성비',
  '보통': '',
  '높음': '고급',
};
const CONCEPT_HINT = {             // strong-bias the picks by trip concept
  '가성비':   '가성비',
  '프리미엄': '고급',
  '힐링':     '조용한',
  '효율':     '인기',
  '액티비티': '체험',
  '균형':     '',
};

const SLOT_TIMES = [
  ['09:00','morning'],['11:00','forenoon'],['13:00','lunch'],
  ['15:30','afternoon'],['19:00','evening'],['20:30','dinner'],
];

/* ════════════════════════════════════════════════════════════════
 * 예산 계획 — 입력 예산을 항공·숙소·현지 지출 선택에 반영한다.
 *   금액은 모두 원(KRW)이다. 일정 항목의 비용도 같은 공식으로 만들기
 *   때문에, 여기서 고른 계획과 결과 화면 합계가 같은 기준을 쓴다.
 * ════════════════════════════════════════════════════════════════ */
const HOTEL_TIER_LABEL = {
  luxury: '5성급 호텔', upscale: '4성급 호텔', midscale: '3성급 호텔', budget: '2성급·비즈니스 호텔', hostel: '호스텔·게스트하우스',
};
const LEVEL_LABEL = { '낮음': '아껴 쓰는', '보통': '보통', '높음': '넉넉한' };
// 1인 하루 현지 교통비(지하철·버스 위주)
const LOCAL_TRANSPORT_PER_DAY = { high: 15000, mid: 10000, low: 6000 };
// 편안한 조합부터 차례로 시도해 예산 안에 들어오는 첫 조합을 고른다.
const PLAN_LADDER = [
  ['upscale', '높음'], ['upscale', '보통'], ['midscale', '보통'], ['midscale', '낮음'],
  ['budget', '보통'], ['budget', '낮음'], ['hostel', '낮음'],
];
// 사용자가 숙소 유형을 직접 고른 경우엔 숙소는 그대로 두고 지출 수준만 조정한다.
const LEVEL_LADDER = [[null, '높음'], [null, '보통'], [null, '낮음']];

function _slotTimesFor(t) {
  const styles = Array.isArray(t.styles) ? t.styles : [];
  if ((t.needs || []).includes('lessWalk') && !styles.includes('빽빽한 일정')) return RELAXED_SLOTS;   // 걷기 적게 → 하루 장소 수를 줄인다
  if (styles.includes('빽빽한 일정')) return PACKED_SLOTS;
  if (styles.includes('여유로운 일정')) return RELAXED_SLOTS;
  return CONCEPT_SLOTS[t.concept] || SLOT_TIMES_DEFAULT;
}

/** 출발·도착이 같은 도시면 현지 여행 — 항공권이 필요 없다. */
function _isLocalTrip(t) {
  return !!(t.city && t.origin && t.city === t.origin);
}

function _localTransportPerDay(t) {
  return LOCAL_TRANSPORT_PER_DAY[t.cityTier] || LOCAL_TRANSPORT_PER_DAY.mid;
}

/** 1실 1박 추정가. typeKey 가 없으면 사용자가 고른 숙소 유형을 쓴다. */
function _hotelNightFor(t, typeKey) {
  if (!typeKey) return _calcHotelPerNight(t);
  return _calcHotelPerNight({ ...t, hotelP: { ...(t.hotelP || {}), types: [typeKey] } });
}

/** 한 조합의 예상 비용. 항목 이름은 결과 화면의 비용 행과 같다. */
function _estimatePlan(t, opts = {}) {
  if (opts.air) t = { ...t, _air: true };          // 예전에 항공으로 만든 일정 — 항공 기준으로 비교한다
  const days = Math.max(1, opts.days ?? (t.days || 1));
  const people = _peopleCount(t);
  const rooms = _roomCount(t);
  const localTrip = _isLocalTrip(t);
  const fl = _plannedFlights(t);
  const nights = Math.max(0, days - 1 - (localTrip ? 0 : fl.arrDay));
  const level = opts.level || '보통';
  const includeFlight = opts.includeFlight !== false && !localTrip && !!t.cityName;
  const includeHotel = opts.includeHotel !== false && nights > 0;
  const flightTrip = opts.flightClass ? { ...t, flight: { ...(t.flight || {}), classType: opts.flightClass, airlines: [] } } : t;
  const flight = includeFlight ? _calcFlightPrice(flightTrip) : 0;
  const perRoomNight = includeHotel ? _hotelNightFor(t, opts.hotelType) : 0;
  const hotel = perRoomNight * rooms * nights;
  let food = 0, entry = 0, shopping = 0;
  for (let di = 0; di < days; di++) _daySlots(t, di, days, fl, localTrip).forEach(([, slot]) => {
    const cat = CATEGORY_BY_SLOT[slot] || '관광';
    const v = _costFor(cat, level, t.concept) * people;
    if (cat === '식사' || cat === '카페') food += v;
    else if (cat === '쇼핑') shopping += v;
    else entry += v;
  });
  const transport = _localTransportPerDay(t) * people * (days - (localTrip || days < 2 ? 0 : fl.arrDay));
  const local = food + entry + shopping + transport;
  return {
    hotelType: opts.hotelType ?? null, level, days, people, rooms, nights,
    includeFlight, includeHotel, flight, perRoomNight, hotel,
    food, entry, shopping, transport, local, total: flight + hotel + local, ride: fl.ride || 'air',
  };
}

/** 입력 예산 안에 들어오는 가장 편안한 조합을 고른다. 없으면 가장 저렴한 조합 + 초과 표시. */
function _fitPlan(t, lock = null) {
  const budget = (Number(t.budget) || 0) * 10000;
  const base = { includeFlight: t.includeFlight !== false, includeHotel: t.includeHotel !== false };
  const userChoseHotel = !!(t.hotelP?.types?.length);
  // 예산 대안을 적용할 때는 화면에서 본 조합 그대로 만든다(다시 고르면 예상 금액과 달라진다).
  if (lock) {
    const p = _estimatePlan(t, { ...base, hotelType: userChoseHotel ? null : lock.hotelType, level: lock.level });
    return { ...p, budget, fits: p.total <= budget, userChoseHotel };
  }
  const ladder = userChoseHotel ? LEVEL_LADDER : PLAN_LADDER;
  let chosen = null;
  for (const [hotelType, level] of ladder) {
    const p = _estimatePlan(t, { ...base, hotelType, level });
    if (p.total <= budget) { chosen = p; break; }
  }
  const fits = !!chosen;
  if (!chosen) {
    const [hotelType, level] = ladder[ladder.length - 1];
    chosen = _estimatePlan(t, { ...base, hotelType, level });
  }
  return { ...chosen, budget, fits, userChoseHotel };
}

/** 같은 나라 안에서 물가 등급이 더 낮은 도시 하나. */
function _cheaperNearby(t) {
  const rank = { high: 3, mid: 2, low: 1 };
  const mine = rank[t.cityTier] || 2;
  const pool = CITIES.filter(c => c.country === t.country && c.key !== t.city && (rank[c.tier] || 2) < mine);
  // 기차·버스 여행이면 그대로 기차·버스로 갈 수 있는 도시를 먼저 본다(부산 대신 비행기로 가는 제주를 권하지 않게).
  const byLand = _groundOf(t) ? pool.find(c => c.key !== t.origin && groundRoute({ origin: t.origin, city: c.key })) : null;
  return byLand || pool.find(c => _CITY_FLIGHT_DURATION_MIN[c.name]) || pool[0] || null;
}

/* ============ 예산 대안 (결과 화면) ============
 * 금액은 항목별로 '지금 일정의 실제 금액 × (바뀐 조건 추정 ÷ 지금 조건 추정)' — 따로 계산하는 항목은 0.
 * 그래서 실시간 요금·직접 고친 금액이 있는 일정에도 같은 기준으로 맞는다.
 * 대안마다 바뀌는 조건 · 포함/제외 항목 · 새 총액 · 절감액 · 남은 초과액을 함께 돌려준다.
 * 항공·숙소 요금만 바뀌는 대안(inPlace)은 장소를 그대로 두고 금액만 바꾼다. */
const _ALT_STEPS = {
  lcc:     { label: '저비용 항공으로', short: '저비용 항공', detail: '대형 항공사 대신 LCC 추정 요금 기준', opts: { flightClass: 'lcc' }, apply: { flightClass: 'lcc' } },
  hostel:  { label: '숙소를 호스텔로', short: '호스텔', detail: '게스트하우스·호스텔 기준', opts: { hotelType: 'hostel' }, apply: { hotelTypes: ['hostel'] } },
  save:    { label: '현지 지출 아끼기', short: '현지 지출 절약', detail: '식사·입장 등을 저렴한 곳 위주로', opts: { level: '낮음' }, apply: { level: '낮음' } },
  shorter: { label: '하루 줄이기', short: '', detail: '돌아오는 날을 하루 앞당겨요', opts: null, apply: null },
  noFlight:{ label: '항공권은 따로 계산', short: '항공비 별도', detail: '이미 샀거나 마일리지 등으로 따로 예약할 때', opts: { includeFlight: false }, apply: { includeFlight: false } },
  noHotel: { label: '숙소는 따로 계산', short: '숙소비 별도', detail: '지인 집 등 숙소가 따로 있을 때', opts: { includeHotel: false }, apply: { includeHotel: false } },
};
const _IN_PLACE = new Set(['lcc', 'noFlight', 'noHotel']);

export function budgetAlternativesFor(g, actualTotal) {
  if (!g?.days?.length) return [];
  const actual = costBreakdown(g);
  const total = Number.isFinite(actualTotal) ? actualTotal : actual.total;
  const budget = Number(g.budget) || 0;
  if (!(budget > 0) || total <= budget) return [];
  const t = JSON.parse(JSON.stringify(appState.trip || {}));
  _syncTripFromGenerated(g, t);
  if (!t.cityName) return [];
  const scope = costScope(g, actual);
  const bp = g.budgetPlan || {};
  if ('departureAirport' in g) { t.departureAirport = g.departureAirport; t.arrivalAirport = g.arrivalAirport; }
  const ride = rideOf(g);
  const wasAir = ride === 'air' && !!_groundOf(t);  // 예전에 항공으로 만든 육로 구간 — 다시 만들면 기차·버스가 된다
  const base = { air: ride === 'air', hotelType: bp.hotelType || null, level: bp.level || '보통',
    includeFlight: !['excluded', 'none'].includes(scope.status.flight), includeHotel: !['excluded', 'none'].includes(scope.status.hotel) };
  const baseEst = _estimatePlan(t, base);
  const days = baseEst.days;
  const live = { flight: scope.status.flight === 'live', hotel: scope.status.hotel === 'live' };
  const usable = (k) => k === 'shorter' ? days > 1
    : k === 'lcc' ? ride === 'air' && !live.flight && t.flight?.classType !== 'lcc' && actual.flight > 0      // 실시간 요금은 이미 가장 싼 편이라 LCC 추정으로 바꾸지 않는다
    : k === 'hostel' ? actual.hotel > 0 && base.hotelType !== 'hostel' && !(t.hotelP?.types || []).includes('hostel')
    : k === 'save' ? base.level !== '낮음'
    : k === 'noFlight' ? actual.flight > 0
    : k === 'noHotel' ? actual.hotel > 0 : false;
  const stepOpts = (k) => k === 'shorter' ? { days: days - 1 } : _ALT_STEPS[k].opts;
  const stepApply = (k) => k === 'shorter' ? { days: days - 1 } : _ALT_STEPS[k].apply;
  const stepLabel = (k) => k === 'shorter' ? `${_durationLabel(days - 1)}로 줄이기` : k === 'noFlight' ? `${josa(RIDE[ride].ticket, '은', '는')} 따로 계산` : _ALT_STEPS[k].label;
  const stepShort = (k) => k === 'shorter' ? _durationLabel(days - 1) : k === 'noFlight' ? `${RIDE[ride].fee} 별도` : _ALT_STEPS[k].short;
  const optsOf = (ks) => Object.assign({ ...base }, ...ks.map(stepOpts));
  const rebuilds = (ks, tt) => tt !== t || !ks.every(k => _IN_PLACE.has(k));
  const estimate = (ks, tt = t) => _estimatePlan(tt, { ...optsOf(ks), ...(rebuilds(ks, tt) ? { air: false } : {}) });   // 다시 만드는 대안은 새 기준(육로면 기차·버스)
  const project = (ks, tt = t) => projectCost(actual, baseEst, estimate(ks, tt), { rebuilt: rebuilds(ks, tt) });
  const mk = (key, label, detail, after, apply, ks, summary, tt = t) => {
    const to = estimate(ks.filter(k => _ALT_STEPS[k]), tt).ride;
    const turns = to !== ride;                      // 다시 만들면 이동 수단이 바뀌는 대안
    const excluded = ['flight', 'hotel'].filter(k => scope.excluded.includes(k) || (k === 'flight' ? ks.includes('noFlight') : ks.includes('noHotel')));
    const o = optsOf(ks.filter(k => _ALT_STEPS[k]));
    return {
      key, label, detail: turns ? `${detail} · 오가는 길은 ${RIDE[to].label} 기준으로 바뀌어요` : detail, ride: to,
      rideLabel: turns ? `${RIDE[ride].label} → ${RIDE[to].label}` : RIDE[to].label, changes: ks, changeLabels: ks.filter(k => _ALT_STEPS[k]).map(stepLabel).concat(key === 'nearby' ? [label] : []),
      summary: summary || ks.filter(k => k !== 'noFlight' && k !== 'noHotel').map(stepShort).filter(Boolean).join(' · '),
      before: actual, after, compare: compareCost(actual, after, to),
      included: COMPONENTS.map(([k]) => k).filter(k => after[k] > 0), excluded, scope: scopeText(excluded, actual.unknown, to),
      total: after.total, saving: Math.max(0, total - after.total), over: Math.max(0, after.total - budget), fits: after.total <= budget,
      apply, lock: { hotelType: o.hotelType, level: o.level }, inPlace: ks.length > 0 && ks.every(k => _IN_PLACE.has(k)),
    };
  };
  const keys = ['lcc', 'save', 'hostel', 'shorter', 'noFlight', 'noHotel'].filter(usable);
  const singles = keys.map(k => mk(k, stepLabel(k), k === 'noFlight' && ride !== 'air' ? '이미 샀거나 따로 예매할 때' : _ALT_STEPS[k].detail, project([k]), stepApply(k), [k]));
  const near = _cheaperNearby(t);
  if (near) {
    const tt = { ...t, city: near.key, cityName: near.name, cityTier: near.tier, country: near.country, arrivalAirport: '' };
    singles.push(mk('nearby', `${josaRo(near.name)} 바꾸기`, `${near.country} 안에서 물가가 더 낮은 도시`, project([], tt),
      { city: { key: near.key, name: near.name, tier: near.tier, country: near.country, flag: near.flag } }, ['nearby'], `${near.name} 여행`, tt));
  }
  // 예산 안에 드는 조합 — 항공·숙소를 빼지 않는 조합이 먼저, 그다음 바뀌는 조건이 적은 것.
  const order = ['lcc', 'save', 'hostel', 'shorter', 'noHotel', 'noFlight'].filter(k => keys.includes(k) && !(k === 'lcc' && wasAir));
  const cost = (ks) => ks.length * 10 + ks.filter(k => k === 'noFlight' || k === 'noHotel').length * 100;
  const subsets = [];
  for (let mask = 1; mask < (1 << order.length); mask++) {
    const ks = order.filter((_, i) => mask & (1 << i));
    if (ks.length < 2 || ks.length > 4 || (ks.includes('lcc') && ks.includes('noFlight')) || (ks.includes('hostel') && ks.includes('noHotel'))) continue;
    subsets.push(ks);
  }
  subsets.sort((a, b) => cost(a) - cost(b));
  const combos = [];
  for (const full of [true, false]) {           // 항공·숙소를 모두 포함한 조합 하나, 따로 계산하는 조합 하나
    if (full && singles.some(a => a.fits && a.excluded.length === scope.excluded.length)) continue;
    if (!full && singles.some(a => a.fits)) continue;
    const pool = subsets.filter(ks => ks.some(k => k === 'noFlight' || k === 'noHotel') !== full);
    let best = null;
    for (const ks of pool) {
      if (best && cost(ks) > cost(best.changes)) break;
      const after = project(ks);
      if (after.total > budget) continue;
      if (!best || after.total > best.total) best = mk('combo', '예산 안에 드는 조합', ks.map(stepLabel).join(' + '), after, Object.assign({}, ...ks.map(stepApply)), ks);
    }
    if (best) { combos.push(best); break; }
  }
  const out = [...combos, ...singles].sort((a, b) => (b.fits - a.fits) || (a.fits ? a.excluded.length - b.excluded.length : 0) || (a.total - b.total));
  // 예산 한도 변경은 일정을 바꾸지 않는 별개의 선택이다.
  out.push({ key: 'raise', label: `예산 한도를 ${_manwon(total).toLocaleString('ko-KR')}만원으로 변경`, detail: '일정은 그대로 두고 입력한 예산만 바꿔요',
             total, saving: 0, over: 0, fits: true, excluded: scope.excluded, scope: scope.text, apply: { budget: _manwon(total) }, isLimitChange: true });
  return out;
}
function josaRo(name) {
  const c = String(name || '').charCodeAt(String(name || '').length - 1);
  const jong = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 : 0;
  return name + (jong && jong !== 8 ? '으로' : '로');
}

/** 일정의 항공·숙소 금액만 바꾼다(장소·시간은 그대로). */
function _applyInPlace(g, alt) {
  const ks = alt.changes;
  const bp = (g.budgetPlan = { ...(g.budgetPlan || {}) });
  g.sources = { ...(g.sources || { flight: g.flightPriceSource || 'estimate', hotel: g.hotelPriceSource || 'estimate' }) };
  const flights = g.days.flatMap(d => d.activities).filter(a => a.category === '이동' && a.flightMeta);
  const noFlight = ks.includes('noFlight');
  if (noFlight || ks.includes('lcc')) {
    const round = noFlight ? 0 : alt.after.flight;
    const half = Math.round(round / Math.max(1, flights.length) / 100) * 100;
    flights.forEach((a, i) => {
      a.cost = i === flights.length - 1 ? round - half * (flights.length - 1) : half;
      a.flightMeta = { ...a.flightMeta, roundTripKRW: round, oneWayKRW: half, source: noFlight ? 'excluded' : 'estimate' };
      if (noFlight) a.excludedFromBudget = true;
      else { const from = a.flightMeta.airline; a.flightMeta.airline = '제주항공'; if (from && a.address) a.address = a.address.replace(from, '제주항공'); }
    });
    if (noFlight) { g.sources.flight = 'excluded'; bp.includeFlight = false; g.flightLiveFailed = false; }
    else g.flight = { ...(g.flight || {}), classType: 'lcc', airlines: [] };
  }
  if (ks.includes('noHotel')) {
    g.days.forEach(d => d.activities.forEach(a => { if (a.category === '숙박') { a.cost = 0; a.excludedFromBudget = true; } }));
    g.sources.hotel = 'excluded'; bp.includeHotel = false; g.hotelLiveFailed = false;
  }
}

/** 대안 적용 — 실패하면 입력값과 일정을 모두 되돌린다. 예상 금액과 적용 뒤 금액을 함께 돌려준다. */
export async function applyBudgetAlternative(alt) {
  const t = appState.trip;
  const apply = alt?.apply;
  if (!apply || !t || !appState.generated?.days?.length) return { ok: false, code: 'empty' };
  const gBefore = JSON.stringify(appState.generated);
  const tBefore = JSON.stringify(t);
  const restore = () => {
    Object.keys(t).forEach(k => { delete t[k]; });
    Object.assign(t, JSON.parse(tBefore));
    appState.generated = JSON.parse(gBefore);
  };
  const predicted = alt.after || null;
  try {
    _syncTripFromGenerated(appState.generated, t);
    if (apply.flightClass) t.flight = { ...(t.flight || {}), classType: apply.flightClass, airlines: [] };
    if (apply.level) t.budgetLevel = apply.level;
    if (apply.includeFlight === false) t.includeFlight = false;
    if (apply.includeHotel === false) t.includeHotel = false;
    if (apply.hotelTypes) t.hotelP = { ...(t.hotelP || {}), types: apply.hotelTypes };
    if (apply.days && t.startDate) {
      const d = new Date(t.startDate + 'T00:00:00');
      d.setDate(d.getDate() + apply.days - 1);
      t.endDate = _isoLocal(d);
      t.days = apply.days;
    }
    if (apply.city) {
      Object.assign(t, { city: apply.city.key, cityName: apply.city.name, cityTier: apply.city.tier,
                         country: apply.city.country, cityFlag: apply.city.flag, arrivalAirport: '', arrivalAirportName: '' });
    }
    if (alt.inPlace) _applyInPlace(appState.generated, alt);
    else {
      const r = await regenerateSchedule({ skipSync: true, quietFail: true, lock: alt.lock });
      if (!r) { restore(); return { ok: false, code: _lastGenError?.code || 'failed', retryable: _lastGenError?.retryable !== false, message: _lastGenError?.message || '' }; }
    }
  } catch (e) {
    console.warn('[budget] 대안 적용 실패', e);
    restore();
    return { ok: false, code: e?.code || 'failed', retryable: true, message: '' };
  }
  const g = appState.generated;
  const after = costBreakdown(g);
  return { ok: true, predicted, actual: after, total: after.total, budget: Number(g.budget) || 0, scope: costScope(g, after),
    ...(predicted ? diffReasons(predicted, after, { ride: rideOf(g), flightLive: g.flightPriceSource === 'serpapi', hotelLive: g.hotelPriceSource === 'serpapi' }) : { diff: 0, same: true, reasons: [] }),
    undo: () => { const now = appState.generated; restore(); return now; } };
}

function _isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


function _pick(arr, seed = Math.random() * 1e6) { return arr[Math.abs(seed | 0) % arr.length]; }
function _costFor(cat, level, concept) {
  const base = { '식사': 25000, '카페': 9000, '관광': 18000, '쇼핑': 30000, '액티비티': 45000, '숙박': 120000, '이동': 30000 }[cat] || 15000;
  const lvlMult     = { '낮음': 0.6, '보통': 1.0, '높음': 1.8 }[level] || 1.0;
  const conceptMult = CONCEPT_MULT[concept] ?? 1.0;
  return Math.round(base * lvlMult * conceptMult);
}

/** Build one search query for a given slot. */
function _queryFor(slot, t, level) {
  const base = _pick(SLOT_QUERIES[slot]);
  const conceptHint = CONCEPT_HINT[t.concept] || '';
  const budgetHint  = BUDGET_HINT[level || t.budgetLevel] || '';
  const needs = t.needs || [];
  const cat = CATEGORY_BY_SLOT[slot];
  const food = cat === '식사' || cat === '카페';
  const diet = !food ? '' : needs.includes('veg') ? '채식' : needs.includes('halal') ? '할랄' : needs.includes('gluten') ? '글루텐 프리' : '';
  const access = needs.includes('stepFree') && !food ? '휠체어 접근 가능' : '';
  // 직접 입력한 세부 스타일·조건(기타) — 검색어가 길어지지 않게 하나씩 돌려 쓴다.
  const extras = [...(t.styles || []).filter(s => !STYLES.includes(s) && !OLD_STYLES[s]), ...(food ? [] : needs.filter(n => n.startsWith('custom:')).map(n => n.slice(7)))];
  const dietCustom = food ? (needs.find(n => n.startsWith('diet:')) || '').slice(5) : '';   // 식사 조건은 식당 검색에만
  const extra = extras.length ? extras[Math.floor(Math.random() * extras.length)] : '';
  return [t.cityName, diet, dietCustom, access, extra, conceptHint, budgetHint, base].filter(Boolean).join(' ').trim();
}

/** Pick the next Places result that hasn't been used today. */
/** 아직 안 쓴 후보 중에서, 그날 그 시각에 문을 여는 곳을 먼저 고른다.
 *  영업시간을 모르는 곳은 그다음, 머무는 중에 문을 닫는 곳은 그 뒤, 확실히 닫힌 곳은 마지막(대안이 없을 때만). */
function _pickUnused(candidates, usedIds, isoDate, hhmm, prev, stayMin = 60) {
  const fresh = candidates.filter(c => !usedIds.has(c.place_id));
  const pool = fresh.length ? fresh : candidates;
  if (!isoDate) return pool[0] || null;
  const stepFree = (appState?.trip?.needs || []).includes('stepFree');
  const rank = (c, i) => ({ open: 0, unknown: 1, closingSoon: 1.5, closedNow: 2, closedDay: 3 })[stayState(c.opening_periods, isoDate, hhmm, stayMin)] * 4
    + (stepFree ? (c.step_free === true ? 0 : c.step_free === false ? 2 : 1) : 0)
    // 앞 장소에서 멀수록 뒤로 — 한 동네를 이어서 다니게
    + (prev && isoDate ? Math.min(8, Math.max(0, travelMinutes(prev, c) - 12) / 11) : 0)
    - (c._local ? Math.max(-6, Math.min(4, c._local.score)) : 0) + i * .06;
  return pool.map((c, i) => ({ c, r: rank(c, i) })).sort((a, b) => a.r - b.r)[0]?.c || null;
}

/** Map Korean country name → 2-letter region code for Places API regional bias. */
function _guessRegion(country) {
  const map = {
    '대한민국': 'kr', '한국': 'kr',
    '일본': 'jp',
    '프랑스': 'fr',
    '미국': 'us', '미합중국': 'us',
    '태국': 'th',
    '호주': 'au',
    '영국': 'gb',
    '독일': 'de',
    '이탈리아': 'it',
    '스페인': 'es',
    '중국': 'cn',
    '대만': 'tw',
    '베트남': 'vn',
    '싱가포르': 'sg',
    '인도네시아': 'id',
    '필리핀': 'ph',
    '말레이시아': 'my',
    '캐나다': 'ca',
    '뉴질랜드': 'nz',
  };
  return map[country] || '';
}

const FIRST_DAY_ARRIVAL = '10:30';   // 여행 첫날의 예상 현지 도착 시각(가까운 곳 기준)

/** Public — re-run the same generation using the current trip parameters
 *  (city / days / concept / budget).  Used by the "다시 만들기" button on
 *  the schedule page so users don't have to re-walk the 4-step flow. */
// 다시 만들기 때 남길 '고정' 장소 — [{ di, a }]
let _pinnedCarry = [];
let _planLock = null;       // 예산 대안을 적용할 때 화면에서 본 숙소·지출 수준
let _quietFail = false;     // 실패 화면 대신 부른 쪽에서 안내한다(예산 대안 창)
let _lastGenError = null;   // { code, retryable, message }
let _regenerating = false;   // '다시 만들기'일 때만 true — 새 여행 만들기와 구분한다

/** 화면의 일정과 여행 만들기 입력값이 다르면(저장한 일정·공유받은 일정을 연 경우) 일정에서 입력값을 되살린다. */
function _syncTripFromGenerated(g, t = appState.trip) {
  const first = g.days[0]?.date, last = g.days.at(-1)?.date;
  if (t.cityName === g.city && t.startDate === first && t.endDate === last) return;
  const c = findCity(x => x.name === g.city);
  const o = g.originName ? findCity(x => x.name === g.originName) : null;
  Object.assign(t, {
    cityName: g.city, city: c?.key || '', country: g.country || c?.country || '', cityTier: c?.tier, cityFlag: c?.flag,
    originName: g.originName || '', origin: o?.key || '', originCountry: o?.country,
    departureAirport: g.departureAirport || '', arrivalAirport: g.arrivalAirport || '',
    startDate: first, endDate: last, days: g.days.length,
    placeMode: g.placeMode || t.placeMode || 'local', concept: g.concept || t.concept, styles: Array.isArray(g.styles) ? [...g.styles] : (t.styles || []),
    companion: g.companion || t.companion || 'couple',
    budget: Math.round((g.budget || 0) / 10000) || t.budget,
    currency: g.currency || t.currency || 'KRW',
  });
  if (g.people) { t.adults = Math.max(1, g.people); t.children = 0; }
  if (g.budgetPlan?.rooms) { t.rooms = g.budgetPlan.rooms; t._roomsTouched = true; }
  if (g.flight) t.flight = { ...g.flight, airlines: [...(g.flight.airlines || [])] };
  if (g.hotelPref) t.hotelP = { ...g.hotelPref };
  if (g.budgetPlan) { t.includeFlight = g.budgetPlan.includeFlight !== false; t.includeHotel = g.budgetPlan.includeHotel !== false; }
}

export async function regenerateSchedule({ skipSync = false, quietFail = false, lock = null } = {}) {
  if (_generating) { trackEvent('gen_duplicate_blocked'); return false; }
  const g = appState.generated;
  if (g?.days?.length && !skipSync) _syncTripFromGenerated(g);
  const dateErr = _dateError(appState.trip);
  if (dateErr) {
    showToast(/지났/.test(dateErr) ? '여행 날짜가 이미 지나서 다시 만들 수 없어요. 새 날짜로 여행을 만들어 주세요.' : dateErr, 4200);
    return false;
  }
  _pinnedCarry = [];
  g?.days?.forEach((d, di) => d.activities.forEach(a => { if (a.pinned) _pinnedCarry.push({ di, a: JSON.parse(JSON.stringify(a)) }); }));
  _regenerating = true;
  _planLock = lock; _quietFail = quietFail;
  try { return await _generateSchedule(); }
  finally { _pinnedCarry = []; _regenerating = false; _planLock = null; _quietFail = false; }
}

/** 고정한 장소를 같은 날짜·시간에 되돌려 놓는다.
 *  그 날 시간이 가장 가까운 일반 장소(공항·숙소 제외)를 대신하고, 같은 장소가 다른 곳에 또 있으면 뺀다. */
function _mergePinned(generated, pins) {
  if (!pins.length) return 0;
  const toMin = (t) => { const [h, m] = String(t || '12:00').split(':').map(Number); return (h | 0) * 60 + (m | 0); };
  const key = (a) => a.placeId || String(a.name || '').trim();
  const pinnedKeys = new Set(pins.map(p => key(p.a)));
  generated.days.forEach(d => { d.activities = d.activities.filter(a => a.category === '이동' || a.category === '숙박' || !pinnedKeys.has(key(a))); });
  let kept = 0;
  pins.forEach(({ di, a }) => {
    const day = generated.days[Math.min(di, generated.days.length - 1)];
    if (!day) return;
    const acts = day.activities;
    let best = -1, gap = Infinity;
    acts.forEach((x, i) => {
      if (x.category === '이동' || x.category === '숙박' || x.pinned) return;
      const g2 = Math.abs(toMin(x.time) - toMin(a.time));
      if (g2 < gap) { gap = g2; best = i; }
    });
    if (best >= 0 && gap <= 90) acts.splice(best, 1);       // 비슷한 시간대의 새 장소 하나를 대신한다
    let at = acts.findIndex(x => toMin(x.time) > toMin(a.time));
    if (at < 0) at = acts.length;
    acts.splice(at, 0, { ...a, pinned: true });
    kept += 1;
  });
  return kept;
}

/* ============ 생성 진행 화면 ============ */
const _genSteps = () => ['도시 위치 찾기', `${RIDE[_groundOf(appState?.trip)?.mode || 'air'].ticket} 확인`, '숙소 확인', '날짜별 장소 고르기', '예산 맞추기'];
/* 앱 아이콘의 경로(배경 없이): 빈 원에서 비행기가 떠나고, 지나간 자리에 점이 하나씩 떨어져 남는다.
 * 점 크기는 앱 아이콘처럼 작고 큰 점이 섞이고, 경로 위 간격을 두어 서로 겹치지 않는다.
 * 3.2초 한 바퀴 — 날아가기(0~70%) → 완성된 모습 잠시(70~90%) → 사라졌다 다시. 일정이 다 만들어질 때까지 반복. */
const GL_PATH = 'M20 82 C34 80 45 73 48 63 C51 53 43 47 48 39 C53 31 66 31 80 18';
const GL_DUR = 3.2, GL_FLY = 0.7, GL_HOLD = 0.9;
// [경로 위치(0~1), 반지름] — 앱 아이콘의 점 배열(작은 점 사이사이 큰 점)
const GL_DOTS = [[0.10, 1.6], [0.17, 1.9], [0.25, 2.7], [0.33, 1.6], [0.41, 3.3], [0.49, 1.7], [0.555, 1.2],
                 [0.61, 1.8], [0.69, 3.4], [0.745, 1.6], [0.80, 2.0], [0.865, 2.6]];
const GL_ROUTE_SVG = [
  '<svg class="gl-route gl-plane-route" viewBox="0 0 100 100" fill="none" aria-hidden="true">',
  '<path class="gl-guide" d="' + GL_PATH + '"/>',
  '<g class="gl-loop"><animate attributeName="opacity" values="1;1;1;0" keyTimes="0;' + GL_FLY + ';' + GL_HOLD + ';1" dur="' + GL_DUR + 's" repeatCount="indefinite"/>',
  '<g class="gl-drops"></g>',
  '<circle class="gl-start" cx="20" cy="82" r="5.2"/>',
  '<circle class="gl-glow" cx="80" cy="18" r="12" opacity="0"><animate attributeName="opacity" values="0;0;0.4;0.4" keyTimes="0;0.66;0.74;1" dur="' + GL_DUR + 's" repeatCount="indefinite"/></circle>',
  '<g class="gl-plane"><path d="M5 0 L-1.5 -1.2 L-4.6 -6 L-6.4 -6 L-4.8 -1.3 L-7.8 -1.1 L-9 -3 L-10.2 -3 L-9.5 0 L-10.2 3 L-9 3 L-7.8 1.1 L-4.8 1.3 L-6.4 6 L-4.6 6 L-1.5 1.2 Z"/>',
  '<animateMotion dur="' + GL_DUR + 's" repeatCount="indefinite" rotate="auto" keyPoints="0;1;1;1" keyTimes="0;' + GL_FLY + ';' + GL_HOLD + ';1" calcMode="linear" path="' + GL_PATH + '"/></g>',
  '</g></svg>',
].join('');
/** 경로 위에 점을 놓는다 — 비행기가 그 자리를 지나는 순간 나타나 남는다(앞뒤 점과 겹치지 않게 간격 확인). */
function glDropDots(svg) {
  const guide = svg?.querySelector('.gl-guide');
  const g = svg?.querySelector('.gl-drops');
  if (!guide || !g || g.childElementCount) return;
  const len = guide.getTotalLength();
  const NS = 'http://www.w3.org/2000/svg';
  let prev = null;
  GL_DOTS.forEach(([f, r]) => {
    const pt = guide.getPointAtLength(len * f);
    if (prev && Math.hypot(pt.x - prev.x, pt.y - prev.y) < prev.r + r + 1.2) return;   // 겹치면 건너뛴다
    prev = { x: pt.x, y: pt.y, r };
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', pt.x.toFixed(2)); c.setAttribute('cy', pt.y.toFixed(2)); c.setAttribute('r', String(r));
    c.setAttribute('class', 'gl-dot'); c.setAttribute('opacity', '0');
    const t = (f * GL_FLY).toFixed(3), t2 = Math.min(f * GL_FLY + 0.02, GL_FLY).toFixed(3);
    const a = document.createElementNS(NS, 'animate');
    a.setAttribute('attributeName', 'opacity'); a.setAttribute('values', '0;0;1;1');
    a.setAttribute('keyTimes', '0;' + t + ';' + t2 + ';1'); a.setAttribute('dur', GL_DUR + 's'); a.setAttribute('repeatCount', 'indefinite');
    c.appendChild(a); g.appendChild(c);
  });
}

function _showGenLoading(msg) {
  let ov = document.getElementById('genLoadingOverlay');
  if (!ov) {
    ov = el('div', { id: 'genLoadingOverlay', role: 'dialog', ariaModal: 'true', ariaLabelledby: 'glMsg' }, [
      el('svg', {}),
      el('div', { class: 'gl-msg', id: 'glMsg' }, '일정을 만드는 중…'),
      el('ol', { class: 'gl-steps', id: 'glSteps' }, _genSteps().map((s, i) => el('li', { dataset: { i: String(i) } }, s))),
      el('p', { class: 'gl-sub', id: 'glSub', ariaLive: 'polite' }, ''),
      el('div', { class: 'gl-actions', id: 'glActions' }),
    ]);
    ov.firstChild.outerHTML = GL_ROUTE_SVG;
    document.body.appendChild(ov);
    glDropDots(ov.querySelector('.gl-plane-route'));
  }
  ov.classList.remove('is-failed');
  const m = ov.querySelector('#glMsg'); if (m && msg) m.textContent = msg;
  const act = ov.querySelector('#glActions'); if (act) act.innerHTML = '';
  ov.style.display = 'flex';
  _genProgress(0, '');
}
function _genProgress(stepIdx, detail) {
  const ov = document.getElementById('genLoadingOverlay');
  if (!ov) return;
  ov.querySelectorAll('#glSteps li').forEach(li => {
    const i = Number(li.dataset.i);
    li.classList.toggle('is-done', i < stepIdx);
    li.classList.toggle('is-current', i === stepIdx);
    if (i === stepIdx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  const sub = ov.querySelector('#glSub');
  if (sub) sub.textContent = `${_genSteps()[stepIdx] || ''}${detail ? ` · ${detail}` : ''}`;
}
/** 단계는 그대로 두고 아래 한 줄만 바꾼다. */
function _genNote(text) {
  const sub = document.querySelector('#genLoadingOverlay #glSub');
  if (sub) sub.textContent = text;
}
function _showGenFailure(message, retry = () => regenerateSchedule()) {
  const ov = document.getElementById('genLoadingOverlay');
  if (!ov) return;
  ov.classList.add('is-failed');
  ov.querySelector('#glMsg').textContent = '일정을 만들지 못했어요';
  ov.querySelector('#glSub').textContent = message;
  const act = ov.querySelector('#glActions');
  act.innerHTML = '';
  act.append(
    el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { _hideGenLoading(); retry(); } }, '다시 시도'),
    el('button', { type: 'button', class: 'btn btn-ghost gl-close', onclick: () => { _hideGenLoading(); } }, '입력 화면으로'),
  );
  act.querySelector('button')?.focus();
}
function _hideGenLoading() {
  document.getElementById('genLoadingOverlay')?.remove();
}

/** 응답이 없을 때 오래 기다리지 않도록 — 시간이 지나면 실패로 보고 대체값을 쓴다. */
function _withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 응답 시간 초과`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/* ============ 외부 공급자 상태 ============
 * 전부 실패와 일부 추정을 구분하고, 다시 시도할 수 있는지 함께 남긴다. */
const _PROVIDER_TEXT = {
  timeout:      ['응답이 늦어 기다리지 않았어요.', true],
  network:      ['서버에 연결하지 못했어요.', true],
  upstream:     ['제공처가 응답하지 않았어요.', true],
  quota:        ['오늘 조회 한도를 다 썼어요. 잠시 뒤 다시 조회할 수 있어요.', true],
  no_result:    ['조건에 맞는 결과가 없었어요.', false],
  unconfigured: ['아직 연결되지 않았어요.', false],
  rejected:     ['조회 조건을 받아들이지 않았어요.', false],
};
export function providerError(e) {
  const code = e?.code && _PROVIDER_TEXT[e.code] ? e.code
    : /시간 초과/.test(e?.message || '') ? 'timeout' : e?.message === 'NETWORK_ERROR' ? 'network'
    : e?.status === 429 ? 'quota' : e?.status === 404 ? 'no_result' : e?.status === 503 && e?.fromApp ? 'unconfigured'
    : e?.status >= 400 && e?.status < 500 ? 'rejected' : e?.status ? 'upstream' : 'upstream';
  const [text, retryable] = _PROVIDER_TEXT[code];
  return { code, text, retryable: typeof e?.retryable === 'boolean' ? e.retryable : retryable };
}
const _prov = (name, status, extra = {}) => ({ name, status, retryable: false, reason: '', ms: 0, checkedAt: new Date().toISOString(), ...extra });

/** 실시간 항공 요금. 실패해도 던지지 않고 상태로 돌려준다. */
async function _liveFlight(t, plan, features) {
  const name = 'Google 항공 (SerpApi)';
  if (!plan.includeFlight) return { state: _prov(name, 'excluded') };
  const ground = _groundOf(t);
  if (ground) return { state: _prov('기차·버스 운임 어림', 'skipped', { reason: `${RIDE[ground.mode].label} 요금은 구간 운임으로 어림했어요. 배차와 요금은 예매할 때 확인해 주세요.` }) };
  if (!features.liveFlights) return { state: _prov(name, 'off', { code: features.unknown ? 'network' : 'unconfigured', reason: features.unknown ? _PROVIDER_TEXT.network[0] : _PROVIDER_TEXT.unconfigured[0], retryable: !!features.unknown }) };
  const depIata = t.departureAirport || _CITY_IATA[t.origin];   // 사용자가 고른 출발 공항 우선
  const arrIata = t.arrivalAirport || _CITY_IATA[t.city];
  if (!depIata || !arrIata || depIata === arrIata || !t.startDate || !t.endDate || t.endDate <= t.startDate) {
    return { state: _prov(name, 'skipped', { reason: '이 구간·날짜는 실시간 조회를 지원하지 않아요.' }) };
  }
  const t0 = Date.now();
  try {
    const r = await _withTimeout(api.searchFlights({
      departure_id: depIata, arrival_id: arrIata, outbound_date: t.startDate, return_date: t.endDate,
      adults: 1, currency: 'KRW', country: 'kr', language: 'ko',
    }), 20000, '실시간 항공 요금');
    const ms = Date.now() - t0;
    if (!(r && Number.isFinite(r.lowest_price) && r.lowest_price > 0)) return { state: _prov(name, 'empty', { code: 'no_result', reason: _PROVIDER_TEXT.no_result[0], ms }) };
    const c = r.cheapest || null;
    return { perPax: r.lowest_price, meta: c ? { airline: c.airline, flightCode: c.flight_number, stops: c.stops, departure: c.departure_time, arrival: c.arrival_time, duration: c.duration_min } : null,
      state: _prov(name, 'live', { ms, serverMs: r.meta?.latency_ms ?? null }) };
  } catch (e) {
    const pe = providerError(e);
    trackEvent('api_fail_flights');
    console.warn('[trip-flow] 항공 실시간 조회 실패 — 추정 사용:', pe.code);
    return { state: _prov(name, 'failed', { code: pe.code, reason: pe.text, retryable: pe.retryable, ms: Date.now() - t0 }) };
  }
}
/** 실시간 숙소 요금 — 매물 하나(이름·가격·좌표 같은 출처). */
async function _liveHotel(t, plan, features, placeName) {
  const name = 'Google 호텔 (SerpApi)';
  if (!plan.includeHotel) return { state: _prov(name, plan.nights ? 'excluded' : 'none') };
  if (!features.liveHotels) return { state: _prov(name, 'off', { code: features.unknown ? 'network' : 'unconfigured', reason: features.unknown ? _PROVIDER_TEXT.network[0] : _PROVIDER_TEXT.unconfigured[0], retryable: !!features.unknown }) };
  if (!t.startDate || !t.endDate || t.endDate <= t.startDate) return { state: _prov(name, 'skipped', { reason: '숙박 날짜가 없어 조회하지 않았어요.' }) };
  const t0 = Date.now();
  try {
    // 사용자가 고른 성급(2~5)을 hotel_class 필터로 전달 → 보여줄 호텔 등급·가격대 일치
    const starMap = { luxury: '5', upscale: '4', midscale: '3', budget: '2' };
    const stars = [...new Set((t.hotelP?.types?.length ? t.hotelP.types : [plan.hotelType]).map(x => starMap[x]).filter(Boolean))];
    const r = await _withTimeout(api.searchHotels({
      query: t.cityName, check_in_date: t.startDate, check_out_date: t.endDate, adults: plan.people, currency: 'KRW',
      country: (_guessRegion(t.country) || 'KR').toLowerCase(), language: 'ko', hotel_class: stars.length ? stars.join(',') : undefined, max_results: 25,
    }), 20000, '실시간 숙소 요금');
    const ms = Date.now() - t0;
    const hotels = (r?.hotels || []).filter(h => Number.isFinite(h.price_per_night) && h.price_per_night > 0);
    if (!hotels.length) return { state: _prov(name, 'empty', { code: 'no_result', reason: _PROVIDER_TEXT.no_result[0], ms }) };
    let chosen = null;
    if (placeName) {       // 장소 검색 후보와 이름이 겹치는 매물 우선
      const toks = placeName.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
      chosen = hotels.find(h => toks.some(k => (h.name || '').toLowerCase().includes(k)));
    }
    if (!chosen) {         // 아니면 중앙값에 가장 가까운 매물
      const med = r.median_price_per_night;
      chosen = med ? hotels.reduce((a, b) => Math.abs(b.price_per_night - med) < Math.abs(a.price_per_night - med) ? b : a) : hotels[0];
    }
    return { hotel: chosen, state: _prov(name, 'live', { ms, serverMs: r.meta?.latency_ms ?? null }) };
  } catch (e) {
    const pe = providerError(e);
    trackEvent('api_fail_hotels');
    console.warn('[trip-flow] 숙소 실시간 조회 실패 — 추정 사용:', pe.code);
    return { state: _prov(name, 'failed', { code: pe.code, reason: pe.text, retryable: pe.retryable, ms: Date.now() - t0 }) };
  }
}

/** 결과 화면의 ‘다시 조회’ — 장소는 그대로 두고 항공·숙소 요금만 다시 받는다. */
export async function retryProvider(kind) {
  const g = appState.generated;
  if (!g?.days?.length) return { ok: false };
  const t = JSON.parse(JSON.stringify(appState.trip || {}));
  _syncTripFromGenerated(g, t);
  const bp = g.budgetPlan || {};
  if (rideOf(g) === 'air') t._air = true;            // 항공으로 만든 일정은 항공 요금을 다시 조회한다
  const plan = { includeFlight: bp.includeFlight !== false, includeHotel: bp.includeHotel !== false, hotelType: bp.hotelType, people: g.people || 1, nights: bp.nights || g.days.length - 1 };
  await ensureAwake();      // 결과 화면을 오래 열어 둔 뒤에는 서버가 잠들어 있을 수 있다
  const features = await api.features({ fresh: true });
  g.sources = { ...(g.sources || {}) };
  if (kind === 'flight') {
    const r = await _liveFlight(t, plan, features);
    g.providers = { ...(g.providers || {}), flight: r.state };
    if (!r.perPax) return { ok: false, state: r.state };
    const total = Math.round(r.perPax * plan.people * (g.companion === 'group' ? 0.95 : 1) / 100) * 100;
    const fl = g.days.flatMap(d => d.activities).filter(a => a.category === '이동' && a.flightMeta);
    const half = Math.round(total / 2 / 100) * 100;
    fl.forEach((a, i) => { a.cost = i ? total - half : half; a.flightMeta = { ...a.flightMeta, roundTripKRW: total, oneWayKRW: half, airline: r.meta?.airline || a.flightMeta.airline, flightCode: r.meta?.flightCode || '', source: 'serpapi' }; });
    g.flightPriceSource = g.sources.flight = 'serpapi'; g.sources.flightCheckedAt = new Date().toISOString(); g.flightLiveFailed = false;
    return { ok: true, state: r.state };
  }
  const hotelAct = g.days.flatMap(d => d.activities).find(a => a.category === '숙박');
  const r = await _liveHotel(t, plan, features, String(hotelAct?.name || '').replace(/\s*\(.*$/, ''));
  g.providers = { ...(g.providers || {}), hotel: r.state };
  if (!r.hotel) return { ok: false, state: r.state };
  const nightly = Math.round(r.hotel.price_per_night) * (bp.rooms || 1);
  g.days.forEach(d => d.activities.forEach(a => {
    if (a.category !== '숙박') return;
    const label = /\(([^)]*(?:\([^)]*\))?[^)]*)\)\s*(?:·.*)?$/.exec(a.name || '')?.[1];
    if (Number(a.cost) > 0) a.cost = nightly;
    a.name = r.hotel.name ? `${r.hotel.name}${label ? ` (${label})` : ''}` : a.name;
    if (Number.isFinite(r.hotel.latitude)) { a.latitude = r.hotel.latitude; a.longitude = r.hotel.longitude; }
    a.googleMapsQuery = r.hotel.name || a.googleMapsQuery;
  }));
  g.hotelPriceSource = g.sources.hotel = 'serpapi'; g.sources.hotelCheckedAt = new Date().toISOString(); g.hotelLiveFailed = false;
  return { ok: true, state: r.state };
}

// 서버에 끝내 연결하지 못했을 때 — 실패할 요청을 보내지 않고 예시 장소·추정 요금으로 만든다.
const NO_SERVER = { liveFlights: false, liveHotels: false, ai: false, places: false, unknown: true };
let _generating = false;

async function _generateSchedule() {
  if (_generating) { trackEvent('gen_duplicate_blocked'); return false; }   // 중복 요청 막기(두 번 눌러도 한 번만)
  _generating = true;
  const t = appState.trip;
  const btn = $('#stepGenerate');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = '일정 만드는 중…'; }
  _showGenLoading(`${t.cityName || ''} 일정을 만드는 중…`);
  const startedAt = Date.now();
  trackEvent('trip_generate_start');
  _lastGenError = null;
  try {
    await _generateScheduleInner(t, btn, startedAt);
    trackEvent('trip_generate_done');
    // 운영 지표 — 개수만 센다(도시·날짜·금액 같은 여행 정보는 보내지 않음).
    const sec = (Date.now() - startedAt) / 1000;
    trackEvent(sec < 10 ? 'gen_time_under10' : sec < 30 ? 'gen_time_10to30' : 'gen_time_over30');
    const g = appState.generated;
    if (g) {
      const live = g.flightPriceSource === 'serpapi' || g.hotelPriceSource === 'serpapi';
      trackEvent(live ? 'gen_price_live' : 'gen_price_estimated');
      if (g.sources?.placesSample) trackEvent('gen_places_fallback');
    }
    return true;
  } catch (e) {
    console.error('[trip-flow] 일정 생성 실패:', e);
    trackEvent('trip_generate_fail');
    const pe = providerError(e);
    _lastGenError = { ...pe, message: _regenerating ? `${pe.text} 지금 일정은 그대로 남아 있어요.` : `${pe.text} 입력한 내용은 그대로 남아 있어요.` };
    if (_quietFail) _hideGenLoading();
    else _showGenFailure(_lastGenError.message, _regenerating ? () => regenerateSchedule() : () => _generateSchedule());
    return false;
  } finally {
    _generating = false;
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = '일정 만들기'; }
  }
}

async function _generateScheduleInner(t, btn, startedAt) {
  // 잠든 서버는 깨는 데 30~60초 걸린다. 깨기 전에 부르면 제한 시간(장소 12초)이 먼저 지나 예시 장소로 채워지므로, 깬 것을 확인하고 시작한다.
  const awake = await ensureAwake({ onWait: () => _genNote('서버를 깨우는 중 · 보통 30초쯤 걸려요') });
  const features = awake ? await api.features() : NO_SERVER;
  _genProgress(0, '');
  // 장소 검색이 서버에 연결돼 있지 않으면 호출하지 않고 바로 예시 장소를 쓴다(실패할 요청을 반복하지 않음).
  const placesOn = features.places !== false;
  // 두 번 연달아 실패(시간 초과·서버 오류)하면 이번 생성에서는 더 부르지 않는다 — 한 칸씩 기다리며 몇 분씩 걸리지 않게.
  let placeFails = 0;
  const placeStat = { calls: 0, ok: 0, empty: 0, fails: 0, ms: 0, last: null };
  const _sp = async (args) => {
    if (!placesOn || placeFails >= 2) return null;
    const t0 = Date.now();
    placeStat.calls++;
    try {
      const r = await _withTimeout(api.searchPlaces(args), 12000, '장소 검색');
      placeFails = 0;
      placeStat.ms += Date.now() - t0;
      if (r?.places?.length) placeStat.ok++; else placeStat.empty++;
      return r;
    } catch (e) {
      placeFails++;
      placeStat.ms += Date.now() - t0; placeStat.fails++; placeStat.last = providerError(e);
      if (placeFails === 2) { trackEvent('gen_places_circuit_open'); console.warn('[trip-flow] 장소 검색이 계속 실패해 이번에는 예시 장소를 써요'); }
      throw e;
    }
  };
  const plan = _fitPlan(t, _planLock);
  const level = plan.level;
  const people = plan.people;

  const start = new Date(t.startDate + 'T00:00:00');
  const days = [];

  // ── STEP A — Resolve the destination city's centre FIRST.
  // Every per-slot Places search below is biased to a 30 km circle around
  // this centre, otherwise the API can return places in the wrong city /
  // wrong country and Routes API later says "no route" because the points
  // are too scattered.
  let cityCenter = null;
  try {
    const cityRes = await _withTimeout(_sp({
      query: t.cityName,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 1,
    }), 12000, '도시 위치');
    const c = cityRes?.places?.[0];
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
      cityCenter = { lat: c.latitude, lng: c.longitude };
      console.log('[trip-flow] city centre:', t.cityName, cityCenter);
    }
  } catch (e) {
    console.warn('[trip-flow] city centre resolve failed:', e?.message);
  }

  // Haversine distance in km — used to drop results that are obviously
  // outside the city (Places API sometimes returns hits in another prefecture).
  function _kmFromCentre(p) {
    if (!cityCenter) return 0;
    const R = 6371;
    const dLat = (p.latitude - cityCenter.lat) * Math.PI / 180;
    const dLng = (p.longitude - cityCenter.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(cityCenter.lat * Math.PI/180) * Math.cos(p.latitude * Math.PI/180) *
              Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ── STEP B — One Places call per slot, biased to city centre. ──
  const slotCache = new Map();
  const mode = modeOf(t);
  const lang = langOf(t.country);
  const seed = Math.floor(Math.random() * 2);
  const cityInfo = findCity(x => x.key === t.city) || { name: t.cityName, aliases: [] };
  const freeText = [...(t.styles || []).filter(x => !STYLES.includes(x) && !OLD_STYLES[x]), ...(t.needs || []).filter(n => n.startsWith('custom:')).map(n => n.slice(7))];
  const dietText = (t.needs || []).find(n => n.startsWith('diet:'))?.slice(5) || '';
  async function search(q) {
    const res = await _withTimeout(_sp({
      query: q, language_code: 'ko', language: 'ko', region: _guessRegion(t.country), max_results: 20,
      center_lat: cityCenter?.lat, center_lng: cityCenter?.lng,
    }), 12000, '장소 검색');
    let places = (res?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    // 도시 중심에서 60km 넘게 떨어진 곳(다른 지역 결과)은 뺀다.
    if (cityCenter) { const near = places.filter(p => _kmFromCentre(p) <= 60); if (near.length) places = near; }
    return places;
  }
  // 대표 관광지 목록 — 동네 위주·반반에서 뺄 곳을 안다. 반반에서는 하루 한 곳의 후보로도 쓴다.
  let famous = null, famousPlaces = [];
  if (mode !== 'famous') {
    try { famousPlaces = await search(`${t.cityName} 대표 관광지 명소`); famous = famousIndex(famousPlaces); }
    catch (e) { console.warn('[trip-flow] 대표 관광지 목록을 받지 못했어요:', e?.message); }
  }
  /** 자리(slot)의 후보. round 는 여러 날 여행에서 후보를 새로 받을 때 커진다. */
  async function searchForSlot(slot, round = 0) {
    const key = `${slot}#${round}`;
    if (slotCache.has(key)) return slotCache.get(key);
    const cat = CATEGORY_BY_SLOT[slot];
    const food = cat === '식사' || cat === '카페';
    // 직접 적은 조건(기타)이 있으면 그 말 그대로 한국어로 찾고, 없으면 현지어로 동네 장소를 찾는다.
    const own = food ? dietText : freeText.length ? freeText[round % freeText.length] : '';
    const q = mode === 'famous' ? _queryFor(slot, t, level)
      : own ? `${t.cityName} ${own} ${food ? '현지인 식당' : '동네'}`
      : localQuery(slot, { city: cityInfo, country: t.country, styles: t.styles, needs: t.needs, round, seed, kids: (t.children || 0) > 0 });
    try {
      let places = await search(q);
      if (mode !== 'famous') {
        places = rankLocal(places, { famous, food, level });
        if (places.length < 3 && lang !== 'ko' && !own) {      // 현지어 결과가 모자라면 한국어로 한 번 더
          const more = await search(`${t.cityName} 현지인 ${food ? '식당' : '동네 산책'}`);
          const has = new Set(places.map(p => p.place_id));
          places = rankLocal([...places, ...more.filter(p => !has.has(p.place_id))], { famous, food, level });
        }
      }
      slotCache.set(key, places);
      return places;
    } catch (e) {
      console.warn('[trip-flow] places search failed for', slot, q, e?.message);
      if (!searchForSlot._failed) { searchForSlot._failed = true; trackEvent('api_fail_places'); }   // 생성 1회에 한 번만
      slotCache.set(key, []);
      return [];
    }
  }

  const usedIds = new Set();          // place_ids already picked across the whole trip
  // Slot list 우선순위:
  //   1) 스타일 "빽빽한 일정" → PACKED (식사 제외 7곳)
  //   2) 스타일 "여유로운 일정" → RELAXED (식사 제외 3곳)
  //   3) 컨셉 기본
  const slotTimes = _slotTimesFor(t);

  // ── STEP C — Resolve AIRPORT + HOTEL once for the destination city. ──
  // These power the per-day start/end markers (공항 도착 / 호텔 체크인 / 복귀 / 체크아웃 / 공항 출발).
  // Falls back to readable mock names if Places API is unavailable.
  let airportPlace = null;
  let hotelPlace = null;
  const localTrip = _isLocalTrip(t);
  _genProgress(1, plan.includeFlight ? '' : (localTrip ? '같은 도시 여행이라 건너뛰어요' : '예산에서 제외했어요'));
  const ground = localTrip ? null : _groundOf(t);
  const hubQuery = !ground ? `${t.cityName} 국제공항` : ground.to.includes(t.cityName) ? ground.to : `${t.cityName} ${ground.to}`;
  if (!localTrip) try {
    const ar = await _withTimeout(_sp({
      query: hubQuery,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 3,
      center_lat: cityCenter?.lat,
      center_lng: cityCenter?.lng,
    }), 12000, '공항·역 검색');
    const hubs = (ar?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && (!ground || _kmFromCentre(p) <= 60));
    const flat = (x) => String(x || '').replace(/\s+/g, '');
    airportPlace = (ground && hubs.find(p => flat(p.name).includes(flat(ground.to)))) || hubs[0] || null;
  } catch (e) {
    console.warn('[trip-flow] airport resolve failed:', e?.message);
  }
  try {
    const hotelTypeQueryMap = {
      luxury: '5성급 호텔', upscale: '4성급 호텔', midscale: '호텔', budget: '저렴 호텔',
      boutique: '부티크 호텔', resort: '리조트', ryokan: '료칸', bnb: 'B&B 게스트하우스',
      hostel: '호스텔', apt: '아파트 숙소', capsule: '캡슐호텔',
    };
    // 위치 우선순위 키워드 (시내중심/역근처 등 사용자 선택 반영)
    const locKeywordMap = {
      downtown: '시내 중심', station: '역 근처', airport: '공항 근처',
      beach: '해변', nature: '자연 근처', shopping: '쇼핑가',
    };
    // 다양성 키워드 — 같은 도시·유형이라도 매번 다른 결과
    const varietySuffix = ['추천', '인기', '베스트', '예약', '리뷰', '평점', '신축', '럭셔리', '깔끔한', '편안한'];

    // 쿼리 후보 빌드 — 사용자 선택 유형(다중) × 위치 × 다양성 suffix 조합
    const hotelTypes = (t.hotelP?.types && t.hotelP.types.length)
      ? t.hotelP.types
      : [plan.hotelType || 'midscale'];
    const hotelLocs = (t.hotelP?.locations && t.hotelP.locations.length)
      ? t.hotelP.locations
      : [null];
    const queryCandidates = [];
    hotelTypes.forEach(typeKey => {
      hotelLocs.forEach(locKey => {
        const typeKw = hotelTypeQueryMap[typeKey] || '호텔';
        const locKw  = locKey ? locKeywordMap[locKey] : '';
        // 각 조합마다 다양성 suffix 1개 랜덤 추가
        const variety = varietySuffix[Math.floor(Math.random() * varietySuffix.length)];
        queryCandidates.push(`${t.cityName} ${locKw} ${typeKw} ${variety}`.replace(/\s+/g, ' ').trim());
      });
    });
    // 사용자 선택이 없으면 기본 다양성 쿼리
    if (queryCandidates.length === 0) {
      queryCandidates.push(`${t.cityName} 호텔 ${varietySuffix[Math.floor(Math.random() * varietySuffix.length)]}`);
    }
    // 쿼리 후보 중 랜덤 1개 선택
    const hotelQuery = queryCandidates[Math.floor(Math.random() * queryCandidates.length)];
    console.log('[trip-flow] 호텔 검색 쿼리:', hotelQuery);

    _genProgress(2, plan.includeHotel ? '' : '예산에서 제외했어요');
    const hr = await _withTimeout(_sp({
      query: hotelQuery,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 15,   // 더 많은 후보
      center_lat: cityCenter?.lat,
      center_lng: cityCenter?.lng,
    }), 12000, '숙소 검색');
    let hotelCandidates = (hr?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    if (cityCenter) {
      const near = hotelCandidates.filter(p => _kmFromCentre(p) <= 30);
      if (near.length) hotelCandidates = near;
    }
    // 상위 결과 중 랜덤 선택 (1순위 고정 X, 매번 다른 호텔)
    if (hotelCandidates.length > 0) {
      // 너무 끝 결과는 품질 낮을 수 있으니 상위 70%에서 랜덤 추출
      const topN = Math.max(1, Math.ceil(hotelCandidates.length * 0.7));
      const pickPool = hotelCandidates.slice(0, topN);
      hotelPlace = pickPool[Math.floor(Math.random() * pickPool.length)];
      console.log('[trip-flow] 호텔 선택:', hotelPlace?.name, '(후보 ' + pickPool.length + '/' + hotelCandidates.length + '개 중 랜덤)');
    } else {
      hotelPlace = null;
    }
  } catch (e) {
    console.warn('[trip-flow] hotel resolve failed:', e?.message);
  }

  const airportName = ground ? ground.to : airportPlace?.name || `${t.cityName} 국제공항`;
  let hotelName     = hotelPlace?.name   || `${t.cityName} 시내 호텔`;
  // Cost: 1박 단위로 분배 — 첫날 체크인 + 중간일 복귀에 각 1박씩 적용
  const nights = plan.nights;
  // 호텔 1박 비용 — 사용자 선택 (유형/위치/편의시설) 반영, 방 수도 고려
  const _rooms = _roomCount(t);
  // 1실 1박 단가 결정 — 우선순위:
  //   1) 실시간 요금(이름·가격·좌표를 같은 매물로)  2) 실패·미연결이면 추정 공식 그대로
  const _liveH = await _liveHotel(t, plan, features, hotelPlace?.name);
  let _perRoomNight, _hotelPriceSource;
  if (_liveH.hotel) {
    const c = _liveH.hotel;
    hotelName = c.name || hotelName;
    hotelPlace = {
      name: hotelName,
      latitude:  Number.isFinite(c.latitude)  ? c.latitude  : hotelPlace?.latitude,
      longitude: Number.isFinite(c.longitude) ? c.longitude : hotelPlace?.longitude,
      address: c.address || '', place_id: 'serp-hotel', price_level: null, link: c.link || null,
    };
    _perRoomNight = Math.round(c.price_per_night);       // 실시간가는 반올림 없이
    _hotelPriceSource = 'serpapi';
  } else {
    _perRoomNight = Math.round(_hotelNightFor(t, plan.hotelType) / 1000) * 1000;
    _hotelPriceSource = 'estimate';
  }
  const hotelPerNightCost = plan.includeHotel ? _perRoomNight * _rooms : 0;
  console.log('[trip-flow] 숙박 — 1박 ' + hotelPerNightCost.toLocaleString('ko-KR') + '원 (' + _rooms + '실) × ' + nights + '박 = 총 ' + (hotelPerNightCost * nights).toLocaleString('ko-KR') + '원');

  // Helpers to build a "transition" activity (airport/hotel) with proper fields.
  // 항공권 — 실시간(SerpApi Google Flights) 우선, 실패/미지원 시 추정 공식 폴백.
  const _liveF = await _liveFlight(t, plan, features);
  const _flightPerPax = _liveF.perPax || null;      // 1인 왕복가
  const _flightSource = _flightPerPax ? 'serpapi' : 'estimate';
  const _flightMeta = _liveF.meta || null;
  // 항공편 시각 — 조회한 시각이 있으면 그 시각, 없으면 예상
  const flights = _plannedFlights(t);
  if (_flightMeta?.departure && _flightMeta?.arrival) {
    const clock = (x) => { const m = /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(x)); return m ? { iso: m[1], min: (+m[2]) * 60 + (+m[3]) } : null; };
    const d = clock(_flightMeta.departure), a = clock(_flightMeta.arrival);
    if (d && a) {
      const gap = Math.round((Date.parse(a.iso) - Date.parse(t.startDate)) / 86400000);
      if (gap >= 0 && gap <= 1) Object.assign(flights, { live: true, dep: d.min, arr: a.min, arrDay: gap, dur: Number(_flightMeta.duration) || flights.dur });
    }
  }
  // 왕복 1인가를 인원수만큼 곱해 그룹 총액 → 도착·출발에 절반씩 분배 (추정 폴백은 기존 공식)
  const _pax = _peopleCount(t);
  const flightTotalKRW = !plan.includeFlight ? 0 : (Number.isFinite(_flightPerPax) && _flightPerPax > 0)
    ? Math.round(_flightPerPax * _pax * (t.companion === 'group' ? 0.95 : 1) / 100) * 100
    : _calcFlightPrice(t);
  const flightHalfKRW  = Math.round(flightTotalKRW / 2 / 100) * 100;
  console.log('[trip-flow] 왕복 교통(' + (ground?.label || '항공') + ' ' + _flightSource + ') — 총 ' + flightTotalKRW.toLocaleString('ko-KR') + '원 (편도 ' + flightHalfKRW.toLocaleString('ko-KR') + '원)');

  function _airportItem(time, label) {
    const f = t.flight || {};
    const isArrival = (label || '').includes('도착');
    const line = _flightLine(t, isArrival, flights);
    // 실시간 항공편이 있으면 실제 편명·항공사·직항/경유로 보여 준다(시각은 조회한 값이 없으면 예상).
    const head = isArrival && _flightMeta?.airline
      ? [_flightMeta.flightCode || '', _flightMeta.airline, _flightMeta.stops ? `경유 ${_flightMeta.stops}회` : '직항'].filter(Boolean) : line.head;
    const flightInfo = [...head, ...line.tail].join(' · ');
    return {
      time,
      name: label ? `${airportName} (${label})` : airportName,
      category: '이동',
      // 가는 편은 절반, 오는 편은 나머지 — 두 편을 더하면 왕복 총액과 정확히 같다.
      cost: isArrival ? flightHalfKRW : flightTotalKRW - flightHalfKRW,
      ...(plan.includeFlight ? {} : { excludedFromBudget: true }),
      placeId: airportPlace?.place_id || `${ground ? 'station' : 'airport'}-${t.cityName}`,
      latitude:  airportPlace?.latitude,
      longitude: airportPlace?.longitude,
      // 공항 주소 대신 항공편 정보 (편명·항공사·시간) 표시
      address:   flightInfo,
      googleMapsQuery: airportName,
      ...(ground || airportPlace ? {} : { sample: true }),   // 찾지 못해 이름만 지은 공항
      flightMeta: {
        ...(ground ? { mode: ground.mode, line: ground.label, from: ground.from, to: ground.to, farePerPerson: ground.fare } : {}),
        roundTripKRW: flightTotalKRW,
        oneWayKRW:    flightHalfKRW,
        airline:      ground ? ground.label : _flightMeta?.airline || (f.airlines && f.airlines[0]) || (f.classType === 'lcc' ? '제주항공' : '대한항공'),
        flightCode:   _flightMeta?.flightCode || '',
        route:        f.route || 'any',
        startDate:    t.startDate,
        depTime: line.depTime, arrTime: line.arrTime, depDayOffset: line.depDayOffset, arrDayOffset: line.arrDayOffset,
        timeSource: isArrival && flights.live ? 'live' : 'estimate',
        source:       plan.includeFlight ? _flightSource : 'excluded',
      },
    };
  }
  function _hotelItem(time, label, cost) {
    const h = t.hotelP || {};
    const typeLbl = {
      luxury: '5성급', upscale: '4성급', midscale: '3성급', budget: '2성급', boutique: '부티크',
      resort: '리조트', ryokan: '료칸', bnb: 'B&B', hostel: '호스텔', apt: '아파트', capsule: '캡슐',
    };
    const typeNote = (h.types && h.types.length)
      ? ` · ${h.types.slice(0, 2).map(x => typeLbl[x] || x).join('/')}${h.types.length > 2 ? '+' : ''}`
      : '';
    return {
      time,
      name: (label ? `${hotelName} (${label})` : hotelName) + typeNote,
      category: '숙박',
      cost: plan.includeHotel ? (cost ?? 0) : 0,
      excludedFromBudget: !plan.includeHotel,
      placeId: hotelPlace?.place_id || `hotel-${t.cityName}`,
      latitude:  hotelPlace?.latitude,
      longitude: hotelPlace?.longitude,
      address:   hotelPlace?.address || '',
      googleMapsQuery: hotelName,
      ...(hotelPlace ? {} : { sample: true }),
    };
  }

  const totalDays = t.days || 1;
  // 실데이터(Places) vs 폴백(임시 명소) 슬롯 집계 — 너무 많이 폴백되면 사용자에게 안내.
  let _realSlots = 0, _fallbackSlots = 0;

  const transportPerDay = _localTransportPerDay(t) * people;
  for (let i = 0; i < totalDays; i++) {
    _genProgress(3, `${i + 1}일차 / 전체 ${totalDays}일`);
    const d = new Date(start); d.setDate(start.getDate() + i);
    const activities = [];

    const isLastDay   = (i === totalDays - 1);
    const isSingleDay = (totalDays === 1);
    const arrivalDay  = isSingleDay || localTrip ? 0 : flights.arrDay;
    const slots = _daySlots(t, i, totalDays, flights, localTrip);
    const firstSlot = slots.length ? timeToMin(slots[0][0]) : null;
    const lastEnd = slots.length ? timeToMin(slots[slots.length - 1][0]) + slots[slots.length - 1][2] : null;
    const up5 = (m) => minToTime(Math.ceil(m / 5) * 5);
    const where = { country: t.country, originCountry: t.originCountry, ride: flights.ride };
    const access = flights.ride ? STATION_MIN : 45;
    const flightBack = flights.back;
    const leaveCity = flightBack - beforeFlight(where) - access;      // 시내에서 공항·역으로 나서는 시각

    // ── 하루 시작 ──
    if (!localTrip && i < arrivalDay) {
      // 밤 비행 — 첫날은 기내에서 보내고 다음 날 도착한다
      const line = _flightLine(t, true, flights);
      days.push({ date: _isoLocal(d), localTransport: 0, activities: [{ time: line.depTime, name: `${t.originName || '출발지'}에서 출발 · 기내에서 1박`, category: '이동', cost: 0,
        placeId: `depart-${t.originName || ''}`, address: line.tail[0], googleMapsQuery: `${t.originName || ''} 공항` }] });
      continue;
    }
    if (!localTrip && i === arrivalDay) activities.push(_airportItem(minToTime(flights.arr), '도착'));
    if (!isSingleDay && i === arrivalDay) {
      const checkin = localTrip ? (firstSlot ?? 600) - 30 : flights.arr + landingMinutes(where) + access;
      activities.push(_hotelItem(up5(checkin), '체크인·짐 맡기기', 0));
    } else if (!isSingleDay) {
      // 마지막 날은 아침에 체크아웃하며 짐을 맡긴다
      const at = firstSlot != null ? firstSlot - 35 : (isLastDay && !localTrip ? Math.min(11 * 60, leaveCity - 15) : 9 * 60);
      activities.push(_hotelItem(up5(at), isLastDay ? (slots.length ? '체크아웃·짐 맡기기' : '체크아웃') : '출발', 0));
    }

    // ── 장소 ──
    for (const [time, slot, stayMin] of slots) {
      const si = slotTimes.findIndex(x => x[1] === slot);
      const round = Math.floor(i / 4);                 // 나흘마다 후보를 새로 받는다
      let candidates = await searchForSlot(slot, round);
      if (candidates.length && candidates.every(c => usedIds.has(c.place_id))) candidates = await searchForSlot(slot, round + 1);
      // 반반 — 하루 첫 관광 자리 하나만 유명한 곳으로
      const famousTurn = mode === 'mix' && CATEGORY_BY_SLOT[slot] === '관광' && !activities.some(a => a.local === 'famous') && famousPlaces.some(c => !usedIds.has(c.place_id));
      if (famousTurn) candidates = famousPlaces;
      const prevAct = activities[activities.length - 1];
      let pick = _pickUnused(candidates, usedIds, _isoLocal(d), time, prevAct, stayMin);
      // 문을 닫았거나 이미 다른 날에 쓴 곳뿐이면 같은 종류의 다른 후보(이미 찾아 둔 것)에서 다시 고른다.
      const shut = (c) => ['closedDay', 'closedNow'].includes(openState(c?.opening_periods, _isoLocal(d), time));
      if (!pick || shut(pick) || usedIds.has(pick.place_id)) {
        const alt = [...slotCache.entries()].filter(([k]) => CATEGORY_BY_SLOT[k.split('#')[0]] === CATEGORY_BY_SLOT[slot] && k.split('#')[0] !== slot).flatMap(([, v]) => v)
          .filter(c => !usedIds.has(c.place_id) && !shut(c));
        pick = _pickUnused(alt, usedIds, _isoLocal(d), time, prevAct, stayMin) || (pick && !usedIds.has(pick.place_id) ? pick : null);
      }

      if (pick) {
        _realSlots++;
        usedIds.add(pick.place_id);
        const cat = CATEGORY_BY_SLOT[slot] || '관광';
        activities.push({
          time,
          name: pick.name,
          category: shownCategory(pick, cat),
          ...(shownCategory(pick, cat) !== cat ? { costCategory: cat } : {}),
          cost: _costFor(cat, level, t.concept) * people,
          stayMin,
          placeId: pick.place_id,
          latitude: pick.latitude,
          longitude: pick.longitude,
          address: pick.address || '',
          googleMapsQuery: pick.name,
          openingPeriods: pick.opening_periods || null,
          stepFree: pick.step_free ?? null,
          local: mode === 'famous' ? '' : famousTurn ? 'famous' : (pick._local || localScore(pick, { famous, food: cat === '식사', level })).kind,
          rating: pick.rating ?? null, reviews: pick.user_rating_count ?? null,
        });
      } else {
        _fallbackSlots++;
        const fallback = _legacyMock(slot, i, Math.max(0, si));
        const costCat = CATEGORY_BY_SLOT[slot] || fallback.c;   // 비용·종류는 자리 기준 — 예산 계획과 같은 공식
        activities.push({
          time,
          name: `${fallback.n} · ${t.cityName}`,
          category: fallback.c,
          costCategory: costCat,
          cost: _costFor(costCat, level, t.concept) * people,
          stayMin,
          placeId: `${t.cityName}-${i}-${si}-${time}`,
          sample: true,
          googleMapsQuery: `${fallback.n} ${t.cityName}`,
        });
      }
    }

    // ── 하루 끝 ──
    if (isLastDay) {
      if (!isSingleDay && slots.length) activities.push(_hotelItem(up5(localTrip ? lastEnd + 20 : Math.min(lastEnd + 20, leaveCity - 15)), '짐 찾기', 0));
      if (!localTrip) activities.push(_airportItem(minToTime(flightBack), '출발'));
    } else if (!isSingleDay) {
      // 첫날 또는 중간일 저녁: 호텔 복귀 — 이날 밤 숙박 1박 비용 적용
      activities.push(_hotelItem(up5(Math.max((lastEnd ?? timeToMin(activities[activities.length - 1]?.time || '20:00') + 60) + 20, 0)), '복귀 (1박)', hotelPerNightCost));
    }

    // 현지 교통비는 장소가 아니라 하루 단위 비용이라 날짜에 따로 둔다(일별·전체 합계에 포함).
    days.push({ date: _isoLocal(d), activities, localTransport: transportPerDay });
  }
  // ── 꼭 갈 장소 — 날짜에 고르게 나눠 넣고 고정한다(관광·액티비티 자리를 대신, 없으면 15:00에 추가). ──
  const must = _mustList(t);
  if (must.length) {
    trackEvent('must_visit_used');
    for (let mi = 0; mi < must.length; mi++) {
      const name = must[mi];
      let found = t.mustResolved?.[name] || null;
      if (!found) try {
        const res = await _sp({ query: `${t.cityName} ${name}`, language_code: 'ko', language: 'ko', region: _guessRegion(t.country), max_results: 3, center_lat: cityCenter?.lat, center_lng: cityCenter?.lng });
        found = (res?.places || []).find(p => Number.isFinite(p.latitude)) || null;
      } catch (_) { found = null; }
      const day = days[mi % days.length];
      const slotIdx = day.activities.findIndex(a => (a.category === '관광' || a.category === '액티비티') && !a.mustVisit);
      const item = {
        stayMin: slotIdx >= 0 ? day.activities[slotIdx].stayMin : undefined,
        time: slotIdx >= 0 ? day.activities[slotIdx].time : '15:00',
        name: found?.name || name, category: '관광',
        cost: slotIdx >= 0 ? day.activities[slotIdx].cost : _costFor('관광', level, t.concept) * people,
        placeId: found?.place_id || `must-${mi}-${name}`,
        latitude: found?.latitude, longitude: found?.longitude, address: found?.address || '',
        googleMapsQuery: found?.name || `${name} ${t.cityName}`,
        openingPeriods: found?.opening_periods || null,
        stepFree: found?.step_free ?? null,
        pinned: true, mustVisit: true, sample: !found,
      };
      if (slotIdx >= 0) day.activities.splice(slotIdx, 1, item);
      else { day.activities.push(item); day.activities.sort((a, b) => (a.time || '').localeCompare(b.time || '')); }
    }
  }
  _genProgress(4, '');
  // 장소 검색이 전부 실패했는데 지금 일정에 실제 장소가 있으면, 예시 장소로 덮어쓰지 않고 지금 일정을 남긴다.
  if (_regenerating && placeStat.fails && !placeStat.ok && appState.generated?.days?.some(x => x.activities.some(a => a.category !== '이동' && a.category !== '숙박' && !a.sample))) {
    throw Object.assign(new Error('places failed'), { code: placeStat.last?.code || 'upstream', retryable: true });
  }

  // 결과 통화 — 원화가 아니면 유럽중앙은행 환율로 환산해 보여 준다(기준일 표시).
  let fx = null;
  const currency = t.currency || 'KRW';
  if (currency !== 'KRW') {
    try {
      const res = await _withTimeout(fetch(`https://api.frankfurter.dev/v1/latest?base=KRW&symbols=${currency}`), 6000, '환율');
      const data = res.ok ? await res.json() : null;
      const rate = data?.rates?.[currency];
      if (Number.isFinite(rate) && rate > 0) fx = { currency, rate, date: data.date, source: '유럽중앙은행(Frankfurter)' };
    } catch (e) { console.warn('[trip-flow] 환율 조회 실패 — 원화로 표시:', e?.message); }
  }

  const sources = {
    flight: !plan.includeFlight ? 'excluded' : _flightSource,          // 'serpapi' | 'estimate' | 'excluded'
    hotel: !plan.includeHotel ? 'excluded' : _hotelPriceSource,
    flightCheckedAt: _flightSource === 'serpapi' ? new Date().toISOString() : null,
    hotelCheckedAt: _hotelPriceSource === 'serpapi' ? new Date().toISOString() : null,
    placesReal: _realSlots,
    placesSample: _fallbackSlots,
    liveConfigured: { flights: !!features.liveFlights, hotels: !!features.liveHotels, ai: !!features.ai },
  };
  const providers = {
    flight: _liveF.state, hotel: _liveH.state,
    places: _prov('Google 장소', !placesOn ? 'off' : !placeStat.calls ? 'off' : placeStat.fails && !placeStat.ok ? 'failed' : placeStat.fails || _fallbackSlots ? 'partial' : 'live', {
      calls: placeStat.calls, fails: placeStat.fails, ms: placeStat.ms, real: _realSlots, sample: _fallbackSlots,
      code: !awake ? 'network' : !placesOn ? 'unconfigured' : placeStat.last?.code || '', reason: !awake ? _PROVIDER_TEXT.network[0] : !placesOn ? _PROVIDER_TEXT.unconfigured[0] : placeStat.last?.text || '',
      retryable: !awake || !!placeStat.last?.retryable,
    }),
  };
  const budgetPlan = {
    budget: plan.budget,
    estimate: plan.total,
    fits: plan.fits,
    hotelType: plan.hotelType,
    hotelLabel: plan.userChoseHotel ? '직접 고른 숙소 유형' : (HOTEL_TIER_LABEL[plan.hotelType] || ''),
    level: plan.level,
    levelLabel: LEVEL_LABEL[plan.level] || '',
    people: plan.people,
    rooms: plan.rooms,
    nights: Math.max(0, totalDays - 1 - (localTrip ? 0 : flights.arrDay)),
    includeFlight: plan.includeFlight,
    includeHotel: plan.includeHotel,
    localTrip,
  };

  const generated = {
    origin: t.origin || '',
    originName: t.originName || '',
    originCountry: t.originCountry || '',
    departureCity: t.originName || '',
    city: t.cityName,
    country: t.country,
    concept: t.concept,
    budget: (t.budget || 0) * 10000,
    currency,
    fx,
    timeZone: timeZoneFor(t.cityName, t.country),   // 일정의 모든 시각은 이 시간대의 현지 시각
    people: plan.people,
    startDate: t.startDate,
    endDate: t.endDate,
    days,
    createdAt: new Date().toISOString(),
    companion: t.companion,
    styles: [...t.styles],
    placeMode: mode,
    placeLang: mode === 'famous' ? 'ko' : lang,
    needs: [...(t.needs || [])],
    departureAirport: t.departureAirport || '', arrivalAirport: t.arrivalAirport || '',
    flight: t.flight ? { ...t.flight, airlines: [...(t.flight.airlines || [])] } : null,
    hotelPref: t.hotelP ? {
      types: [...(t.hotelP.types || [])],
      locations: [...(t.hotelP.locations || [])],
      amenities: [...(t.hotelP.amenities || [])],
    } : null,
    hotelPriceSource: _hotelPriceSource,   // 'serpapi' | 'estimate'
    flightPriceSource: _flightSource,      // 'serpapi' | 'estimate'
    // 실시간 조회를 시도했지만 실패 → 화면에 '조회 실패 · 추정가'로 알린다
    flightLiveFailed: _liveF.state.status === 'failed',
    hotelLiveFailed: _liveH.state.status === 'failed',
    sources,
    providers,
    budgetPlan,
    generationMs: Date.now() - startedAt,
    version: 3,
  };
  const keptPins = _mergePinned(generated, _pinnedCarry);
  const review = _verifyPlan(generated);
  // 다시 만들어도 계정에 저장한 일정이면 같은 저장 항목을 이어서 고친다.
  if (_regenerating && appState.generated?.savedScheduleId) generated.savedScheduleId = appState.generated.savedScheduleId;
  // 다시 만들어도 같은 여행 — 경비·준비물·예약 후보가 따라오도록 여행 번호와 예약 후보를 넘긴다.
  if (_regenerating && appState.generated?.tripUid) generated.tripUid = appState.generated.tripUid;
  if (_regenerating && appState.generated?.bookingCandidates) generated.bookingCandidates = appState.generated.bookingCandidates;
  appState.generated = generated;
  appState.expenses = {};
  t._draft = false;                      // 일정이 만들어졌으니 임시 저장은 끝

  _hideGenLoading();
  const _totalSlots = _realSlots + _fallbackSlots;
  if (_totalSlots > 0 && _fallbackSlots > _realSlots) {
    showToast(_realSlots ? '현지 장소를 충분히 찾지 못해 일부는 예시 장소로 채웠어요. 예시 장소에는 표시가 붙어 있어요.'
      : `장소 검색을 쓸 수 없어 모두 예시 장소로 채웠어요.${providers.places.retryable ? ' 잠시 뒤 ‘다시 만들기’로 다시 찾을 수 있어요.' : ''}`, 4200);
  } else if (!plan.fits) {
    showToast('일정을 만들었어요. 예산보다 많이 들어서 맞출 방법을 함께 보여 드려요.');
  } else {
    showToast(review.conflicts ? `일정을 만들었어요. 시간이 맞지 않는 곳 ${review.conflicts}건은 점검에서 확인해 주세요.` : keptPins ? `일정을 다시 만들었어요. 고정한 장소 ${keptPins}곳은 그대로 남겼어요` : '일정을 만들었어요');
  }
  navigate('schedule');
}

/** 만든 일정을 검사하고 풀 수 있는 충돌은 바로 푼다. 결과는 일정에 남겨 화면이 같은 값을 쓴다. */
function _verifyPlan(g) {
  const r = repairTrip(g);
  g.days = r.days;
  const left = checkTrip(g);
  g.validation = {
    checkedAt: new Date().toISOString(), timeZone: g.timeZone,
    foundBefore: r.before.conflicts.length, conflicts: left.conflicts.length, info: left.info.length,
    changes: r.changes.map(({ type, di, name, from, to, reason }) => ({ type, di, name, from, to, reason })), blocked: r.blocked,
  };
  if (left.conflicts.length) trackEvent('gen_time_conflict_left');
  return g.validation;
}

/** Legacy mock — used only when Places API is unavailable. */
const _LEGACY_MOCK = {
  morning:   [{n:'동네 빵집', c:'식사'},{n:'동네 카페 아침', c:'카페'},{n:'아침 시장', c:'쇼핑'},{n:'공원 산책', c:'관광'}],
  forenoon:  [{n:'동네 시장', c:'관광'},{n:'골목 산책', c:'관광'},{n:'동네 공원', c:'관광'},{n:'동네 작은 미술관', c:'관광'}],
  lunch:     [{n:'동네 식당', c:'식사'},{n:'오래된 식당', c:'식사'},{n:'시장 안 식당', c:'식사'},{n:'채식 식당', c:'식사'}],
  afternoon: [{n:'동네 서점', c:'쇼핑'},{n:'소품 가게 골목', c:'쇼핑'},{n:'동네 카페', c:'카페'},{n:'공방 체험', c:'액티비티'}],
  evening:   [{n:'강변 산책로', c:'관광'},{n:'동네 노을 언덕', c:'관광'},{n:'작은 공연장', c:'액티비티'},{n:'동네 야시장', c:'쇼핑'}],
  dinner:    [{n:'동네 저녁 식당', c:'식사'},{n:'선술집', c:'식사'},{n:'가족이 하는 식당', c:'식사'},{n:'동네 노포', c:'식사'}],
  activity:  [{n:'공방 체험', c:'액티비티'},{n:'동네 자전거길', c:'액티비티'},{n:'생활체육', c:'액티비티'}],
  spa:       [{n:'동네 목욕탕', c:'액티비티'},{n:'온천', c:'액티비티'},{n:'마사지', c:'액티비티'}],
  shopping:  [{n:'재래시장', c:'쇼핑'},{n:'구제 가게 골목', c:'쇼핑'}],
  premium:   [{n:'단골 많은 식당', c:'식사'},{n:'조용한 저녁 식당', c:'식사'}],
};
function _legacyMock(slot, dayIdx, slotIdx) {
  const arr = _LEGACY_MOCK[slot] || _LEGACY_MOCK.lunch;
  return arr[(dayIdx * 7 + slotIdx) % arr.length];
}
