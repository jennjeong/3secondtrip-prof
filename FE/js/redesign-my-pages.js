/* 3초 여행 — My Page sub-lists
 *
 *  4 pages, all keyed off the My tile clicks:
 *    my-saved      — saved schedules (api.listSchedules + filter is_saved)
 *    my-roadmaps   — 내가 쓴 코스 (redesign-local-course.js)
 *    my-reviews    — user's own reviews (api.listReviews mine=true)
 *    my-blogs      — user's own blogs incl. drafts (api.listBlogs mine=true)
 *
 *  Each page handles login-required, loading, empty, and error states
 *  uniformly.  All endpoints are tolerant of missing backend support
 *  so the UI stays usable even if a feature isn't wired yet.
 */
import { api, API_URL } from './redesign-api-adapter.js';
import { navigate, getCurrent } from './redesign-navigation.js';
import { $, $$, el, showToast, formatCurrency } from './redesign-ui.js';
import { renderMyCourses } from './redesign-local-course.js';
import { askConfirm, askForm } from './redesign-dialog.js';

let appState = null;

export function initMyPages(state) {
  appState = state;

  const render = (page) => {
    switch (page) {
      case 'my-saved':    renderMySaved();    break;
      case 'my-roadmaps': renderMyCourses(); break;
      case 'my-reviews':  renderMyReviews();  break;
      case 'my-blogs':    renderMyBlogs();    break;
    }
  };
  document.addEventListener('redesign:auth-ready', () => { render(getCurrent()); if (getCurrent() === 'my') _paintMyHome(); });
  document.addEventListener('redesign:nav', (e) => { if (e.detail.page === 'my') _paintMyHome(); });
  // Render the right page when user arrives via nav
  document.addEventListener('redesign:nav', (e) => {
    switch (e.detail.page) {
      case 'my-saved':    renderMySaved();    break;
      case 'my-roadmaps': renderMyCourses(); break;
      case 'my-reviews':  renderMyReviews();  break;
      case 'my-blogs':    renderMyBlogs();    break;
    }
  });
}

/** 마이 첫 화면 — 다시 찾는 항목(저장한 일정·내가 만든 일정)에 현재 상태를 붙인다. */
let _countSeq = 0;
async function _paintMyHome() {
  const g = appState?.generated;
  const trip = $('#myTripMeta');
  if (trip) trip.textContent = g?.days?.length
    ? `${g.title || g.city} · ${g.days[0].date.slice(5).replace('-', '/')}~${g.days.at(-1).date.slice(5).replace('-', '/')}`
    : '아직 없어요';
  const saved = $('#mySavedMeta');
  if (!saved) return;
  if (!appState?.currentUser) { saved.textContent = appState?.authOffline ? '연결 확인 중' : '로그인하면 보여요'; return; }
  const seq = ++_countSeq;
  try {
    const rows = await api.listSchedules();
    if (seq !== _countSeq) return;
    const n = (rows || []).filter(r => r.is_saved).length;
    saved.textContent = n ? `${n}개` : '아직 없어요';
  } catch (_) { if (seq === _countSeq) saved.textContent = '불러오지 못함'; }
}

function _requireLogin(emptyId, msg) {
  if (appState?.currentUser) return false;
  const empty = $('#' + emptyId);
  if (empty) {
    empty.hidden = false;
    empty.querySelector('.empty-text').textContent = msg || '로그인 후 이용해주세요';
    const btn = empty.querySelector('.btn');
    if (btn) {
      btn.textContent = '로그인 하러 가기';
      btn.dataset.navTo = 'auth';
      btn.dataset.metaReturn = getCurrent() || 'my';
    }
  }
  return true;
}

