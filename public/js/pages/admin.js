// 벤 파이프라인: 관심 계정 → 경고 1회 → 다시 적발 시 정지 + 아이디 벤
import { get, post } from '../api.js';
import { navigate, requireLogin, session } from '../app.js';
import { errorBox, formatRelative, h } from '../dom.js';

export async function adminPage({ query }) {
  if (!requireLogin()) return null;
  if (!session.user.isAdmin) {
    return h('section', { class: 'page narrow' }, h('h1', {}, '관리자만 볼 수 있습니다'));
  }
  const filter = query.get('filter') === 'all' ? 'all' : 'watchlisted';
  const { users } = await get(`/api/admin/users?filter=${filter}`);
  const error = errorBox();
  const reload = () => navigate(`/admin?filter=${filter}`, { replace: true });

  async function act(url, body) {
    error.hide();
    try {
      await post(url, body);
      reload();
    } catch (err) {
      error.show(err.message);
    }
  }

  const rows = users.map((u) => h('tr', {},
    h('td', {}, u.username, u.isAdmin ? [' ', h('span', { class: 'tag' }, '관리자')] : null),
    h('td', {}, u.status === 'suspended' ? h('span', { class: 'tag tag-danger' }, '정지') : '정상'),
    h('td', {}, u.watchlisted ? h('span', { class: 'tag tag-accent', title: u.watchReason ?? '' }, '관심') : '-'),
    h('td', {}, String(u.warnings)),
    h('td', {}, `${u.failures} / ${u.claims}`),
    h('td', {}, u.watchReason ?? ''),
    h('td', {}, formatRelative(u.createdAt)),
    h('td', { class: 'actions' }, u.status === 'suspended' || u.isAdmin ? null : [
      u.watchlisted
        ? h('button', { type: 'button', class: 'button button-small', onclick: () => act(`/api/admin/users/${u.id}/unwatch`) }, '관심 해제')
        : h('button', {
          type: 'button', class: 'button button-small',
          onclick: () => {
            const reason = prompt('관심 계정으로 등록하는 이유', '의심 행적');
            if (reason !== null) act(`/api/admin/users/${u.id}/watch`, { reason });
          },
        }, '관심 등록'),
      h('button', {
        type: 'button', class: 'button button-small button-danger',
        onclick: () => {
          const message = u.warnings > 0
            ? '이미 경고를 받은 계정입니다. 계정을 정지하고 아이디를 벤합니다. 사유를 입력하세요.'
            : '경고를 1회 부여합니다. 사유를 입력하세요.';
          const reason = prompt(message, '어뷰징 행적');
          if (reason !== null) act(`/api/admin/users/${u.id}/warn`, { reason });
        },
      }, u.warnings > 0 ? '정지' : '경고'),
    ])));

  return h('section', { class: 'page' },
    h('h1', {}, '계정 관리'),
    h('p', { class: 'muted' }, '어뷰징 행적이나 의심 흔적이 보이는 계정을 관심 계정으로 등록합니다. 경고는 1회까지이고, 경고가 있는 계정이 다시 적발되면 정지하고 가입에 쓴 아이디를 벤합니다. 검증 실패가 쌓인 계정은 자동으로 관심 계정이 됩니다.'),
    h('div', { class: 'button-row' },
      h('a', { href: '/admin', class: `button button-small${filter === 'watchlisted' ? ' button-primary' : ''}` }, '관심 계정'),
      h('a', { href: '/admin?filter=all', class: `button button-small${filter === 'all' ? ' button-primary' : ''}` }, '전체 계정')),
    error.node,
    users.length === 0
      ? h('p', { class: 'muted' }, '해당하는 계정이 없습니다.')
      : h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['아이디', '상태', '관심', '경고', '실패/신청', '사유', '가입', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows))));
}
