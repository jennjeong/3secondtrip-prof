/* 3초 여행 — Redesign Feedback
 * Sends user feedback to the backend stub.  Stores a local copy as a
 * defensive fallback so reports are never lost.
 */

import { api } from './redesign-api-adapter.js';
import { $, showToast, setActiveByData } from './redesign-ui.js';

const LOCAL_KEY = 'tst_feedback_log_v1';
let fbType = 'bug';

export function initFeedback() {
  $('#feedbackTypes')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-fb-type]');
    if (!b) return;
    fbType = b.dataset.fbType;
    setActiveByData($('#feedbackTypes'), 'data-fb-type', fbType);
  });

  $('#feedbackForm')?.addEventListener('submit', (e) => { e.preventDefault(); _submit(); });
}

async function _submit() {
  const title = $('#fbTitle').value.trim();
  const body  = $('#fbBody').value.trim();
  if (!title || !body) { showToast('제목과 내용을 입력해 주세요'); return; }

  const file = $('#fbScreenshot')?.files?.[0] || null;
  let screenshotName = null;
  if (file) screenshotName = file.name;

  const payload = { type: fbType, title, body, screenshotName, ua: navigator.userAgent, sentAt: new Date().toISOString() };

  // Local copy first — never lose a report
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    arr.push(payload);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(-30)));
  } catch (_) {}

  $('#feedbackStatus').textContent = '전송 중...';
  const res = await api.saveFeedback(payload);
  if (res) {
    $('#feedbackStatus').textContent = '소중한 의견 감사합니다!';
    showToast('피드백이 전송되었어요');
  } else {
    $('#feedbackStatus').textContent = '백엔드가 준비 중이에요. 로컬에 안전하게 보관됩니다.';
    showToast('로컬에 보관했어요');
  }
  // Reset
  $('#fbTitle').value = ''; $('#fbBody').value = ''; if ($('#fbScreenshot')) $('#fbScreenshot').value = '';
}
