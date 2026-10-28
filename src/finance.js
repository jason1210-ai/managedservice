'use strict';

// 월별 재무 실적으로 핵심 지표(수익성, Burn rate, Runway)를 계산한다. 금액 단위는 원.

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

// records: [{ ym: 'YYYY-MM', revenue, cogs, opex, cashBalance }]
function computeKpis(records) {
  const sorted = [...records].sort((a, b) => a.ym.localeCompare(b.ym));
  const months = sorted.map((r) => {
    const grossProfit = r.revenue - r.cogs;
    const operatingIncome = grossProfit - r.opex;
    return {
      ...r,
      grossProfit,
      operatingIncome,
      grossMargin: ratio(grossProfit, r.revenue),
      operatingMargin: ratio(operatingIncome, r.revenue),
    };
  });

  if (months.length === 0) return { months, latest: null };

  const latest = months[months.length - 1];

  // 최근 최대 3개월간의 월평균 현금 감소액(Net burn). 한 달치만 있으면 영업손실로 추정한다.
  const window = months.slice(-4);
  const netBurn =
    window.length >= 2
      ? Math.round((window[0].cashBalance - latest.cashBalance) / (window.length - 1))
      : -latest.operatingIncome;
  const runwayMonths = netBurn > 0 ? Math.round((latest.cashBalance / netBurn) * 10) / 10 : null;

  const prev = months[months.length - 2];
  const revenueGrowth = prev ? ratio(latest.revenue - prev.revenue, prev.revenue) : null;

  return {
    months,
    latest: {
      ym: latest.ym,
      revenue: latest.revenue,
      grossMargin: latest.grossMargin,
      operatingMargin: latest.operatingMargin,
      cashBalance: latest.cashBalance,
      revenueGrowth,
      netBurn: netBurn > 0 ? netBurn : 0,
      runwayMonths,
    },
  };
}

module.exports = { computeKpis };
