/* 3초 여행 — Redesign Schedule
 * Renders appState.generated.  Provides:
 *   - day chips
 *   - timeline cards w/ Google Maps deep-link
 *   - edit mode w/ drag-and-drop reorder & add/edit/delete
 *   - cost summary
 *   - save / unsave (calls api.saveTrip / api.deleteTrip)
 *   - share (Web Share API + clipboard fallback)
 *   - regenerate (re-runs trip flow)
 */

import { navigate } from './redesign-navigation.js';
import { api } from './redesign-api-adapter.js';
import {
  el, $, $$, formatCurrency, showToast,
  getSchedulePlaceName, getScheduleCategory, getScheduleAddress, normalizeScheduleItem,
} from './redesign-ui.js';
import { getInsights, CONGESTION_LABEL } from './redesign-places.js';
import { regenerateSchedule } from './redesign-trip-flow.js';

let appState = null;
let activeDay = 0;
let editMode = false;
let savedTripId = null;
let editing = null; // {di, ai} target for edit modal

export function initSchedule(state) {
  appState = state;

  $('#btnEditToggle')?.addEventListener('click', () => {
    editMode = !editMode;
    const b = $('#btnEditToggle');
    b.textContent = editMode ? '완료' : '편집';
    b.classList.toggle('is-active', editMode);
    $('#scheduleTimeline')?.classList.toggle('is-edit', editMode);
    renderSchedule();
  });

  $('#btnRegen')?.addEventListener('click', async () => {
    if (!confirm('현재 일정을 같은 조건으로 새로 생성할까요?\n(저장하지 않은 변경은 사라집니다)')) return;
    // Have current trip params (city / days / concept / budget) → regen in place.
    if (appState.trip?.cityName && appState.trip?.days) {
      const btn = $('#btnRegen');
      if (btn) btn.disabled = true;
      try {
        await regenerateSchedule();
        showToast('새 일정이 생성됐어요');
      } catch (e) {
        showToast('재생성 실패: ' + (e?.message || 'unknown'));
      } finally {
        if (btn) btn.disabled = false;
      }
    } else {
      // No trip params yet — fall back to the 4-step flow.
      navigate('create-trip');
    }
  });

  $('#btnShare')?.addEventListener('click', _share);
  $('#btnSave')?.addEventListener('click', _toggleSave);
  $('#openBookingBtn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('redesign:open-booking'));
  });

  // Edit modal
  $('#editClose')?.addEventListener('click', _closeEdit);
  $('#editBackdrop')?.addEventListener('click', _closeEdit);
  $('#editSave')?.addEventListener('click', _commitEdit);
  $('#editDelete')?.addEventListener('click', _deleteEdit);

  document.addEventListener('redesign:nav', (e) => {
    if (e.detail.page === 'schedule') renderSchedule();
  });

  // map.js stamps real Places API names back onto activities asynchronously;
  // when that happens we re-render the timeline so cards show the real
  // place names (replaces "호텔 조식 · 도쿄" etc. with the actual venue).
  document.addEventListener('redesign:activities-resolved', () => {
    renderSchedule();
  });
}

/* ============ Render ============ */
export function renderSchedule() {
  const g = appState?.generated;
  const empty = $('#scheduleEmpty');
  const timeline = $('#scheduleTimeline');
  const cost = $('#costSummary');
  const cta = $('#bookingCta');
  const review = $('#reviewSection');
  const title = $('#scheduleTitle');
  const sub = $('#scheduleSub');

  if (!g) {
    if (empty) empty.hidden = false;
    if (timeline) timeline.hidden = true;
    if (cost) cost.hidden = true;
    if (cta) cta.hidden = true;
    if (review) review.hidden = true;
    if (title) title.textContent = '나의 일정';
    if (sub) sub.textContent = '아직 생성된 일정이 없어요';
    // Still notify the map module so it can paint its empty-state map card.
    _emitScheduleChanged();
    return;
  }

  if (empty) empty.hidden = true;
  if (timeline) timeline.hidden = false;
  if (cost) cost.hidden = false;
  if (cta) cta.hidden = false;
  if (review) review.hidden = false;

  if (title) title.textContent = `${g.city} ${g.days.length}일`;
  if (sub) sub.textContent = `${g.concept || ''} · ${_companion(g.companion)} · ${g.currency}`;

  _renderDayChips(g);
  _renderTimeline(g);
  _renderCostSummary(g);

  _emitScheduleChanged();
}

