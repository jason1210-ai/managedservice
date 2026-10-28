'use strict';

(() => {
  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  const toastEl = document.getElementById('toast');

  const state = { me: null, catalog: null };

  const PHASE_LABEL = { none: '미시작', assessment: '진단', implementation: '구축', operation: '운영' };
  const STATUS_LABEL = {
    submitted: '접수',
    reviewing: '검토중',
    in_progress: '진행중',
    completed: '완료',
    rejected: '반려',
  };

  // ---------- 유틸 ----------

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const won = (n) => (n === null || n === undefined ? '-' : `${Number(n).toLocaleString('ko-KR')}원`);
  const manwon = (n) => {
    if (n === null || n === undefined) return '-';
    if (Math.abs(n) >= 1e8) return `${(n / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억원`;
    return `${Math.round(n / 10000).toLocaleString('ko-KR')}만원`;
  };
  const pct = (n) => (n === null || n === undefined ? '-' : `${n}%`);
  const date = (s) => (s ? s.slice(0, 10) : '');
  const itemName = (id) => state.catalog.items.find((i) => i.id === id)?.name || id;

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(message, kind = 'info') {
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (toastEl.className = 'toast'), 3000);
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  const go = (hash) => {
    if (location.hash === hash) render();
    else location.hash = hash;
  };

  // 0~100 점수를 가로 막대로 표시한다(CSP상 인라인 style을 쓰지 않으므로 SVG 사용).
  function scoreBar(score) {
    const cls = score >= 80 ? 'good' : score >= 60 ? 'ok' : score >= 40 ? 'warn' : 'bad';
    return `<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label="${score}점">
      <rect class="bar-bg" x="0" y="0" width="100" height="8" rx="4"></rect>
      <rect class="bar-fg ${cls}" x="0" y="0" width="${Math.max(0, Math.min(100, score))}" height="8" rx="4"></rect>
    </svg>`;
  }

  function phaseStepper(current) {
    const order = ['assessment', 'implementation', 'operation'];
    const idx = order.indexOf(current);
    return `<ol class="stepper">${state.catalog.phases
      .map((p, i) => {
        const cls = i < idx ? 'done' : i === idx ? 'active' : '';
        return `<li class="${cls}"><strong>${esc(p.name)}</strong><span>${esc(p.en)}</span><em>${esc(p.cost)}</em></li>`;
      })
      .join('')}</ol>`;
  }

  // ---------- 네비게이션 ----------

  function renderNav() {
    const me = state.me?.user;
    if (!me) {
      nav.innerHTML = `<a href="#/">서비스 소개</a><a href="#/login">로그인</a><a class="btn small" href="#/register">기업 회원가입</a>`;
    } else if (me.role === 'admin') {
      nav.innerHTML = `<a href="#/admin">기업 관리</a><a href="#/admin/requests">신청 관리</a>
        <span class="who">${esc(me.name)}</span><button class="link" data-action="logout">로그아웃</button>`;
    } else {
      nav.innerHTML = `<a href="#/dashboard">대시보드</a><a href="#/assessment">재무진단</a><a href="#/services">서비스 신청</a>
        <a href="#/financials">재무현황</a><a href="#/deliverables">산출물</a>
        <span class="who">${esc(state.me.company?.name)} · ${esc(me.name)}</span>
        <button class="link" data-action="logout">로그아웃</button>`;
    }
    for (const a of nav.querySelectorAll('a')) {
      a.classList.toggle('current', a.getAttribute('href') === (location.hash || '#/'));
    }
  }

  nav.addEventListener('click', async (e) => {
    if (e.target.dataset.action !== 'logout') return;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    toast('로그아웃되었습니다.');
    go('#/');
  });

  // ---------- 공개 화면 ----------

  function landing() {
    const { phases, areas, items } = state.catalog;
    const loggedIn = Boolean(state.me);
    view.innerHTML = `
      <section class="hero">
        <p class="eyebrow">Finance Team-as-a-Service</p>
        <h1>재무팀이 없어도,<br />재무로 성장하는 회사</h1>
        <p class="lead">중소·중견기업을 위한 PwC 재무성장지원서비스. 무료 재무진단부터 맞춤형 개선안, 재무·경영·자금관리 운영 대행까지 한 곳에서 신청하고 관리하세요.</p>
        <div class="actions">
          ${
            loggedIn
              ? `<a class="btn" href="${state.me.user.role === 'admin' ? '#/admin' : '#/dashboard'}">내 대시보드로 이동</a>`
              : `<a class="btn" href="#/register">무료 진단 시작하기</a><a class="btn ghost" href="#/login">로그인</a>`
          }
        </div>
      </section>

      <section>
        <h2>서비스 프로세스</h2>
        <div class="grid three">
          ${phases
            .map(
              (p) => `<article class="card phase">
                <header><h3>${esc(p.name)} <small>${esc(p.en)}</small></h3><span class="tag">${esc(p.cost)}</span></header>
                <p class="strong">${esc(p.title)}</p>
                <ul>${p.activities.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
                <p class="muted">산출물</p>
                <ul>${p.outputs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
              </article>`,
            )
            .join('')}
        </div>
      </section>

      <section>
        <h2>서비스 커버리지</h2>
        <div class="grid four">
          ${areas
            .map(
              (a) => `<article class="card coverage">
                <h3>${esc(a.name)}</h3>
                <ul>${items
                  .filter((i) => i.area === a.id)
                  .map((i) => `<li><strong>${esc(i.name)}</strong><br /><span class="muted">${esc(i.detail)}</span></li>`)
                  .join('')}</ul>
              </article>`,
            )
            .join('')}
        </div>
      </section>

      <section>
        <h2>도입 사례</h2>
        <div class="grid two">
          <article class="card case">
            <h3>제약산업 중견기업 H사</h3>
            <p class="muted">Pharma · 매출 2,300억 · 임직원 약 180명</p>
            <p>CFO 포함 재무인력 동시 퇴사, 연구비 관리 체계 미흡, 신규 제품 판가 설정 지연</p>
            <p><span class="tag">해결</span> 18가지 재무기능 및 건기식 제품 수익성 예측 서비스, 월간 회의 참석 및 손익분석 지원</p>
            <p class="result">인건비 연 2억 2천만원 절감 · 특허 매매 지원(이익율 78%)</p>
          </article>
          <article class="card case">
            <h3>생성형 AI 스타트업 G사</h3>
            <p class="muted">생성형 AI · 매출 50억 · 임직원 약 37명</p>
            <p>재무조직 부재, Runway 관리 체계 미흡, 투자사 펀드 만기 도래</p>
            <p><span class="tag">해결</span> 12가지 재무기능 및 고정비 계정별 동인분석, CFO 파견 및 고정비 절감 Operation</p>
            <p class="result">인건비 1억 5천만원 · 인건비 외 고정비 3억 4천만원 절감</p>
          </article>
        </div>
      </section>`;
  }

  function login() {
    view.innerHTML = `
      <section class="auth card">
        <h1>로그인</h1>
        <form id="login-form" class="form">
          <label>이메일<input name="email" type="email" autocomplete="username" required /></label>
          <label>비밀번호<input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="btn" type="submit">로그인</button>
        </form>
        <p class="muted">아직 회원이 아니신가요? <a href="#/register">기업 회원가입</a></p>
      </section>`;
    view.querySelector('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
        state.me = await api('/api/auth/me');
        toast('로그인되었습니다.', 'success');
        go(state.me.user.role === 'admin' ? '#/admin' : '#/dashboard');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function register() {
    view.innerHTML = `
      <section class="auth card wide">
        <h1>기업 회원가입</h1>
        <p class="muted">중소·중견기업이라면 누구나 무료 재무진단을 받을 수 있습니다.</p>
        <form id="register-form" class="form">
          <fieldset>
            <legend>기업 정보</legend>
            <div class="row">
              <label>회사명<input name="companyName" required maxlength="100" /></label>
              <label>사업자등록번호<input name="businessNumber" required placeholder="000-00-00000" inputmode="numeric" /></label>
            </div>
            <div class="row">
              <label>기업 규모
                <select name="size" required>
                  <option value="small">중소기업</option>
                  <option value="midsize">중견기업</option>
                </select>
              </label>
              <label>업종<input name="industry" required placeholder="예: 제약, 생성형 AI, 제조" /></label>
            </div>
            <div class="row">
              <label>연 매출액(원)<input name="annualRevenue" inputmode="numeric" placeholder="예: 5000000000" /></label>
              <label>임직원 수<input name="employees" type="number" min="0" /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>담당자 정보</legend>
            <div class="row">
              <label>담당자명<input name="name" required maxlength="50" /></label>
              <label>연락처<input name="phone" type="tel" /></label>
            </div>
            <div class="row">
              <label>이메일(로그인 ID)<input name="email" type="email" autocomplete="username" required /></label>
              <label>비밀번호<input name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="영문·숫자 포함 8자 이상" /></label>
            </div>
          </fieldset>
          <label class="check"><input type="checkbox" name="agreeTerms" required /> 서비스 제공을 위한 개인정보 수집·이용에 동의합니다.</label>
          <button class="btn" type="submit">가입하고 시작하기</button>
        </form>
      </section>`;
    view.querySelector('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const body = {
        company: {
          name: f.companyName,
          businessNumber: f.businessNumber,
          size: f.size,
          industry: f.industry,
          annualRevenue: f.annualRevenue || undefined,
          employees: f.employees ? Number(f.employees) : undefined,
        },
        user: { name: f.name, phone: f.phone, email: f.email, password: f.password, agreeTerms: f.agreeTerms === 'on' },
      };
      try {
        await api('/api/auth/register', { method: 'POST', body });
        state.me = await api('/api/auth/me');
        toast('가입이 완료되었습니다. 무료 재무진단을 시작해 보세요.', 'success');
        go('#/dashboard');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---------- 기업 회원 화면 ----------

  async function dashboard() {
    const d = await api('/api/dashboard');
    const a = d.latestAssessment;
    const k = d.kpis;
    const next =
      d.phase === 'none'
        ? { href: '#/assessment', text: '무료 재무진단 시작하기', desc: '17개 문항으로 재무회계·경영관리·자금관리 수준을 진단합니다.' }
        : d.phase === 'assessment'
          ? { href: '#/services', text: '맞춤형 개선안(구축) 신청하기', desc: '진단 결과를 바탕으로 무료 개선과제 보고서를 받아보세요.' }
          : { href: '#/financials', text: '월별 재무현황 입력하기', desc: '월별 실적을 입력하면 수익성·Runway를 자동으로 분석합니다.' };

    view.innerHTML = `
      <header class="page-head">
        <div>
          <h1>${esc(d.company.name)}</h1>
          <p class="muted">${esc(d.company.sizeLabel)} · ${esc(d.company.industry)}${d.company.employees ? ` · 임직원 ${d.company.employees}명` : ''}</p>
        </div>
        <span class="tag big">현재 단계: ${PHASE_LABEL[d.phase]}</span>
      </header>
      ${phaseStepper(d.phase)}
      <section class="card highlight">
        <div><h3>다음 할 일</h3><p>${esc(next.desc)}</p></div>
        <a class="btn" href="${next.href}">${esc(next.text)}</a>
      </section>
      <div class="grid three">
        <article class="card">
          <h3>재무진단</h3>
          ${
            a
              ? `<p class="kpi">${a.total}<small>점</small></p><p>${esc(a.label)} · ${date(a.createdAt)}</p>
                 ${a.areas.map((x) => `<div class="metric"><span>${esc(x.name)}</span>${scoreBar(x.score)}<b>${x.score}</b></div>`).join('')}
                 <a href="#/assessment/${a.id}">결과 상세 보기 →</a>`
              : `<p class="muted">아직 진단 이력이 없습니다.</p><a href="#/assessment">진단 시작 →</a>`
          }
        </article>
        <article class="card">
          <h3>재무 핵심지표 ${k ? `<small>${esc(k.ym)}</small>` : ''}</h3>
          ${
            k
              ? `<dl class="kv">
                  <dt>매출액</dt><dd>${manwon(k.revenue)}</dd>
                  <dt>매출총이익률</dt><dd>${pct(k.grossMargin)}</dd>
                  <dt>영업이익률</dt><dd>${pct(k.operatingMargin)}</dd>
                  <dt>현금잔액</dt><dd>${manwon(k.cashBalance)}</dd>
                  <dt>Runway</dt><dd>${k.runwayMonths === null ? '현금 감소 없음' : `${k.runwayMonths}개월`}</dd>
                </dl><a href="#/financials">재무현황 보기 →</a>`
              : `<p class="muted">입력된 재무 데이터가 없습니다.</p><a href="#/financials">재무 데이터 입력 →</a>`
          }
        </article>
        <article class="card">
          <h3>서비스 신청 현황</h3>
          ${
            d.requests.length
              ? `<ul class="plain">${d.requests
                  .slice(0, 5)
                  .map(
                    (r) => `<li><span class="status ${r.status}">${STATUS_LABEL[r.status]}</span>
                      ${esc(PHASE_LABEL[r.phase])} · ${r.items.map(itemName).map(esc).join(', ')}</li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted">신청 내역이 없습니다.</p>'
          }
          <a href="#/services">서비스 신청 →</a>
          <p class="muted">받은 산출물 ${d.deliverableCount}건 · <a href="#/deliverables">산출물 보기</a></p>
        </article>
      </div>`;
  }

  function assessmentForm() {
    const { questions, areaNames } = state.catalog;
    const groups = Object.keys(areaNames).map((area) => ({ area, list: questions.filter((x) => x.area === area) }));
    const scale = ['전혀 아니다', '아니다', '보통', '그렇다', '매우 그렇다'];
    view.innerHTML = `
      <header class="page-head">
        <div>
          <h1>재무·경영·자금관리 진단</h1>
          <p class="muted">PwC Finance Readiness Assessment 기반 자가진단입니다. 각 문항에 현재 수준을 응답해 주세요. (무료)</p>
        </div>
        <a href="#/assessment/history">진단 이력</a>
      </header>
      <form id="assessment-form" class="form">
        ${groups
          .map(
            (g) => `<fieldset class="card">
              <legend>${esc(areaNames[g.area])}</legend>
              ${g.list
                .map(
                  (x) => `<div class="question">
                    <p>${esc(x.text)}</p>
                    <div class="scale">${scale
                      .map(
                        (label, i) => `<label><input type="radio" name="${x.id}" value="${i + 1}" required />
                          <span>${i + 1}</span><small>${label}</small></label>`,
                      )
                      .join('')}</div>
                  </div>`,
                )
                .join('')}
            </fieldset>`,
          )
          .join('')}
        <button class="btn" type="submit">진단 결과 확인</button>
      </form>`;
    view.querySelector('#assessment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const answers = Object.fromEntries(Object.entries(formData(e.target)).map(([k, v]) => [k, Number(v)]));
      try {
        const r = await api('/api/assessments', { method: 'POST', body: { answers } });
        toast('진단이 완료되었습니다. 진단 보고서가 산출물에 등록되었습니다.', 'success');
        go(`#/assessment/${r.id}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function assessmentHistory() {
    const { assessments } = await api('/api/assessments');
    view.innerHTML = `
      <header class="page-head"><h1>진단 이력</h1><a class="btn" href="#/assessment">새 진단</a></header>
      <div class="card">
        ${
          assessments.length
            ? `<table><thead><tr><th>진단일</th><th>종합점수</th><th>수준</th><th></th></tr></thead><tbody>
                ${assessments
                  .map(
                    (x) => `<tr><td>${date(x.createdAt)}</td><td>${x.total}점</td><td>${esc(x.label)}</td>
                    <td><a href="#/assessment/${x.id}">보기</a></td></tr>`,
                  )
                  .join('')}</tbody></table>`
            : '<p class="muted">진단 이력이 없습니다.</p>'
        }
      </div>`;
  }

  async function assessmentResult(id) {
    const r = await api(`/api/assessments/${encodeURIComponent(id)}`);
    view.innerHTML = `
      <header class="page-head">
        <div><h1>진단 결과</h1><p class="muted">${date(r.createdAt)} 진단</p></div>
        <button class="btn ghost" data-action="print">인쇄 / PDF 저장</button>
      </header>
      <section class="card score-summary">
        <div><p class="kpi">${r.total}<small>점</small></p><p class="strong">${esc(r.label)}</p></div>
        <div class="areas">
          ${r.areas
            .map((x) => `<div class="metric"><span>${esc(x.name)}</span>${scoreBar(x.score)}<b>${x.score}점 · ${esc(x.label)}</b></div>`)
            .join('')}
        </div>
      </section>
      <div class="grid two">
        <article class="card">
          <h3>주요 개선 필요 사항</h3>
          ${
            r.weaknesses.length
              ? `<ul>${r.weaknesses.map((w) => `<li><span class="tag">${esc(w.area)}</span> ${esc(w.text)}</li>`).join('')}</ul>`
              : '<p class="muted">2점 이하로 응답한 항목이 없습니다.</p>'
          }
        </article>
        <article class="card">
          <h3>추천 서비스</h3>
          ${
            r.recommendedItems.length
              ? `<ul>${r.recommendedItems.map((i) => `<li>${esc(itemName(i))}</li>`).join('')}</ul>
                 <a class="btn" href="#/services?items=${r.recommendedItems.join(',')}">추천 항목으로 서비스 신청</a>`
              : '<p>현재 재무관리 수준이 양호합니다. 정기 점검을 권장합니다.</p>'
          }
        </article>
      </div>`;
    view.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  }

  async function services(params) {
    const { areas, items, phases, fee } = state.catalog;
    const preselected = new Set((params.get('items') || '').split(',').filter(Boolean));
    const { requests } = await api('/api/requests');
    view.innerHTML = `
      <header class="page-head"><div><h1>서비스 신청</h1>
        <p class="muted">구축(개선안 제안)은 무료, 운영(대행)은 선택 항목에 따라 월 ${manwon(fee.min)}~${manwon(fee.max)}입니다.</p></div></header>
      <form id="request-form" class="form card">
        <fieldset>
          <legend>신청 단계</legend>
          <div class="phase-choice">
            ${phases
              .filter((p) => p.id !== 'assessment')
              .map(
                (p, i) => `<label class="choice"><input type="radio" name="phase" value="${p.id}" ${i === 0 ? 'checked' : ''} />
                  <span><strong>${esc(p.name)} · ${esc(p.title)}</strong><small>${esc(p.cost)} — ${p.outputs.map(esc).join(', ')}</small></span></label>`,
              )
              .join('')}
          </div>
        </fieldset>
        <fieldset>
          <legend>서비스 항목</legend>
          <div class="grid four">
            ${areas
              .map(
                (a) => `<div><h4>${esc(a.name)}</h4>${items
                  .filter((i) => i.area === a.id)
                  .map(
                    (i) => `<label class="check"><input type="checkbox" name="items" value="${i.id}" ${preselected.has(i.id) ? 'checked' : ''} />
                      <span>${esc(i.name)}<br /><small class="muted">${esc(i.detail)}</small></span></label>`,
                  )
                  .join('')}</div>`,
              )
              .join('')}
          </div>
        </fieldset>
        <label>요청사항<textarea name="message" rows="4" maxlength="2000" placeholder="현재 겪고 있는 재무 이슈, 희망 일정 등을 자유롭게 적어주세요."></textarea></label>
        <div class="estimate" id="estimate"></div>
        <button class="btn" type="submit">신청하기</button>
      </form>
      <section>
        <h2>신청 내역</h2>
        <div class="card">${requestTable(requests, false)}</div>
      </section>`;

    const form = view.querySelector('#request-form');
    const estimateEl = view.querySelector('#estimate');
    const selected = () => [...form.querySelectorAll('input[name="items"]:checked')].map((x) => x.value);

    async function updateEstimate() {
      const phase = form.querySelector('input[name="phase"]:checked').value;
      const chosen = selected();
      if (phase === 'implementation') {
        estimateEl.innerHTML = `<span>예상 비용</span><strong>무료</strong>`;
        return;
      }
      if (!chosen.length) {
        estimateEl.innerHTML = `<span>월 예상 비용</span><strong>항목을 선택하세요</strong>`;
        return;
      }
      try {
        const est = await api('/api/requests/estimate', { method: 'POST', body: { items: chosen } });
        const amount = est.amount ? `${manwon(est.amount)}/월` : '';
        estimateEl.innerHTML = `<span>월 예상 비용</span><strong>${amount}${est.negotiable ? `${amount ? ' + ' : ''}CFO 파견 별도 협의` : ''}</strong>`;
      } catch (err) {
        estimateEl.textContent = err.message;
      }
    }
    form.addEventListener('change', updateEstimate);
    updateEstimate();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        phase: form.querySelector('input[name="phase"]:checked').value,
        items: selected(),
        message: form.querySelector('textarea[name="message"]').value,
      };
      try {
        await api('/api/requests', { method: 'POST', body });
        toast('신청이 접수되었습니다. 담당 컨설턴트가 곧 연락드립니다.', 'success');
        go('#/services');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function requestTable(requests, withCompany) {
    if (!requests.length) return '<p class="muted">신청 내역이 없습니다.</p>';
    return `<table><thead><tr>${withCompany ? '<th>기업</th>' : ''}<th>신청일</th><th>단계</th><th>항목</th><th>월 비용</th><th>상태</th><th>담당자 메모</th>${
      withCompany ? '<th></th>' : ''
    }</tr></thead><tbody>
      ${requests
        .map(
          (r) => `<tr>
            ${withCompany ? `<td><a href="#/admin/company/${r.companyId}">${esc(r.companyName)}</a></td>` : ''}
            <td>${date(r.createdAt)}</td>
            <td>${esc(PHASE_LABEL[r.phase])}</td>
            <td>${r.items.map(itemName).map(esc).join(', ')}${r.message ? `<br /><small class="muted">${esc(r.message)}</small>` : ''}</td>
            <td>${r.phase === 'implementation' ? '무료' : `${r.monthlyFee ? manwon(r.monthlyFee) : ''}${r.negotiable ? ' (+협의)' : ''}`}</td>
            <td>${
              withCompany
                ? `<select data-request="${r.id}" data-field="status">${Object.entries(STATUS_LABEL)
                    .map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`)
                    .join('')}</select>`
                : `<span class="status ${r.status}">${STATUS_LABEL[r.status]}</span>`
            }</td>
            <td>${
              withCompany
                ? `<textarea data-request="${r.id}" data-field="adminNote" rows="2">${esc(r.adminNote)}</textarea>`
                : esc(r.adminNote || '')
            }</td>
            ${withCompany ? `<td><button class="btn small" data-save="${r.id}">저장</button></td>` : ''}
          </tr>`,
        )
        .join('')}
    </tbody></table>`;
  }

  function financialChart(months) {
    const recent = months.slice(-12);
    if (!recent.length) return '';
    const w = 640;
    const h = 220;
    const pad = 30;
    // 손익 막대와 현금잔액 선은 규모 차이가 커서 각자의 최대값으로 따로 스케일한다.
    const max = Math.max(1, ...recent.map((m) => Math.max(m.revenue, Math.abs(m.operatingIncome))));
    const cashMax = Math.max(1, ...recent.map((m) => Math.abs(m.cashBalance)));
    const slot = (w - pad * 2) / recent.length;
    const barW = Math.min(28, slot / 3);
    const zeroY = h / 2;
    const scale = (v) => (v / max) * (h / 2 - 20);
    const bars = recent
      .map((m, i) => {
        const x = pad + i * slot + slot / 2;
        const rev = scale(m.revenue);
        const op = scale(m.operatingIncome);
        return `<rect class="c-rev" x="${x - barW}" y="${zeroY - rev}" width="${barW}" height="${rev}"><title>${m.ym} 매출 ${won(m.revenue)}</title></rect>
          <rect class="${op >= 0 ? 'c-op' : 'c-loss'}" x="${x}" y="${op >= 0 ? zeroY - op : zeroY}" width="${barW}" height="${Math.abs(op)}"><title>${m.ym} 영업이익 ${won(m.operatingIncome)}</title></rect>
          <text x="${x}" y="${h - 4}" text-anchor="middle">${m.ym.slice(2)}</text>`;
      })
      .join('');
    const cashY = (v) => zeroY - (v / cashMax) * (h / 2 - 20);
    const cashPts = recent.map((m, i) => `${pad + i * slot + slot / 2},${cashY(m.cashBalance)}`).join(' ');
    const cashDots = recent
      .map((m, i) => `<circle class="c-cash-dot" cx="${pad + i * slot + slot / 2}" cy="${cashY(m.cashBalance)}" r="3"><title>${m.ym} 현금잔액 ${won(m.cashBalance)}</title></circle>`)
      .join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="월별 매출·영업이익·현금잔액 추이">
      <line class="axis" x1="${pad}" y1="${zeroY}" x2="${w - pad}" y2="${zeroY}"></line>
      ${bars}
      <polyline class="c-cash" points="${cashPts}"></polyline>${cashDots}
    </svg>
    <p class="legend"><span class="sw rev"></span>매출액 <span class="sw op"></span>영업이익 <span class="sw loss"></span>영업손실 <span class="sw cash"></span>현금잔액(별도 축)</p>`;
  }

  async function financials() {
    const data = await api('/api/financials');
    const k = data.latest;
    const today = new Date();
    const defaultYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    view.innerHTML = `
      <header class="page-head"><div><h1>재무현황</h1>
        <p class="muted">월별 실적을 입력하면 수익성, Burn rate, Runway를 자동으로 계산합니다.</p></div></header>
      ${
        k
          ? `<div class="grid four kpis">
              <article class="card"><h4>매출액 (${esc(k.ym)})</h4><p class="kpi">${manwon(k.revenue)}</p>
                <p class="muted">전월 대비 ${pct(k.revenueGrowth)}</p></article>
              <article class="card"><h4>매출총이익률 / 영업이익률</h4><p class="kpi">${pct(k.grossMargin)}</p>
                <p class="muted">영업이익률 ${pct(k.operatingMargin)}</p></article>
              <article class="card"><h4>월평균 Net Burn</h4><p class="kpi">${manwon(k.netBurn)}</p>
                <p class="muted">최근 3개월 현금 감소 기준</p></article>
              <article class="card ${k.runwayMonths !== null && k.runwayMonths < 6 ? 'alert' : ''}"><h4>Runway</h4>
                <p class="kpi">${k.runwayMonths === null ? '∞' : `${k.runwayMonths}<small>개월</small>`}</p>
                <p class="muted">${k.runwayMonths !== null && k.runwayMonths < 6 ? '자금수지 관리가 시급합니다' : `현금잔액 ${manwon(k.cashBalance)}`}</p></article>
            </div>
            <section class="card">${financialChart(data.months)}</section>`
          : ''
      }
      <section class="card">
        <h3>월별 실적 입력</h3>
        <form id="fin-form" class="form inline">
          <label>기준월<input name="ym" type="month" value="${defaultYm}" required /></label>
          <label>매출액(원)<input name="revenue" inputmode="numeric" required /></label>
          <label>매출원가(원)<input name="cogs" inputmode="numeric" required /></label>
          <label>판매비와관리비(원)<input name="opex" inputmode="numeric" required /></label>
          <label>기말 현금잔액(원)<input name="cashBalance" inputmode="numeric" required /></label>
          <button class="btn" type="submit">저장</button>
        </form>
      </section>
      <section class="card" id="fin-table">
        ${
          data.months.length
            ? `<table><thead><tr><th>기준월</th><th>매출액</th><th>매출총이익</th><th>영업이익</th><th>영업이익률</th><th>현금잔액</th><th></th></tr></thead><tbody>
              ${[...data.months]
                .reverse()
                .map(
                  (m) => `<tr><td>${esc(m.ym)}</td><td>${won(m.revenue)}</td><td>${won(m.grossProfit)}</td>
                    <td class="${m.operatingIncome < 0 ? 'neg' : ''}">${won(m.operatingIncome)}</td><td>${pct(m.operatingMargin)}</td>
                    <td>${won(m.cashBalance)}</td>
                    <td><button class="link" data-edit="${esc(m.ym)}">수정</button> <button class="link danger" data-delete="${esc(m.ym)}">삭제</button></td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="muted">입력된 데이터가 없습니다.</p>'
        }
      </section>`;

    const form = view.querySelector('#fin-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { ym, ...rest } = formData(form);
      try {
        await api(`/api/financials/${ym}`, { method: 'PUT', body: rest });
        toast(`${ym} 실적이 저장되었습니다.`, 'success');
        financials();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    view.querySelector('#fin-table').addEventListener('click', async (e) => {
      const editYm = e.target.dataset.edit;
      const delYm = e.target.dataset.delete;
      if (editYm) {
        const m = data.months.find((x) => x.ym === editYm);
        for (const key of ['ym', 'revenue', 'cogs', 'opex', 'cashBalance']) form.elements[key].value = m[key];
        form.scrollIntoView({ behavior: 'smooth' });
      } else if (delYm && confirm(`${delYm} 실적을 삭제할까요?`)) {
        await api(`/api/financials/${delYm}`, { method: 'DELETE' });
        financials();
      }
    });
  }

  function deliverableList(list) {
    if (!list.length) return '<p class="muted">등록된 산출물이 없습니다.</p>';
    return list
      .map(
        (d) => `<details class="card deliverable">
          <summary><span class="tag">${esc(PHASE_LABEL[d.phase])}</span> <strong>${esc(d.title)}</strong> <small class="muted">${date(d.createdAt)}</small></summary>
          <pre>${esc(d.content)}</pre>
        </details>`,
      )
      .join('');
  }

  async function deliverables() {
    const { deliverables: list } = await api('/api/deliverables');
    view.innerHTML = `
      <header class="page-head"><div><h1>산출물</h1>
        <p class="muted">진단 보고서, 개선과제 보고서, 결산·예산·자금수지 보고서 등 단계별 산출물을 확인하세요.</p></div></header>
      ${deliverableList(list)}`;
  }

  // ---------- 관리자 화면 ----------

  async function adminCompanies() {
    const { companies } = await api('/api/admin/companies');
    view.innerHTML = `
      <header class="page-head"><h1>고객 기업 관리</h1><span class="tag big">총 ${companies.length}개사</span></header>
      <div class="card">
        ${
          companies.length
            ? `<table><thead><tr><th>기업명</th><th>규모</th><th>업종</th><th>단계</th><th>최근 진단</th><th>신청(미처리)</th><th>가입일</th></tr></thead><tbody>
              ${companies
                .map(
                  (c) => `<tr><td><a href="#/admin/company/${c.id}">${esc(c.name)}</a></td><td>${esc(c.sizeLabel)}</td>
                    <td>${esc(c.industry)}</td><td>${PHASE_LABEL[c.phase]}</td>
                    <td>${c.latestScore === null ? '-' : `${c.latestScore}점`}</td>
                    <td>${c.requestCount} (${c.openRequests})</td><td>${date(c.createdAt)}</td></tr>`,
                )
                .join('')}</tbody></table>`
            : '<p class="muted">가입한 기업이 없습니다.</p>'
        }
      </div>`;
  }

  function bindRequestEditors(root, onSaved) {
    root.addEventListener('click', async (e) => {
      const id = e.target.dataset.save;
      if (!id) return;
      const status = root.querySelector(`[data-request="${id}"][data-field="status"]`).value;
      const adminNote = root.querySelector(`[data-request="${id}"][data-field="adminNote"]`).value;
      try {
        await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: { status, adminNote } });
        toast('저장되었습니다.', 'success');
        onSaved();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function adminRequests() {
    const { requests } = await api('/api/admin/requests');
    view.innerHTML = `<header class="page-head"><h1>서비스 신청 관리</h1></header><div class="card" id="req">${requestTable(requests, true)}</div>`;
    bindRequestEditors(view.querySelector('#req'), adminRequests);
  }

  async function adminCompany(id) {
    const d = await api(`/api/admin/companies/${encodeURIComponent(id)}`);
    const c = d.company;
    const a = d.latestAssessment;
    const k = d.financials.latest;
    view.innerHTML = `
      <header class="page-head">
        <div><h1>${esc(c.name)}</h1>
          <p class="muted">${esc(c.sizeLabel)} · ${esc(c.industry)} · 사업자번호 ${esc(c.businessNumber)} · 연매출 ${manwon(c.annualRevenue)} · 임직원 ${c.employees ?? '-'}명</p>
          <p class="muted">담당자: ${d.users.map((u) => `${esc(u.name)} (${esc(u.email)}${u.phone ? `, ${esc(u.phone)}` : ''})`).join(', ')}</p>
        </div>
        <span class="tag big">${PHASE_LABEL[d.phase]}</span>
      </header>
      <div class="grid two">
        <article class="card"><h3>최근 진단</h3>
          ${
            a
              ? `<p class="kpi">${a.total}<small>점</small></p>${a.areas
                  .map((x) => `<div class="metric"><span>${esc(x.name)}</span>${scoreBar(x.score)}<b>${x.score}</b></div>`)
                  .join('')}
                 <p class="muted">추천: ${a.recommendedItems.map(itemName).map(esc).join(', ') || '없음'}</p>`
              : '<p class="muted">진단 이력 없음</p>'
          }
        </article>
        <article class="card"><h3>재무 핵심지표</h3>
          ${
            k
              ? `<dl class="kv"><dt>기준월</dt><dd>${esc(k.ym)}</dd><dt>매출액</dt><dd>${manwon(k.revenue)}</dd>
                  <dt>영업이익률</dt><dd>${pct(k.operatingMargin)}</dd><dt>현금잔액</dt><dd>${manwon(k.cashBalance)}</dd>
                  <dt>Runway</dt><dd>${k.runwayMonths === null ? '-' : `${k.runwayMonths}개월`}</dd></dl>`
              : '<p class="muted">재무 데이터 없음</p>'
          }
        </article>
      </div>
      <section><h2>서비스 신청</h2><div class="card" id="req">${requestTable(
        d.requests.map((r) => ({ ...r, companyName: c.name })),
        true,
      )}</div></section>
      <section>
        <h2>산출물 등록</h2>
        <form id="deliv-form" class="form card">
          <div class="row">
            <label>단계<select name="phase">
              <option value="assessment">진단</option><option value="implementation">구축</option><option value="operation">운영</option>
            </select></label>
            <label>제목<input name="title" required maxlength="200" placeholder="예: 2026년 10월 결산 보고서" /></label>
          </div>
          <label>내용<textarea name="content" rows="6" required></textarea></label>
          <button class="btn" type="submit">등록</button>
        </form>
        ${deliverableList(d.deliverables)}
      </section>`;
    bindRequestEditors(view.querySelector('#req'), () => adminCompany(id));
    view.querySelector('#deliv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/admin/companies/${c.id}/deliverables`, { method: 'POST', body: formData(e.target) });
        toast('산출물이 등록되었습니다.', 'success');
        adminCompany(id);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---------- 라우터 ----------

  const routes = [
    { re: /^#?\/?$/, fn: landing },
    { re: /^#\/login$/, fn: login, guest: true },
    { re: /^#\/register$/, fn: register, guest: true },
    { re: /^#\/dashboard$/, fn: dashboard, role: 'client' },
    { re: /^#\/assessment$/, fn: assessmentForm, role: 'client' },
    { re: /^#\/assessment\/history$/, fn: assessmentHistory, role: 'client' },
    { re: /^#\/assessment\/(\d+)$/, fn: assessmentResult, role: 'client' },
    { re: /^#\/services$/, fn: services, role: 'client', params: true },
    { re: /^#\/financials$/, fn: financials, role: 'client' },
    { re: /^#\/deliverables$/, fn: deliverables, role: 'client' },
    { re: /^#\/admin$/, fn: adminCompanies, role: 'admin' },
    { re: /^#\/admin\/requests$/, fn: adminRequests, role: 'admin' },
    { re: /^#\/admin\/company\/(\d+)$/, fn: adminCompany, role: 'admin' },
  ];

  async function render() {
    const [path, query] = (location.hash || '#/').split('?');
    const route = routes.find((r) => r.re.test(path));
    renderNav();
    if (!route) {
      view.innerHTML = '<section class="card"><h1>페이지를 찾을 수 없습니다.</h1><a href="#/">홈으로</a></section>';
      return;
    }
    const role = state.me?.user.role;
    if (route.role && !role) return go('#/login');
    if (route.role && route.role !== role) return go(role === 'admin' ? '#/admin' : '#/dashboard');
    if (route.guest && role) return go(role === 'admin' ? '#/admin' : '#/dashboard');

    const args = path.match(route.re).slice(1);
    if (route.params) args.push(new URLSearchParams(query || ''));
    view.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      await route.fn(...args);
    } catch (err) {
      if (err.status === 401) {
        state.me = null;
        return go('#/login');
      }
      view.innerHTML = `<section class="card"><h1>오류</h1><p>${esc(err.message)}</p></section>`;
    }
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  async function init() {
    state.catalog = await api('/api/catalog');
    const me = await api('/api/auth/me').catch(() => null);
    state.me = me?.user ? me : null;
    window.addEventListener('hashchange', render);
    render();
  }

  init();
})();
