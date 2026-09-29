import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHeuristicAi } from '../src/ai/heuristic.js';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { createPhotoStore } from '../src/uploads.js';

// 가장 작은 PNG (1x1)
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export async function startTestServer({ ai = createHeuristicAi() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralphthon-test-'));
  const db = openDb(':memory:');
  const photos = createPhotoStore(path.join(dir, 'uploads'));
  const app = createApp({ db, ai, photos });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    uploadsDir: path.join(dir, 'uploads'),
    client: () => createClient(base),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function createClient(base) {
  let cookie = '';
  async function request(method, url, { json, form } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const res = await fetch(base + url, { method, headers, body });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('application/json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data };
  }
  return {
    get: (url) => request('GET', url),
    post: (url, json) => request('POST', url, { json }),
    put: (url, json) => request('PUT', url, { json }),
    del: (url) => request('DELETE', url),
    postForm: (url, form) => request('POST', url, { form }),
  };
}

export function itemForm(fields, photoCount = 1) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (let i = 0; i < photoCount; i++) form.append('photos', new Blob([PNG], { type: 'image/png' }), `p${i}.png`);
  return form;
}

export function claimForm(answer, evidenceCount = 0) {
  const form = new FormData();
  form.append('answer', answer);
  for (let i = 0; i < evidenceCount; i++) form.append('evidence', new Blob([PNG], { type: 'image/png' }), `e${i}.png`);
  return form;
}

export async function signup(client, username, password = 'password123') {
  const res = await client.post('/api/auth/signup', {
    username, password, passwordConfirm: password, privacyAgreed: true,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.data)}`);
  return res.data.user;
}

export const WALLET = {
  category: '지갑',
  title: '',
  publicFeatures: '남색, 손바닥 크기 반지갑',
  privateFeatures: '딸기 모양 스티커\n신용카드 2장\n모서리 가죽 벗겨짐',
  foundPlace: '강남역 2번 출구',
  foundAt: '2026-09-28T18:30',
  custody: 'finder',
};

/** 습득자가 지갑을 등록하고 게시까지 한다. */
export async function publishWallet(finder, overrides = {}) {
  const created = await finder.postForm('/api/items', itemForm({ ...WALLET, ...overrides }));
  if (created.status !== 201) throw new Error(`create failed: ${JSON.stringify(created.data)}`);
  const published = await finder.post(`/api/items/${created.data.id}/publish`);
  if (published.status !== 200) throw new Error(`publish failed: ${JSON.stringify(published.data)}`);
  return published.data;
}