/** Notify map module (and anyone else) that the schedule or active day
 *  was just re-rendered.  All refresh triggers (day change, edit save,
 *  delete, add, drag/touch reorder) funnel through renderSchedule()
 *  → this is the single source of truth.
 */
function _emitScheduleChanged() {
  document.dispatchEvent(new CustomEvent('redesign:schedule-changed', {
    detail: {
      activeDay,
      generated: appState?.generated || null,
    },
  }));
}

function _companion(k) { return ({ solo:'혼자', friend:'친구', couple:'커플', family:'가족', group:'단체' })[k] || ''; }

function _renderDayChips(g) {
  const row = $('#dayChips');
  if (!row) return;
  row.innerHTML = '';
  g.days.forEach((d, idx) => {
    // 일별 비용 합계
    const dayCost = d.activities.reduce((sum, _, ai) => sum + _actCost(idx, ai, d.activities[ai].cost), 0);
    const costLabel = _shortMoney(dayCost, g.currency);
    const chip = el('button', {
      type: 'button',
      class: 'day-chip' + (idx === activeDay ? ' is-active' : ''),
      role: 'tab',
      ariaSelected: String(idx === activeDay),
      onclick: () => { activeDay = idx; renderSchedule(); },
    }, [
      `Day ${idx + 1}`, el('br'),
      el('span', { style: { fontSize: '10px', fontWeight: 500, opacity: .8 } }, d.date.slice(5).replace('-', '/')),
      el('span', { class: 'day-chip-cost' }, costLabel),
    ]);
    row.appendChild(chip);
  });
}

