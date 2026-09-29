// 로그인 · 회원가입 양식
import { post } from '../api.js';
import { navigate, refreshSession, safeNext } from '../app.js';
import { backButton, errorBox, h, passwordField } from '../dom.js';

function field(label, input) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input);
}

export function loginPage({ query }) {
  const next = safeNext(query.get('next'));
  const username = h('input', { type: 'text', name: 'username', id: 'username', required: true, autocomplete: 'username', maxlength: 20 });
  const password = passwordField({ name: 'password', label: '비밀번호 입력', autocomplete: 'current-password' });
  const error = errorBox();
  const submit = h('button', { type: 'submit', class: 'button button-primary button-block' }, '로그인');

  const form = h('form', {
    class: 'auth-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      submit.disabled = true;
      try {
        await post('/api/auth/login', { username: username.value.trim(), password: password.input.value });
        await refreshSession();
        navigate(next, { replace: true });
      } catch (err) {
        error.show(err.message);
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('h1', { class: 'auth-title' }, '로그인'),
  h('p', { class: 'auth-subtitle' }, '계정에 로그인하세요.'),
  error.node,
  field('ID 입력', username),
  password.node,
  submit,
  h('p', { class: 'auth-switch' }, '계정이 없으신가요? ',
    h('a', { href: `/signup?next=${encodeURIComponent(next)}` }, '회원가입하기')));

  return h('section', { class: 'page narrow' }, backButton(), form);
}

export function signupPage({ query }) {
  const next = safeNext(query.get('next'));
  const username = h('input', {
    type: 'text', name: 'username', id: 'username', required: true, autocomplete: 'username',
    minlength: 4, maxlength: 20, pattern: '[A-Za-z0-9_]{4,20}',
  });
  const password = passwordField({ name: 'password', label: '비밀번호 입력', autocomplete: 'new-password' });
  const confirm = h('input', { type: 'password', name: 'passwordConfirm', id: 'passwordConfirm', required: true, autocomplete: 'new-password', maxlength: 72 });
  const agree = h('input', { type: 'checkbox', id: 'privacy', required: true });
  const error = errorBox();
  const submit = h('button', { type: 'submit', class: 'button button-primary button-block' }, '만들기');

  const form = h('form', {
    class: 'auth-card',
    onsubmit: async (e) => {
      e.preventDefault();
      error.hide();
      submit.disabled = true;
      try {
        await post('/api/auth/signup', {
          username: username.value.trim(),
          password: password.input.value,
          passwordConfirm: confirm.value,
          privacyAgreed: agree.checked,
        });
        await refreshSession();
        navigate(next, { replace: true });
      } catch (err) {
        error.show(err.message);
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('h1', { class: 'auth-title' }, '회원가입'),
  h('p', { class: 'auth-subtitle' }, '계정을 만드세요.'),
  error.node,
  field('ID 입력', username),
  h('p', { class: 'hint' }, '영문, 숫자, 밑줄(_)로 4~20자'),
  password.node,
  h('p', { class: 'hint' }, '8자 이상'),
  field('비밀번호 확인', confirm),
  h('fieldset', { class: 'privacy' },
    h('legend', {}, '개인정보 처리'),
    h('ul', { class: 'privacy-list' },
      h('li', {}, '수집 항목: 아이디, 비밀번호(암호화 저장), 서비스 이용 기록(등록한 습득물, 검증 신청, 채팅)'),
      h('li', {}, '이용 목적: 분실물 반환 중개, 소유권 검증, 부정 이용 방지'),
      h('li', {}, '증빙 사진은 반환이 끝나면 삭제합니다.'),
      h('li', {}, '부정 이용으로 정지된 계정의 아이디는 다시 가입에 쓸 수 없습니다.')),
    h('label', { class: 'checkbox' }, agree, ' 개인정보 처리에 동의합니다.')),
  submit,
  h('p', { class: 'auth-switch' }, '계정이 있으신가요? ',
    h('a', { href: `/login?next=${encodeURIComponent(next)}` }, '로그인하기')));

  return h('section', { class: 'page narrow' }, backButton(), form);
}
