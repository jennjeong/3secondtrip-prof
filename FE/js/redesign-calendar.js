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
};

export function initCalendar() {
  $('#calPrev')?.addEventListener('click', () => _shiftMonth(-1));
  $('#calNext')?.addEventListener('click', () => _shiftMonth(1));
  $('#calendarClose')?.addEventListener('click', closeCalendar);
  $('#calendarBackdrop')?.addEventListener('click', closeCalendar);
  $('#calReset')?.addEventListener('click', () => { cal.start = null; cal.end = null; cal.focus = 'start'; _render(); });
  $('#calDone')?.addEventListener('click', () => {
    if (cal.onApply) {
      cal.onApply({
        start: cal.start ? _toISO(cal.start) : null,
        end:   cal.end   ? _toISO(cal.end)   : null,
      });
    }
    closeCalendar();
  });
}

export function openCalendar(opts = {}) {
  const today = _atMidnight(new Date());
  cal.minDate = opts.minDate ? _parseISO(opts.minDate) : today;
  cal.start = opts.start ? _parseISO(opts.start) : null;
  cal.end   = opts.end   ? _parseISO(opts.end)   : null;
  cal.focus = opts.focus === 'end' ? 'end' : 'start';
  cal.onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
  cal.view = new Date(cal.start || today);
  cal.view.setDate(1);
  _render();
  const bd = $('#calendarBackdrop'); const sh = $('#calendarSheet');
  if (!bd || !sh) return;
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); });
}

export function closeCalendar() {
  const bd = $('#calendarBackdrop'); const sh = $('#calendarSheet');
  if (!bd || !sh) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 250);
}

/* ============ Render ============ */
function _render() {
  const lbl = $('#calMonth');
  if (lbl) lbl.textContent = `${cal.view.getFullYear()}년 ${cal.view.getMonth() + 1}월`;

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
    const isPast = date < cal.minDate;
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
      ariaLabel: `${year}년 ${month+1}월 ${d}일`,
      ariaDisabled: String(isPast),
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
    s.innerHTML = `출발: <strong>${_fmtKo(cal.start)}</strong> · 도착일을 선택해 주세요`;
    return;
  }
  if (cal.start && cal.end) {
    const days = Math.round((cal.end - cal.start) / 86400000) + 1;
    s.innerHTML = `<strong>${_fmtKo(cal.start)}</strong> → <strong>${_fmtKo(cal.end)}</strong> · 총 <strong>${days}일</strong>`;
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
