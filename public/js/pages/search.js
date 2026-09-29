// 분실자 검색 상태 (기본 화면). 목록에는 분실물 사진을 넣지 않는다.
import { get } from '../api.js';
import { navigate } from '../app.js';
import { formatDateTime, h } from '../dom.js';

export function itemCard(item) {
  return h('li', {},
    h('a', { href: `/items/${item.id}`, class: 'item-card' },
      h('div', { class: 'item-card-head' },
        h('h3', {}, item.title),
        h('div', { class: 'tags' },
          h('span', { class: 'tag' }, item.category),
          item.custody === 'institution' ? h('span', { class: 'tag tag-accent' }, '기관 보관') : null)),
      h('p', { class: 'item-card-desc' }, item.publicDescription),
      h('dl', { class: 'meta' },
        h('div', {}, h('dt', {}, '습득 장소'), h('dd', {}, item.foundPlace)),
        h('div', {}, h('dt', {}, '습득 시간'), h('dd', {}, formatDateTime(item.foundAt))))));
}

export async function searchPage({ query }) {
  const q = query.get('q') ?? '';
  const from = query.get('from') ?? '';

  const qInput = h('input', {
    type: 'search', name: 'q', value: q, maxlength: 200, 'aria-label': '분실물 설명',
    placeholder: '잃어버린 물건을 설명해 주세요. 예) 강남역에서 남색 반지갑',
  });
  const fromInput = h('input', { type: 'date', name: 'from', value: from, 'aria-label': '이 날짜 이후에 습득된 물건만' });
  const form = h('form', {
    class: 'search-form',
    role: 'search',
    onsubmit: (e) => {
      e.preventDefault();
      const params = new URLSearchParams();
      if (qInput.value.trim()) params.set('q', qInput.value.trim());
      if (fromInput.value) params.set('from', fromInput.value);
      const qs = params.toString();
      navigate(qs ? `/?${qs}` : '/');
    },
  },
  h('div', { class: 'search-row' }, qInput, h('button', { type: 'submit', class: 'button button-primary' }, '검색')),
  h('label', { class: 'search-date' }, '잃어버린 날짜 이후만 ', fromInput));

  const params = new URLSearchParams({ limit: '30' });
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  const result = await get(`/api/items?${params}`);

  const heading = q || from ? `검색 결과 ${result.total}건` : '최근 들어온 분실물';
  const list = result.items.length > 0
    ? h('ul', { class: 'item-list' }, result.items.map(itemCard))
    : h('div', { class: 'empty' },
      h('p', {}, q || from ? '조건에 맞는 분실물이 없습니다.' : '아직 등록된 분실물이 없습니다.'),
      q ? h('p', { class: 'muted' }, '색, 종류, 장소처럼 겉으로 보이는 특징으로 검색해 보세요.') : null);

  return h('section', { class: 'page' },
    h('div', { class: 'search-hero' },
      h('h1', {}, '잃어버린 물건을 찾아보세요'),
      form),
    h('h2', { class: 'section-title' }, heading),
    list);
}
