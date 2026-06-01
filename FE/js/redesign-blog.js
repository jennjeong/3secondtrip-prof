/* 3초 여행 — Redesign Blog
 * Local-first writer.  Drafts persist in localStorage so users can come
 * back later.  On Publish we call api.saveBlog() which tolerates 404/501
 * (backend stub may not exist yet).
 */

import { api } from './redesign-api-adapter.js';
import { $, $$, el, showToast, setActiveByData } from './redesign-ui.js';
import { navigate } from './redesign-navigation.js';

const DRAFT_KEY = 'tst_blog_draft_v1';
let appState = null;
let visibility = 'public';

export function initBlog(state) {
  appState = state;

  $('#blogTags')?.addEventListener('input', _renderTags);
  $('#blogVisRow')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-blog-vis]');
    if (!b) return;
    visibility = b.dataset.blogVis;
    setActiveByData($('#blogVisRow'), 'data-blog-vis', visibility);
  });

  $('#blogDraft')?.addEventListener('click', _saveDraft);
  $('#blogForm')?.addEventListener('submit', (e) => { e.preventDefault(); _publish(); });

  _restoreDraft();
}

function _renderTags() {
  const raw = ($('#blogTags').value || '').trim();
  const wrap = $('#blogTagPreview');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!raw) return;
  raw.split(/[,\s]+/).filter(Boolean).forEach(t => {
    wrap.appendChild(el('span', { class: 'tag-item' }, '#' + t.replace(/^#/, '')));
  });
}

function _payload() {
  return {
    title: $('#blogTitle').value.trim(),
    tags: ($('#blogTags').value || '').split(/[,\s]+/).filter(Boolean),
    body: $('#blogBody').value,
    visibility,
    savedAt: new Date().toISOString(),
  };
}

function _saveDraft() {
  const p = _payload();
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(p)); } catch (_) {}
  $('#blogStatus').textContent = '초안이 저장되었어요 · ' + new Date().toLocaleTimeString('ko-KR');
  showToast('초안 저장 완료');
}

function _restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.title) $('#blogTitle').value = p.title;
    if (p.tags?.length) $('#blogTags').value = p.tags.join(', ');
    if (p.body) $('#blogBody').value = p.body;
    if (p.visibility) { visibility = p.visibility; setActiveByData($('#blogVisRow'), 'data-blog-vis', visibility); }
    _renderTags();
  } catch (_) {}
}

async function _publish() {
  const p = _payload();
  if (!p.title) { showToast('제목을 입력해 주세요'); return; }
  if (!p.body || p.body.length < 20) { showToast('본문을 좀 더 작성해 주세요 (20자 이상)'); return; }
  $('#blogStatus').textContent = '발행 중...';
  const res = await api.saveBlog(p);
  if (res) {
    $('#blogStatus').textContent = '발행 완료! 마이페이지에서 확인하세요.';
    showToast('블로그가 발행되었어요');
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    navigate('my');
  } else {
    $('#blogStatus').textContent = '백엔드가 준비 중이에요. 초안은 안전하게 저장돼요.';
    _saveDraft();
  }
}
