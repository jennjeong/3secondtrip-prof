/* 3초 여행 — Redesign Collab
 * 링크를 아는 사람끼리 같은 일정을 고친다.
 * 실시간 연결 대신 몇 초마다 확인한다(무료 서버는 잠들기 때문).
 * 토큰은 URL 해시로만 주고받아 서버 로그나 Referer 에 남지 않게 한다.
 */

import { api, trackEvent } from './redesign-api-adapter.js';
import { $, el, showToast } from './redesign-ui.js';
import { publicLink } from './redesign-native.js';
import { askConfirm, showCopy } from './redesign-dialog.js';

const TOKEN_KEY = 'tst_collab_v1';
const MANAGE_KEY = 'tst_collab_manage_v1';   // 내가 만든 링크의 관리 키(회수용) — 이 기기에만 둔다
const POLL_MS = 8000;
const SAVE_DELAY_MS = 1500;

let appState = null;
let rerender = () => {};
let token = null;
let version = 0;
let lastSynced = '';
let saveTimer = null;
let pollTimer = null;
let saving = false;
let sharedObj = null;     // 함께 편집 중인 일정 객체 — 다른 일정을 열면 올리지 않고 멈춘다
let failNoted = false;
let readOnly = false;     // 보기 전용 링크로 연 일정 — 받아서 보기만 하고 올리지 않는다
const VIEW_KEY = 'tst_collab_view_v1';   // 내가 만든 링크의 보기 전용 토큰

// 기기마다 다른 값(내 계정의 저장 번호)은 공유 데이터에 싣지 않는다 — 실으면 받은 사람 계정에 사본이 계속 생긴다.
function _strip(g) {
  if (!g) return g;
  const { savedScheduleId, sharedView, ...rest } = g;
  return rest;
}
function _json(g) { return JSON.stringify(_strip(g)); }
/** 지금 화면의 일정이 함께 편집 중인 그 여행인가(다시 만들기는 같은 여행 번호를 이어받는다). */
function _sameTrip(g) {
  if (!g || !sharedObj) return false;
  if (g === sharedObj) return true;
  return !!(g.tripUid && g.tripUid === sharedObj.tripUid);
}
function _editing() { const s = document.getElementById('editSheet'); return !!(s && !s.hidden); }

function _setToken(value, manageKey) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    if (manageKey) localStorage.setItem(MANAGE_KEY, JSON.stringify({ token: value, key: manageKey }));
    else if (!value) localStorage.removeItem(MANAGE_KEY);
  } catch (_) {}
}
function _manageKey() {
  try {
    const m = JSON.parse(localStorage.getItem(MANAGE_KEY) || 'null');
    return m && m.token === token ? m.key : null;
  } catch (_) { return null; }
}

async function _revoke() {
  const key = _manageKey();
  if (!token || !key) return;
  if (!await askConfirm('편집 링크를 회수할까요?\n받은 사람은 더 이상 이 링크로 일정을 보거나 고칠 수 없어요. 내 기기의 일정은 그대로 남아요.', { ok: '회수', danger: true })) return;
  try {
    await api.revokeSharedTrip(token, key);
    trackEvent('collab_revoked');
    _stop('편집 링크를 회수했어요. 이제 그 링크로는 열 수 없어요');
  } catch (e) {
    if (e?.status === 404) { _stop('이미 회수된 링크예요'); return; }
    showToast(e?.status === 403 ? '링크를 만든 기기에서만 회수할 수 있어요' : '회수하지 못했어요. 잠시 뒤 다시 시도해 주세요');
  }
}

function _link(t = token) {
  return publicLink(`#page=schedule&collab=${t}`);
}
function _viewToken() {
  try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); return v && v.token === token ? v.view : null; } catch (_) { return null; }
}
function _rememberView(view) {
  if (!view || !token) return;
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ token, view })); } catch (_) {}
}
async function _copyView() {
  const v = _viewToken();
  if (!v) return;
  try { await navigator.clipboard.writeText(_link(v)); showToast('보기 전용 링크를 복사했어요. 받은 사람은 보기만 하고 고칠 수 없어요'); }
  catch (_) { showCopy('이 링크를 복사해 주세요', _link(v)); }
}

