// 습득자 관리 화면
// - 초안: AI가 정리한 특징과 공개 설명을 확인·수정하고 게시한다 (검증 구조 2장 5단계).
// - 게시 후: 검증을 통과한 신청들을 나란히 비교하고 한 명을 승인한다 (4장 8단계, 8장).
import { del, get, post, put } from '../api.js';
import { navigate, requireLogin } from '../app.js';
import { backButton, clear, errorBox, formatDateTime, formatRelative, h, notice } from '../dom.js';
import { custodyFields, field } from './register.js';

const KIND_LABELS = {
  category: '종류', color: '색상', size_shape: '크기·형태', brand: '브랜드', appearance: '외형',
  mark: '고유한 흔적', contents: '내용물', text: '글자·숫자', other: '기타',
};
const SOURCE_LABELS = { finder: '직접 입력', ai: 'AI', both: '직접 입력 + AI' };
const STATUS_LABELS = { draft: '게시 전', published: '게시 중', matched: '반환 진행 중', returned: '반환 완료' };
const EVIDENCE_LABELS = {
  none: '첨부 안 함',
  unrecognized: '증빙으로 인정되지 않음',
  holding_private_visible: '물건 사진에서 비공개 특징 확인',
  holding_type_color: '물건 사진 (종류·색만 일치)',
  purchase_record: '구매 내역',
  ai_suspected: 'AI 생성 의심',
};

function photoStrip(item) {
  return h('div', { class: 'photo-strip' },
    item.photos.map((p, i) => h('a', { href: p.url, target: '_blank', rel: 'noopener' },
      h('img', { src: p.url, alt: `습득물 사진 ${i + 1}`, loading: 'lazy' }))));
}

function warningsBox(warnings) {
  if (!warnings?.length) return null;
  return notice('warning', h('ul', { class: 'plain-list' }, warnings.map((w) => h('li', {}, w))));
}

// ---------- 초안 검토 ----------

function featureEditor(initial) {
  const rows = h('div', { class: 'feature-rows' });
  const state = initial.map((f) => ({ ...f }));

  function render() {
    clear(rows);
    for (const group of ['public', 'private']) {
      const list = state.filter((f) => f.visibility === group);
      rows.append(h('h3', { class: 'feature-group-title' },
        group === 'public' ? `공개 특징 ${list.length}개` : `비공개 특징 ${list.length}개`,
        h('span', { class: 'hint' }, group === 'public' ? ' — 설명과 검색에 사용' : ' — 검증에만 사용, 절대 공개 안 됨')));
      if (list.length === 0) rows.append(h('p', { class: 'muted' }, '없음'));
      for (const f of list) {
        const text = h('input', {
          type: 'text', value: f.text, maxlength: 80, 'aria-label': '특징',
          oninput: () => { f.text = text.value; },
        });
        const kind = h('select', {
          'aria-label': '특징 종류',
          onchange: () => {
            f.kind = kind.value;
            if (f.kind === 'text') f.visibility = 'private';
            render();
          },
        }, Object.entries(KIND_LABELS).map(([value, label]) => h('option', { value, selected: value === f.kind }, label)));
        const toggle = h('button', {
          type: 'button',
          class: 'button button-small',
          disabled: f.kind === 'text' && f.visibility === 'private',
          title: f.kind === 'text' ? '사진 속 글자와 숫자는 개인정보일 수 있어 공개할 수 없습니다.' : undefined,
          onclick: () => {
            f.visibility = f.visibility === 'public' ? 'private' : 'public';
            render();
          },
        }, f.visibility === 'public' ? '비공개로' : '공개로');
        const remove = h('button', {
          type: 'button', class: 'button button-small button-ghost', 'aria-label': '특징 삭제',
          onclick: () => { state.splice(state.indexOf(f), 1); render(); },
        }, '삭제');
        rows.append(h('div', { class: 'feature-row' },
          text, kind, h('span', { class: 'tag tag-muted' }, SOURCE_LABELS[f.source] ?? '직접 입력'), toggle, remove));
      }
      rows.append(h('button', {
        type: 'button', class: 'link-button',
        onclick: () => {
          state.push({ text: '', kind: group === 'public' ? 'appearance' : 'mark', visibility: group, source: 'finder' });
          render();
        },
      }, group === 'public' ? '+ 공개 특징 추가' : '+ 비공개 특징 추가'));
    }
  }
  render();
  return { node: rows, values: () => state.filter((f) => f.text.trim()) };
}

