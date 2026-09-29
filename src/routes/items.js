import express from 'express';
import { AiError } from '../ai/index.js';
import { createHeuristicAi } from '../ai/heuristic.js';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { now, transaction } from '../db.js';
import {
  ALL_KINDS, checkPublicText, classify, splitFeatureInput, templateDescription,
} from '../features.js';
import { badRequest, forbidden, notFound, optionalString, parseId, requiredString } from '../http.js';
import { notify } from '../moderation.js';
import { PUBLIC_ITEM_COLUMNS, searchItems, toPublicItem } from '../search.js';
import { readImages, uploadMiddleware } from '../uploads.js';

const fallbackAi = createHeuristicAi();

function readCustody(body) {
  const custody = body.custody === 'institution' ? 'institution' : 'finder';
  if (custody === 'finder') {
    return { custody, institutionName: null, institutionLocation: null, institutionContact: null };
  }
  return {
    custody,
    institutionName: requiredString(body, 'institutionName', '제출한 기관 이름', { max: 100 }),
    institutionLocation: requiredString(body, 'institutionLocation', '기관 위치', { max: 200 }),
    institutionContact: requiredString(body, 'institutionContact', '기관 연락처', { max: 100 }),
  };
}

function readFoundAt(body) {
  const value = requiredString(body, 'foundAt', '습득 시간', { max: 30 });
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw badRequest('습득 시간 형식이 올바르지 않습니다.');
  }
  return value;
}

