/* 3초 여행 — 동네 사람이 쓴 코스 : 쓰기 화면(#page=local-write)과 내가 쓴 코스 목록
 *
 * 그 도시에 사는(살았던) 사람이 직접 쓴다. 거주 여부는 작성자가 밝힌 것이라 화면에도 ‘확인하지 않음’을 적는다.
 * 올린 글은 운영자가 확인한 뒤 탐색에 나온다. 쓰던 글은 이 기기에 초안으로 남는다.
 */
import { api } from './redesign-api-adapter.js';
import { navigate, getCurrent } from './redesign-navigation.js';
import { $, el, showToast } from './redesign-ui.js';
import { searchCities } from './redesign-cities.js';
import { sameText } from './redesign-search.js';
import { askConfirm, askForm } from './redesign-dialog.js';

export const LIVED = ['1년 미만', '1~3년', '3~10년', '10년 이상', '나고 자랐어요'];
export const STYLE_LIST = ['가성비', '균형', '프리미엄', '효율', '힐링', '액티비티'];
export const CATS = ['식사', '카페', '시장', '산책', '가게', '볼거리', '저녁'];
const MAX_DAYS = 5, MAX_STOPS = 12, MIN_STOPS = 2;
const DRAFT_KEY = 'tst_local_course_draft_v1';

const blankStop = () => ({ time: '', name: '', cat: '산책', tip: '' });
const blank = () => ({ id: null, city: '', country: '', area: '', lived: '', title: '', concept: '균형', note: '', days: [[blankStop(), blankStop()]], confirm: false });

/** 보내기 전 검사 — 서버와 같은 기준. [칸 이름, 문구] 목록(비어 있으면 통과). */
export function checkCourse(c) {
  const out = [];
  const bad = (v) => /\d{2,4}[-. ]\d{3,4}[-. ]\d{4}|[\w.+-]+@[\w-]+\.\w+/.test(v) ? '전화번호·이메일은 넣을 수 없어요'
    : /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|kr|io|me|shop|link)\b/i.test(v) ? '링크는 넣을 수 없어요' : '';
  const text = (key, v, min, msg) => { const m = v.trim().length < min ? msg : bad(v); if (m) out.push([key, m]); };
  if (!c.city || !c.country) out.push(['city', '목록에서 도시를 골라 주세요']);
  if (bad(c.area || '')) out.push(['area', bad(c.area)]);
  if (!LIVED.includes(c.lived)) out.push(['lived', '살아온 기간을 골라 주세요']);
  text('title', c.title, 4, '제목을 네 글자 이상 적어 주세요');
  text('note', c.note, 10, '한마디를 열 글자 이상 적어 주세요');
  c.days.forEach((d, i) => {
    const filled = d.filter(s => s.name.trim());
    const wrong = filled.map(s => bad(s.name) || bad(s.tip)).find(Boolean);
    if (filled.length < MIN_STOPS) out.push([`day${i}`, `${i + 1}일차에 장소를 ${MIN_STOPS}곳 이상 적어 주세요`]);
    else if (wrong) out.push([`day${i}`, `${i + 1}일차: ${wrong}`]);
  });
  if (!c.confirm) out.push(['confirm', '이 도시에 살고 있거나 살았는지 확인해 주세요']);
  return out;
}

/** 서버로 보낼 형태 — 이름이 빈 줄은 뺀다. */
export function toPayload(c) {
  return {
    city: c.city, country: c.country, area: c.area.trim() || null, lived: c.lived, title: c.title.trim(), concept: c.concept, note: c.note.trim(),
    days: c.days.map(d => d.filter(s => s.name.trim()).map(s => ({ time: s.time || '', name: s.name.trim(), cat: s.cat, tip: s.tip.trim() }))),
    confirm_local: c.confirm,
  };
}

let appState = null;
let c = blank();
let sending = false;
let saveTimer = null;

