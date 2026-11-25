/* 3초 여행 — 확인·입력 창
 *
 * 브라우저 기본 창(confirm·prompt)은 홈 화면 앱과 iOS 앱에서 주소가 제목으로 나오고 모양을 바꿀 수 없어,
 * 앱 모양의 창 하나로 대신한다.  <dialog> 를 쓰므로 초점 가두기·Esc·뒤 화면 잠금은 브라우저가 맡는다.
 *
 *   if (!await askConfirm('지울까요?\n되돌릴 수 없어요.', { ok: '지우기', danger: true })) return;
 *   const v = await askForm({ title, fields: [{ name, label, value }] });   // 취소하면 null
 */
import { el } from './redesign-ui.js';

let seq = 0;

/** fields: [{ name, label, value, type: 'text'|'textarea'|'stars'|'choice', options, max, readonly, check(v) → 오류 문구 }] */
export function askForm({ title, text = '', fields = [], ok = '확인', cancel = '취소', danger = false }) {
  return new Promise((resolve) => {
    const id = `ask${++seq}`;
    const back = document.activeElement;
    const inputs = {};
    const error = el('p', { class: 'form-error ask-error', role: 'alert', hidden: true });

    const rows = fields.map((f) => {
      const fid = `${id}-${f.name}`;
      if (f.type === 'choice' || f.type === 'stars') {
        const opts = f.type === 'stars' ? [1, 2, 3, 4, 5].map(n => ({ value: n, label: `${n}점` })) : f.options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
        const radios = opts.map(o => el('label', { class: 'ask-choice' }, [
          el('input', { type: 'radio', name: fid, value: String(o.value), checked: o.value === f.value }), el('span', {}, o.label),
        ]));
        inputs[f.name] = () => { const r = radios.map(l => l.firstChild).find(x => x.checked); return r ? (f.type === 'stars' ? Number(r.value) : r.value) : null; };
        return el('fieldset', { class: 'ask-field ask-choices' + (f.type === 'stars' ? ' is-row' : '') }, [el('legend', { class: 'form-label' }, f.label), ...radios]);
      }
      const input = el(f.type === 'textarea' ? 'textarea' : 'input', {
        class: 'form-input', id: fid, value: f.value ?? '', readOnly: !!f.readonly, autocomplete: 'off',
        ...(f.max ? { maxLength: f.max } : {}), ...(f.type === 'textarea' ? { rows: 4 } : { type: 'text' }),
      });
      inputs[f.name] = () => input.value.trim();
      return el('div', { class: 'ask-field' }, [el('label', { class: 'form-label', htmlFor: fid }, f.label), input]);
    });

    const okBtn = el('button', { type: 'submit', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') }, ok);
    const noBtn = cancel ? el('button', { type: 'button', class: 'btn btn-soft' }, cancel) : null;
    const form = el('form', { class: 'ask-body' }, [
      el('h2', { class: 'ask-title', id: `${id}T` }, title),
      text ? el('p', { class: 'ask-text', id: `${id}D` }, text) : null,
      ...rows, error,
      el('div', { class: 'ask-actions' }, [noBtn, okBtn]),
    ]);
    const dlg = el('dialog', { class: 'ask', 'aria-labelledby': `${id}T`, ...(text ? { 'aria-describedby': `${id}D` } : {}) }, [form]);

    let result = null;
    const close = (v) => { result = v; dlg.close(); };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        out[f.name] = inputs[f.name]();
        const msg = f.check?.(out[f.name]);
        if (msg) { error.textContent = msg; error.hidden = false; dlg.querySelector(`#${id}-${f.name}`)?.focus(); return; }
      }
      close(out);
    });
    noBtn?.addEventListener('click', () => close(null));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); });          // 바깥을 누르면 취소
    // 아래에 열린 시트가 같은 키(Esc·Tab)를 함께 받지 않게 한다.
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Tab') e.stopPropagation(); });
    dlg.addEventListener('close', () => {
      dlg.remove();
      if (back?.isConnected) back.focus?.({ preventScroll: true });
      resolve(result);
    }, { once: true });

    document.body.append(dlg);
    dlg.showModal();
    // 지우는 창은 취소에, 입력이 있으면 첫 입력에, 그 밖에는 확인에 초점을 둔다.
    const first = dlg.querySelector('.ask-field :is(input, textarea)');
    (first || (danger && noBtn) || okBtn).focus();
    if (first && first.type === 'text') first.select?.();
  });
}

/** 기본 confirm 과 같은 쓰임 — 첫 줄은 제목, 나머지는 설명. */
export async function askConfirm(message, opts = {}) {
  const [title, ...rest] = String(message).split('\n');
  return (await askForm({ title, text: rest.join('\n').trim(), ...opts })) !== null;
}

/** 자동 복사를 못 했을 때 — 직접 복사할 수 있게 주소를 보여 준다. */
export function showCopy(title, value) {
  return askForm({ title, fields: [{ name: 'v', label: '주소', value, readonly: true }], ok: '닫기', cancel: '' });
}

/** Android 뒤로 가기 — 열린 창이 있으면 닫고 true. */
export function closeTopDialog() {
  const d = [...document.querySelectorAll('dialog.ask[open]')].pop();
  if (!d) return false;
  d.close();
  return true;
}