export function itemsRouter({ db, ai, photos }) {
  const router = express.Router();

  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const getFeatures = db.prepare('SELECT id, text, kind, visibility, source FROM item_features WHERE item_id = ? ORDER BY id');
  const getPhotos = db.prepare('SELECT id, filename, media_type FROM item_photos WHERE item_id = ? ORDER BY position');

  function loadOwnItem(req) {
    const item = getItem.get(parseId(req.params.id));
    if (!item) throw notFound();
    if (item.finder_id !== req.user.id && !req.user.isAdmin) throw forbidden();
    return item;
  }

  function managementView(item) {
    const features = getFeatures.all(item.id);
    const privateFeatures = features.filter((f) => f.visibility === 'private');
    const check = checkPublicText(`${item.title} ${item.public_description}`, privateFeatures);
    const warnings = [...check.blocking, ...check.warnings];
    if (item.custody === 'finder' && privateFeatures.length === 0) {
      warnings.push('검증에 쓸 비공개 특징이 없습니다. 주인만 알 만한 특징을 1개 이상 추가해야 게시할 수 있습니다.');
    } else if (item.custody === 'finder' && privateFeatures.length < config.lowPrivateFeatureWarning) {
      warnings.push(`비공개 특징이 ${privateFeatures.length}개뿐이라 검증이 약할 수 있습니다. 주인만 알 만한 특징을 더 추가해 보세요.`);
    }
    const counts = db.prepare(`
      SELECT
        SUM(status = 'awaiting_finder') AS awaiting,
        SUM(status = 'approved') AS approved
      FROM claims WHERE item_id = ?
    `).get(item.id);
    return {
      ...toPublicItem(item),
      institution: item.custody === 'institution'
        ? { name: item.institution_name, location: item.institution_location, contact: item.institution_contact }
        : null,
      aiMode: item.ai_mode,
      features,
      photos: getPhotos.all(item.id).map((p) => ({ id: p.id, url: `/api/items/${item.id}/photos/${p.id}` })),
      claimCounts: { awaiting: counts.awaiting ?? 0, approved: counts.approved ?? 0 },
      warnings,
      canPublish: check.blocking.length === 0 && (item.custody === 'institution' || privateFeatures.length > 0),
    };
  }

  // 분실자 검색 (로그인 불필요)
  router.get('/items', (req, res) => {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    res.json(searchItems(db, {
      q: String(req.query.q ?? '').slice(0, 200),
      from: String(req.query.from ?? ''),
      limit,
      offset,
    }));
  });

  // 분실물 확인 탭: 공개 정보만. 기관 보관 물건은 기관 위치와 연락처를 바로 보여준다.
  router.get('/items/:id', (req, res) => {
    const item = getItem.get(parseId(req.params.id));
    if (!item) throw notFound();
    const isFinder = req.user?.id === item.finder_id;
    if (item.status === 'draft' && !isFinder) throw notFound();

    const view = {
      ...toPublicItem(item),
      institution: item.custody === 'institution'
        ? { name: item.institution_name, location: item.institution_location, contact: item.institution_contact }
        : null,
      isFinder,
      myClaims: null,
    };
    if (req.user && !isFinder) {
      const mine = db.prepare(`
        SELECT id, status, created_at FROM claims WHERE item_id = ? AND claimant_id = ? ORDER BY id DESC
      `).all(item.id, req.user.id);
      view.myClaims = {
        attemptsLeft: Math.max(0, config.maxAttemptsPerItem - mine.length),
        latest: mine[0] ? { id: mine[0].id, status: mine[0].status } : null,
      };
    }
    res.json(view);
  });

  // 습득자 등록: 특징 입력 + 사진 → AI 분석 → 초안
  router.post('/items', requireUser, uploadMiddleware('photos', config.maxItemPhotos), async (req, res) => {
    const body = req.body ?? {};
    const category = requiredString(body, 'category', '분실물 종류', { max: 40 });
    const title = optionalString(body, 'title', { max: 40 });
    const foundPlace = requiredString(body, 'foundPlace', '습득 장소', { max: 200 });
    const foundAt = readFoundAt(body);
    const custody = readCustody(body);
    const publicInput = splitFeatureInput(body.publicFeatures);
    const privateInput = splitFeatureInput(body.privateFeatures);
    const images = readImages(req.files);
    if (images.length === 0) throw badRequest('사진을 1장 이상 첨부하세요.');

    const warnings = [];
    let aiMode = ai.mode;
    let analyzed;
    try {
      analyzed = await ai.analyzeFoundItem({ category, publicInput, privateInput, photos: images });
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      console.warn('analyzeFoundItem failed, using finder input only:', err.message);
      warnings.push('AI 사진 분석에 실패해서 입력한 특징만 사용했습니다.');
      aiMode = 'heuristic';
      analyzed = await fallbackAi.analyzeFoundItem({ category, publicInput, privateInput });
    }

    const seen = new Set();
    const features = [];
    for (const f of analyzed.features) {
      const key = f.text.replace(/\s/g, '');
      if (seen.has(key) || !ALL_KINDS.includes(f.kind)) continue;
      seen.add(key);
      features.push({ ...f, visibility: classify(f) });
    }

    // 공개 설명은 공개 특징만 보고 만든다.
    const publicFeatures = features.filter((f) => f.visibility === 'public');
    let listing;
    try {
      listing = await ai.writePublicDescription({ category, publicFeatures });
    } catch (err) {
      if (!(err instanceof AiError)) throw err;
      console.warn('writePublicDescription failed, using template:', err.message);
      listing = templateDescription({ category, publicFeatures });
    }

    const itemId = transaction(db, () => {
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO items (finder_id, title, category, public_description, found_place, found_at, custody,
          institution_name, institution_location, institution_contact, status, ai_mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(
        req.user.id, title || listing.title || category, category, listing.description, foundPlace, foundAt,
        custody.custody, custody.institutionName, custody.institutionLocation, custody.institutionContact,
        aiMode, now(),
      );
      const insertPhoto = db.prepare('INSERT INTO item_photos (item_id, filename, media_type, position) VALUES (?, ?, ?, ?)');
      images.forEach((image, position) => {
        insertPhoto.run(lastInsertRowid, photos.save(image), image.mediaType, position);
      });
      const insertFeature = db.prepare('INSERT INTO item_features (item_id, text, kind, visibility, source) VALUES (?, ?, ?, ?, ?)');
      for (const f of features) insertFeature.run(lastInsertRowid, f.text, f.kind, f.visibility, f.source);
      return Number(lastInsertRowid);
    });

    const view = managementView(getItem.get(itemId));
    res.status(201).json({ ...view, warnings: [...warnings, ...view.warnings] });
  });

  // 습득자용 관리 화면 (특징, 사진, 신청 현황)
  router.get('/items/:id/manage', requireUser, (req, res) => {
    res.json(managementView(loadOwnItem(req)));
  });

  // 초안 수정: 습득자가 공개 설명과 특징 분류를 확인하고 고친다.
  router.put('/items/:id', requireUser, (req, res) => {
    const item = loadOwnItem(req);
    if (item.status !== 'draft') throw badRequest('게시된 물건은 수정할 수 없습니다.');
    const body = req.body ?? {};
    const title = requiredString(body, 'title', '제목', { max: 40 });
    const category = requiredString(body, 'category', '분실물 종류', { max: 40 });
    const publicDescription = requiredString(body, 'publicDescription', '공개 설명', { max: 300 });
    const foundPlace = requiredString(body, 'foundPlace', '습득 장소', { max: 200 });
    const foundAt = readFoundAt(body);
    const custody = readCustody(body);
    if (!Array.isArray(body.features) || body.features.length > 40) throw badRequest('특징 목록이 올바르지 않습니다.');
    const features = body.features.map((f) => {
      const text = typeof f?.text === 'string' ? f.text.trim().slice(0, 80) : '';
      const kind = ALL_KINDS.includes(f?.kind) ? f.kind : 'other';
      const visibility = f?.visibility === 'public' && kind !== 'text' ? 'public' : 'private';
      const source = ['finder', 'ai', 'both'].includes(f?.source) ? f.source : 'finder';
      return { text, kind, visibility, source };
    }).filter((f) => f.text);

    transaction(db, () => {
      db.prepare(`
        UPDATE items SET title = ?, category = ?, public_description = ?, found_place = ?, found_at = ?, custody = ?,
          institution_name = ?, institution_location = ?, institution_contact = ?
        WHERE id = ?
      `).run(
        title, category, publicDescription, foundPlace, foundAt, custody.custody,
        custody.institutionName, custody.institutionLocation, custody.institutionContact, item.id,
      );
      db.prepare('DELETE FROM item_features WHERE item_id = ?').run(item.id);
      const insertFeature = db.prepare('INSERT INTO item_features (item_id, text, kind, visibility, source) VALUES (?, ?, ?, ?, ?)');
      for (const f of features) insertFeature.run(item.id, f.text, f.kind, f.visibility, f.source);
    });
    res.json(managementView(getItem.get(item.id)));
  });

  router.post('/items/:id/publish', requireUser, (req, res) => {
    const item = loadOwnItem(req);
    if (item.status !== 'draft') throw badRequest('이미 게시된 물건입니다.');
    const privateFeatures = getFeatures.all(item.id).filter((f) => f.visibility === 'private');
    if (item.custody === 'finder' && privateFeatures.length === 0) {
      throw badRequest('검증에 쓸 비공개 특징을 1개 이상 추가하세요.');
    }
    const { blocking } = checkPublicText(`${item.title} ${item.public_description}`, privateFeatures);
    if (blocking.length > 0) throw badRequest(blocking[0], { problems: blocking });
    db.prepare("UPDATE items SET status = 'published', published_at = ? WHERE id = ?").run(now(), item.id);
    res.json(managementView(getItem.get(item.id)));
  });

  router.delete('/items/:id', requireUser, (req, res) => {
    const item = loadOwnItem(req);
    if (item.status !== 'draft') throw badRequest('게시된 물건은 삭제할 수 없습니다.');
    const files = getPhotos.all(item.id);
    db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
    for (const f of files) photos.remove(f.filename);
    res.status(204).end();
  });

  // 반환 완료: 증빙 사진을 삭제한다 (보유 기간은 추후 결정 — 지금은 반환 즉시 삭제).
  router.post('/items/:id/returned', requireUser, (req, res) => {
    const item = loadOwnItem(req);
    if (item.status !== 'matched') throw badRequest('주인이 확인된 물건만 반환 완료로 바꿀 수 있습니다.');
    const evidence = db.prepare(`
      SELECT e.id, e.filename FROM claim_evidence e JOIN claims c ON c.id = e.claim_id WHERE c.item_id = ?
    `).all(item.id);
    const approved = db.prepare("SELECT claimant_id FROM claims WHERE item_id = ? AND status = 'approved'").get(item.id);
    transaction(db, () => {
      db.prepare("UPDATE items SET status = 'returned' WHERE id = ?").run(item.id);
      db.prepare('DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE item_id = ?)').run(item.id);
      if (approved) notify(db, approved.claimant_id, `"${item.title}" 반환이 완료되었습니다.`, `/items/${item.id}`);
    });
    for (const e of evidence) photos.remove(e.filename);
    res.json(managementView(getItem.get(item.id)));
  });

  // 습득물 사진은 습득자 본인(과 관리자)만 볼 수 있다.
  router.get('/items/:id/photos/:photoId', requireUser, (req, res) => {
    const item = loadOwnItem(req);
    const photo = db.prepare('SELECT filename, media_type FROM item_photos WHERE id = ? AND item_id = ?')
      .get(parseId(req.params.photoId), item.id);
    if (!photo) throw notFound();
    res.set('Cache-Control', 'private, no-store');
    res.type(photo.media_type).sendFile(photos.path(photo.filename));
  });

  router.get('/my/items', requireUser, (req, res) => {
    const rows = db.prepare(`
      SELECT ${PUBLIC_ITEM_COLUMNS},
        (SELECT COUNT(*) FROM claims c WHERE c.item_id = items.id AND c.status = 'awaiting_finder') AS awaiting
      FROM items WHERE finder_id = ? ORDER BY id DESC
    `).all(req.user.id);
    res.json({ items: rows.map((r) => ({ ...toPublicItem(r), awaitingClaims: r.awaiting })) });
  });

  return router;
}

