// 분실자 검색. 공개 정보(제목, 종류, 공개 설명, 습득 장소, 습득 시간)만 대상으로 한다.
// 비공개 특징은 절대 검색에 쓰지 않는다: 검색 결과가 나오는지 보고 비공개 특징을 알아낼 수 있기 때문이다.
import { haystack, tokenize } from './text.js';

export const PUBLIC_ITEM_COLUMNS = `
  id, title, category, public_description, found_place, found_at, custody, status, published_at
`;

export function toPublicItem(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    publicDescription: row.public_description,
    foundPlace: row.found_place,
    foundAt: row.found_at,
    custody: row.custody,
    status: row.status,
    publishedAt: row.published_at,
  };
}

function foundAtWords(foundAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(foundAt ?? '');
  if (!m) return '';
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

export function searchItems(db, { q = '', from = '', limit = 20, offset = 0 } = {}) {
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
  const rows = db.prepare(`
    SELECT ${PUBLIC_ITEM_COLUMNS} FROM items
    WHERE status = 'published' AND (? IS NULL OR found_at >= ?)
    ORDER BY published_at DESC, id DESC
  `).all(fromDate, fromDate);

  const tokens = [...new Set(tokenize(q))];
  let results = rows;
  if (tokens.length > 0) {
    results = rows
      .map((row) => {
        const text = haystack(row.title, row.category, row.public_description, row.found_place, foundAtWords(row.found_at));
        const hits = tokens.filter((t) => text.includes(t)).length;
        return { row, hits };
      })
      .filter((r) => r.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .map((r) => r.row);
  }
  return {
    total: results.length,
    items: results.slice(offset, offset + limit).map(toPublicItem),
  };
}
