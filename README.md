# 재무성장지원서비스 (Finance Team-as-a-Service) 포털

중소·중견기업이 로그인해서 PwC 재무성장지원서비스를 **진단 → 구축 → 운영** 단계로 받을 수 있는 웹 서비스입니다.
서비스 정의는 `docs/` 의 이미지(서비스 프로세스, 서비스 커버리지, 도입 사례)를 기반으로 합니다.

## 주요 기능

**기업 회원**
- 회원가입/로그인: 회사 정보(사업자등록번호 검증, 중소/중견 구분, 업종, 매출, 임직원 수)와 담당자 계정
- 대시보드: 현재 단계(진단·구축·운영), 다음 할 일, 진단 점수, 재무 핵심지표, 신청 현황
- 재무진단(무료): 재무회계·경영관리·자금관리·재무조직 17개 문항 자가진단 → 영역별 점수·수준, 개선 필요 사항, 추천 서비스. 진단 보고서가 산출물로 자동 등록
- 서비스 신청: 구축(개선안 제안, 무료) / 운영(대행, 월 1~5백만원) — 13개 서비스 항목 선택, 월 예상 비용 자동 산정(CFO 파견은 별도 협의)
- 재무현황: 월별 매출·원가·판관비·현금잔액 입력 → 매출총이익률, 영업이익률, 월평균 Net Burn, Runway, 추이 차트
- 산출물: 진단 보고서, 개선과제 보고서, 결산·예산·자금수지 보고서 열람

**관리자(PwC 담당자)**
- 고객 기업 목록(단계, 최근 진단 점수, 미처리 신청 수)과 기업 상세(진단, 재무지표, 담당자)
- 서비스 신청 상태 변경(접수/검토중/진행중/완료/반려) 및 담당자 메모
- 기업별 산출물 등록

## 실행

Node.js 22.13 이상이 필요합니다(내장 `node:sqlite` 사용).

```bash
npm install
npm run seed      # 데모 데이터 (비밀번호 Demo1234!)
npm start         # http://localhost:3000
npm test
```

데모 계정: 관리자 `admin@demo.local`, 고객 `h-pharma@demo.local`, `g-ai@demo.local`

### 환경 변수

| 변수 | 설명 |
| --- | --- |
| `PORT` | 포트 (기본 3000) |
| `DB_FILE` | SQLite 파일 경로 (기본 `data/app.db`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | 설정 시 시작할 때 관리자 계정을 생성/갱신 |
| `SECURE_COOKIES=true` | HTTPS 운영 시 세션 쿠키에 Secure 속성 부여 |
| `TRUST_PROXY` | 리버스 프록시 뒤에서 실행 시 Express `trust proxy` 값 |

## 구조

```
src/
  server.js      진입점, 관리자 계정 보장
  app.js         Express 앱과 REST API (/api/*)
  db.js          SQLite 스키마
  auth.js        scrypt 비밀번호 해시, DB 세션, 사업자등록번호 검증
  catalog.js     서비스 단계·커버리지·운영 비용 산정
  assessment.js  진단 문항과 점수 산정
  finance.js     재무 KPI 계산
public/          SPA (바닐라 JS, 해시 라우팅)
scripts/seed.js  데모 데이터
test/            node:test 단위·API 테스트
```

## 보안

- 비밀번호 scrypt 해시, 세션 토큰은 SHA-256 해시로만 저장, HttpOnly + SameSite=Strict 쿠키(12시간)
- 상태 변경 API는 `application/json`만 허용(CSRF 완화), 로그인 실패 15분 10회 제한
- CSP 등 보안 헤더, 기업 간 데이터 격리(모든 조회를 로그인 기업 ID로 제한), 관리자 API 역할 검사
