// 세션 상태와 라우터.
import { get } from './api.js';

export const session = { user: null, unread: 0, aiMode: 'heuristic' };
const listeners = new Set();

export function onSessionChange(fn) {
  listeners.add(fn);
}

export async function refreshSession() {
  try {
    const me = await get('/api/me');
    session.user = me.user;
    session.unread = me.unreadNotifications;
    session.aiMode = me.aiMode;
  } catch {
    session.user = null;
  }
  for (const fn of listeners) fn(session);
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event('routechange'));
}

/** 로그인이 필요한 화면. 로그인하지 않았으면 로그인 후 원래 화면으로 돌아온다. */
export function requireLogin() {
  if (session.user) return true;
  const next = location.pathname + location.search;
  navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
  return false;
}

export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
