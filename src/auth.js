import crypto from 'node:crypto';
import { config } from './config.js';
import { now } from './db.js';
import { HttpError } from './http.js';

const COOKIE = 'sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function startSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = config.sessionDays * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, new Date(Date.now() + maxAge).toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
    path: '/',
  });
}

export function endSession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/** 세션 쿠키가 있으면 req.user를 채운다. 정지된 계정은 로그인되지 않은 것으로 본다. */
export function loadUser(db) {
  const findSession = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.status, u.warnings, u.watchlisted
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `);
  return (req, _res, next) => {
    req.user = null;
    const token = readCookie(req, COOKIE);
    if (token) {
      const row = findSession.get(token, now());
      if (row && row.status === 'active') {
        req.user = { id: row.id, username: row.username, isAdmin: row.is_admin === 1 };
      }
    }
    next();
  };
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, '로그인이 필요합니다.'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, '로그인이 필요합니다.'));
  if (!req.user.isAdmin) return next(new HttpError(403, '관리자만 사용할 수 있습니다.'));
  next();
}