function _showState(listId, emptyId, items, renderItem) {
  const list  = $('#' + listId);
  const empty = $('#' + emptyId);
  if (!list || !empty) return;
  list.innerHTML = '';
  if (!items || items.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  items.forEach(it => {
    const node = renderItem(it);
    if (node) list.appendChild(node);
  });
}

function _fmtDate(iso) {
  if (!iso) return '';
  return iso.slice(0, 10).replace(/-/g, '.');
}

/* ============ 1) SAVED SCHEDULES ============
 * 계정에 저장한 일정(/schedules, is_saved)을 최근 수정순으로 보여 준다.
 * 저장 해제한 일정은 아래 '저장 해제한 일정'에서 되살리거나 완전히 지울 수 있다.
 * 예전 버전이 /trips 에 남긴 일정도 불러올 수 있게 함께 보여 준다. */
function _days(data) {
  return Array.isArray(data?.days) ? data.days : [];
}
function _dateOf(s) { return s.updated_at || s.created_at || ''; }

async function _openSchedule(data, savedId, title) {
  if (!_days(data).length) { showToast('이 일정은 날짜별 데이터가 없어 열 수 없어요'); return; }
  const cur = appState.generated;
  if (cur?.days?.length && !cur.savedScheduleId && !cur.sharedView && String(savedId || '') !== String(cur.savedScheduleId || '')) {
    const ok = await askConfirm(`이 기기에만 있는 일정이 있어요\n${cur.city || ''} 일정은 계정에 저장하지 않았어요. 다른 일정을 열면 이 기기에서 사라져요.`, { ok: '그래도 열기', cancel: '취소', danger: true });
    if (!ok) return;
  }
  appState.generated = { ...data, savedScheduleId: savedId || null };
  if (title) appState.generated.title = title;
  delete appState.generated.sharedView;
  appState.expenses = {};
  document.dispatchEvent(new CustomEvent('redesign:trip-changed'));
  navigate('schedule');
}

export async function renderMySaved() {
  const list = $('#mySavedList');
  const empty = $('#mySavedEmpty');
  const extra = $('#mySavedExtra');
  if (!list || !empty) return;
  list.replaceChildren(); if (extra) extra.replaceChildren();
  const here = appState?.generated;
  const deviceCard = here && _days(here).length ? el('div', { class: 'device-trip' }, [
    el('p', { class: 'my-sub-h' }, '이 기기의 일정'),
    _card({ title: here.title || `${here.city} ${_days(here).length}일`, data: here, meta: here.savedScheduleId ? '계정에도 보관됨' : '이 기기에만 있음' },
      () => navigate('schedule'), []),
  ]) : null;

  if (!appState?.currentUser) {
    empty.hidden = false;
    empty.querySelector('.empty-text').textContent = '계정에 보관한 일정은 로그인하면 보여요. 이 기기의 일정은 로그인 없이도 위에서 열 수 있어요.';
    const btn = empty.querySelector('.btn'); if (btn) { btn.textContent = '로그인'; btn.dataset.navTo = 'auth'; }
    if (deviceCard) list.appendChild(deviceCard);
    return;
  }
  list.appendChild(el('p', { class: 'my-loading', role: 'status' }, '불러오는 중…'));
  let rows = [], legacy = [];
  try {
    rows = await api.listSchedules();
  } catch (e) {
    list.replaceChildren(el('div', { class: 'empty-state' }, [
      el('p', { class: 'empty-text' }, '계정에 보관한 일정을 불러오지 못했어요. 이 기기의 일정은 그대로 열 수 있어요.'),
      el('button', { type: 'button', class: 'btn btn-soft', onclick: renderMySaved }, '다시 시도'),
    ]));
    return;
  }
  try { legacy = (await api.listTrips()) || []; } catch (_) { legacy = []; }
  rows = (Array.isArray(rows) ? rows : []).sort((a, b) => _dateOf(b).localeCompare(_dateOf(a)));
  const saved = rows.filter(s => s.is_saved);
  const removed = rows.filter(s => !s.is_saved);
  const oldOnes = legacy.filter(t => _days(t.trip_data).length);

  list.replaceChildren();
  empty.hidden = saved.length > 0;
  if (!saved.length) {
    empty.querySelector('.empty-text').textContent = '아직 계정에 보관한 일정이 없어요. 내 일정에서 하트를 누르면 여기에 모여요.';
    const btn = empty.querySelector('.btn'); if (btn) { btn.textContent = '내 일정 보기'; btn.dataset.navTo = 'schedule'; }
  } else {
    list.appendChild(el('p', { class: 'my-sub-h' }, `계정에 보관한 일정 ${saved.length}개 · 최근 수정순`));
    saved.forEach(s => list.appendChild(_savedCard(s)));
  }
  if (!extra) return;
  if (deviceCard && !saved.some(s => s.id === here.savedScheduleId)) extra.appendChild(deviceCard);
  if (removed.length) {
    extra.appendChild(el('details', { class: 'my-removed' }, [
      el('summary', {}, `저장 해제한 일정 ${removed.length}개`),
      ...removed.map(s => _card({ title: s.title, data: s.schedule_data, meta: '저장 해제 · ' + _fmtDate(_dateOf(s)) }, null, [
        el('button', { type: 'button', class: 'btn-text', onclick: async () => {
          try { await api.saveSchedule(s.id); showToast('다시 저장했어요'); renderMySaved(); }
          catch (_) { showToast('되살리지 못했어요. 다시 시도해 주세요'); }
        } }, '되살리기'),
        el('button', { type: 'button', class: 'btn-text is-danger', onclick: async () => {
          if (!await askConfirm(`‘${s.title || '이 일정'}’을 완전히 지울까요?\n지우면 되살릴 수 없어요.`, { ok: '지우기', danger: true })) return;
          try { await api.deleteSchedule(s.id); showToast('완전히 지웠어요'); renderMySaved(); }
          catch (_) { showToast('지우지 못했어요. 다시 시도해 주세요'); }
        } }, '완전히 삭제'),
      ])),
    ]));
  }
  if (oldOnes.length) {
    extra.appendChild(el('details', { class: 'my-removed' }, [
      el('summary', {}, `이전 버전에서 저장한 일정 ${oldOnes.length}개`),
      ...oldOnes.map(t => _card({ title: t.title, data: t.trip_data, meta: '이전 버전 · ' + _fmtDate(t.updated_at || t.created_at) },
        () => _openSchedule(t.trip_data, null, t.title), [])),
    ]));
  }
}

function _card({ title, data, meta }, onOpen, actions) {
  const city = data?.city || '여행';
  const n = _days(data).length;
  const body = [
    el('div', { class: 'mlc-title' }, title || `${city} ${n}일`),
    el('div', { class: 'mlc-meta' }, [city, n ? (n > 1 ? `${n - 1}박 ${n}일` : '당일치기') : '', meta].filter(Boolean).join(' · ')),
  ];
  return el('div', { class: 'my-list-card my-list-card--row' }, [
    onOpen ? el('button', { type: 'button', class: 'mlc-open', onclick: onOpen }, [el('div', { class: 'mlc-body' }, body), el('span', { class: 'mlc-chev', 'aria-hidden': 'true' }, '›')])
      : el('div', { class: 'mlc-open' }, [el('div', { class: 'mlc-body' }, body)]),
    actions.length ? el('div', { class: 'mlc-actions' }, actions) : null,
  ]);
}

function _savedCard(s) {
  const data = s.schedule_data || {};
  return _card({ title: s.title, data, meta: '수정 ' + _fmtDate(_dateOf(s)) }, () => _openSchedule(data, s.id, s.title), [
    el('button', { type: 'button', class: 'btn-text', onclick: async () => {
      const v = await askForm({ title: '일정 이름 바꾸기', ok: '바꾸기', fields: [{ name: 'title', label: '새 이름', value: s.title || '', max: 80, check: (x) => x ? '' : '이름을 입력해 주세요' }] });
      if (!v) return;
      const { title } = v;
      try {
        await api.updateSchedule(s.id, { title });
        if (appState.generated?.savedScheduleId === s.id) { appState.generated.title = title; document.dispatchEvent(new CustomEvent('redesign:trip-changed')); }
        showToast('이름을 바꿨어요'); renderMySaved();
      } catch (_) { showToast('이름을 바꾸지 못했어요'); }
    } }, '이름 바꾸기'),
    el('button', { type: 'button', class: 'btn-text is-danger', onclick: async () => {
      if (!await askConfirm(`‘${s.title || '이 일정'}’을 저장 목록에서 뺄까요?\n아래 ‘저장 해제한 일정’에서 되살릴 수 있어요.`, { ok: '빼기' })) return;
      try {
        await api.unsaveSchedule(s.id);
        if (appState.generated?.savedScheduleId === s.id) { appState.generated.savedScheduleId = null; document.dispatchEvent(new CustomEvent('redesign:trip-changed')); }
        showToast('저장 목록에서 뺐어요'); renderMySaved();
      } catch (_) { showToast('저장 해제에 실패했어요'); }
    } }, '저장 해제'),
  ]);
}

/* ============ 3) MY REVIEWS ============ */
export async function renderMyReviews() {
  if (_requireLogin('myReviewsEmpty', '내 후기를 보려면 로그인 해주세요')) return;
  try {
    const rows = await api.listReviews?.({ mine: 'true' }) ?? [];
    _showState('myReviewsList', 'myReviewsEmpty', rows, _reviewItem);
  } catch (e) {
    showToast('후기를 불러오지 못했어요');
    console.warn('[my-reviews]', e);
  }
}

function _reviewItem(r) {
  const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
  const tags = (r.concept_tags || []).join(' · ');
  const act = (label, fn, danger) => el('button', { type: 'button', class: 'btn-text' + (danger ? ' is-danger' : ''), onclick: fn }, label);
  return el('div', { class: 'my-list-card my-list-card--row' }, [
    el('div', { class: 'mlc-open' }, [el('div', { class: 'mlc-body' }, [
      el('div', { class: 'mlc-stars', 'aria-label': `별점 5점 중 ${r.rating}점`, role: 'img' }, stars),
      el('div', { class: 'mlc-title' }, r.content || '(내용 없음)'),
      el('div', { class: 'mlc-meta' }, [r.is_public ? '공개' : '나만 보기', r.city, tags, _fmtDate(r.created_at)].filter(Boolean).join(' · ')),
    ])]),
    el('div', { class: 'mlc-actions' }, [
      act('내용 고치기', async () => {
        const v = await askForm({ title: '후기 고치기', ok: '저장', fields: [
          { name: 'rating', label: '별점', type: 'stars', value: r.rating || 5 },
          { name: 'content', label: '내용', type: 'textarea', value: r.content || '', check: (x) => x.length < 3 ? '세 글자 이상 적어 주세요' : '' },
        ] });
        if (!v) return;
        try { await api.updateReview(r.id, v); showToast('후기를 고쳤어요'); renderMyReviews(); }
        catch (_) { showToast('고치지 못했어요. 다시 시도해 주세요'); }
      }),
      act(r.is_public ? '나만 보기로 바꾸기' : '공개로 바꾸기', async () => {
        try { await api.updateReview(r.id, { is_public: !r.is_public }); showToast(r.is_public ? '나만 보는 후기로 바꿨어요' : '공개 후기로 바꿨어요'); renderMyReviews(); }
        catch (_) { showToast('바꾸지 못했어요. 다시 시도해 주세요'); }
      }),
      act('삭제', async () => {
        if (!await askConfirm('이 후기를 삭제할까요?\n삭제하면 되돌릴 수 없어요.', { ok: '삭제', danger: true })) return;
        try { await api.deleteReview(r.id); showToast('삭제했어요'); renderMyReviews(); }
        catch (_) { showToast('삭제하지 못했어요. 다시 시도해 주세요'); }
      }, true),
    ]),
  ]);
}

/* ============ 4) MY BLOGS ============ */
export async function renderMyBlogs() {
  if (_requireLogin('myBlogsEmpty', '내 블로그를 보려면 로그인 해주세요')) return;
  try {
    const rows = await api.listBlogs?.({ mine: 'true' }) ?? [];
    _showState('myBlogsList', 'myBlogsEmpty', rows, _blogItem);
  } catch (e) {
    showToast('블로그를 불러오지 못했어요');
    console.warn('[my-blogs]', e);
  }
}

function _blogItem(b) {
  const visBadge = b.is_draft ? '초안' :
    ({ public: '공개', link: '링크', private: '비공개' })[b.visibility] || '공개';
  const tags = (b.tags || []).slice(0, 3).map(t => '#' + t).join(' ');
  return el('button', {
    type: 'button',
    class: 'my-list-card my-list-card--blog',
    onclick: () => {
      // Pass blog id via nav meta — blog page can pre-fill if it wants.
      // For now, just navigate so the user sees the write page.
      navigate('blog', { meta: { blogId: String(b.id) } });
    },
  }, [
    el('div', { class: 'mlc-icon' }, '✏️'),
    el('div', { class: 'mlc-body' }, [
      el('div', { class: 'mlc-title' }, b.title),
      el('div', { class: 'mlc-meta' },
        [visBadge, tags, _fmtDate(b.created_at)].filter(Boolean).join(' · ')),
    ]),
    el('span', { class: 'mlc-chev', ariaHidden: 'true' }, '›'),
  ]);
}
