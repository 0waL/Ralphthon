import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { HttpError } from './http.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { chatsRouter } from './routes/chats.js';
import { claimsRouter } from './routes/claims.js';
import { itemsRouter } from './routes/items.js';
import { notificationsRouter } from './routes/notifications.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: '사진 한 장은 5MB 이하여야 합니다.',
  LIMIT_FILE_COUNT: '첨부할 수 있는 사진 수를 넘었습니다.',
  LIMIT_UNEXPECTED_FILE: '첨부할 수 있는 사진 수를 넘었습니다.',
};

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, ai: object, photos: ReturnType<typeof import('./uploads.js').createPhotoStore> }} ctx
 */
export function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(loadUser(ctx.db));

  const api = express.Router();
  api.use(authRouter(ctx));
  api.use(itemsRouter(ctx));
  api.use(claimsRouter(ctx));
  api.use(chatsRouter(ctx));
  api.use(notificationsRouter(ctx));
  api.use(adminRouter(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, '없는 API입니다.')));
  app.use('/api', api);

  app.use(express.static(PUBLIC_DIR, { index: false }));
  // 단일 페이지 앱: 나머지 경로는 모두 index.html
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: MULTER_MESSAGES[err.code] ?? '파일 업로드에 실패했습니다.' });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    }
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}
