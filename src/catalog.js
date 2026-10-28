'use strict';

// 서비스 커버리지(service coverage.png)와 서비스 프로세스(service process.png)를 코드로 옮긴 카탈로그.

const AREAS = [
  { id: 'accounting', name: '재무회계' },
  { id: 'management', name: '경영관리' },
  { id: 'treasury', name: '자금관리' },
  { id: 'cfo', name: 'CFO 파견' },
];

// monthlyFee: 운영(대행) 단계에서 항목별 월 기준 단가(원). CFO 파견은 협의 항목이라 null.
const SERVICE_ITEMS = [
  { id: 'closing', area: 'accounting', name: '기장대리·결산조정·내부회계', detail: '기장대리, 결산조정, 내부회계', monthlyFee: 900000 },
  { id: 'tax', area: 'accounting', name: '세무조정·신고', detail: '세무조정 및 신고 지원', monthlyFee: 500000 },
  { id: 'receivable', area: 'accounting', name: '채권·재고관리', detail: '미수·미지급금, 재고 수불 관리', monthlyFee: 500000 },
  { id: 'asset', area: 'accounting', name: '자산건전성관리', detail: '현금·채권·자산 실사', monthlyFee: 400000 },
  { id: 'planning', area: 'management', name: '경영계획', detail: '사업계획, 재무계획, 차이분석', monthlyFee: 700000 },
  { id: 'pnl', area: 'management', name: '손익관리', detail: '구분손익, 손익추정', monthlyFee: 600000 },
  { id: 'kpi', area: 'management', name: '성과관리', detail: 'KPI 관리, 의사결정 지원', monthlyFee: 500000 },
  { id: 'project', area: 'management', name: 'Project 관리', detail: '원가관리, Time Report, 연구 노트', monthlyFee: 500000 },
  { id: 'cashflow', area: 'treasury', name: '자금수지', detail: 'Cashflow 계획, 차이 분석', monthlyFee: 600000 },
  { id: 'funding', area: 'treasury', name: '조달운용', detail: '차입·대여, 투자유치 지원', monthlyFee: 700000 },
  { id: 'disbursement', area: 'treasury', name: '출납마감', detail: '지출결의·지급요청, 수납·지급, 잔고내역관리', monthlyFee: 500000 },
  { id: 'risk', area: 'treasury', name: '위험관리', detail: 'C-level 질의 대응, 의심 거래', monthlyFee: 400000 },
  { id: 'cfo', area: 'cfo', name: 'CFO 파견', detail: '협의에 따라 진행', monthlyFee: null },
];

const PHASES = [
  {
    id: 'assessment',
    name: '진단',
    en: 'Assessment',
    title: '재무·경영·자금관리 진단',
    activities: ['질문지 Survey 및 담당자 Interview 기반', "PwC Finance Readiness Assessment' Toolkit 활용"],
    outputs: ['진단 보고서'],
    cost: '무료',
  },
  {
    id: 'implementation',
    name: '구축',
    en: 'Implementation',
    title: '기업 맞춤형 개선안 제안',
    activities: ['상세 Interview 및 Data 분석 기반', 'PwC Knowledge DB 및 타사 Leading Practice 활용'],
    outputs: ['개선과제 보고서', '규정·지침, 표준 양식 등'],
    cost: '무료',
  },
  {
    id: 'operation',
    name: '운영',
    en: 'Operation',
    title: '재무·경영·자금관리 대행',
    activities: ['PwC 재무성장 지원 서비스 전담 인력 직접 수행', '협력사 Ready-made 솔루션 활용'],
    outputs: ['결산 보고서, 계정별 내역서', '예산보고서, 성과분석서', '자금수지 보고서, 정기 회의'],
    cost: '유료 (1~5백만원/월)',
  },
];

const MIN_MONTHLY_FEE = 1000000;
const MAX_MONTHLY_FEE = 5000000;

const itemById = new Map(SERVICE_ITEMS.map((i) => [i.id, i]));

// 운영 단계 월 예상 비용. 선택 항목 단가 합계를 1~5백만원 범위로 맞추고, CFO 파견은 별도 협의로 표시한다.
function estimateMonthlyFee(itemIds) {
  const items = itemIds.map((id) => itemById.get(id)).filter(Boolean);
  const priced = items.filter((i) => i.monthlyFee !== null);
  const sum = priced.reduce((acc, i) => acc + i.monthlyFee, 0);
  const amount = priced.length === 0 ? 0 : Math.min(MAX_MONTHLY_FEE, Math.max(MIN_MONTHLY_FEE, sum));
  return { amount, negotiable: items.some((i) => i.monthlyFee === null) };
}

module.exports = { AREAS, SERVICE_ITEMS, PHASES, itemById, estimateMonthlyFee, MIN_MONTHLY_FEE, MAX_MONTHLY_FEE };
