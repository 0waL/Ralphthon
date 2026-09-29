// 승인 후 분실자와 습득자의 채팅방. 3초마다 새 메시지를 가져온다.
import { get, post } from '../api.js';
import { requireLogin } from '../app.js';
import { backButton, errorBox, formatRelative, h } from '../dom.js';

export async function chatPage({ params, onCleanup, isCurrent }) {
  if (!requireLogin()) return null;
  const first = await get(`/api/chats/${params.id}`);
  const { room } = first;
  const list = h('ol', { class: 'chat-messages', 'aria-live': 'polite' });
  let lastId = 0;

  function add(messages) {
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    for (const m of messages) {
      lastId = Math.max(lastId, m.id);
      list.append(h('li', { class: `chat-message${m.mine ? ' mine' : ''}` },
        h('span', { class: 'chat-sender' }, m.mine ? '나' : m.sender),
        h('p', { class: 'chat-bubble' }, m.body),
        h('time', { class: 'chat-time', datetime: m.createdAt }, formatRelative(m.createdAt))));
    }
    if (messages.length && nearBottom) list.scrollTop = list.scrollHeight;
  }
  add(first.messages);

  async function poll() {
    if (!isCurrent()) return;
    try {
      const { messages } = await get(`/api/chats/${room.id}?after=${lastId}`);
      if (isCurrent()) add(messages);
    } catch { /* 다음 주기에 다시 시도 */ }
  }
  const timer = setInterval(poll, 3000);
  onCleanup(() => clearInterval(timer));

  const error = errorBox();
  const input = h('textarea', { rows: 2, maxlength: 1000, required: true, 'aria-label': '메시지', placeholder: '메시지를 입력하세요' });
  const form = h('form', {
    class: 'chat-form',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      error.hide();
      try {
        await post(`/api/chats/${room.id}/messages`, { body });
        input.value = '';
        await poll();
        list.scrollTop = list.scrollHeight;
      } catch (err) {
        error.show(err.message);
      }
    },
  }, input, h('button', { type: 'submit', class: 'button button-primary' }, '보내기'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  queueMicrotask(() => { list.scrollTop = list.scrollHeight; });

  return h('section', { class: 'page narrow chat-page' },
    backButton('/my'),
    h('h1', {}, room.itemTitle),
    h('p', { class: 'muted' },
      room.role === 'finder'
        ? `${room.otherParty}님과 반환 방법을 정하세요. 물건을 돌려준 뒤 `
        : `습득자 ${room.otherParty}님과 반환 방법을 정하세요.`,
      room.role === 'finder' ? h('a', { href: `/my/items/${room.itemId}` }, '반환 완료로 표시하세요.') : null),
    h('p', { class: 'hint' }, '안전을 위해 사람이 많은 공공장소에서 만나거나 기관을 통해 전달하세요. 계좌번호 등 불필요한 개인정보는 보내지 마세요.'),
    list,
    error.node,
    form);
}
