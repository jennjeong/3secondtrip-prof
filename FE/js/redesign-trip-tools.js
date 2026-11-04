/* 3초 여행 — Redesign Trip Tools
 * 일정 아래의 여행 도구 묶음: 날씨, 환율, 경비 기록, 준비물, 내보내기.
 * 날씨·환율은 키가 필요 없는 공개 API를 쓰고, 실패하면 그 줄만 숨긴다.
 * 경비와 준비물은 기기에만 저장한다(localStorage).
 */

import { trackEvent } from './redesign-api-adapter.js';
import { $, el, formatCurrency, showToast } from './redesign-ui.js';

const STORE_KEY = 'tst_trip_tools_v1';
const MAX_STORED_TRIPS = 20;
const FORECAST_DAYS = 16;   // Open-Meteo 예보 범위

const CURRENCY_BY_COUNTRY = {
  일본: 'JPY', 미국: 'USD', 괌: 'USD', 북마리아나: 'USD', 영국: 'GBP', 중국: 'CNY', 홍콩: 'HKD',
  싱가포르: 'SGD', 태국: 'THB', 말레이시아: 'MYR', 인도네시아: 'IDR', 필리핀: 'PHP', 인도: 'INR',
  호주: 'AUD', 뉴질랜드: 'NZD', 캐나다: 'CAD', 스위스: 'CHF', 스웨덴: 'SEK', 노르웨이: 'NOK',
  덴마크: 'DKK', 체코: 'CZK', 헝가리: 'HUF', 폴란드: 'PLN', 튀르키예: 'TRY', 멕시코: 'MXN',
  브라질: 'BRL', 이스라엘: 'ILS', 남아공: 'ZAR', 아이슬란드: 'ISK', 루마니아: 'RON',
  프랑스: 'EUR', 이탈리아: 'EUR', 스페인: 'EUR', 포르투갈: 'EUR', 네덜란드: 'EUR', 벨기에: 'EUR',
  독일: 'EUR', 오스트리아: 'EUR', 핀란드: 'EUR', 아일랜드: 'EUR', 그리스: 'EUR', 룩셈부르크: 'EUR',
  모나코: 'EUR', 에스토니아: 'EUR', 라트비아: 'EUR', 리투아니아: 'EUR', 크로아티아: 'EUR', 슬로베니아: 'EUR',
};

const BASE_CHECKLIST = ['여권·신분증', '항공권·숙소 예약 확인', '카드·현지 통화', '휴대폰 충전기', '상비약', '여행자 보험'];

let appState = null;
let lastKey = '';
const fetched = {};   // 같은 여행의 날씨·환율을 다시 부르지 않도록 메모리에 보관

export function initTripTools(state) {
  appState = state;
  document.addEventListener('redesign:schedule-changed', render);
}

/* ============ 저장 ============ */
function _tripKey(g) {
  return `${g.city}|${g.days[0]?.date || ''}|${g.days.length}`;
}
function _readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (_) { return {}; }
}
function _tripData(g) {
  const d = _readStore()[_tripKey(g)] || {};
  return { expenses: Array.isArray(d.expenses) ? d.expenses : [], checked: Array.isArray(d.checked) ? d.checked : [] };
}
function _saveTripData(g, data) {
  const store = _readStore();
  store[_tripKey(g)] = { ...data, updatedAt: Date.now() };
  const keys = Object.keys(store).sort((a, b) => (store[b].updatedAt || 0) - (store[a].updatedAt || 0));
  keys.slice(MAX_STORED_TRIPS).forEach(k => delete store[k]);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
}

/* ============ 화면 ============ */
export function render() {
  const wrap = $('#tripTools');
  const g = appState?.generated;
  if (!wrap) return;
  if (!g?.days?.length) { wrap.hidden = true; lastKey = ''; return; }
  wrap.hidden = false;
  const key = _tripKey(g);
  if (key === lastKey) return;   // 날짜 칩 이동마다 다시 그리면 입력 중인 값이 지워진다
  lastKey = key;

  wrap.innerHTML = '';
  wrap.append(
    _section('날씨', el('div', { id: 'toolWeather', class: 'tool-weather' }, '불러오는 중…')),
    _section('환율', el('p', { id: 'toolRate', class: 'tool-note' }, '불러오는 중…')),
    _section('경비 기록', _expenseEl(g)),
    _section('준비물', _checklistEl(g)),
    _section('내보내기', _exportEl(g)),
  );
  _loadWeather(g, key);
  _loadRate(g, key);
}