function _renderTimeline(g) {
  const tl = $('#scheduleTimeline');
  if (!tl) return;
  tl.innerHTML = '';
  const day = g.days[activeDay];
  if (!day) return;

  // 표시용 1박 단가 — 모든 호텔 카드에 같은 값을 보여준다(계산엔 미사용).
  const hotelNightly = _nightlyHotelRate(g);

  day.activities.forEach((a, ai) => {
    // Normalize the activity into a stable shape (handles any field-name
    // drift across legacy mock / Google Places / search results / etc.)
    const n = normalizeScheduleItem(a, ai);
    const placeName = n.placeName;
    const hasName   = placeName && placeName !== 'Place name not available';

    // ── Line 1 — meta: TIME (or ORDER fallback) · CATEGORY (badge) ──
    const metaEls = [];
    if (n.time) {
      metaEls.push(el('span', { class: 'schedule-time' }, n.time));
    } else {
      metaEls.push(el('span', { class: 'schedule-order' }, String(n.order)));
    }
    if (n.category) {
      metaEls.push(el('span', { class: 'schedule-dot', ariaHidden: 'true' }, '·'));
      metaEls.push(el('span', { class: 'schedule-category' }, n.category));
    }

    // ── Line 3 — sub-info: address line + cost line (separate visual rows) ──
    const subEls = [];
    // Skip address if it accidentally equals the place name (de-dup safety)
    if (n.address && n.address !== placeName) {
      subEls.push(el('p', {
        class: 'schedule-place-subinfo',
        title: n.address,
      }, n.address));
    }
    if (n.memo) {
      subEls.push(el('p', { class: 'schedule-place-subinfo schedule-memo' }, n.memo));
    }
    const costNumeric = _actCost(activeDay, ai, n.cost);
    if (n.category === '숙박') {
      // 모든 호텔 항목(체크인·복귀·체크아웃 등)에 1박 단가를 표시.
      // Google 가격대로 보정한 추정치 — 실제 요금과 다를 수 있어 '예상가'로 명시.
      // 합계는 각 항목의 실제 cost를 쓰므로 영향 없음.
      if (hotelNightly > 0) {
        subEls.push(el('p', { class: 'schedule-place-subinfo schedule-cost' },
          '1박 예상가 ' + formatCurrency(hotelNightly, g.currency)));
      }
    } else if (costNumeric != null && costNumeric > 0) {
      subEls.push(el('p', { class: 'schedule-place-subinfo schedule-cost' },
        '예상 ' + formatCurrency(costNumeric, g.currency)));
    }

    const insightsBox = el('div', { class: 'schedule-insights' }, [
      el('div', { class: 'schedule-insight-row' }, [
        el('span', { class: 'insight-label' }, '현지인 비율'),
        el('div', { class: 'insight-bar' }, el('div', { class: 'insight-fill', style: { width: '0%' } })),
        el('span', { class: 'insight-val' }, '...'),
      ]),
      el('div', { class: 'schedule-insight-row' }, [
        el('span', { class: 'insight-label' }, '혼잡도'),
        el('span', { class: 'insight-pill' }, '측정 중...'),
        el('span', { class: 'insight-src' }, ''),
      ]),
    ]);

    const card = el('article', {
      class: 'schedule-card' + (hasName ? '' : ' schedule-card--no-name'),
      // ⚠ draggable 은 카드 본체가 아닌 .drag-handle 에만 부여 (텍스트 선택 가능)
      draggable: 'false',
      dataset: {
        di: String(activeDay),
        ai: String(ai),
        placeId: n.placeId || n.id || '',
      },
    }, [
      el('div', { class: 'schedule-card-main' }, [
        // Line 1 — meta
        el('div', { class: 'schedule-card-meta-line' }, metaEls),
        // Line 2 — place name (h3, main visual; full text in title attr)
        el('h3', {
          class: 'schedule-place-name',
          title: placeName,
        }, placeName),
        // Line 3 — sub-info(s)
        ...subEls,
        insightsBox,
      ]),
      el('div', { class: 'schedule-card-actions' }, [
        el('button', {
          type: 'button',
          class: 'map-button',
          onclick: (e) => { e.stopPropagation(); _openMap(a); },
        }, '🗺 지도'),
        el('button', {
          type: 'button',
          class: 'edit-button',
          title: '장소 편집',
          onclick: (e) => { e.stopPropagation(); _openEdit(activeDay, ai); },
        }, '✏️ 편집'),
        el('span', {
          class: 'drag-handle',
          title: '드래그하여 순서 변경',
          ariaHidden: 'true',
          draggable: editMode ? 'true' : 'false',
        }, '⋮⋮'),
      ]),
    ]);
    // 본체 클릭으로는 모달 열지 않음 — 텍스트 자유롭게 선택 가능
    // 편집은 우측 "✏️ 편집" 버튼으로만 열림

    // Populate insights async (cached) — uses the same place name as the card
    getInsights(placeName, g.city, n.time).then(ins => {
      try {
        const fill = insightsBox.querySelector('.insight-fill');
        const val  = insightsBox.querySelector('.insight-val');
        if (fill && val) {
          const pct = Math.round(ins.localRatio * 100);
          fill.style.width = pct + '%';
          val.textContent = pct + '%';
        }
        const pill = insightsBox.querySelector('.insight-pill');
        const src  = insightsBox.querySelector('.insight-src');
        if (pill) {
          const lab = CONGESTION_LABEL[ins.congestion] || CONGESTION_LABEL.normal;
          pill.classList.add('lvl-' + ins.congestion);
          pill.textContent = `${lab.icon} ${lab.ko}`;
        }
        if (src) src.textContent = ins.source;
      } catch (_) {}
    });

    if (editMode) _bindDnd(card);
    tl.appendChild(card);
  });

  // Edit-mode footer for adding place
  if (editMode) {
    tl.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-soft btn-block',
      style: { marginTop: '8px' },
      onclick: _addPlace,
    }, '+ 장소 추가'));
  }
}

function _actKey(di, ai) { return `${di}_${ai}`; }
function _actCost(di, ai, fallback) {
  const k = _actKey(di, ai);
  if (appState.expenses && appState.expenses[k] != null) return appState.expenses[k];
  return fallback || 0;
}

/** 숙소 1박 단가 — 일정 안의 '숙박' 항목 중 비용이 실린 항목(복귀 1박)의 값.
 *  표시 전용: 모든 호텔 카드에 같은 1박 단가를 보여주되, 합계 계산은
 *  각 항목의 실제 cost(0 또는 1박)를 그대로 쓰므로 변하지 않는다. */
function _nightlyHotelRate(g) {
  let rate = 0;
  g.days.forEach((d, di) => d.activities.forEach((a, ai) => {
    if (a.category === '숙박') {
      const c = _actCost(di, ai, a.cost);
      if (c > rate) rate = c;
    }
  }));
  return rate;
}

