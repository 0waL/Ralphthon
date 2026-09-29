// 사용법: npm run make-admin -- <아이디>
import path from 'node:path';
import { openDb } from '../src/db.js';

const username = process.argv[2];
if (!username) {
  console.error('사용법: npm run make-admin -- <아이디>');
  process.exit(1);
}
const db = openDb(path.join(process.env.DATA_DIR || path.resolve('data'), 'app.db'));
const { changes } = db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(username);
if (changes === 0) {
  console.error(`"${username}" 계정이 없습니다. 먼저 회원가입하세요.`);
  process.exit(1);
}
console.log(`"${username}" 계정을 관리자로 지정했습니다.`);
