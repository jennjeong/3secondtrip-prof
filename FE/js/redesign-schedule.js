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
import { timeZoneFor, utcOffsetMin, utcLabel, nowIn } from './redesign-cities.js';
import { openState, hoursText } from './redesign-hours.js';
import { publicLink, shareLink } from './redesign-native.js';
import { setPendingIntent, peekPendingIntent, clearPendingIntent } from './redesign-auth.js';
import { api, trackEvent } from './redesign-api-adapter.js';
import {
  el, $, $$, formatCurrency, showToast,
  getSchedulePlaceName, normalizeScheduleItem,
} from './redesign-ui.js';
import { regenerateSchedule, applyBudgetAlternative, budgetAlternativesFor } from './redesign-trip-flow.js';

let appState = null;
let activeDay = 0;
let _dayRestored = false;
let editMode = false;
let editing = null; // {di, ai} target for edit modal

export function initSchedule(state) {
  appState = state;

  $('#btnEditToggle')?.addEventListener('click', () => {
    editMode = !editMode;
    const b = $('#btnEditToggle');
    b.textContent = editMode ? '편집 완료' : '일정 편집';
    b.classList.toggle('is-active', editMode);
    b.setAttribute('aria-pressed', String(editMode));
    if (editMode) showToast('▲▼ 버튼이나 끌어서 순서를 바꾸고, 각 장소의 편집에서 시간·날짜·메모를 고쳐요', 3200);
    $('#scheduleTimeline')?.classList.toggle('is-edit', editMode);
    renderSchedule();
  });

  $('#btnRegen')?.addEventListener('click', async () => {
    // 다시 만들기 전에 바뀌는 범위와 사라지는 편집을 알려 준다.
    const g0 = appState.generated;
    const pinned = g0 ? g0.days.reduce((n, d) => n + d.activities.filter(a => a.pinned).length, 0) : 0;
    const edited = g0 ? g0.days.reduce((n, d) => n + d.activities.filter(a => !a.pinned && (a.edited || a.memo)).length, 0) : 0;
    const msg = `같은 조건(도시·날짜·예산·스타일)으로 ${g0?.days.length || ''}일 일정을 새로 만들어요.`
      + (pinned ? `\n📌 고정한 장소 ${pinned}곳은 같은 날짜·시간에 그대로 남겨요.` : '\n남기고 싶은 장소는 먼저 ‘고정’을 눌러 두세요.')
      + (edited ? `\n고정하지 않고 직접 고치거나 메모를 단 장소 ${edited}곳은 새 장소로 바뀌어요.` : '')
      + '\n\n장소 하나만 바꾸려면 취소하고 그 장소의 [편집 › 비슷한 곳 추천]을 써 보세요.';
    if (!confirm(msg)) return;
    // Have current trip params (city / days / concept / budget) → regen in place.
    if (appState.generated?.days?.length || (appState.trip?.cityName && appState.trip?.days)) {
      const btn = $('#btnRegen');
      if (btn) btn.disabled = true;
      try {
        await regenerateSchedule();   // 완료 안내(고정 장소 포함)는 trip-flow 가 띄운다
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

  $('#btnShare')?.addEventListener('click', _openShareSheet);
  $('#shareClose')?.addEventListener('click', _closeSheet);
  $('#shareBackdrop')?.addEventListener('click', _closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#shareSheet')?.hidden) _closeSheet(); });
  $('#viewToggle')?.addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) _setView(b.dataset.view); });
  $('#dayChecksBtn')?.addEventListener('click', () => {
    checksOpen = !checksOpen;
    const box = $('#dayChecks'); if (box) box.hidden = !checksOpen;
    $('#dayChecksBtn')?.setAttribute('aria-expanded', String(checksOpen));
  });
  document.addEventListener('redesign:map-pick', (e) => {
    if (e.detail?.day !== activeDay) return;
    _pick(e.detail.ai, 'map');
  });
  document.addEventListener('redesign:auth-ready', () => _paintSaveStatus());
  // 예약 후보를 바꾸면 계정에 저장된 일정에도 반영한다
  document.addEventListener('redesign:booking-changed', () => _queueSync());
  _initSaveChoice();
  $('#btnSave')?.addEventListener('click', _toggleSave);
  $('#openBookingBtn')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('redesign:open-booking'));
  });

  // Edit modal
  $('#editClose')?.addEventListener('click', _closeEdit);
  $('#editBackdrop')?.addEventListener('click', _closeEdit);
  $('#editSave')?.addEventListener('click', _commitEdit);
  $('#editDelete')?.addEventListener('click', _deleteEdit);
  $('#editSwap')?.addEventListener('click', _suggestAlternatives);

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
// 합계가 바뀔 때만 숫자가 새 값까지 올라간다. 움직임을 줄인 기기에서는 바로 표시한다.
function _countTo(node, value, format) {
  const from = node._countValue ?? 0;
  node._countValue = value;
  cancelAnimationFrame(node._countFrame);
  if (from === value || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) {
    node.textContent = format(value);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / 600, 1);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = format(Math.round(from + (value - from) * eased));
    if (t < 1) node._countFrame = requestAnimationFrame(step);
  };
  node._countFrame = requestAnimationFrame(step);
}

export function renderSchedule() {
  const g = appState?.generated;
  const empty = $('#scheduleEmpty');
  const timeline = $('#scheduleTimeline');
  const cost = $('#costSummary');
  const cta = $('#bookingCta');
  const review = $('#reviewSection');
  const title = $('#scheduleTitle');
  const sub = $('#scheduleSub');

  const hasG = !!g;
  ['#scheduleActions', '#scheduleDayRow', '#scheduleSplit', '#dayChecks', '#saveStatus', '#scheduleToolbar', '#nowNext', '#toolsSection'].forEach(sel => { const n = $(sel); if (n) n.hidden = !hasG; });
  if (!g) {
    const panel = $('#budgetPanel'); if (panel) panel.hidden = true;
    const sb = $('#sharedBanner'); if (sb) sb.hidden = true;
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

  _migrateExpenses(g);
  // 새로고침해도 보던 날짜로 — 같은 일정일 때만(이 탭에서만 기억)
  if (!_dayRestored) {
    _dayRestored = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem('tst_active_day') || 'null');
      if (saved && saved.key === g.createdAt && saved.day < g.days.length) activeDay = saved.day;
    } catch (_) {}
  }
  if (activeDay >= g.days.length) activeDay = 0;
  try { sessionStorage.setItem('tst_active_day', JSON.stringify({ key: g.createdAt, day: activeDay })); } catch (_) {}
  if (empty) empty.hidden = true;
  if (timeline) timeline.hidden = false;
  if (cost) cost.hidden = !!g.hideCost;
  const sb = $('#sharedBanner');
  if (sb) sb.hidden = !g.sharedView;
  if (cta) cta.hidden = false;
  if (review) review.hidden = false;

  const nDays = g.days.length;
  if (title) title.textContent = g.title || `${g.originName ? g.originName + ' → ' : ''}${g.city} 여행`;
  if (sub) sub.textContent = [
    nDays <= 1 ? '당일치기' : `${nDays - 1}박 ${nDays}일`,
    g.people ? `${g.people}명` : _companion(g.companion),
    g.concept && `${g.concept} 스타일`,
  ].filter(Boolean).join(' · ');

  if (g.hideCost) { const panel = $('#budgetPanel'); if (panel) panel.hidden = true; }
  else _renderBudgetPanel(g);
  _renderNowNext(g);
  _renderDayChips(g);
  _renderAiSummary(g);
  _renderTimeline(g);
  _renderCostSummary(g);
  _paintSaveStatus();
  _queueSync();
  const pick = $('#mapPick'); if (pick && focusedAi == null) pick.hidden = true;

  _emitScheduleChanged();
}

/** 예전 버전은 사용자가 고친 금액을 '몇 번째 칸' 기준(expenses)으로 따로 저장해
 *  장소를 지우거나 옮기면 다른 장소에 붙었다.  장소의 cost 로 옮기고 비운다. */