function draftView(item) {
  const error = errorBox();
  const title = h('input', { type: 'text', id: 'title', value: item.title, maxlength: 40, required: true });
  const category = h('input', { type: 'text', id: 'category', value: item.category, maxlength: 40, required: true });
  const description = h('textarea', { id: 'publicDescription', rows: 3, maxlength: 300, required: true, value: item.publicDescription });
  const foundPlace = h('input', { type: 'text', id: 'foundPlace', value: item.foundPlace, maxlength: 200, required: true });
  const foundAt = h('input', { type: 'datetime-local', id: 'foundAt', value: item.foundAt.slice(0, 16), required: true });
  const custody = custodyFields(item);
  const features = featureEditor(item.features);

  async function save() {
    return put(`/api/items/${item.id}`, {
      title: title.value.trim(),
      category: category.value.trim(),
      publicDescription: description.value.trim(),
      foundPlace: foundPlace.value.trim(),
      foundAt: foundAt.value,
      ...custody.values(),
      features: features.values(),
    });
  }

  const form = h('form', {
    class: 'form-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      const action = e.submitter?.value;
      try {
        const saved = await save();
        if (action === 'publish') {
          if (!saved.canPublish) {
            error.show(saved.warnings[0] ?? '게시할 수 없습니다.');
            return;
          }
          await post(`/api/items/${item.id}/publish`);
        }
        navigate(`/my/items/${item.id}`, { replace: true });
      } catch (err) {
        error.show(err.message);
      }
    },
  },
  h('h1', {}, '등록 내용 확인'),
  h('p', { class: 'muted' }, item.aiMode === 'claude'
    ? 'AI가 사진과 입력한 내용을 합쳐 특징을 정리했습니다. 공개 설명과 분류를 확인하고 게시하세요.'
    : '입력한 내용으로 특징을 정리했습니다. 공개 설명과 분류를 확인하고 게시하세요.'),
  warningsBox(item.warnings),
  error.node,
  photoStrip(item),
  h('h2', {}, '공개되는 내용'),
  h('div', { class: 'form-grid' }, field('제목', title), field('종류', category)),
  field('공개 설명', description, '상세 페이지에 공개됩니다. 사진 속 글자·숫자나 비공개 특징을 넣지 마세요.'),
  h('div', { class: 'form-grid' }, field('습득 장소', foundPlace), field('습득 시간', foundAt)),
  custody.node,
  h('h2', {}, '특징 분류'),
  features.node,
  h('div', { class: 'button-row' },
    h('button', { type: 'submit', value: 'save', class: 'button' }, '저장'),
    h('button', { type: 'submit', value: 'publish', class: 'button button-primary' }, '게시하기'),
    h('button', {
      type: 'button', class: 'button button-danger',
      onclick: async () => {
        if (!confirm('이 초안을 삭제할까요?')) return;
        await del(`/api/items/${item.id}`);
        navigate('/my', { replace: true });
      },
    }, '삭제')));

  return h('section', { class: 'page' }, backButton('/my'), form);
}

// ---------- 게시 후: 신청 비교 ----------

