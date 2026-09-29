// 벤 파이프라인과 알림.
import { config } from './config.js';
import { now, transaction } from './db.js';

export function notify(db, userId, message, link = null) {
  db.prepare('INSERT INTO notifications (user_id, message, link, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, message, link, now());
}

export function watch(db, userId, reason) {
  db.prepare('UPDATE users SET watchlisted = 1, watch_reason = ? WHERE id = ? AND watchlisted = 0')
    .run(reason, userId);
}

/** 검증 실패(자동 실패 + 습득자 거절)가 쌓이면 자동으로 관심 계정에 등록한다. */
export function recordFailure(db, userId) {
  const { failures } = db.prepare(`
    SELECT COUNT(*) AS failures FROM claims
    WHERE claimant_id = ? AND status IN ('failed', 'rejected')
  `).get(userId);
  if (failures >= config.watchlistFailureThreshold) {
    watch(db, userId, `자동 등록: 검증 실패 ${failures}회`);
  }
}

/**
 * 어뷰징 행적이 보이면 경고 1회. 이미 경고가 있으면 계정을 정지하고 가입 정보(아이디)를 벤한다.
 * @returns {'warned' | 'suspended'}
 */
export function warn(db, userId, reason) {
  return transaction(db, () => {
    const user = db.prepare('SELECT id, username, warnings FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('user not found');
    if (user.warnings === 0) {
      db.prepare('UPDATE users SET warnings = 1, watchlisted = 1, watch_reason = COALESCE(watch_reason, ?) WHERE id = ?')
        .run(reason, userId);
      notify(db, userId, `운영 정책 위반으로 경고를 받았습니다. 한 번 더 위반하면 계정이 정지됩니다. (사유: ${reason})`);
      return 'warned';
    }
    db.prepare("UPDATE users SET warnings = warnings + 1, status = 'suspended' WHERE id = ?").run(userId);
    db.prepare('INSERT OR IGNORE INTO banned_usernames (username, reason, banned_at) VALUES (?, ?, ?)')
      .run(user.username, reason, now());
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    // 정지된 계정의 진행 중인 신청은 닫는다.
    db.prepare(`
      UPDATE claims SET status = 'closed', decided_at = ?
      WHERE claimant_id = ? AND status IN ('followup', 'awaiting_finder')
    `).run(now(), userId);
    return 'suspended';
  });
}