function _migrateExpenses(g) {
  const ex = appState.expenses;
  if (!ex || !Object.keys(ex).length) return;
  for (const [k, v] of Object.entries(ex)) {
    const [di, ai] = k.split('_').map(Number);
    const a = g.days[di]?.activities[ai];
    if (a && Number.isFinite(Number(v))) a.cost = Number(v);
  }
  appState.expenses = {};
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

function _dow(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y ? '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] : '';
}

function _renderDayChips(g) {
  const row = $('#dayChips');
  if (!row) return;
  row.innerHTML = '';
  g.days.forEach((d, idx) => {
    // 일별 비용 합계
    const dayCost = _dayTotal(d, idx);
    const costLabel = g.hideCost ? '' : _shortMoney(dayCost, g);
    const chip = el('button', {
      type: 'button',
      class: 'day-chip' + (idx === activeDay ? ' is-active' : ''),
      role: 'tab',
      ariaSelected: String(idx === activeDay),
      ariaLabel: `${idx + 1}일차 ${d.date}${g.hideCost ? '' : ' 예상 ' + _money(dayCost, g)}`,
      onclick: () => { activeDay = idx; focusedAi = null; renderSchedule(); },
    }, [
      el('span', { class: 'day-chip-date' }, `${Number(d.date.slice(5, 7))}.${Number(d.date.slice(8, 10))} ${_dow(d.date)}`),
      el('span', { class: 'day-chip-label' }, `${idx + 1}일차`),
    ]);
    row.appendChild(chip);
  });
  // 고른 날의 예상 비용은 탭 아래 줄에 — 탭은 날짜만 보여 줘서 좁은 화면에서도 잘리지 않는다.
  const d = g.days[activeDay];
  const line = $('#dayCostLine');
  const utc = utcLabel(utcOffsetMin(_tripTz(g), d?.date));
  if (line) line.textContent = d ? `${activeDay + 1}일차 · ${g.hideCost ? '비용 숨김' : '하루 약 ' + _shortMoney(_dayTotal(d, activeDay), g)}${utc ? ` · 현지 시각 ${utc}` : ''}` : '';
  // 긴 여행에서도 고른 날짜가 보이도록
  requestAnimationFrame(() => row.querySelector('.day-chip.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}

/* ============ 일정 검증 ============
 * 데이터로 확인할 수 있는 것(시간 순서·이동 시간·중복·출도착)은 경고로,
 * 확인할 수 없는 것(영업시간·휴무·체크인 가능 시간)은 '확인 필요'로 표시한다. */
const _CHECKIN_FROM = 15 * 60;      // 보통 체크인 가능 시간
const _AIRPORT_BEFORE = 120;        // 국제선 출발 2시간 전 공항 도착
const _ARRIVE_TO_HOTEL = 60;        // 착륙 → 입국 심사·수하물 → 숙소
const _ARRIVE_TO_CITY = 90;         // 착륙 → 입국 심사·수하물 → 시내 첫 장소
const _OPEN_CHECK_CATS = new Set(['관광', '식사', '카페', '쇼핑', '액티비티']);

function _isFlight(a) { return a?.category === '이동' && !!a.flightMeta; }
function _flightArrMin(a) {
  const m = /도착\s*(\d{1,2}):(\d{2})/.exec(a?.address || '');
  return m ? (+m[1]) * 60 + (+m[2]) : _timeToMin(a?.time);
}
function _flightDepMin(a) {
  const m = /출발\s*(\d{1,2}):(\d{2})/.exec(a?.address || '');
  return m ? (+m[1]) * 60 + (+m[2]) : _timeToMin(a?.time);
}

/** 하루치 점검 결과. items[ai] = 카드에 붙일 표시들, list = 위쪽 요약. */
function _checkDay(g, di) {
  const day = g.days[di];
  const acts = day?.activities || [];
  const items = acts.map(() => []);
  const list = [];
  const isArrivalFlight = (a) => _isFlight(a) && /도착/.test(a.name || '');
  const isDepartFlight = (a) => _isFlight(a) && /출발/.test(a.name || '');

  // 1) 항공 도착 전 일정 — 착륙 뒤 입국·시내 이동 시간까지 본다(숙소 60분, 그 밖의 장소 90분).
  const arr = acts.findIndex(isArrivalFlight);
  if (arr >= 0) {
    const arrMin = _flightArrMin(acts[arr]);
    const est = /예상|예시/.test(acts[arr].address || '') ? ' (예상 도착 기준)' : '';
    acts.forEach((a, ai) => {
      if (ai === arr || _isFlight(a)) return;
      const t = _timeToMin(a.time);
      const ready = arrMin + (a.category === '숙박' ? _ARRIVE_TO_HOTEL : _ARRIVE_TO_CITY);
      if (t < arrMin) {
        items[ai].push({ lvl: 'warn', text: '항공편 도착 전이에요' });
        list.push({ lvl: 'warn', ai, fix: 'time', text: `${a.time} ${_short(a.name)} — 항공편 도착(${_minToTime(arrMin)})${est} 전에 잡혀 있어요.` });
      } else if (t < ready) {
        items[ai].push({ lvl: 'warn', text: '입국·이동 시간이 부족해요' });
        list.push({ lvl: 'warn', ai, fix: 'time', text: `${a.time} ${_short(a.name)} — 착륙(${_minToTime(arrMin)}) 뒤 입국·시내 이동을 생각하면 ${_minToTime(ready)} 이후가 좋아요.` });
      }
    });
  }
  // 2) 체크인 가능 시간
  acts.forEach((a, ai) => {
    if (a.category === '숙박' && /체크인/.test(a.name || '') && _timeToMin(a.time) < _CHECKIN_FROM) {
      items[ai].push({ lvl: 'check', text: '체크인 시간 확인 필요' });
      list.push({ lvl: 'check', ai, text: `체크인은 보통 15시부터예요. ${a.time}에는 짐만 맡길 수 있는지 숙소에 확인해 주세요.` });
    }
  });
  // 3) 이동 시간 부족(동선 충돌) — 앞 장소 체류 + 이동 시간보다 다음 시작이 빠르면
  for (let ai = 1; ai < acts.length; ai++) {
    const prev = acts[ai - 1], cur = acts[ai];
    if (_isFlight(prev) || _isFlight(cur)) continue;
    if (_kmBetween(prev, cur) == null) continue;     // 위치를 모르면 이동 시간을 판단하지 않는다
    const need = _timeToMin(prev.time) + _stayMinutes(prev) + _travelMinutes(prev, cur);
    if (_timeToMin(cur.time) + 10 < need) {
      items[ai].push({ lvl: 'warn', text: '이동 시간이 부족해요' });
      list.push({ lvl: 'warn', ai, fix: 'time', text: `${_short(prev.name)} → ${_short(cur.name)} 사이 시간이 약 ${need - _timeToMin(cur.time)}분 모자라요.` });
    }
    if (_timeToMin(cur.time) < _timeToMin(prev.time)) {
      items[ai].push({ lvl: 'warn', text: '앞 일정보다 이른 시간' });
      list.push({ lvl: 'warn', ai, fix: 'time', text: `${cur.time} ${_short(cur.name)} — 앞 일정(${prev.time})보다 이른 시간이에요.` });
    }
  }
  // 4) 마지막 날 출국 이동
  const dep = acts.findIndex(isDepartFlight);
  if (dep > 0) {
    const depMin = _flightDepMin(acts[dep]);
    const prev = acts[dep - 1];
    const leave = _timeToMin(prev.time) + (prev.category === '숙박' ? 15 : _dwellMinutes(prev.category));
    const travel = _travelMinutes(prev, acts[dep]);
    if (leave + travel > depMin - _AIRPORT_BEFORE) {
      items[dep].push({ lvl: 'warn', text: '공항 이동 시간 빠듯함' });
      // 출국 전 마지막 장소(숙소 제외)를 빼는 방법을 함께 제안한다.
      let last = -1;
      for (let k = dep - 1; k >= 0; k--) if (!_isFlight(acts[k]) && acts[k].category !== '숙박') { last = k; break; }
      if (last >= 0) list.push({ lvl: 'warn', ai: last, fix: 'drop', text: `출국 준비 시간이 모자라요. ${_josa(_short(acts[last].name), '을', '를')} 빼면 여유가 생겨요.` });
      list.push({ lvl: 'warn', ai: dep - 1, text: `출국 2시간 전 공항 도착 기준으로 ${_short(prev.name)}에서 늦어도 ${_minToTime(depMin - _AIRPORT_BEFORE - travel)}에는 출발해야 해요.` });
    }
  }
  // 5) 중복 방문(여행 전체)
  const seen = new Map();
  g.days.forEach((d, dj) => d.activities.forEach((a) => {
    if (a.category === '이동' || a.category === '숙박' || a.sample) return;
    const k = (a.placeId && !String(a.placeId).startsWith('custom-')) ? a.placeId : _norm(a.name);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(dj);
  }));
  acts.forEach((a, ai) => {
    if (a.category === '이동' || a.category === '숙박' || a.sample) return;
    const k = (a.placeId && !String(a.placeId).startsWith('custom-')) ? a.placeId : _norm(a.name);
    const days = seen.get(k) || [];
    if (days.length > 1) {
      items[ai].push({ lvl: 'warn', text: `중복 방문 (${days.map(x => x + 1).join('·')}일차)` });
    }
  });
  if (acts.some((a, ai) => items[ai].some(x => x.text.startsWith('중복')))) {
    list.push({ lvl: 'warn', text: '같은 장소가 두 번 이상 들어 있어요. 한 곳을 바꿔 보세요.' });
  }
  // 6) 자정 넘김 · 늦은 시간
  acts.forEach((a, ai) => {
    if (a.pastMidnight && !_isFlight(a)) {
      items[ai].push({ lvl: 'warn', text: '자정을 넘겨요' });
      list.push({ lvl: 'warn', ai, fix: 'drop', text: `${_short(a.name)} — 앞 일정을 지키면 자정을 넘겨 다음 날이 돼요. 빼거나 다른 날로 옮겨 주세요.` });
    }
  });
  acts.forEach((a, ai) => {
    if (_timeToMin(a.time) >= 23 * 60 && !_isFlight(a) && a.category !== '숙박') items[ai].push({ lvl: 'check', text: '늦은 시간 — 영업 여부 확인' });
  });
  // 7) 영업시간·휴무 — 데이터가 없으면 확인 필요
  let unknownHours = 0;
  const date = day?.date;
  acts.forEach((a, ai) => {
    if (!_OPEN_CHECK_CATS.has(a.category)) return;
    const st = openState(a.openingPeriods, date, a.time);
    if (st === 'closedDay') {
      items[ai].push({ lvl: 'warn', text: '이날 휴무' });
      list.push({ lvl: 'warn', ai, fix: 'drop', text: `${_short(a.name)} — 이날은 문을 닫아요(장소 정보 기준). 빼거나 다른 장소로 바꿔 주세요.` });
    } else if (st === 'closedNow') {
      items[ai].push({ lvl: 'warn', text: `영업시간 밖 (${hoursText(a.openingPeriods, date)})` });
      list.push({ lvl: 'warn', ai, fix: 'time', text: `${a.time} ${_short(a.name)} — 이 시각엔 닫혀 있어요. 영업시간 ${hoursText(a.openingPeriods, date)}.` });
    } else if (st === 'unknown') { items[ai].push({ lvl: 'check', text: '영업시간·휴무 확인 필요' }); unknownHours++; }
  });
  if (unknownHours) list.push({ lvl: 'check', ai: acts.findIndex(a => _OPEN_CHECK_CATS.has(a.category) && openState(a.openingPeriods, date, a.time) === 'unknown'),
    text: `${unknownHours}곳은 영업시간 정보가 없어요(문을 닫았다는 뜻은 아니에요). 가기 전에 확인해 주세요.` });
  // 8) 계단 피하기·휠체어를 골랐을 때 — 출입구 정보
  if ((g.needs || []).includes('stepFree')) {
    let unknownAccess = 0;
    acts.forEach((a, ai) => {
      if (!_OPEN_CHECK_CATS.has(a.category)) return;
      if (a.stepFree === false) {
        items[ai].push({ lvl: 'warn', text: '휠체어 출입구 없음(장소 정보 기준)' });
        list.push({ lvl: 'warn', ai, fix: 'drop', text: `${_short(a.name)} — 장소 정보에 휠체어로 들어갈 수 있는 출입구가 없다고 나와요. 다른 장소로 바꿔 주세요.` });
      } else if (a.stepFree == null) { items[ai].push({ lvl: 'check', text: '접근성 확인 필요' }); unknownAccess++; }
    });
    if (unknownAccess) list.push({ lvl: 'check', text: `${unknownAccess}곳은 출입구 접근성 정보가 없어요. 가기 전에 확인해 주세요.` });
  }
  if (acts.some(a => !_isFlight(a) && _kmBetween(a, a) == null && a.category !== '숙박')) {
    list.push({ lvl: 'check', text: '위치를 모르는 장소는 이동 시간을 20분으로 가정했어요. 이동 시간은 직선거리 기준 추정이에요.' });
  }
  return { items, list };
}

/** 받침에 맞는 조사 — _josa('아키하바라', '을', '를') → '아키하바라를' */
function _josa(word, withBatchim, without) {
  const w = String(word || '');
  const c = w.charCodeAt(w.length - 1);
  if (c >= 0xAC00 && c <= 0xD7A3) return w + (((c - 0xAC00) % 28) ? withBatchim : without);
  return w + without;   // 한글이 아니면 받침 없는 쪽(을/를 → 를)
}

function _short(name) {
  const s = String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}
function _norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }

let checksOpen = false;
function _renderDayChecks(g, check) {
  const box = $('#dayChecks');
  if (!box) return;
  const day = g.days[activeDay];
  const total = day ? _dayTotal(day, activeDay) : 0;
  const warn = check.list.filter(x => x.lvl === 'warn');
  const need = check.list.filter(x => x.lvl === 'check');
  const head = el('p', { class: 'dc-head' }, [
    el('strong', {}, `${activeDay + 1}일차`),
    ` · 장소 ${day?.activities.length || 0}곳 · 예상 지출 ${_money(total, g)}`,
  ]);
  const jump = (x) => Number.isInteger(x.ai) && x.ai >= 0
    ? el('button', { type: 'button', class: 'dc-jump', onclick: () => {
        const card = $(`#scheduleTimeline .schedule-card[data-ai="${x.ai}"]`);
        if (card) { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); card.focus({ preventScroll: true }); card.classList.add('is-flash'); setTimeout(() => card.classList.remove('is-flash'), 1400); }
      } }, [x.text, el('span', { class: 'dc-go', 'aria-hidden': 'true' }, ' ›')])
    : x.text;
  const parts = [head];
  if (!warn.length && !need.length) parts.push(el('ul', { class: 'dc-list' }, [el('li', { class: 'dc-ok' }, '시간 순서와 이동 시간에 문제가 없어요.')]));
  if (warn.length) {
    parts.push(el('p', { class: 'dc-group dc-group--warn' }, `해결 필요 ${warn.length}`));
    parts.push(el('ul', { class: 'dc-list' }, warn.map(x => el('li', { class: 'dc-warn' }, [jump(x),
      x.fix === 'drop' ? el('button', { type: 'button', class: 'btn btn-soft dc-drop', onclick: () => _dropForDeparture(activeDay, x.ai) }, '이 장소 빼기') : null]))));
    if (warn.some(x => x.fix === 'time')) {
      parts.push(el('button', { type: 'button', class: 'btn btn-soft dc-fix', onclick: () => _fixDayTimes(activeDay) }, '시간 다시 맞추기'));
    }
  }
  if (need.length) {
    parts.push(el('p', { class: 'dc-group dc-group--check' }, `정보 확인 필요 ${need.length}`));
    parts.push(el('ul', { class: 'dc-list' }, need.map(x => el('li', { class: 'dc-check' }, jump(x)))));
  }
  box.replaceChildren(...parts);
  box.hidden = !checksOpen;
  const btn = $('#dayChecksBtn');
  if (btn) {
    btn.replaceChildren(
      el('span', { class: 'cb-ico', 'aria-hidden': 'true' }, warn.length ? '⚠' : need.length ? 'i' : '✓'),
      el('span', { class: 'cb-text' }, warn.length ? `해결할 것 ${warn.length}건${need.length ? ` · 확인할 것 ${need.length}건` : ''}` : need.length ? `확인할 것 ${need.length}건` : '일정 점검 · 이상 없음'),
      el('span', { class: 'cb-chev', 'aria-hidden': 'true' }, '›'),
    );
    btn.classList.toggle('is-check', !warn.length && need.length > 0);
    btn.setAttribute('aria-label', warn.length ? `일정 점검 — 해결 필요 ${warn.length}건${need.length ? `, 정보 확인 필요 ${need.length}건` : ''}` : need.length ? `일정 점검 — 정보 확인 필요 ${need.length}건` : '일정 점검 — 이상 없음');
    btn.classList.toggle('is-warn', warn.length > 0);
    btn.setAttribute('aria-expanded', String(checksOpen));
  }
}

/** 출국 준비 시간을 위해 장소 하나를 뺀다 — 고정한 장소면 한 번 더 묻는다. */
function _dropForDeparture(di, ai) {
  const day = appState.generated?.days?.[di];
  const a = day?.activities?.[ai];
  if (!a) return;
  if (!confirm(`${_josa(a.name, '을', '를')} 이 날 일정에서 뺄까요?${a.pinned ? '\n고정한 장소예요.' : ''}`)) return;
  day.activities.splice(ai, 1);
  _persist();
  renderSchedule();
  showToast(`${_josa(_short(a.name), '을', '를')} 뺐어요 · 점검 결과를 다시 확인해 주세요`);
}

/** 점검에서 찾은 시간 문제를 고친다 — 항공편은 그대로, 다른 장소는 순서를 지키며 뒤로만 민다. */
function _fixDayTimes(di) {
  const g = appState.generated;
  const day = g?.days?.[di];
  if (!day) return;
  const before = new Map(day.activities.map(a => [a, a.time]));   // 순서가 바뀌어도 같은 항목끼리 비교
  const preview = { activities: day.activities.map(a => ({ ...a, _src: a })) };
  _recomputeDayTimes(preview, { keepLater: true });
  const changed = preview.activities.filter(p => p.time !== before.get(p._src));
  const moved = changed.length;
  const pinned = changed.filter(p => p.pinned).length;
  if (!moved) { showToast('시간을 옮겨도 나아지지 않아요. 장소를 빼거나 바꿔 주세요'); return; }
  if (pinned && !confirm(`고정한 장소 ${pinned}곳의 시간도 바뀌어요. 계속할까요?`)) return;
  _recomputeDayTimes(day, { keepLater: true });
  day.activities.forEach(a => { if (a.time !== before.get(a)) a.edited = true; });
  _persist();
  renderSchedule();
  const late = day.activities.filter(a => !_isFlight(a) && _timeToMin(a.time) >= 23 * 60).length;
  showToast(`${moved}곳의 시간을 맞췄어요${late ? ` · ${late}곳이 23시 이후라 빼는 걸 고려해 주세요` : ''}`, 3600);
}

/* ============ 타임라인 ============
 * 카드 순서: 현지 시각 → 장소명 → 활동 → (다음 장소까지 이동) → 예상 비용.
 * 주소와 지도 열기는 '자세히' 안으로 묶는다. */
function _renderTimeline(g) {
  const tl = $('#scheduleTimeline');
  if (!tl) return;
  tl.innerHTML = '';
  const day = g.days[activeDay];
  if (!day) return;
  const check = _checkDay(g, activeDay);
  _renderDayChecks(g, check);

  if (editMode) {
    tl.appendChild(el('button', {
      type: 'button',
      class: 'btn btn-soft btn-block add-place-top',
      onclick: _addPlace,
    }, '+ 장소 추가'));
  }
  if (!day.activities.length) {
    tl.appendChild(el('p', { class: 'tl-empty' }, '이 날은 아직 장소가 없어요. 편집에서 장소를 추가해 보세요.'));
    return;
  }

  const hotelNightly = _nightlyHotelRate(g);
  const movables = day.activities.map(a => a.category !== '이동' && a.category !== '숙박');

  day.activities.forEach((a, ai) => {
    const n = normalizeScheduleItem(a, ai);
    const placeName = n.placeName;
    const hasName = placeName && placeName !== 'Place name not available';
    const movable = movables[ai];

    // 비용 줄
    let costText = '';
    let costTag = '';
    const c = _actCost(activeDay, ai, n.cost);
    if (a.excludedFromBudget && n.category === '숙박') costText = '숙소비는 예산에서 뺐어요';
    else if (a.flightMeta?.source === 'excluded') costText = '항공권은 예산에서 뺐어요';
    else if (n.category === '숙박') {
      if (hotelNightly > 0) {
        const rooms = g.budgetPlan?.rooms || 1;
        costText = `1박 약 ${_shortMoney(hotelNightly, g)}${rooms > 1 ? ` (객실 ${rooms}개 합계)` : ''}`;
        costTag = g.hotelPriceSource === 'serpapi' ? '실시간' : '';
      }
    } else if (_costUnknown(n)) {
      costText = '비용 미확인 · 합계에 포함 안 됨';
    } else if (c > 0) {
      costText = (n.edited ? '' : '약 ') + _shortMoney(c, g);
      costTag = n.category === '이동' ? (g.flightPriceSource === 'serpapi' ? '실시간' : n.edited ? '직접 입력' : '') : (n.edited ? '직접 입력' : '');
    } else if (n.edited && Number(n.cost) === 0 && n.category !== '숙박') {
      costText = '무료';
    }

    const flags = check.items[ai] || [];
    const details = [];
    if (n.address && n.address !== placeName) details.push(el('p', { class: 'sc-addr' }, n.address));
    details.push(el('button', { type: 'button', class: 'btn-text sc-map-link', 'aria-label': `${placeName} Google 지도에서 열기`, onclick: (e) => { e.stopPropagation(); _openMap(a); } }, '지도 열기 ↗'));

    const card = el('article', {
      class: 'schedule-card' + (hasName ? '' : ' schedule-card--no-name') + (focusedAi === ai ? ' is-focused' : '') + (a.visited ? ' is-visited' : ''),
      draggable: 'false',
      tabIndex: -1,
      dataset: { di: String(activeDay), ai: String(ai), placeId: n.placeId || n.id || '', movable: movable ? '1' : '0' },
      'aria-labelledby': `scName${ai}`,
    }, [
      el('div', { class: 'sc-when' }, [
        el('span', { class: 'schedule-time' }, n.time || '미정'),
        el('span', { class: 'sc-num', 'aria-hidden': 'true' }, String(ai + 1)),
      ]),
      el('div', { class: 'schedule-card-main' }, [
        el('h3', { class: 'schedule-place-name', id: `scName${ai}` }, placeName),
        el('p', { class: 'schedule-card-meta-line' }, [
          n.category ? el('span', { class: 'schedule-category' }, n.category) : null,
          a.pinned ? el('span', { class: 'pin-badge' }, '고정') : null,
          a.visited ? el('span', { class: 'visited-badge' }, '다녀옴') : null,
          a.sample ? el('span', { class: 'sample-badge', title: '실제 검색 결과가 없어 넣은 예시 장소예요' }, '예시 장소') : null,
          a.edited ? el('span', { class: 'edited-badge' }, '직접 수정') : null,
        ].filter(Boolean)),
        n.memo ? el('p', { class: 'schedule-place-subinfo schedule-memo' }, '메모 · ' + n.memo) : null,
        costText ? el('p', { class: 'schedule-place-subinfo schedule-cost' }, [
          el('span', { class: 'sr-only' }, '예상 비용 '), costText,
          costTag ? el('span', { class: 'schedule-price-tag' + (costTag === '실시간' ? ' is-live' : '') }, ' · ' + costTag) : null,
        ]) : null,
        flags.length ? el('ul', { class: 'sc-flags' }, flags.map(f => el('li', { class: 'sc-flag sc-flag--' + f.lvl }, f.text))) : null,
        el('div', { class: 'sc-where' }, details),
      ]),
      el('div', { class: 'schedule-card-actions' }, [
        el('button', {
          type: 'button', class: 'edit-button', 'aria-label': `${placeName} 편집`,
          onclick: (e) => { e.stopPropagation(); _openEdit(activeDay, ai); },
        }, '편집'),
        ...(movable && !g.sharedView ? [el('button', {
          type: 'button', class: 'pin-btn' + (a.pinned ? ' is-on' : ''), 'aria-pressed': String(!!a.pinned),
          'aria-label': `${placeName} ${a.pinned ? '고정 풀기' : '고정 — 다시 만들어도 남겨요'}`,
          title: '다시 만들기를 해도 이 장소를 남겨요',
          onclick: (e) => { e.stopPropagation(); a.pinned = !a.pinned; renderSchedule(); showToast(a.pinned ? '고정했어요. 다시 만들어도 이 장소는 남아요' : '고정을 풀었어요'); },
        }, a.pinned ? '고정됨' : '고정')] : []),
        ...(_tripStarted(g) && !g.sharedView ? [el('button', {
          type: 'button', class: 'visit-btn' + (a.visited ? ' is-on' : ''), 'aria-pressed': String(!!a.visited),
          'aria-label': `${placeName} 다녀옴 ${a.visited ? '표시 지우기' : '표시'}`,
          onclick: (e) => { e.stopPropagation(); _toggleVisited(activeDay, ai); },
        }, a.visited ? '✓ 다녀옴' : '다녀옴')] : []),
        ...(editMode && movable ? [
          el('button', { type: 'button', class: 'move-btn', 'aria-label': `${placeName} 위로 이동`, disabled: !movables[ai - 1] || null,
            onclick: (e) => { e.stopPropagation(); _moveActivity(ai, ai - 1, false); _focusCard(ai - 1, '위'); } }, '▲'),
          el('button', { type: 'button', class: 'move-btn', 'aria-label': `${placeName} 아래로 이동`, disabled: !movables[ai + 1] || null,
            onclick: (e) => { e.stopPropagation(); _moveActivity(ai, ai + 1, true); _focusCard(ai + 1, '아래'); } }, '▼'),
          el('span', { class: 'drag-handle', title: '끌어서 순서 변경', 'aria-hidden': 'true' }, '⋮⋮'),
        ] : []),
      ]),
    ]);
    // 카드를 누르면 지도에서 같은 장소를 강조한다(버튼·링크 제외).
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, summary, details')) return;
      _pick(ai, 'card');
    });
    if (editMode) _bindDnd(card);
    tl.appendChild(card);

    // 다음 장소까지 이동
    const next = day.activities[ai + 1];
    if (next) {
      let moveText;
      if (_isFlight(a) || _isFlight(next)) moveText = _isFlight(next) ? '공항으로 이동 · 출국 2시간 전 도착' : '공항 → 시내 이동';
      else {
        const km = _kmBetween(a, next);
        const min = _travelMinutes(a, next);
        // 두 장소 사이의 짧은 한 줄 — ‘도보 약 5분 · 800m’
        moveText = km == null ? `이동 약 ${min}분`
          : `${km < 1.2 ? '도보' : '대중교통'} 약 ${min}분 · ${km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km'}`;
      }
      tl.appendChild(el('p', { class: 'tl-move' }, moveText));
    }
  });
}


