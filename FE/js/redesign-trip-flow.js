/* 3초 여행 — Redesign Trip Creation Flow (v2)
 * 4-step survey with:
 *   - Global city autocomplete (CITIES dataset)
 *   - Custom bottom-sheet calendar (past dates blocked)
 *   - Direct budget input with auto level + smart suggestion (city×days×season×companion)
 */

import { navigate } from './redesign-navigation.js';
import { el, $, $$, setActiveByData, setMultiActive, diffDays, showToast, formatCurrency } from './redesign-ui.js';
import { CITIES, listCountries, citiesIn, searchCities, findCity } from './redesign-cities.js';
import { openCalendar } from './redesign-calendar.js';
import { api } from './redesign-api-adapter.js';

const CONCEPTS = [
  { key: '가성비',   emoji: '💰', desc: '합리적인 가격으로 알차게' },
  { key: '균형',     emoji: '⚖️', desc: '관광·음식·휴식을 골고루' },
  { key: '프리미엄', emoji: '✨', desc: '럭셔리·편안함 중심' },
  { key: '효율',     emoji: '🚀', desc: '짧은 시간에 핵심만' },
  { key: '힐링',     emoji: '🌿', desc: '여유롭고 편안한 일정' },
  { key: '액티비티', emoji: '⚡', desc: '액티브·경험 중심' },
];

const STYLES = ['맛집 중심','쇼핑 중심','자연 중심','사진 명소','로컬 감성','유명 관광지','여유로운 일정','빽빽한 일정'];

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
let citySuggFocusIdx = -1;
let originSuggFocusIdx = -1;

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
  _buildQuickDest();
  _bindOriginSearch();
  _bindCitySearch();
  _bindStepHandlers();
  _bindFormHandlers();
  _bindDateTriggers();
  _bindBudgetHandlers();

  document.addEventListener('redesign:trip-prefill', () => {
    _applyState();
    step = 1; _showStep();
  });

  document.addEventListener('redesign:nav', (e) => {
    if (e.detail.page === 'create-trip') {
      // meta.prefill === true 면 외부에서 trip 상태 미리 채워둔 것 → 보존
      // 그렇지 않으면 (홈/FAB/탭 등에서 신규 진입) 깨끗하게 초기화
      if (!e.detail.meta?.prefill) {
        _resetTripState();
      }
      step = 1; _showStep(); _applyState();
    }
  });
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
      onclick: () => _applyCity(findCity(c => c.name === d.name)),
    }, [el('span', {}, d.emoji), el('span', {}, d.name)]));
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
        setActiveByData(grid, 'data-concept-key', c.key);
        _refreshBudget(); // concept doesn't change suggestion but keeps UI fresh
      }
    }, [
      el('span', { class: 'cc-emoji' }, c.emoji),
      el('div', { class: 'cc-title' }, c.key),
      el('div', { class: 'cc-desc' }, c.desc),
    ]));
  });
}
function _buildStyles() {
  const wrap = $('#styleChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  STYLES.forEach(s => {
    wrap.appendChild(el('button', {
      type: 'button',
      class: 'chip',
      dataset: { styleKey: s },
      onclick: (e) => {
        const k = e.currentTarget.dataset.styleKey;
        const arr = appState.trip.styles;
        const idx = arr.indexOf(k);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(k);
        setMultiActive(wrap, 'data-style-key', arr);
      }
    }, s));
  });
}

/* ============ Origin (departure) city autocomplete ============
 * Departure cities — Korean cities ranked first, then all others.
 * Keeps full free-text input so users can type anything not in the list.
 */
function _bindOriginSearch() {
  const input = $('#tripOrigin');
  const sugg  = $('#originSuggestions');
  const clear = $('#originClear');
  if (!input || !sugg) return;

  input.addEventListener('input', () => {
    const q = input.value;
    appState.trip.originName = q.trim();         // free-text fallback
    if (clear) clear.hidden = !q;
    _renderOriginSuggestions(q);
    _hideOriginMessage();
  });
  input.addEventListener('focus', () => {
    if (input.value) _renderOriginSuggestions(input.value);
    else _renderOriginSuggestions('서울');       // surface popular KR cities on focus
  });
  input.addEventListener('keydown', (e) => {
    const items = $$('.city-sug-item', sugg);
    if (e.key === 'ArrowDown') { e.preventDefault(); originSuggFocusIdx = Math.min(items.length - 1, originSuggFocusIdx + 1); _highlightSuggestion(items, originSuggFocusIdx); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); originSuggFocusIdx = Math.max(0, originSuggFocusIdx - 1); _highlightSuggestion(items, originSuggFocusIdx); }
    else if (e.key === 'Enter') { if (items[originSuggFocusIdx]) { e.preventDefault(); items[originSuggFocusIdx].click(); } }
    else if (e.key === 'Escape') { sugg.hidden = true; }
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.hidden = true;
  });
  clear?.addEventListener('click', () => {
    input.value = ''; clear.hidden = true; sugg.hidden = true;
    appState.trip.origin = ''; appState.trip.originName = '';
    appState.trip.departureAirport = ''; appState.trip.departureAirportName = '';
    _hideOriginMessage();
  });
}

function _renderOriginSuggestions(query) {
  const sugg = $('#originSuggestions');
  if (!sugg) return;
  // For origin we prioritize Korea cities, fall back to global.
  let list = searchCities(query, 8);
  if (!query || query.trim().length === 0) list = CITIES.filter(c => c.country === '대한민국').slice(0, 6);
  originSuggFocusIdx = -1;
  if (list.length === 0) {
    // free-text mode: leave hidden — user can type any city they want
    sugg.hidden = true;
    return;
  }
  sugg.hidden = false;
  sugg.innerHTML = '';
  list.forEach(c => {
    const btn = el('button', {
      type: 'button',
      class: 'city-sug-item',
      role: 'option',
      onclick: () => _applyOrigin(c),
    }, [
      el('span', { class: 'csi-flag' }, c.flag),
      el('div', { class: 'csi-text' }, [
        el('span', { class: 'csi-name' }, c.name),
        el('span', { class: 'csi-country' }, c.country),
      ]),
      el('span', { class: 'csi-region' }, c.region),
    ]);
    sugg.appendChild(btn);

    // 공항이 여러 개인 출발 도시는 공항 선택지 노출 (예: 서울 → 인천 · 김포)
    const airports = _CITY_AIRPORTS[c.key];
    if (airports) {
      airports.forEach(([iata, ko]) => {
        sugg.appendChild(el('button', {
          type: 'button',
          class: 'city-sug-airport',
          role: 'option',
          onclick: () => _applyOrigin(c, { iata, ko }),
        }, [
          el('span', { class: 'csa-icon' }, '✈'),
          el('span', { class: 'csa-name' }, `${ko} 공항`),
          el('span', { class: 'csa-code' }, iata),
        ]));
      });
    }
  });
}

function _applyOrigin(c, airport) {
  appState.trip.origin = c.key;
  appState.trip.originName = c.name;
  appState.trip.originCountry = c.country;
  if (airport) {
    appState.trip.departureAirport = airport.iata;
    appState.trip.departureAirportName = airport.ko;
    $('#tripOrigin').value = `${c.name} · ${airport.ko}(${airport.iata})`;
  } else {
    appState.trip.departureAirport = '';
    appState.trip.departureAirportName = '';
    $('#tripOrigin').value = c.name;
  }
  $('#originClear').hidden = false;
  $('#originSuggestions').hidden = true;
  _hideOriginMessage();
}

