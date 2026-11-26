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
import { checkDay, repairTrip, repairDay, recomputeDay, isFlight, josa as _josa, shortName as _short,
  timeToMin as _timeToMin, kmBetween as _kmBetween, travelMinutes as _travelMinutes, airportMinutes, beforeFlightText } from './redesign-plan-check.js';
import { RIDE, rideMode, rideOf } from './redesign-ground.js';
import { localQuery, rankLocal, localMix, langOf, LANG_NAME } from './redesign-local.js';
import { findCity } from './redesign-cities.js';
import { costBreakdown as _computeBudgetBreakdown, costUnknown as _costUnknown, costScope, costDuplicates } from './redesign-plan-cost.js';
import { publicLink, shareLink } from './redesign-native.js';
import { setPendingIntent, peekPendingIntent, clearPendingIntent } from './redesign-auth.js';
import { api, trackEvent } from './redesign-api-adapter.js';
import {
  el, $, $$, formatCurrency, showToast,
  getSchedulePlaceName, normalizeScheduleItem,
} from './redesign-ui.js';
import { regenerateSchedule, applyBudgetAlternative, budgetAlternativesFor, retryProvider } from './redesign-trip-flow.js';
import { askConfirm, showCopy } from './redesign-dialog.js';

let appState = null;
let activeDay = 0;
let _dayKey = null;        // 지금 보고 있는 여행 — 다른 여행을 열면 날짜를 다시 정한다
let _dayManual = false;    // 사용자가 날짜를 직접 골랐는지
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
    const msg = `일정을 새로 만들까요?\n같은 조건(도시·날짜·예산·스타일)으로 ${g0?.days.length || ''}일 일정을 새로 만들어요.`
      + (pinned ? `\n📌 고정한 장소 ${pinned}곳은 같은 날짜·시간에 그대로 남겨요.` : '\n남기고 싶은 장소는 먼저 ‘고정’을 눌러 두세요.')
      + (edited ? `\n고정하지 않고 직접 고치거나 메모를 단 장소 ${edited}곳은 새 장소로 바뀌어요.` : '')
      + '\n\n장소 하나만 바꾸려면 취소하고 그 장소의 [편집 › 비슷한 곳 추천]을 써 보세요.';
    if (!await askConfirm(msg, { ok: '새로 만들기' })) return;
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