export function initLocalCourse(state) {
  appState = state;
  if (!$('#localForm')) return;
  _bindCity();
  for (const [id, key] of [['lcArea', 'area'], ['lcTitle', 'title'], ['lcNote', 'note']]) {
    $('#' + id).addEventListener('input', (e) => { c[key] = e.target.value; _clear(key); _count(); _saveDraft(); });
  }
  $('#lcConfirm').addEventListener('change', (e) => { c.confirm = e.target.checked; _clear('confirm'); _saveDraft(); });
  _chips('#lcLived', LIVED, 'lived');
  _chips('#lcStyle', STYLE_LIST, 'concept');
  $('#lcAddDay').addEventListener('click', () => {
    if (c.days.length >= MAX_DAYS) return;
    c.days.push([blankStop(), blankStop()]);
    _paintDays(); _saveDraft();
    $(`#lcDays [data-day="${c.days.length - 1}"] .lc-name`)?.focus();
  });
  $('#localForm').addEventListener('submit', (e) => { e.preventDefault(); _submit(); });
  document.addEventListener('redesign:nav', (e) => { if (e.detail.page === 'local-write') _open(e.detail.meta || {}); });
  document.addEventListener('redesign:auth-ready', () => { if (getCurrent() === 'local-write') _paintGuest(); });
  if (getCurrent() === 'local-write') _open(Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, ''))));
}

/* ---------- 열기 · 초안 ---------- */
async function _open(meta) {
  c = blank();
  if (meta.id) {
    try {
      const mine = await api.myLocalCourses();
      const row = mine.find(x => String(x.id) === String(meta.id));
      if (row) c = { ...blank(), ...row, area: row.area || '', days: row.days.map(d => d.map(s => ({ ...blankStop(), ...s }))), confirm: false };
      else showToast('이 코스를 찾지 못했어요');
    } catch (_) { showToast('코스를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요'); }
  } else {
    const d = _readDraft();
    if (d) c = d;
    if (meta.city && !c.city) { const hit = searchCities(meta.city, 1)[0]; if (hit && sameText(hit.name, meta.city)) _setCity(hit); }
  }
  _paint();
}

function _readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !Array.isArray(d.days) || !d.days.length) return null;
    const b = blank();
    return { ...b, ...d, id: null, days: d.days.slice(0, MAX_DAYS).map(x => (Array.isArray(x) ? x : []).slice(0, MAX_STOPS).map(s => ({ ...blankStop(), ...s }))) };
  } catch (_) { return null; }
}
function _saveDraft() {
  if (c.id) return;                       // 이미 올린 글을 고치는 중이면 초안을 덮어쓰지 않는다
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(c)); } catch (_) {} }, 400);
}
function _dropDraft() { clearTimeout(saveTimer); try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }

/* ---------- 그리기 ---------- */
function _paint() {
  $('#lcHead').textContent = c.id ? '우리 동네 코스 고치기' : '우리 동네 코스 쓰기';
  $('#lcCity').value = c.city ? (c.city === c.country ? c.city : `${c.city} · ${c.country}`) : '';
  $('#lcCityList').hidden = true;
  $('#lcArea').value = c.area; $('#lcTitle').value = c.title; $('#lcNote').value = c.note;
  $('#lcConfirm').checked = c.confirm;
  _markChips('#lcLived', c.lived); _markChips('#lcStyle', c.concept);
  _paintDays(); _count(); _paintGuest();
  $('#lcErrors').hidden = true;
  document.querySelectorAll('#localForm .form-error').forEach(e => { e.hidden = true; });
}
function _paintGuest() {
  const guest = !appState?.currentUser;
  $('#lcSubmit').textContent = guest ? '로그인하고 올리기' : c.id ? '고친 글 올리기' : '올리기';
  $('#lcStatus').textContent = guest ? '올리려면 로그인이 필요해요. 쓰던 글은 이 기기에 남아요.'
    : c.id ? '고친 글은 다시 확인을 받은 뒤 공개돼요. 그동안 탐색에서는 보이지 않아요.' : '';
}
function _count() { $('#lcNoteCount').textContent = `${c.note.length}/400`; }

function _chips(sel, list, key) {
  const box = $(sel);
  box.replaceChildren(...list.map(v => el('button', { type: 'button', class: 'chip', dataset: { v }, 'aria-pressed': 'false',
    onclick: () => { c[key] = v; _markChips(sel, v); _clear(key); _saveDraft(); } }, v)));
}
function _markChips(sel, v) {
  $(sel).querySelectorAll('.chip').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
}

