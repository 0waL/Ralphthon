// 작은 DOM 헬퍼. 문자열은 항상 textContent로 들어가므로 사용자 입력이 HTML로 해석되지 않는다.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

export function formatDateTime(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const date = `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
  return m[4] ? `${date} ${m[4]}:${m[5]}` : date;
}

export function formatRelative(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return formatDateTime(new Date(iso).toISOString().slice(0, 10));
}

export function backButton(fallback = '/') {
  return h('button', {
    type: 'button',
    class: 'back-button',
    'aria-label': '뒤로가기',
    onclick: () => {
      if (history.length > 1) history.back();
      else window.dispatchEvent(new CustomEvent('navigate', { detail: fallback }));
    },
  }, '← 뒤로');
}

export function errorBox() {
  const box = h('div', { class: 'error-box', role: 'alert', hidden: true });
  return {
    node: box,
    show(message) {
      box.textContent = message;
      box.hidden = false;
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    hide() {
      box.hidden = true;
    },
  };
}

export function notice(kind, ...children) {
  return h('div', { class: `notice notice-${kind}` }, ...children);
}

/** AI 분석처럼 오래 걸리는 작업 동안 화면을 가린다. */
export async function withOverlay(message, task) {
  const overlay = h('div', { class: 'overlay', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'overlay-card' }, h('div', { class: 'spinner' }), h('p', {}, message)));
  document.body.append(overlay);
  try {
    return await task();
  } finally {
    overlay.remove();
  }
}

export function passwordField({ name, label, autocomplete }) {
  const input = h('input', { type: 'password', name, id: name, required: true, autocomplete, minlength: 8, maxlength: 72 });
  const toggle = h('button', {
    type: 'button',
    class: 'link-button',
    'aria-controls': name,
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '숨기기' : '보기';
    },
  }, '보기');
  return {
    input,
    node: h('div', { class: 'field' },
      h('label', { for: name }, label),
      h('div', { class: 'input-with-action' }, input, toggle)),
  };
}

export function photoPicker({ name, max, label, hint }) {
  const input = h('input', { type: 'file', name, id: name, accept: 'image/jpeg,image/png,image/gif,image/webp', multiple: true });
  const previews = h('div', { class: 'photo-previews' });
  let files = [];
  const counter = h('span', { class: 'muted' }, `0 / ${max}`);

  function render() {
    clear(previews);
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      previews.append(h('div', { class: 'photo-thumb' },
        h('img', { src: url, alt: `${label} ${index + 1}`, onload: () => URL.revokeObjectURL(url) }),
        h('button', {
          type: 'button', class: 'thumb-remove', 'aria-label': '사진 빼기',
          onclick: () => { files.splice(index, 1); render(); },
        }, '×')));
    });
    counter.textContent = `${files.length} / ${max}`;
  }

  input.addEventListener('change', () => {
    files = [...files, ...input.files].slice(0, max);
    input.value = '';
    render();
  });

  return {
    get files() { return files; },
    node: h('div', { class: 'field' },
      h('label', { for: name }, label, ' ', counter),
      hint ? h('p', { class: 'hint' }, hint) : null,
      input,
      previews),
  };
}
