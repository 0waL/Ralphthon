// 검색과 간이(비 AI) 모드에서 쓰는 한국어 텍스트 처리.

// 긴 조사부터 확인해야 "에서"가 "에"보다 먼저 떨어진다.
const PARTICLES = [
  '에서는', '으로는', '이라고', '에서', '으로', '에게', '까지', '부터', '이랑', '하고', '처럼', '보다', '라고',
  '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '랑', '만',
];

const STOPWORDS = new Set([
  '잃어버렸어요', '잃어버렸습니다', '잃어버린', '잃어버렸는데', '분실', '분실했어요', '찾아요', '찾고', '찾습니다',
  '있어요', '있습니다', '있었어요', '있었습니다', '있는', '있고', '같아요', '같습니다', '정도', '그리고', '제가', '제',
  '저', '내', '나', '것', '거', '약간', '조금', '좀', '아마', '되어', '있음', '있었음', '했어요', '입니다', '이에요', '예요',
]);

// 같은 색을 가리키는 말들을 하나로 모은다.
const SYNONYMS = new Map();
function addSynonyms(canonical, words) {
  for (const w of words) SYNONYMS.set(w, canonical);
}
addSynonyms('검정', ['검정', '검정색', '검은', '검은색', '까만', '까만색', '블랙', 'black']);
addSynonyms('남색', ['남색', '네이비', 'navy', '곤색']);
addSynonyms('파랑', ['파랑', '파란', '파란색', '파랑색', '블루', 'blue']);
addSynonyms('빨강', ['빨강', '빨간', '빨간색', '빨강색', '레드', 'red']);
addSynonyms('흰색', ['흰', '흰색', '하얀', '하얀색', '화이트', 'white']);
addSynonyms('회색', ['회색', '그레이', 'gray', 'grey']);
addSynonyms('갈색', ['갈색', '브라운', 'brown']);
addSynonyms('노랑', ['노랑', '노란', '노란색', '노랑색', '옐로우', 'yellow']);
addSynonyms('초록', ['초록', '초록색', '녹색', '그린', 'green']);
addSynonyms('분홍', ['분홍', '분홍색', '핑크', 'pink']);
addSynonyms('보라', ['보라', '보라색', '퍼플', 'purple']);
addSynonyms('은색', ['은색', '실버', 'silver']);
addSynonyms('금색', ['금색', '골드', 'gold']);
addSynonyms('주황', ['주황', '주황색', '오렌지', 'orange']);

export const COLOR_WORDS = new Set(SYNONYMS.values());

export function normalize(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripParticle(token) {
  if (SYNONYMS.has(token)) return token;
  for (const p of PARTICLES) {
    if (token.length - p.length >= 2 && token.endsWith(p)) {
      return token.slice(0, -p.length);
    }
  }
  return token;
}

function canonical(token) {
  return SYNONYMS.get(token) ?? token;
}

/** 의미 있는 토큰 목록 (조사 제거, 색 동의어 정리, 불용어 제거). */
export function tokenize(text) {
  const out = [];
  for (const raw of normalize(text).split(' ')) {
    if (!raw || STOPWORDS.has(raw)) continue;
    const token = canonical(stripParticle(raw));
    if (STOPWORDS.has(token)) continue;
    if (token.length < 2 && !/^\d+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** 검색 대상 텍스트를 토큰화해서 이어 붙인 문자열. 부분 일치(includes) 검색에 쓴다. */
export function haystack(...parts) {
  return tokenize(parts.join(' ')).join(' ');
}

/** 두 토큰이 같은 것을 가리키는지 (한쪽이 다른 쪽을 포함하면 같다고 본다: "지갑" / "반지갑"). */
export function tokensOverlap(a, b) {
  if (a === b) return true;
  if (a.length < 2 || b.length < 2) return false;
  return a.includes(b) || b.includes(a);
}
