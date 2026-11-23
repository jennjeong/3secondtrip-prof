/* 3초 여행 — Redesign Calendar (bottom-sheet, range pick, past disabled)
 *
 * Public API:
 *   openCalendar({ start, end, focus, onApply, minDate })
 *     - start: ISO date "YYYY-MM-DD" or null
 *     - end:   ISO date or null
 *     - focus: "start" | "end" — which one is currently being edited
 *     - onApply({ start, end }) — called when 완료 pressed
 *     - minDate: ISO date — earliest selectable date (default = today)
 */

import { $, el } from './redesign-ui.js';

const WEEKDAY = ['일','월','화','수','목','금','토'];

const cal = {
  view: null,        // Date object — first day of currently shown month
  start: null,       // Date | null
  end: null,         // Date | null
  focus: 'start',
  onApply: null,
  minDate: null,
  maxDays: 0,         // 0 = 제한 없음
  returnFocus: null,  // 닫을 때 초점을 돌려줄 버튼
};
const MAX_MONTHS_AHEAD = 12;

export function initCalendar() {
  $('#calPrev')?.addEventListener('click', () => _shiftMonth(-1));
  $('#calNext')?.addEventListener('click', () => _shiftMonth(1));
  $('#calendarClose')?.addEventListener('click', closeCalendar);
  $('#calendarBackdrop')?.addEventListener('click', closeCalendar);
  $('#calReset')?.addEventListener('click', () => { cal.start = null; cal.end = null; cal.focus = 'start'; _render(); });
  $('#calDone')?.addEventListener('click', () => {
    // 귀국일을 고르지 않았으면 당일치기로 본다.
    if (cal.start && !cal.end) cal.end = cal.start;
    if (cal.onApply) {
      cal.onApply({
        start: cal.start ? _toISO(cal.start) : null,
        end:   cal.end   ? _toISO(cal.end)   : null,
      });
    }
    closeCalendar();
  });
  $('#calendarSheet')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeCalendar(); }
  });
}

export function openCalendar(opts = {}) {
  const today = _atMidnight(new Date());
  cal.minDate = opts.minDate ? _parseISO(opts.minDate) : today;
  cal.start = opts.start ? _parseISO(opts.start) : null;
  cal.end   = opts.end   ? _parseISO(opts.end)   : null;
  cal.focus = opts.focus === 'end' ? 'end' : 'start';
  cal.onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
  cal.maxDays = Number(opts.maxDays) || 0;
  cal.returnFocus = opts.returnFocus || document.activeElement;
  // 귀국일을 고치려는데 출발일이 없으면 출발일부터 고른다.
  if (cal.focus === 'end' && !cal.start) cal.focus = 'start';
  cal.view = new Date((cal.focus === 'end' && cal.end) || cal.start || today);
  cal.view.setDate(1);
  _render();
  const bd = $('#calendarBackdrop'); const sh = $('#calendarSheet');
  if (!bd || !sh) return;
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => {
    bd.classList.add('is-visible'); sh.classList.add('is-visible');
    (sh.querySelector('.cal-cell.range-start, .cal-cell.is-today:not([aria-disabled=true])') || $('#calendarClose'))?.focus();
  });
}

export function closeCalendar() {
  const bd = $('#calendarBackdrop'); const sh = $('#calendarSheet');
  if (!bd || !sh) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 250);
  const back = cal.returnFocus; cal.returnFocus = null;
  if (back && document.contains(back)) back.focus();
}

