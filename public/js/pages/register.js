// 습득자 등록 화면: 등록 양식 → AI 분석 → 검토 화면(/my/items/:id)
import { post } from '../api.js';
import { navigate, requireLogin, session } from '../app.js';
import { errorBox, h, photoPicker, withOverlay } from '../dom.js';

const CATEGORIES = ['지갑', '휴대폰', '이어폰', '가방', '우산', '카드', '신분증', '열쇠', '노트북', '시계', '안경', '옷', '기타'];

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function field(label, input, hint) {
  return h('div', { class: 'field' },
    h('label', { for: input.id }, label),
    hint ? h('p', { class: 'hint' }, hint) : null,
    input);
}

export function custodyFields(initial = {}) {
  const finderRadio = h('input', { type: 'radio', name: 'custody', value: 'finder', checked: initial.custody !== 'institution' });
  const instRadio = h('input', { type: 'radio', name: 'custody', value: 'institution', checked: initial.custody === 'institution' });
  const name = h('input', { type: 'text', id: 'institutionName', maxlength: 100, value: initial.institution?.name ?? '', placeholder: '예) 강남경찰서 유실물센터' });
  const location = h('input', { type: 'text', id: 'institutionLocation', maxlength: 200, value: initial.institution?.location ?? '' });
  const contact = h('input', { type: 'text', id: 'institutionContact', maxlength: 100, value: initial.institution?.contact ?? '', placeholder: '예) 02-000-0000' });
  const instBox = h('div', { class: 'sub-fields' },
    field('기관 이름', name), field('기관 위치', location), field('기관 연락처', contact));

  function sync() {
    const inst = instRadio.checked;
    instBox.hidden = !inst;
    for (const input of [name, location, contact]) input.required = inst;
  }
  finderRadio.addEventListener('change', sync);
  instRadio.addEventListener('change', sync);
  sync();

  return {
    node: h('fieldset', { class: 'field' },
      h('legend', {}, '보관 방법'),
      h('div', { class: 'radio-row' },
        h('label', { class: 'radio' }, finderRadio, ' 제가 보관하고 있어요'),
        h('label', { class: 'radio' }, instRadio, ' 기관(경찰서, 역 유실물센터 등)에 제출했어요')),
      h('p', { class: 'hint' }, '기관에 제출한 물건은 검증 없이 기관 위치와 연락처를 바로 안내합니다.'),
      instBox),
    values() {
      return {
        custody: instRadio.checked ? 'institution' : 'finder',
        institutionName: name.value.trim(),
        institutionLocation: location.value.trim(),
        institutionContact: contact.value.trim(),
      };
    },
  };
}

export function registerPage() {
  if (!requireLogin()) return null;

  const category = h('input', { type: 'text', id: 'category', required: true, maxlength: 40, list: 'category-list', placeholder: '예) 지갑' });
  const title = h('input', { type: 'text', id: 'title', maxlength: 40, placeholder: '비워 두면 AI가 공개 특징으로 만듭니다' });
  const publicFeatures = h('textarea', { id: 'publicFeatures', rows: 3, maxlength: 1000, placeholder: '예) 남색, 손바닥 크기, 반지갑' });
  const privateFeatures = h('textarea', { id: 'privateFeatures', rows: 4, maxlength: 1000, placeholder: '예) 딸기 모양 스티커\n신용카드 2장\n모서리 가죽 벗겨짐' });
  const foundPlace = h('input', { type: 'text', id: 'foundPlace', required: true, maxlength: 200, placeholder: '예) 강남역 2번 출구 앞' });
  const foundAt = h('input', { type: 'datetime-local', id: 'foundAt', required: true, value: localNow(), max: localNow() });
  const custody = custodyFields();
  const photos = photoPicker({
    name: 'photos', max: 5, label: '사진 첨부',
    hint: '최대 5장. 사진은 공개되지 않습니다. AI가 특징을 뽑는 데에만 쓰고, 상세 페이지에는 사진 대신 짧은 설명만 보여줍니다.',
  });
  const error = errorBox();

  const form = h('form', {
    class: 'form-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      if (photos.files.length === 0) {
        error.show('사진을 1장 이상 첨부하세요.');
        return;
      }
      const data = new FormData();
      data.append('category', category.value.trim());
      data.append('title', title.value.trim());
      data.append('publicFeatures', publicFeatures.value);
      data.append('privateFeatures', privateFeatures.value);
      data.append('foundPlace', foundPlace.value.trim());
      data.append('foundAt', foundAt.value);
      for (const [k, v] of Object.entries(custody.values())) data.append(k, v);
      for (const file of photos.files) data.append('photos', file);
      try {
        const item = await withOverlay(
          session.aiMode === 'claude' ? 'AI가 사진에서 특징을 찾고 있어요. 잠시만 기다려 주세요…' : '등록하는 중…',
          () => post('/api/items', data),
        );
        navigate(`/my/items/${item.id}`);
      } catch (err) {
        error.show(err.message);
      }
    },
  },
  h('h1', {}, '습득물 등록'),
  h('p', { class: 'muted' }, '등록하면 AI가 사진을 분석해 특징을 정리하고, 게시 전에 공개 설명을 확인할 수 있어요.'),
  error.node,
  h('div', { class: 'form-grid' },
    field('분실물 종류', category),
    field('이름 (선택)', title)),
  h('datalist', { id: 'category-list' }, CATEGORIES.map((c) => h('option', { value: c }))),
  field('공개 특징 (색, 크기, 모양)', publicFeatures, '누구나 볼 수 있는 겉모습. 검색과 공개 설명에 쓰입니다. 쉼표나 줄바꿈으로 구분하세요.'),
  field('비공개 특징 (주인만 알 만한 것)', privateFeatures, '흠집, 얼룩, 스티커, 키링, 내용물, 적힌 글자 등. 절대 공개되지 않고 주인 확인에만 쓰입니다.'),
  h('div', { class: 'form-grid' },
    field('습득 장소', foundPlace),
    field('습득 시간', foundAt)),
  custody.node,
  photos.node,
  h('button', { type: 'submit', class: 'button button-primary button-block' }, '등록하고 AI 분석하기'));

  return h('section', { class: 'page narrow' }, form);
}
