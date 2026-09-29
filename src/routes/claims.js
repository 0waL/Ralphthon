// 소유권 검증 흐름 (검증 구조 4장).
import express from 'express';
import { AiError } from '../ai/index.js';
import { DEFAULT_QUESTIONS } from '../ai/heuristic.js';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { now, transaction } from '../db.js';
import { badRequest, forbidden, HttpError, notFound, parseId, requiredString } from '../http.js';
import { notify, recordFailure } from '../moderation.js';
import { decide, evidenceBonus, narrativeScore, totalScore } from '../scoring.js';
import { tokenize, tokensOverlap } from '../text.js';
import { readImages, uploadMiddleware } from '../uploads.js';

const STATUS_MESSAGES = {
  awaiting_finder: '검증을 통과했습니다. 습득자가 신청 내용을 확인하면 알림을 보내드립니다.',
  followup: '확인을 위해 추가 질문에 답해 주세요.',
  failed: '검증에 실패했습니다.',
  approved: '습득자가 승인했습니다. 채팅방에서 반환 방법을 정하세요.',
  rejected: '습득자가 신청을 거절했습니다.',
  closed: '다른 신청이 승인되어 이 신청은 종료되었습니다.',
};

function aiUnavailable() {
  return new HttpError(503, 'AI 분석이 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요. 시도 횟수는 차감되지 않았습니다.');
}

/** 추가 질문이 비공개 특징을 암시하면 안 된다. 공개 설명에 없는 비공개 특징 단어가 들어간 질문은 버린다. */
function safeQuestions(questions, { privateFeatures, publicText, count }) {
  const publicTokens = tokenize(publicText);
  const secretTokens = privateFeatures
    .flatMap((f) => tokenize(f.text))
    .filter((t) => !publicTokens.some((p) => tokensOverlap(p, t)));
  const safe = questions.filter((q) => {
    const qTokens = tokenize(q);
    return !qTokens.some((qt) => secretTokens.some((st) => tokensOverlap(qt, st)));
  });
  for (const fallback of DEFAULT_QUESTIONS) {
    if (safe.length >= count) break;
    if (!safe.includes(fallback)) safe.push(fallback);
  }
  return safe.slice(0, count);
}

