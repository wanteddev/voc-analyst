# Product Insights 단일 페이지 개편 — 구현 계획

> 2026-07-06 작성. CS Live / Executive 탭을 제거하고 Product Insights(`/product`) 하나로 통합,
> ① 카테고리 드릴다운(유저/기업 필터) → ② 부정 매트릭스 → ③ 서지 임계값 보정 순으로 진행.
> 각 Step은 독립적으로 커밋·배포 가능하도록 구성.

## 기본 결정사항 (변경 가능)

| 항목 | 결정 | 근거 |
|---|---|---|
| 드릴다운 UI | 카드 클릭 시 **인라인 확장** (그리드 아래 패널) | 맥락 유지, 모달 대비 구현 단순 |
| 부정 매트릭스 단위 | **category2** (점 ~30개), 클릭 시 드릴다운은 category2 단위 | category3은 점이 너무 많음 |
| 유저/기업 필터 | `?seg=all\|user\|company` searchParams | 서버 컴포넌트 유지, URL 공유 가능 |

---

## Step 0 — CS Live / Executive 제거

### 삭제

- `webapp/src/app/cs/` 전체
- `webapp/src/app/executive/` 전체
- `webapp/src/components/SurgePill.tsx` (cs 전용)
- `webapp/src/components/StackedBar.tsx` (executive 전용)
- `webapp/src/lib/queries.ts` 에서: `fetchEmotionTrend`, `fetchMonthlyVolume`, `fetchParetoTop`, `fetchActionsSummary`, `fetchTodayNegativeTickets` 및 관련 타입
  - 주의: `fetchTodayNegativeTickets` 의 원문 조회 패턴(zendesk_voc_classified 직접 조회)은 Step 1 드릴다운 쿼리의 베이스로 재사용 — 삭제 전 참고

### 수정

- `webapp/src/app/layout.tsx`: nav의 CS Live / Executive `<Link>` 제거 (Product Insights만 남김)
- `webapp/src/app/page.tsx`: `redirect('/cs')` → `redirect('/product')`

### 검증

```bash
cd webapp && npm run build   # cs/executive import 잔재 없으면 통과
grep -rn "SurgePill\|StackedBar\|fetchMonthly\|fetchPareto\|fetchActions\|fetchEmotionTrend\|/cs\b\|/executive" src/
```

`ChatSidebar`(`/api/chat`, `agent-tools.ts`)와 `JiraCTA`(`/api/jira/create`)는 유지.

---

## Step 1 — 카테고리 드릴다운 + 유저/기업 필터

### 1-1. 세그먼트 필터 (`?seg=`)

`page.tsx` 시그니처:

```tsx
export default async function ProductInsightsPage(
  { searchParams }: { searchParams: Promise<{ seg?: string }> }
) {
  const { seg = 'all' } = await searchParams;
  const category1 = seg === 'user' ? '유저' : seg === 'company' ? '기업' : null;
  ...
}
```

- 필터 UI: `전체 / 유저 / 기업` 3개 `<Link href="/product?seg=...">` 탭 (신규 `SegFilter.tsx`, 서버 컴포넌트로 충분). eyebrow 옆 배치.
- `fetchSurges(category1?: string | null)`: `category1` 인자 추가 → `AND category1 = @category1` 조건.
- featured 카드·급증 그리드·신규 키워드 모두 필터 적용. 신규 키워드는 `voc_keyword_trend.top_category1` 로 필터 (`WHERE r.top_category1 = @category1`) — `fetchNewKeywords` 에서 `top_category1` SELECT 추가 필요.

### 1-2. 쿼리 파라미터화 (보안 겸 선행 작업)

현재 `fetchWeeklyTrend` 가 문자열 인터폴레이션으로 SQL 조립 중. 드릴다운은 클라이언트 입력을 받으므로 **BQ named parameters 로 전환**:

```ts
// lib/bq.ts — query()에 params 지원 추가
export async function query<T>(sql: string, params?: Record<string, unknown>, maxGB = 5): Promise<T[]> {
  const [rows] = await bq().query({
    query: sql, params,
    location: 'asia-northeast3',
    maximumBytesBilled: String(maxGB * 1024 ** 3),
    useLegacySql: false,
  });
  return rows as T[];
}
```

기존 호출부는 params 없이 동작하므로 하위호환.

### 1-3. 드릴다운 쿼리 3종 (`lib/queries.ts`)

```ts
// (a) 12주 주간 추이 — 기존 fetchWeeklyTrend 확장 (category1/2/3 + named params)
export async function fetchCategoryTrend(f: { category1?: string | null; category2: string; category3?: string | null }) {
  return query(`
    SELECT DATE_TRUNC(date, WEEK(MONDAY)) AS week,
           SUM(tickets) AS tickets, SUM(negative_tickets) AS negative_tickets
    FROM \`wanted-data.wanted_ml_voc.voc_daily\`
    WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 12 WEEK)
      AND category2 = @category2
      AND (@category3 IS NULL OR category3 = @category3)
      AND (@category1 IS NULL OR category1 = @category1)
    GROUP BY week ORDER BY week
  `, { category1: f.category1 ?? null, category2: f.category2, category3: f.category3 ?? null });
}