function _applyRemote(remote) {
  version = remote.version;
  readOnly = !!remote.read_only;
  if (remote.view_token) _rememberView(remote.view_token);
  const data = _strip(remote.data) || {};
  const cur = appState.generated;
  // 내 계정에 저장해 둔 같은 여행이면 내 저장 번호를 그대로 쓴다.
  if (cur?.savedScheduleId && (cur === sharedObj || (cur.tripUid && cur.tripUid === data.tripUid))) data.savedScheduleId = cur.savedScheduleId;
  lastSynced = _json(data);
  if (readOnly) data.sharedView = true;     // 보기 전용 — 편집 버튼을 감추고 올리지 않는다
  appState.generated = data;
  sharedObj = data;
  rerender();
}

async function _pull() {
  if (!token || saving || saveTimer || document.hidden || _editing()) return;
  // 올리지 못한 내 수정이 있으면 받아서 덮지 않고 다시 올린다.
  if (!readOnly && _sameTrip(appState.generated) && _json(appState.generated) !== lastSynced) { saveTimer = setTimeout(_push, SAVE_DELAY_MS); return; }
  try {
    const remote = await api.getSharedTrip(token);
    if (remote.version > version) {
      _applyRemote(remote);
      showToast('같이 편집하는 분이 일정을 바꿨어요');
    }
  } catch (e) {
    if (e?.status === 404) _stop('공유 일정이 만료됐어요');
  }
}

async function _push() {
  saveTimer = null;
  const g = appState.generated;
  if (!token || !g || !_sameTrip(g)) return;
  const json = _json(g);
  if (json === lastSynced) return;
  saving = true;
  try {
    const saved = await api.updateSharedTrip(token, { data: _strip(g), version });
    version = saved.version;
    lastSynced = json;
    sharedObj = g;
    if (failNoted) { failNoted = false; showToast('함께 편집 일정에 저장했어요'); }
  } catch (e) {
    if (e?.status === 409) {
      try { _applyRemote(await api.getSharedTrip(token)); } catch (_) {}
      showToast('다른 분의 수정이 먼저 저장돼 최신 일정으로 바꿨어요');
    } else if (e?.status === 404) {
      _stop('공유 일정이 만료되거나 회수됐어요. 내 기기의 일정은 그대로 있어요');
    } else {
      console.warn('[collab] 저장 실패:', e?.status || '');
      if (!failNoted) { failNoted = true; showToast('함께 편집 일정에 아직 저장하지 못했어요. 연결되면 다시 저장할게요'); }
    }
  } finally {
    saving = false;
  }
}

function _onChanged() {
  if (!token || !appState.generated) return;
  if (readOnly) { if (!_sameTrip(appState.generated)) _stop('', { keepManage: true }); return; }
  // 다른 일정(저장한 일정·새 여행·보기 링크)을 열었다 — 함께 편집 중인 일정을 덮어쓰지 않게 이 기기에서 멈춘다.
  if (!_sameTrip(appState.generated)) { _stop('다른 일정을 열어서 함께 편집을 멈췄어요. 편집 링크로 다시 열 수 있어요', { keepManage: true }); return; }
  sharedObj = appState.generated;
  if (_json(appState.generated) === lastSynced) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(_push, SAVE_DELAY_MS);
}

function _start() {
  clearInterval(pollTimer);
  pollTimer = setInterval(_pull, POLL_MS);
  _paint();
}

function _stop(message, { keepManage = false } = {}) {
  clearInterval(pollTimer);
  clearTimeout(saveTimer);
  saveTimer = null;
  sharedObj = null; failNoted = false;
  // 링크를 만든 사람은 나중에 링크로 다시 열어 회수할 수 있게 관리 키를 남긴다.
  if (keepManage) { token = null; try { localStorage.removeItem(TOKEN_KEY); } catch (_) {} }
  else _setToken(null);
  _paint();
  if (message) showToast(message);
}