export function claimsRouter({ db, ai, photos }) {
  const router = express.Router();

  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const getClaim = db.prepare('SELECT * FROM claims WHERE id = ?');
  const getFeatures = db.prepare('SELECT id, text, kind, visibility FROM item_features WHERE item_id = ? ORDER BY id');
  const countAttempts = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND claimant_id = ?');
  const countActive = db.prepare(`
    SELECT COUNT(*) AS n FROM claims WHERE item_id = ? AND claimant_id = ? AND status IN ('followup', 'awaiting_finder')
  `);
  const countRecent = db.prepare('SELECT COUNT(*) AS n FROM claims WHERE claimant_id = ? AND created_at > ?');

  function checkLimits(item, userId) {
    if (item.status !== 'published') throw badRequest('검증 신청을 받을 수 없는 물건입니다.');
    if (item.custody !== 'finder') throw badRequest('기관에 제출된 물건은 검증 없이 기관에 문의하면 됩니다.');
    if (item.finder_id === userId) throw badRequest('직접 등록한 물건에는 신청할 수 없습니다.');
    if (countActive.get(item.id, userId).n > 0) throw badRequest('이미 진행 중인 신청이 있습니다.');
    if (countAttempts.get(item.id, userId).n >= config.maxAttemptsPerItem) {
      throw new HttpError(429, '이 물건에 대한 시도 횟수를 모두 사용했습니다.');
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    if (countRecent.get(userId, since).n >= config.maxClaimsPerDay) {
      throw new HttpError(429, '오늘 신청할 수 있는 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.');
    }
  }

  async function scoreNarrative(features, text) {
    const { statements } = await ai.extractStatements({ text });
    const { matches } = await ai.matchStatements({ features, statements });
    const privateFeatureIds = features.filter((f) => f.visibility === 'private').map((f) => f.id);
    return { statements, ...narrativeScore({ privateFeatureIds, matches }) };
  }

  function claimantView(claim) {
    const item = getItem.get(claim.item_id);
    const attempts = countAttempts.get(claim.item_id, claim.claimant_id).n;
    return {
      id: claim.id,
      itemId: claim.item_id,
      itemTitle: item.title,
      status: claim.status,
      message: STATUS_MESSAGES[claim.status],
      // 실패했을 때 어느 부분이 틀렸는지, 점수가 몇 점인지 알려주지 않는다.
      questions: claim.status === 'followup' ? JSON.parse(claim.followup_questions ?? '[]') : null,
      attemptsLeft: Math.max(0, config.maxAttemptsPerItem - attempts),
      chatRoomId: db.prepare('SELECT id FROM chat_rooms WHERE claim_id = ?').get(claim.id)?.id ?? null,
      createdAt: claim.created_at,
    };
  }

  function afterDecision(claim, item) {
    if (claim.status === 'awaiting_finder') {
      notify(db, item.finder_id, `"${item.title}"에 검증을 통과한 신청이 들어왔습니다. 확인해 주세요.`, `/my/items/${item.id}`);
    } else if (claim.status === 'failed') {
      recordFailure(db, claim.claimant_id);
    }
  }

  // 1~7단계: 서술형 답변(+ 선택 증빙 사진) → 특징 추출 → 코드로 점수 계산 → 처리
  router.post('/items/:id/claims', requireUser, uploadMiddleware('evidence', config.maxEvidencePhotos), async (req, res) => {
    const item = getItem.get(parseId(req.params.id));
    if (!item) throw notFound();
    checkLimits(item, req.user.id);
    const answer = requiredString(req.body ?? {}, 'answer', '물건의 특징', { max: 2000 });
    const evidence = readImages(req.files);
    const features = getFeatures.all(item.id);

    let narrative;
    let evidenceResult = null;
    try {
      narrative = await scoreNarrative(features, answer);
      if (evidence.length > 0) {
        const originals = db.prepare('SELECT filename, media_type FROM item_photos WHERE item_id = ? ORDER BY position')
          .all(item.id)
          .map((p) => photos.load(p.filename, p.media_type));
        evidenceResult = await ai.analyzeEvidence({ features, originalPhotos: originals, evidencePhotos: evidence });
      }
    } catch (err) {
      if (err instanceof AiError) {
        console.warn('claim scoring failed:', err.message);
        throw aiUnavailable();
      }
      throw err;
    }

    const bonus = evidenceBonus(evidenceResult);
    const total = totalScore(narrative.score, bonus.bonus);
    const status = decide(total, false);

    let questions = null;
    if (status === 'followup') {
      const privateFeatures = features.filter((f) => f.visibility === 'private');
      let generated = [];
      try {
        generated = (await ai.followupQuestions({
          category: item.category, publicDescription: item.public_description, count: config.followupQuestionCount,
        })).questions;
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        console.warn('followupQuestions failed, using defaults:', err.message);
      }
      questions = safeQuestions(generated, {
        privateFeatures, publicText: `${item.title} ${item.category} ${item.public_description}`, count: config.followupQuestionCount,
      });
    }

    const evidenceNote = evidenceResult?.photos.map((p) => p.note).filter(Boolean).join(' / ') || null;
    const saved = evidence.map((image) => ({ filename: photos.save(image), mediaType: image.mediaType }));
    let claimId;
    try {
      claimId = transaction(db, () => {
        // AI를 기다리는 동안 다른 요청이 들어왔을 수 있으니 한 번 더 확인한다.
        checkLimits(getItem.get(item.id), req.user.id);
        const { lastInsertRowid } = db.prepare(`
          INSERT INTO claims (item_id, claimant_id, answer_text, status, narrative_score, evidence_bonus, total_score,
            matched_feature_ids, wrong_count, statements, evidence_kind, evidence_note, ai_suspected, followup_questions,
            ai_mode, created_at, decided_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.id, req.user.id, answer, status, narrative.score, bonus.bonus, total,
          JSON.stringify(narrative.matchedFeatureIds), narrative.wrongCount, JSON.stringify(narrative.statements),
          bonus.kind, evidenceNote, bonus.aiSuspected ? 1 : 0, questions ? JSON.stringify(questions) : null,
          ai.mode, now(), status === 'followup' ? null : now(),
        );
        const insertEvidence = db.prepare('INSERT INTO claim_evidence (claim_id, filename, media_type) VALUES (?, ?, ?)');
        for (const file of saved) insertEvidence.run(lastInsertRowid, file.filename, file.mediaType);
        const claim = getClaim.get(lastInsertRowid);
        afterDecision(claim, item);
        return claim.id;
      });
    } catch (err) {
      for (const file of saved) photos.remove(file.filename);
      throw err;
    }

    res.status(201).json(claimantView(getClaim.get(claimId)));
  });

  // 50~80점: 추가 질문에 답하면 점수를 다시 계산한다. 증빙 가산점은 그대로 유지한다.
  router.post('/claims/:id/followup', requireUser, async (req, res) => {
    const claim = getClaim.get(parseId(req.params.id));
    if (!claim || claim.claimant_id !== req.user.id) throw notFound();
    if (claim.status !== 'followup') throw badRequest('추가 질문에 답할 수 있는 상태가 아닙니다.');
    const questions = JSON.parse(claim.followup_questions ?? '[]');
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (answers.length !== questions.length) throw badRequest('모든 질문에 답해 주세요.');
    const cleaned = answers.map((a) => (typeof a === 'string' ? a.trim().slice(0, 1000) : ''));
    if (cleaned.some((a) => !a)) throw badRequest('모든 질문에 답해 주세요.');

    const item = getItem.get(claim.item_id);
    const features = getFeatures.all(item.id);
    let narrative;
    try {
      narrative = await scoreNarrative(features, [claim.answer_text, ...cleaned].join('\n'));
    } catch (err) {
      if (err instanceof AiError) {
        console.warn('followup scoring failed:', err.message);
        throw new HttpError(503, 'AI 분석이 일시적으로 실패했습니다. 잠시 후 다시 제출해 주세요.');
      }
      throw err;
    }
    const total = totalScore(narrative.score, claim.evidence_bonus);
    const status = decide(total, true);

    transaction(db, () => {
      const current = getClaim.get(claim.id);
      if (current.status !== 'followup') throw badRequest('추가 질문에 답할 수 있는 상태가 아닙니다.');
      db.prepare(`
        UPDATE claims SET status = ?, narrative_score = ?, total_score = ?, matched_feature_ids = ?, wrong_count = ?,
          statements = ?, followup_answers = ?, decided_at = ?
        WHERE id = ?
      `).run(
        status, narrative.score, total, JSON.stringify(narrative.matchedFeatureIds), narrative.wrongCount,
        JSON.stringify(narrative.statements), JSON.stringify(cleaned), now(), claim.id,
      );
      afterDecision(getClaim.get(claim.id), item);
    });
    res.json(claimantView(getClaim.get(claim.id)));
  });

  router.get('/claims/:id', requireUser, (req, res) => {
    const claim = getClaim.get(parseId(req.params.id));
    if (!claim || claim.claimant_id !== req.user.id) throw notFound();
    res.json(claimantView(claim));
  });

  router.get('/my/claims', requireUser, (req, res) => {
    const claims = db.prepare('SELECT * FROM claims WHERE claimant_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ claims: claims.map(claimantView) });
  });

  // 8단계: 습득자가 신청 내용과 점수, 경고 표시를 보고 승인/거절한다. 여러 신청을 나란히 비교할 수 있다.
  router.get('/items/:id/claims', requireUser, (req, res) => {
    const item = getItem.get(parseId(req.params.id));
    if (!item) throw notFound();
    if (item.finder_id !== req.user.id && !req.user.isAdmin) throw forbidden();
    const features = new Map(getFeatures.all(item.id).map((f) => [f.id, f]));
    const privateCount = [...features.values()].filter((f) => f.visibility === 'private').length;
    const rows = db.prepare(`
      SELECT c.*, u.username, u.watchlisted, u.warnings,
        (SELECT COUNT(*) FROM claims x WHERE x.claimant_id = c.claimant_id AND x.status IN ('failed', 'rejected')) AS failures,
        (SELECT id FROM chat_rooms r WHERE r.claim_id = c.id) AS chat_room_id
      FROM claims c JOIN users u ON u.id = c.claimant_id
      WHERE c.item_id = ? AND c.status IN ('awaiting_finder', 'approved', 'rejected')
      ORDER BY c.total_score DESC, c.id
    `).all(item.id);
    const evidenceFor = db.prepare('SELECT id FROM claim_evidence WHERE claim_id = ? ORDER BY id');

    res.json({
      item: { id: item.id, title: item.title, status: item.status },
      privateFeatureCount: privateCount,
      claims: rows.map((c) => {
        const warnings = [];
        if (c.ai_suspected) warnings.push('증빙 사진이 AI로 생성되었거나 편집된 것으로 의심됩니다.');
        if (c.watchlisted) warnings.push('관심 계정으로 등록된 신청자입니다.');
        if (c.warnings > 0) warnings.push(`신청자가 경고를 ${c.warnings}회 받은 적이 있습니다.`);
        if (c.failures > 0) warnings.push(`신청자의 검증 실패 기록이 ${c.failures}회 있습니다.`);
        if (c.wrong_count > 0) warnings.push(`기록과 다른 특징을 ${c.wrong_count}개 말했습니다.`);
        const questions = JSON.parse(c.followup_questions ?? 'null');
        const answers = JSON.parse(c.followup_answers ?? 'null');
        return {
          id: c.id,
          claimant: c.username,
          status: c.status,
          answer: c.answer_text,
          followup: questions && answers ? questions.map((q, i) => ({ question: q, answer: answers[i] })) : [],
          score: { narrative: c.narrative_score, evidenceBonus: c.evidence_bonus, total: c.total_score },
          matchedFeatures: JSON.parse(c.matched_feature_ids).map((id) => features.get(id)?.text).filter(Boolean),
          evidenceKind: c.evidence_kind,
          evidenceNote: c.evidence_note,
          evidence: evidenceFor.all(c.id).map((e) => ({ id: e.id, url: `/api/claims/${c.id}/evidence/${e.id}` })),
          warnings,
          chatRoomId: c.chat_room_id,
          createdAt: c.created_at,
        };
      }),
    });
  });

  function loadClaimForFinder(req) {
    const claim = getClaim.get(parseId(req.params.id));
    if (!claim) throw notFound();
    const item = getItem.get(claim.item_id);
    if (item.finder_id !== req.user.id) throw notFound();
    if (claim.status !== 'awaiting_finder') throw badRequest('승인을 기다리는 신청이 아닙니다.');
    if (item.status !== 'published') throw badRequest('이미 주인이 확인된 물건입니다.');
    return { claim, item };
  }

  // 9단계: 승인되면 채팅방이 열린다. 한 명만 승인할 수 있다.
  router.post('/claims/:id/approve', requireUser, (req, res) => {
    const { claim, item } = loadClaimForFinder(req);
    const roomId = transaction(db, () => {
      const at = now();
      db.prepare("UPDATE claims SET status = 'approved', decided_at = ? WHERE id = ?").run(at, claim.id);
      const others = db.prepare(`
        SELECT id, claimant_id FROM claims WHERE item_id = ? AND id != ? AND status IN ('awaiting_finder', 'followup')
      `).all(item.id, claim.id);
      db.prepare(`
        UPDATE claims SET status = 'closed', decided_at = ? WHERE item_id = ? AND id != ? AND status IN ('awaiting_finder', 'followup')
      `).run(at, item.id, claim.id);
      db.prepare("UPDATE items SET status = 'matched' WHERE id = ?").run(item.id);
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO chat_rooms (item_id, claim_id, finder_id, claimant_id, created_at) VALUES (?, ?, ?, ?, ?)
      `).run(item.id, claim.id, item.finder_id, claim.claimant_id, at);
      notify(db, claim.claimant_id, `"${item.title}" 검증이 승인되었습니다. 채팅방에서 습득자와 반환 방법을 정하세요.`, `/chats/${lastInsertRowid}`);
      for (const o of others) {
        notify(db, o.claimant_id, `"${item.title}"은(는) 다른 신청이 승인되어 신청이 종료되었습니다.`, `/claims/${o.id}`);
      }
      return Number(lastInsertRowid);
    });
    res.json({ ok: true, chatRoomId: roomId });
  });

  router.post('/claims/:id/reject', requireUser, (req, res) => {
    const { claim, item } = loadClaimForFinder(req);
    transaction(db, () => {
      db.prepare("UPDATE claims SET status = 'rejected', decided_at = ? WHERE id = ?").run(now(), claim.id);
      notify(db, claim.claimant_id, `"${item.title}" 신청이 습득자에 의해 거절되었습니다.`, `/claims/${claim.id}`);
      recordFailure(db, claim.claimant_id);
    });
    res.json({ ok: true });
  });

  // 증빙 사진은 해당 물건의 습득자와 신청자 본인만 볼 수 있다.
  router.get('/claims/:id/evidence/:evidenceId', requireUser, (req, res) => {
    const claim = getClaim.get(parseId(req.params.id));
    if (!claim) throw notFound();
    const item = getItem.get(claim.item_id);
    if (![item.finder_id, claim.claimant_id].includes(req.user.id) && !req.user.isAdmin) throw notFound();
    const file = db.prepare('SELECT filename, media_type FROM claim_evidence WHERE id = ? AND claim_id = ?')
      .get(parseId(req.params.evidenceId), claim.id);
    if (!file) throw notFound();
    res.set('Cache-Control', 'private, no-store');
    res.type(file.media_type).sendFile(photos.path(file.filename));
  });

  return router;
}
