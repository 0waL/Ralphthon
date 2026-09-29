import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, evidenceBonus, narrativeScore, totalScore } from '../src/scoring.js';

const match = (featureId, statementIndex = 0) => ({ statementIndex, verdict: 'matches', featureId });
const wrong = (featureId, statementIndex = 0) => ({ statementIndex, verdict: 'contradicts', featureId });

test('서술형 점수는 맞힌 비공개 특징 비율이다', () => {
  const r = narrativeScore({ privateFeatureIds: [1, 2, 3, 4], matches: [match(1), match(3)], penaltyPerWrong: 10 });
  assert.equal(r.score, 50);
  assert.deepEqual(r.matchedFeatureIds, [1, 3]);
});

test('공개 특징을 맞힌 것은 점수에 들어가지 않는다', () => {
  const r = narrativeScore({ privateFeatureIds: [1, 2], matches: [match(9), match(1)], penaltyPerWrong: 10 });
  assert.equal(r.score, 50);
});

test('같은 특징을 여러 번 말해도 한 번만 센다', () => {
  const r = narrativeScore({ privateFeatureIds: [1, 2], matches: [match(1, 0), match(1, 1)], penaltyPerWrong: 10 });
  assert.equal(r.score, 50);
});

test('틀린 특징은 감점하고 0점 아래로 내려가지 않는다', () => {
  const r = narrativeScore({ privateFeatureIds: [1, 2], matches: [match(1), wrong(2, 1)], penaltyPerWrong: 10 });
  assert.equal(r.score, 40);
  assert.equal(r.wrongCount, 1);
  const floor = narrativeScore({ privateFeatureIds: [1], matches: [wrong(1), wrong(1, 1)], penaltyPerWrong: 60 });
  assert.equal(floor.score, 0);
});

test('비공개 특징이 없으면 0점이다', () => {
  assert.equal(narrativeScore({ privateFeatureIds: [], matches: [match(1)] }).score, 0);
});

test('증빙 가산점 규칙', () => {
  const photo = (over) => ({ kind: 'other', privateFeatureIdsVisible: [], sameTypeAndColor: false, aiGeneratedSuspected: false, ...over });
  assert.deepEqual(evidenceBonus(null), { bonus: 0, kind: 'none', aiSuspected: false });
  assert.equal(evidenceBonus({ photos: [photo({ kind: 'holding_photo', privateFeatureIdsVisible: [3] })] }).bonus, 20);
  assert.equal(evidenceBonus({ photos: [photo({ kind: 'holding_photo', sameTypeAndColor: true })] }).bonus, 5);
  assert.equal(evidenceBonus({ photos: [photo({ kind: 'purchase_record' })] }).bonus, 5);
  assert.equal(evidenceBonus({ photos: [photo({ kind: 'other' })] }).bonus, 0);
  // 가장 좋은 사진 하나만 인정한다 (최대 +20)
  assert.equal(evidenceBonus({
    photos: [photo({ kind: 'purchase_record' }), photo({ kind: 'holding_photo', privateFeatureIdsVisible: [1] })],
  }).bonus, 20);
  // AI 생성 의심이 하나라도 있으면 0점 + 경고
  const suspected = evidenceBonus({
    photos: [photo({ kind: 'holding_photo', privateFeatureIdsVisible: [1] }), photo({ aiGeneratedSuspected: true })],
  });
  assert.deepEqual(suspected, { bonus: 0, kind: 'ai_suspected', aiSuspected: true });
});

test('문서의 예시대로 판정한다', () => {
  // 증빙 없음, 서술형 80점 -> 80점 -> 통과
  assert.equal(decide(totalScore(80, 0), false), 'awaiting_finder');
  // 증빙 +20, 서술형 60점 -> 80점 -> 통과
  assert.equal(decide(totalScore(60, 20), false), 'awaiting_finder');
  // 증빙 +5, 서술형 70점 -> 75점 -> 추가 질문
  assert.equal(decide(totalScore(70, 5), false), 'followup');
  // 50점 미만 -> 실패
  assert.equal(decide(49, false), 'failed');
  assert.equal(decide(50, false), 'followup');
  // 추가 질문 후에도 80점 미만 -> 실패
  assert.equal(decide(79, true), 'failed');
  assert.equal(decide(80, true), 'awaiting_finder');
});