function _showOriginMessage(text, kind) {
  const m = $('#originMessage');
  if (!m) return;
  m.hidden = false;
  m.textContent = text;
  m.style.color = kind === 'error' ? 'var(--c-danger)' : 'var(--c-text-soft)';
}
function _hideOriginMessage() {
  const m = $('#originMessage');
  if (m) { m.hidden = true; m.textContent = ''; }
}

/* ============ City autocomplete ============ */
function _bindCitySearch() {
  const input = $('#tripCitySearch');
  const sugg  = $('#citySuggestions');
  const clear = $('#cityClear');
  if (!input || !sugg) return;

  input.addEventListener('input', () => {
    const q = input.value;
    clear.hidden = !q;
    _renderSuggestions(q);
  });
  input.addEventListener('focus', () => {
    if (input.value) _renderSuggestions(input.value);
  });
  input.addEventListener('keydown', (e) => {
    const items = $$('.city-sug-item', sugg);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      citySuggFocusIdx = Math.min(items.length - 1, citySuggFocusIdx + 1);
      _highlightSuggestion(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      citySuggFocusIdx = Math.max(0, citySuggFocusIdx - 1);
      _highlightSuggestion(items);
    } else if (e.key === 'Enter') {
      if (items[citySuggFocusIdx]) { e.preventDefault(); items[citySuggFocusIdx].click(); }
    } else if (e.key === 'Escape') {
      sugg.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !sugg.contains(e.target)) sugg.hidden = true;
  });
  clear?.addEventListener('click', () => {
    input.value = ''; clear.hidden = true; sugg.hidden = true;
    appState.trip.cityName = ''; appState.trip.city = ''; appState.trip.country = '';
    appState.trip.arrivalAirport = ''; appState.trip.arrivalAirportName = '';
    _updateSelectedHint(null);
  });

  // Country/city advanced selects
  $('#tripCountry')?.addEventListener('change', (e) => {
    _buildCities(e.target.value);
  });
  $('#tripCity')?.addEventListener('change', (e) => {
    const key = e.target.value;
    const c = findCity(x => x.key === key);
    if (c) _applyCity(c);
  });
}

function _renderSuggestions(query) {
  const sugg = $('#citySuggestions');
  if (!sugg) return;
  const list = searchCities(query, 8);
  citySuggFocusIdx = -1;
  if (list.length === 0) {
    sugg.hidden = false;
    sugg.innerHTML = '';
    sugg.appendChild(el('div', { class: 'city-sug-empty' }, '검색 결과가 없어요'));
    return;
  }
  sugg.hidden = false;
  sugg.innerHTML = '';
  list.forEach((c, i) => {
    const btn = el('button', {
      type: 'button',
      class: 'city-sug-item',
      role: 'option',
      onclick: () => _applyCity(c),
    }, [
      el('span', { class: 'csi-flag' }, c.flag),
      el('div', { class: 'csi-text' }, [
        el('span', { class: 'csi-name' }, c.name),
        el('span', { class: 'csi-country' }, c.country),
      ]),
      el('span', { class: 'csi-region' }, c.region),
    ]);
    sugg.appendChild(btn);

    // 공항이 여러 개인 도시는 바로 아래에 공항 선택지 노출 (예: 서울 → 인천 · 김포)
    const airports = _CITY_AIRPORTS[c.key];
    if (airports) {
      airports.forEach(([iata, ko]) => {
        sugg.appendChild(el('button', {
          type: 'button',
          class: 'city-sug-airport',
          role: 'option',
          onclick: () => _applyCity(c, { iata, ko }),
        }, [
          el('span', { class: 'csa-icon' }, '✈'),
          el('span', { class: 'csa-name' }, `${ko} 공항`),
          el('span', { class: 'csa-code' }, iata),
        ]));
      });
    }
  });
}
function _highlightSuggestion(items, idx) {
  const focusIdx = (idx == null) ? citySuggFocusIdx : idx;
  items.forEach((it, i) => it.classList.toggle('is-focus', i === focusIdx));
}

function _applyCity(c, airport) {
  if (!c) return;
  appState.trip.cityName = c.name;
  appState.trip.city = c.key;
  appState.trip.country = c.country;
  appState.trip.cityTier = c.tier;
  appState.trip.cityFlag = c.flag;
  if (airport) {
    appState.trip.arrivalAirport = airport.iata;
    appState.trip.arrivalAirportName = airport.ko;
    $('#tripCitySearch').value = `${c.name} · ${airport.ko}(${airport.iata})`;
  } else {
    appState.trip.arrivalAirport = '';
    appState.trip.arrivalAirportName = '';
    $('#tripCitySearch').value = c.name;
  }
  $('#cityClear').hidden = false;
  $('#citySuggestions').hidden = true;
  // Sync advanced selects too
  const cSel = $('#tripCountry'); const citySel = $('#tripCity');
  if (cSel) { cSel.value = c.country; _buildCities(c.country); }
  if (citySel) citySel.value = c.key;
  setActiveByData($('#destQuick'), 'data-dest-quick', c.name);
  _updateSelectedHint(c);
  _refreshBudget();
}

function _updateSelectedHint(c) {
  const hint = $('#citySelectedHint');
  if (!hint) return;
  if (!c) { hint.hidden = true; hint.textContent = ''; return; }
  hint.hidden = false;
  hint.textContent = `✓ ${c.flag} ${c.name}, ${c.country} 선택됨`;
  hint.classList.add('city-selected-hint');
}

