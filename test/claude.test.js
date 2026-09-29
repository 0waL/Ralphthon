// 실제 API를 부르지 않고 Claude 연동 코드의 요청 형태와 응답 처리를 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiError, createClaudeAi } from '../src/ai/claude.js';

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          const next = responses.shift();
          if (next instanceof Error) throw next;
          return {
            stop_reason: next.stop_reason ?? 'end_turn',
            content: [{ type: 'text', text: typeof next.json === 'string' ? next.json : JSON.stringify(next.json) }],
          };
        },
      },
    },
  };
}

test('구조화 출력과 서버 측 fallback을 켜서 요청한다', async () => {
  const client = fakeClient([{ json: { statements: ['남색 반지갑'] } }]);
  const ai = createClaudeAi({ client });
  await ai.extractStatements({ text: '남색 반지갑이에요' });
  const [params] = client.calls;
  assert.equal(params.model, 'claude-opus-5-5');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.match(params.messages[0].content[0].text, /<claim>\n남색 반지갑이에요\n<\/claim>/);
});

test('서술형 답변을 읽는 단계는 비공개 특징을 보지 못한다', async () => {
  const client = fakeClient([{ json: { statements: [] } }]);
  const ai = createClaudeAi({ client });
  await ai.extractStatements({ text: '아무 말' });
  assert.ok(!JSON.stringify(client.calls[0]).includes('비공개'));
});

test('비교 결과에서 잘못된 번호와 없는 특징은 버린다', async () => {
  const client = fakeClient([{
    json: {
      results: [
        { statement_index: 0, verdict: 'matches', feature_id: 7 },
        { statement_index: 0, verdict: 'contradicts', feature_id: 7 }, // 같은 진술 중복
        { statement_index: 1, verdict: 'matches', feature_id: 999 }, // 없는 특징
        { statement_index: 5, verdict: 'matches', feature_id: 7 }, // 없는 진술
      ],
    },
  }]);
  const ai = createClaudeAi({ client });
  const { matches } = await ai.matchStatements({
    features: [{ id: 7, text: '딸기 스티커', visibility: 'private' }],
    statements: ['스티커가 있어요', '빨간색이에요'],
  });
  assert.deepEqual(matches, [
    { statementIndex: 0, verdict: 'matches', featureId: 7 },
    { statementIndex: 1, verdict: 'unrelated', featureId: null },
  ]);
});

test('습득자의 비공개 메모에서 나온 특징은 비공개로 표시한다', async () => {
  const client = fakeClient([{
    json: {
      features: [
        { text: '남색', kind: 'color', source: 'both', includes_private_note: false },
        { text: '안감이 빨간색', kind: 'color', source: 'finder', includes_private_note: true },
      ],
    },
  }]);
  const ai = createClaudeAi({ client });
  const { features } = await ai.analyzeFoundItem({
    category: '지갑', publicInput: ['남색'], privateInput: ['안쪽이 빨간색'], photos: [],
  });
  assert.equal(features[0].finderVisibility, undefined);
  assert.equal(features[1].finderVisibility, 'private');
});

test('증빙 분석에서 공개 특징 id는 비공개 특징으로 인정하지 않는다', async () => {
  const client = fakeClient([{
    json: {
      photos: [{
        photo_index: 0, kind: 'holding_photo', visible_private_feature_ids: [1, 2], same_type_and_color: true,
        ai_generated_suspected: false, note: '스티커가 보입니다.',
      }],
    },
  }]);
  const ai = createClaudeAi({ client });
  const photo = { mediaType: 'image/png', data: Buffer.from('x') };
  const { photos } = await ai.analyzeEvidence({
    features: [{ id: 1, text: '남색', visibility: 'public' }, { id: 2, text: '딸기 스티커', visibility: 'private' }],
    originalPhotos: [photo],
    evidencePhotos: [photo],
  });
  assert.deepEqual(photos[0].privateFeatureIdsVisible, [2]);
});

test('요청 크기 제한을 넘지 않도록 사진 수를 줄인다', async () => {
  const big = { mediaType: 'image/jpeg', data: Buffer.alloc(5 * 1024 * 1024) };
  const client = fakeClient([{ json: { features: [] } }, { json: { photos: [] } }]);
  const ai = createClaudeAi({ client });
  const imageCount = (call) => call.messages[0].content.filter((b) => b.type === 'image').length;

  await ai.analyzeFoundItem({ category: '지갑', publicInput: [], privateInput: [], photos: [big, big, big, big, big] });
  assert.equal(imageCount(client.calls[0]), 4);

  // 증빙 3장(15MB)은 모두 보내고 원본은 남은 예산(5MB)만큼
  await ai.analyzeEvidence({ features: [], originalPhotos: [big, big, big], evidencePhotos: [big, big, big] });
  assert.equal(imageCount(client.calls[1]), 4);
});

test('거절되거나 JSON이 아니면 AiError', async () => {
  const refused = createClaudeAi({ client: fakeClient([{ stop_reason: 'refusal', json: '' }]) });
  await assert.rejects(refused.extractStatements({ text: 'x' }), AiError);
  const broken = createClaudeAi({ client: fakeClient([{ json: 'not json' }]) });
  await assert.rejects(broken.extractStatements({ text: 'x' }), AiError);
});