const _tripKey = (g) => [g?.city, g?.days?.[0]?.date, g?.days?.length].join('|');
/** 여행지 현지 날짜로 오늘이 몇 일차인지. 여행 기간이 아니면 -1. */
function _todayIndex(g) {
  const iso = nowIn(_tripTz(g))?.iso;
  return (g?.days || []).findIndex(d => d?.date === iso);
}
/** 보여 줄 날짜 — 여행 중이면 오늘, 사용자가 고른 날짜가 있으면 그 날짜(이 탭에서만 기억). */
function _resolveDay(g) {
  const key = _tripKey(g);
  if (key !== _dayKey) {
    _dayKey = key; _dayManual = false; activeDay = 0; focusedAi = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem('tst_active_day') || 'null');
      if (saved?.key === key && saved.manual && saved.day < g.days.length) { activeDay = saved.day; _dayManual = true; }
    } catch (_) {}
  }
  if (!_dayManual && !g.sharedView) { const t = _todayIndex(g); if (t >= 0) activeDay = t; }
  if (activeDay >= g.days.length) activeDay = 0;
  try { sessionStorage.setItem('tst_active_day', JSON.stringify({ key, day: activeDay, manual: _dayManual })); } catch (_) {}
}
function _selectDay(di, manual = true) {
  activeDay = di; _dayManual = manual; focusedAi = null;
  renderSchedule();
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
  _resolveDay(g);
  if (empty) empty.hidden = true;
  if (timeline) timeline.hidden = false;
  if (cost) cost.hidden = !!g.hideCost;
  const sb = $('#sharedBanner');
  if (sb) sb.hidden = !g.sharedView;
  if (cta) cta.hidden = false;
  if (review) review.hidden = false;

  const nDays = g.days.length;
  if (title) title.textContent = g.title || `${g.originName ? g.originName + ' → ' : ''}${g.city} 여행`;
  title?.classList.toggle('is-long', title.textContent.length > 12);      // 긴 이름은 조금 작게
  if (sub) sub.textContent = [
    nDays <= 1 ? '당일치기' : `${nDays - 1}박 ${nDays}일`,
    g.people ? `${g.people}명` : _companion(g.companion),
    g.concept,
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
  const today = g.sharedView ? -1 : _todayIndex(g);
  g.days.forEach((d, idx) => {
    // 일별 비용 합계
    const dayCost = _dayTotal(d, idx);
    const costLabel = g.hideCost ? '' : _shortMoney(dayCost, g);
    const chip = el('button', {
      type: 'button',
      class: 'day-chip' + (idx === activeDay ? ' is-active' : '') + (idx === today ? ' is-today' : ''),
      role: 'tab',
      ariaSelected: String(idx === activeDay),
      ariaLabel: `${idx === today ? '오늘, ' : ''}${idx + 1}일차 ${d.date}${g.hideCost ? '' : ' 예상 ' + _money(dayCost, g)}`,
      onclick: () => _selectDay(idx),
    }, [
      el('span', { class: 'day-chip-date' }, `${d.date.slice(5, 7)}/${d.date.slice(8, 10)} ${_dow(d.date)}`),
      el('span', { class: 'day-chip-label' }, idx === today ? `오늘 ${idx + 1}일차` : `${idx + 1}일차`),
    ]);
    row.appendChild(chip);
  });
  // 고른 날의 예상 비용은 탭 아래 줄에 — 탭은 날짜만 보여 줘서 좁은 화면에서도 잘리지 않는다.
  const d = g.days[activeDay];
  const line = $('#dayCostLine');
  const utc = utcLabel(utcOffsetMin(_tripTz(g), d?.date));
  if (line) line.textContent = d ? `${activeDay + 1}일차 ${g.hideCost ? '비용 숨김' : '약 ' + _shortMoney(_dayTotal(d, activeDay), g)}${utc ? ` · ${utc}` : ''}` : '';
  // 긴 여행에서도 고른 날짜가 보이도록
  // 날짜 줄만 옆으로 움직인다 — 화면을 세로로 밀면 낮은 화면에서 제목이 가려진다
  requestAnimationFrame(() => {
    const on = row.querySelector('.day-chip.is-active');
    if (!on) return;
    const a = on.getBoundingClientRect(), b = row.getBoundingClientRect();
    if (a.left < b.left + 16) row.scrollLeft += a.left - b.left - 16;
    else if (a.right > b.right - 16) row.scrollLeft += a.right - b.right + 16;
  });
}

/* 일정 점검은 redesign-plan-check.js 가 맡는다(생성·편집·대안 적용이 같은 기준). */
let checksOpen = false;
const _isTime = (x) => x.kind === 'time';
/** 점검 항목의 장소로 간다 — 다른 날짜면 날짜부터 바꾸고, 지도를 보던 중이면 목록으로. */
function _jumpTo(di, ai) {
  if (view === 'map') _setView('list');
  if (di !== activeDay) _selectDay(di);
  requestAnimationFrame(() => {
    const card = $(`#scheduleTimeline .schedule-card[data-ai="${ai}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true }); card.classList.add('is-flash'); setTimeout(() => card.classList.remove('is-flash'), 1400);
  });
}
function _renderDayChecks(g, check) {
  const box = $('#dayChecks');
  if (!box) return;
  const day = g.days[activeDay];
  const total = day ? _dayTotal(day, activeDay) : 0;
  const warn = check.list.filter(_isTime);
  const need = check.list.filter(x => x.kind === 'info');
  const notes = check.list.filter(x => x.kind === 'note');
  const head = el('p', { class: 'dc-head' }, [
    el('strong', {}, `${activeDay + 1}일차`),
    ` · 장소 ${day?.activities.length || 0}곳${g.hideCost ? '' : ` · 예상 지출 ${_money(total, g)}`}`,
  ]);
  const jump = (x) => Number.isInteger(x.ai) && x.ai >= 0
    ? el('button', { type: 'button', class: 'dc-jump', onclick: () => _jumpTo(x.di, x.ai) }, [x.text, el('span', { class: 'dc-go', 'aria-hidden': 'true' }, ' ›')])
    : x.text;
  const parts = [head];
  if (!warn.length && !need.length) parts.push(el('ul', { class: 'dc-list' }, [el('li', { class: 'dc-ok' }, '시간 순서와 이동 시간에 문제가 없어요.')]));
  if (warn.length) {
    parts.push(el('p', { class: 'dc-group dc-group--warn' }, `시간 충돌 · 해결할 것 ${warn.length}`));
    parts.push(el('ul', { class: 'dc-list' }, warn.map(x => el('li', { class: 'dc-warn' }, [jump(x),
      x.fix === 'drop' && !g.sharedView ? el('button', { type: 'button', class: 'btn btn-soft dc-drop', onclick: () => _dropForDeparture(activeDay, x.ai) }, '이 장소 빼기') : null]))));
    if (!g.sharedView) parts.push(el('button', { type: 'button', class: 'btn btn-soft dc-fix', onclick: () => _openRepairSheet([activeDay]) }, '시간 다시 맞추기'));
  }
  if (need.length) {
    parts.push(el('p', { class: 'dc-group dc-group--check' }, `정보 확인 · 확인할 것 ${need.length}`));
    parts.push(el('ul', { class: 'dc-list' }, need.map(x => el('li', { class: 'dc-check' }, jump(x)))));
  }
  // 다른 날에 남은 충돌 — 누르면 그 날짜의 첫 문제로
  const others = g.days.map((_, di) => ({ di, w: di === activeDay ? [] : checkDay(g, di).list.filter(_isTime) })).filter(x => x.w.length);
  if (others.length) {
    parts.push(el('p', { class: 'dc-group' }, '다른 날'));
    parts.push(el('ul', { class: 'dc-list' }, others.map(o => el('li', { class: 'dc-warn' }, [el('button', { type: 'button', class: 'dc-jump', onclick: () => _jumpTo(o.di, o.w[0].ai) },
      [`${o.di + 1}일차 · 해결할 것 ${o.w.length}건`, el('span', { class: 'dc-go', 'aria-hidden': 'true' }, ' ›')])]))));
  }
  const v = g.validation;
  if (v?.changes?.length) {
    const moved = v.changes.filter(c => c.type === 'move').length, dropped = v.changes.length - moved;
    notes.unshift({ text: `만들 때 시간 충돌 ${v.foundBefore}건을 미리 풀었어요(시간 이동 ${moved}곳${dropped ? `, 뺀 장소 ${dropped}곳` : ''}).` });
  }
  if (notes.length) parts.push(el('ul', { class: 'dc-notes' }, notes.map(x => el('li', {}, x.text))));
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
    btn.setAttribute('aria-label', `${activeDay + 1}일차 일정 점검 — ${warn.length ? `해결할 것 ${warn.length}건${need.length ? `, 확인할 것 ${need.length}건` : ''}` : need.length ? `확인할 것 ${need.length}건` : '이상 없음'}${others.length ? `, 다른 날에도 해결할 것이 있어요` : ''}`);
    btn.classList.toggle('is-warn', warn.length > 0);
    btn.setAttribute('aria-expanded', String(checksOpen));
  }
}
/** 편집한 뒤 그 날짜를 다시 검사해 한 줄로 알린다. */
function _checkNote(di) {
  const g = appState.generated;
  const n = g?.days?.[di] ? checkDay(g, di).list.filter(_isTime).length : 0;
  return n ? ` · 시간이 맞지 않는 곳 ${n}건` : '';
}

/** 출국 준비 시간을 위해 장소 하나를 뺀다 — 고정한 장소면 한 번 더 묻는다. */
async function _dropForDeparture(di, ai) {
  const day = appState.generated?.days?.[di];
  const a = day?.activities?.[ai];
  if (!a) return;
  if (!await askConfirm(`${_josa(a.name, '을', '를')} 이 날 일정에서 뺄까요?${a.pinned ? '\n고정한 장소예요.' : ''}`, { ok: '빼기', danger: true })) return;
  const at = day.activities.indexOf(a);            // 묻는 동안 순서가 바뀌었을 수 있다
  if (at < 0) return;
  day.activities.splice(at, 1);
  _persist();
  renderSchedule();
  showToast(`${_josa(_short(a.name), '을', '를')} 뺐어요${_checkNote(di)}`);
}

/* 아래에서 올라오는 창 하나 — 대안·시간 맞추기가 같이 쓴다. */
function _bottomSheet(id, title) {
  let sh = document.getElementById(id);
  let bd = document.getElementById(id + 'Backdrop');
  if (!sh) {
    bd = el('div', { class: 'sheet-backdrop', id: id + 'Backdrop', hidden: true });
    sh = el('aside', { class: 'bottom-sheet plan-sheet', id, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + 'Title', hidden: true }, [
      el('div', { class: 'sheet-handle' }),
      el('header', { class: 'sheet-head' }, [el('h2', { id: id + 'Title', tabIndex: -1 }, title),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': '닫기', onclick: () => sh._close() }, '×')]),
      el('div', { class: 'sheet-body', 'aria-live': 'polite' }),
      el('footer', { class: 'sheet-foot alt-foot' }),
    ]);
    document.body.append(bd, sh);
    bd.addEventListener('click', () => sh._close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sh.hidden) sh._close(); });
    // 다른 화면으로 가면 닫는다(대안을 적용하며 일정 화면을 다시 그리는 동안은 그대로 둔다)
    document.addEventListener('redesign:nav', (e) => { if (!sh.hidden && e.detail?.page !== 'schedule') sh._close(); });
  }
  sh._busy = false;
  const back = document.activeElement;
  sh._close = () => {
    if (sh._busy) return;
    bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
    setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 220);
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  sh._title = (t) => { sh.querySelector('#' + id + 'Title').textContent = t; };
  sh._open = () => { sh.querySelector('.sheet-body').scrollTop = 0; bd.hidden = false; sh.hidden = false; requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); sh.querySelector('#' + id + 'Title')?.focus({ preventScroll: true }); }); };
  sh._title(title);
  return sh;
}

/** 시간 다시 맞추기 — 바뀌는 곳과 까닭을 먼저 보여 주고, 확인한 뒤에만 바꾼다. 고정·직접 고친 시각은 그대로 둔다. */
function _openRepairSheet(dis) {
  const g = appState.generated;
  if (!g?.days?.length) return;
  const sh = _bottomSheet('repairSheet', '시간 다시 맞추기');
  const body = sh.querySelector('.sheet-body'), foot = sh.querySelector('.alt-foot');
  const all = dis == null;
  const plan = all ? repairTrip(g) : (() => {
    let cur = g; const changes = [], blocked = [];
    dis.forEach(di => { const r = repairDay(cur, di); changes.push(...r.changes); blocked.push(...r.blocked); cur = { ...cur, days: cur.days.map((d, k) => (k === di ? r.day : d)) }; });
    return { days: cur.days, changes, blocked };
  })();
  const conflictsIn = (gg) => gg.days.reduce((n, _, di) => n + checkDay(gg, di).list.filter(_isTime).length, 0);
  const beforeN = conflictsIn(g), afterN = conflictsIn({ ...g, days: plan.days });
  const other = g.days.map((_, di) => di).filter(di => !all && !dis.includes(di) && checkDay(g, di).list.some(_isTime));
  const item = (c) => el('li', { class: 'rp-item' }, [
    el('span', { class: 'rp-when' }, c.type === 'drop' ? [el('s', {}, c.from), ' 빼기'] : [el('s', {}, c.from), ` → ${c.to}`]),
    el('span', { class: 'rp-name' }, c.name),
    el('span', { class: 'rp-why' }, c.reason),
  ]);
  const days = [...new Set(plan.changes.map(c => c.di))].sort((a, b) => a - b);
  body.replaceChildren(...[
    el('p', { class: 'alt-sheet-lead' }, plan.changes.length
      ? `시간 충돌 ${beforeN}건이 ${afterN}건으로 줄어요. 장소 순서는 그대로 두고 아래 ${plan.changes.length}곳만 바꿔요.`
      : '자동으로 옮겨서 풀 수 있는 곳이 없어요.'),
    ...days.map(di => el('section', { class: 'rp-day', 'aria-label': `${di + 1}일차 바뀌는 곳` }, [
      el('h3', { class: 'rp-day-h' }, `${di + 1}일차`),
      el('ul', { class: 'rp-list' }, plan.changes.filter(c => c.di === di).map(item)),
    ])),
    plan.blocked.length ? el('section', { class: 'rp-day' }, [
      el('h3', { class: 'rp-day-h' }, '직접 정해야 하는 곳'),
      el('ul', { class: 'rp-list' }, plan.blocked.map(b => el('li', { class: 'rp-item' }, [
        el('span', { class: 'rp-when' }, b.time), el('span', { class: 'rp-name' }, b.name), el('span', { class: 'rp-why' }, b.reason),
        el('button', { type: 'button', class: 'btn-text rp-edit', onclick: () => { sh._close(); _jumpTo(b.di, b.ai); setTimeout(() => _openEdit(b.di, b.ai), 260); } }, '이 장소 편집'),
      ]))),
    ]) : null,
    other.length ? el('button', { type: 'button', class: 'btn-text rp-all', onclick: () => _openRepairSheet(null) }, `다른 날(${other.map(x => `${x + 1}일차`).join('·')})도 함께 맞추기`) : null,
  ].filter(Boolean));
  foot.replaceChildren(...[
    plan.changes.length ? el('button', { type: 'button', class: 'btn btn-primary btn-block alt-confirm', onclick: () => {
      const keep = JSON.stringify(g.days);
      g.days = plan.days;
      g.days.forEach(d => d.activities.forEach(a => { if (a.edited == null && a.timeEdited == null) delete a.timeEdited; }));
      _persist(); renderSchedule();
      sh._title('시간을 맞췄어요');
      body.replaceChildren(el('p', { class: 'alt-sheet-lead' }, `${plan.changes.length}곳을 바꿨어요. ${afterN ? `직접 정해야 하는 충돌 ${afterN}건이 남았어요.` : '시간 충돌이 모두 풀렸어요.'}`));
      foot.replaceChildren(
        el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => sh._close() }, '확인'),
        el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => { appState.generated.days = JSON.parse(keep); _persist(); renderSchedule(); sh._close(); showToast('바꾸기 전 시간으로 되돌렸어요'); } }, '되돌리기'));
    } }, `${plan.changes.length}곳 바꾸기`) : null,
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => sh._close() }, plan.changes.length ? '그대로 두기' : '닫기'),
  ].filter(Boolean));
  sh._open();
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
  const check = checkDay(g, activeDay);
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
    else if (a.flightMeta?.source === 'excluded') costText = `${_josa(RIDE[rideMode(a)].ticket, '은', '는')} 예산에서 뺐어요`;
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
    const mapLink = el('button', { type: 'button', class: 'btn-text sc-map-link', 'aria-label': `${placeName} Google 지도에서 열기`, onclick: (e) => { e.stopPropagation(); _openMap(a); } }, '지도 열기 ↗');

    const card = el('article', {
      class: 'schedule-card' + (hasName ? '' : ' schedule-card--no-name') + (focusedAi === ai ? ' is-focused' : '') + (a.visited ? ' is-visited' : '') + (editMode ? ' is-editing' : ''),
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
        editMode ? null : el('button', {
          type: 'button', class: 'sc-more', 'aria-label': `${placeName} 더보기 — 편집·고정`, 'aria-expanded': 'false',
          'aria-controls': `scAct${ai}`,
          onclick: (e) => { e.stopPropagation(); _toggleCardActions(e.currentTarget.closest('.schedule-card'), e.currentTarget); },
        }, [el('span', { class: 'dots', 'aria-hidden': 'true' })]),
        el('h3', { class: 'schedule-place-name', id: `scName${ai}` }, placeName),
        el('div', { class: 'sc-line' }, [el('p', { class: 'schedule-card-meta-line' }, [
          n.category ? el('span', { class: 'schedule-category' }, n.category) : null,
          a.pinned ? el('span', { class: 'pin-badge' }, '고정') : null,
          a.visited ? el('span', { class: 'visited-badge' }, '다녀옴') : null,
          a.local === 'local' ? el('span', { class: 'local-badge', title: '현지어로 찾은 동네 장소예요. 대표 관광지 목록에 없어요' }, '동네') : a.local === 'famous' ? el('span', { class: 'famous-badge' }, '유명한 곳') : null,
          a.sample ? el('span', { class: 'sample-badge', title: '실제 검색 결과가 없어 넣은 예시 장소예요' }, '예시 장소') : null,
          a.edited ? el('span', { class: 'edited-badge' }, '직접 수정') : null,
          // 카테고리와 비용은 한 줄에
          costText ? el('span', { class: 'schedule-cost' }, [
            el('span', { class: 'sr-only' }, '예상 비용 '), costText,
            costTag ? el('span', { class: 'schedule-price-tag' + (costTag === '실시간' ? ' is-live' : '') }, ' · ' + costTag) : null,
          ]) : null,
        ].filter(Boolean)), mapLink]),
        n.memo ? el('p', { class: 'schedule-place-subinfo schedule-memo' }, '메모 · ' + n.memo) : null,
        _tripStarted(g) && !g.sharedView ? el('button', {
          type: 'button', class: 'visit-btn visit-inline' + (a.visited ? ' is-on' : ''), 'aria-pressed': String(!!a.visited),
          'aria-label': `${placeName} 다녀옴 ${a.visited ? '표시 지우기' : '표시'}`,
          onclick: (e) => { e.stopPropagation(); _toggleVisited(activeDay, ai); },
        }, a.visited ? '다녀옴' : '다녀옴 표시') : null,
        flags.length ? el('ul', { class: 'sc-flags' }, flags.map(f => el('li', { class: 'sc-flag sc-flag--' + f.lvl }, f.text))) : null,
        details.length ? el('div', { class: 'sc-where' }, details) : null,
      ]),
      el('div', { class: 'schedule-card-actions', id: `scAct${ai}` }, [
        el('button', {
          type: 'button', class: 'edit-button', 'aria-label': `${placeName} 편집`,
          onclick: (e) => { e.stopPropagation(); _openEdit(activeDay, ai); },
        }, '편집'),
        ...(movable && !g.sharedView ? [el('button', {
          type: 'button', class: 'pin-btn' + (a.pinned ? ' is-on' : ''), 'aria-pressed': String(!!a.pinned),
          'aria-label': `${placeName} ${a.pinned ? '고정 풀기' : '고정 — 다시 만들어도 남겨요'}`,
          title: '다시 만들기를 해도 이 장소를 남겨요',
          onclick: (e) => { e.stopPropagation(); a.pinned = !a.pinned; _persist(); renderSchedule(); showToast(a.pinned ? '고정했어요. 다시 만들어도 이 장소는 남아요' : '고정을 풀었어요'); },
        }, a.pinned ? '고정됨' : '고정')] : []),
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
      const hub = isFlight(next) ? next : isFlight(a) ? a : null;
      if (hub && rideMode(hub) !== 'air') moveText = hub === next ? `${RIDE[rideMode(hub)].hub === '역' ? '역으로' : '터미널로'} 이동 약 ${airportMinutes(a, next)}분 · 출발 ${beforeFlightText(g)} 전 도착` : `${RIDE[rideMode(hub)].hub}에서 시내로 약 ${airportMinutes(a, next)}분`;
      else if (isFlight(a) || isFlight(next)) moveText = isFlight(next) ? `공항으로 이동 약 ${airportMinutes(a, next)}분 · 출발 2시간 전 도착` : `입국·수하물 뒤 시내로 약 ${airportMinutes(a, next)}분`;
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
 * 날짜와 시각은 여행지 현지 기준이다(시간대를 모르는 예전 일정은 도시로 찾고, 그래도 없으면 기기 시각). */
function _tripStarted(g) { const iso = nowIn(_tripTz(g))?.iso; return !!g.days[0]?.date && !!iso && iso >= g.days[0].date; }

function _toggleVisited(di, ai) {
  const a = appState.generated?.days[di]?.activities[ai];
  if (!a) return;
  a.visited = !a.visited;
  renderSchedule();
  showToast(a.visited ? `‘${_short(a.name)}’ 다녀왔어요` : '다녀옴 표시를 지웠어요');
}

/** 일정의 현지 시간대 — 예전 일정은 도시로 찾는다. */
function _tripTz(g) { return g.timeZone || timeZoneFor(g.city, g.country); }

/** 화면에 쓸 수 있는 글자만 — null·undefined·'null'·빈 문자열은 '' 로 */
function _txt(v) {
  if (v == null) return '';
  const t = String(v).trim();
  return (t === 'null' || t === 'undefined' || t === 'NaN') ? '' : t;
}
function _renderNowNext(g) {
  const box = $('#nowNext');
  if (!box) return;
  const hide = () => { box.hidden = true; box.replaceChildren(); };
  // '지금'은 여행지 현지 시각으로 판단한다(휴대폰이 한국 시간이어도). 여행 기간 밖이면 보이지 않는다.
  const tz = _tripTz(g);
  const now = nowIn(tz);
  const di = _todayIndex(g);
  if (di < 0 || g.sharedView || !Number.isFinite(now?.min)) { hide(); return; }
  const acts = g.days[di].activities || [];
  // 시각과 이름이 모두 있는 장소만 — 빈 값이나 'null' 을 그리지 않는다(이전 저장 일정·빈 필드 포함).
  const named = (a) => { const n = _txt(getSchedulePlaceName(a)); return n && n !== 'Place name not available' ? n : ''; };
  const items = acts.map((a, i) => ({ a, i, t: _txt(a?.time), n: named(a) }))
    .map(x => ({ ...x, m: _timeToMin(x.t) }))
    .filter(x => x.t && Number.isFinite(x.m) && x.n);
  if (!items.length) { hide(); return; }
  const nowMin = now.min;
  const cur = [...items].reverse().find(x => x.m <= nowMin) || null;
  const next = items.find(x => (!cur || x.i > cur.i) && !x.a.visited && x.m > nowMin) || null;
  const row = (label, name, meta) => el('div', { class: 'nn-row' }, [
    el('span', { class: 'nn-label' }, label),
    // 장소명은 줄을 바꿔 끝까지, 시각은 오른쪽 열 첫 줄
    el('span', { class: 'nn-body' }, [
      el('span', { class: 'nn-name', title: name }, name),
      meta ? el('span', { class: 'nn-meta' }, meta) : null,
    ].filter(Boolean)),
  ]);
  const rows = [];
  let left = '';       // 다음 장소까지 남은 시간 — 머리줄에 한 번만
  if (cur) rows.push(row('지금', cur.n, cur.a.visited ? '다녀옴' : cur.t));
  if (next) {
    const mins = next.m - nowMin;
    const h = Math.floor(mins / 60), mm = mins % 60;
    left = mins > 0 ? [h ? `${h}시간` : '', mm ? `${mm}분` : ''].filter(Boolean).join(' ') : '';
    rows.push(row('다음', next.n, next.t));
  }
  if (!rows.length) { hide(); return; }
  const done = !next && cur ? el('p', { class: 'nn-done' }, '오늘 남은 일정이 없어요.') : null;
  const viewing = activeDay !== di;
  // replaceChildren 은 null 을 글자 "null" 로 넣으므로 빈 항목은 반드시 걸러 낸다.
  box.replaceChildren(...[
    el('div', { class: 'nn-head' }, [
      el('strong', {}, `오늘 ${di + 1}일차`),
      _txt(now.hhmm) ? el('span', { class: 'nn-clock' }, [`${tz ? '현지' : '기기'} ${now.hhmm}`, left ? `다음까지 ${left}` : ''].filter(Boolean).join(' · ')) : null,
    ].filter(Boolean)),
    ...rows,
    done,
    viewing ? el('div', { class: 'nn-view' }, [
      el('span', {}, `보고 있는 일정 ${activeDay + 1}일차`),
      el('button', { type: 'button', class: 'btn-text nn-go', onclick: () => { _selectDay(di, false); showToast(`오늘(${di + 1}일차) 일정으로 돌아왔어요`); } }, '오늘 일정 보기'),
    ]) : null,
  ].filter(Boolean));
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

const _SWAP_QUERY = { 식사: '맛집', 카페: '인기 카페', 쇼핑: '쇼핑 명소', 관광: '인기 명소', 액티비티: '인기 체험' };       // ‘유명한 곳 위주’ 일정에서만
const _SWAP_SLOT = { 식사: 'dinner', 카페: 'afternoon', 쇼핑: 'shopping', 관광: 'forenoon', 액티비티: 'activity' };

function _actKey(di, ai) { return `${di}_${ai}`; }
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

/** 원화 금액을 결과 통화로 보여 준다. 환율이 없으면 원화 그대로. */
function _money(krw, g) {
  const n = Number(krw) || 0;
  if (g?.fx?.rate) return formatCurrency(n * g.fx.rate, g.fx.currency);
  return formatCurrency(n, 'KRW');
}

/** 금액 한 칸 — 원화는 ‘149만 8천 원’, 정확한 금액은 title 과 화면 낭독용으로 함께 둔다. */
function _amountRow(label, krw, g, cls, note) {
  const short = g?.fx?.rate ? _money(krw, g) : _shortMoney(krw, g);
  const exact = _money(krw, g);
  return el('div', { class: 'money-row' + (cls ? ' ' + cls : '') }, [
    el('dt', {}, note ? [label, el('small', { class: 'money-note' }, note)] : label),
    el('dd', { title: exact }, [short, el('span', { class: 'sr-only' }, ` (${exact})`)]),
  ]);
}

function _row(label, value, { note, cls } = {}) {
  return el('div', { class: 'money-row' + (cls ? ' ' + cls : '') }, [
    el('dt', {}, note ? [label, ' ', el('small', {}, note)] : label),
    el('dd', {}, value),
  ]);
}

/** 금액 옆에 적는 상태와 범위 — ‘추정 · 항공·숙소 포함’ */
function _scopeNote(g, scope) {
  const st = scope.status;
  const word = { live: '실시간', estimate: '추정' };
  const kinds = ['flight', 'hotel'].filter(k => word[st[k]]);
  const kind = !kinds.length ? '추정' : kinds.every(k => st[k] === 'live') ? '실시간 요금' : kinds.every(k => st[k] === 'estimate') ? '추정'
    : `${RIDE[scope.ride].label} ${word[st.flight] || '별도'}·숙소 ${word[st.hotel] || '별도'}`;
  const inc = kinds.map(k => ({ flight: RIDE[scope.ride].label, hotel: '숙소' })[k]);
  return [kind, scope.text || (inc.length ? `${inc.join('·')} 포함` : '현지 지출만')].join(' · ');
}

function _renderBudgetPanel(g) {
  const panel = $('#budgetPanel');
  if (!panel) return;
  const bd = _computeBudgetBreakdown(g);
  const budget = Number(g.budget) || 0;
  const diff = budget - bd.total;
  panel.hidden = false;
  panel.classList.toggle('is-over', diff < 0);

  const scope = costScope(g, bd);
  const rows = $('#budgetPanelRows');
  rows.replaceChildren(
    diff < 0
      ? _amountRow('예산 초과', -diff, g, 'money-row--over', scope.excluded.length ? scope.text : '')
      : _amountRow('남는 금액', diff, g, 'money-row--under', scope.excluded.length ? scope.text : ''),
    _amountRow('예상 총액', bd.total, g, 'money-row--total', _scopeNote(g, scope)),
    _amountRow('입력 예산', budget, g),
  );
  // 예산 막대 — 안쪽이면 쓴 만큼, 넘으면 예산 자리까지 채우고 넘은 만큼 붉게
  const used = budget > 0 ? bd.total / budget : 0;
  rows.style.setProperty('--used', `${Math.round((used > 1 ? 1 / used : used) * 100)}%`);

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
  const est = [src.flight === 'estimate' && RIDE[scope.ride].label, src.hotel === 'estimate' && '숙소'].filter(Boolean);
  if (est.length && !g.providers) {
    const why = src.liveConfigured && !src.liveConfigured.flights ? '실시간 요금 조회가 연결되지 않아' : '실시간 요금을 받지 못해';
    notes.push(`${est.join('·')} 비용은 추정치예요. ${why} 도시 물가와 시기로 계산했어요.`);
  }
  if (src.flight === 'serpapi' || src.hotel === 'serpapi') {
    const at = src.flightCheckedAt || src.hotelCheckedAt;
    notes.push(`실시간 요금은 Google 항공·호텔 검색 기준이에요${at ? ` (${new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회)` : ''}. 세금·수수료 포함 여부는 예약 사이트에서 확인해 주세요.`);
  }
  if (bd.unknown) notes.unshift(`비용을 모르는 장소 ${bd.unknown}곳은 합계에 넣지 않았어요. 일정 편집에서 금액을 넣으면 합계에 반영돼요.`);
  costDuplicates(g).forEach(x => notes.unshift(x.text));
  if (src.placesSample && !g.providers) notes.push(`장소 ${src.placesSample}곳은 검색 결과가 부족해 '예시 장소'로 채웠어요.`);
  if (g.fx) notes.push(`금액은 ${g.fx.date} ${g.fx.source} 환율로 원화를 환산했어요 (1원 = ${g.fx.rate} ${g.fx.currency}).`);
  else if (g.currency && g.currency !== 'KRW') notes.push('환율을 불러오지 못해 원화로 보여 드려요.');
  if (g.sources?.liveConfigured && !g.sources.liveConfigured.ai) notes.push('AI 요약은 아직 연결되지 않았어요. 이 일정은 장소 검색 결과로 만든 기본 일정이에요.');
  const ul = $('#budgetNotices');
  ul.replaceChildren(...notes.map(t => el('li', {}, t)));
  const why = $('#budgetWhyMeta');
  if (why) { why.textContent = bd.unknown ? `비용 미확인 ${bd.unknown}곳은 합계에서 뺐어요` : ''; why.hidden = !bd.unknown; }
  _renderProviders(g);

  // 예산 초과 시 대안 — 지금 일정의 실제 합계를 기준으로 다시 계산한다(예전에 저장한 일정도 같다).
  const alts = $('#budgetAlts');
  let list = [];
  try { list = diff < 0 ? budgetAlternativesFor(g, bd.total) : []; } catch (e) { console.warn('[budget] 대안 계산 실패', e); }
  if (diff < 0 && !list.length) {
    list = [{ key: 'raise', label: `예산 한도를 ${Math.ceil(bd.total / 10000)}만원으로 변경`, detail: '일정은 그대로 두고 입력한 예산만 바꿔요',
              total: bd.total, saving: 0, over: 0, fits: true, excluded: scope.excluded, scope: scope.text, apply: { budget: Math.ceil(bd.total / 10000) }, isLimitChange: true }];
  }
  const plans = list.filter(a => !a.isLimitChange);
  const limit = list.find(a => a.isLimitChange);
  // 조합을 못 찾았을 때 안내 — 가로로 넘기는 버튼 줄 밖(위)에 둔다.
  let none = document.getElementById('budgetAltsNone');
  if (!none) { none = el('p', { id: 'budgetAltsNone', class: 'budget-alts-none', role: 'status' }); alts.before(none); }
  const noneFits = plans.length && !plans.some(a => a.fits);
  none.hidden = !noneFits;
  none.textContent = noneFits ? '조건을 여러 개 바꿔도 이 예산 안에 드는 조합은 없어요. 아래 방법으로 초과액을 줄이거나 예산 한도를 바꿔 주세요.' : '';
  // 추천 대안 1개만 요약해 보여 주고, 나머지는 시트에서 비교한다(좁은 화면에서 가로로 잘리지 않게).
  // 항공·숙소를 빼지 않고 예산에 드는 대안이 먼저(대안 목록이 이미 그 순서다)
  const best = plans.find(a => a.fits) || plans[0] || limit;
  alts.hidden = !list.length;
  alts.replaceChildren(...(list.length ? [
    el('div', { class: 'alt-summary' }, [
      el('p', { class: 'alt-summary-text' }, [
        el('span', { class: 'alt-summary-k' }, best === limit ? '맞추는 방법' : '추천'),
        el('span', { class: 'alt-summary-v' }, best.isLimitChange ? `예산 한도 ${_shortMoney(best.apply.budget * 10000, g)}` : (best.summary || best.label)),
        best.isLimitChange ? null : el('span', { class: 'alt-summary-t' }, [`예상 ${_shortMoney(best.total, g)}`, best.scope, best.fits ? '' : `${_shortMoney(best.over, g)} 초과`].filter(Boolean).join(' · ')),
      ].filter(Boolean)),
      el('button', { type: 'button', class: 'btn-text budget-alts-more', onclick: () => _openAltSheet(list, g, plans.length, best) },
        list.length > 1 ? `대안 ${list.length}개 보기` : '대안 보기'),
    ]),
  ] : []));
}

/** 예산 대안 창 — 고르면 항목별로 바뀌는 금액을 보여 주고, 적용 결과도 같은 창에서 알린다. */
function _openAltSheet(list, g, planCount, preferred) {
  void planCount;
  const sh = _bottomSheet('altSheet', '예산 대안');
  const body = sh.querySelector('.sheet-body'), foot = sh.querySelector('.alt-foot');
  const plans = list.filter(a => !a.isLimitChange);
  const limit = list.find(a => a.isLimitChange);
  const ordered = [...plans, ...(limit ? [limit] : [])];
  let picked = ordered.indexOf(preferred);
  if (picked < 0) picked = Math.max(0, ordered.findIndex(a => a.fits));
  const budget = Number(g.budget) || 0;
  const m = (v) => _shortMoney(v, g);
  const fitText = (a) => a.fits ? `예산 안${a.scope ? ` (${a.scope})` : ''}` : `아직 ${m(a.over)} 초과${a.scope ? ` · ${a.scope}` : ''}`;

  /** 항공 · 숙소 · 현지(식비·입장·쇼핑·교통)로 묶은 전후 비교 */
  const compare = (a) => {
    const local = (x) => ['food', 'entry', 'shopping', 'transport'].reduce((n, k) => n + (x[k] || 0), 0);
    const rows = [['flight', a.rideLabel || RIDE[rideOf(g)].label, a.before.flight, a.after.flight], ['hotel', '숙소', a.before.hotel, a.after.hotel], ['local', '식사·활동·교통', local(a.before), local(a.after)]]
      .filter(r => r[2] || r[3]);
    const cell = (k, v) => (a.excluded.includes(k) ? '따로 계산' : m(v));
    const keep = (k) => a.before[k] === a.after[k];
    return el('div', { class: 'alt-cmp' }, [
      el('dl', { class: 'alt-cmp-rows' }, [
        ...rows.map(([k, label, b, x]) => el('div', { class: 'alt-cmp-row' }, [
          el('dt', {}, label),
          el('dd', {}, (k === 'local' ? b === x : keep(k)) ? [cell(k, x), el('small', {}, ' 그대로')] : [el('s', {}, m(b)), ' → ', el('b', {}, cell(k, x))]),
        ])),
        el('div', { class: 'alt-cmp-row is-total' }, [el('dt', {}, '예상 총액'), el('dd', {}, [el('s', {}, m(a.before.total)), ' → ', el('b', {}, m(a.after.total))])]),
        el('div', { class: 'alt-cmp-row' }, [el('dt', {}, '절감'), el('dd', {}, m(a.saving))]),
      ]),
      el('p', { class: 'alt-cmp-note' }, a.inPlace ? '장소와 시간은 그대로 두고 금액만 바꿔요.' : _regenNote()),
    ]);
  };
  const _regenNote = () => {
    let pins = 0, edited = 0;
    g.days.forEach(d => d.activities.forEach(a => { if (a.pinned) pins++; else if (a.edited) edited++; }));
    return ['장소와 시간을 다시 만들어요.', pins ? `고정한 ${pins}곳은 그대로 둬요.` : '', edited ? `직접 고친 ${edited}곳은 바뀔 수 있으니 남기려면 먼저 고정해 주세요.` : '', '실패하면 지금 일정을 그대로 둬요.'].filter(Boolean).join(' ');
  };
  const row = (a, i) => {
    const on = i === picked;
    return el('div', { class: 'alt-item' + (on ? ' is-on' : '') }, [
      el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(on), class: 'alt-opt' + (on ? ' is-on' : '') + (a.fits ? ' is-fit' : ''),
        onclick: () => { picked = i; paint(); body.querySelector('.alt-opt.is-on')?.focus({ preventScroll: true }); },
      }, [
        el('span', { class: 'alt-opt-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'alt-opt-main' }, [
          el('span', { class: 'alt-opt-label' }, a.key === 'combo' ? (a.changeLabels || []).join(' + ') : a.label),
          a.detail && !a.isLimitChange && a.key !== 'combo' ? el('span', { class: 'alt-opt-detail' }, a.detail) : null,
          el('span', { class: 'alt-opt-sub' + (a.fits ? '' : ' is-over') }, a.isLimitChange ? '일정은 그대로 두고 예산만 바꿔요' : fitText(a)),
        ].filter(Boolean)),
        el('span', { class: 'alt-opt-total' }, a.isLimitChange ? `한도 ${m(a.apply.budget * 10000)}` : m(a.total)),
      ]),
      on && !a.isLimitChange && a.after ? compare(a) : null,
    ].filter(Boolean));
  };
  const paintFoot = (busy) => {
    const a = ordered[picked];
    foot.replaceChildren(
      el('div', { class: 'sheet-total' }, [
        el('span', {}, a.isLimitChange ? '예산 한도만 변경' : `예상 총액${a.scope ? ` · ${a.scope}` : ''}`),
        el('strong', {}, a.isLimitChange ? m(a.apply.budget * 10000) : m(a.total)),
      ]),
      el('button', { type: 'button', class: 'btn btn-primary btn-block alt-confirm', disabled: busy || null, 'aria-busy': busy ? 'true' : null, onclick: () => apply(a) },
        busy ? '적용하는 중…' : a.isLimitChange ? '예산 한도 바꾸기' : '이 조합 적용'),
    );
  };
  const paint = () => {
    sh._title('예산 대안');
    body.replaceChildren(
      el('p', { class: 'alt-sheet-lead' }, `입력 예산 ${m(budget)}에 맞추는 방법이에요.`),
      el('div', { class: 'alt-opts', role: 'radiogroup', 'aria-label': '예산 대안' }, ordered.map(row)),
    );
    paintFoot(false);
  };

  const done = (a, r) => {
    const g2 = appState.generated;
    const mm = (v) => _shortMoney(v, g2);
    const over = r.total - r.budget;
    sh._title('적용했어요');
    body.replaceChildren(...[
      el('p', { class: 'alt-sheet-lead' }, `‘${(a.changeLabels?.length ? a.changeLabels : [a.label]).join(' + ')}’ 적용을 마쳤어요.`),
      el('dl', { class: 'alt-cmp-rows alt-result' }, [
        r.predicted ? el('div', { class: 'alt-cmp-row' }, [el('dt', {}, '적용 전 예상'), el('dd', {}, mm(r.predicted.total))]) : null,
        el('div', { class: 'alt-cmp-row is-total' }, [el('dt', {}, '적용 뒤 총액'), el('dd', {}, el('b', {}, mm(r.total)))]),
        el('div', { class: 'alt-cmp-row' }, [el('dt', {}, '범위'), el('dd', {}, r.scope.text || `${RIDE[r.scope.ride].label}·숙소 포함`)]),
        el('div', { class: 'alt-cmp-row' }, [el('dt', {}, over > 0 ? '예산 초과' : '남는 금액'), el('dd', {}, mm(Math.abs(over)))]),
      ].filter(Boolean)),
      r.predicted ? el('p', { class: 'alt-cmp-note' }, r.same ? '적용 전 예상과 같은 금액이에요.' : `예상보다 ${mm(Math.abs(r.diff))} ${r.diff > 0 ? '많아요' : '적어요'}.`) : null,
      r.reasons?.length ? el('ul', { class: 'dc-list' }, r.reasons.map(x => el('li', { class: 'dc-check' }, `${x.label} ${x.diff > 0 ? '+' : '−'}${mm(Math.abs(x.diff))} — ${x.text}`))) : null,
    ].filter(Boolean));
    foot.replaceChildren(
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => sh._close() }, '확인'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => { r.undo(); _persist(); renderSchedule(); sh._close(); showToast('적용하기 전 일정으로 되돌렸어요'); } }, '적용 전 일정으로 되돌리기'),
    );
    sh.querySelector('#altSheetTitle')?.focus({ preventScroll: true });
  };
  const failed = (a, r) => {
    sh._title('적용하지 못했어요');
    body.replaceChildren(
      el('p', { class: 'alt-sheet-lead' }, r.message || '조건을 바꿔 일정을 만들지 못했어요. 지금 일정은 그대로 남아 있어요.'),
    );
    foot.replaceChildren(...[
      r.retryable !== false ? el('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => apply(a) }, '다시 시도') : null,
      el('button', { type: 'button', class: 'btn btn-ghost btn-block', onclick: () => { paint(); } }, '다른 대안 보기'),
    ].filter(Boolean));
    sh.querySelector('#altSheetTitle')?.focus({ preventScroll: true });
  };
  async function apply(a) {
    if (sh._busy) return;
    if (a.isLimitChange) {
      const before = JSON.stringify({ b: appState.generated.budget, t: appState.trip?.budget });
      appState.generated.budget = a.apply.budget * 10000;
      if (appState.trip) appState.trip.budget = a.apply.budget;
      _persist(); renderSchedule();
      const bd2 = _computeBudgetBreakdown(appState.generated);
      done({ changeLabels: [`예산 한도 ${m(a.apply.budget * 10000)}`] }, { predicted: null, total: bd2.total, budget: appState.generated.budget, scope: costScope(appState.generated, bd2), reasons: [], same: true, diff: 0,
        undo: () => { const o = JSON.parse(before); appState.generated.budget = o.b; if (appState.trip) appState.trip.budget = o.t; } });
      return;
    }
    sh._busy = true; paintFoot(true);
    let r;
    try { r = await applyBudgetAlternative(a); } catch (e) { r = { ok: false, code: 'failed', retryable: true }; console.warn('[budget] 대안 적용 실패', e); }
    sh._busy = false;
    if (!r.ok) { renderSchedule(); failed(a, r); trackEvent('alt_apply_fail'); return; }
    _persist(); renderSchedule(); done(a, r);
  }
  paint();
  sh._open();
}

/* 어디까지 실제 조회이고 어디부터 추정인지, 다시 조회할 수 있는지 */
function _renderProviders(g) {
  const note = $('#budgetNotices');
  if (!note) return;
  let box = document.getElementById('providerRows');
  if (!box) { box = el('section', { id: 'providerRows', class: 'provider-rows', 'aria-label': '조회 상태' }); note.before(box); }
  const pv = g.providers;
  if (!pv || g.hideCost) { box.hidden = true; return; }
  box.hidden = false;
  const at = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const price = (p) => ({ live: `실시간 요금 · ${at(p.checkedAt)} 조회`, excluded: '예산에서 뺐어요', none: '해당 없음', skipped: `추정 — ${p.reason}` })[p.status] || `추정 — ${p.reason || '실시간 요금을 받지 못했어요.'}`;
  const mix = localMix(g);
  const how = g.placeMode && g.placeMode !== 'famous' && mix.total ? ` 중 동네 장소 ${mix.local}곳${mix.famous ? `, 유명한 곳 ${mix.famous}곳` : ''} — ${LANG_NAME[g.placeLang || langOf(g.country)]}로 찾고 대표 관광지는 ${g.placeMode === 'mix' ? '하루 한 곳만 넣었어요' : '뺐어요'}. 방문자 국적 자료는 아니에요` : '';
  const places = (p) => p.status === 'live' ? `실제 검색 결과 ${p.real}곳${how}` : p.status === 'partial' ? `실제 ${p.real}곳 · 예시 ${p.sample}곳${p.reason ? ` — ${p.reason}` : ''}` : `모두 예시 장소 — ${p.reason || '검색 결과가 없었어요.'}`;
  const row = (kind, label, p, text) => !p || p.status === 'none' ? null : el('div', { class: 'pv-row' }, [
    el('span', { class: 'pv-k' }, label),
    el('span', { class: 'pv-v' }, text),
    p.retryable && !g.sharedView ? el('button', { type: 'button', class: 'btn-text pv-retry', onclick: (e) => _retryProvider(kind, e.currentTarget) }, kind === 'places' ? '다시 만들기' : '다시 조회') : null,
  ].filter(Boolean));
  box.replaceChildren(...[
    row('flight', RIDE[rideOf(g)].label, pv.flight, pv.flight && price(pv.flight)),
    row('hotel', '숙소', pv.hotel, pv.hotel && price(pv.hotel)),
    row('places', '장소', pv.places, pv.places && places(pv.places)),
  ].filter(Boolean));
}
async function _retryProvider(kind, btn) {
  if (kind === 'places') { $('#btnRegen')?.click(); return; }
  btn.disabled = true; btn.textContent = '조회하는 중…';
  let r;
  try { r = await retryProvider(kind); } catch (_) { r = { ok: false }; }
  _persist(); renderSchedule();
  showToast(r.ok ? '실시간 요금으로 바꿨어요' : `${r.state?.reason || '아직 조회하지 못했어요.'} 추정 금액은 그대로예요`);
}

function _renderCostSummary(g) {
  const bd = _computeBudgetBreakdown(g);
  const day = g.days[activeDay];
  const rows = $('#costRows');
  if (!rows) return;
  const list = [];
  const scope = costScope(g, bd);
  if (scope.excluded.includes('flight')) list.push(_row(RIDE[scope.ride].label, '따로 계산', { note: '합계에서 뺌' }));
  const bm = $('#bookingMeta'); if (bm) bm.textContent = `${RIDE[scope.ride].label}, 숙소, 맛집`;
  if (bd.flight) list.push(_row(RIDE[scope.ride].label, _money(bd.flight, g), { note: `왕복${g.people ? ` ${g.people}명` : ''} · ${scope.status.flight === 'live' ? '실시간' : '추정'}` }));
  if (scope.excluded.includes('hotel')) list.push(_row('숙소', '따로 계산', { note: '합계에서 뺌' }));
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
  if (bd.unknown) list.push(_row('미확인', `${bd.unknown}곳`, { note: '합계에서 뺌' }));
  list.push(_row('전체 합계', _money(bd.total, g), { cls: 'money-row--total', note: scope.text || '' }));
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

/** 이 여행의 가운데 — 현지어로 찾을 때 다른 도시 결과가 섞이지 않게. */
function _centerOf(g) {
  const p = g.days.flatMap(d => d.activities).filter(a => a.category !== '이동' && Number.isFinite(a.latitude) && Number.isFinite(a.longitude));
  return p.length ? { center_lat: p.reduce((n, a) => n + a.latitude, 0) / p.length, center_lng: p.reduce((n, a) => n + a.longitude, 0) / p.length } : {};
}
/** 같은 도시의 같은 종류 장소를 추천한다.  이미 일정에 있는 곳은 뺀다. */
async function _suggestAlternatives() {
  const g = appState.generated;
  if (!editing || !g) return;
  const current = g.days[editing.di]?.activities[editing.ai];
  const local = g.placeMode !== 'famous';
  const query = local ? localQuery(_SWAP_SLOT[current?.category] || 'forenoon', { city: findCity(c => c.name === g.city) || { name: g.city }, country: g.country, styles: g.styles || [], needs: g.needs || [], seed: Math.floor(Math.random() * 2) })
    : `${g.city} ${_SWAP_QUERY[current?.category] || '인기 명소'}`;
  const used = new Set(g.days.flatMap(d => d.activities.map(a => a.name)));
  const seq = ++_editSearchSeq;
  const sugg = $('#editSuggestions');
  if (sugg) { sugg.hidden = false; sugg.innerHTML = '<div class="ps-loading">추천 장소를 찾는 중…</div>'; }
  try {
    const res = await api.searchPlaces({ query, language: 'ko', max_results: 15, ..._centerOf(g) });
    if (seq !== _editSearchSeq) return;
    const found = (res?.places || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && !used.has(p.name));
    _renderEditSuggestions((local ? rankLocal(found, { food: current?.category === '식사' }) : found).slice(0, 10));
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
  editing = { di, ai, isNew: false, ref: appState.generated.days[di]?.activities[ai] };
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
  sel.replaceChildren(...g.days.map((d, i) => el('option', { value: String(i) }, `${i + 1}일차 · ${d.date.slice(5, 7)}/${d.date.slice(8, 10)}`)));
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
    newActivity.edited = true; newActivity.timeEdited = true; newActivity.costEdited = cost != null;
    _insertByTime(appState.generated.days[di].activities, newActivity);
    _closeEdit();
    renderSchedule();
    showToast('장소를 추가했어요' + _checkNote(di));
  } else {
    const { di, ai } = editing;
    const a = appState.generated.days[di]?.activities[ai];
    if (!a || (editing.ref && a !== editing.ref)) { _closeEdit(); renderSchedule(); showToast('그사이 일정이 바뀌었어요. 장소를 다시 골라 주세요'); return; }
    const prevName = a.name;
    const changed = a.name !== name || a.time !== time || (a.cost ?? null) !== cost;
    if (a.time !== time) a.timeEdited = true; else if (a.timeEdited == null && !a.edited) a.timeEdited = false;
    if ((a.cost ?? null) !== cost) a.costEdited = true;
    a.name = name;
    a.time = time;
    a.cost = cost;
    a.memo = memo;
    if (changed) a.edited = true;
    if (picked) {
      a.local = picked._local?.kind || ''; delete a.sample;
      a.openingPeriods = picked.opening_periods || null; a.rating = picked.rating ?? null; a.reviews = picked.user_rating_count ?? null;
      a.placeId   = picked.place_id;
      a.latitude  = picked.latitude;
      a.longitude = picked.longitude;
      a.address   = picked.address || '';
      a.googleMapsQuery = picked.name;
    } else if (name !== prevName) {
      // 직접 입력한 다른 곳 — 이전 장소의 영업시간·위치·평점을 그대로 두면 점검과 이동 시간이 틀린다.
      a.googleMapsQuery = (name + ' ' + cityName).trim();
      a.openingPeriods = null; a.rating = null; a.reviews = null; a.local = '';
      delete a.latitude; delete a.longitude; delete a.sample;
      a.address = ''; a.placeId = 'custom-' + Date.now();
    }
    // 다른 날짜로 옮기기
    const toDay = Number($('#editDay')?.value);
    if (Number.isInteger(toDay) && toDay !== di && appState.generated.days[toDay]) {
      appState.generated.days[di].activities.splice(ai, 1);
      _insertByTime(appState.generated.days[toDay].activities, a);
      _closeEdit();
      a.timeEdited = true;
      _selectDay(toDay);
      showToast(`${toDay + 1}일차로 옮겼어요${_checkNote(toDay)}`);
      return;
    }
    // 시간을 바꾸면 시간 순서대로 다시 놓는다.
    const acts = appState.generated.days[di].activities;
    acts.splice(ai, 1); _insertByTime(acts, a);
    _closeEdit();
    renderSchedule();
    showToast('수정했어요' + _checkNote(di));
  }
}

async function _deleteEdit() {
  if (!editing) return;
  if (editing.isNew) { _closeEdit(); return; }   // 추가 모드: 취소만 함
  const { di, ai } = editing;
  const target = editing.ref || appState.generated.days[di]?.activities[ai];
  if (!await askConfirm('이 장소를 삭제할까요?', { ok: '삭제', danger: true })) return;
  const at = appState.generated.days[di]?.activities.indexOf(target) ?? -1;
  if (at < 0) { _closeEdit(); renderSchedule(); showToast('그사이 일정이 바뀌었어요. 장소를 다시 골라 주세요'); return; }
  appState.generated.days[di].activities.splice(at, 1);
  _closeEdit();
  renderSchedule();
  showToast('삭제했어요' + _checkNote(di));
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
/** 하루 시간표 다시 계산 — 점검과 같은 기준(체류·이동·입국 시간)을 쓴다. */
function _recomputeDayTimes(day) { recomputeDay(appState.generated, day); }

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
  {
    const mv = (x) => x.category !== '이동' && x.category !== '숙박';
    const rest = acts.filter((_, i) => i !== srcAi);
    let lo = 0; while (lo < rest.length && !mv(rest[lo])) lo++;
    let hi = rest.length; while (hi > lo && !mv(rest[hi - 1])) hi--;
    insertIdx = Math.max(lo, Math.min(insertIdx, hi));
  }
  if (insertIdx === srcAi) return;                           // 제자리 → 변화 없음
  const movedAct = acts[srcAi];
  const movedKey = movedAct ? (movedAct.placeId || movedAct.id || (movedAct.name || '').trim()) : '';
  const oldTops = _captureCardRects();                       // 재정렬 전 위치 기록 (FLIP)
  const [moved] = acts.splice(srcAi, 1);
  acts.splice(insertIdx, 0, moved);
  moved.edited = true; moved.timeEdited = false;
  _recomputeDayTimes(day);
  focusedAi = insertIdx;
  renderSchedule();
  _flipReorder(oldTops, String(movedKey));                   // 새 위치로 부드럽게 미끄러짐
  showToast(`${insertIdx + 1}번째로 옮기고 시간을 다시 계산했어요${_checkNote(activeDay)}`);
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

/** 장소 하나의 고정·다녀옴·편집 — 평소에는 ‘더보기’ 뒤에, 일정 편집 중에는 바로 보인다. */
function _toggleCardActions(card, btn) {
  const open = !card.classList.contains('is-actions-open');
  document.querySelectorAll('#scheduleTimeline .schedule-card.is-actions-open').forEach(c => {
    c.classList.remove('is-actions-open'); c.querySelector('.sc-more')?.setAttribute('aria-expanded', 'false');
  });
  card.classList.toggle('is-actions-open', open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) card.querySelector('.schedule-card-actions button')?.focus();
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
  const lbl = btn?.querySelector('.ab-label'); if (lbl) lbl.textContent = onAccount ? '계정에 보관됨' : '일정 저장';
  if (btn) btn.title = onAccount ? '계정에서 빼기' : '저장';
  let text, cls = '';
  if (saveState === 'saving') text = '계정에 보관하는 중…';
  else if (saveState === 'error') { text = '계정에 보관하지 못했어요. 이 기기에는 있어요.'; cls = 'is-error'; }
  else if (onAccount) text = '계정에 보관됨 · 마이 › 계정에 보관한 일정';
  else text = appState.currentUser ? '이 기기에만 보관 중 · 일정 저장을 누르면 계정에도 저장' : '이 기기에만 보관 중 · 만들기에서 다시 열 수 있어요';
  box.className = 'save-status ' + cls;
  box.replaceChildren(...[el('span', {}, text),
    saveState === 'error' ? el('button', { type: 'button', class: 'btn-text', onclick: _saveToAccount }, '다시 시도') : null].filter(Boolean));
}

async function _toggleSave() {
  const g = appState.generated;
  if (!g) { showToast('저장할 일정이 없어요'); return; }
  if (!appState.currentUser) { _openSaveChoice(); return; }
  if (g.savedScheduleId) {
    if (!await askConfirm('이 일정을 ‘계정에 보관한 일정’에서 뺄까요?\n이 기기에서는 그대로 볼 수 있고, 다시 저장하면 되살아나요.', { ok: '빼기' })) return;
    try {
      await api.unsaveSchedule(g.savedScheduleId);
      g.savedScheduleId = null;
      saveState = 'idle';
      _paintSaveStatus(); _persist();
      showToast('계정에서 뺐어요 · 이 기기의 내 일정에는 남아 있어요');
    } catch (e) {
      showToast('저장 해제에 실패했어요. 잠시 뒤 다시 시도해 주세요');
    }
    return;
  }
  await _saveToAccount();
}

let _saving = null;      // 진행 중인 저장 — 연속 탭·로그인 복귀가 겹쳐도 계정에 한 번만 만든다
function _saveToAccount() {
  if (_saving) return _saving;
  _saving = _saveToAccountOnce().finally(() => { _saving = null; });
  return _saving;
}
async function _saveToAccountOnce() {
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
      showToast('계정에 보관했어요 · 마이 › 계정에 보관한 일정에서 다시 열어요', 3600);
    }
    lastSyncedJson = JSON.stringify(data);
    saveState = 'saved';
  } catch (e) {
    console.warn('[schedule] 계정 저장 실패', e?.status, e?.message);
    if (e?.status === 404 && g.savedScheduleId) { g.savedScheduleId = null; return _saveToAccountOnce(); }
    saveState = 'error';
    trackEvent('trip_save_fail');
    showToast(e?.status === 401 ? '로그인이 만료됐어요. 다시 로그인하면 이어서 보관할 수 있어요' : '계정에 보관하지 못했어요. 이 기기에는 있어요');
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
    showToast('이 기기에만 보관했어요 · 만들기에서 다시 열 수 있어요', 3600);
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
      showToast('로그인했어요. 보관하려던 일정은 이 기기의 내 일정에서 확인해 주세요');
      return;
    }
    navigate('schedule', { replace: true });
    if (intent.viaSignup) showToast('가입을 마쳤어요 · 이메일 인증 완료. 만들던 일정을 계정에 저장할게요', 3200);
    if (g.savedScheduleId) { showToast('로그인했어요 · 이 일정은 이미 계정에 보관돼 있어요'); return; }
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
    catch (_) { trackEvent('trip_share_fail'); showCopy('이 링크를 복사해 공유하세요', link); }
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
