// 소유권 검증 신청과 결과 확인
import { get, post } from '../api.js';
import { navigate, requireLogin, session } from '../app.js';
import { backButton, errorBox, h, notice, photoPicker, withOverlay } from '../dom.js';

const WAIT_MESSAGE = () => (session.aiMode === 'claude' ? 'AI가 답변을 확인하고 있어요…' : '확인하는 중…');

export async function claimFormPage({ params }) {
  if (!requireLogin()) return null;
  const item = await get(`/api/items/${params.id}`);
  if (item.custody === 'institution' || item.isFinder || item.status !== 'published') {
    navigate(`/items/${item.id}`, { replace: true });
    return null;
  }
  const attemptsLeft = item.myClaims?.attemptsLeft ?? 0;

  const answer = h('textarea', {
    id: 'answer', rows: 8, required: true, maxlength: 2000,
    placeholder: '예) 남색 반지갑이고, 겉면에 작은 스티커를 붙여 뒀어요. 안에는 카드 몇 장과 영수증이 있어요. 오래 써서 모서리가 닳았어요.',
  });
  const evidence = photoPicker({
    name: 'evidence', max: 3, label: '증빙 사진 (선택)',
    hint: '물건을 들고 찍은 사진이 가장 좋습니다. 구매 내역을 올릴 때는 이름, 주소, 카드 번호를 가려 주세요. 첨부하지 않아도 불이익은 없습니다.',
  });
  const error = errorBox();

  const form = h('form', {
    class: 'form-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      const data = new FormData();
      data.append('answer', answer.value.trim());
      for (const file of evidence.files) data.append('evidence', file);
      try {
        const claim = await withOverlay(WAIT_MESSAGE(), () => post(`/api/items/${item.id}/claims`, data));
        navigate(`/claims/${claim.id}`, { replace: true });
      } catch (err) {
        error.show(err.message);
      }
    },
  },
  h('h1', {}, '소유권 검증'),
  h('p', { class: 'muted' }, `"${item.title}"의 주인이라면 물건의 특징을 자세히 적어 주세요.`),
  notice('info',
    h('ul', { class: 'plain-list' },
      h('li', {}, '겉모습뿐 아니라 흠집, 스티커, 내용물처럼 주인만 알 만한 것을 적을수록 좋습니다.'),
      h('li', {}, '사실과 다른 특징을 적으면 감점됩니다.'),
      h('li', {}, `이 물건에는 ${attemptsLeft}번 더 신청할 수 있습니다. 실패해도 어느 부분이 틀렸는지는 알려드리지 않습니다.`))),
  error.node,
  h('div', { class: 'field' }, h('label', { for: 'answer' }, '물건의 특징'), answer),
  evidence.node,
  h('button', { type: 'submit', class: 'button button-primary button-block', disabled: attemptsLeft === 0 }, '검증 신청하기'));

  return h('section', { class: 'page narrow' }, backButton(`/items/${item.id}`), form);
}

function followupForm(claim) {
  const inputs = claim.questions.map((q, i) => h('textarea', { id: `q${i}`, rows: 3, required: true, maxlength: 1000 }));
  const error = errorBox();
  return h('form', {
    class: 'form-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      try {
        await withOverlay(WAIT_MESSAGE(), () => post(`/api/claims/${claim.id}/followup`, {
          answers: inputs.map((input) => input.value.trim()),
        }));
        navigate(`/claims/${claim.id}`, { replace: true });
      } catch (err) {
        error.show(err.message);
      }
    },
  },
  h('h2', {}, '추가 질문'),
  h('p', { class: 'muted' }, '주인인지 한 번 더 확인하기 위한 질문입니다. 기억나는 대로 자세히 답해 주세요.'),
  error.node,
  claim.questions.map((q, i) => h('div', { class: 'field' }, h('label', { for: `q${i}` }, `${i + 1}. ${q}`), inputs[i])),
  h('button', { type: 'submit', class: 'button button-primary button-block' }, '답변 제출'));
}

export async function claimStatusPage({ params }) {
  if (!requireLogin()) return null;
  const claim = await get(`/api/claims/${params.id}`);
  const kind = {
    awaiting_finder: 'success', approved: 'success', followup: 'info', failed: 'error', rejected: 'error', closed: 'info',
  }[claim.status];

  const extra = [];
  if (claim.status === 'followup') extra.push(followupForm(claim));
  if (claim.status === 'approved' && claim.chatRoomId) {
    extra.push(h('a', { href: `/chats/${claim.chatRoomId}`, class: 'button button-primary' }, '채팅방으로 가기'));
  }
  if (['failed', 'rejected'].includes(claim.status)) {
    extra.push(h('p', {}, claim.attemptsLeft > 0
      ? `이 물건에는 ${claim.attemptsLeft}번 더 신청할 수 있습니다.`
      : '이 물건에 대한 시도 횟수를 모두 사용했습니다.'));
  }

  return h('section', { class: 'page narrow' },
    backButton('/my'),
    h('h1', {}, '검증 결과'),
    h('p', {}, h('a', { href: `/items/${claim.itemId}` }, claim.itemTitle)),
    notice(kind, claim.message),
    extra);
}
