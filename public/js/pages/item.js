// 분실물 확인 탭: 뒤로가기, 제목(큰 글씨), 설명, 검증 신청 버튼
import { get } from '../api.js';
import { navigate, session } from '../app.js';
import { backButton, formatDateTime, h, notice } from '../dom.js';

const CLAIM_STATUS_TEXT = {
  followup: '추가 질문에 답해야 합니다.',
  awaiting_finder: '검증을 통과해 습득자의 확인을 기다리고 있습니다.',
  approved: '습득자가 승인했습니다.',
  rejected: '습득자가 거절했습니다.',
  failed: '검증에 실패했습니다.',
  closed: '다른 신청이 승인되어 종료되었습니다.',
};

function actionArea(item) {
  if (item.custody === 'institution') {
    return h('div', { class: 'institution-box' },
      h('h2', {}, '기관에 보관 중인 물건입니다'),
      h('p', { class: 'muted' }, '기관이 반환할 때 신분을 확인하므로 별도 검증 없이 아래로 문의하세요.'),
      h('dl', { class: 'meta meta-large' },
        h('div', {}, h('dt', {}, '기관'), h('dd', {}, item.institution.name)),
        h('div', {}, h('dt', {}, '위치'), h('dd', {}, item.institution.location)),
        h('div', {}, h('dt', {}, '연락처'), h('dd', {}, item.institution.contact))));
  }
  if (item.isFinder) {
    return notice('info', '내가 등록한 물건입니다. ', h('a', { href: `/my/items/${item.id}` }, '관리 화면으로 가기'));
  }
  if (item.status !== 'published') {
    return notice('info', item.status === 'returned' ? '주인에게 반환된 물건입니다.' : '주인이 확인되어 반환을 진행 중인 물건입니다.');
  }

  const latest = item.myClaims?.latest;
  const status = latest ? h('p', { class: 'muted' },
    `내 신청: ${CLAIM_STATUS_TEXT[latest.status]} `, h('a', { href: `/claims/${latest.id}` }, '자세히')) : null;
  const active = latest && ['followup', 'awaiting_finder'].includes(latest.status);
  const attemptsLeft = item.myClaims?.attemptsLeft ?? 2;

  const button = h('button', {
    type: 'button',
    class: 'button button-primary',
    disabled: active || attemptsLeft === 0,
    onclick: () => {
      const target = `/items/${item.id}/claim`;
      // 로그인이 안 되어 있다면 로그인 후 검증 단계로 이동
      navigate(session.user ? target : `/login?next=${encodeURIComponent(target)}`);
    },
  }, '검증 신청');

  return h('div', { class: 'claim-cta' },
    h('p', {}, '내 물건 같다면 검증을 신청하세요. 물건의 특징을 설명하면 주인인지 확인한 뒤 습득자와 연결해 드립니다.'),
    button,
    session.user ? h('p', { class: 'hint' }, `남은 시도 횟수 ${attemptsLeft}회`) : null,
    status);
}

export async function itemPage({ params }) {
  const item = await get(`/api/items/${params.id}`);
  return h('section', { class: 'page narrow' },
    backButton(),
    h('article', { class: 'item-detail' },
      h('div', { class: 'tags' },
        h('span', { class: 'tag' }, item.category),
        item.custody === 'institution' ? h('span', { class: 'tag tag-accent' }, '기관 보관') : null),
      h('h1', { class: 'item-title' }, item.title),
      h('p', { class: 'item-description' }, item.publicDescription),
      h('dl', { class: 'meta' },
        h('div', {}, h('dt', {}, '습득 장소'), h('dd', {}, item.foundPlace)),
        h('div', {}, h('dt', {}, '습득 시간'), h('dd', {}, formatDateTime(item.foundAt)))),
      h('p', { class: 'hint' }, '개인정보 보호를 위해 습득물 사진은 공개하지 않습니다.'),
      actionArea(item)));
}
