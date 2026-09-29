// 내 활동 (등록한 물건, 검증 신청, 채팅)과 알림
import { get, post } from '../api.js';
import { refreshSession, requireLogin } from '../app.js';
import { formatDateTime, formatRelative, h } from '../dom.js';

const ITEM_STATUS = { draft: '게시 전', published: '게시 중', matched: '반환 진행 중', returned: '반환 완료' };
const CLAIM_STATUS = {
  followup: '추가 질문 답변 필요',
  awaiting_finder: '습득자 확인 대기',
  approved: '승인됨',
  rejected: '거절됨',
  failed: '실패',
  closed: '종료',
};

function section(title, action, content) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, title), action),
    content);
}

export async function myPage() {
  if (!requireLogin()) return null;
  const [items, claims, chats] = await Promise.all([get('/api/my/items'), get('/api/my/claims'), get('/api/chats')]);

  const itemList = items.items.length === 0
    ? h('p', { class: 'muted' }, '등록한 습득물이 없습니다.')
    : h('ul', { class: 'row-list' }, items.items.map((item) => h('li', {},
      h('a', { href: `/my/items/${item.id}`, class: 'row-link' },
        h('span', { class: 'row-main' }, item.title),
        h('span', { class: 'row-sub' }, `${item.foundPlace} · ${formatDateTime(item.foundAt)}`),
        h('span', { class: 'tags' },
          h('span', { class: 'tag' }, ITEM_STATUS[item.status]),
          item.awaitingClaims > 0 ? h('span', { class: 'tag tag-accent' }, `확인할 신청 ${item.awaitingClaims}건`) : null)))));

  const claimList = claims.claims.length === 0
    ? h('p', { class: 'muted' }, '검증을 신청한 물건이 없습니다.')
    : h('ul', { class: 'row-list' }, claims.claims.map((c) => h('li', {},
      h('a', { href: `/claims/${c.id}`, class: 'row-link' },
        h('span', { class: 'row-main' }, c.itemTitle),
        h('span', { class: 'row-sub' }, formatRelative(c.createdAt)),
        h('span', { class: 'tag' }, CLAIM_STATUS[c.status])))));

  const chatList = chats.rooms.length === 0
    ? h('p', { class: 'muted' }, '열린 채팅방이 없습니다. 검증이 승인되면 채팅방이 열립니다.')
    : h('ul', { class: 'row-list' }, chats.rooms.map((r) => h('li', {},
      h('a', { href: `/chats/${r.id}`, class: 'row-link' },
        h('span', { class: 'row-main' }, `${r.itemTitle} · ${r.otherParty}`),
        h('span', { class: 'row-sub' }, r.lastMessage ?? '아직 메시지가 없습니다.'),
        h('span', { class: 'tag' }, r.role === 'finder' ? '내가 습득' : '내 물건')))));

  return h('div', { class: 'page stack' },
    h('h1', {}, '내 활동'),
    section('등록한 습득물', h('a', { href: '/register', class: 'button button-small' }, '+ 새로 등록'), itemList),
    section('내 검증 신청', null, claimList),
    section('채팅', null, chatList));
}

export async function notificationsPage() {
  if (!requireLogin()) return null;
  const { notifications } = await get('/api/notifications');
  if (notifications.some((n) => !n.read)) {
    await post('/api/notifications/read');
    refreshSession();
  }
  return h('section', { class: 'page narrow' },
    h('h1', {}, '알림'),
    notifications.length === 0
      ? h('p', { class: 'muted' }, '알림이 없습니다.')
      : h('ul', { class: 'row-list' }, notifications.map((n) => h('li', { class: n.read ? '' : 'unread' },
        n.link
          ? h('a', { href: n.link, class: 'row-link' }, h('span', { class: 'row-main' }, n.message), h('span', { class: 'row-sub' }, formatRelative(n.createdAt)))
          : h('div', { class: 'row-link' }, h('span', { class: 'row-main' }, n.message), h('span', { class: 'row-sub' }, formatRelative(n.createdAt)))))));
}