function _paintDays() {
  const box = $('#lcDays');
  box.replaceChildren(...c.days.map((day, di) => el('section', { class: 'lc-day', dataset: { day: String(di) }, 'aria-labelledby': `lcDayH${di}` }, [
    el('div', { class: 'lc-day-head' }, [
      el('h3', { class: 'lc-day-h', id: `lcDayH${di}` }, `${di + 1}일차`),
      c.days.length > 1 ? el('button', { type: 'button', class: 'btn-text', onclick: () => _removeDay(di) }, '이 날 지우기') : null,
    ]),
    el('ol', { class: 'lc-stops' }, day.map((s, si) => _stopRow(s, di, si))),
    el('p', { class: 'form-error', id: `lcErr-day${di}`, role: 'alert', hidden: true }),
    day.length < MAX_STOPS ? el('button', { type: 'button', class: 'btn-text lc-add', onclick: () => {
      day.push(blankStop()); _paintDays(); _saveDraft();
      $(`#lcDays [data-day="${di}"] li:last-child .lc-name`)?.focus();
    } }, '+ 장소 추가') : null,
  ])));
  $('#lcAddDay').hidden = c.days.length >= MAX_DAYS;
}

function _stopRow(s, di, si) {
  const where = `${di + 1}일차 ${si + 1}번째`;
  const set = (key) => (e) => { s[key] = e.target.value; _clear(`day${di}`); _saveDraft(); };
  return el('li', { class: 'lc-stop' }, [
    el('input', { class: 'form-input lc-time', type: 'time', value: s.time, 'aria-label': `${where} 시각(선택)`, oninput: set('time') }),
    el('input', { class: 'form-input lc-name', type: 'text', value: s.name, maxLength: 60, placeholder: '장소 이름', 'aria-label': `${where} 장소 이름`, oninput: set('name') }),
    el('select', { class: 'form-input lc-cat', 'aria-label': `${where} 종류`, onchange: set('cat') }, CATS.map(v => el('option', { value: v, selected: v === s.cat }, v))),
    el('input', { class: 'form-input lc-tip', type: 'text', value: s.tip, maxLength: 120, placeholder: '나만 아는 팁(선택)', 'aria-label': `${where} 팁(선택)`, oninput: set('tip') }),
    el('button', { type: 'button', class: 'lc-del', 'aria-label': `${where} 장소 지우기`, disabled: c.days[di].length <= MIN_STOPS, onclick: () => {
      c.days[di].splice(si, 1); _paintDays(); _saveDraft();
    } }, '×'),
  ]);
}

async function _removeDay(di) {
  if (c.days[di].some(s => s.name.trim()) && !await askConfirm(`${di + 1}일차를 지울까요?\n적은 장소가 함께 지워져요.`, { ok: '지우기', danger: true })) return;
  c.days.splice(di, 1);
  _paintDays(); _saveDraft();
}

/* ---------- 도시 고르기 ---------- */
let cityItems = [], cityAt = -1;
function _setCity(x) { c.city = x.name; c.country = x.country; }
function _bindCity() {
  const input = $('#lcCity'), list = $('#lcCityList');
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); cityAt = -1; };
  const pick = (x) => { _setCity(x); input.value = `${x.name} · ${x.country}`; close(); _clear('city'); _saveDraft(); };
  const mark = () => {
    list.querySelectorAll('[role="option"]').forEach((o, i) => o.setAttribute('aria-selected', String(i === cityAt)));
    if (cityAt >= 0) input.setAttribute('aria-activedescendant', `lcCityOpt${cityAt}`);
  };
  input.addEventListener('input', () => {
    c.city = ''; c.country = ''; _saveDraft();
    cityItems = input.value.trim() ? searchCities(input.value, 6) : [];
    cityAt = -1;
    list.replaceChildren(...cityItems.map((x, i) => el('li', { role: 'option', id: `lcCityOpt${i}`, 'aria-selected': 'false', class: 'lc-city-opt',
      onpointerdown: (e) => { e.preventDefault(); pick(x); } }, [el('b', {}, x.name), el('span', {}, x.country)])));
    list.hidden = !cityItems.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); cityAt = (cityAt + (e.key === 'ArrowDown' ? 1 : -1) + cityItems.length) % cityItems.length; mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cityItems[Math.max(0, cityAt)]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  input.addEventListener('blur', () => {
    // 이름을 끝까지 적고 넘어가면 같은 이름의 도시로 정한다.
    const hit = !c.city && cityItems.find(x => [x.name, ...(x.aliases || [])].some(n => sameText(n, input.value)));
    if (hit) pick(hit); else close();
  });
}

