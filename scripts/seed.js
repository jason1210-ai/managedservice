'use strict';

// 데모 데이터: 관리자 1명, 고객 기업 2곳(사례 기반)과 진단·신청·재무 실적을 생성한다.
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { QUESTIONS, scoreAssessment } = require('../src/assessment');
const { estimateMonthlyFee } = require('../src/catalog');

const db = openDatabase(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db'));
const PASSWORD = 'Demo1234!';

function upsertUser(companyId, email, name, role) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return;
  db.prepare('INSERT INTO users (company_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    companyId,
    email,
    name,
    hashPassword(PASSWORD),
    role,
  );
}

function seedCompany({ name, brn, size, industry, revenue, employees, email, contact, answers, requests, months }) {
  if (db.prepare('SELECT 1 FROM companies WHERE business_number = ?').get(brn)) return;
  const id = Number(
    db
      .prepare('INSERT INTO companies (name, business_number, size, industry, annual_revenue, employees) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, brn, size, industry, revenue, employees).lastInsertRowid,
  );
  upsertUser(id, email, contact, 'client');

  const full = Object.fromEntries(QUESTIONS.map((q) => [q.id, answers[q.id] ?? 3]));
  const result = scoreAssessment(full);
  db.prepare('INSERT INTO assessments (company_id, answers, result, total_score) VALUES (?, ?, ?, ?)').run(
    id,
    JSON.stringify(full),
    JSON.stringify(result),
    result.total,
  );

  for (const r of requests) {
    const fee = r.phase === 'operation' ? estimateMonthlyFee(r.items) : { amount: 0, negotiable: false };
    db.prepare(
      'INSERT INTO service_requests (company_id, phase, items, message, monthly_fee, negotiable, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, r.phase, JSON.stringify(r.items), r.message, fee.amount, fee.negotiable ? 1 : 0, r.status);
  }

  for (const m of months) {
    db.prepare(
      'INSERT INTO financial_records (company_id, ym, revenue, cogs, opex, cash_balance) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, m[0], m[1], m[2], m[3], m[4]);
  }
}

upsertUser(null, 'admin@demo.local', 'PwC 담당자', 'admin');

seedCompany({
  name: 'H제약(데모)',
  brn: '1234567891',
  size: 'midsize',
  industry: '제약',
  revenue: 230000000000,
  employees: 180,
  email: 'h-pharma@demo.local',
  contact: '홍재무',
  answers: { a1: 2, m2: 1, m4: 1, m5: 2, o1: 1, o2: 2 },
  requests: [
    { phase: 'implementation', items: ['pnl', 'project'], message: '연구비 프로젝트별 관리 체계 필요', status: 'completed' },
    { phase: 'operation', items: ['closing', 'pnl', 'project', 'cfo'], message: '재무인력 퇴사로 결산 대행 요청', status: 'in_progress' },
  ],
  months: [
    ['2026-05', 19000000000, 11000000000, 7000000000, 21000000000],
    ['2026-06', 19500000000, 11200000000, 7100000000, 21400000000],
    ['2026-07', 18800000000, 11000000000, 7200000000, 21300000000],
    ['2026-08', 20100000000, 11500000000, 7000000000, 21900000000],
    ['2026-09', 20500000000, 11600000000, 7100000000, 22500000000],
  ],
});

seedCompany({
  name: 'G에이아이(데모)',
  brn: '2208112341',
  size: 'small',
  industry: '생성형 AI',
  revenue: 5000000000,
  employees: 37,
  email: 'g-ai@demo.local',
  contact: '김대표',
  answers: { t1: 1, t2: 1, t3: 2, o1: 1, m1: 2, m3: 2 },
  requests: [{ phase: 'implementation', items: ['cashflow', 'funding', 'kpi'], message: 'Runway 관리 및 투자사 KPI 대응', status: 'reviewing' }],
  months: [
    ['2026-05', 380000000, 120000000, 900000000, 6200000000],
    ['2026-06', 400000000, 130000000, 920000000, 5600000000],
    ['2026-07', 420000000, 140000000, 950000000, 5000000000],
    ['2026-08', 450000000, 150000000, 940000000, 4450000000],
    ['2026-09', 470000000, 150000000, 930000000, 3900000000],
  ],
});

console.log(`데모 데이터 생성 완료 (비밀번호: ${PASSWORD})
  관리자: admin@demo.local
  고객:   h-pharma@demo.local, g-ai@demo.local`);
