'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureAdmin } = require('../src/server');
const { QUESTIONS } = require('../src/assessment');

let server;
let base;
let db;

test.before(async () => {
  db = openDatabase(':memory:');
  process.env.ADMIN_EMAIL = 'admin@pwc.test';
  process.env.ADMIN_PASSWORD = 'AdminPass1';
  ensureAdmin(db);
  server = createApp(db).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

// 쿠키를 유지하는 간단한 클라이언트
function client() {
  let cookie = '';
  return async function call(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const registration = (overrides = {}) => ({
  company: {
    name: '테스트제약',
    businessNumber: '123-45-67891',
    size: 'midsize',
    industry: '제약',
    annualRevenue: '230,000,000,000',
    employees: 180,
    ...overrides.company,
  },
  user: {
    name: '김재무',
    email: 'cfo@test.co.kr',
    phone: '010-0000-0000',
    password: 'Passw0rd1',
    agreeTerms: true,
    ...overrides.user,
  },
});

test('기업 회원가입 → 진단 → 서비스 신청 → 재무입력 → 관리자 처리 전체 흐름', async () => {
  const c = client();

  assert.equal((await c('/api/dashboard')).status, 401);

  const reg = await c('/api/auth/register', { method: 'POST', body: registration() });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'client');

  const me = await c('/api/auth/me');
  assert.equal(me.data.company.sizeLabel, '중견기업');
  assert.equal(me.data.company.annualRevenue, 230000000000);

  let dash = await c('/api/dashboard');
  assert.equal(dash.data.phase, 'none');

  // 진단
  const answers = Object.fromEntries(QUESTIONS.map((q) => [q.id, 4]));
  answers.t1 = 1;
  const a = await c('/api/assessments', { method: 'POST', body: { answers } });
  assert.equal(a.status, 201);
  assert.deepEqual(a.data.recommendedItems, ['cashflow']);
  assert.equal((await c(`/api/assessments/${a.data.id}`)).data.answers.t1, 1);
  assert.equal((await c('/api/deliverables')).data.deliverables.length, 1);
  assert.equal((await c('/api/dashboard')).data.phase, 'assessment');

  // 서비스 신청
  const bad = await c('/api/requests', { method: 'POST', body: { phase: 'operation', items: ['nope'] } });
  assert.equal(bad.status, 400);
  const impl = await c('/api/requests', { method: 'POST', body: { phase: 'implementation', items: ['cashflow'] } });
  assert.equal(impl.data.monthlyFee, 0);
  const op = await c('/api/requests', {
    method: 'POST',
    body: { phase: 'operation', items: ['closing', 'cashflow', 'cfo'], message: '결산 대행 희망' },
  });
  assert.equal(op.status, 201);
  assert.equal(op.data.monthlyFee, 1500000);
  assert.equal(op.data.negotiable, true);
  assert.equal(op.data.status, 'submitted');

  // 재무 데이터
  assert.equal((await c('/api/financials/2026-13', { method: 'PUT', body: {} })).status, 400);
  await c('/api/financials/2026-08', { method: 'PUT', body: { revenue: 1000, cogs: 400, opex: 900, cashBalance: 5000 } });
  const fin = await c('/api/financials/2026-09', {
    method: 'PUT',
    body: { revenue: '1,000', cogs: 400, opex: 900, cashBalance: 4700 },
  });
  assert.equal(fin.data.latest.runwayMonths, 15.7);

  // 다른 기업은 데이터에 접근할 수 없다
  const other = client();
  await other('/api/auth/register', {
    method: 'POST',
    body: registration({ company: { businessNumber: '2208112341', size: 'small' }, user: { email: 'b@test.co.kr' } }),
  });
  assert.equal((await other(`/api/assessments/${a.data.id}`)).status, 404);
  assert.equal((await other('/api/requests')).data.requests.length, 0);
  assert.equal((await other('/api/admin/companies')).status, 403);

  // 관리자
  const admin = client();
  assert.equal((await admin('/api/auth/login', { method: 'POST', body: { email: 'admin@pwc.test', password: 'AdminPass1' } })).status, 200);
  assert.equal((await admin('/api/dashboard')).status, 403);
  const companies = (await admin('/api/admin/companies')).data.companies;
  assert.equal(companies.length, 2);
  const target = companies.find((x) => x.name === '테스트제약' && x.size === 'midsize');
  assert.equal(target.openRequests, 2);

  const upd = await admin(`/api/admin/requests/${op.data.id}`, {
    method: 'PATCH',
    body: { status: 'in_progress', adminNote: '11월부터 착수' },
  });
  assert.equal(upd.data.status, 'in_progress');
  assert.equal((await admin(`/api/admin/requests/${op.data.id}`, { method: 'PATCH', body: { status: 'x' } })).status, 400);

  const deliv = await admin(`/api/admin/companies/${target.id}/deliverables`, {
    method: 'POST',
    body: { phase: 'operation', title: '2026년 9월 결산 보고서', content: '내용' },
  });
  assert.equal(deliv.status, 201);

  dash = await c('/api/dashboard');
  assert.equal(dash.data.phase, 'operation');
  assert.equal(dash.data.deliverableCount, 2);
  assert.equal(dash.data.requests.find((r) => r.id === op.data.id).adminNote, '11월부터 착수');

  // 로그아웃 후 세션 무효화
  await c('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await c('/api/dashboard')).status, 401);
});

test('회원가입 검증', async () => {
  const c = client();
  const cases = [
    [{ company: { businessNumber: '1234567890' } }, 400],
    [{ company: { size: 'large' } }, 400],
    [{ user: { password: 'short' } }, 400],
    [{ user: { agreeTerms: false } }, 400],
    [{ user: { email: 'not-an-email' } }, 400],
  ];
  for (const [overrides, status] of cases) {
    const res = await c('/api/auth/register', {
      method: 'POST',
      body: registration({ ...overrides, user: { email: 'v@test.co.kr', ...overrides.user }, company: { businessNumber: '1058765430', ...overrides.company } }),
    });
    assert.equal(res.status, status, JSON.stringify(overrides));
  }
  const ok = await c('/api/auth/register', {
    method: 'POST',
    body: registration({ company: { businessNumber: '1058765430' }, user: { email: 'v@test.co.kr' } }),
  });
  assert.equal(ok.status, 201);
  const dupEmail = await client()('/api/auth/register', {
    method: 'POST',
    body: registration({ company: { businessNumber: '2118700014' }, user: { email: 'V@test.co.kr' } }),
  });
  assert.equal(dupEmail.status, 409);
  const dupBrn = await client()('/api/auth/register', {
    method: 'POST',
    body: registration({ company: { businessNumber: '105-87-65430' }, user: { email: 'w@test.co.kr' } }),
  });
  assert.equal(dupBrn.status, 409);
});

test('로그인 실패, 잠금, JSON 외 요청 차단', async () => {
  const c = client();
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'admin@pwc.test', password: 'nope' } })).status, 401);
  const form = await c('/api/auth/login', {
    method: 'POST',
    body: 'email=a&password=b',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(form.status, 415);

  for (let i = 0; i < 10; i++) {
    await c('/api/auth/login', { method: 'POST', body: { email: 'lock@test.co.kr', password: 'wrong' } });
  }
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { email: 'lock@test.co.kr', password: 'wrong' } })).status, 429);
});

test('정적 SPA와 공개 카탈로그를 제공한다', async () => {
  const html = await fetch(`${base}/dashboard`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /재무성장지원서비스/);
  assert.ok(html.headers.get('content-security-policy'));
  const { data } = await client()('/api/catalog');
  assert.equal(data.phases.length, 3);
  assert.equal(data.items.length, 13);
  assert.equal((await client()('/api/unknown')).status, 404);
});