// (b) 상위 키워드 — voc_keyword_trend, 최근 4주
//     top_category3 기준 매칭 (키워드는 티켓 단위가 아니라 주간 집계라 근사치임을 UI에 명시)
export async function fetchCategoryKeywords(f: { category3: string }) {
  return query(`
    SELECT keyword, SUM(mentions) AS mentions, SUM(negative_mentions) AS negative_mentions
    FROM \`wanted-data.wanted_ml_voc.voc_keyword_trend\`
    WHERE week_start >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 4 WEEK)
      AND top_category3 = @category3
    GROUP BY keyword ORDER BY mentions DESC LIMIT 15
  `, { category3: f.category3 });
}

// (c) 원문 티켓 — 부정 우선, 최근 28일 (fetchTodayNegativeTickets 패턴 재사용)
export async function fetchCategoryTickets(f: { category1?: string | null; category2: string; category3?: string | null }) {
  return query(`
    SELECT id, event_create_time, category3, main_topic, title, overall_emotion,
           SUBSTR(detail, 1, 300) AS detail_preview
    FROM \`wanted-data.wanted_ml.zendesk_voc_classified\`
    WHERE DATE(event_create_time, 'Asia/Seoul') >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 28 DAY)
      AND category2 = @category2
      AND (@category3 IS NULL OR category3 = @category3)
      AND (@category1 IS NULL OR category1 = @category1)
    ORDER BY (overall_emotion = '부정') DESC, event_create_time DESC
    LIMIT 30
  `, { category1: f.category1 ?? null, category2: f.category2, category3: f.category3 ?? null });
}
```

### 1-4. API route — `webapp/src/app/api/drilldown/route.ts`

- `GET /api/drilldown?category1=&category2=&category3=`
- 화이트리스트 검증: `category1 ∈ {유저, 기업}` 또는 없음; category2/3 는 길이 제한(≤50자)만 — 값 자체는 named param으로 안전
- 3쿼리 `Promise.all` → `{ trend, keywords, tickets }` JSON
- `export const revalidate = 0;` + 라우트 내 캐시 헤더 `s-maxage=300`

### 1-5. UI 컴포넌트

- **`WatchGrid.tsx`** (client): 기존 급증 카드 그리드를 이관. 카드 클릭 → 선택 상태 → 그리드 바로 아래 `DrilldownPanel` 렌더. `JiraCTA` 는 카드 내 유지 (클릭 버블링 `stopPropagation`).
- **`DrilldownPanel.tsx`** (client): 선택 시 `/api/drilldown` fetch. 레이아웃 3단:
  1. 좌: 12주 추이 미니차트 (기존 `TrendChart` 재사용 — client에서 쓸 수 있는지 확인, 서버 전용이면 경량 SVG 복제)
  2. 우: 키워드 칩 리스트 (부정 mentions 강조)
  3. 하: 원문 티켓 테이블 — 날짜·감정·제목·main_topic, 행 클릭 시 detail_preview 펼침
- featured 12주 트렌드 카드는 유지하되, 드릴다운과 중복이므로 "featured 카드 클릭 = 드릴다운 열기"로 연결.

### 검증

```bash
cd webapp && npm run lint && npm run build
npm run dev  # GCP_SA_KEY 필요
# /product?seg=user 필터 동작, 카드 클릭 → 패널 로드, Jira 버튼 간섭 없음 확인
curl 'localhost:3000/api/drilldown?category2=계정&category1=유저' | head -c 500
```

---

## Step 2 — 부정 매트릭스

### 쿼리 (`lib/queries.ts`)

```ts
export async function fetchNegMatrix(category1?: string | null) {
  return query(`
    SELECT category1, category2,
           SUM(tickets) AS tickets,
           ROUND(SAFE_DIVIDE(SUM(negative_tickets), SUM(tickets)), 3) AS negative_ratio
    FROM \`wanted-data.wanted_ml_voc.voc_daily\`
    WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 30 DAY)
      AND category2 != '(미분류)'
      AND (@category1 IS NULL OR category1 = @category1)
    GROUP BY category1, category2
    HAVING SUM(tickets) >= 10   -- 소볼륨 노이즈 제거
  `, { category1: category1 ?? null });
}
```

### UI — `NegMatrix.tsx` (client, SVG 산점도)

- x = tickets(log scale 권장), y = negative_ratio, 점 색 = category1(유저/기업), 점 크기 = 부정 건수
- 사분면 가이드라인: x 중앙값·y 중앙값 점선, **우상단 라벨 "high volume × high negative"**
- 점 hover → 툴팁(카테고리·건수·부정률), 클릭 → Step 1 `DrilldownPanel` 열기 (category2 단위)
- 배치: featured 섹션 아래, 급증 그리드 위
- `seg` 필터 연동 (서버에서 fetchNegMatrix(category1) 결과를 props로)

### 검증

빌드 + 점 개수/값을 BQ 직접 쿼리와 대조:

```sql
SELECT category2, SUM(tickets), SAFE_DIVIDE(SUM(negative_tickets), SUM(tickets))
FROM `wanted-data.wanted_ml_voc.voc_daily`
WHERE date >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 30 DAY)
GROUP BY 1 ORDER BY 2 DESC;
```

---

## Step 3 — 서지 임계값·MoM 보정

### 3-1. `bq_views/02_voc_surge_score.sql` 임계값 보정

현재 문제: `GREATEST(baseline_daily_avg, 0.1)` 바닥 때문에 baseline 0.1건/day 카테고리가 3건만 와도 4.0× WATCH → 노이즈 다수, `(미분류)` 서지 노출.

변경안 (surge_level CASE 교체):

```sql
CASE
  WHEN category3 = '(미분류)' OR category2 = '(미분류)' THEN 'STABLE'   -- 분류실패는 서지 제외
  WHEN recent_7d >= 10
   AND SAFE_DIVIDE(recent_7d / 7.0, GREATEST(baseline_daily_avg, 0.25)) >= 2.0
    THEN 'SURGE'
  WHEN recent_7d >= 5
   AND SAFE_DIVIDE(recent_7d / 7.0, GREATEST(baseline_daily_avg, 0.25)) >= 1.5
    THEN 'WATCH'
  WHEN baseline_28d >= 20
   AND recent_7d < baseline_daily_avg * 7 * 0.5
    THEN 'IMPROVED'
  ELSE 'STABLE'