async function _create() {
  const btn = $('#collabStart');
  if (btn) btn.disabled = true;
  try {
    const g = appState.generated;
    if (!g.tripUid) g.tripUid = 'trip-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const created = await api.createSharedTrip({ data: _strip(g) });
    _setToken(created.token, created.manage_key);
    _rememberView(created.view_token);
    readOnly = false;
    version = created.version;
    sharedObj = g;
    lastSynced = _json(created.data);
    _start();
    trackEvent('collab_started');
    await _copy();
  } catch (e) {
    showToast(e?.status === 429 ? '잠시 후 다시 시도해 주세요' : '공유 링크를 만들지 못했어요');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function _copy() {
  try {
    await navigator.clipboard.writeText(_link());
    showToast('편집 링크를 복사했어요. 링크를 아는 사람은 누구나 고칠 수 있어요');
  } catch (_) {
    showCopy('이 링크를 복사해 주세요', _link());
  }
}

function _paint() {
  const box = $('#collabPanel');
  if (!box) return;
  box.hidden = !appState?.generated;
  box.textContent = '';
  box.appendChild(el('h3', { class: 'tool-title', id: 'collabTitle', tabIndex: -1 }, token && readOnly ? '공유받은 일정 (보기 전용)' : '함께 편집 (편집 가능 링크)'));
  if (token && readOnly) {
    box.append(
      el('p', { class: 'tool-note' }, '보기 전용 링크로 보고 있어요. 바뀐 내용은 몇 초마다 받아 오지만, 여기서 고칠 수는 없어요.'),
      el('div', { class: 'tool-actions' }, [
        el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _stop('이 기기에서 보기를 그만뒀어요. 링크는 계속 유효해요') }, '이 기기에서 그만보기'),
      ]),
    );
  } else if (token) {
    const mine = !!_manageKey();
    box.append(
      el('p', { class: 'tool-note' }, mine
        ? '함께 편집 중이에요. 링크를 아는 사람은 누구나 일정·메모·비용을 보고 고칠 수 있어요. 필요 없어지면 링크를 회수하세요.'
        : '받은 편집 링크로 함께 고치는 중이에요. 링크 회수는 링크를 만든 사람만 할 수 있어요.'),
      el('div', { class: 'tool-actions' }, [
        el('button', { type: 'button', class: 'btn btn-soft', onclick: _copy }, '편집 링크 복사'),
        mine && _viewToken() ? el('button', { type: 'button', class: 'btn btn-soft', onclick: _copyView }, '보기 전용 링크 복사') : null,
        mine
          ? el('button', { type: 'button', class: 'btn btn-soft is-danger', onclick: _revoke }, '링크 회수')
          : el('button', { type: 'button', class: 'btn btn-soft', onclick: () => _stop('이 기기에서 함께 편집을 그만뒀어요. 링크는 계속 유효해요') }, '이 기기에서 그만하기'),
      ]),
    );
  } else {
    box.append(
      el('p', { class: 'tool-note' }, '동행자에게 링크를 보내 같은 일정을 함께 고쳐요. 링크를 아는 사람은 누구나 일정·메모·비용을 고칠 수 있어요. 보기만 하게 하려면 위의 ‘공유’를 쓰세요.'),
      el('button', { type: 'button', class: 'btn btn-soft btn-block', id: 'collabStart', onclick: _create }, '편집 링크 만들기'),
    );
  }
}

export async function initCollab(state, renderSchedule) {
  appState = state;
  rerender = renderSchedule;
  document.addEventListener('redesign:schedule-changed', () => { _paint(); _onChanged(); });
  document.addEventListener('redesign:collab-open', () => {
    const box = $('#collabPanel');
    if (!box || box.hidden) return;
    document.dispatchEvent(new CustomEvent('redesign:tool-open', { detail: 'collab' }));
    $('#collabTitle')?.focus({ preventScroll: true });
  });

  const params = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const fromUrl = params.get('collab');
  if (fromUrl) {
    // 토큰이 주소창과 방문 기록에 남지 않게 바로 지운다.
    history.replaceState(null, '', location.pathname + '#page=schedule');
  }
  let saved = null;
  try { saved = localStorage.getItem(TOKEN_KEY); } catch (_) {}
  const candidate = fromUrl || saved;
  if (!candidate) return;

  try {
    const remote = await api.getSharedTrip(candidate);
    // 저장된 편집 링크로 이어 갈 때, 방금 연 보기 링크·다른 일정을 덮지 않는다.
    const cur = appState.generated;
    if (!fromUrl && cur && (cur.sharedView || (remote.data?.tripUid && cur.tripUid !== remote.data.tripUid))) {
      try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
      return;
    }
    _setToken(candidate);
    _applyRemote(remote);
    _start();
    if (fromUrl) showToast(readOnly ? '보기 전용으로 공유된 일정을 열었어요' : '함께 편집하는 일정을 열었어요');
  } catch (e) {
    if (e?.status === 404) {
      _setToken(null);
      if (fromUrl) showToast('공유 일정을 찾을 수 없어요');
    }
  }
}
