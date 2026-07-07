# VOC Analyst

Voice of Customer 모니터링 시스템. Zendesk 유입 문의를 카테고리·감정별로 분류·집계하고, 두 채널로 전달합니다.

- **Slack 봇 (주간)** — 매주 월요일 아침 `#voc-*` 채널로 주간 변화 요약을 자동 전송
- **웹 대시보드 (실시간)** — Next.js 앱에서 급증 카테고리·부정 감정 변화·신규 키워드를 필터링해서 확인, 채팅 에이전트로 질의도 가능

**리포**: [`wanteddev/voc-analyst`](https://github.com/wanteddev/voc-analyst)
**배포**: 두 서비스 모두 Backyard(사내 Kubernetes 샌드박스)에 배포

---

## 아키텍처

```
                    ┌─────────────────────────────┐
                    │  wanted_ml.zendesk_voc_     │  ← 원본 (분류·감정 완료)
                    │  classified                 │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  BigQuery Views (bq_views/) │
                    │  · voc_daily                │
                    │  · voc_surge_score          │
                    │  · voc_surge_score_at(TVF)  │
                    │  · voc_keyword_trend        │
                    └──────┬───────────────┬──────┘
                           │               │
              ┌────────────▼────┐    ┌─────▼────────────────┐
              │ Slack Bot       │    │ Next.js Dashboard    │
              │ (Python/Litestar)│    │ (webapp/)            │
              │ Backyard        │    │ Backyard proj-a2qqw2 │
              │ 주간 잡         │    │ Chat: GPT-5-mini     │
              └─────────┬───────┘    └─────┬────────────────┘
                        │                  │
                        ▼                  ▼
                    #voc-*            내부 URL 접속
                    Slack 채널        (SSO 필요)
```

## 리포 구조

```
voc-analyst/
├── src/voc_analyst/         # Slack 봇 (Python/Litestar)
│   ├── app.py               # HTTP 앱
│   ├── jobs/                # 스케줄 잡 (voc_weekly, voc_daily, scheduler)
│   └── slack/               # 슬래시 커맨드·이벤트 핸들러
├── webapp/                  # 대시보드 (Next.js 14 App Router)
│   ├── src/app/product/     # Product Insights 페이지
│   ├── src/app/api/         # /api/drilldown, /api/chat, /api/jira/create
│   ├── src/components/      # StatusOverview, WatchGrid, DrilldownPanel 등
│   └── src/lib/             # queries.ts (BQ), bq.ts (client), level.ts 등
├── bq_views/                # BigQuery view/TVF 정의 SQL
├── dashboards/              # PRD 문서 (product-insights, cs-live, executive)
└── docs/                    # 마이그레이션·계획·Slack 셋업 가이드
```

## 데이터 소스

BigQuery 프로젝트: `wanted-data`

| 리소스 | 용도 |
|---|---|
| `wanted_ml.zendesk_voc_classified` | 원본 (Zendesk 티켓 + 카테고리 3단·감정 분류) |
| `wanted_ml_voc.voc_daily` | 일자·카테고리·감정별 티켓 수 집계 (view) |
| `wanted_ml_voc.voc_surge_score` | 카테고리별 급증 점수 (오늘 기준 view) |
| `wanted_ml_voc.voc_surge_score_at(DATE)` | 임의 시점 스냅샷 (TVF, 최대 180일) |
| `wanted_ml_voc.voc_keyword_trend` | 주간 키워드 언급 트렌드 |

---

## 웹 대시보드 (webapp/)

**배포**: Backyard `proj-a2qqw2` · https://prj-backend-a2qqw2.lab.wntd.co/product

**주요 기능**
- **주간 시그널** — 급증/주의/안정/개선 4단 KPI. 블럭 클릭 → 상단 필터 반영
- **카테고리 목록** — 급증한 카테고리 카드 그리드. 클릭 시 드릴다운 오픈 (12주 트렌드 + 상위 키워드 + 원문 티켓 · 원문 클립보드 복사, 트렌드 포인트 클릭 → 주간 필터)
- **부정 감정 변화** — 최근 7일 부정률 vs 직전 4주 평시 (%p)
- **신규 등장 키워드** — 직전 2주엔 없던 키워드가 최근 2주에 급등한 것들
- **필터 (sticky bar)** — 유저/기업, 상태(다중), 중분류·소분류(카드 클릭으로 추가), 기준일 (어제 default, 최근 6개월)
- **채팅 에이전트** — 우측 사이드바 · OpenAI GPT-5-mini · SSE 스트리밍 · BQ + 원문 티켓 조회 도구 · CSV 다운로드
- **라이트/다크 테마 토글**

**로컬 개발**

```bash
cd webapp
npm install
export GCP_SA_KEY="$(cat ~/voc-bq-sa.json)"
export BQ_PROJECT=wanted-data
export OPENAI_API_KEY=sk-...
npm run dev
```

**Backyard 배포**

```bash
cd webapp
docker buildx build --platform=linux/arm64 --no-cache \
  -t lab.wntd.co/proj-a2qqw2/backend:latest --push .
# → Backyard MCP로 restart_component proj-a2qqw2 backend
```

**BQ Quota 관리**
- 페이지 캐시 `revalidate = 60` (초) — 필터 반복 클릭 시 재조회 최소화
- 단일 스냅샷 원자성 (`fetchAllSurges` → in-memory 파생) — 카운트 불일치 방지
- Quota 초과 시 `app/product/error.tsx`가 사용자 친화적 안내 표시 (매일 UTC 자정에 자동 리셋)

---

## Slack 봇 (src/voc_analyst/)

**Litestar 앱**. Backyard에서 Python 컨테이너로 구동, 스케줄러가 매주 월요일 오전 주간 리포트를 생성해 Slack에 전송.

**주간 알림 흐름**
1. `voc_weekly` 잡 → 비교 주 vs 기준 주 카테고리별 볼륨·부정 비율 diff 계산
2. Slack 채널로 요약 메시지 전송 (블럭 UI)
3. CRITICAL/MONITOR 항목은 스레드로 LaaS 프리셋 후속 분석 자동 요청

**변화 감지 기준**
- **CRITICAL**: 증가≥30% 또는 부정비율+20%p, VOC≥20
- **MONITOR**: 증가≥20% 또는 부정비율+10%p, VOC≥10
- **IMPROVED**: 감소≥20%, VOC≥10
- **STABLE**: 그 외

**로컬 실행**

```bash
uv sync --frozen
just serve   # http://localhost:8080
```

**주간 메시지 강제 실행**

```bash
set -a; source .env; set +a
uv run python - <<'PY'
import asyncio
from voc_analyst.jobs.voc_weekly import build_weekly_voc_report, send_slack_notification, _post_followups
import os

async def main():
    channel = os.environ["VOC_SLACK_CHANNEL"]
    report = await build_weekly_voc_report(force_run=True)
    if report.get("status") == "ok" and report.get("changes", 0) > 0:
        ts = await send_slack_notification(channel, report["blocks"])
        await _post_followups(channel=channel, thread_ts=ts, **report)
asyncio.run(main())
PY
```

## 문서

- [dashboards/product-insights.md](dashboards/product-insights.md) — 대시보드 PRD
- [dashboards/cs-live.md](dashboards/cs-live.md) — CS Live 페이지 계획 (미구현)
- [dashboards/executive.md](dashboards/executive.md) — Executive 페이지 계획 (미구현)
- [docs/MIGRATION.md](docs/MIGRATION.md) — Metabase → 커스텀 웹앱 이관 노트
- [docs/PLAN_PRODUCT_INSIGHTS.md](docs/PLAN_PRODUCT_INSIGHTS.md) — Product Insights 상세 계획
- [docs/ROADMAP.md](docs/ROADMAP.md) — 로드맵
- [docs/SLACK_GUIDE.md](docs/SLACK_GUIDE.md) — Slack 알림 포맷·트러블슈팅
- [docs/SLACK_SETUP.md](docs/SLACK_SETUP.md) — Slack 봇 초기 셋업

## 환경변수

**웹앱 (webapp/)**
- `GCP_SA_KEY` — BigQuery 서비스 계정 JSON (Backyard secret)
- `BQ_PROJECT` — `wanted-data`
- `OPENAI_API_KEY` — GPT-5-mini 채팅 에이전트용

**Slack 봇 (src/voc_analyst/)**
- `SLACK_BOT_TOKEN` — Bot User OAuth Token (`xoxb-...`)
- `SLACK_SIGNING_SECRET` — 요청 검증용
- `VOC_SLACK_CHANNEL` — 알림 채널 ID
- `LAAS_API_KEY` — 후속 분석 프리셋용

## 라이선스

MIT