/** 총 예산 = 왕복 항공권 + 숙소(1박 × n박) + 타 장소 예산.
 *  카테고리로 분해해서 명시적으로 합산한다(사용자 수정값 expenses 반영). */
function _computeBudgetBreakdown(g) {
  let flight = 0, hotel = 0, other = 0, nights = 0;
  g.days.forEach((d, di) => {
    d.activities.forEach((a, ai) => {
      const c = _actCost(di, ai, a.cost);
      if (a.category === '이동' && a.flightMeta) {
        flight += c;                          // 왕복 항공권 (도착·출발 편도 합 = 왕복)
      } else if (a.category === '숙박') {
        hotel += c;                           // 숙박 — 1박 요금은 '복귀(1박)' 항목에만 실림
        if (c > 0) nights += 1;
      } else {
        other += c;                           // 타 장소 (식사·관광·쇼핑·체험 등)
      }
    });
  });
  const hotelPerNight = nights ? Math.round(hotel / nights) : 0;
  return { flight, hotel, other, nights, hotelPerNight, total: flight + hotel + other };
}

function _renderCostSummary(g) {
  const bd = _computeBudgetBreakdown(g);

  // 오늘(선택일) 합계는 기존대로 일별 합으로 표시
  const todayCost = (g.days[activeDay]?.activities || [])
    .reduce((a, _, ai) => a + _actCost(activeDay, ai, g.days[activeDay].activities[ai].cost), 0);

  const budgetKRW = g.budget;
  if ($('#csDayLabel')) $('#csDayLabel').textContent = `Day ${activeDay + 1}`;
  if ($('#csDayCost'))  $('#csDayCost').textContent  = formatCurrency(todayCost, g.currency);
  $('#csBudget').textContent = formatCurrency(budgetKRW, g.currency);
  $('#csTotal').textContent  = formatCurrency(bd.total, g.currency);

  // 항목별 분해 표시: 왕복항공 + 숙소(1박×n박) + 타 장소
  const bdEl = $('#csBreakdown');
  if (bdEl) {
    const hotelPart = bd.nights > 0
      ? `숙소 ${_shortMoney(bd.hotelPerNight, g.currency)}×${bd.nights}박`
      : `숙소 ${_shortMoney(bd.hotel, g.currency)}`;
    bdEl.textContent = `왕복항공 ${_shortMoney(bd.flight, g.currency)} + ${hotelPart} + 타 장소 ${_shortMoney(bd.other, g.currency)}`;
  }

  const pct = Math.min(100, budgetKRW ? (bd.total / budgetKRW) * 100 : 0);
  $('#csBarFill').style.width = pct + '%';
}

/** 짧은 금액 라벨 (Day chip 표시용): 1,200,000원 → 120만원, 5,000원 → 5천원 */
function _shortMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (currency !== 'KRW' && currency != null) {
    // 비KRW는 1k 단위로 축약
    if (n >= 1000) return Math.round(n / 100) / 10 + 'k';
    return String(Math.round(n));
  }
  if (n >= 10000) {
    const v = n / 10000;
    return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + '만';
  }
  if (n >= 1000) return Math.round(n / 1000) + '천';
  return n > 0 ? Math.round(n) + '원' : '-';
}

/* ============ Edit modal ============ */
let _editPickedPlace = null;
let _editSearchT = null;
let _editSearchSeq = 0;

function _editEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _bindEditSearch() {
  const input = $('#editName');
  if (!input || input.__searchBound) return;
  input.__searchBound = true;
  input.addEventListener('input', _onEditNameInput);
  input.addEventListener('blur', () => {
    // 약간 지연 — suggestion 클릭이 먼저 처리되도록
    setTimeout(() => { $('#editSuggestions') && ($('#editSuggestions').hidden = true); }, 180);
  });
  input.addEventListener('focus', () => {
    if (input.value && input.value.trim().length >= 2) _onEditNameInput({ target: input });
  });
}

function _onEditNameInput(e) {
  const q = (e.target.value || '').trim();
  // 사용자가 직접 입력 중이면 이전 선택 무효화
  _editPickedPlace = null;
  const hint = $('#editPlaceHint'); if (hint) hint.hidden = true;
  clearTimeout(_editSearchT);
  const sugg = $('#editSuggestions');
  if (q.length < 2) {
    if (sugg) sugg.hidden = true;
    return;
  }
  if (sugg) {
    sugg.hidden = false;
    sugg.innerHTML = '<div class="ps-loading">검색 중…</div>';
  }
  const seq = ++_editSearchSeq;
  _editSearchT = setTimeout(() => _searchPlacesForEdit(q, seq), 300);
}

