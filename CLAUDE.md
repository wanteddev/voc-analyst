# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

VOC(Voice of Customer) 모니터링 대시보드. Zendesk 문의를 카테고리·감정별로 분석해 급증 카테고리·부정 감정 변화·신규 키워드를 보여주는 Next.js 웹앱.

- 운영 URL: https://prj-frontend-a2qqw2.lab.wntd.co/product (사내망)
- 배포: Backyard `proj-a2qqw2` frontend 컴포넌트 (arm64 필수 — amd64는 exec format error)
- Slack 주간 봇은 별도 리포로 분리됨 (이 리포의 git history에 과거 코드 있음)

## Architecture

```
wanted-data.wanted_ml.zendesk_voc_classified  (ML팀 분류·감정 라벨링, 전일자까지 적재)
  → BigQuery views (bq_views/*.sql)
  → webapp/ (Next.js 14 App Router)
       └─ Redis 캐시 (25h TTL) — 같은 SQL+params는 하루 1회만 BQ 실행
```

## Key Paths

- `webapp/src/app/product/page.tsx` — 메인 대시보드 (서버 컴포넌트)
- `webapp/src/app/product/error.tsx` — BQ quota/인증 에러 바운더리
- `webapp/src/lib/queries.ts` — 모든 BQ 쿼리. `fetchAllSurges` 단일 스냅샷 → in-memory 파생으로 카운트 일관성 보장
- `webapp/src/lib/bq.ts` — BQ 클라이언트 + Redis cache-aside 래퍼
- `webapp/src/lib/cache.ts` — ioredis. `REDIS_URL` 없으면 no-op
- `webapp/src/lib/level.ts` — 클라이언트 안전 상수 (queries.ts는 BQ SDK를 import하므로 클라이언트 컴포넌트에서 직접 import 금지)
- `webapp/src/lib/product-url.ts` — 필터 URL 파라미터 통합 관리 (`buildProductHref`)
- `webapp/src/app/api/chat/route.ts` — GPT-5-mini SSE 채팅 (BQ+티켓 도구)
- `bq_views/*.sql` — view/TVF 정의. 02(오늘 기준 view)와 05(TVF)는 정의를 항상 동기화할 것

## Commands

```bash
just dev      # 로컬 개발 서버
just check    # typecheck + build (배포 전 필수)
just deploy   # arm64 빌드 + Backyard push
```

push 후 Backyard MCP `restart_component(name="proj-a2qqw2", component="frontend")` 필수 (`:latest` webhook은 비-idempotent).

## 도메인 규칙

- **as-of INCLUSIVE (Option Y)**: 모든 창은 `date <= asOf`. default asOf = **어제** (데이터가 전일자까지만 적재)
- **surge_level**: SURGE(ratio≥2.0·7d≥5) / WATCH(ratio≥1.5·7d≥3) / IMPROVED(baseline≥20·recent<50%) / STABLE
- recent_7d = [asOf-6, asOf], baseline_28d = [asOf-34, asOf-7]
- 부정 = `overall_emotion = '부정'`

## 주의사항

- **BQ quota**: `QueryUsagePerUserPerDay` 사용자별 일일 한도. 리셋은 태평양 자정 = KST 16~17시. Redis 캐시가 방어하지만 캐시 우회 경로(채팅 도구) 남용 주의
- **UI 문구**: 데이터 전문 용어(baseline, ratio, pp, mentions) 대신 사용자 언어(평시, 배, %p, 회 언급) 사용 — 기존 컨벤션 유지
- 필터 상태는 전부 URL 파라미터 (`seg`, `level`(comma 다중), `cat2`, `cat3`, `asOf`) — 컴포넌트 로컬 상태로 필터 만들지 말 것
