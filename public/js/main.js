import { post } from './api.js';
import { navigate, onSessionChange, refreshSession, session } from './app.js';
import { clear, h } from './dom.js';
import { adminPage } from './pages/admin.js';
import { chatPage } from './pages/chat.js';
import { claimFormPage, claimStatusPage } from './pages/claim.js';
import { itemPage } from './pages/item.js';
import { loginPage, signupPage } from './pages/auth.js';
import { managePage } from './pages/manage.js';
import { myPage, notificationsPage } from './pages/my.js';
import { registerPage } from './pages/register.js';
import { searchPage } from './pages/search.js';

const routes = [
  ['/', searchPage],
  ['/register', registerPage],
  ['/items/:id', itemPage],
  ['/items/:id/claim', claimFormPage],
  ['/claims/:id', claimStatusPage],
  ['/login', loginPage],
  ['/signup', signupPage],
  ['/my', myPage],
  ['/my/items/:id', managePage],
  ['/chats/:id', chatPage],
  ['/notifications', notificationsPage],
  ['/admin', adminPage],
].map(([pattern, page]) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '(\\d+)'; })}/?$`);
  return { regex, keys, page };
});

function matchRoute(pathname) {
  for (const route of routes) {
    const m = route.regex.exec(pathname);
    if (m) return { page: route.page, params: Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]])) };
  }
  return null;
}

// ---------- 상단 바: 왼쪽 스위치, 오른쪽 로그인 ----------

const header = document.getElementById('topbar');
const main = document.getElementById('app');
const footer = document.getElementById('footer');

function renderHeader() {
  clear(header);
  const registering = location.pathname === '/register';
  const modeSwitch = h('button', {
    type: 'button',
    role: 'switch',
    class: 'mode-switch',
    'aria-checked': String(registering),
    'aria-label': '분실물 찾기 / 습득물 등록 전환',
    onclick: () => {
      if (registering) navigate('/');
      else if (session.user) navigate('/register');
      else navigate(`/login?next=${encodeURIComponent('/register')}`);
    },
  },
  h('span', { class: `mode-option${registering ? '' : ' active'}` }, '분실물 찾기'),
  h('span', { class: `mode-option${registering ? ' active' : ''}` }, '습득물 등록'));

  const right = h('nav', { class: 'topbar-right', 'aria-label': '계정' });
  if (session.user) {
    right.append(...[
      h('a', { href: '/notifications', class: 'nav-link' }, '알림',
        session.unread > 0 ? h('span', { class: 'badge', 'aria-label': `읽지 않은 알림 ${session.unread}개` }, String(session.unread)) : null),
      h('a', { href: '/my', class: 'nav-link' }, '내 활동'),
      session.user.isAdmin ? h('a', { href: '/admin', class: 'nav-link' }, '관리') : null,
      h('button', {
        type: 'button',
        class: 'button button-ghost',
        onclick: async () => {
          await post('/api/auth/logout');
          await refreshSession();
          navigate('/');
        },
      }, '로그아웃'),
    ].filter(Boolean));
  } else {
    const next = location.pathname.startsWith('/login') || location.pathname.startsWith('/signup')
      ? '/'
      : location.pathname + location.search;
    right.append(h('a', { href: `/login?next=${encodeURIComponent(next)}`, class: 'button' }, '로그인'));
  }

  header.append(h('div', { class: 'topbar-inner' },
    h('div', { class: 'topbar-left' }, modeSwitch),
    h('a', { href: '/', class: 'brand' }, '랄프톤 유실물'),
    right));

  clear(footer);
  footer.append(h('p', {}, session.aiMode === 'claude'
    ? 'AI 분석: Claude'
    : '간이 모드로 동작 중입니다. AI 사진 분석 없이 단어 비교로 검증합니다.'));
}

// ---------- 화면 전환 ----------

let cleanups = [];
let renderToken = 0;

function notFoundPage() {
  return h('section', { class: 'page narrow' },
    h('h1', {}, '페이지를 찾을 수 없습니다'),
    h('p', {}, h('a', { href: '/' }, '처음으로 돌아가기')));
}

async function render() {
  for (const fn of cleanups) fn();
  cleanups = [];
  const token = ++renderToken;
  const route = matchRoute(location.pathname);
  const ctx = {
    params: route?.params ?? {},
    query: new URLSearchParams(location.search),
    onCleanup: (fn) => cleanups.push(fn),
    isCurrent: () => token === renderToken,
  };
  renderHeader();
  let node;
  try {
    node = route ? await route.page(ctx) : notFoundPage();
  } catch (err) {
    node = h('section', { class: 'page narrow' },
      h('h1', {}, err.status === 404 ? '찾을 수 없습니다' : '문제가 생겼습니다'),
      h('p', {}, err.message),
      h('p', {}, h('a', { href: '/' }, '처음으로 돌아가기')));
  }
  if (token !== renderToken || !node) return;
  clear(main);
  main.append(node);
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

document.addEventListener('click', (event) => {
  const a = event.target.closest('a');
  if (!a || a.target || a.hasAttribute('download') || event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', render);
window.addEventListener('routechange', render);
window.addEventListener('navigate', (e) => navigate(e.detail));
onSessionChange(renderHeader);

// 알림 수를 가끔 새로 고친다.
setInterval(() => {
  if (session.user && document.visibilityState === 'visible') refreshSession();
}, 30_000);

await refreshSession();
render();