/* ============ 여행 중 보기 ============
 * 오늘이 여행 날짜에 들어 있으면 '지금 → 다음 장소'를 보여 주고, 다녀온 곳을 표시하게 한다.
 * 시각은 이 기기의 시계를 기준으로 한다(현지에 도착하면 휴대폰이 현지 시간으로 바뀐다). */
function _todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _tripStarted(g) { return !!g.days[0]?.date && _todayIso() >= g.days[0].date; }

function _toggleVisited(di, ai) {
  const a = appState.generated?.days[di]?.activities[ai];
  if (!a) return;
  a.visited = !a.visited;
  renderSchedule();
  showToast(a.visited ? `‘${_short(a.name)}’ 다녀왔어요` : '다녀옴 표시를 지웠어요');
}

/** 일정의 현지 시간대 — 예전 일정은 도시로 찾는다. */
function _tripTz(g) { return g.timeZone || timeZoneFor(g.city, g.country); }

function _renderNowNext(g) {
  const box = $('#nowNext');
  if (!box) return;
  const hide = () => { box.hidden = true; box.replaceChildren(); };
  // '지금'은 여행지 현지 시각으로 판단한다(휴대폰이 한국 시간이어도).
  const tz = _tripTz(g);
  const now = nowIn(tz);
  const di = g.days.findIndex(d => d.date === now?.iso);
  if (di < 0 || g.sharedView || !Number.isFinite(now?.min)) { hide(); return; }
  const acts = g.days[di].activities || [];
  // 시각과 이름이 모두 있는 장소만 — 빈 값이나 'null' 을 그리지 않는다.
  const named = (a) => { const n = getSchedulePlaceName(a); return n && n !== 'Place name not available' && n !== 'null' ? n : ''; };
  const items = acts.map((a, i) => ({ a, i, m: _timeToMin(a.time), n: named(a) }))
    .filter(x => x.a.time && Number.isFinite(x.m) && x.n);
  if (!items.length) { hide(); return; }
  const nowMin = now.min;
  const cur = [...items].reverse().find(x => x.m <= nowMin) || null;
  const next = items.find(x => (!cur || x.i > cur.i) && !x.a.visited) || null;
  const rows = [];
  if (cur) rows.push(el('div', { class: 'nn-row' }, [
    el('span', { class: 'nn-label' }, '지금'),
    el('span', { class: 'nn-place' }, [el('strong', {}, cur.n), el('small', {}, [cur.a.time, cur.a.visited ? '다녀옴' : ''].filter(Boolean).join(' · '))]),
  ]));
  if (next) {
    const mins = next.m - nowMin;
    const when = mins > 0 ? `${mins >= 60 ? Math.floor(mins / 60) + '시간 ' : ''}${mins % 60 ? (mins % 60) + '분' : ''} 뒤`.replace(/^ /, '') : '지금 출발';
    rows.push(el('div', { class: 'nn-row' }, [
      el('span', { class: 'nn-label' }, '다음'),
      el('span', { class: 'nn-place' }, [el('strong', {}, next.n), el('small', {}, `현지 ${next.a.time} · ${when}`)]),
    ]));
  } else if (cur) rows.push(el('p', { class: 'nn-done' }, '오늘 남은 일정이 없어요.'));
  if (!rows.length) { hide(); return; }
  const actions = [];
  if (cur && !cur.a.visited) actions.push(el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _toggleVisited(di, cur.i) }, '지금 장소 다녀왔어요'));
  if (activeDay !== di) actions.push(el('button', { type: 'button', class: 'btn-text', onclick: () => { activeDay = di; renderSchedule(); } }, `${di + 1}일차 일정 보기`));
  const done = acts.filter(a => a.visited).length;
  box.replaceChildren(
    el('p', { class: 'nn-head' }, [el('strong', {}, `여행 중 · ${di + 1}일차`), now.hhmm ? ` · 현지 ${now.hhmm}` : '', ` · 다녀온 곳 ${done}/${acts.length}`]),
    ...rows,
    actions.length ? el('div', { class: 'nn-actions' }, actions) : null,
  );
  box.hidden = false;
}

