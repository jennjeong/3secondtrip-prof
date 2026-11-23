/* 3초 여행 — 피드백
 *  - 서버 형식(feedback_type · title · content)으로 보낸다.
 *  - 스크린샷: 미리보기와 삭제, 보내기 전에 줄여서(JPEG, 700KB 이하) 함께 보낸다.
 *  - 쓰는 중인 내용은 초안으로 이 기기에 남기고, 전송에 실패해도 지우지 않는다.
 */

import { api } from './redesign-api-adapter.js';
import { $, showToast, setActiveByData } from './redesign-ui.js';

const LOCAL_KEY = 'tst_feedback_log_v1';
const DRAFT_KEY = 'tst_feedback_draft_v1';
const MAX_BYTES = 700 * 1024;
const MAX_SIDE = 1600;

let fbType = 'bug';
let shot = null;          // { b64, mime, size, url }
let draftTimer = null;
let sending = false;

export function initFeedback() {
  $('#feedbackTypes')?.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-fb-type]');
    if (!b) return;
    fbType = b.dataset.fbType;
    setActiveByData($('#feedbackTypes'), 'data-fb-type', fbType);
    _queueDraft();
  });
  $('#fbTitle')?.addEventListener('input', _queueDraft);
  $('#fbBody')?.addEventListener('input', _queueDraft);
  $('#fbScreenshot')?.addEventListener('change', _onFile);
  $('#fbRemoveShot')?.addEventListener('click', () => { _clearShot(); $('#fbScreenshot')?.focus(); });
  $('#feedbackForm')?.addEventListener('submit', (e) => { e.preventDefault(); _submit(); });
  _restoreDraft();
}

/* ============ 초안 ============ */
function _queueDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(_saveDraft, 400);
}
function _saveDraft() {
  const d = { type: fbType, title: $('#fbTitle')?.value || '', body: $('#fbBody')?.value || '' };
  try {
    if (!d.title && !d.body) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch (_) {}
  const note = $('#fbDraftNote');
  if (note) note.textContent = (d.title || d.body) ? '쓰던 내용은 이 기기에 초안으로 남겨 둘게요' : '';
}
function _restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d) return;
    if (d.type) { fbType = d.type; setActiveByData($('#feedbackTypes'), 'data-fb-type', fbType); }
    if (d.title) $('#fbTitle').value = d.title;
    if (d.body) $('#fbBody').value = d.body;
    const note = $('#fbDraftNote');
    if (note && (d.title || d.body)) note.textContent = '이전에 쓰던 내용을 불러왔어요';
  } catch (_) {}
}

/* ============ 스크린샷 ============ */
async function _onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    showToast('JPEG·PNG·WebP 이미지만 첨부할 수 있어요');
    e.target.value = '';
    return;
  }
  try {
    shot = await _shrink(file);
  } catch (_) {
    showToast('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요');
    e.target.value = '';
    return;
  }
  if (shot.size > MAX_BYTES) {
    showToast('이미지가 너무 커요. 더 작은 스크린샷을 골라 주세요');
    _clearShot();
    return;
  }
  $('#fbPreviewImg').src = shot.url;
  $('#fbPreviewInfo').textContent = `${file.name} · ${Math.round(shot.size / 1024)}KB로 줄여서 보내요`;
  $('#fbPreview').hidden = false;
}

function _clearShot() {
  if (shot?.url) URL.revokeObjectURL(shot.url);
  shot = null;
  const inp = $('#fbScreenshot'); if (inp) inp.value = '';
  const pv = $('#fbPreview'); if (pv) pv.hidden = true;
  const img = $('#fbPreviewImg'); if (img) img.removeAttribute('src');
}

/** 긴 변 1600px, JPEG 품질을 낮춰 가며 700KB 이하로 만든다. */
async function _shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  let blob = null;
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
    if (blob && blob.size <= MAX_BYTES) break;
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), mime: 'image/jpeg', size: blob.size, url: URL.createObjectURL(blob) };
}

/* ============ 전송 ============ */
async function _submit() {
  if (sending) return;
  const title = $('#fbTitle').value.trim();
  const content = $('#fbBody').value.trim();
  if (!content) { showToast('내용을 입력해 주세요'); $('#fbBody').focus(); return; }

  const payload = { feedback_type: fbType, title: title || null, content };
  if (shot) { payload.attachment_b64 = shot.b64; payload.attachment_mime = shot.mime; }

  const status = $('#feedbackStatus');
  const btn = $('#fbSend');
  sending = true;
  if (btn) { btn.disabled = true; btn.textContent = '보내는 중…'; }
  status.textContent = '보내는 중…';
  _saveDraft();   // 실패해도 남도록 먼저 초안을 저장한다
  try {
    const res = await api.saveFeedback(payload);
    if (!res) throw Object.assign(new Error('unavailable'), { status: 503 });
    // 성공 — 기기 사본(첨부 제외)을 남기고 초안을 지운다
    try {
      const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      arr.push({ type: fbType, title, content, hadScreenshot: !!shot, sentAt: new Date().toISOString(), id: res.id });
      localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(-30)));
      localStorage.removeItem(DRAFT_KEY);
    } catch (_) {}
    status.textContent = '보냈어요. 소중한 의견 고마워요!';
    showToast('피드백을 보냈어요');
    $('#fbTitle').value = ''; $('#fbBody').value = '';
    _clearShot();
    const note = $('#fbDraftNote'); if (note) note.textContent = '';
  } catch (e) {
    status.textContent = e?.status === 429 ? '잠시 뒤 다시 보내 주세요(짧은 시간에 너무 많이 보냈어요). 쓴 내용과 첨부는 그대로 있어요.'
      : e?.status === 413 || e?.status === 422 ? (e.message && !/^HTTP/.test(e.message) ? e.message : '보낼 수 없는 내용이 있어요.') + ' 쓴 내용은 그대로 있어요.'
      : '보내지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. 쓴 내용과 첨부는 그대로 있어요.';
    showToast('보내지 못했어요 · 내용은 그대로 있어요');
  } finally {
    sending = false;
    if (btn) { btn.disabled = false; btn.textContent = '전송'; }
  }
}