END AS surge_level
```

- 바닥값 0.1 → 0.25 (=주 1.75건): 초저볼륨 ratio 폭발 완화
- SURGE 최소 볼륨 5→10, WATCH 3→5
- ratio 컬럼 자체의 바닥값도 0.25로 통일 (SELECT의 `ratio` 계산부)
- ⚠️ **이 view는 Slack 일간 알람도 소비** (`src/voc_analyst/` Lambda). 임계값 변경이 알람 빈도에 그대로 반영됨 — 의도된 효과지만 배포 공지 필요.

적용:

```bash
cd bq_views && ./apply.sh   # 또는 bq query < 02_voc_surge_score.sql
# 적용 전 dry-run: 현재 SURGE/WATCH 목록과 변경 후 목록 비교 쿼리로 영향 확인
```

적용 전 영향 비교 (새 기준을 인라인으로 계산해서 before/after diff):

```sql
SELECT surge_level AS before_level, category2, category3, recent_7d, baseline_daily_avg, ratio
FROM `wanted-data.wanted_ml_voc.voc_surge_score`
WHERE surge_level IN ('SURGE','WATCH')
ORDER BY ratio DESC;
```

### 3-2. MTD 요약 헤더 (Executive 대체, 선택)

Executive 삭제로 "이번 달 VOC / MoM" 카드 소멸. 왜곡됐던 MoM(-87.7%: 월 진행일수 미보정)을 고쳐 Product 헤더 한 줄로 이관:

```ts
export async function fetchMtdSummary() {
  return query(`
    WITH cur AS (
      SELECT SUM(tickets) t, SUM(negative_tickets) n FROM \`wanted-data.wanted_ml_voc.voc_daily\`
      WHERE date >= DATE_TRUNC(CURRENT_DATE('Asia/Seoul'), MONTH)
    ),
    prev AS (  -- 전월 '같은 일수' 만큼만 비교 (동기간 보정)
      SELECT SUM(tickets) t FROM \`wanted-data.wanted_ml_voc.voc_daily\`
      WHERE date >= DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 1 MONTH), MONTH)
        AND date <= DATE_ADD(DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 1 MONTH), MONTH),
                             INTERVAL DATE_DIFF(CURRENT_DATE('Asia/Seoul'), DATE_TRUNC(CURRENT_DATE('Asia/Seoul'), MONTH), DAY) DAY)
    )
    SELECT cur.t AS mtd, cur.n AS mtd_negative, prev.t AS prev_same_period,
           ROUND(SAFE_DIVIDE(cur.t - prev.t, prev.t) * 100, 1) AS mom_pct
    FROM cur, prev
  `);
}
```

UI: eyebrow 라인에 `이번 달 145건 · 전월 동기간 대비 +N% · 부정 15%` 텍스트 한 줄.

---

## 공통 참고

- **환경**: `webapp/` 은 Next.js(App Router, 서버 컴포넌트 + `revalidate=600`). BQ 접근은 `GCP_SA_KEY` env(JSON) → `lib/bq.ts`. `maximumBytesBilled 5GB` 가드 유지.
- **스타일**: 기존 `globals.css` 클래스(`card`, `watch-grid`, `kw-grid`, `section-hdr`, `pill` 등) 재사용. 신규 클래스는 같은 네이밍 컨벤션.
- **타임존**: 모든 날짜 집계 `Asia/Seoul` 기준 (기존 view와 일치).
- **커밋 단위**: Step 0 / 1 / 2 / 3 각각 별도 커밋. Step 3의 view 변경은 웹앱 배포와 독립적으로 적용 가능하나 Slack 알람 영향 공지 후 적용 권장.
- **배포**: 기존 파이프라인(webapp/Dockerfile) 그대로. lab 환경 URL: https://prj-backend-a2qqw2.lab.wntd.co