/* ============ 목록 ↔ 지도 연결 ============ */
let focusedAi = null;
/** 옮긴 카드의 같은 방향 버튼(없으면 카드)으로 초점을 옮겨 연달아 누를 수 있게 한다. */
function _focusCard(ai, dir) {
  requestAnimationFrame(() => {
    const card = $(`#scheduleTimeline .schedule-card[data-ai="${ai}"]`);
    const btn = card?.querySelector(`.move-btn[aria-label$="${dir}로 이동"]:not(:disabled)`);
    (btn || card)?.focus();
  });
}
function _pick(ai, from) {
  focusedAi = ai;
  $$('#scheduleTimeline .schedule-card').forEach(c => c.classList.toggle('is-focused', Number(c.dataset.ai) === ai));
  if (from === 'map') {
    const card = $(`#scheduleTimeline .schedule-card[data-ai="${ai}"]`);
    _renderMapPick(ai);
    if (card && !card.closest('.is-hidden-view')) card.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } else {
    document.dispatchEvent(new CustomEvent('redesign:place-pick', { detail: { ai, day: activeDay } }));
  }
}
function _renderMapPick(ai) {
  const box = $('#mapPick');
  const a = appState.generated?.days[activeDay]?.activities[ai];
  if (!box) return;
  if (!a) { box.hidden = true; return; }
  box.replaceChildren(
    el('span', { class: 'sc-num', 'aria-hidden': 'true' }, String(ai + 1)),
    el('div', { class: 'mp-body' }, [
      el('strong', {}, getSchedulePlaceName(a)),
      el('span', {}, [a.time, a.category].filter(Boolean).join(' · ')),
    ]),
    el('button', { type: 'button', class: 'btn-text', onclick: () => { _setView('list'); _pick(ai, 'map'); $(`#scheduleTimeline .schedule-card[data-ai="${ai}"]`)?.focus(); } }, '목록에서 보기'),
  );
  box.hidden = false;
}