/* ============ Date triggers + calendar ============ */
function _bindDateTriggers() {
  $('#tripStartTrigger')?.addEventListener('click', () => _openCal('start'));
  $('#tripEndTrigger')?.addEventListener('click', () => _openCal('end'));
}
function _openCal(focus) {
  openCalendar({
    start: appState.trip.startDate,
    end:   appState.trip.endDate,
    focus,
    onApply: ({ start, end }) => {
      appState.trip.startDate = start;
      appState.trip.endDate   = end;
      _refreshDuration();
      _refreshDateTriggers();
      _refreshBudget();
    },
  });
}
function _refreshDateTriggers() {
  const sBtn = $('#tripStartTrigger'); const eBtn = $('#tripEndTrigger');
  const sLbl = $('#tripStartLabel');   const eLbl = $('#tripEndLabel');
  if (sLbl) sLbl.textContent = appState.trip.startDate ? _fmt(appState.trip.startDate) : '선택';
  if (eLbl) eLbl.textContent = appState.trip.endDate   ? _fmt(appState.trip.endDate)   : '선택';
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
      appState.trip.companion = b.dataset.companion;
      setActiveByData(b.parentElement, 'data-companion', b.dataset.companion);
      _syncPeopleRow();          // 가족/단체면 인원 입력칸 표시 + 기본값
      _refreshBudget();
    });
  });

  // 인원수 입력(가족/단체) — 입력/증감 시 항공·숙소·예산 추천 갱신
  const _applyPeople = (v) => {
    const n = Math.max(_PEOPLE_MIN, Math.min(_PEOPLE_MAX, Math.round(Number(v) || _PEOPLE_MIN)));
    appState.trip.people = n;
    const inp = $('#peopleCount'); if (inp) inp.value = String(n);
    _refreshBudget();
  };
  const _curPeople = () => appState.trip.people || _PEOPLE_COUNT[appState.trip.companion] || _PEOPLE_MIN;
  $('#peopleCount')?.addEventListener('input', (e) => { appState.trip.people = Math.round(Number(e.target.value) || 0) || null; _refreshBudget(); });
  $('#peopleCount')?.addEventListener('change', (e) => _applyPeople(e.target.value));  // blur 시 범위 보정
  $('#peopleMinus')?.addEventListener('click', () => _applyPeople(_curPeople() - 1));
  $('#peoplePlus')?.addEventListener('click',  () => _applyPeople(_curPeople() + 1));
  $('#tripCurrency')?.addEventListener('change', (e) => {
    appState.trip.currency = e.target.value;
    _refreshSummary();
    _refreshBudgetMarkLabels();
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
    _refreshBudget();
    _refreshSummary();
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
}

function _bindStepHandlers() {
  $('#stepPrev')?.addEventListener('click', () => { if (step > 1) { step--; _showStep(); } else { navigate('home'); } });
  $('#stepNext')?.addEventListener('click', () => {
    if (!_validateStep()) return;
    if (step < 4) { step++; _showStep(); }
  });
  $('#stepGenerate')?.addEventListener('click', async () => {
    if (!_validateStep()) return;
    try {
      await _generateSchedule();
    } catch (e) {
      console.error('[trip-flow] 일정 생성 실패:', e);
      showToast('일정 생성 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      _hideGenLoading();
      const b = $('#stepGenerate'); if (b) { b.disabled = false; b.textContent = '일정 생성하기 ✨'; }
    }
  });
}

/* ============ Budget — direct input + smart suggestion ============ */
const COMPANION_MULT = { solo:1.0, friend:0.95, couple:1.05, family:0.85, group:0.75 };

function _seasonMult(startISO) {
  if (!startISO) return 1.0;
  const m = parseInt(startISO.split('-')[1], 10);
  if ([7,8,12,1].includes(m)) return 1.25;   // peak
  if ([4,5,9,10,11].includes(m)) return 1.05; // shoulder
  return 0.9;                                 // off
}
function _baselineFor(tier) {
  return ({ high: 35, mid: 22, low: 12 })[tier] || 20;
}
function _round10(n) { return Math.max(10, Math.round(n / 10) * 10); }

/** Compute suggested budget in 만원 — 활동 + 항공 + 숙박 모두 포함. */
function _computeSuggested() {
  const t = appState.trip;
  const days = Math.max(1, t.days || diffDays(t.startDate, t.endDate) || 1);
  const cmp = COMPANION_MULT[t.companion] ?? 1;
  const season = _seasonMult(t.startDate);
  const concept = CONCEPT_MULT[t.concept] ?? 1;

  // 1) 활동 비용 (식사·관광·쇼핑·체험 등) — 만원 단위
  const activityWon = _baselineFor(t.cityTier) * days * cmp * season * concept * 10000;

  // 2) 항공 — 왕복 1인 기준
  const flightWon = t.cityName ? _calcFlightPrice(t) : 0;

  // 3) 숙박 — 1박 가격 × (days - 1) 박 × 방 수
  const nights = Math.max(0, days - 1);
  const rooms = _roomCount(t);
  const hotelWon = _calcHotelPerNight(t) * nights * rooms;

  const totalWon = activityWon + flightWon + hotelWon;
  const totalMW  = Math.round(totalWon / 10000);   // 만원

  const people = _peopleCount(t);
  // 디버그 — 콘솔에서 산정 내역 확인 가능
  console.log('[추천예산] 활동 ' + Math.round(activityWon/10000) + '만 + 항공 ' +
              Math.round(flightWon/10000) + '만 (' + people + '명) + 숙박 ' +
              Math.round(hotelWon/10000) + '만 (' + nights + '박 × ' + rooms + '실) = ' + totalMW + '만');

  // breakdown 캐싱 — 텍스트 표시에서 사용
  appState.trip._budgetBreakdown = {
    activityMW: Math.round(activityWon / 10000),
    flightMW:   Math.round(flightWon   / 10000),
    hotelMW:    Math.round(hotelWon    / 10000),
    nights,
    rooms,
    people,
    perNightWon: _calcHotelPerNight(t),
  };

  return _round10(totalMW);
}

function _refreshBudget() {
  const t = appState.trip;
  const mid = _computeSuggested();
  const low  = _round10(mid * 0.62);
  const high = _round10(mid * 1.6);

  // Initialize input if empty
  const inp = $('#tripBudgetInput');
  if (inp) {
    if (!t.budget || t.budget === 120) { t.budget = mid; inp.value = mid; }
    else inp.value = String(t.budget);
  }

  const sText = $('#budgetSuggestText');
  if (sText) {
    const factors = [];
    if (t.cityName) factors.push(`${t.cityName}(${({high:'고물가',mid:'중간',low:'저물가'})[t.cityTier] || ''})`);
    factors.push(`${t.days||'-'}일`);
    factors.push(_companionLabelShort(t.companion));
    const sm = _seasonMult(t.startDate);
    factors.push(sm > 1.2 ? '성수기' : (sm < 1 ? '비수기' : '준성수기'));
    if (t.concept) factors.push(`${t.concept} 컨셉`);
    // breakdown — 왕복항공 + 숙소(1박×n박) + 타 장소 (계획 페이지와 동일 공식)
    // 1박 단가는 hotelMW/박수로 환산 — 방 수가 반영된 실효 단가라 합계와 일치.
    const bd = t._budgetBreakdown || {};
    const hotelPart = (bd.nights)
      ? `숙소 ${Math.round(bd.hotelMW / bd.nights)}만×${bd.nights}박`
      : `숙소 ${bd.hotelMW}만`;
    const bdLine = (bd.activityMW != null)
      ? `<br/><span style="font-size:11px;color:var(--c-text-soft,#6b6555)">왕복항공 ${bd.flightMW}만 (${bd.people}명) + ${hotelPart} + 타 장소 ${bd.activityMW}만</span>`
      : '';
    sText.innerHTML = `추천 <strong>${mid}만원</strong> · ${factors.filter(Boolean).join(' · ')}` + bdLine;
  }

  // Marks labels & active states
  const lowEl = $('#bmLow'); const midEl = $('#bmMid'); const highEl = $('#bmHigh');
  if (lowEl)  lowEl.textContent  = `${low}만원`;
  if (midEl)  midEl.textContent  = `${mid}만원`;
  if (highEl) highEl.textContent = `${high}만원`;

  // Stash for click handlers
  appState.trip._suggested = { low, mid, high };
  _refreshLevelBadge();
}

function _refreshBudgetMarkLabels() {
  // currency conversion display — keep label in 만원 for now (KRW unit)
}

function _refreshLevelBadge() {
  const t = appState.trip;
  const badge = $('#budgetLevelBadge');
  if (!badge) return;
  const sug = t._suggested || {};
  if (!sug.mid || !t.budget) { badge.innerHTML = '정도: -'; return; }
  let lvl = '보통';
  let cls = 'is-mid';
  const ratio = t.budget / sug.mid;
  if (ratio < 0.78) { lvl = '낮음'; cls = 'is-low'; }
  else if (ratio > 1.35) { lvl = '높음'; cls = 'is-high'; }
  t.budgetLevel = lvl;
  badge.innerHTML = `정도: <span class="lvl-pill ${cls}">${lvl}</span>`;
}

function _bindBudgetHandlers() {
  $('#tripBudgetInput')?.addEventListener('input', (e) => {
    const v = Number(e.target.value) || 0;
    appState.trip.budget = v;
    _refreshLevelBadge();
    _refreshSummary();
  });
  $('#budgetApplyBtn')?.addEventListener('click', () => {
    const sug = appState.trip._suggested || {};
    if (!sug.mid) return;
    appState.trip.budget = sug.mid;
    $('#tripBudgetInput').value = String(sug.mid);
    _refreshLevelBadge();
    _refreshSummary();
    showToast('추천 예산 적용');
  });
  document.querySelectorAll('[data-budget-level]').forEach(b => {
    b.addEventListener('click', () => {
      const lvl = b.dataset.budgetLevel;
      const sug = appState.trip._suggested || {};
      const v = lvl === '낮음' ? sug.low : (lvl === '높음' ? sug.high : sug.mid);
      if (!v) return;
      appState.trip.budget = v;
      $('#tripBudgetInput').value = String(v);
      setActiveByData(b.parentElement, 'data-budget-level', lvl);
      _refreshLevelBadge();
      _refreshSummary();
    });
  });
}

/* ============ Duration / Summary / Steps ============ */
function _refreshDuration() {
  const d = diffDays(appState.trip.startDate, appState.trip.endDate);
  appState.trip.days = d;
  const t = $('#tripDuration');
  if (t) t.textContent = d ? `기간: ${d}일 (${appState.trip.startDate} → ${appState.trip.endDate})` : '기간: -';
}

function _refreshSummary() {
  const s = $('#tripSummary');
  if (!s) return;
  const t = appState.trip;
  const f = t.flight || {};
  const h = t.hotelP || {};
  const routeLbl = { any: '노선 상관없음', direct: '직항만', transit: '경유 포함' }[f.route] || '노선 미선택';
  const clsLbl   = { any: '등급 상관없음', lcc: '저가 (LCC)', fsc: '대형 (FSC)' }[f.classType] || '등급 미선택';
  const airlines = (f.airlines && f.airlines.length) ? f.airlines.join(', ') : '선호 항공사 -';
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
  const types = (h.types || []).map(x => hotelTypeLbl[x] || x).join(', ') || '유형 -';
  const locs  = (h.locations || []).map(x => hotelLocLbl[x]  || x).join(', ') || '위치 -';
  const amens = (h.amenities || []).map(x => hotelAmenLbl[x] || x).join(', ') || '편의시설 -';

  s.innerHTML = `
    <strong>${t.cityName || '도시 미선택'}</strong> · ${t.days || '-'}일 ·
    <strong>${t.concept || '컨셉 미선택'}</strong><br/>
    예산 <strong>${t.budget||0}만원</strong> (${t.budgetLevel || '-'}) · ${t.currency}<br/>
    동행 ${_companionLabel(t.companion)} · 스타일 ${t.styles.length ? t.styles.join(', ') : '-'}<br/>
    ✈ ${routeLbl} · ${clsLbl}<br/>
    ✈ ${airlines}<br/>
    🏨 ${types} · ${locs}<br/>
    🏨 ${amens}
  `;
}

function _companionLabel(k) { return ({ solo:'혼자', friend:'친구', couple:'커플', family:'가족', group:'단체' })[k] || '-'; }
function _companionLabelShort(k) { return ({ solo:'1인', friend:'친구', couple:'커플', family:'가족', group:'단체' })[k] || ''; }

function _showStep() {
  $$('#tripStepProgress .step-dot').forEach(d => {
    const n = Number(d.dataset.step);
    d.classList.toggle('is-active', n === step);
    d.classList.toggle('is-done', n < step);
  });
  $$('#tripStepProgress .step-line').forEach((line, i) => {
    line.classList.toggle('is-done', i < step - 1);
  });
  $$('#createTripPage .step-pane').forEach(p => {
    const on = Number(p.dataset.stepPane) === step;
    p.classList.toggle('is-active', on);
    p.hidden = !on;
  });
  $('#stepPrev').textContent = step === 1 ? '취소' : '이전';
  $('#stepNext').hidden = step === 4;
  $('#stepGenerate').hidden = step !== 4;
  if (step === 4) { _refreshBudget(); _refreshSummary(); }
}

function _validateStep() {
  const t = appState.trip;
  if (step === 1) {
    if (!t.originName) {
      showToast('출발 도시를 입력해주세요.');
      _showOriginMessage('출발 도시를 입력해주세요.', 'error');
      $('#tripOrigin')?.focus();
      return false;
    }
    if (!t.cityName) { showToast('도착 도시를 선택해 주세요'); return false; }
  }
  if (step === 2) {
    if (!t.startDate || !t.endDate) { showToast('출발/도착일을 선택해 주세요'); return false; }
    if (t.days < 1) { showToast('날짜 순서를 확인해 주세요'); return false; }
  }
  if (step === 3) {
    if (!t.concept) { showToast('컨셉을 한 가지 선택해 주세요'); return false; }
  }
  if (step === 4) {
    if (!t.budget) { showToast('예산을 입력해 주세요'); return false; }
  }
  return true;
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
  t.concept = '';
  t.styles = [];
  t.budget = 0;
  t.budgetLevel = '보통';
  t._suggested = undefined;
  t.flight = { route: 'any', classType: 'any', airlines: [] };
  t.hotelP = { types: [], locations: [], amenities: [] };
  // (currency 는 사용자 선택이라 유지)
  step = 1;

  // UI 입력 필드 비우기
  const reset = (sel, val = '') => { const el = $(sel); if (el) el.value = val; };
  reset('#tripOrigin');
  reset('#tripCitySearch');
  reset('#tripBudgetInput');
  const oc = $('#originClear'); if (oc) oc.hidden = true;
  const cc = $('#cityClear');   if (cc) cc.hidden = true;
  const hint = $('#citySelectedHint'); if (hint) { hint.hidden = true; hint.textContent = ''; }
  const sLbl = $('#tripStartLabel'); if (sLbl) sLbl.textContent = '선택';
  const eLbl = $('#tripEndLabel');   if (eLbl) eLbl.textContent = '선택';
  const dur  = $('#tripDuration');   if (dur)  dur.textContent = '기간: -';
  const sBtn = $('#tripStartTrigger'); if (sBtn) sBtn.classList.add('is-empty');
  const eBtn = $('#tripEndTrigger');   if (eBtn) eBtn.classList.add('is-empty');

  // 컨셉/스타일/동행 칩 active 해제
  $$('#conceptGrid .concept-card').forEach(b => b.classList.remove('is-active'));
  $$('#styleChips .chip').forEach(b => b.classList.remove('is-active'));
  $$('[data-companion]').forEach(b => b.classList.toggle('is-active', b.dataset.companion === 'couple'));
  _syncPeopleRow();   // couple → 인원 입력칸 숨김 + people 초기화
  $$('[data-dest-quick]').forEach(b => b.classList.remove('is-active'));
  // 항공·호텔 chip 초기화
  $$('#flightRouteChips .chip, #flightClassChips .chip').forEach(b => b.classList.remove('is-active'));
  $$('#airlineChips .chip').forEach(b => { b.classList.remove('is-active'); b.classList.remove('is-dim'); });
  $$('#hotelTypeChips .chip, #hotelLocChips .chip, #hotelAmenChips .chip').forEach(b => b.classList.remove('is-active'));
}

function _applyState() {
  const t = appState.trip;
  // restore origin from state
  if (t.originName) {
    const oi = $('#tripOrigin'); if (oi) oi.value = t.originName;
    const oc = $('#originClear'); if (oc) oc.hidden = false;
  }
  if (t.cityName) {
    const c = findCity(x => x.name === t.cityName || x.key === t.city);
    if (c) _applyCity(c);
    else $('#tripCitySearch').value = t.cityName;
  }
  _refreshDateTriggers();
  _refreshDuration();
  if (t.companion) setActiveByData(document.querySelector('.choice-grid'), 'data-companion', t.companion);
  _syncPeopleRow();   // 복원 시 가족/단체면 인원 입력칸 + 값 복원
  if (t.concept) setActiveByData(document.getElementById('conceptGrid'), 'data-concept-key', t.concept);
  setMultiActive(document.getElementById('styleChips'), 'data-style-key', t.styles);
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
const _PEOPLE_MIN = 2;
const _PEOPLE_MAX = 20;

/** 실제 인원수 — 가족/단체면 사용자가 입력한 t.people 우선, 아니면 동행 기본값. */
function _peopleCount(t) {
  if ((t.companion === 'family' || t.companion === 'group') && t.people) {
    return Math.max(_PEOPLE_MIN, Math.min(_PEOPLE_MAX, t.people));
  }
  return _PEOPLE_COUNT[t.companion] || 1;
}
/** 객실 수 — 2인 1실 기준. */
function _roomCount(t) {
  return Math.max(1, Math.ceil(_peopleCount(t) / 2));
}

/** 가족/단체면 인원 입력칸을 보여주고 기본값을 세팅, 그 외엔 숨기고 입력을 비운다. */
function _syncPeopleRow() {
  const t = appState.trip;
  const row = document.getElementById('peopleCountRow');
  const isMulti = (t.companion === 'family' || t.companion === 'group');
  if (row) row.hidden = !isMulti;
  if (isMulti) {
    if (!t.people) t.people = _PEOPLE_COUNT[t.companion] || _PEOPLE_MIN;   // 가족 4 / 단체 6 기본
    const inp = document.getElementById('peopleCount');
    if (inp) { inp.min = String(_PEOPLE_MIN); inp.max = String(_PEOPLE_MAX); inp.value = String(t.people); }
  } else {
    t.people = null;   // 고정 인원으로 복귀
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

function _calcFlightPrice(t) {
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
function _generateFlightInfo(t, isArrival, departTime) {
  const f = t.flight || {};
  const airline = (f.airlines && f.airlines.length)
    ? f.airlines[0]
    : (f.classType === 'lcc' ? '제주항공' : (f.classType === 'fsc' ? '대한항공' : '대한항공'));
  const code = _AIRLINE_CODE[airline] || 'XX';
  // 편명 — airline code + 3~4자리 숫자 (도시 해시 기반 결정적)
  const seed = _strHash(`${airline}|${t.cityName}|${t.startDate}`);
  const flightNum = String(100 + (seed % 900));
  const flightCode = `${code}${flightNum}`;

  const duration = _CITY_FLIGHT_DURATION_MIN[t.cityName] || 180;
  // 경유 시 +2시간
  const totalMin = duration + (f.route === 'transit' ? 120 : 0);

  // 출발/도착 시간 계산
  const dep = departTime || '09:00';
  const [dh, dm] = dep.split(':').map(Number);
  const depMin = dh * 60 + dm;
  const arrMin = depMin + totalMin;
  const ah = Math.floor(arrMin / 60) % 24;
  const am = arrMin % 60;
  const arr = `${String(ah).padStart(2,'0')}:${String(am).padStart(2,'0')}`;

  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const durationStr = `${hours}시간${mins ? ' ' + mins + '분' : ''}`;
  const routeStr = f.route === 'transit' ? '경유' : (f.route === 'direct' ? '직항' : '');
  const parts = [flightCode, airline];
  if (routeStr) parts.push(routeStr);
  parts.push(`출발 ${dep} → 도착 ${arr}`);
  parts.push(durationStr);
  return parts.join(' · ');
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

function _pick(arr, seed = Math.random() * 1e6) { return arr[Math.abs(seed | 0) % arr.length]; }
function _costFor(cat, level, concept) {
  const base = { '식사': 25000, '카페': 9000, '관광': 18000, '쇼핑': 30000, '액티비티': 45000, '숙박': 120000, '이동': 30000 }[cat] || 15000;
  const lvlMult     = { '낮음': 0.6, '보통': 1.0, '높음': 1.8 }[level] || 1.0;
  const conceptMult = CONCEPT_MULT[concept] ?? 1.0;
  return Math.round(base * lvlMult * conceptMult);
}

/** Build one search query for a given slot. */
function _queryFor(slot, t) {
  const base = _pick(SLOT_QUERIES[slot]);
  const conceptHint = CONCEPT_HINT[t.concept] || '';
  const budgetHint  = BUDGET_HINT[t.budgetLevel] || '';
  return [t.cityName, conceptHint, budgetHint, base].filter(Boolean).join(' ').trim();
}

/** Pick the next Places result that hasn't been used today. */
function _pickUnused(candidates, usedIds) {
  for (const c of candidates) if (!usedIds.has(c.place_id)) return c;
  return candidates[0] || null;
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

/** Add/subtract minutes to an "HH:MM" string, clamping to 00:00–23:59. */
function _addMinutes(hhmm, mins) {
  const [h, m] = String(hhmm).split(':').map(Number);
  let total = (h | 0) * 60 + (m | 0) + (mins | 0);
  if (total < 0) total = 0;
  if (total > 23 * 60 + 59) total = 23 * 60 + 59;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}

/** Public — re-run the same generation using the current trip parameters
 *  (city / days / concept / budget).  Used by the "다시 만들기" button on
 *  the schedule page so users don't have to re-walk the 4-step flow. */
export async function regenerateSchedule() {
  try {
    return await _generateSchedule();
  } finally {
    _hideGenLoading();
  }
}

/* ============ 생성 로딩 오버레이 (전체화면 스피너) ============ */
function _showGenLoading(msg) {
  if (!document.getElementById('genLoadingStyle')) {
    const st = document.createElement('style'); st.id = 'genLoadingStyle';
    st.textContent =
      '#genLoadingOverlay{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;gap:16px;background:rgba(255,255,255,.94);'
      + "backdrop-filter:blur(2px);font-family:'Pretendard',sans-serif;}"
      + '#genLoadingOverlay .gl-spin{width:52px;height:52px;border-radius:50%;'
      + 'border:5px solid #f1f3f5;border-top-color:#fcd535;animation:glspin .8s linear infinite;}'
      + '#genLoadingOverlay .gl-msg{font-size:16px;font-weight:700;color:#0b0e11;}'
      + '#genLoadingOverlay .gl-sub{font-size:13px;color:#707a8a;}'
      + '@keyframes glspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
  let ov = document.getElementById('genLoadingOverlay');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'genLoadingOverlay';
    ov.innerHTML = '<div class="gl-spin"></div>'
      + '<div class="gl-msg" id="glMsg">일정을 만드는 중…</div>'
      + '<div class="gl-sub">현지 데이터로 동선을 짜고 있어요</div>';
    document.body.appendChild(ov);
  }
  const m = ov.querySelector('#glMsg'); if (m && msg) m.textContent = msg;
  ov.style.display = 'flex';
}
function _hideGenLoading() {
  document.getElementById('genLoadingOverlay')?.remove();
}

async function _generateSchedule() {
  const t = appState.trip;
  const btn = $('#stepGenerate');
  if (btn) { btn.disabled = true; btn.textContent = `${t.cityName}의 진짜 명소를 찾는 중…`; }
  _showGenLoading(`${t.cityName || ''} 일정을 만드는 중…`);

  const start = new Date(t.startDate);
  const days = [];

  // ── STEP A — Resolve the destination city's centre FIRST.
  // Every per-slot Places search below is biased to a 30 km circle around
  // this centre, otherwise the API can return places in the wrong city /
  // wrong country and Routes API later says "no route" because the points
  // are too scattered.
  let cityCenter = null;
  try {
    const cityRes = await api.searchPlaces({
      query: t.cityName,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 1,
    });
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
  async function searchForSlot(slot) {
    if (slotCache.has(slot)) return slotCache.get(slot);
    const q = _queryFor(slot, t);
    try {
      const res = await api.searchPlaces({
        query: q,
        language_code: 'ko', language: 'ko',
        region: _guessRegion(t.country),
        max_results: 15,
        center_lat: cityCenter?.lat,
        center_lng: cityCenter?.lng,
      });
      let places = (res?.places || []).filter(p =>
        Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      );
      // Drop anything > 60 km from the city centre — Places sometimes
      // returns a "Tokyo Restaurant" that's actually in Osaka or worse.
      if (cityCenter) {
        const near = places.filter(p => _kmFromCentre(p) <= 60);
        if (near.length > 0) places = near;
      }
      slotCache.set(slot, places);
      return places;
    } catch (e) {
      console.warn('[trip-flow] places search failed for', slot, q, e?.message);
      slotCache.set(slot, []);
      return [];
    }
  }

  const usedIds = new Set();          // place_ids already picked across the whole trip
  // Slot list 우선순위:
  //   1) 스타일 "빽빽한 일정" → PACKED (식사 제외 7곳)
  //   2) 스타일 "여유로운 일정" → RELAXED (식사 제외 3곳)
  //   3) 컨셉 기본
  const styles = Array.isArray(t.styles) ? t.styles : [];
  let slotTimes;
  if (styles.includes('빽빽한 일정')) {
    slotTimes = PACKED_SLOTS;
    console.log('[trip-flow] style override → 빽빽한 일정 (slots=' + slotTimes.length + ')');
  } else if (styles.includes('여유로운 일정')) {
    slotTimes = RELAXED_SLOTS;
    console.log('[trip-flow] style override → 여유로운 일정 (slots=' + slotTimes.length + ')');
  } else {
    slotTimes = CONCEPT_SLOTS[t.concept] || SLOT_TIMES_DEFAULT;
  }
  console.log('[trip-flow] CONCEPT_SLOTS build=v6 — concept=' + t.concept + ', slots=' + slotTimes.length);

  // ── STEP C — Resolve AIRPORT + HOTEL once for the destination city. ──
  // These power the per-day start/end markers (공항 도착 / 호텔 체크인 / 복귀 / 체크아웃 / 공항 출발).
  // Falls back to readable mock names if Places API is unavailable.
  let airportPlace = null;
  let hotelPlace = null;
  try {
    const ar = await api.searchPlaces({
      query: `${t.cityName} 국제공항`,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 3,
      center_lat: cityCenter?.lat,
      center_lng: cityCenter?.lng,
    });
    airportPlace = (ar?.places || []).find(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) || null;
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
      : ['midscale'];
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

    const hr = await api.searchPlaces({
      query: hotelQuery,
      language_code: 'ko', language: 'ko',
      region: _guessRegion(t.country),
      max_results: 15,   // 더 많은 후보
      center_lat: cityCenter?.lat,
      center_lng: cityCenter?.lng,
    });
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

  const airportName = airportPlace?.name || `${t.cityName} 국제공항`;
  let hotelName     = hotelPlace?.name   || `${t.cityName} 시내 호텔`;
  // Cost: 1박 단위로 분배 — 첫날 체크인 + 중간일 복귀에 각 1박씩 적용
  const nights = Math.max(0, (t.days || 1) - 1);
  // 호텔 1박 비용 — 사용자 선택 (유형/위치/편의시설) 반영, 방 수도 고려
  const _rooms = _roomCount(t);
  // 1실 1박 단가 결정 — 우선순위:
  //   1) SerpApi(Google Hotels) 실시간 요금  → 'serpapi'
  //   2) 실패 시 순수 추정 공식 (보정 없음)   → 'estimate'
  let _perRoomNight = _calcHotelPerNight(t);
  let _hotelPriceSource = 'estimate';

  // ── 1) SerpApi 실시간 호텔 요금 (해당 도시·날짜·인원의 실제 1박가) ──
  //   check_out 이 check_in 보다 뒤이고, 둘 다 있어야 호출 (SerpApi 요구사항).
  let _serpNightly = null;
  try {
    if (t.startDate && t.endDate && t.endDate > t.startDate) {
      const adults = Math.max(1, t.people || _PEOPLE_COUNT[t.companion] || 2);
      // 사용자가 고른 성급(2~5)을 SerpApi hotel_class 필터로 전달 → 보여줄 호텔 등급·가격대 일치
      const _starMap = { luxury: '5', upscale: '4', midscale: '3', budget: '2' };
      const _stars = [...new Set((t.hotelP?.types || []).map(x => _starMap[x]).filter(Boolean))];
      const hres = await api.searchHotels({
        query: t.cityName,
        check_in_date: t.startDate,
        check_out_date: t.endDate,
        adults,
        currency: 'KRW',
        country: (_guessRegion(t.country) || 'KR').toLowerCase(),
        language: 'ko',
        hotel_class: _stars.length ? _stars.join(',') : undefined,
        max_results: 25,
      });
      const hotels = (hres?.hotels || []).filter(h => Number.isFinite(h.price_per_night) && h.price_per_night > 0);
      if (hotels.length) {
        // ★ 표시 호텔을 Google Hotels(SerpApi) 매물 '하나'로 통일한다.
        //   이름·가격·좌표를 같은 출처로 맞춰야 앱 가격 = 구글 가격이 된다.
        //   (기존: 이름은 Google Places, 가격은 도시 중앙값이라 서로 달랐음)
        let chosen = null;
        // 1) 기존 Places 후보와 이름이 겹치는 매물이 있으면 우선 채택
        if (hotelPlace?.name) {
          const toks = hotelPlace.name.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
          chosen = hotels.find(h => toks.some(tk => (h.name || '').toLowerCase().includes(tk)));
        }
        // 2) 매칭 실패 시: 가격이 튀지 않게 '중앙값에 가장 가까운' 매물을 대표로 채택
        if (!chosen) {
          const med = hres.median_price_per_night;
          chosen = med
            ? hotels.reduce((a, b) => Math.abs(b.price_per_night - med) < Math.abs(a.price_per_night - med) ? b : a)
            : hotels[0];
        }
        _serpNightly = chosen.price_per_night;
        // 표시 호텔(이름·좌표·주소·링크)을 채택 매물로 교체 → 가격과 동일 출처
        hotelName = chosen.name || hotelName;
        hotelPlace = {
          name: chosen.name || hotelName,
          latitude:  Number.isFinite(chosen.latitude)  ? chosen.latitude  : hotelPlace?.latitude,
          longitude: Number.isFinite(chosen.longitude) ? chosen.longitude : hotelPlace?.longitude,
          address:   hotelPlace?.address || '',
          place_id:  'serp-hotel',
          price_level: null,
          link: chosen.link || null,
        };
        console.log('[trip-flow] SerpApi 호텔 채택:', chosen.name,
                    Math.round(_serpNightly).toLocaleString('ko-KR'), '원 (이름·가격 동일 출처)');
      } else {
        console.log('[trip-flow] SerpApi 결과 없음 — 추정값 사용');
      }
    }
  } catch (e) {
    console.warn('[trip-flow] SerpApi 호텔 요금 조회 실패 — 추정값 폴백:', e?.message);
  }

  if (Number.isFinite(_serpNightly) && _serpNightly > 0) {
    // 실시간가는 천원 단위 반올림 없이 실제 값 그대로 → 구글 표시가와 정확히 일치.
    _perRoomNight = Math.round(_serpNightly);
    _hotelPriceSource = 'serpapi';
  } else {
    // ── 2) 폴백 — SerpApi 실패 시 순수 추정 공식 결과값을 보정 없이 그대로 사용 ──
    //   (Google 가격대 priceLevel 보정은 하지 않는다 — 추정치를 임의로 올리고 내리지 않음)
    _perRoomNight = Math.round(_calcHotelPerNight(t) / 1000) * 1000;
    _hotelPriceSource = 'estimate';
    console.log('[trip-flow] SerpApi 미사용 — 순수 추정 1박',
                _perRoomNight.toLocaleString('ko-KR'), '원 (보정 없음)');
  }
  const hotelPerNightCost = _perRoomNight * _rooms;
  const transitCost       = _costFor('이동', t.budgetLevel, t.concept);
  console.log('[trip-flow] 숙박 — 1박 ' + hotelPerNightCost.toLocaleString('ko-KR') + '원 (' + _rooms + '실) × ' + nights + '박 = 총 ' + (hotelPerNightCost * nights).toLocaleString('ko-KR') + '원');

  // Helpers to build a "transition" activity (airport/hotel) with proper fields.
  // 항공권 — 실시간(SerpApi Google Flights) 우선, 실패/미지원 시 추정 공식 폴백.
  let _flightPerPax = null;          // 1인 왕복가
  let _flightSource = 'estimate';
  let _flightMeta   = null;          // { airline, flightCode, stops }
  try {
    const depIata = t.departureAirport || _CITY_IATA[t.origin];   // 사용자가 고른 출발 공항 우선
    const arrIata = t.arrivalAirport || _CITY_IATA[t.city];       // 사용자가 고른 도착 공항 우선
    if (depIata && arrIata && depIata !== arrIata && t.startDate && t.endDate && t.endDate > t.startDate) {
      const fres = await api.searchFlights({
        departure_id: depIata, arrival_id: arrIata,
        outbound_date: t.startDate, return_date: t.endDate,
        adults: 1, currency: 'KRW', country: 'kr', language: 'ko',
      });
      if (fres && Number.isFinite(fres.lowest_price) && fres.lowest_price > 0) {
        _flightPerPax = fres.lowest_price;
        _flightSource = 'serpapi';
        if (fres.cheapest) _flightMeta = {
          airline: fres.cheapest.airline, flightCode: fres.cheapest.flight_number, stops: fres.cheapest.stops,
        };
        console.log('[trip-flow] SerpApi 항공 — 1인 왕복', _flightPerPax.toLocaleString('ko-KR'), '원',
                    _flightMeta?.airline || '', _flightMeta?.flightCode || '');
      } else {
        console.log('[trip-flow] 항공 실시간 결과 없음 — 추정값 사용');
      }
    }
  } catch (e) {
    console.warn('[trip-flow] 항공 실시간 조회 실패 — 추정 폴백:', e?.message);
  }
  // 왕복 1인가를 인원수만큼 곱해 그룹 총액 → 도착·출발에 절반씩 분배 (추정 폴백은 기존 공식)
  const _pax = _peopleCount(t);
  const flightTotalKRW = (Number.isFinite(_flightPerPax) && _flightPerPax > 0)
    ? Math.round(_flightPerPax * _pax * (t.companion === 'group' ? 0.95 : 1) / 100) * 100
    : _calcFlightPrice(t);
  const flightHalfKRW  = Math.round(flightTotalKRW / 2 / 100) * 100;
  console.log('[trip-flow] 항공권(' + _flightSource + ') — 총 ' + flightTotalKRW.toLocaleString('ko-KR') + '원 (편도 ' + flightHalfKRW.toLocaleString('ko-KR') + '원)');

  function _airportItem(time, label) {
    const f = t.flight || {};
    const isArrival = (label || '').includes('도착');
    let flightInfo = _generateFlightInfo(t, isArrival, time);
    // 실시간 항공편이 있으면 실제 항공사·편명·직항/경유로 라벨 교체(시간 부분은 유지).
    if (_flightMeta && _flightMeta.airline) {
      const tail = flightInfo.split(' · ').slice(2).join(' · ');
      const stopTxt = _flightMeta.stops ? `경유 ${_flightMeta.stops}회` : '직항';
      flightInfo = `${_flightMeta.flightCode || ''} · ${_flightMeta.airline} · ${stopTxt}` + (tail ? ` · ${tail}` : '');
    }
    return {
      time,
      name: label ? `${airportName} (${label})` : airportName,
      category: '이동',
      cost: flightHalfKRW,
      placeId: airportPlace?.place_id || `airport-${t.cityName}`,
      latitude:  airportPlace?.latitude,
      longitude: airportPlace?.longitude,
      // 공항 주소 대신 항공편 정보 (편명·항공사·시간) 표시
      address:   flightInfo,
      googleMapsQuery: airportName,
      flightMeta: {
        roundTripKRW: flightTotalKRW,
        oneWayKRW:    flightHalfKRW,
        airline:      _flightMeta?.airline || (f.airlines && f.airlines[0]) || (f.classType === 'lcc' ? '제주항공' : '대한항공'),
        flightCode:   _flightMeta?.flightCode || flightInfo.split(' · ')[0],
        route:        f.route || 'any',
        startDate:    t.startDate,
        source:       _flightSource,
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
      cost: cost ?? 0,
      placeId: hotelPlace?.place_id || `hotel-${t.cityName}`,
      latitude:  hotelPlace?.latitude,
      longitude: hotelPlace?.longitude,
      address:   hotelPlace?.address || '',
      googleMapsQuery: hotelName,
    };
  }

  const totalDays = t.days || 1;
  // 실데이터(Places) vs 폴백(임시 명소) 슬롯 집계 — 너무 많이 폴백되면 사용자에게 안내.
  let _realSlots = 0, _fallbackSlots = 0;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const activities = [];

    const isFirstDay  = (i === 0);
    const isLastDay   = (i === totalDays - 1);
    const isSingleDay = (totalDays === 1);

    // ── Times surrounding the regular activity slots ──
    const firstSlotTime = slotTimes[0]?.[0] || '09:00';
    const lastSlotTime  = slotTimes[slotTimes.length - 1]?.[0] || '20:00';

    // ── START items (per day type) ──
    if (isSingleDay) {
      // 당일치기: just airport arrival, no overnight stay
      activities.push(_airportItem(_addMinutes(firstSlotTime, -120), '도착'));
    } else if (isFirstDay) {
      // 첫날 (multi-day): 공항 도착 → 호텔 체크인
      activities.push(_airportItem(_addMinutes(firstSlotTime, -120), '도착'));
      activities.push(_hotelItem  (_addMinutes(firstSlotTime, -30),  '체크인', 0));
    } else {
      // 중간일 또는 마지막날 아침: 호텔에서 출발
      activities.push(_hotelItem(_addMinutes(firstSlotTime, -30), '출발', 0));
    }

    // ── Regular slot loop (unchanged logic) ──
    for (let si = 0; si < slotTimes.length; si++) {
      const [time, slot] = slotTimes[si];
      const candidates = await searchForSlot(slot);
      const pick = _pickUnused(candidates, usedIds);

      if (pick) {
        _realSlots++;
        usedIds.add(pick.place_id);
        const cat = CATEGORY_BY_SLOT[slot] || '관광';
        activities.push({
          time,
          name: pick.name,
          category: cat,
          cost: _costFor(cat, t.budgetLevel, t.concept),
          placeId: pick.place_id,
          latitude: pick.latitude,
          longitude: pick.longitude,
          address: pick.address || '',
          googleMapsQuery: pick.name,
        });
      } else {
        _fallbackSlots++;
        const fallback = _legacyMock(slot, i, si);
        const cat = fallback.c;
        activities.push({
          time,
          name: `${fallback.n} · ${t.cityName}`,
          category: cat,
          cost: _costFor(cat, t.budgetLevel, t.concept),
          placeId: `${t.cityName}-${i}-${si}`,
          googleMapsQuery: `${fallback.n} ${t.cityName}`,
        });
      }
    }

    // ── END items (per day type) ──
    if (isSingleDay) {
      // 당일치기: 공항 출발
      activities.push(_airportItem(_addMinutes(lastSlotTime, +180), '출발'));
    } else if (isLastDay) {
      // 마지막날 (multi-day): 호텔 체크아웃 → 공항 출발
      activities.push(_hotelItem  (_addMinutes(lastSlotTime, +60),  '체크아웃', 0));
      activities.push(_airportItem(_addMinutes(lastSlotTime, +180), '출발'));
    } else {
      // 첫날 또는 중간일 저녁: 호텔 복귀 — 이날 밤 숙박 1박 비용 적용
      activities.push(_hotelItem(_addMinutes(lastSlotTime, +90), '복귀 (1박)', hotelPerNightCost));
    }

    days.push({ date: d.toISOString().slice(0,10), activities });
  }

  const generated = {
    origin: t.origin || '',
    originName: t.originName || '',
    departureCity: t.originName || '',
    city: t.cityName,
    country: t.country,
    concept: t.concept,
    budget: (t.budget || 0) * 10000,
    currency: t.currency,
    days,
    createdAt: new Date().toISOString(),
    companion: t.companion,
    styles: [...t.styles],
    flight: t.flight ? { ...t.flight, airlines: [...(t.flight.airlines || [])] } : null,
    hotelPref: t.hotelP ? {
      types: [...(t.hotelP.types || [])],
      locations: [...(t.hotelP.locations || [])],
      amenities: [...(t.hotelP.amenities || [])],
    } : null,
    hotelPriceSource: _hotelPriceSource,   // 'serpapi' | 'estimate'
    flightPriceSource: _flightSource,      // 'serpapi' | 'estimate'
  };
  appState.generated = generated;
  appState.expenses = {};

  if (btn) { btn.disabled = false; btn.textContent = '일정 생성하기 ✨'; }
  _hideGenLoading();
  // 실데이터가 충분치 않으면(절반 이상 임시 명소) 솔직하게 안내 — 데모 중 가짜 명소를 진짜처럼 보이지 않게.
  const _totalSlots = _realSlots + _fallbackSlots;
  if (_totalSlots > 0 && _fallbackSlots > _realSlots) {
    console.warn(`[trip-flow] 실데이터 부족 — 실제 ${_realSlots} / 임시 ${_fallbackSlots} 슬롯`);
    showToast('현지 장소를 충분히 못 찾아 일부는 임시 명소로 채웠어요. 도시명을 더 구체적으로 바꿔 다시 시도해 보세요.');
  } else {
    showToast('일정이 생성되었어요!');
  }
  navigate('schedule');
}

/** Legacy mock — used only when Places API is unavailable. */
const _LEGACY_MOCK = {
  morning:   [{n:'호텔 조식', c:'식사'},{n:'근처 카페 산책', c:'카페'},{n:'전망대 일출', c:'관광'},{n:'전통 시장 구경', c:'쇼핑'}],
  forenoon:  [{n:'주요 박물관', c:'관광'},{n:'랜드마크 투어', c:'관광'},{n:'동네 골목 산책', c:'관광'},{n:'베이커리 브런치', c:'식사'}],
  lunch:     [{n:'현지 인기 맛집', c:'식사'},{n:'미슐랭 추천', c:'식사'},{n:'가성비 식당', c:'식사'},{n:'채식 식당', c:'식사'}],
  afternoon: [{n:'쇼핑 거리', c:'쇼핑'},{n:'미술관 관람', c:'관광'},{n:'카페 휴식', c:'카페'},{n:'테마파크', c:'액티비티'}],
  evening:   [{n:'야경 명소', c:'관광'},{n:'강변 산책', c:'관광'},{n:'재즈바', c:'액티비티'},{n:'야시장', c:'쇼핑'}],
  dinner:    [{n:'시그니처 다이닝', c:'식사'},{n:'현지 BBQ', c:'식사'},{n:'분위기 좋은 비스트로', c:'식사'},{n:'야경 레스토랑', c:'식사'}],
  // New concept-specific slot types
  activity:  [{n:'액티비티 체험', c:'액티비티'},{n:'테마파크', c:'액티비티'},{n:'관광 투어', c:'액티비티'}],
  spa:       [{n:'스파 휴식', c:'액티비티'},{n:'온천', c:'액티비티'},{n:'마사지', c:'액티비티'}],
  shopping:  [{n:'백화점', c:'쇼핑'},{n:'편집숍 거리', c:'쇼핑'}],
  premium:   [{n:'미슐랭 다이닝', c:'식사'},{n:'파인 다이닝', c:'식사'}],
};
function _legacyMock(slot, dayIdx, slotIdx) {
  const arr = _LEGACY_MOCK[slot] || _LEGACY_MOCK.lunch;
  return arr[(dayIdx * 7 + slotIdx) % arr.length];
}
