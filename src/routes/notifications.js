import express from 'express';
import { requireUser } from '../auth.js';

export function notificationsRouter({ db }) {
  const router = express.Router();

  router.get('/notifications', requireUser, (req, res) => {
    const rows = db.prepare(`
      SELECT id, message, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50
    `).all(req.user.id);
    res.json({
      notifications: rows.map((n) => ({
        id: n.id, message: n.message, link: n.link, read: n.is_read === 1, createdAt: n.created_at,
      })),
    });
  });

  router.post('/notifications/read', requireUser, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  return router;
}