let view = 'list';
function _setView(v) {
  view = v;
  const page = $('#schedulePage');
  page?.classList.toggle('view-map', v === 'map');
  $$('#viewToggle [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (v === 'map') _emitScheduleChanged();   // 숨어 있던 지도를 다시 그린다
}

const _SWAP_QUERY = { 식사: '맛집', 카페: '인기 카페', 쇼핑: '쇼핑 명소', 관광: '인기 명소', 액티비티: '인기 체험' };

function _actKey(di, ai) { return `${di}_${ai}`; }
/** 비용을 모르는 항목 — 직접 추가하면서 비용 칸을 비운 경우(null). 0은 '무료'. */
function _costUnknown(a) {
  return a && (a.cost === null || a.cost === undefined) && a.category !== '이동' && a.category !== '숙박';
}

function _actCost(di, ai, fallback) {
  const a = appState.generated?.days[di]?.activities[ai];
  return Number(a?.cost ?? fallback) || 0;
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

/** 하루 합계 = 그날 항목 비용 + 하루 현지 교통비. 일별·전체 합계가 같은 데이터를 쓴다. */
function _dayTotal(d, di) {
  const items = d.activities.reduce((sum, a, ai) => sum + (a.excludedFromBudget ? 0 : _actCost(di, ai, a.cost)), 0);
  return items + (Number(d.localTransport) || 0);
}

/** 전체 비용을 항목별로 나눈다(사용자 수정값 expenses 반영). */
function _computeBudgetBreakdown(g) {
  const bd = { flight: 0, hotel: 0, food: 0, entry: 0, shopping: 0, transport: 0, nights: 0, unknown: 0 };
  g.days.forEach((d, di) => {
    bd.transport += Number(d.localTransport) || 0;
    d.activities.forEach((a, ai) => {
      if (a.excludedFromBudget) return;
      if (_costUnknown(a)) { bd.unknown += 1; return; }   // 모르는 비용은 0원으로 더하지 않는다
      const c = _actCost(di, ai, a.cost);
      if (a.category === '이동' && a.flightMeta) bd.flight += c;     // 가는 편 + 오는 편 = 왕복
      else if (a.category === '숙박') { bd.hotel += c; if (c > 0) bd.nights += 1; }   // 1박 요금은 '복귀(1박)'에만
      else if (a.category === '식사' || a.category === '카페') bd.food += c;
      else if (a.category === '쇼핑') bd.shopping += c;
      else bd.entry += c;
    });
  });
  bd.hotelPerNight = bd.nights ? Math.round(bd.hotel / bd.nights) : 0;
  bd.total = bd.flight + bd.hotel + bd.food + bd.entry + bd.shopping + bd.transport;
  return bd;
}

/** 원화 금액을 결과 통화로 보여 준다. 환율이 없으면 원화 그대로. */
function _money(krw, g) {
  const n = Number(krw) || 0;
  if (g?.fx?.rate) return formatCurrency(n * g.fx.rate, g.fx.currency);
  return formatCurrency(n, 'KRW');
}

/** 금액 한 칸 — 원화는 ‘149만 8천 원’, 정확한 금액은 title 과 화면 낭독용으로 함께 둔다. */
function _amountRow(label, krw, g, cls) {
  const short = g?.fx?.rate ? _money(krw, g) : _shortMoney(krw, g);
  const exact = _money(krw, g);
  return el('div', { class: 'money-row' + (cls ? ' ' + cls : '') }, [
    el('dt', {}, label),
    el('dd', { title: exact }, [short, el('span', { class: 'sr-only' }, ` (${exact})`)]),
  ]);
}

function _row(label, value, { note, cls } = {}) {
  return el('div', { class: 'money-row' + (cls ? ' ' + cls : '') }, [
    el('dt', {}, note ? [label, ' ', el('small', {}, note)] : label),
    el('dd', {}, value),
  ]);
}

/** 금액이 실시간 조회값인지 추정치인지 한 단어로. */
function _priceKind(g) {
  const live = g.flightPriceSource === 'serpapi' || g.hotelPriceSource === 'serpapi';
  const allLive = g.flightPriceSource === 'serpapi' && g.hotelPriceSource === 'serpapi';
  return allLive ? '실시간 요금' : live ? '실시간·추정 섞임' : '추정 요금';
}

function _renderBudgetPanel(g) {
  const panel = $('#budgetPanel');
  if (!panel) return;
  const bd = _computeBudgetBreakdown(g);
  const budget = Number(g.budget) || 0;
  const diff = budget - bd.total;
  panel.hidden = false;
  panel.classList.toggle('is-over', diff < 0);

  const rows = $('#budgetPanelRows');
  rows.replaceChildren(
    _amountRow('입력 예산', budget, g),
    _amountRow('예상 총액', bd.total, g, 'money-row--total'),
    diff < 0
      ? _amountRow('예산 초과', -diff, g, 'money-row--over')
      : _amountRow('남는 금액', diff, g, 'money-row--under'),
  );

  const bp = g.budgetPlan;
  const plan = $('#budgetPanelPlan');
  if (plan) {
    plan.textContent = !bp ? ''
      : (bp.fits || diff >= 0)
        ? `예산에 맞춰 ${bp.hotelLabel ? bp.hotelLabel + '·' : ''}${bp.levelLabel} 지출 기준으로 골랐어요.`
        : `이 조건에서는 예산 안에 드는 조합이 없어 가장 저렴한 조합(${bp.hotelLabel || '숙소'}·아껴 쓰는 지출)으로 만들었어요.`;
  }

  // 대체 처리 안내 — 실시간 조회가 안 된 값, 예시 장소, 환율 기준
  const notes = [];
  const src = g.sources || { flight: g.flightPriceSource, hotel: g.hotelPriceSource };
  const est = [src.flight === 'estimate' && '항공', src.hotel === 'estimate' && '숙소'].filter(Boolean);
  if (est.length) {
    const why = src.liveConfigured && !src.liveConfigured.flights ? '실시간 요금 조회가 연결되지 않아' : '실시간 요금을 받지 못해';
    notes.push(`${est.join('·')} 비용은 추정치예요. ${why} 도시 물가와 시기로 계산했어요.`);
  }
  if (src.flight === 'serpapi' || src.hotel === 'serpapi') {
    const at = src.flightCheckedAt || src.hotelCheckedAt;
    notes.push(`실시간 요금은 Google 항공·호텔 검색 기준이에요${at ? ` (${new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회)` : ''}. 세금·수수료 포함 여부는 예약 사이트에서 확인해 주세요.`);
  }
  if (bd.unknown) notes.unshift(`비용을 모르는 장소 ${bd.unknown}곳은 합계에 넣지 않았어요. 일정 편집에서 금액을 넣으면 합계에 반영돼요.`);
  if (src.placesSample) notes.push(`장소 ${src.placesSample}곳은 검색 결과가 부족해 '예시 장소'로 채웠어요.`);
  if (g.fx) notes.push(`금액은 ${g.fx.date} ${g.fx.source} 환율로 원화를 환산했어요 (1원 = ${g.fx.rate} ${g.fx.currency}).`);
  else if (g.currency && g.currency !== 'KRW') notes.push('환율을 불러오지 못해 원화로 보여 드려요.');
  if (g.sources?.liveConfigured && !g.sources.liveConfigured.ai) notes.push('AI 요약은 아직 연결되지 않았어요. 이 일정은 장소 검색 결과로 만든 기본 일정이에요.');
  const ul = $('#budgetNotices');
  ul.replaceChildren(...notes.map(t => el('li', {}, t)));
  const why = $('#budgetWhyMeta');
  if (why) why.textContent = [g.people ? `${g.people}명 전체` : '', _priceKind(g), bd.unknown ? `비용 미확인 ${bd.unknown}곳 제외` : ''].filter(Boolean).join(' · ');

  // 예산 초과 시 대안 — 지금 일정의 실제 합계를 기준으로 다시 계산한다(예전에 저장한 일정도 같다).
  const alts = $('#budgetAlts');
  let list = [];
  try { list = diff < 0 ? budgetAlternativesFor(g, bd.total) : []; } catch (e) { console.warn('[budget] 대안 계산 실패', e); }
  if (diff < 0 && !list.length) {
    list = [{ key: 'raise', label: `예산 한도를 ${Math.ceil(bd.total / 10000)}만원으로 변경`, detail: '일정은 그대로 두고 입력한 예산만 바꿔요',
              total: bd.total, saving: 0, over: 0, fits: true, apply: { budget: Math.ceil(bd.total / 10000) }, isLimitChange: true }];
  }
  const plans = list.filter(a => !a.isLimitChange);
  const limit = list.find(a => a.isLimitChange);
  const altBtn = (alt) => el('button', {
    type: 'button',
    class: 'budget-alt' + (alt.fits ? ' is-fit' : '') + (alt.key === 'combo' ? ' is-combo' : '') + (alt.isLimitChange ? ' is-limit' : ''),
    onclick: () => _applyAlternative(alt),
  }, [
    el('span', { class: 'budget-alt-label' }, alt.label),
    el('span', { class: 'budget-alt-detail' }, alt.detail),
    alt.isLimitChange
      ? el('span', { class: 'budget-alt-total' }, `예상 총액 ${_shortMoney(alt.total, g)} · 일정 변경 없음`)
      : el('span', { class: 'budget-alt-total' }, [
          `예상 ${_shortMoney(alt.total, g)}`,
          alt.saving ? ` · ${_shortMoney(alt.saving, g)} 절감` : '',
          alt.fits ? ' · 예산 안' : ` · 아직 ${_shortMoney(alt.over, g)} 초과`,
        ].join('')),
  ]);
  // 조합을 못 찾았을 때 안내 — 가로로 넘기는 버튼 줄 밖(위)에 둔다.
  let none = document.getElementById('budgetAltsNone');
  if (!none) { none = el('p', { id: 'budgetAltsNone', class: 'budget-alts-none', role: 'status' }); alts.before(none); }
  const noneFits = plans.length && !plans.some(a => a.fits);
  none.hidden = !noneFits;
  none.textContent = noneFits ? '조건을 여러 개 바꿔도 이 예산 안에 드는 조합은 없어요. 아래 방법으로 초과액을 줄이거나 예산 한도를 바꿔 주세요.' : '';
  void altBtn;
  // 추천 대안 1개만 요약해 보여 주고, 나머지는 시트에서 비교한다(좁은 화면에서 가로로 잘리지 않게).
  const best = plans.find(a => a.fits) || plans[0] || limit;
  alts.hidden = !list.length;
  alts.replaceChildren(...(list.length ? [
    el('p', { class: 'budget-alts-title' }, best === limit ? '예산에 맞추는 방법' : '추천 대안'),
    _altCard(best, g),
    list.length > 1 ? el('button', { type: 'button', class: 'btn-text budget-alts-more', onclick: () => _openAltSheet(list, g, plans.length) }, `다른 대안 보기 (${list.length - 1})`) : null,
  ] : []));
}

/** 대안 하나 — 무엇이 바뀌는지, 새 총액, 절감액, 남은 초과액, ‘이 조합 적용’ */
function _altCard(alt, g, onPick) {
  const rows = alt.isLimitChange
    ? [['새 예산 한도', _shortMoney(alt.apply.budget * 10000, g)], ['예상 총액', _shortMoney(alt.total, g) + ' · 일정 그대로']]
    : [['새 총액', _shortMoney(alt.total, g)], ['절감액', alt.saving ? _shortMoney(alt.saving, g) : '—'],
       [alt.fits ? '예산' : '남은 초과액', alt.fits ? '✓ 예산 안' : _shortMoney(alt.over, g)]];
  return el('div', { class: 'alt-card' + (alt.fits ? ' is-fit' : '') }, [
    el('p', { class: 'alt-card-title' }, alt.label),
    alt.detail ? el('p', { class: 'alt-card-detail' }, alt.detail) : null,
    el('dl', { class: 'alt-card-rows' }, rows.map(([k, v]) => el('div', { class: 'alt-row' + (k === '남은 초과액' ? ' is-over' : '') }, [el('dt', {}, k), el('dd', {}, v)]))),
    el('button', { type: 'button', class: 'btn btn-primary btn-gradient alt-apply', onclick: () => { onPick?.(); _applyAlternative(alt); } },
      alt.isLimitChange ? '예산 한도 바꾸기' : '이 조합 적용'),
  ]);
}

function _openAltSheet(list, g, planCount) {
  let bd = document.getElementById('altBackdrop');
  let sh = document.getElementById('altSheet');
  if (!sh) {
    bd = el('div', { class: 'sheet-backdrop', id: 'altBackdrop', hidden: true });
    sh = el('aside', { class: 'bottom-sheet', id: 'altSheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'altSheetTitle', hidden: true }, [
      el('div', { class: 'sheet-handle' }),
      el('header', { class: 'sheet-head' }, [el('h2', { id: 'altSheetTitle' }, '예산 대안 비교'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => close() }, '×')]),
      el('div', { class: 'sheet-body' }),
    ]);
    document.body.append(bd, sh);
    bd.addEventListener('click', () => close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sh.hidden) close(); });
  }
  function close() {
    bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
    setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 220);
  }
  const plans = list.filter(a => !a.isLimitChange);
  const limit = list.find(a => a.isLimitChange);
  sh.querySelector('.sheet-body').replaceChildren(
    el('p', { class: 'alt-sheet-lead' }, '항공·숙소·활동 중 무엇이 바뀌는지와 새 총액을 비교해 고르세요. 적용하면 일정과 예산이 함께 바뀌고, 실패하면 지금 일정은 그대로예요.'),
    ...(planCount ? [el('h3', { class: 'alt-sheet-h' }, `일정을 바꾸는 방법 ${planCount}가지`), ...plans.map(a => _altCard(a, g, close))] : []),
    ...(limit ? [el('h3', { class: 'alt-sheet-h' }, '또는 예산 한도 변경'), _altCard(limit, g, close)] : []),
  );
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); sh.querySelector('.icon-btn')?.focus(); });
}

async function _applyAlternative(alt) {
  if (alt.isLimitChange || (alt.apply?.budget && Object.keys(alt.apply).length === 1)) {
    // 예산만 올리는 경우는 다시 만들 필요 없이 값만 바꾼다.
    appState.generated.budget = alt.apply.budget * 10000;
    if (appState.trip) appState.trip.budget = alt.apply.budget;
    if (appState.generated.budgetPlan) appState.generated.budgetPlan.alternatives = [];
    renderSchedule();
    showToast(`예산 한도를 ${alt.apply.budget}만원으로 바꿨어요 · 일정은 그대로예요`);
    return;
  }
  const g = appState.generated;
  let pins = 0, edited = 0;
  g?.days?.forEach(d => d.activities.forEach(a => { if (a.pinned) pins++; else if (a.edited) edited++; }));
  const msg = [`조건을 바꿔 일정을 다시 만들어요.`, `바뀌는 조건: ${alt.detail || alt.label}`,
    pins ? `고정한 장소 ${pins}곳은 그대로 둬요.` : '',
    edited ? `직접 편집한 장소 ${edited}곳은 바뀔 수 있어요. 남기려면 먼저 고정해 주세요.` : '',
    '다시 만들기에 실패하면 지금 일정을 그대로 둬요.'].filter(Boolean).join('\n');
  if (!confirm(msg)) return;
  const before = JSON.stringify(g);
  try {
    await applyBudgetAlternative(alt.apply);
  } catch (e) {
    console.warn('[budget] 대안 적용 실패', e);
  }
  const g2 = appState.generated;
  if (!g2 || JSON.stringify(g2) === before) { showToast('일정을 다시 만들지 못했어요. 지금 일정은 그대로예요'); return; }
  const total = _computeBudgetBreakdown(g2).total;
  const b = Number(g2.budget) || 0;
  showToast(total <= b ? `바꾼 조건으로 다시 만들었어요 · 예상 ${_shortMoney(total, g2)}, 예산 안이에요`
                       : `바꾼 조건으로 다시 만들었어요 · 예상 ${_shortMoney(total, g2)}, 아직 ${_shortMoney(total - b, g2)} 초과`, 4200);
}

