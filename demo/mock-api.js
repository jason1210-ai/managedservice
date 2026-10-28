'use strict';

// 데모 빌드 전용: 서버(src/app.js)의 /api/* 를 브라우저 안에서 흉내 낸다.
// 데이터는 이 브라우저의 localStorage 에만 저장되며, 저장이 막혀 있으면 메모리에서만 동작한다.
// __mods 에는 빌드 스크립트가 src/catalog.js, assessment.js, finance.js 를 그대로 넣어 준다.
(() => {
  const catalog = __mods.catalog;
  const assessment = __mods.assessment;
  const { computeKpis } = __mods.finance;

  const STORAGE_KEY = 'fgs-demo-v1';
  const SIZES = { small: '중소기업', midsize: '중견기업' };
  const REQUEST_STATUSES = ['submitted', 'reviewing', 'in_progress', 'completed', 'rejected'];
  const DEMO_PASSWORD = 'Demo1234!';

  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const bad = (m) => new HttpError(400, m);

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function isValidBusinessNumber(value) {
    const digits = String(value).replace(/-/g, '');
    if (!/^\d{10}$/.test(digits)) return false;
    const d = [...digits].map(Number);
    const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let sum = weights.reduce((acc, w, i) => acc + d[i] * w, 0);
    sum += Math.floor((d[8] * 5) / 10);
    return (10 - (sum % 10)) % 10 === d[9];
  }

  // ---------- 저장소 ----------

  let db;

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* 저장소를 쓸 수 없으면 메모리에서만 유지 */
    }
  }

  async function seed() {
    const pw = await sha256(DEMO_PASSWORD);
    db = { seq: 0, sessionUserId: null, companies: [], users: [], assessments: [], requests: [], financials: [], deliverables: [] };
    const id = () => ++db.seq;
    db.users.push({ id: id(), companyId: null, email: 'admin@demo.local', name: 'PwC 담당자', role: 'admin', pw });

    const companies = [
      {
        name: 'H제약(데모)', businessNumber: '1234567891', size: 'midsize', industry: '제약', annualRevenue: 230000000000, employees: 180,
        email: 'h-pharma@demo.local', contact: '홍재무',
        answers: { a1: 2, m2: 1, m4: 1, m5: 2, o1: 1, o2: 2 },
        requests: [
          { phase: 'implementation', items: ['pnl', 'project'], message: '연구비 프로젝트별 관리 체계 필요', status: 'completed', adminNote: '개선과제 보고서 전달 완료' },
          { phase: 'operation', items: ['closing', 'pnl', 'project', 'cfo'], message: '재무인력 퇴사로 결산 대행 요청', status: 'in_progress', adminNote: '10월 결산부터 착수' },
        ],
        months: [
          ['2026-05', 19000000000, 11000000000, 7000000000, 21000000000],
          ['2026-06', 19500000000, 11200000000, 7100000000, 21400000000],
          ['2026-07', 18800000000, 11000000000, 7200000000, 21300000000],
          ['2026-08', 20100000000, 11500000000, 7000000000, 21900000000],
          ['2026-09', 20500000000, 11600000000, 7100000000, 22500000000],
        ],
        deliverables: [
          { phase: 'implementation', title: '연구비 관리 개선과제 보고서', content: '1. 파이프라인·프로젝트별 연구비 코드 체계 수립\n2. 월별 Time Report 기반 인건비 배부\n3. 건기식 제품 23개 비용 항목 판가 시뮬레이션 Template' },
          { phase: 'operation', title: '2026년 9월 결산 보고서', content: '매출액 205억원 (전월 대비 +2.0%)\n매출총이익률 43.4%\n영업이익 43억원 (영업이익률 21.0%)\n기말 현금 225억원' },
        ],
      },
      {
        name: 'G에이아이(데모)', businessNumber: '2208112341', size: 'small', industry: '생성형 AI', annualRevenue: 5000000000, employees: 37,
        email: 'g-ai@demo.local', contact: '김대표',
        answers: { t1: 1, t2: 1, t3: 2, o1: 1, m1: 2, m3: 2 },
        requests: [{ phase: 'implementation', items: ['cashflow', 'funding', 'kpi'], message: 'Runway 관리 및 투자사 KPI 대응', status: 'reviewing', adminNote: null }],
        months: [
          ['2026-05', 380000000, 120000000, 900000000, 6200000000],
          ['2026-06', 400000000, 130000000, 920000000, 5600000000],
          ['2026-07', 420000000, 140000000, 950000000, 5000000000],
          ['2026-08', 450000000, 150000000, 940000000, 4450000000],
          ['2026-09', 470000000, 150000000, 930000000, 3900000000],
        ],
        deliverables: [],
      },
    ];

    for (const c of companies) {
      const companyId = id();
      db.companies.push({
        id: companyId, name: c.name, businessNumber: c.businessNumber, size: c.size, industry: c.industry,
        annualRevenue: c.annualRevenue, employees: c.employees, createdAt: now(),
      });
      db.users.push({ id: id(), companyId, email: c.email, name: c.contact, role: 'client', pw });
      const full = Object.fromEntries(assessment.QUESTIONS.map((q) => [q.id, c.answers[q.id] ?? 3]));
      const result = assessment.scoreAssessment(full);
      db.assessments.push({ id: id(), companyId, answers: full, result, createdAt: now() });
      db.deliverables.push({ id: id(), companyId, phase: 'assessment', title: '재무·경영·자금관리 진단 보고서', content: diagnosisReport(result), createdAt: now() });
      for (const r of c.requests) {
        const fee = r.phase === 'operation' ? catalog.estimateMonthlyFee(r.items) : { amount: 0, negotiable: false };
        db.requests.push({ id: id(), companyId, ...r, monthlyFee: fee.amount, negotiable: fee.negotiable, createdAt: now(), updatedAt: now() });
      }
      for (const [ym, revenue, cogs, opex, cashBalance] of c.months) db.financials.push({ companyId, ym, revenue, cogs, opex, cashBalance });
      for (const d of c.deliverables) db.deliverables.push({ id: id(), companyId, ...d, createdAt: now() });
    }
    save();
  }

  async function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        db = JSON.parse(raw);
        return;
      }
    } catch {
      /* 저장소 없음 */
    }
    await seed();
  }

  const ready = load();

  // ---------- 서버와 같은 형태의 응답 ----------

  const nextId = () => ++db.seq;
  const company = (id) => db.companies.find((c) => c.id === id);
  const formatCompany = (c) => ({ ...c, sizeLabel: SIZES[c.size] });
  const formatRequest = (r) => ({ ...r, companyName: company(r.companyId)?.name });
  const byNewest = (a, b) => b.id - a.id;
  const requestsOf = (companyId) => db.requests.filter((r) => r.companyId === companyId).sort(byNewest);
  const assessmentsOf = (companyId) => db.assessments.filter((a) => a.companyId === companyId).sort(byNewest);
  const financialsOf = (companyId) => db.financials.filter((f) => f.companyId === companyId).map(({ companyId: _, ...f }) => f);
  const deliverablesOf = (companyId) => db.deliverables.filter((d) => d.companyId === companyId).sort(byNewest);

  function currentUser() {
    const u = db.users.find((x) => x.id === db.sessionUserId);
    return u ? { id: u.id, companyId: u.companyId, email: u.email, name: u.name, role: u.role } : null;
  }

  function currentPhase(companyId) {
    const requests = requestsOf(companyId).filter((r) => r.status !== 'rejected');
    if (requests.some((r) => r.phase === 'operation' && ['in_progress', 'completed'].includes(r.status))) return 'operation';
    if (requests.length > 0) return 'implementation';
    if (assessmentsOf(companyId).length > 0) return 'assessment';
    return 'none';
  }

  function latestAssessment(companyId) {
    const a = assessmentsOf(companyId)[0];
    return a ? { id: a.id, createdAt: a.createdAt, ...a.result } : null;
  }

  function diagnosisReport(result) {
    return [
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
    ].join('\n');
  }

  function text(value, field, { max = 200, required = true } = {}) {
    const v = typeof value === 'string' ? value.trim() : '';
    if (!v) {
      if (required) throw bad(`${field}을(를) 입력해 주세요.`);
      return null;
    }
    if (v.length > max) throw bad(`${field}은(는) ${max}자 이하로 입력해 주세요.`);
    return v;
  }

  function int(value, field, { min = 0, required = true } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw bad(`${field}을(를) 입력해 주세요.`);
      return null;
    }
    const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
    if (!Number.isInteger(n) || n < min || n > 1e15) throw bad(`${field} 값이 올바르지 않습니다.`);
    return n;
  }

  function parseItems(items) {
    if (!Array.isArray(items) || items.length === 0) throw bad('서비스 항목을 하나 이상 선택해 주세요.');
    const unique = [...new Set(items)];
    if (unique.some((i) => !catalog.itemById.has(i))) throw bad('알 수 없는 서비스 항목이 포함되어 있습니다.');
    return unique;
  }

  function parseYm(ym) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw bad('기준월은 YYYY-MM 형식이어야 합니다.');
    return ym;
  }

  function requireRole(role) {
    const u = currentUser();
    if (!u) throw new HttpError(401, '로그인이 필요합니다.');
    if (u.role !== role) throw new HttpError(403, role === 'admin' ? '관리자 권한이 필요합니다.' : '기업 회원 전용 기능입니다.');
    return u;
  }

  // ---------- 라우트 ----------

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, pattern, fn });

  route('GET', /^\/api\/catalog$/, () => ({
    areas: catalog.AREAS,
    items: catalog.SERVICE_ITEMS,
    phases: catalog.PHASES,
    questions: assessment.QUESTIONS,
    areaNames: assessment.AREA_NAMES,
    sizes: SIZES,
    fee: { min: catalog.MIN_MONTHLY_FEE, max: catalog.MAX_MONTHLY_FEE },
  }));

  route('GET', /^\/api\/auth\/me$/, () => {
    const user = currentUser();
    return { user, company: user?.companyId ? formatCompany(company(user.companyId)) : null };
  });

  route('POST', /^\/api\/auth\/login$/, async (body) => {
    const email = String(body.email || '').trim().toLowerCase();
    const u = db.users.find((x) => x.email === email);
    if (!u || u.pw !== (await sha256(String(body.password || '')))) {
      throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    db.sessionUserId = u.id;
    return { user: currentUser() };
  });

  route('POST', /^\/api\/auth\/logout$/, () => {
    db.sessionUserId = null;
    return { ok: true };
  });

  route('POST', /^\/api\/auth\/register$/, async (body) => {
    const c = body.company || {};
    const u = body.user || {};
    const businessNumber = String(text(c.businessNumber, '사업자등록번호', { max: 12 })).replace(/-/g, '');
    const record = {
      name: text(c.name, '회사명', { max: 100 }),
      businessNumber,
      size: c.size,
      industry: text(c.industry, '업종', { max: 100 }),
      annualRevenue: int(c.annualRevenue, '연 매출액', { required: false }),
      employees: int(c.employees, '임직원 수', { required: false }),
    };
    if (!SIZES[record.size]) throw bad('기업 규모는 중소기업 또는 중견기업이어야 합니다.');
    if (!isValidBusinessNumber(businessNumber)) throw bad('유효한 사업자등록번호가 아닙니다. (데모 예: 211-87-00014)');
    const email = text(u.email, '이메일', { max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('이메일 형식이 올바르지 않습니다.');
    const name = text(u.name, '담당자명', { max: 50 });
    const pw = String(u.password || '');
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.');
    if (u.agreeTerms !== true) throw bad('개인정보 수집·이용에 동의해 주세요.');
    if (db.users.some((x) => x.email === email)) throw new HttpError(409, '이미 가입된 이메일입니다.');
    if (db.companies.some((x) => x.businessNumber === businessNumber)) throw new HttpError(409, '이미 등록된 사업자등록번호입니다.');

    const companyId = nextId();
    db.companies.push({ id: companyId, ...record, createdAt: now() });
    const userId = nextId();
    db.users.push({ id: userId, companyId, email, name, phone: u.phone || null, role: 'client', pw: await sha256(pw) });
    db.sessionUserId = userId;
    return { user: currentUser() };
  });

  route('GET', /^\/api\/dashboard$/, () => {
    const { companyId } = requireRole('client');
    return {
      company: formatCompany(company(companyId)),
      phase: currentPhase(companyId),
      latestAssessment: latestAssessment(companyId),
      requests: requestsOf(companyId).map(formatRequest),
      kpis: computeKpis(financialsOf(companyId)).latest,
      deliverableCount: deliverablesOf(companyId).length,
    };
  });

  route('GET', /^\/api\/assessments$/, () => {
    const { companyId } = requireRole('client');
    return {
      assessments: assessmentsOf(companyId).map((a) => ({ id: a.id, total: a.result.total, label: a.result.label, createdAt: a.createdAt })),
    };
  });

  route('GET', /^\/api\/assessments\/(\d+)$/, (body, [id]) => {
    const { companyId } = requireRole('client');
    const a = db.assessments.find((x) => x.id === Number(id) && x.companyId === companyId);
    if (!a) throw new HttpError(404, '진단 결과를 찾을 수 없습니다.');
    return { id: a.id, createdAt: a.createdAt, answers: a.answers, ...a.result };
  });

  route('POST', /^\/api\/assessments$/, (body) => {
    const { companyId } = requireRole('client');
    const error = assessment.validateAnswers(body.answers);
    if (error) throw bad(error);
    const answers = Object.fromEntries(assessment.QUESTIONS.map((q) => [q.id, body.answers[q.id]]));
    const result = assessment.scoreAssessment(answers);
    const id = nextId();
    db.assessments.push({ id, companyId, answers, result, createdAt: now() });
    db.deliverables.push({ id: nextId(), companyId, phase: 'assessment', title: '재무·경영·자금관리 진단 보고서', content: diagnosisReport(result), createdAt: now() });
    return { id, ...result };
  });

  route('POST', /^\/api\/requests\/estimate$/, (body) => {
    requireRole('client');
    return catalog.estimateMonthlyFee(parseItems(body.items));
  });

  route('GET', /^\/api\/requests$/, () => {
    const { companyId } = requireRole('client');
    return { requests: requestsOf(companyId).map(formatRequest) };
  });

  route('POST', /^\/api\/requests$/, (body) => {
    const { companyId } = requireRole('client');
    if (!['implementation', 'operation'].includes(body.phase)) throw bad('신청 단계가 올바르지 않습니다.');
    const items = parseItems(body.items);
    const fee = body.phase === 'operation' ? catalog.estimateMonthlyFee(items) : { amount: 0, negotiable: false };
    const r = {
      id: nextId(), companyId, phase: body.phase, items,
      message: text(body.message, '요청사항', { max: 2000, required: false }),
      monthlyFee: fee.amount, negotiable: fee.negotiable, status: 'submitted', adminNote: null, createdAt: now(), updatedAt: now(),
    };
    db.requests.push(r);
    return formatRequest(r);
  });

  route('GET', /^\/api\/financials$/, () => computeKpis(financialsOf(requireRole('client').companyId)));

  route('PUT', /^\/api\/financials\/([^/]+)$/, (body, [ym]) => {
    const { companyId } = requireRole('client');
    parseYm(ym);
    const record = {
      companyId, ym,
      revenue: int(body.revenue, '매출액'),
      cogs: int(body.cogs, '매출원가'),
      opex: int(body.opex, '판매비와관리비'),
      cashBalance: int(body.cashBalance, '기말 현금잔액', { min: -1e15 }),
    };
    db.financials = db.financials.filter((f) => !(f.companyId === companyId && f.ym === ym));
    db.financials.push(record);
    return computeKpis(financialsOf(companyId));
  });

  route('DELETE', /^\/api\/financials\/([^/]+)$/, (body, [ym]) => {
    const { companyId } = requireRole('client');
    parseYm(ym);
    db.financials = db.financials.filter((f) => !(f.companyId === companyId && f.ym === ym));
    return computeKpis(financialsOf(companyId));
  });

  route('GET', /^\/api\/deliverables$/, () => ({ deliverables: deliverablesOf(requireRole('client').companyId) }));

  route('GET', /^\/api\/admin\/companies$/, () => {
    requireRole('admin');
    return {
      companies: [...db.companies].sort(byNewest).map((c) => ({
        ...formatCompany(c),
        latestScore: latestAssessment(c.id)?.total ?? null,
        requestCount: requestsOf(c.id).length,
        openRequests: requestsOf(c.id).filter((r) => ['submitted', 'reviewing'].includes(r.status)).length,
        phase: currentPhase(c.id),
      })),
    };
  });

  route('GET', /^\/api\/admin\/companies\/(\d+)$/, (body, [id]) => {
    requireRole('admin');
    const c = company(Number(id));
    if (!c) throw new HttpError(404, '기업을 찾을 수 없습니다.');
    return {
      company: formatCompany(c),
      phase: currentPhase(c.id),
      users: db.users.filter((u) => u.companyId === c.id).map(({ id: uid, email, name, phone }) => ({ id: uid, email, name, phone })),
      latestAssessment: latestAssessment(c.id),
      requests: requestsOf(c.id).map(formatRequest),
      financials: computeKpis(financialsOf(c.id)),
      deliverables: deliverablesOf(c.id),
    };
  });

  route('GET', /^\/api\/admin\/requests$/, () => {
    requireRole('admin');
    return { requests: [...db.requests].sort(byNewest).map(formatRequest) };
  });

  route('PATCH', /^\/api\/admin\/requests\/(\d+)$/, (body, [id]) => {
    requireRole('admin');
    const r = db.requests.find((x) => x.id === Number(id));
    if (!r) throw new HttpError(404, '신청 건을 찾을 수 없습니다.');
    const status = body.status ?? r.status;
    if (!REQUEST_STATUSES.includes(status)) throw bad('상태 값이 올바르지 않습니다.');
    r.status = status;
    if (body.adminNote !== undefined) r.adminNote = text(body.adminNote, '담당자 메모', { max: 2000, required: false });
    r.updatedAt = now();
    return formatRequest(r);
  });

  route('POST', /^\/api\/admin\/companies\/(\d+)\/deliverables$/, (body, [id]) => {
    requireRole('admin');
    const c = company(Number(id));
    if (!c) throw new HttpError(404, '기업을 찾을 수 없습니다.');
    if (!['assessment', 'implementation', 'operation'].includes(body.phase)) throw bad('단계 값이 올바르지 않습니다.');
    const d = {
      id: nextId(), companyId: c.id, phase: body.phase,
      title: text(body.title, '제목'), content: text(body.content, '내용', { max: 20000 }), createdAt: now(),
    };
    db.deliverables.push(d);
    return { id: d.id };
  });

  // ---------- fetch 가로채기 ----------

  const realFetch = window.fetch.bind(window);
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    await ready;
    const method = (init.method || 'GET').toUpperCase();
    const r = routes.find((x) => x.method === method && x.pattern.test(url.pathname));
    if (!r) return json(404, { error: '요청한 API를 찾을 수 없습니다.' });
    try {
      const body = init.body ? JSON.parse(init.body) : {};
      const data = await r.fn(body, url.pathname.match(r.pattern).slice(1));
      save();
      return json(method === 'POST' && /register|assessments$|requests$/.test(url.pathname) ? 201 : 200, data);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      console.error(err);
      return json(500, { error: '오류가 발생했습니다.' });
    }
  };

  window.fgsDemoReset = async () => {
    await seed();
  };
})();
