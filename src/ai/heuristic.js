// ANTHROPIC_API_KEY가 없을 때 쓰는 간이 모드.
// 사진 분석은 하지 않고, 서술형 답변은 단어 겹침으로 비교한다. 개발·시연용이다.
import { featuresFromFinderInput, templateDescription } from '../features.js';
import { COLOR_WORDS, tokenize, tokensOverlap } from '../text.js';

const DEFAULT_QUESTIONS = [
  '바깥 면에 눈에 띄는 점이 있었나요?',
  '안에 무엇이 들어 있었나요?',
  '평소에 어떻게 사용하셨는지, 사용하면서 생긴 흔적이 있다면 설명해 주세요.',
  '마지막으로 가지고 있던 때와 장소를 설명해 주세요.',
];

function overlapCount(featureTokens, statementTokens) {
  let count = 0;
  for (const f of featureTokens) {
    if (statementTokens.some((s) => tokensOverlap(f, s))) count += 1;
  }
  return count;
}

export function createHeuristicAi() {
  return {
    mode: 'heuristic',

    async analyzeFoundItem({ publicInput, privateInput }) {
      return { features: featuresFromFinderInput({ publicInput, privateInput }) };
    },

    async writePublicDescription({ category, publicFeatures }) {
      return templateDescription({ category, publicFeatures });
    },

    async extractStatements({ text }) {
      const statements = String(text)
        .split(/[.!?。\n]|,|그리고/)
        .map((s) => s.trim())
        .filter((s) => tokenize(s).length > 0)
        .map((s) => s.slice(0, 100))
        .slice(0, 20);
      return { statements };
    },

    async matchStatements({ features, statements }) {
      const featureTokens = features.map((f) => ({ ...f, tokens: tokenize(f.text) }));
      const allFeatureTokens = featureTokens.flatMap((f) => f.tokens);
      // 간이 모드에서는 문장을 사실 하나씩 나누지 못하므로 한 문장이 여러 특징과 맞을 수 있다.
      const matches = statements.flatMap((statement, statementIndex) => {
        const sTokens = tokenize(statement);
        const matched = featureTokens.filter((f) => {
          if (f.tokens.length === 0) return false;
          const hit = overlapCount(f.tokens, sTokens);
          return hit > 0 && hit / f.tokens.length >= 0.5;
        });
        if (matched.length > 0) {
          return matched.map((f) => ({ statementIndex, verdict: 'matches', featureId: f.id }));
        }

        // 물건 전체를 가리키면서 기록에 없는 색을 말하면 틀린 특징으로 본다.
        // ("빨간 반지갑" vs 기록 "남색" + "손바닥 크기 반지갑". "빨간 스티커"처럼 부분을 말하면 판단하지 않는다.)
        const colors = sTokens.filter((t) => COLOR_WORDS.has(t));
        const others = sTokens.filter((t) => !COLOR_WORDS.has(t));
        const aboutWholeItem = featureTokens.some(
          (f) => f.visibility === 'public' && overlapCount(others, f.tokens) > 0,
        );
        if (aboutWholeItem && colors.length > 0 && colors.every((c) => !allFeatureTokens.includes(c))) {
          const target = featureTokens.find((f) => f.visibility === 'public' && f.tokens.some((t) => COLOR_WORDS.has(t)));
          if (target) return [{ statementIndex, verdict: 'contradicts', featureId: target.id }];
        }
        return [{ statementIndex, verdict: 'unrelated', featureId: null }];
      });
      return { matches };
    },

    async analyzeEvidence({ evidencePhotos }) {
      // 사진을 분석할 수 없으므로 가산점을 주지 않는다. 습득자는 사진을 직접 볼 수 있다.
      return {
        photos: evidencePhotos.map(() => ({
          kind: 'other',
          privateFeatureIdsVisible: [],
          sameTypeAndColor: false,
          aiGeneratedSuspected: false,
          note: 'AI를 사용하지 않는 모드라 증빙 사진을 분석하지 않았습니다.',
        })),
      };
    },

    async followupQuestions({ count }) {
      return { questions: DEFAULT_QUESTIONS.slice(0, count) };
    },
  };
}

export { DEFAULT_QUESTIONS };
