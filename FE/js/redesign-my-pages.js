/* 3초 여행 — My Page sub-lists
 *
 *  4 pages, all keyed off the My tile clicks:
 *    my-saved      — saved schedules (api.listSchedules + filter is_saved)
 *    my-roadmaps   — user's own roadmaps (api.getRoadmaps mine=true)
 *    my-reviews    — user's own reviews (api.listReviews mine=true)
 *    my-blogs      — user's own blogs incl. drafts (api.listBlogs mine=true)
 *
 *  Each page handles login-required, loading, empty, and error states
 *  uniformly.  All endpoints are tolerant of missing backend support
 *  so the UI stays usable even if a feature isn't wired yet.
 */
import { api, API_URL } from './redesign-api-adapter.js';
import { navigate } from './redesign-navigation.js';
import { $, $$, el, showToast, formatCurrency } from './redesign-ui.js';

let appState = null;

export function initMyPages(state) {
  appState = state;

  // Render the right page when user arrives via nav
  document.addEventListener('redesign:nav', (e) => {
    switch (e.detail.page) {
      case 'my-saved':    renderMySaved();    break;
      case 'my-roadmaps': renderMyRoadmaps(); break;
      case 'my-reviews':  renderMyReviews();  break;
      case 'my-blogs':    renderMyBlogs();    break;
    }
  });
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

/* ============ 1) SAVED SCHEDULES ============ */
export async function renderMySaved() {
  if (_requireLogin('mySavedEmpty', '저장한 일정을 보려면 로그인 해주세요')) return;
  try {
    const rows = await api.listSchedules?.() ?? [];
    const saved = (Array.isArray(rows) ? rows : []).filter(s => s.is_saved);
    _showState('mySavedList', 'mySavedEmpty', saved, _savedCard);
  } catch (e) {
    showToast('일정 목록을 불러오지 못했어요');
    console.warn('[my-saved]', e);
  }
}

function _savedCard(s) {
  // schedule_data was stored as JSON object by our backend
  const data = s.schedule_data || {};
  const city = data.city || '여행';
  const days = (data.days?.length ?? 0);
  return el('button', {
    type: 'button',
    class: 'my-list-card',
    onclick: () => {
      // load this schedule into app state, then navigate to schedule page
      appState.generated = data;
      appState.expenses  = {};
      navigate('schedule');
    },
  }, [
    el('div', { class: 'mlc-icon' }, '💾'),
    el('div', { class: 'mlc-body' }, [
      el('div', { class: 'mlc-title' }, s.title || `${city} ${days}일`),
      el('div', { class: 'mlc-meta' }, `${city} · ${days}일 · ${_fmtDate(s.created_at)}`),
    ]),
    el('span', { class: 'mlc-chev', ariaHidden: 'true' }, '›'),
  ]);
}

/* ============ 2) MY ROADMAPS ============ */
export async function renderMyRoadmaps() {
  if (_requireLogin('myRoadmapsEmpty', '내 로드맵을 보려면 로그인 해주세요')) return;
  try {
    const rows = await api.getRoadmaps?.({ mine: 'true' }) ?? [];
    _showState('myRoadmapsList', 'myRoadmapsEmpty', rows, _roadmapCard);
  } catch (e) {
    showToast('로드맵을 불러오지 못했어요');
    console.warn('[my-roadmaps]', e);
  }
}

function _roadmapCard(r) {
  return el('button', {
    type: 'button',
    class: 'roadmap-card',
    style: { background: r.gradient || 'linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)' },
    dataset: { roadmapId: r.id },
  }, [
    el('div', { class: 'rc-top' }, [
      el('span', { class: 'rc-concept-badge' }, r.concept || '-'),
      el('span', { class: 'rc-likes' }, '♥ ' + (r.likes || 0)),
    ]),
    el('div', { class: 'rc-bottom' }, [
      el('div', { class: 'rc-city' }, r.city || r.title),
      el('div', { class: 'rc-tagline' }, r.title),
      el('div', { class: 'rc-days' }, (r.days || 1) + '일'),
    ]),
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
  return el('div', { class: 'my-list-card my-list-card--review' }, [
    el('div', { class: 'mlc-stars' }, stars),
    el('div', { class: 'mlc-body' }, [
      el('div', { class: 'mlc-title' }, r.content || '(내용 없음)'),
      el('div', { class: 'mlc-meta' },
        [r.city, tags, _fmtDate(r.created_at)].filter(Boolean).join(' · ')),
    ]),
    el('button', {
      type: 'button',
      class: 'mlc-delete',
      title: '삭제',
      onclick: async (e) => {
        e.stopPropagation();
        if (!confirm('이 후기를 삭제할까요?')) return;
        try {
          await api.deleteReview?.(r.id) ?? null;
          showToast('삭제했어요');
          renderMyReviews();
        } catch (_) {
          showToast('삭제 실패');
        }
      },
    }, '✕'),
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