/* ============ Render ============ */
function _render() {
  const lbl = $('#calMonth');
  if (lbl) lbl.textContent = `${cal.view.getFullYear()}년 ${cal.view.getMonth() + 1}월`;
  // 지금 어느 날짜를 고르는 중인지 제목에 보여 준다.
  const title = $('#calendarSheetTitle');
  if (title) title.textContent = cal.focus === 'end' && cal.start ? '귀국일 선택' : '출발일 선택';
  const first = new Date(cal.minDate.getFullYear(), cal.minDate.getMonth(), 1);
  const last = new Date(first.getFullYear(), first.getMonth() + MAX_MONTHS_AHEAD, 1);
  const prev = $('#calPrev'); if (prev) prev.disabled = cal.view <= first;
  const next = $('#calNext'); if (next) next.disabled = cal.view >= last;
  // 출발일을 고른 뒤에는 최대 기간을 넘는 날을 막는다.
  const limit = (cal.maxDays && cal.start && !cal.end)
    ? new Date(cal.start.getFullYear(), cal.start.getMonth(), cal.start.getDate() + cal.maxDays - 1) : null;

  const grid = $('#calGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const today = _atMidnight(new Date());
  const year = cal.view.getFullYear();
  const month = cal.view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();    // 0(Sun)..6(Sat)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Leading blanks
  for (let i = 0; i < firstDow; i++) {
    grid.appendChild(el('button', { type: 'button', class: 'cal-cell is-blank', tabindex: '-1' }));
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const iso = _toISO(date);
    const dow = date.getDay();
    const isPast = date < cal.minDate || (limit && date > limit);
    const isToday = _sameDay(date, today);
    const inRange = _isInRange(date);
    const isStart = cal.start && _sameDay(date, cal.start);
    const isEnd = cal.end && _sameDay(date, cal.end);

    const classes = ['cal-cell'];
    if (isPast) classes.push('is-past');
    if (isToday) classes.push('is-today');
    if (dow === 0) classes.push('is-sun');
    if (dow === 6) classes.push('is-sat');
    if (inRange && !isStart && !isEnd) classes.push('in-range');
    if (isStart) classes.push('range-start');
    if (isEnd)   classes.push('range-end');
    if (isStart && cal.end) classes.push('has-end');
    if (isEnd && cal.start) classes.push('has-start');

    const cell = el('button', {
      type: 'button',
      class: classes.join(' '),
      role: 'gridcell',
      dataset: { iso },
      ariaLabel: `${year}년 ${month+1}월 ${d}일 ${WEEKDAY[dow]}요일`
        + (isToday ? ', 오늘' : '') + (isStart ? ', 출발일' : '') + (isEnd ? ', 귀국일' : '')
        + (isPast ? ', 선택할 수 없음' : ''),
      ariaDisabled: String(isPast),
      ariaPressed: String(!!(isStart || isEnd)),
      tabIndex: isPast ? -1 : 0,
      onclick: () => { if (!isPast) _pickDate(date); },
    }, String(d));
    grid.appendChild(cell);
  }

  _renderSummary();
}

function _renderSummary() {
  const s = $('#calSummary');
  if (!s) return;
  if (!cal.start && !cal.end) { s.textContent = '출발일을 선택해 주세요'; return; }
  if (cal.start && !cal.end) {
    s.innerHTML = `출발 <strong>${_fmtKo(cal.start)}</strong> · 귀국일을 골라 주세요`
      + (cal.maxDays ? ` (최대 ${cal.maxDays}일)` : '') + ' · 그대로 완료하면 당일치기예요';
    return;
  }
  if (cal.start && cal.end) {
    const days = Math.round((cal.end - cal.start) / 86400000) + 1;
    const label = days === 1 ? '당일치기' : `${days - 1}박 ${days}일`;
    s.innerHTML = `<strong>${_fmtKo(cal.start)}</strong> → <strong>${_fmtKo(cal.end)}</strong> · <strong>${label}</strong>`;
  }
}

function _pickDate(date) {
  // Range-pick semantics:
  //   if focus is start → set start, reset end, switch focus
  //   if focus is end:
  //     - if no start → set start
  //     - if date < start → swap (date becomes start, old start becomes end)
  //     - else → set end
  if (cal.focus === 'start' || !cal.start) {
    cal.start = date; cal.end = null; cal.focus = 'end';
  } else if (cal.start && !cal.end) {
    if (date < cal.start) { cal.end = cal.start; cal.start = date; }
    else cal.end = date;
    cal.focus = 'start';
  } else {
    // Both set — start over
    cal.start = date; cal.end = null; cal.focus = 'end';
  }
  _render();
  // 다시 그린 뒤에도 키보드 초점이 고른 날짜에 남도록
  $(`#calGrid [data-iso="${_toISO(date)}"]`)?.focus();
}

function _shiftMonth(delta) {
  cal.view = new Date(cal.view.getFullYear(), cal.view.getMonth() + delta, 1);
  _render();
}

/* ============ Helpers ============ */
function _toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function _parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return _atMidnight(new Date(y, (m || 1) - 1, d || 1));
}
function _atMidnight(date) { const d = new Date(date); d.setHours(0,0,0,0); return d; }
function _sameDay(a, b) { return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function _isInRange(date) { if (!cal.start || !cal.end) return false; return date >= cal.start && date <= cal.end; }
function _fmtKo(d) { return `${d.getMonth()+1}.${d.getDate()} (${WEEKDAY[d.getDay()]})`; }