async function _searchPlacesForEdit(q, seq) {
  const city = appState.generated?.city || '';
  try {
    const res = await api.searchPlaces({
      query: city ? `${q} ${city}` : q,
      language_code: 'ko', language: 'ko',
      max_results: 8,
    });
    if (seq !== _editSearchSeq) return;   // stale response
    const places = (res?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    _renderEditSuggestions(places);
  } catch (err) {
    if (seq !== _editSearchSeq) return;
    console.warn('[edit] places search failed:', err?.message);
    _renderEditSuggestions([]);
  }
}

function _renderEditSuggestions(places) {
  const sugg = $('#editSuggestions');
  if (!sugg) return;
  if (!places.length) {
    sugg.hidden = false;
    sugg.innerHTML = '<div class="ps-empty">검색 결과가 없어요. 그대로 직접 입력하셔도 됩니다.</div>';
    return;
  }
  sugg.hidden = false;
  sugg.innerHTML = places.map((_, i) => {
    const p = places[i];
    return `<div class="place-suggestion" data-i="${i}">
      <div class="ps-name">${_editEscape(p.name)}</div>
      <div class="ps-addr">${_editEscape(p.address || '')}</div>
    </div>`;
  }).join('');
  Array.from(sugg.querySelectorAll('.place-suggestion')).forEach(d => {
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();   // blur 전에 처리
      const p = places[+d.dataset.i];
      _selectEditPlace(p);
    });
  });
}

function _selectEditPlace(p) {
  _editPickedPlace = p;
  const input = $('#editName');
  if (input) input.value = p.name;
  const sugg = $('#editSuggestions'); if (sugg) sugg.hidden = true;
  const hint = $('#editPlaceHint');
  if (hint) {
    hint.hidden = false;
    hint.textContent = `Google에서 확인됨 · ${p.address || p.name}`;
  }
}


function _openEdit(di, ai) {
  editing = { di, ai, isNew: false };
  const a = appState.generated.days[di].activities[ai];
  _editPickedPlace = null;     // 기존 항목 편집 — 좌표는 유지하되 선택 상태는 초기화
  $('#editName').value = a.name || '';
  $('#editTime').value = a.time || '';
  $('#editCost').value = _actCost(di, ai, a.cost) || 0;
  $('#editMemo').value = a.memo || '';
  $('#editSuggestions') && ($('#editSuggestions').hidden = true);
  $('#editPlaceHint')   && ($('#editPlaceHint').hidden = true);
  $('#editSheetTitle')  && ($('#editSheetTitle').textContent = '장소 편집');
  $('#editDelete')      && ($('#editDelete').textContent = '삭제');
  $('#editBackdrop').hidden = false;
  $('#editSheet').hidden = false;
  _bindEditSearch();
  requestAnimationFrame(() => {
    $('#editBackdrop').classList.add('is-visible');
    $('#editSheet').classList.add('is-visible');
  });
}

function _closeEdit() {
  $('#editBackdrop').classList.remove('is-visible');
  $('#editSheet').classList.remove('is-visible');
  setTimeout(() => { $('#editBackdrop').hidden = true; $('#editSheet').hidden = true; }, 250);
  editing = null;
}

function _commitEdit() {
  if (!editing) return;
  const name = ($('#editName').value || '').trim();
  if (!name) { showToast('장소 이름을 입력해 주세요'); return; }
  const time = $('#editTime').value || '12:00';
  const cost = Number($('#editCost').value) || 0;
  const memo = $('#editMemo').value || '';
  const picked = _editPickedPlace;
  const cityName = appState.generated?.city || '';

  if (editing.isNew) {
    const di = editing.di;
    const newActivity = {
      time, name,
      category: '관광',
      cost,
      memo,
      placeId: picked?.place_id || ('custom-' + Date.now()),
      latitude:  picked?.latitude,
      longitude: picked?.longitude,
      address:   picked?.address || '',
      googleMapsQuery: picked?.name || (name + ' ' + cityName).trim(),
    };
    appState.generated.days[di].activities.push(newActivity);
    appState.expenses[_actKey(di, appState.generated.days[di].activities.length - 1)] = cost;
    _recomputeDayTimes(appState.generated.days[di]);
    _closeEdit();
    renderSchedule();
    showToast('장소가 추가되었어요');
  } else {
    const { di, ai } = editing;
    const a = appState.generated.days[di].activities[ai];
    a.name = name;
    a.time = time;
    a.cost = cost;
    appState.expenses[_actKey(di, ai)] = cost;
    a.memo = memo;
    if (picked) {
      a.placeId   = picked.place_id;
      a.latitude  = picked.latitude;
      a.longitude = picked.longitude;
      a.address   = picked.address || '';
      a.googleMapsQuery = picked.name;
    } else if (name !== (a.googleMapsQuery || '').split(' ')[0]) {
      // 직접 입력된 이름 — 좌표는 유지, 지도 쿼리만 갱신
      a.googleMapsQuery = (name + ' ' + cityName).trim();
    }
    _closeEdit();
    renderSchedule();
    showToast('수정되었어요');
  }
}

