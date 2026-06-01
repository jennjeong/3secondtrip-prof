/* 3초 여행 — Settings bottom-sheet
 * Holds the language picker (moved out of the topbar), dark-mode toggle,
 * notifications, feedback shortcut, local-data reset.
 */

import { $, $$, el, showToast } from './redesign-ui.js';

const LANGS = [
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'ja', flag: '🇯🇵', label: '日本語' },
  { code: 'zh', flag: '🇨🇳', label: '中文' },
];
const LANG_KEY = 'tst_lang_v1';
const DARK_KEY = 'tst_dark_v1';

export function initSettings() {
  $('#openSettingsBtn')?.addEventListener('click', openSettings);
  $('#settingsClose')?.addEventListener('click', closeSettings);
  $('#settingsBackdrop')?.addEventListener('click', closeSettings);

  // Language sub-list toggle
  $('#settingLangRow')?.addEventListener('click', _toggleLangList);

  // Dark mode toggle
  const darkOn = (() => { try { return localStorage.getItem(DARK_KEY) === '1'; } catch (_) { return false; } })();
  const darkCb = $('#settingDark');
  if (darkCb) {
    darkCb.checked = darkOn;
    if (darkOn) document.documentElement.classList.add('allow-dark');
    darkCb.addEventListener('change', () => {
      if (darkCb.checked) { document.documentElement.classList.add('allow-dark'); localStorage.setItem(DARK_KEY, '1'); }
      else { document.documentElement.classList.remove('allow-dark'); localStorage.setItem(DARK_KEY, '0'); }
    });
  }

  $('#settingReset')?.addEventListener('click', () => {
    if (!confirm('로컬에 저장된 모든 데이터(토큰·취향·블로그·후기·언어)를 지울까요?')) return;
    try {
      const keep = []; // none
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('tst_') && !keep.includes(k)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      showToast('초기화 완료. 페이지를 새로 고칩니다.');
      setTimeout(() => location.reload(), 700);
    } catch (e) { showToast('초기화 실패'); }
  });

  _renderLangList();
  _applyLangFromStorage();
}

export function openSettings() {
  const bd = $('#settingsBackdrop'); const sh = $('#settingsSheet');
  if (!bd || !sh) return;
  bd.hidden = false; sh.hidden = false;
  requestAnimationFrame(() => { bd.classList.add('is-visible'); sh.classList.add('is-visible'); });
}

export function closeSettings() {
  const bd = $('#settingsBackdrop'); const sh = $('#settingsSheet');
  if (!bd || !sh) return;
  bd.classList.remove('is-visible'); sh.classList.remove('is-visible');
  setTimeout(() => { bd.hidden = true; sh.hidden = true; }, 250);
}

function _toggleLangList() {
  const list = $('#settingLangList');
  if (!list) return;
  list.hidden = !list.hidden;
}

function _renderLangList() {
  const list = $('#settingLangList');
  const lbl = $('#settingLangLabel');
  if (!list || !lbl) return;
  const cur = _currentLang();
  lbl.textContent = `${cur.flag} ${cur.label}`;
  list.innerHTML = '';
  LANGS.forEach(l => {
    const b = el('button', {
      type: 'button',
      class: l.code === cur.code ? 'is-active' : '',
      onclick: () => {
        try { localStorage.setItem(LANG_KEY, l.code); } catch (_) {}
        _applyLangFromStorage();
        _renderLangList();
        list.hidden = true;
        showToast(`${l.label} 적용`);
        document.dispatchEvent(new CustomEvent('redesign:lang', { detail: l }));
      },
    });
    b.textContent = `${l.flag} ${l.label}`;
    list.appendChild(b);
  });
}

function _currentLang() {
  let code = null;
  try { code = localStorage.getItem(LANG_KEY); } catch (_) {}
  return LANGS.find(l => l.code === code) || LANGS[0];
}

function _applyLangFromStorage() {
  const cur = _currentLang();
  document.documentElement.lang = cur.code;
}
