import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPublicText, classify, splitFeatureInput } from '../src/features.js';
import { tokenize } from '../src/text.js';

test('조사를 떼고 색 동의어를 하나로 모은다', () => {
  assert.deepEqual(tokenize('네이비 지갑을 잃어버렸어요'), ['남색', '지갑']);
  assert.deepEqual(tokenize('검은색 우산이'), ['검정', '우산']);
  assert.deepEqual(tokenize('강남역에서'), ['강남역']);
  // 두 글자 단어에서는 조사처럼 보이는 글자를 떼지 않는다
  assert.deepEqual(tokenize('지갑'), ['지갑']);
});

test('특징 입력을 줄바꿈과 쉼표로 나눈다', () => {
  assert.deepEqual(splitFeatureInput('남색, 손바닥 크기\n반지갑 '), ['남색', '손바닥 크기', '반지갑']);
  assert.deepEqual(splitFeatureInput(undefined), []);
});

test('공개/비공개 자동 분류', () => {
  assert.equal(classify({ kind: 'color' }), 'public');
  assert.equal(classify({ kind: 'brand' }), 'public');
  assert.equal(classify({ kind: 'mark' }), 'private');
  assert.equal(classify({ kind: 'contents' }), 'private');
  // 사진 속 글자·숫자는 습득자가 공개 칸에 써도 비공개
  assert.equal(classify({ kind: 'text', finderVisibility: 'public' }), 'private');
  // 습득자가 비공개 칸에 쓴 것은 종류와 상관없이 비공개
  assert.equal(classify({ kind: 'color', finderVisibility: 'private' }), 'private');
});

test('공개 설명에 비공개 특징이 들어가면 막는다', () => {
  const privateFeatures = [{ text: '딸기 스티커' }, { text: '카드 2장' }];
  assert.equal(checkPublicText('남색 반지갑입니다.', privateFeatures).blocking.length, 0);
  assert.equal(checkPublicText('남색 반지갑, 딸기스티커 있음', privateFeatures).blocking.length, 1);
  assert.equal(checkPublicText('카드번호 1234-5678-9012', []).warnings.length, 1);
});