function _deleteEdit() {
  if (!editing) return;
  if (editing.isNew) { _closeEdit(); return; }   // 추가 모드: 취소만 함
  const { di, ai } = editing;
  if (!confirm('이 장소를 삭제할까요?')) return;
  appState.generated.days[di].activities.splice(ai, 1);
  delete appState.expenses[_actKey(di, ai)];
  _closeEdit();
  renderSchedule();
  showToast('삭제되었어요');
}

function _addPlace() {
  editing = { di: activeDay, isNew: true };
  _editPickedPlace = null;
  $('#editName').value = '';
  $('#editTime').value = '12:00';
  $('#editCost').value = 0;
  $('#editMemo').value = '';
  $('#editSuggestions') && ($('#editSuggestions').hidden = true);
  $('#editPlaceHint')   && ($('#editPlaceHint').hidden = true);
  $('#editSheetTitle')  && ($('#editSheetTitle').textContent = '장소 추가');
  $('#editDelete')      && ($('#editDelete').textContent = '취소');
  $('#editBackdrop').hidden = false;
  $('#editSheet').hidden = false;
  _bindEditSearch();
  requestAnimationFrame(() => {
    $('#editBackdrop').classList.add('is-visible');
    $('#editSheet').classList.add('is-visible');
    setTimeout(() => $('#editName')?.focus(), 200);
  });
}

/* ============ Auto time recompute (체류시간 + 이동시간) ============ */
// 카테고리별 추정 체류 시간 (분)
const _DWELL_MIN = {
  '식사':     75,
  '카페':     60,
  '관광':     90,
  '쇼핑':    100,
  '액티비티': 120,
  '숙박':     30,
  '이동':      0,
};
function _dwellMinutes(cat) { return _DWELL_MIN[cat] ?? 90; }

function _timeToMin(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return 9 * 60;
  const [h, m] = hhmm.split(':').map(Number);
  return ((h | 0) * 60) + (m | 0);
}
function _minToTime(total) {
  total = Math.max(0, Math.min(23 * 60 + 59, total | 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function _kmBetween(a, b) {
  const lat1 = Number(a?.latitude); const lng1 = Number(a?.longitude);
  const lat2 = Number(b?.latitude); const lng2 = Number(b?.longitude);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const aa = Math.sin(dLat/2)**2
           + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(aa));
}
// 도시 평균 18km/h (도보+대중교통+택시 혼합 가정), 우회 1.3배
function _travelMinutes(a, b) {
  const km = _kmBetween(a, b);
  if (km == null) return 20;                 // 좌표 없을 때 기본 20분
  return Math.max(5, Math.round((km * 1.3 / 18) * 60));
}
/**
 * day.activities[*].time 을 첫 항목 기준으로 재계산.
 * 각 항목 = 이전 시간 + 이전 체류시간 + 이동시간.
 * 5분 단위로 반올림.
 */
function _recomputeDayTimes(day) {
  if (!day?.activities?.length) return;
  const arr = day.activities;
  let curr = _timeToMin(arr[0].time || '09:00');
  arr[0].time = _minToTime(curr);
  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1];
    const dwell  = _dwellMinutes(prev.category);
    const travel = _travelMinutes(prev, arr[i]);
    curr += dwell + travel;
    curr = Math.round(curr / 5) * 5;
    arr[i].time = _minToTime(curr);
  }
}

