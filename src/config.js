// 검증 구조 문서의 숫자들. "추후 결정"으로 남은 값은 임시 기본값이며 환경 변수로 바꿀 수 있다.

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  // 5장: 점수 계산
  passScore: 80,
  followupMinScore: 50,
  // 틀린 특징 1개당 감점 폭 (추후 결정)
  wrongFeaturePenalty: intFromEnv('WRONG_FEATURE_PENALTY', 10),
  evidenceBonus: {
    privateFeatureVisible: 20,
    sameTypeAndColor: 5,
    purchaseRecord: 5,
  },

  // 7장: 추가 질문 (2~3번)
  followupQuestionCount: 3,

  // 8장: 어뷰징 방지
  maxAttemptsPerItem: 2,
  // 계정당 하루 신청 수 제한 (추후 결정)
  maxClaimsPerDay: intFromEnv('MAX_CLAIMS_PER_DAY', 5),
  // 실패가 이만큼 쌓이면 자동으로 관심 계정에 등록
  watchlistFailureThreshold: intFromEnv('WATCHLIST_FAILURE_THRESHOLD', 3),

  // 등록 양식
  maxItemPhotos: 5,
  maxEvidencePhotos: 3,
  maxUploadBytes: 5 * 1024 * 1024,
  // 비공개 특징이 이보다 적으면 습득자에게 검증이 약하다고 알린다 (9장의 미결 문제)
  lowPrivateFeatureWarning: 3,

  sessionDays: 14,
};