function _section(title, body) {
  return el('div', { class: 'tool-card' }, [el('h3', { class: 'tool-title' }, title), body]);
}

/* ============ 날씨 ============ */
function _weatherLabel(code) {
  if (code === 0) return '☀️ 맑음';
  if (code <= 3) return '⛅ 구름';
  if (code <= 48) return '🌫️ 안개';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️ 비';
  if (code <= 77 || code === 85 || code === 86) return '🌨️ 눈';
  return '⛈️ 뇌우';
}

function _firstCoords(g) {
  for (const d of g.days) {
    for (const a of d.activities || []) {
      const lat = Number(a.latitude ?? a.lat), lng = Number(a.longitude ?? a.lng);
      if (a.category !== '이동' && (a.latitude ?? a.lat) != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

async function _fetchWeather(g) {
  const start = g.days[0]?.date, end = g.days.at(-1)?.date;
  const coords = _firstCoords(g);
  if (!start || !end || !coords) return null;
  const qs = new URLSearchParams({
    latitude: coords.lat.toFixed(3), longitude: coords.lng.toFixed(3),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', start_date: start, end_date: end,
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + qs);
  if (!res.ok) return null;
  const { daily } = await res.json();
  return daily?.time?.map((date, i) => ({
    date,
    code: daily.weather_code[i],
    max: Math.round(daily.temperature_2m_max[i]),
    min: Math.round(daily.temperature_2m_min[i]),
    rain: daily.precipitation_probability_max[i],
  })) || null;
}

async function _loadWeather(g, key) {
  const box = () => (lastKey === key ? $('#toolWeather') : null);
  const start = g.days[0]?.date;
  const daysAway = start ? Math.ceil((new Date(start) - Date.now()) / 86400000) : null;
  if (daysAway != null && daysAway > FORECAST_DAYS - g.days.length) {
    if (box()) box().textContent = `출발 ${FORECAST_DAYS}일 전부터 날씨를 보여드려요.`;
    return;
  }
  let rows = fetched[`w:${key}`];
  if (rows === undefined) {
    try { rows = await _fetchWeather(g); } catch (_) { rows = null; }
    fetched[`w:${key}`] = rows;
  }
  const target = box();
  if (!target) return;
  if (!rows?.length) { target.textContent = '날씨 정보를 불러오지 못했어요.'; return; }
  target.textContent = '';
  rows.forEach((r, i) => target.appendChild(el('div', { class: 'tool-day' }, [
    el('strong', {}, `Day ${i + 1}`),
    el('span', {}, _weatherLabel(r.code)),
    el('span', {}, `${r.min}° / ${r.max}°`),
    el('span', { class: 'tool-note' }, `비 ${r.rain ?? '-'}%`),
  ])));
  _addWeatherItems(g, rows);
}

/* ============ 환율 ============ */
async function _loadRate(g, key) {
  const target = () => (lastKey === key ? $('#toolRate') : null);
  const currency = CURRENCY_BY_COUNTRY[g.country];
  if (!currency) {
    target()?.closest('.tool-card')?.remove();
    return;
  }
  let rate = fetched[`r:${currency}`];
  if (rate === undefined) {
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=KRW&symbols=${currency}`);
      rate = res.ok ? (await res.json()).rates?.[currency] ?? null : null;
    } catch (_) { rate = null; }
    fetched[`r:${currency}`] = rate;
  }
  const box = target();
  if (!box) return;
  if (!rate) { box.textContent = '환율 정보를 불러오지 못했어요.'; return; }
  const krwPerUnit = (currency === 'JPY' || currency === 'IDR' ? 100 : 1) / rate;
  const unit = currency === 'JPY' || currency === 'IDR' ? 100 : 1;
  box.textContent = `${unit.toLocaleString('ko-KR')} ${currency} ≈ ${Math.round(krwPerUnit).toLocaleString('ko-KR')}원 (유럽중앙은행 기준, 실제 환전 금액과 달라요)`;
}

/* ============ 경비 ============ */
function _expenseEl(g) {
  const list = el('div', { class: 'tool-list' });
  const summary = el('p', { class: 'tool-note' });
  const name = el('input', { class: 'form-input', type: 'text', placeholder: '항목 (예: 점심)', maxLength: 40, ariaLabel: '경비 항목' });
  const amount = el('input', { class: 'form-input', type: 'number', min: '1', placeholder: '금액(원)', inputMode: 'numeric', ariaLabel: '경비 금액' });

  const paint = () => {
    const { expenses } = _tripData(g);
    list.textContent = '';
    expenses.forEach((x, i) => list.appendChild(el('div', { class: 'tool-row' }, [
      el('span', {}, x.name),
      el('span', {}, formatCurrency(x.amount, 'KRW')),
      el('button', {
        type: 'button', class: 'tool-remove', ariaLabel: `${x.name} 삭제`,
        onclick: () => {
          const d = _tripData(g);
          d.expenses.splice(i, 1);
          _saveTripData(g, d);
          paint();
        },
      }, '×'),
    ])));
    const spent = expenses.reduce((s, x) => s + x.amount, 0);
    summary.textContent = `쓴 돈 ${formatCurrency(spent, 'KRW')}` + (g.budget ? ` · 예산 ${formatCurrency(g.budget, g.currency)} 중 ${Math.round(spent / g.budget * 100)}%` : '');
  };

  const add = el('button', {
    type: 'button', class: 'btn btn-soft',
    onclick: () => {
      const value = Math.round(Number(amount.value));
      if (!name.value.trim() || !Number.isFinite(value) || value <= 0 || value > 1e10) {
        showToast('항목과 금액을 입력해 주세요');
        return;
      }
      const d = _tripData(g);
      d.expenses.push({ name: name.value.trim(), amount: value });
      _saveTripData(g, d);
      name.value = ''; amount.value = '';
      paint();
    },
  }, '추가');

  paint();
  return el('div', {}, [el('div', { class: 'tool-form' }, [name, amount, add]), list, summary]);
}

/* ============ 준비물 ============ */
function _checklistItems(g) {
  const items = [...BASE_CHECKLIST];
  if (g.country === '대한민국') items.splice(0, 1, '신분증');
  if (CURRENCY_BY_COUNTRY[g.country]) items.push('여행지 전원 어댑터');
  if (g.companion === 'family') items.push('아이 간식·놀이용품');
  return items;
}

function _checklistEl(g) {
  const box = el('div', { class: 'tool-list', id: 'toolChecklist' });
  _paintChecklist(g, box, _checklistItems(g));
  return box;
}

function _paintChecklist(g, box, items) {
  const { checked } = _tripData(g);
  box.textContent = '';
  items.forEach(item => {
    const cb = el('input', {
      type: 'checkbox', checked: checked.includes(item),
      onchange: (e) => {
        const d = _tripData(g);
        d.checked = e.target.checked ? [...new Set([...d.checked, item])] : d.checked.filter(x => x !== item);
        _saveTripData(g, d);
      },
    });
    box.appendChild(el('label', { class: 'tool-check' }, [cb, item]));
  });
}

/** 예보가 나오면 날씨에 맞는 준비물을 더한다. */
function _addWeatherItems(g, rows) {
  const box = $('#toolChecklist');
  if (!box) return;
  const items = _checklistItems(g);
  if (rows.some(r => (r.rain ?? 0) >= 50)) items.push('우산·우비');
  if (rows.some(r => r.min <= 5)) items.push('두꺼운 외투');
  if (rows.some(r => r.max >= 28)) items.push('자외선 차단제');
  _paintChecklist(g, box, items);
}

/* ============ 내보내기 ============ */
function _icsText(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function _addMinutes(date, hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(...date.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h, m + minutes));
}
function _icsTime(d) {
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '') + '00';
}

export function buildIcs(g) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//3 Second Trip//KO', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  g.days.forEach((d, di) => {
    (d.activities || []).forEach((a, ai) => {
      if (!d.date || !/^\d{1,2}:\d{2}$/.test(a.time || '')) return;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${di}-${ai}-${stamp}@3secondtrip`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${_icsTime(_addMinutes(d.date, a.time, 0))}`,
        `DTEND:${_icsTime(_addMinutes(d.date, a.time, 60))}`,
        `SUMMARY:${_icsText(a.name)}`,
        `LOCATION:${_icsText(a.address)}`,
        `DESCRIPTION:${_icsText(a.memo || a.category)}`,
        'END:VEVENT',
      );
    });
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function _downloadIcs(g) {
  const url = URL.createObjectURL(new Blob([buildIcs(g)], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a', { href: url, download: `3초여행-${g.city}.ics` });
  a.click();
  URL.revokeObjectURL(url);
  trackEvent('trip_exported');
  showToast('캘린더 파일을 저장했어요');
}

function _exportEl(g) {
  return el('div', { class: 'tool-actions' }, [
    el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _downloadIcs(g) }, '캘린더 저장'),
    el('button', {
      type: 'button', class: 'btn btn-soft',
      onclick: () => { trackEvent('trip_exported'); window.print(); },
    }, 'PDF로 저장'),
  ]);
}