/* ============ Drag & Drop ============ */
let dragSrc = null;
function _bindDnd(card) {
  // dragstart는 .drag-handle 에서만 시작 → 카드 본문은 텍스트 선택 가능
  const handle = card.querySelector('.drag-handle');
  if (handle) {
    handle.addEventListener('dragstart', (e) => {
      dragSrc = card;
      card.classList.add('is-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } catch (_) {}
    });
    handle.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      $$('.schedule-card.drop-over').forEach(c => c.classList.remove('drop-over'));
      dragSrc = null;
    });
  }
  // 카드는 drop 타깃
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drop-over'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragSrc || dragSrc === card) return;
    const srcAi = Number(dragSrc.dataset.ai);
    const dstAi = Number(card.dataset.ai);
    const day = appState.generated.days[activeDay];
    const moved = day.activities.splice(srcAi, 1)[0];
    day.activities.splice(dstAi, 0, moved);
    _recomputeDayTimes(day);
    renderSchedule();
    showToast('순서 변경 + 시간 자동 재계산');
  });

  // Touch fallback — basic long-press reorder via pointermove (best effort)
  let touchY = 0; let dragging = false;
  const touchTarget = card.querySelector('.drag-handle') || card;
  touchTarget.addEventListener('touchstart', (e) => {
    if (!editMode) return;
    const t = e.touches[0]; touchY = t.clientY;
    setTimeout(() => { dragging = true; card.classList.add('is-dragging'); }, 280);
  }, { passive: true });
  touchTarget.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dy = t.clientY - touchY;
    card.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  touchTarget.addEventListener('touchend', (e) => {
    if (!dragging) return;
    dragging = false;
    card.style.transform = '';
    card.classList.remove('is-dragging');
    const drop = document.elementFromPoint((e.changedTouches[0]||{}).clientX || 0, (e.changedTouches[0]||{}).clientY || 0)?.closest('.timeline-item');
    if (drop && drop !== card) {
      const srcAi = Number(card.dataset.ai);
      const dstAi = Number(drop.dataset.ai);
      const day = appState.generated.days[activeDay];
      const moved = day.activities.splice(srcAi, 1)[0];
      day.activities.splice(dstAi, 0, moved);
      _recomputeDayTimes(day);
      renderSchedule();
      showToast('순서 변경 + 시간 자동 재계산');
    }
  });
}

/* ============ Google Maps deep link ============ */
function _openMap(a) {
  const q = a.googleMapsQuery || `${a.name} ${appState.generated?.city || ''}`;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ============ Save / share ============ */
async function _toggleSave() {
  if (!appState.generated) { showToast('생성된 일정이 없어요'); return; }
  if (!appState.currentUser) { showToast('로그인 후 저장할 수 있어요'); navigate('auth'); return; }
  try {
    if (savedTripId) {
      await api.deleteTrip(savedTripId);
      savedTripId = null;
      $('#btnSave')?.classList.remove('is-active');
      showToast('저장이 해제되었어요');
    } else {
      const payload = { ...appState.generated, expenses: appState.expenses };
      const res = await api.saveTrip(payload);
      savedTripId = res?.id || res?.tripId || 'saved';
      $('#btnSave')?.classList.add('is-active');
      showToast('일정이 저장되었어요');
    }
  } catch (e) {
    console.error('[schedule] save failed', e);
    showToast('저장 중 오류가 발생했어요');
  }
}

async function _share() {
  const g = appState.generated;
  if (!g) { showToast('공유할 일정이 없어요'); return; }
  const text = `${g.city} ${g.days.length}일 · ${g.concept || ''} 일정\n3초 여행에서 생성`;
  if (navigator.share) {
    try { await navigator.share({ title: '3초 여행', text, url: location.href }); return; }
    catch (_) {}
  }
  try { await navigator.clipboard?.writeText(text + '\n' + location.href); showToast('링크를 복사했어요'); }
  catch (_) { showToast('공유를 지원하지 않는 환경이에요'); }
}

// When the user lands on Schedule via the My page's "내 후기" tile,
// scroll the review section into view so they see it immediately.
document.addEventListener('redesign:nav', (e) => {
  if (!e.detail || e.detail.page !== 'schedule') return;
  if (!e.detail.meta || e.detail.meta.kind !== 'reviews') return;
  setTimeout(() => {
    const review = document.getElementById('reviewSection');
    if (review && !review.hidden) {
      review.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 80);
});