/* ---------- 올리기 ---------- */
function _clear(key) { const e = $(`#lcErr-${key}`); if (e) e.hidden = true; $('#lcErrors').hidden = true; }

async function _submit() {
  if (sending) return;
  const errs = checkCourse(c);
  document.querySelectorAll('#localForm .form-error').forEach(e => { e.hidden = true; });
  errs.forEach(([k, m]) => { const e = $(`#lcErr-${k}`); if (e) { e.textContent = m; e.hidden = false; } });
  const sum = $('#lcErrors');
  sum.hidden = !errs.length;
  if (errs.length) {
    sum.textContent = errs.length > 1 ? `${errs.length}곳을 확인해 주세요.` : errs[0][1];
    const k = errs[0][0];
    const at = $({ city: '#lcCity', area: '#lcArea', lived: '#lcLived .chip', title: '#lcTitle', note: '#lcNote', confirm: '#lcConfirm' }[k] || `#lcDays [data-${k.replace('day', 'day="')}"] .lc-name`);
    at?.scrollIntoView({ block: 'center' }); at?.focus({ preventScroll: true });
    return;
  }
  if (!appState?.currentUser) {
    if (!c.id) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(c)); } catch (_) {} }
    navigate('auth', { meta: { return: 'local-write' } });
    return;
  }
  if (!(await _ensureNickname())) return;
  const nick = appState.currentUser.nickname;
  if (!await askConfirm(`‘${nick}’ 이름으로 올릴까요?\n운영자가 확인한 뒤 누구나 볼 수 있게 공개돼요. 닉네임과 이 화면에 적은 내용만 보여요.`, { ok: '올리기' })) return;
  sending = true;
  const btn = $('#lcSubmit');
  btn.disabled = true; btn.textContent = '올리는 중…';
  try {
    if (c.id) await api.updateLocalCourse(c.id, toPayload(c));
    else await api.createLocalCourse(toPayload(c));
    if (!c.id) _dropDraft();
    c = blank();
    showToast('올렸어요. 확인이 끝나면 탐색에 공개돼요', 3200);
    navigate('my-roadmaps', { replace: true });
  } catch (e) {
    const detail = Array.isArray(e?.body?.detail) ? String(e.body.detail[0]?.msg || '').replace(/^Value error, /, '') : '';
    const msg = e?.status === 401 ? '로그인이 만료됐어요. 다시 로그인하면 이어서 올릴 수 있어요.'
      : e?.status === 409 ? e.message
      : e?.status === 422 ? (detail && /[가-힣]/.test(detail) ? detail : '적은 내용을 다시 확인해 주세요.')
      : e?.status === 429 ? '잠시 뒤 다시 올려 주세요.'
      : '올리지 못했어요. 쓴 글은 이 기기에 남아 있어요. 잠시 뒤 다시 시도해 주세요.';
    sum.textContent = msg; sum.hidden = false;
    sum.scrollIntoView({ block: 'center' });
  } finally {
    sending = false;
    btn.disabled = false;
    if (getCurrent() === 'local-write') _paintGuest();
  }
}

/** 소셜 로그인 계정은 닉네임이 없을 수 있다 — 작성자로 보일 이름을 먼저 정한다. */
async function _ensureNickname() {
  if ((appState.currentUser.nickname || '').trim()) return true;
  const v = await askForm({ title: '작성자 이름을 정해 주세요', text: '코스에 이 닉네임이 보여요.', ok: '정하기',
    fields: [{ name: 'nickname', label: '닉네임', max: 20, check: (x) => x.length < 2 ? '두 글자 이상 적어 주세요' : '' }] });
  if (!v) return false;
  try { appState.currentUser = { ...appState.currentUser, ...(await api.updateMe(v)) }; return true; }
  catch (e) { showToast(e?.status === 409 ? '이미 쓰고 있는 닉네임이에요' : '닉네임을 정하지 못했어요'); return false; }
}

