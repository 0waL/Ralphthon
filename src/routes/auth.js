import express from 'express';
import { endSession, hashPassword, startSession, verifyPassword } from '../auth.js';
import { now } from '../db.js';
import { badRequest, HttpError } from '../http.js';

const USERNAME = /^[A-Za-z0-9_]{4,20}$/;

export function authRouter({ db, ai }) {
  const router = express.Router();

  router.post('/auth/signup', (req, res) => {
    const { username, password, passwordConfirm, privacyAgreed } = req.body ?? {};
    if (typeof username !== 'string' || !USERNAME.test(username)) {
      throw badRequest('아이디는 영문, 숫자, 밑줄(_)로 4~20자여야 합니다.');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      throw badRequest('비밀번호는 8~72자여야 합니다.');
    }
    if (password !== passwordConfirm) throw badRequest('비밀번호 확인이 일치하지 않습니다.');
    if (privacyAgreed !== true) throw badRequest('개인정보 처리에 동의해야 가입할 수 있습니다.');
    if (db.prepare('SELECT 1 FROM banned_usernames WHERE username = ?').get(username)) {
      throw new HttpError(403, '사용할 수 없는 아이디입니다.');
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      throw new HttpError(409, '이미 사용 중인 아이디입니다.');
    }
    const at = now();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (username, password_hash, privacy_agreed_at, created_at) VALUES (?, ?, ?, ?)
    `).run(username, hashPassword(password), at, at);
    startSession(db, res, Number(lastInsertRowid));
    res.status(201).json({ user: { id: Number(lastInsertRowid), username, isAdmin: false } });
  });

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw badRequest('아이디와 비밀번호를 입력하세요.');
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
    }
    if (user.status !== 'active') throw new HttpError(403, '정지된 계정입니다.');
    startSession(db, res, user.id);
    res.json({ user: { id: user.id, username: user.username, isAdmin: user.is_admin === 1 } });
  });

  router.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    const unread = req.user
      ? db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n
      : 0;
    res.json({ user: req.user, unreadNotifications: unread, aiMode: ai.mode });
  });

  return router;
}
