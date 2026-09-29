import path from 'node:path';
import { createAi } from './ai/index.js';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { createPhotoStore } from './uploads.js';

const dataDir = process.env.DATA_DIR || path.resolve('data');
const port = Number(process.env.PORT) || 3000;

const db = openDb(path.join(dataDir, 'app.db'));
const ai = createAi();
const photos = createPhotoStore(path.join(dataDir, 'uploads'));
const app = createApp({ db, ai, photos });

app.listen(port, () => {
  console.log(`랄프톤 유실물 플랫폼: http://localhost:${port}`);
  console.log(ai.mode === 'claude'
    ? 'AI 모드: Claude'
    : 'AI 모드: 간이 모드 (ANTHROPIC_API_KEY가 없어 사진 분석 없이 단어 비교로 동작합니다)');
});