function _renderCostSummary(g) {
  const bd = _computeBudgetBreakdown(g);
  const day = g.days[activeDay];
  const rows = $('#costRows');
  if (!rows) return;
  const list = [];
  if (bd.flight) list.push(_row('항공', _money(bd.flight, g), { note: g.people ? `왕복 ${g.people}명` : '왕복' }));
  const rooms = g.budgetPlan?.rooms || 1;
  if (bd.hotel) list.push(_row('숙소', _money(bd.hotel, g), {
    note: rooms > 1
      ? `객실 ${rooms}개 합계 1박 ${_money(bd.hotelPerNight, g)} × ${bd.nights}박`
      : `1박 ${_money(bd.hotelPerNight, g)} × ${bd.nights}박`,
  }));
  list.push(_row('식비', _money(bd.food, g)));
  list.push(_row('입장·체험', _money(bd.entry, g)));
  if (bd.shopping) list.push(_row('쇼핑', _money(bd.shopping, g)));
  if (bd.transport) list.push(_row('현지 교통', _money(bd.transport, g)));
  list.push(_row('전체 합계', _money(bd.total, g), { cls: 'money-row--total' }));
  if (day) list.push(_row(`${activeDay + 1}일차 합계`, _money(_dayTotal(day, activeDay), g)));
  rows.replaceChildren(...list);
  const note = $('#costNote');
  if (note) note.textContent = '금액은 모두 추정치이고 원 단위에서 반올림했어요. 실제 요금은 예약할 때 확인해 주세요.';
}

/** 짧은 금액 라벨: 428,000원 → '42만 8천 원', 1,200,000원 → '120만 원', 5,000원 → '5천 원'.
 *  다른 통화로 보는 중이면 그 통화의 짧은 표기. */
