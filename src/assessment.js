'use strict';

// Finance Readiness 자가진단 질문지. 각 문항은 1(전혀 아니다) ~ 5(매우 그렇다)로 응답한다.
const QUESTIONS = [
  { id: 'a1', area: 'accounting', text: '월 결산이 다음 달 10영업일 이내에 마감된다.', items: ['closing'] },
  { id: 'a2', area: 'accounting', text: '계정과목 체계와 회계처리 기준이 문서화되어 있다.', items: ['closing'] },
  { id: 'a3', area: 'accounting', text: '세무조정·신고 일정을 누락 없이 관리하고 있다.', items: ['tax'] },
  { id: 'a4', area: 'accounting', text: '거래처별 미수·미지급금과 재고 수불이 정기적으로 대사된다.', items: ['receivable'] },
  { id: 'a5', area: 'accounting', text: '현금·채권·자산 실사를 정기적으로 수행한다.', items: ['asset'] },
  { id: 'm1', area: 'management', text: '연간 사업계획과 재무계획을 수립하고 실적과 차이를 분석한다.', items: ['planning'] },
  { id: 'm2', area: 'management', text: '제품·사업부·고객별 구분손익을 산출할 수 있다.', items: ['pnl'] },
  { id: 'm3', area: 'management', text: '경영진이 정기적으로 KPI 리포트를 받아 의사결정에 활용한다.', items: ['kpi'] },
  { id: 'm4', area: 'management', text: '프로젝트(연구개발 포함)별 투입 원가와 시간을 구분 관리한다.', items: ['project'] },
  { id: 'm5', area: 'management', text: '신규 제품·서비스의 원가 분석에 기반해 판가를 설정한다.', items: ['pnl', 'planning'] },
  { id: 't1', area: 'treasury', text: '향후 3~12개월 자금수지 계획을 수립하고 실적과 비교한다.', items: ['cashflow'] },
  { id: 't2', area: 'treasury', text: '현재 보유 자금으로 버틸 수 있는 기간(Runway)을 파악하고 있다.', items: ['cashflow'] },
  { id: 't3', area: 'treasury', text: '차입·투자유치 등 자금조달 계획과 대응 인력이 있다.', items: ['funding'] },
  { id: 't4', area: 'treasury', text: '지출결의·지급 승인 절차가 규정화되어 운영된다.', items: ['disbursement'] },
  { id: 't5', area: 'treasury', text: '이상·의심 거래를 식별하고 경영진 질의에 대응하는 체계가 있다.', items: ['risk'] },
  { id: 'o1', area: 'organization', text: '재무 전담 인력(또는 CFO)이 안정적으로 확보되어 있다.', items: ['cfo'] },
  { id: 'o2', area: 'organization', text: '재무 인력 이탈 시에도 업무 인수인계가 가능하도록 문서화되어 있다.', items: ['closing', 'cfo'] },
];

const AREA_NAMES = {
  accounting: '재무회계',
  management: '경영관리',
  treasury: '자금관리',
  organization: '재무조직',
};

function levelOf(score) {
  if (score >= 80) return { level: 4, label: '우수' };
  if (score >= 60) return { level: 3, label: '양호' };
  if (score >= 40) return { level: 2, label: '개선 필요' };
  return { level: 1, label: '취약' };
}

// answers: { [questionId]: 1..5 } — 모든 문항에 응답해야 한다.
function validateAnswers(answers) {
  if (!answers || typeof answers !== 'object') return '응답이 없습니다.';
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    if (!Number.isInteger(v) || v < 1 || v > 5) return `문항 ${q.id}에 1~5 사이로 응답해 주세요.`;
  }
  return null;
}

// 1~5점 응답을 0~100점으로 환산한다(1점=0, 5점=100).
function toScore(v) {
  return ((v - 1) / 4) * 100;
}

function scoreAssessment(answers) {
  const byArea = {};
  for (const q of QUESTIONS) {
    (byArea[q.area] ||= []).push(toScore(answers[q.id]));
  }
  const areas = Object.entries(byArea).map(([id, scores]) => {
    const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return { id, name: AREA_NAMES[id], score, ...levelOf(score) };
  });
  const total = Math.round(areas.reduce((a, b) => a + b.score, 0) / areas.length);

  // 2점 이하로 응답한 문항에 연결된 서비스 항목을 우선순위가 높은 개선과제로 추천한다.
  const weak = QUESTIONS.filter((q) => answers[q.id] <= 2);
  const recommended = [...new Set(weak.flatMap((q) => q.items))];

  return {
    total,
    ...levelOf(total),
    areas,
    weaknesses: weak.map((q) => ({ id: q.id, area: AREA_NAMES[q.area], text: q.text, answer: answers[q.id] })),
    recommendedItems: recommended,
  };
}

module.exports = { QUESTIONS, AREA_NAMES, validateAnswers, scoreAssessment, levelOf };
