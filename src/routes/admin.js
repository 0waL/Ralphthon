// 벤 파이프라인 관리 화면.
import express from 'express';
import { requireAdmin } from '../auth.js';
import { badRequest, notFound, optionalString, parseId } from '../http.js';
import { warn, watch } from '../moderation.js';

export function adminRouter({ db }) {
  const router = express.Router();
  router.use('/admin', requireAdmin);

  function loadUser(req) {
    const user = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(parseId(req.params.id));
    if (!user) throw notFound();
    return user;
  }

  router.get('/admin/users', (req, res) => {
    const onlyWatched = req.query.filter !== 'all';
    const rows = db.prepare(`
      SELECT u.id, u.username, u.is_admin, u.status, u.warnings, u.watchlisted, u.watch_reason, u.created_at,
        (SELECT COUNT(*) FROM claims c WHERE c.claimant_id = u.id) AS claims,
        (SELECT COUNT(*) FROM claims c WHERE c.claimant_id = u.id AND c.status IN ('failed', 'rejected')) AS failures
      FROM users u
      WHERE (? = 0 OR u.watchlisted = 1)
      ORDER BY u.watchlisted DESC, failures DESC, u.id
      LIMIT 200
    `).all(onlyWatched ? 1 : 0);
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        username: u.username,
        isAdmin: u.is_admin === 1,
        status: u.status,
        warnings: u.warnings,
        watchlisted: u.watchlisted === 1,
        watchReason: u.watch_reason,
        claims: u.claims,
        failures: u.failures,
        createdAt: u.created_at,
      })),
    });
  });

  router.post('/admin/users/:id/watch', (req, res) => {
    const user = loadUser(req);
    watch(db, user.id, optionalString(req.body, 'reason', { max: 200 }) || '관리자 등록');
    res.json({ ok: true });
  });

  router.post('/admin/users/:id/unwatch', (req, res) => {
    const user = loadUser(req);
    db.prepare('UPDATE users SET watchlisted = 0, watch_reason = NULL WHERE id = ?').run(user.id);
    res.json({ ok: true });
  });

  router.post('/admin/users/:id/warn', (req, res) => {
    const user = loadUser(req);
    if (user.is_admin) throw badRequest('관리자 계정에는 경고를 줄 수 없습니다.');
    const reason = optionalString(req.body, 'reason', { max: 200 }) || '어뷰징 행적';
    res.json({ result: warn(db, user.id, reason) });
  });

  return router;
}
