// 습득물 특징의 공개/비공개 분류와 공개 설명 검사 (검증 구조 2장).
import { COLOR_WORDS, normalize, tokenize } from './text.js';

// 공개 특징: 설명과 검색에 사용. 비공개 특징: 검증에만 사용.
export const PUBLIC_KINDS = ['category', 'color', 'size_shape', 'brand', 'appearance'];
export const PRIVATE_KINDS = ['mark', 'contents', 'text', 'other'];
export const ALL_KINDS = [...PUBLIC_KINDS, ...PRIVATE_KINDS];

export const KIND_LABELS = {
  category: '종류',
  color: '색상',
  size_shape: '크기·형태',
  brand: '브랜드',
  appearance: '외형',
  mark: '고유한 흔적',
  contents: '내용물',
  text: '글자·숫자',
  other: '기타',
};

/** 등록 양식의 여러 줄/쉼표 입력을 특징 하나씩으로 나눈다. */
export function splitFeatureInput(value) {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 80))
    .slice(0, 20);
}

/**
 * 합친 특징을 공개/비공개로 자동 분류한다.
 * - 습득자가 비공개 칸에 쓴 것은 항상 비공개.
 * - 사진 속 글자·숫자(text)는 개인정보일 수 있으므로 항상 비공개.
 * - 나머지는 종류(kind)로 정한다.
 */
export function classify({ kind, finderVisibility }) {
  if (finderVisibility === 'private') return 'private';
  if (kind === 'text') return 'private';
  return PUBLIC_KINDS.includes(kind) ? 'public' : 'private';
}

/** AI 없이 습득자 입력만으로 특징 목록을 만든다. */
export function featuresFromFinderInput({ publicInput, privateInput }) {
  const features = [];
  for (const text of publicInput) {
    const kind = tokenize(text).some((t) => COLOR_WORDS.has(t)) ? 'color' : 'appearance';
    features.push({ text, kind, source: 'finder', finderVisibility: 'public' });
  }
  for (const text of privateInput) {
    features.push({ text, kind: 'other', source: 'finder', finderVisibility: 'private' });
  }
  return features;
}

/**
 * 공개 설명에 비공개 정보가 섞였는지 검사한다.
 * @returns {{ blocking: string[], warnings: string[] }}
 */
export function checkPublicText(publicText, privateFeatures) {
  const blocking = [];
  const warnings = [];
  const normalizedText = normalize(publicText).replace(/\s/g, '');
  for (const f of privateFeatures) {
    const normalizedFeature = normalize(f.text).replace(/\s/g, '');
    if (normalizedFeature.length >= 2 && normalizedText.includes(normalizedFeature)) {
      blocking.push(`공개 설명에 비공개 특징 "${f.text}"이(가) 들어 있습니다.`);
    }
  }
  if (/\d{4,}/.test(String(publicText).replace(/[\s-]/g, ''))) {
    warnings.push('공개 설명에 긴 숫자가 있습니다. 카드 번호, 연락처 같은 개인정보가 아닌지 확인하세요.');
  }
  return { blocking, warnings };
}

/** 공개 특징만으로 만드는 기본 공개 설명 (AI를 쓰지 않을 때). 예) "남색 지갑" / "겉모습: 남색, 손바닥 크기 반지갑" */
export function templateDescription({ category, publicFeatures }) {
  const color = publicFeatures.flatMap((f) => tokenize(f.text)).find((t) => COLOR_WORDS.has(t));
  const title = [color, category].filter(Boolean).join(' ');
  const details = publicFeatures.filter((f) => f.kind !== 'category').map((f) => f.text);
  const description = details.length > 0 ? `겉모습: ${details.join(', ')}` : `${category}입니다.`;
  return { title, description };
}