/* ---------- 내가 쓴 코스 ---------- */
const STATUS = { pending: '확인 기다리는 중', approved: '공개 중', rejected: '돌려받음' };

export async function renderMyCourses() {
  const list = $('#myRoadmapsList'), empty = $('#myRoadmapsEmpty');
  if (!list || !empty) return;
  list.replaceChildren();
  const text = empty.querySelector('.empty-text'), btn = empty.querySelector('.btn');
  const showEmpty = (msg, label, to) => { empty.hidden = false; text.textContent = msg; btn.textContent = label; btn.dataset.navTo = to; };
  if (!appState?.currentUser) { showEmpty('내가 쓴 코스를 보려면 로그인해 주세요', '로그인', 'auth'); return; }
  empty.hidden = true;
  try {
    const [mine, old] = await Promise.all([api.myLocalCourses(), api.getRoadmaps({ mine: 'true' }).catch(() => [])]);
    if (!mine.length && !old.length) { showEmpty('아직 쓴 코스가 없어요. 사는 동네의 하루를 알려 주세요.', '우리 동네 코스 쓰기', 'local-write'); return; }
    list.replaceChildren(
      el('button', { type: 'button', class: 'btn btn-soft lc-new', dataset: { navTo: 'local-write' } }, '새 코스 쓰기'),
      ...mine.map(_mineCard),
      ...old.map(r => el('div', { class: 'my-list-card my-list-card--row' }, [
        el('button', { type: 'button', class: 'mlc-open', dataset: { roadmapId: String(r.id) } }, [el('div', { class: 'mlc-body' }, [
          el('div', { class: 'mlc-title' }, r.title), el('div', { class: 'mlc-meta' }, [r.is_public ? '공개 코스' : '비공개', r.city, `${r.days || 1}일`].filter(Boolean).join(' · ')),
        ]), el('span', { class: 'mlc-chev', 'aria-hidden': 'true' }, '›')]),
      ])),
    );
  } catch (e) {
    console.warn('[my-courses]', e?.message);
    showEmpty('쓴 코스를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.', '여행 코스 둘러보기', 'explore');
  }
}

function _mineCard(x) {
  const body = el('div', { class: 'mlc-body' }, [
    el('div', { class: 'mlc-title' }, x.title),
    el('div', { class: 'mlc-meta' }, [el('b', { class: `lc-status is-${x.status}` }, STATUS[x.status] || x.status), ` · ${x.city} · ${x.days.length}일`]),
    x.status === 'rejected' && x.review_note ? el('div', { class: 'mlc-meta' }, `돌려받은 이유: ${x.review_note}`) : null,
  ]);
  return el('div', { class: 'my-list-card my-list-card--row' }, [
    x.status === 'approved'
      ? el('button', { type: 'button', class: 'mlc-open', dataset: { roadmapId: `l${x.id}` } }, [body, el('span', { class: 'mlc-chev', 'aria-hidden': 'true' }, '›')])
      : el('div', { class: 'mlc-open' }, [body]),
    el('div', { class: 'mlc-actions' }, [
      el('button', { type: 'button', class: 'btn-text', onclick: () => navigate('local-write', { meta: { id: String(x.id) } }) }, '고치기'),
      el('button', { type: 'button', class: 'btn-text is-danger', onclick: async () => {
        if (!await askConfirm(`‘${x.title}’ 코스를 지울까요?\n지우면 되돌릴 수 없어요.`, { ok: '지우기', danger: true })) return;
        try { await api.deleteLocalCourse(x.id); showToast('지웠어요'); renderMyCourses(); }
        catch (_) { showToast('지우지 못했어요. 다시 시도해 주세요'); }
      } }, '지우기'),
    ]),
  ]);
}
