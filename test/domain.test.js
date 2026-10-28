'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidBusinessNumber, validatePassword, hashPassword, verifyPassword } = require('../src/auth');
const { QUESTIONS, scoreAssessment, validateAnswers } = require('../src/assessment');
const { estimateMonthlyFee } = require('../src/catalog');
const { computeKpis } = require('../src/finance');

const allAnswers = (v) => Object.fromEntries(QUESTIONS.map((q) => [q.id, v]));

test('사업자등록번호 검증번호를 확인한다', () => {
  assert.equal(isValidBusinessNumber('123-45-67891'), true);
  assert.equal(isValidBusinessNumber('1234567890'), false);
  assert.equal(isValidBusinessNumber('12345'), false);
});

test('비밀번호 정책과 해시 검증', () => {
  assert.ok(validatePassword('short1'));
  assert.ok(validatePassword('onlyletters'));
  assert.equal(validatePassword('Passw0rd!'), null);
  const hash = hashPassword('Passw0rd!');
  assert.equal(verifyPassword('Passw0rd!', hash), true);
  assert.equal(verifyPassword('wrong-pass1', hash), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});

test('진단 점수: 전 문항 5점이면 100점/우수, 추천 없음', () => {
  const r = scoreAssessment(allAnswers(5));
  assert.equal(r.total, 100);
  assert.equal(r.label, '우수');
  assert.deepEqual(r.recommendedItems, []);
});

test('진단 점수: 낮은 응답 문항의 서비스가 추천된다', () => {
  const answers = { ...allAnswers(4), t1: 1, t2: 2, o1: 1 };
  const r = scoreAssessment(answers);
  const treasury = r.areas.find((a) => a.id === 'treasury');
  assert.ok(treasury.score < r.areas.find((a) => a.id === 'accounting').score);
  assert.deepEqual(r.recommendedItems.sort(), ['cashflow', 'cfo']);
  assert.equal(r.weaknesses.length, 3);
});

test('진단 응답 검증', () => {
  assert.ok(validateAnswers({}));
  assert.ok(validateAnswers({ ...allAnswers(3), a1: 6 }));
  assert.equal(validateAnswers(allAnswers(3)), null);
});

test('운영 비용은 월 1~5백만원 범위로 산정되고 CFO 파견은 협의', () => {
  assert.deepEqual(estimateMonthlyFee(['risk']), { amount: 1000000, negotiable: false });
  assert.deepEqual(estimateMonthlyFee(['closing', 'tax']), { amount: 1400000, negotiable: false });
  const all = ['closing', 'tax', 'receivable', 'asset', 'planning', 'pnl', 'kpi', 'project', 'cashflow', 'funding'];
  assert.equal(estimateMonthlyFee(all).amount, 5000000);
  assert.deepEqual(estimateMonthlyFee(['cfo']), { amount: 0, negotiable: true });
});

test('재무 KPI: 수익성, Burn, Runway', () => {
  const { months, latest } = computeKpis([
    { ym: '2026-03', revenue: 100, cogs: 40, opex: 80, cashBalance: 1000 },
    { ym: '2026-01', revenue: 100, cogs: 40, opex: 80, cashBalance: 1200 },
    { ym: '2026-02', revenue: 80, cogs: 40, opex: 80, cashBalance: 1100 },
  ]);
  assert.deepEqual(
    months.map((m) => m.ym),
    ['2026-01', '2026-02', '2026-03'],
  );
  assert.equal(latest.grossMargin, 60);
  assert.equal(latest.operatingMargin, -20);
  assert.equal(latest.netBurn, 100);
  assert.equal(latest.runwayMonths, 10);
  assert.equal(latest.revenueGrowth, 25);
});

test('재무 KPI: 현금이 늘면 Runway 없음, 데이터 없으면 null', () => {
  const { latest } = computeKpis([
    { ym: '2026-01', revenue: 100, cogs: 10, opex: 10, cashBalance: 100 },
    { ym: '2026-02', revenue: 100, cogs: 10, opex: 10, cashBalance: 200 },
  ]);
  assert.equal(latest.netBurn, 0);
  assert.equal(latest.runwayMonths, null);
  assert.equal(computeKpis([]).latest, null);
});
