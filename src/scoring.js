// 점수는 AI가 아니라 이 코드가 계산한다 (검증 구조 5장).
// AI는 "어떤 진술이 어떤 특징과 맞는지/어긋나는지"만 알려주고, 합산과 판정은 여기서 한다.
import { config } from './config.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 서술형 점수: (맞힌 비공개 특징 수 / 전체 비공개 특징 수) x 100 - 틀린 특징 감점.
 * @param {{ privateFeatureIds: number[], matches: { statementIndex: number, verdict: string, featureId: number|null }[], penaltyPerWrong?: number }} input
 */
export function narrativeScore({ privateFeatureIds, matches, penaltyPerWrong = config.wrongFeaturePenalty }) {
  const privateSet = new Set(privateFeatureIds);
  const matched = new Set();
  let wrongCount = 0;
  for (const m of matches) {
    if (m.verdict === 'matches' && m.featureId !== null && privateSet.has(m.featureId)) {
      matched.add(m.featureId);
    } else if (m.verdict === 'contradicts') {
      wrongCount += 1;
    }
  }
  const total = privateSet.size;
  const base = total === 0 ? 0 : (matched.size / total) * 100;
  const score = Math.round(clamp(base - wrongCount * penaltyPerWrong, 0, 100));
  return { score, matchedFeatureIds: [...matched].sort((a, b) => a - b), wrongCount };
}

/**
 * 증빙 가산점 (최대 +20). AI 생성 의심이 하나라도 있으면 0점이고 습득자에게 경고한다.
 * @param {{ photos: { kind: string, privateFeatureIdsVisible: number[], sameTypeAndColor: boolean, aiGeneratedSuspected: boolean }[] } | null} evidence
 */
export function evidenceBonus(evidence) {
  const bonus = config.evidenceBonus;
  if (!evidence || evidence.photos.length === 0) {
    return { bonus: 0, kind: 'none', aiSuspected: false };
  }
  if (evidence.photos.some((p) => p.aiGeneratedSuspected)) {
    return { bonus: 0, kind: 'ai_suspected', aiSuspected: true };
  }
  let best = { bonus: 0, kind: 'unrecognized' };
  for (const p of evidence.photos) {
    let candidate = { bonus: 0, kind: 'unrecognized' };
    if (p.kind === 'holding_photo' && p.privateFeatureIdsVisible.length > 0) {
      candidate = { bonus: bonus.privateFeatureVisible, kind: 'holding_private_visible' };
    } else if (p.kind === 'holding_photo' && p.sameTypeAndColor) {
      candidate = { bonus: bonus.sameTypeAndColor, kind: 'holding_type_color' };
    } else if (p.kind === 'purchase_record') {
      candidate = { bonus: bonus.purchaseRecord, kind: 'purchase_record' };
    }
    if (candidate.bonus > best.bonus) best = candidate;
  }
  return { ...best, aiSuspected: false };
}

/**
 * 점수에 따른 처리 (4장 7단계).
 * @param {number} total 최종 점수
 * @param {boolean} afterFollowup 추가 질문을 이미 거쳤는지
 * @returns {'awaiting_finder' | 'followup' | 'failed'}
 */
export function decide(total, afterFollowup) {
  if (total >= config.passScore) return 'awaiting_finder';
  if (!afterFollowup && total >= config.followupMinScore) return 'followup';
  return 'failed';
}

export function totalScore(narrative, bonus) {
  return narrative + bonus;
}