function _shortMoney(amount, g) {
  const n = Number(amount) || 0;
  if (g?.fx?.rate) {
    try {
      return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: g.fx.currency, notation: 'compact', maximumFractionDigits: n * g.fx.rate >= 1000 ? 1 : 0 }).format(n * g.fx.rate);
    } catch (_) { /* 아래 원화 표시로 */ }
  }
  if (n >= 10000) {
    let man = Math.floor(n / 10000);
    let cheon = Math.round((n % 10000) / 1000);
    if (cheon === 10) { man += 1; cheon = 0; }
    return `${man.toLocaleString('ko-KR')}만${cheon ? ` ${cheon}천` : ''} 원`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}천 원`;
  return n > 0 ? `${Math.round(n).toLocaleString('ko-KR')}원` : '0원';
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

/** 같은 도시의 같은 종류 장소를 추천한다.  이미 일정에 있는 곳은 뺀다. */
async function _suggestAlternatives() {
  const g = appState.generated;
  if (!editing || !g) return;
  const current = g.days[editing.di]?.activities[editing.ai];
  const query = _SWAP_QUERY[current?.category] || '인기 명소';
  const used = new Set(g.days.flatMap(d => d.activities.map(a => a.name)));
  const seq = ++_editSearchSeq;
  const sugg = $('#editSuggestions');
  if (sugg) { sugg.hidden = false; sugg.innerHTML = '<div class="ps-loading">추천 장소를 찾는 중…</div>'; }
  try {
    const res = await api.searchPlaces({ query: `${g.city} ${query}`, language: 'ko', max_results: 12 });
    if (seq !== _editSearchSeq) return;
    _renderEditSuggestions((res?.places || []).filter(p =>
      Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !used.has(p.name)));
  } catch (err) {
    if (seq !== _editSearchSeq) return;
    console.warn('[edit] alternatives failed:', err?.message);
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
  $('#editCost').value = _costUnknown(a) ? '' : (_actCost(di, ai, a.cost) || 0);
  $('#editMemo').value = a.memo || '';
  _fillDaySelect(di, a.category !== '이동');
  $('#editSuggestions') && ($('#editSuggestions').hidden = true);
  $('#editPlaceHint')   && ($('#editPlaceHint').hidden = true);
  $('#editSheetTitle')  && ($('#editSheetTitle').textContent = '장소 편집');
  $('#editDelete')      && ($('#editDelete').textContent = '삭제');
  $('#editSwap')        && ($('#editSwap').hidden = a.category === '이동' || a.category === '숙박');
  $('#editBackdrop').hidden = false;
  $('#editSheet').hidden = false;
  _bindEditSearch();
  requestAnimationFrame(() => {
    $('#editBackdrop').classList.add('is-visible');
    $('#editSheet').classList.add('is-visible');
  });
}

function _fillDaySelect(di, enabled) {
  const sel = $('#editDay');
  const row = $('#editDayRow');
  if (!sel) return;
  const g = appState.generated;
  sel.replaceChildren(...g.days.map((d, i) => el('option', { value: String(i) }, `${i + 1}일차 · ${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`)));
  sel.value = String(di);
  if (row) row.hidden = !enabled || g.days.length < 2;
}

/** 시간 순서를 지키며 끼워 넣는다(같은 시간이면 뒤에). */
function _insertByTime(acts, a) {
  const t = _timeToMin(a.time);
  let idx = acts.findIndex(x => _timeToMin(x.time) > t);
  if (idx < 0) idx = acts.length;
  acts.splice(idx, 0, a);
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
  const costRaw = String($('#editCost').value ?? '').trim();
  const cost = costRaw === '' ? null : Math.max(0, Math.round(Number(costRaw) || 0));   // 빈칸 = 비용 미확인, 0 = 무료
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
    newActivity.edited = true;
    _insertByTime(appState.generated.days[di].activities, newActivity);
    _closeEdit();
    renderSchedule();
    showToast('장소가 추가되었어요');
  } else {
    const { di, ai } = editing;
    const a = appState.generated.days[di].activities[ai];
    const changed = a.name !== name || a.time !== time || (a.cost ?? null) !== cost;
    a.name = name;
    a.time = time;
    a.cost = cost;
    a.memo = memo;
    if (changed) a.edited = true;
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
    // 다른 날짜로 옮기기
    const toDay = Number($('#editDay')?.value);
    if (Number.isInteger(toDay) && toDay !== di && appState.generated.days[toDay]) {
      appState.generated.days[di].activities.splice(ai, 1);
      _insertByTime(appState.generated.days[toDay].activities, a);
      _closeEdit();
      activeDay = toDay;
      renderSchedule();
      showToast(`${toDay + 1}일차로 옮겼어요`);
      return;
    }
    // 시간을 바꾸면 시간 순서대로 다시 놓는다.
    const acts = appState.generated.days[di].activities;
    acts.splice(ai, 1); _insertByTime(acts, a);
    _closeEdit();
    renderSchedule();
    showToast('수정했어요');
  }
}

function _deleteEdit() {
  if (!editing) return;
  if (editing.isNew) { _closeEdit(); return; }   // 추가 모드: 취소만 함
  const { di, ai } = editing;
  if (!confirm('이 장소를 삭제할까요?')) return;
  appState.generated.days[di].activities.splice(ai, 1);
  _closeEdit();
  renderSchedule();
  showToast('삭제되었어요');
}

function _addPlace() {
  editing = { di: activeDay, isNew: true };
  _editPickedPlace = null;
  $('#editName').value = '';
  $('#editTime').value = '12:00';
  $('#editCost').value = '';
  $('#editMemo').value = '';
  _fillDaySelect(activeDay, false);
  $('#editSwap') && ($('#editSwap').hidden = true);
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
/** 점검과 '시간 다시 맞추기'가 같은 기준을 쓰도록 — 숙소는 짐 맡기기·출발 준비 15분. */
function _stayMinutes(a) { return a?.category === '숙박' ? 15 : _dwellMinutes(a?.category); }

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
 * 하루 시간표 다시 계산.
 *  - 항공 도착은 맨 앞, 출국은 맨 뒤에 두고 시간은 바꾸지 않는다(기준점).
 *  - 착륙 뒤 숙소는 60분, 다른 장소는 90분 뒤부터.
 *  - 다음 장소 = 앞 장소 시작 + 체류(숙소 15분) + 이동 시간, 5분 단위 올림.
 *  - keepLater: 이미 더 늦게 잡힌 일정은 당기지 않는다(점검의 '시간 다시 맞추기').
 */
function _recomputeDayTimes(day, { keepLater = false } = {}) {
  if (!day?.activities?.length) return;
  const arr = day.activities;
  const isArr = (a) => _isFlight(a) && /도착/.test(a.name || '');
  const isDep = (a) => _isFlight(a) && /출발/.test(a.name || '');
  const ai = arr.findIndex(isArr);
  if (ai > 0) arr.unshift(arr.splice(ai, 1)[0]);
  const di = arr.findIndex(isDep);
  if (di >= 0 && di < arr.length - 1) arr.push(arr.splice(di, 1)[0]);
  const up5 = (m) => Math.ceil(m / 5) * 5;
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (_isFlight(a)) { prev = a; continue; }
    const own = _timeToMin(a.time);
    let need;
    if (!prev) need = own;
    else if (isArr(prev)) need = _flightArrMin(prev) + (a.category === '숙박' ? _ARRIVE_TO_HOTEL : _ARRIVE_TO_CITY);
    else need = _timeToMin(prev.time) + _stayMinutes(prev) + _travelMinutes(prev, a);
    const t = up5(keepLater ? Math.max(own, need) : (prev ? need : own));
    // 시각은 하루 안(00:00~23:59)으로만 적는다 — 넘어가면 표시해 두고 점검에서 알린다.
    if (t >= 24 * 60) a.pastMidnight = true; else delete a.pastMidnight;
    a.time = _minToTime(t);
    prev = a;
  }
}

/* ============ Drag & Drop ============ */
let dragSrc = null;

function _clearDropMarks() {
  $$('.schedule-card.drop-before, .schedule-card.drop-after')
    .forEach(c => c.classList.remove('drop-before', 'drop-after'));
}

// 끌어온 카드를 대상 카드의 위/아래(after) 위치로 이동.
// splice 로 src 를 빼면 뒤 인덱스가 한 칸 당겨지므로 보정한다.
function _moveActivity(srcAi, dstAi, after) {
  if (!Number.isInteger(srcAi) || !Number.isInteger(dstAi)) return;
  const day = appState.generated.days[activeDay];
  const acts = day.activities;
  let insertIdx = after ? dstAi + 1 : dstAi;
  if (srcAi < insertIdx) insertIdx -= 1;                     // 제거로 인한 인덱스 보정
  insertIdx = Math.max(0, Math.min(insertIdx, acts.length - 1));
  if (insertIdx === srcAi) return;                           // 제자리 → 변화 없음
  const movedAct = acts[srcAi];
  const movedKey = movedAct ? (movedAct.placeId || movedAct.id || (movedAct.name || '').trim()) : '';
  const oldTops = _captureCardRects();                       // 재정렬 전 위치 기록 (FLIP)
  const [moved] = acts.splice(srcAi, 1);
  acts.splice(insertIdx, 0, moved);
  moved.edited = true;
  _recomputeDayTimes(day);
  focusedAi = insertIdx;
  renderSchedule();
  _flipReorder(oldTops, String(movedKey));                   // 새 위치로 부드럽게 미끄러짐
  showToast(`${insertIdx + 1}번째로 옮기고 시간을 다시 계산했어요`);
}

// ── FLIP 애니메이션: 재정렬 후 카드들이 옛 위치→새 위치로 부드럽게 이동 ──
function _cardKey(card) {
  return card.dataset.placeId || (card.querySelector('.schedule-place-name')?.textContent || '').trim();
}
function _captureCardRects() {
  const m = new Map();
  $$('#scheduleTimeline .schedule-card').forEach(c => m.set(_cardKey(c), c.getBoundingClientRect().top));
  return m;
}
function _flipReorder(oldTops, movedKey) {
  const cards = $$('#scheduleTimeline .schedule-card');
  // 1) 새 레이아웃에서 각 카드를 '옛 위치'로 즉시 되돌려 놓기 (transition 없이)
  cards.forEach(c => {
    const oldTop = oldTops.get(_cardKey(c));
    if (oldTop == null) return;
    const dy = oldTop - c.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) { c.style.transition = 'none'; c.style.transform = `translateY(${dy}px)`; }
  });
  // 2) 다음 프레임에 0 으로 애니메이션 → 새 위치로 미끄러짐
  requestAnimationFrame(() => {
    cards.forEach(c => {
      c.style.transition = 'transform .2s ease';
      c.style.transform = '';
    });
    const moved = cards.find(c => _cardKey(c) === movedKey);
    if (moved) {
      moved.classList.add('just-moved');               // 옮긴 카드 살짝 강조
      setTimeout(() => moved.classList.remove('just-moved'), 520);
    }
    setTimeout(() => cards.forEach(c => { c.style.transition = ''; c.style.transform = ''; }), 240);
  });
}

// 대상 카드 위에서 커서/손가락 Y 위치로 "위(before)냐 아래(after)냐" 판정 + 라인 표시
function _markDrop(target, clientY) {
  _clearDropMarks();
  const r = target.getBoundingClientRect();
  const after = (clientY - r.top) > r.height / 2;
  target.classList.toggle('drop-after', after);
  target.classList.toggle('drop-before', !after);
  return after;
}

// 드래그 중 카드 아래의 "대상 카드"를 elementFromPoint 로 찾는다.
// (끌고 있는 카드는 잠깐 pointer-events 를 꺼서 그 밑 카드가 잡히게)
function _cardUnder(card, x, y) {
  const prev = card.style.pointerEvents;
  card.style.pointerEvents = 'none';
  const over = document.elementFromPoint(x, y)?.closest('.schedule-card');
  card.style.pointerEvents = prev;
  return (over && over !== card) ? over : null;
}

function _bindDnd(card) {
  if (card.dataset.movable !== '1') return;   // 이동 가능한 카드만 드래그 소스

  let startY = 0, dragging = false, pressTimer = null;

  const begin = () => { dragging = true; card.classList.add('is-dragging'); };  // → CSS scale(.96)
  const moveTo = (x, y) => {
    card.style.transition = 'none';
    card.style.transform = `translateY(${y - startY}px) scale(.94)`;
    const over = _cardUnder(card, x, y);
    if (over) _markDrop(over, y); else _clearDropMarks();
  };
  const finish = (x, y) => {
    dragging = false;
    card.style.transition = '';                 // 원래 크기로 부드럽게 복귀
    card.style.transform = '';
    card.classList.remove('is-dragging');
    const over = _cardUnder(card, x, y);
    _clearDropMarks();
    if (over) {
      const r = over.getBoundingClientRect();
      const after = (y - r.top) > r.height / 2;
      _moveActivity(Number(card.dataset.ai), Number(over.dataset.ai), after);
    }
  };

  // ── 마우스(데스크탑): 카드 아무 곳이나 눌러 4px 이상 움직이면 시작 ──
  card.addEventListener('mousedown', (e) => {
    if (!editMode || e.button !== 0) return;
    if (e.target.closest('.map-button, .edit-button')) return;   // 버튼은 클릭 유지
    startY = e.clientY;
    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 4) return;
        begin();
      }
      ev.preventDefault();
      moveTo(ev.clientX, ev.clientY);
    };
    const onUp = (ev) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragging) finish(ev.clientX, ev.clientY);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ── 터치(모바일): 길게 눌러 시작, 빠르게 움직이면 스크롤 ──
  card.addEventListener('touchstart', (e) => {
    if (!editMode) return;
    startY = e.touches[0].clientY;
    pressTimer = setTimeout(begin, 200);
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (!dragging) {
      if (Math.abs(e.touches[0].clientY - startY) > 8) clearTimeout(pressTimer);  // 스크롤로 간주
      return;
    }
    e.preventDefault();
    moveTo(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  const endTouch = (e) => {
    clearTimeout(pressTimer);
    if (!dragging) return;
    const pt = e.changedTouches && e.changedTouches[0];
    finish(pt ? pt.clientX : 0, pt ? pt.clientY : startY);
  };
  card.addEventListener('touchend', endTouch);
  card.addEventListener('touchcancel', endTouch);
}

/* ============ Google Maps deep link ============ */
function _openMap(a) {
  const q = a.googleMapsQuery || `${a.name} ${appState.generated?.city || ''}`;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ============ 저장 ============
 * 일정은 이 기기(브라우저)에 늘 자동 저장된다.  로그인하면 계정(/schedules)에도 저장하고,
 * 저장한 뒤 고친 내용은 몇 초 뒤 계정에도 반영한다.  다시 보는 곳: 마이 > 저장한 일정. */
let saveState = 'idle';      // idle | saving | saved | error
let syncTimer = null;
let lastSyncedJson = '';

function _scheduleTitle(g) {
  return g.title || `${g.originName ? g.originName + ' → ' : ''}${g.city} ${g.days.length <= 1 ? '당일치기' : `${g.days.length - 1}박 ${g.days.length}일`}`;
}
function _payload(g) {
  const { savedScheduleId, ...data } = g;   // 저장 번호는 기기에만 둔다
  return data;
}

function _paintSaveStatus() {
  const g = appState?.generated;
  const box = $('#saveStatus');
  const btn = $('#btnSave');
  if (!box) return;
  if (!g) { box.hidden = true; return; }
  box.hidden = false;
  const onAccount = !!g.savedScheduleId;
  btn?.classList.toggle('is-active', onAccount);
  btn?.setAttribute('aria-pressed', String(onAccount));
  const lbl = btn?.querySelector('.ab-label'); if (lbl) lbl.textContent = onAccount ? '저장됨' : '저장';
  let text, cls = '';
  if (saveState === 'saving') text = '계정에 저장하는 중…';
  else if (saveState === 'error') { text = '계정 저장에 실패했어요. 이 기기에는 저장돼 있어요.'; cls = 'is-error'; }
  else if (onAccount) text = '계정에 저장됨 · 마이 › 저장한 일정';
  else text = appState.currentUser ? '이 기기에만 저장됨 · ‘저장’으로 계정에 보관' : '이 기기에만 저장됨 · 로그인하면 계정에 보관';
  box.className = 'save-status ' + cls;
  box.replaceChildren(...[el('span', {}, text),
    saveState === 'error' ? el('button', { type: 'button', class: 'btn-text', onclick: _saveToAccount }, '다시 시도') : null].filter(Boolean));
}

async function _toggleSave() {
  const g = appState.generated;
  if (!g) { showToast('저장할 일정이 없어요'); return; }
  if (!appState.currentUser) { _openSaveChoice(); return; }
  if (g.savedScheduleId) {
    if (!confirm('계정에 저장한 이 일정을 저장 목록에서 뺄까요?\n이 기기에서는 그대로 볼 수 있고, 다시 저장하면 되살아나요.')) return;
    try {
      await api.unsaveSchedule(g.savedScheduleId);
      g.savedScheduleId = null;
      saveState = 'idle';
      _paintSaveStatus(); _persist();
      showToast('저장 목록에서 뺐어요');
    } catch (e) {
      showToast('저장 해제에 실패했어요. 잠시 뒤 다시 시도해 주세요');
    }
    return;
  }
  await _saveToAccount();
}

async function _saveToAccount() {
  const g = appState.generated;
  if (!g || !appState.currentUser) return;
  saveState = 'saving'; _paintSaveStatus();
  try {
    const data = _payload(g);
    if (g.savedScheduleId) {
      await api.updateSchedule(g.savedScheduleId, { title: _scheduleTitle(g), schedule_data: data, is_saved: true });
    } else {
      const res = await api.createSchedule({ title: _scheduleTitle(g), schedule_data: data, is_saved: true });
      g.savedScheduleId = res?.id;
      trackEvent('trip_saved');
      showToast('계정에 저장했어요 · 마이 › 저장한 일정에서 볼 수 있어요', 3000);
    }
    lastSyncedJson = JSON.stringify(data);
    saveState = 'saved';
  } catch (e) {
    console.warn('[schedule] 계정 저장 실패', e?.status, e?.message);
    if (e?.status === 404 && g.savedScheduleId) { g.savedScheduleId = null; return _saveToAccount(); }
    saveState = 'error';
    trackEvent('trip_save_fail');
    showToast(e?.status === 401 ? '로그인이 만료됐어요. 다시 로그인해 주세요' : '계정 저장에 실패했어요');
  }
  _paintSaveStatus(); _persist();
}

/** 계정에 저장한 일정이 바뀌면 3초 뒤 계정에도 반영한다. */
function _queueSync() {
  const g = appState?.generated;
  if (!g?.savedScheduleId || !appState.currentUser) return;
  if (JSON.stringify(_payload(g)) === lastSyncedJson) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(_saveToAccount, 3000);
}

/* ============ 비회원 저장 — 저장 방법 안내 + 로그인 뒤 이어서 저장 ============ */
function _openSaveChoice() {
  const bd = $('#saveChoiceBackdrop'), sh = $('#saveChoiceSheet');
  if (!bd || !sh) return;
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); $('#saveChoiceLogin')?.focus(); });
}
function _closeSaveChoice() {
  const bd = $('#saveChoiceBackdrop'), sh = $('#saveChoiceSheet');
  if (!bd || !sh) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 250);
}
function _initSaveChoice() {
  $('#saveChoiceClose')?.addEventListener('click', _closeSaveChoice);
  $('#saveChoiceBackdrop')?.addEventListener('click', _closeSaveChoice);
  $('#saveChoiceLocal')?.addEventListener('click', () => {
    _closeSaveChoice();
    showToast('이 기기에 저장돼 있어요 · 같은 브라우저에서 언제든 다시 열 수 있어요', 3000);
  });
  $('#saveChoiceLogin')?.addEventListener('click', () => {
    const g = appState.generated;
    setPendingIntent({ action: 'save-trip', tripKey: g?.createdAt || null });
    _closeSaveChoice();
    navigate('auth', { meta: { return: 'schedule' } });
  });
  // 로그인을 마치면(이메일·소셜 모두) 하려던 저장을 이어서 한다.
  document.addEventListener('redesign:auth-ready', () => {
    const intent = peekPendingIntent();
    if (!intent || intent.action !== 'save-trip' || !appState.currentUser) return;
    clearPendingIntent();
    const g = appState.generated;
    if (!g || (intent.tripKey && g.createdAt && intent.tripKey !== g.createdAt)) {
      showToast('로그인했어요. 저장하려던 일정을 찾지 못했어요');
      return;
    }
    navigate('schedule', { replace: true });
    if (g.savedScheduleId) { showToast('로그인했어요 · 이 일정은 이미 계정에 저장돼 있어요'); return; }
    _saveToAccount();
  });
}

function _persist() {
  document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
}

/* ============ 공유 ============
 * 보기 전용: 일정 내용을 링크에 담는다(서버에 남지 않음, 회수 불가 → 담을 항목을 고른다).
 * 편집 가능: 서버에 공유 일정을 만들고 링크를 아는 사람이 함께 고친다(회수 가능). */
function _shareData(g, opts) {
  const copy = JSON.parse(JSON.stringify(_payload(g)));
  delete copy.aiSummary;
  copy.days.forEach(d => d.activities.forEach(a => {
    delete a.visited; delete a.pinned;
    if (!opts.memo) delete a.memo;
    if (!opts.cost) { delete a.cost; if (a.flightMeta) { delete a.flightMeta.roundTripKRW; delete a.flightMeta.oneWayKRW; } }
  }));
  if (!opts.cost) {
    delete copy.budget; delete copy.budgetPlan;
    copy.days.forEach(d => { delete d.localTransport; });
    copy.hideCost = true;
  }
  copy.sharedView = true;
  return copy;
}
function _shareLink(data) {
  try { return publicLink(`#page=schedule&trip=${_b64urlEnc(JSON.stringify(data))}`); }
  catch (_) { return publicLink(''); }
}

