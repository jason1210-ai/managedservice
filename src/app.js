'use strict';

const path = require('node:path');
const express = require('express');

const { transaction } = require('./db');
const auth = require('./auth');
const catalog = require('./catalog');
const assessment = require('./assessment');
const { computeKpis } = require('./finance');

const SIZES = { small: '중소기업', midsize: '중견기업' };
const REQUEST_STATUSES = ['submitted', 'reviewing', 'in_progress', 'completed', 'rejected'];
const MAX_AMOUNT = 1e15; // 원 단위 금액 상한(정수 안전 범위 이내)

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (message) => new HttpError(400, message);

function text(value, field, { max = 200, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field}을(를) 입력해 주세요.`);
    return null;
  }
  if (typeof value !== 'string') throw bad(`${field} 형식이 올바르지 않습니다.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw bad(`${field}을(를) 입력해 주세요.`);
  if (trimmed.length > max) throw bad(`${field}은(는) ${max}자 이하로 입력해 주세요.`);
  return trimmed || null;
}

function int(value, field, { min = 0, max = MAX_AMOUNT, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw bad(`${field}을(를) 입력해 주세요.`);
    return null;
  }
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} 값이 올바르지 않습니다.`);
  return n;
}

// 로그인 시도 제한: 같은 이메일+IP 조합으로 15분에 10회 실패 시 차단
function createLoginLimiter({ limit = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  return {
    blocked(key) {
      const entry = failures.get(key);
      if (!entry) return false;
      if (Date.now() - entry.start > windowMs) {
        failures.delete(key);
        return false;
      }
      return entry.count >= limit;
    },
    fail(key) {
      const entry = failures.get(key);
      if (!entry || Date.now() - entry.start > windowMs) failures.set(key, { start: Date.now(), count: 1 });
      else entry.count += 1;
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

function createApp(db, { secureCookies = false } = {}) {
  const app = express();
  const sessions = auth.createSessionStore(db);
  const limiter = createLoginLimiter();

  const q = {
    companyById: db.prepare('SELECT * FROM companies WHERE id = ?'),
    companyByBusinessNumber: db.prepare('SELECT id FROM companies WHERE business_number = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertCompany: db.prepare(
      'INSERT INTO companies (name, business_number, size, industry, annual_revenue, employees) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    insertUser: db.prepare(
      'INSERT INTO users (company_id, email, name, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    insertAssessment: db.prepare(
      'INSERT INTO assessments (company_id, answers, result, total_score) VALUES (?, ?, ?, ?)',
    ),
    assessmentsByCompany: db.prepare(
      'SELECT id, total_score, result, created_at FROM assessments WHERE company_id = ? ORDER BY id DESC',
    ),
    assessmentById: db.prepare('SELECT * FROM assessments WHERE id = ? AND company_id = ?'),
    insertRequest: db.prepare(
      'INSERT INTO service_requests (company_id, phase, items, message, monthly_fee, negotiable) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    requestsByCompany: db.prepare('SELECT * FROM service_requests WHERE company_id = ? ORDER BY id DESC'),
    allRequests: db.prepare(`
      SELECT r.*, c.name AS company_name FROM service_requests r
      JOIN companies c ON c.id = r.company_id ORDER BY r.id DESC`),
    requestById: db.prepare('SELECT * FROM service_requests WHERE id = ?'),
    updateRequest: db.prepare(
      "UPDATE service_requests SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?",
    ),
    financialsByCompany: db.prepare(
      'SELECT ym, revenue, cogs, opex, cash_balance AS cashBalance FROM financial_records WHERE company_id = ? ORDER BY ym',
    ),
    upsertFinancial: db.prepare(`
      INSERT INTO financial_records (company_id, ym, revenue, cogs, opex, cash_balance) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (company_id, ym) DO UPDATE SET
        revenue = excluded.revenue, cogs = excluded.cogs, opex = excluded.opex, cash_balance = excluded.cash_balance`),
    deleteFinancial: db.prepare('DELETE FROM financial_records WHERE company_id = ? AND ym = ?'),
    insertDeliverable: db.prepare('INSERT INTO deliverables (company_id, phase, title, content) VALUES (?, ?, ?, ?)'),
    deliverablesByCompany: db.prepare('SELECT * FROM deliverables WHERE company_id = ? ORDER BY id DESC'),
    adminCompanies: db.prepare(`
      SELECT c.*,
        (SELECT total_score FROM assessments a WHERE a.company_id = c.id ORDER BY a.id DESC LIMIT 1) AS latest_score,
        (SELECT COUNT(*) FROM service_requests r WHERE r.company_id = c.id) AS request_count,
        (SELECT COUNT(*) FROM service_requests r WHERE r.company_id = c.id AND r.status IN ('submitted', 'reviewing')) AS open_requests
      FROM companies c ORDER BY c.id DESC`),
    usersByCompany: db.prepare('SELECT id, email, name, phone, created_at FROM users WHERE company_id = ?'),
  };

  const formatCompany = (c) => ({
    id: c.id,
    name: c.name,
    businessNumber: c.business_number,
    size: c.size,
    sizeLabel: SIZES[c.size],
    industry: c.industry,
    annualRevenue: c.annual_revenue,
    employees: c.employees,
    createdAt: c.created_at,
  });

  const formatRequest = (r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    phase: r.phase,
    items: JSON.parse(r.items),
    message: r.message,
    monthlyFee: r.monthly_fee,
    negotiable: Boolean(r.negotiable),
    status: r.status,
    adminNote: r.admin_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const formatDeliverable = (d) => ({
    id: d.id,
    phase: d.phase,
    title: d.title,
    content: d.content,
    createdAt: d.created_at,
  });

  // 진단 → 구축 → 운영 중 현재 진행 단계
  function currentPhase(companyId) {
    const requests = q.requestsByCompany.all(companyId).filter((r) => r.status !== 'rejected');
    if (requests.some((r) => r.phase === 'operation' && ['in_progress', 'completed'].includes(r.status))) {
      return 'operation';
    }
    if (requests.length > 0) return 'implementation';
    if (q.assessmentsByCompany.all(companyId).length > 0) return 'assessment';
    return 'none';
  }

  function cookie(res, token, maxAgeMs) {
    const parts = [
      `${auth.SESSION_COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ];
    if (secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // 상태 변경 요청은 JSON 본문만 허용해 폼 기반 CSRF를 차단한다(쿠키는 SameSite=Strict).
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return next(new HttpError(415, 'Content-Type은 application/json이어야 합니다.'));
    }
    const token = auth.parseCookies(req.headers.cookie)[auth.SESSION_COOKIE];
    req.sessionToken = token;
    req.user = sessions.lookup(token);
    next();
  });

  const requireClient = (req, res, next) =>
    req.user?.role === 'client' ? next() : next(new HttpError(req.user ? 403 : 401, '기업 회원 전용 기능입니다.'));
  const requireAdmin = (req, res, next) =>
    req.user?.role === 'admin' ? next() : next(new HttpError(req.user ? 403 : 401, '관리자 권한이 필요합니다.'));

  // ---------- 인증 ----------

  app.post('/api/auth/register', (req, res) => {
    const c = req.body?.company || {};
    const u = req.body?.user || {};

    const company = {
      name: text(c.name, '회사명', { max: 100 }),
      businessNumber: String(text(c.businessNumber, '사업자등록번호', { max: 12 })).replace(/-/g, ''),
      size: c.size,
      industry: text(c.industry, '업종', { max: 100 }),
      annualRevenue: int(c.annualRevenue, '연 매출액', { required: false }),
      employees: int(c.employees, '임직원 수', { max: 1e6, required: false }),
    };
    if (!SIZES[company.size]) throw bad('기업 규모는 중소기업 또는 중견기업이어야 합니다.');
    if (!auth.isValidBusinessNumber(company.businessNumber)) throw bad('유효한 사업자등록번호가 아닙니다.');

    const email = text(u.email, '이메일', { max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('이메일 형식이 올바르지 않습니다.');
    const name = text(u.name, '담당자명', { max: 50 });
    const phone = text(u.phone, '연락처', { max: 30, required: false });
    const pwError = auth.validatePassword(u.password);
    if (pwError) throw bad(pwError);
    if (u.agreeTerms !== true) throw bad('개인정보 수집·이용에 동의해 주세요.');

    if (q.userByEmail.get(email)) throw new HttpError(409, '이미 가입된 이메일입니다.');
    if (q.companyByBusinessNumber.get(company.businessNumber)) {
      throw new HttpError(409, '이미 등록된 사업자등록번호입니다. 기존 담당자에게 문의해 주세요.');
    }

    const userId = transaction(db, () => {
      const { lastInsertRowid: companyId } = q.insertCompany.run(
        company.name,
        company.businessNumber,
        company.size,
        company.industry,
        company.annualRevenue,
        company.employees,
      );
      return q.insertUser.run(companyId, email, name, phone, auth.hashPassword(u.password), 'client').lastInsertRowid;
    });

    const token = sessions.create(Number(userId));
    cookie(res, token, auth.SESSION_TTL_MS);
    res.status(201).json({ user: sessions.lookup(token) });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${email}|${req.ip}`;
    if (limiter.blocked(key)) throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');

    const user = email && q.userByEmail.get(email);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    limiter.reset(key);
    const token = sessions.create(user.id);
    cookie(res, token, auth.SESSION_TTL_MS);
    res.json({ user: sessions.lookup(token) });
  });

  app.post('/api/auth/logout', (req, res) => {
    sessions.destroy(req.sessionToken);
    cookie(res, '', 0);
    res.json({ ok: true });
  });

  // 비로그인 상태도 정상 응답(user: null)으로 돌려 프론트엔드가 오류 없이 분기하게 한다.
  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null, company: null });
    const company = req.user.companyId ? formatCompany(q.companyById.get(req.user.companyId)) : null;
    res.json({ user: req.user, company });
  });

  // ---------- 공개 카탈로그 ----------

  app.get('/api/catalog', (req, res) => {
    res.json({
      areas: catalog.AREAS,
      items: catalog.SERVICE_ITEMS,
      phases: catalog.PHASES,
      questions: assessment.QUESTIONS,
      areaNames: assessment.AREA_NAMES,
      sizes: SIZES,
      fee: { min: catalog.MIN_MONTHLY_FEE, max: catalog.MAX_MONTHLY_FEE },
    });
  });

  // ---------- 기업 회원 ----------

  app.get('/api/dashboard', requireClient, (req, res) => {
    const companyId = req.user.companyId;
    const latest = q.assessmentsByCompany.all(companyId)[0];
    const kpis = computeKpis(q.financialsByCompany.all(companyId));
    res.json({
      company: formatCompany(q.companyById.get(companyId)),
      phase: currentPhase(companyId),
      latestAssessment: latest
        ? { id: latest.id, createdAt: latest.created_at, ...JSON.parse(latest.result) }
        : null,
      requests: q.requestsByCompany.all(companyId).map(formatRequest),
      kpis: kpis.latest,
      deliverableCount: q.deliverablesByCompany.all(companyId).length,
    });
  });

  app.get('/api/assessments', requireClient, (req, res) => {
    const rows = q.assessmentsByCompany.all(req.user.companyId);
    res.json({
      assessments: rows.map((r) => {
        const result = JSON.parse(r.result);
        return { id: r.id, total: r.total_score, label: result.label, createdAt: r.created_at };
      }),
    });
  });

  app.get('/api/assessments/:id', requireClient, (req, res) => {
    const row = q.assessmentById.get(Number(req.params.id), req.user.companyId);
    if (!row) throw new HttpError(404, '진단 결과를 찾을 수 없습니다.');
    res.json({ id: row.id, createdAt: row.created_at, answers: JSON.parse(row.answers), ...JSON.parse(row.result) });
  });

  app.post('/api/assessments', requireClient, (req, res) => {
    const answers = req.body?.answers;
    const error = assessment.validateAnswers(answers);
    if (error) throw bad(error);
    const clean = Object.fromEntries(assessment.QUESTIONS.map((x) => [x.id, answers[x.id]]));
    const result = assessment.scoreAssessment(clean);

    const id = transaction(db, () => {
      const { lastInsertRowid } = q.insertAssessment.run(
        req.user.companyId,
        JSON.stringify(clean),
        JSON.stringify(result),
        result.total,
      );
      q.insertDeliverable.run(req.user.companyId, 'assessment', '재무·경영·자금관리 진단 보고서', diagnosisReport(result));
      return Number(lastInsertRowid);
    });
    res.status(201).json({ id, ...result });
  });

  function parseItems(items) {
    if (!Array.isArray(items) || items.length === 0) throw bad('서비스 항목을 하나 이상 선택해 주세요.');
    const unique = [...new Set(items)];
    if (unique.some((id) => !catalog.itemById.has(id))) throw bad('알 수 없는 서비스 항목이 포함되어 있습니다.');
    return unique;
  }

  app.post('/api/requests/estimate', requireClient, (req, res) => {
    res.json(catalog.estimateMonthlyFee(parseItems(req.body?.items)));
  });

  app.get('/api/requests', requireClient, (req, res) => {
    res.json({ requests: q.requestsByCompany.all(req.user.companyId).map(formatRequest) });
  });

  app.post('/api/requests', requireClient, (req, res) => {
    const phase = req.body?.phase;
    if (!['implementation', 'operation'].includes(phase)) throw bad('신청 단계가 올바르지 않습니다.');
    const items = parseItems(req.body?.items);
    const message = text(req.body?.message, '요청사항', { max: 2000, required: false });
    // 구축(개선안 제안) 단계는 무료, 운영(대행) 단계만 월 비용을 산정한다.
    const fee = phase === 'operation' ? catalog.estimateMonthlyFee(items) : { amount: 0, negotiable: false };
    const { lastInsertRowid } = q.insertRequest.run(
      req.user.companyId,
      phase,
      JSON.stringify(items),
      message,
      fee.amount,
      fee.negotiable ? 1 : 0,
    );
    res.status(201).json(formatRequest(q.requestById.get(Number(lastInsertRowid))));
  });

  app.get('/api/financials', requireClient, (req, res) => {
    res.json(computeKpis(q.financialsByCompany.all(req.user.companyId)));
  });

  function parseYm(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw bad('기준월은 YYYY-MM 형식이어야 합니다.');
    return value;
  }

  app.put('/api/financials/:ym', requireClient, (req, res) => {
    const ym = parseYm(req.params.ym);
    const b = req.body || {};
    q.upsertFinancial.run(
      req.user.companyId,
      ym,
      int(b.revenue, '매출액'),
      int(b.cogs, '매출원가'),
      int(b.opex, '판매비와관리비'),
      int(b.cashBalance, '기말 현금잔액', { min: -MAX_AMOUNT }),
    );
    res.json(computeKpis(q.financialsByCompany.all(req.user.companyId)));
  });

  app.delete('/api/financials/:ym', requireClient, (req, res) => {
    q.deleteFinancial.run(req.user.companyId, parseYm(req.params.ym));
    res.json(computeKpis(q.financialsByCompany.all(req.user.companyId)));
  });

  app.get('/api/deliverables', requireClient, (req, res) => {
    res.json({ deliverables: q.deliverablesByCompany.all(req.user.companyId).map(formatDeliverable) });
  });

  // ---------- 관리자(PwC 담당자) ----------

  app.get('/api/admin/companies', requireAdmin, (req, res) => {
    res.json({
      companies: q.adminCompanies.all().map((c) => ({
        ...formatCompany(c),
        latestScore: c.latest_score,
        requestCount: c.request_count,
        openRequests: c.open_requests,
        phase: currentPhase(c.id),
      })),
    });
  });

  app.get('/api/admin/companies/:id', requireAdmin, (req, res) => {
    const c = q.companyById.get(Number(req.params.id));
    if (!c) throw new HttpError(404, '기업을 찾을 수 없습니다.');
    const latest = q.assessmentsByCompany.all(c.id)[0];
    res.json({
      company: formatCompany(c),
      phase: currentPhase(c.id),
      users: q.usersByCompany.all(c.id),
      latestAssessment: latest ? { id: latest.id, createdAt: latest.created_at, ...JSON.parse(latest.result) } : null,
      requests: q.requestsByCompany.all(c.id).map(formatRequest),
      financials: computeKpis(q.financialsByCompany.all(c.id)),
      deliverables: q.deliverablesByCompany.all(c.id).map(formatDeliverable),
    });
  });

  app.get('/api/admin/requests', requireAdmin, (req, res) => {
    res.json({ requests: q.allRequests.all().map(formatRequest) });
  });

  app.patch('/api/admin/requests/:id', requireAdmin, (req, res) => {
    const row = q.requestById.get(Number(req.params.id));
    if (!row) throw new HttpError(404, '신청 건을 찾을 수 없습니다.');
    const status = req.body?.status ?? row.status;
    if (!REQUEST_STATUSES.includes(status)) throw bad('상태 값이 올바르지 않습니다.');
    const note =
      req.body?.adminNote === undefined ? row.admin_note : text(req.body.adminNote, '담당자 메모', { max: 2000, required: false });
    q.updateRequest.run(status, note, row.id);
    res.json(formatRequest(q.requestById.get(row.id)));
  });

  app.post('/api/admin/companies/:id/deliverables', requireAdmin, (req, res) => {
    const c = q.companyById.get(Number(req.params.id));
    if (!c) throw new HttpError(404, '기업을 찾을 수 없습니다.');
    const phase = req.body?.phase;
    if (!['assessment', 'implementation', 'operation'].includes(phase)) throw bad('단계 값이 올바르지 않습니다.');
    const title = text(req.body?.title, '제목', { max: 200 });
    const content = text(req.body?.content, '내용', { max: 20000 });
    const { lastInsertRowid } = q.insertDeliverable.run(c.id, phase, title, content);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  app.use('/api', (req, res, next) => next(new HttpError(404, '요청한 API를 찾을 수 없습니다.')));

  // ---------- 정적 파일 (SPA) ----------

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return app;
}

function diagnosisReport(result) {
  const lines = [
    `종합 점수: ${result.total}점 (${result.label})`,
    '',
    '[영역별 진단 결과]',
    ...result.areas.map((a) => `- ${a.name}: ${a.score}점 (${a.label})`),
    '',
    '[주요 개선 필요 사항]',
    ...(result.weaknesses.length ? result.weaknesses.map((w) => `- (${w.area}) ${w.text}`) : ['- 해당 없음']),
    '',
    '[추천 서비스]',
    ...(result.recommendedItems.length
      ? result.recommendedItems.map((id) => `- ${catalog.itemById.get(id).name}`)
      : ['- 현재 수준 유지 및 정기 점검 권장']),
  ];
  return lines.join('\n');
}

module.exports = { createApp };