function claimCard(claim, item, reload) {
  const error = errorBox();
  const actions = [];
  if (claim.status === 'awaiting_finder' && item.status === 'published') {
    actions.push(
      h('button', {
        type: 'button', class: 'button button-primary',
        onclick: async () => {
          if (!confirm(`${claim.claimant}님을 주인으로 승인할까요? 다른 신청은 모두 종료됩니다.`)) return;
          try {
            const r = await post(`/api/claims/${claim.id}/approve`);
            navigate(`/chats/${r.chatRoomId}`);
          } catch (err) { error.show(err.message); }
        },
      }, '승인'),
      h('button', {
        type: 'button', class: 'button button-danger',
        onclick: async () => {
          if (!confirm('이 신청을 거절할까요?')) return;
          try { await post(`/api/claims/${claim.id}/reject`); reload(); } catch (err) { error.show(err.message); }
        },
      }, '거절'),
    );
  }
  if (claim.chatRoomId) actions.push(h('a', { href: `/chats/${claim.chatRoomId}`, class: 'button' }, '채팅방'));

  const statusTag = { awaiting_finder: '확인 대기', approved: '승인함', rejected: '거절함' }[claim.status];
  return h('article', { class: `claim-card claim-${claim.status}` },
    h('header', { class: 'claim-card-head' },
      h('strong', {}, claim.claimant),
      h('span', { class: 'tag' }, statusTag),
      h('span', { class: 'muted' }, formatRelative(claim.createdAt))),
    h('div', { class: 'score' },
      h('span', { class: 'score-total' }, `${claim.score.total}점`),
      h('span', { class: 'muted' }, `서술 ${claim.score.narrative} + 증빙 ${claim.score.evidenceBonus}`)),
    warningsBox(claim.warnings),
    h('h4', {}, '맞힌 비공개 특징'),
    claim.matchedFeatures.length
      ? h('ul', { class: 'chip-list' }, claim.matchedFeatures.map((f) => h('li', { class: 'chip' }, f)))
      : h('p', { class: 'muted' }, '없음'),
    h('h4', {}, '신청 내용'),
    h('blockquote', { class: 'answer' }, claim.answer),
    claim.followup.length ? [
      h('h4', {}, '추가 질문'),
      h('dl', { class: 'qa' }, claim.followup.flatMap((f) => [h('dt', {}, f.question), h('dd', {}, f.answer)])),
    ] : null,
    h('h4', {}, `증빙: ${EVIDENCE_LABELS[claim.evidenceKind] ?? claim.evidenceKind}`),
    claim.evidenceNote ? h('p', { class: 'muted' }, claim.evidenceNote) : null,
    claim.evidence.length ? h('div', { class: 'photo-strip' }, claim.evidence.map((e, i) => h('a', { href: e.url, target: '_blank', rel: 'noopener' },
      h('img', { src: e.url, alt: `증빙 사진 ${i + 1}`, loading: 'lazy' })))) : null,
    error.node,
    actions.length ? h('div', { class: 'button-row' }, actions) : null);
}

async function publishedView(item, reload) {
  const claims = item.custody === 'finder' ? await get(`/api/items/${item.id}/claims`) : null;
  const error = errorBox();
  const features = { public: [], private: [] };
  for (const f of item.features) features[f.visibility].push(f);

  const returnButton = item.status === 'matched'
    ? h('button', {
      type: 'button', class: 'button button-primary',
      onclick: async () => {
        if (!confirm('물건을 주인에게 돌려줬나요? 반환 완료로 바꾸면 증빙 사진이 삭제됩니다.')) return;
        try { await post(`/api/items/${item.id}/returned`); reload(); } catch (err) { error.show(err.message); }
      },
    }, '반환 완료로 표시')
    : null;

  return h('section', { class: 'page' },
    backButton('/my'),
    h('div', { class: 'manage-head' },
      h('div', {},
        h('span', { class: 'tag' }, STATUS_LABELS[item.status]),
        h('h1', {}, item.title),
        h('p', {}, item.publicDescription),
        h('p', { class: 'muted' }, `${item.foundPlace} · ${formatDateTime(item.foundAt)}`),
        h('a', { href: `/items/${item.id}` }, '공개 페이지 보기')),
      returnButton),
    error.node,
    item.institution ? notice('info', `${item.institution.name}에 제출한 물건입니다. 분실자에게 기관 위치(${item.institution.location})와 연락처(${item.institution.contact})를 안내합니다.`) : null,
    h('details', { class: 'card' },
      h('summary', {}, `특징과 사진 (공개 ${features.public.length}개 · 비공개 ${features.private.length}개)`),
      photoStrip(item),
      h('h3', {}, '공개 특징'),
      h('ul', { class: 'chip-list' }, features.public.map((f) => h('li', { class: 'chip' }, f.text))),
      h('h3', {}, '비공개 특징'),
      h('ul', { class: 'chip-list' }, features.private.map((f) => h('li', { class: 'chip chip-private' }, f.text)))),
    claims ? [
      h('h2', { class: 'section-title' }, `검증 신청 ${claims.claims.length}건`),
      claims.claims.length === 0
        ? h('p', { class: 'muted' }, '아직 검증을 통과한 신청이 없습니다. 통과한 신청이 들어오면 알림을 보내드립니다.')
        : h('div', { class: 'claim-compare' }, claims.claims.map((c) => claimCard(c, item, reload))),
    ] : null);
}

export async function managePage({ params }) {
  if (!requireLogin()) return null;
  const item = await get(`/api/items/${params.id}/manage`);
  const reload = () => navigate(`/my/items/${item.id}`, { replace: true });
  return item.status === 'draft' ? draftView(item) : publishedView(item, reload);
}