function _openShareSheet() {
  const g = appState.generated;
  if (!g) { showToast('공유할 일정이 없어요'); return; }
  const sheet = $('#shareSheet');
  const opts = { memo: false, cost: false };
  const hasMemo = g.days.some(d => d.activities.some(a => a.memo));
  const preview = el('ul', { class: 'share-preview' });
  const paint = () => {
    preview.replaceChildren(
      el('li', {}, `여행 제목·도시·날짜 (${_scheduleTitle(g)})`),
      el('li', {}, `날짜별 장소·시간 ${g.days.reduce((s, d) => s + d.activities.length, 0)}곳`),
      el('li', { class: opts.cost ? '' : 'is-off' }, opts.cost ? '예상 비용·예산' : '예상 비용·예산 — 빼고 공유'),
      el('li', { class: opts.memo ? '' : 'is-off' }, hasMemo ? (opts.memo ? '내가 쓴 메모' : '내가 쓴 메모 — 빼고 공유') : '메모 없음'),
      el('li', { class: 'is-off' }, '경비 기록·준비물·계정 정보 — 공유하지 않아요'),
    );
  };
  const chk = (key, label) => el('label', { class: 'check-row' }, [
    el('input', { type: 'checkbox', onchange: (e) => { opts[key] = e.target.checked; paint(); } }),
    el('span', {}, label),
  ]);
  paint();
  const doShare = async () => {
    const link = _shareLink(_shareData(g, opts));
    trackEvent('trip_shared');
    const title = `${_scheduleTitle(g)} · 3초 여행`;
    if (await shareLink({ title, url: link })) { _closeSheet(); return; }
    try { await navigator.clipboard.writeText(link); showToast('보기 전용 링크를 복사했어요'); _closeSheet(); }
    catch (_) { trackEvent('trip_share_fail'); window.prompt('이 링크를 복사해 공유하세요', link); }
  };
  sheet.querySelector('.sheet-body').replaceChildren(
    el('section', { class: 'share-sec', 'aria-labelledby': 'shareViewH' }, [
      el('h3', { id: 'shareViewH' }, '보기 전용 링크'),
      el('p', { class: 'tool-note' }, '받는 사람은 일정을 볼 수만 있어요. 링크 안에 일정이 담겨 있어 한 번 보내면 회수할 수 없으니, 담을 항목을 골라 주세요.'),
      chk('cost', '예상 비용·예산 포함'),
      hasMemo ? chk('memo', '내가 쓴 메모 포함') : null,
      el('p', { class: 'share-preview-h' }, '공유되는 항목'),
      preview,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: doShare }, '보기 전용 링크 공유'),
    ]),
    el('section', { class: 'share-sec', 'aria-labelledby': 'shareEditH' }, [
      el('h3', { id: 'shareEditH' }, '편집 가능 링크'),
      el('p', { class: 'tool-note' }, '링크를 아는 사람은 누구나 일정·메모·비용을 함께 고칠 수 있어요. 언제든 링크를 회수할 수 있어요.'),
      el('button', { type: 'button', class: 'btn btn-soft btn-block', onclick: () => { _closeSheet(); document.dispatchEvent(new CustomEvent('redesign:collab-open')); } }, '편집 링크 관리'),
    ]),
  );
  $('#shareBackdrop').hidden = false; sheet.hidden = false;
  requestAnimationFrame(() => { $('#shareBackdrop').classList.add('is-visible'); sheet.classList.add('is-visible'); sheet.querySelector('h2')?.focus(); });
  shareReturnFocus = document.activeElement;
}
let shareReturnFocus = null;
function _closeSheet() {
  const sheet = $('#shareSheet');
  $('#shareBackdrop')?.classList.remove('is-visible'); sheet?.classList.remove('is-visible');
  setTimeout(() => { if ($('#shareBackdrop')) $('#shareBackdrop').hidden = true; if (sheet) sheet.hidden = true; }, 220);
  $('#btnShare')?.focus();
}

/* ============ AI 코스 요약 (OpenAI 프록시) ============ */
function _aiPrompt(g) {
  const days = g.days.map((d, i) => {
    const ps = (d.activities || [])
      .filter(a => a.category !== '이동' && a.category !== '숙박')
      .map(a => a.name);
    return `${i + 1}일차: ${ps.join(', ')}`;
  }).join('\n');
  return `다음은 ${g.city} ${g.days.length}일 ${g.concept || ''} 여행 일정입니다. `
    + `여행자에게 보여줄 친근한 한국어 요약을 2~3문장으로, 이 코스의 매력과 하루 흐름을 강조해 써주세요. `
    + `마지막 줄에 짧은 팁 하나를 "💡 "로 시작해 덧붙여 주세요.\n\n${days}`;
}

// AI 요약 상태(생성건별) — g에 저장하지 않아 영속화/리로드 시 자동 재시도되게 한다.
let _aiKey = null, _aiLoading = false, _aiFailed = false;

// AI 요약 — 일정과 독립적으로 실패한다(실패해도 보기·날짜 이동·편집·저장은 그대로).
let _aiReason = '';           // unconfigured | timeout | offline | error
let _aiOn = null;             // 서버 /api/features 의 현재 값(저장된 일정의 값보다 우선)
api.features().then(f => { _aiOn = !!f.ai; if (appState?.generated) renderSchedule(); }).catch(() => {});

async function _genAiSummary() {
  const g = appState.generated;
  if (!g || _aiOn === false) return;
  _aiKey = g.createdAt; _aiLoading = true; _aiFailed = false; _aiReason = '';
  renderSchedule();                       // 로딩 상태 표시
  try {
    const res = await Promise.race([
      api.openaiChat(_aiPrompt(g)),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('TIMEOUT'), { timeout: true })), 30000)),
    ]);
    const text = (res && (res.output_text || res.text) || '').trim();
    _aiLoading = false;
    if (text && appState.generated?.createdAt === g.createdAt) { g.aiSummary = text; _emitScheduleChanged(); }
    else if (!text) { _aiFailed = true; _aiReason = 'error'; }
  } catch (e) {
    console.warn('[ai] 요약 실패:', e?.status || e?.message);
    _aiLoading = false; _aiFailed = true;
    _aiReason = e?.status === 503 ? 'unconfigured' : e?.timeout ? 'timeout'
      : (e?.message === 'NETWORK_ERROR' && navigator.onLine === false) ? 'offline' : 'error';
    if (_aiReason === 'unconfigured') _aiOn = false;
    trackEvent('ai_summary_fail');
  }
  renderSchedule();
}

function _renderAiSummary(g) {
  const tl = $('#scheduleTimeline');
  if (!tl || !tl.parentNode) return;
  document.getElementById('aiSummaryCard')?.remove();
  // AI 요약이 서버에 연결돼 있지 않으면 카드를 만들지 않는다(안내는 예산 영역에 표시).
  if (_aiOn === false && !g.aiSummary) return;
  if (_aiOn === null && g.sources?.liveConfigured && !g.sources.liveConfigured.ai && !g.aiSummary) return;
  if (g.sharedView && !g.aiSummary) return;
  if (_aiKey !== g.createdAt) { _aiKey = g.createdAt; _aiLoading = false; _aiFailed = false; _aiReason = ''; }
  const card = el('section', { id: 'aiSummaryCard', class: 'ai-card', 'aria-label': 'AI 코스 요약' });
  card.appendChild(el('p', { class: 'ai-card-title' }, '✨ AI 코스 요약'));
  if (g.aiSummary) {
    card.appendChild(el('p', { class: 'ai-card-text' }, g.aiSummary));
    if (_aiOn !== false) card.appendChild(el('button', { type: 'button', class: 'btn-text ai-card-redo', onclick: () => { delete g.aiSummary; _genAiSummary(); } }, '↻ 다시 요약'));
  } else if (_aiLoading) {
    card.appendChild(el('p', { class: 'ai-card-note', role: 'status' }, 'AI가 코스를 요약하는 중… 일정은 지금 바로 보고 고칠 수 있어요.'));
  } else if (_aiFailed) {
    const why = { timeout: '응답이 30초 넘게 없어 멈췄어요.', offline: '인터넷에 연결되어 있지 않아요.',
                  unconfigured: '지금은 AI 요약을 쓸 수 없어요.', error: 'AI 서비스가 잠시 응답하지 않았어요.' }[_aiReason] || 'AI 요약을 만들지 못했어요.';
    card.appendChild(el('p', { class: 'ai-card-note', role: 'status' }, `${why} 일정 보기·편집·저장은 그대로 할 수 있어요.`));
    if (_aiReason !== 'unconfigured') card.appendChild(el('button', { type: 'button', class: 'btn btn-soft ai-card-retry', onclick: _genAiSummary }, '다시 시도'));
  } else if (_aiOn === true) {
    // 서버에 AI 가 켜져 있을 때만 자동 1회 생성
    _aiLoading = true;
    card.appendChild(el('p', { class: 'ai-card-note', role: 'status' }, 'AI가 코스를 요약하는 중… 일정은 지금 바로 보고 고칠 수 있어요.'));
    setTimeout(_genAiSummary, 0);
  } else {
    return;   // 서버 상태를 아직 모르면 카드를 띄우지 않는다
  }
  tl.parentNode.insertBefore(card, tl);
}

/* ── 공유: 일정을 URL에 담는 자체 링크 + 일자별 텍스트 요약 ── */
function _b64urlEnc(str) {
  let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDec(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
/** 공유 링크(#page=schedule&trip=…)로 진입한 경우, URL에서 일정을 복원해 state에 주입.
 *  부트스트랩에서 restoreAppState 직후·최초 렌더 전에 호출한다. */
export function importSharedTripFromURL(state) {
  try {
    const enc = new URLSearchParams((location.hash || '').replace(/^#/, '')).get('trip');
    if (!enc) return false;
    const g = JSON.parse(_b64urlDec(enc));
    if (!g || !Array.isArray(g.days)) return false;
    delete g.savedScheduleId;
    g.sharedView = true;
    state.generated = g;
    state.expenses = {};
    state.trip = Object.assign({}, state.trip, {
      cityName: g.city, country: g.country, days: g.days.length,
      concept: g.concept, currency: g.currency, budget: Math.round((g.budget || 0) / 10000),
    });
    // 거대한 trip 파라미터를 URL에서 제거(페이지는 schedule 유지)
    try { history.replaceState(null, '', location.pathname + '#page=schedule'); } catch (_) {}
    try { showToast('공유된 일정을 불러왔어요'); } catch (_) {}
    return true;
  } catch (e) { console.warn('[share] 공유 일정 복원 실패:', e); return false; }
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
