# voc-dashboard webapp

Next.js 14 App Router + BigQuery(@google-cloud/bigquery) 대시보드.
Backyard `proj-a2qqw2` 백엔드에 배포됨.

## 페이지

- `/product` — **Product Insights** (구현됨)
  - 주간 시그널 KPI · 카테고리 목록(드릴다운) · 부정 감정 변화 · 신규 등장 키워드
  - 필터 sticky bar: 유저/기업 · 상태(다중) · 중분류·소분류(카드 클릭) · 기준일
  - 우측 채팅 에이전트 사이드바 (GPT-5-mini, SSE)

CS Live / Executive 페이지는 `dashboards/` 폴더에 PRD로 존재, 아직 미구현.

## 로컬 개발

```bash
cd webapp
npm install
export GCP_SA_KEY="$(cat ~/voc-bq-sa.json)"
export BQ_PROJECT=wanted-data
export OPENAI_API_KEY=sk-...
npm run dev
# → http://localhost:3000/product
```

## 배포 (Backyard)

```bash
docker buildx build --platform=linux/arm64 --no-cache \
  -t lab.wntd.co/proj-a2qqw2/backend:latest --push .
```

Backyard MCP `restart_component`으로 롤아웃 트리거. 이미지 sha 확인은 `list_images`.

## 데이터 소스

- `wanted-data.wanted_ml_voc.voc_surge_score` — 오늘 기준 view (default)
- `wanted-data.wanted_ml_voc.voc_surge_score_at(DATE)` — 임의 시점 TVF (default asOf = 어제)
- `wanted-data.wanted_ml_voc.voc_daily` — MTD·부정 감정 변화 소스
- `wanted-data.wanted_ml_voc.voc_keyword_trend` — 신규 키워드
- `wanted-data.wanted_ml.zendesk_voc_classified` — 드릴다운 원문 티켓

## 인증

`GCP_SA_KEY` 시크릿(Backyard) → `src/lib/bq.ts`에서 인라인 파싱 후 `BigQuery` 클라이언트 생성.

## 성능·안정성 노트

- 페이지 `revalidate = 60` — 필터 조합별 응답 60초 캐시 (BQ quota 관리)
- `fetchAllSurges` 단일 스냅샷 → `deriveStatusSummary` + `deriveGridSurges` in-memory 파생 → StatusOverview와 WatchGrid 카운트 항상 일관
- `app/product/error.tsx` — BQ quota / 인증 만료 시 우아한 에러 UI
- 채팅 SSE 스트리밍 (`app/api/chat/route.ts`) · 도구 호출 rows 최대 100행 cap · CSV 다운로드 지원

## 주요 라이브러리

- `next` 14 · `react` 18 · `typescript`
- `@google-cloud/bigquery` — SDK
- `openai` — GPT-5-mini
- `react-markdown` + `remark-gfm` — 채팅 응답 렌더링
