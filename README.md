# VOC Analyst — 온보딩 가이드

Voice of Customer 모니터링 시스템입니다. Zendesk로 들어온 고객 문의를 카테고리·감정별로 분석해서 두 가지 채널로 전달합니다.

| 채널 | 무엇 | 언제 |
|---|---|---|
| **Slack 봇** | 주간 VOC 변화 요약 (CRITICAL/MONITOR/IMPROVED) | 매주 월요일 아침 자동 |
| **웹 대시보드** | 급증 카테고리·부정 감정·신규 키워드 실시간 탐색 + AI 채팅 | 상시 (사내망) |

처음 합류하셨다면 이 문서 순서대로 따라오시면 됩니다.

---

## 0. 미리 알아둘 것

**시스템 흐름**

```
Zendesk 문의
  → wanted-data.wanted_ml.zendesk_voc_classified   (ML팀이 분류·감정 라벨링, 전일자까지 적재)
  → BigQuery views (bq_views/ 폴더의 SQL로 정의)
  → ① Slack 주간 봇 (src/voc_analyst/, Python)
  → ② 웹 대시보드 (webapp/, Next.js)
       └─ Redis 캐시 (25h TTL) — 같은 조회는 하루 1번만 BQ 실행
```

**두 서비스 모두 Backyard(사내 Kubernetes 샌드박스)에 배포**되어 있습니다. AWS가 아닙니다 — 리포에 남아있는 Lambda 관련 파일은 과거 흔적입니다.

**핵심 개념**
- **surge_level**: 카테고리별 상태. `SURGE`(급증) / `WATCH`(주의) / `STABLE`(안정) / `IMPROVED`(개선). 최근 7일 티켓 수를 직전 4주 평시와 비교해 분류.
- **as-of (기준일)**: 대시보드의 모든 숫자는 특정 기준일의 스냅샷. 데이터가 전일자까지만 적재되므로 default는 **어제**.
- **부정률**: `overall_emotion = '부정'`인 티켓 비율.

---

## 1. 리포 클론과 구조 파악

```bash
git clone git@github.com:wanteddev/voc-analyst.git
cd voc-analyst
```

```
voc-analyst/
├── webapp/              ★ 웹 대시보드 (Next.js 14) — 최근 개발 중심
│   ├── src/app/product/     # Product Insights 페이지 + error boundary
│   ├── src/app/api/         # /api/drilldown, /api/chat(SSE), /api/jira/create
│   ├── src/components/      # StatusOverview, WatchGrid, DrilldownPanel, ChatSidebar ...
│   └── src/lib/             # queries.ts(BQ 쿼리 전부), bq.ts(클라이언트), product-url.ts
├── src/voc_analyst/     ★ Slack 주간 봇 (Python/Litestar)
│   ├── jobs/voc_weekly.py   # 주간 리포트 생성·전송
│   └── slack/handlers.py    # 슬래시 커맨드·멘션 핸들러
├── bq_views/            # BigQuery view/TVF 정의 SQL (수정 시 bq CLI로 직접 반영)
├── dashboards/          # 대시보드 PRD (product-insights 구현됨 · cs-live, executive 미구현)
└── docs/                # 계획·마이그레이션·Slack 셋업 문서
```

---

## 2. 접근 권한 준비

| 필요한 것 | 용도 | 받는 곳 |
|---|---|---|
| GCP `wanted-data` 프로젝트 조회 권한 | BigQuery 쿼리 | 데이터팀 |
| BQ 서비스 계정 JSON (`voc-bq-sa.json`) | 웹앱 로컬 개발·배포 | 데이터팀 (또는 Backyard secret에서 확인) |
| Backyard 계정 | 배포·로그 확인 | 인프라팀 |
| OpenAI API 키 | 채팅 에이전트 | 팀 공용 키 사용 |
| Slack 봇 토큰 (`xoxb-...`) | 봇 로컬 테스트 | 워크스페이스 앱 관리자 |

> ⚠️ BigQuery에 **사용자별 일일 쿼리 한도**(QueryUsagePerUserPerDay)가 걸려 있습니다. 대량 조회·반복 새로고침을 하면 당일 quota가 소진되고 대시보드가 안내 페이지로 전환됩니다. 리셋은 **매일 태평양 시간 자정 = KST 오후 4~5시경**. Redis 캐시(25h TTL)가 있어 일반 사용으로는 초과되지 않습니다.

---

**운영 URL**: https://prj-frontend-a2qqw2.lab.wntd.co/product (사내망)

## 3. 웹 대시보드 로컬 실행

```bash
cd webapp
npm install

export GCP_SA_KEY="$(cat ~/voc-bq-sa.json)"
export BQ_PROJECT=wanted-data
export OPENAI_API_KEY=sk-...   # 채팅 에이전트 안 쓰면 생략 가능

npm run dev
# → http://localhost:3000/product
```

**확인할 것**: 페이지가 뜨고 "주간 시그널" 4개 블럭에 숫자가 보이면 성공. BQ 인증 에러가 나면 `GCP_SA_KEY` JSON이 유효한지 확인하세요.

**대시보드 사용법 요약**
- 상단 sticky 필터 바: 유저/기업 · 상태(급증/주의/안정/개선, 다중 선택) · 기준일
- 주간 시그널 블럭 클릭 → 상태 필터 토글
- 카테고리 카드 클릭 → 드릴다운(12주 트렌드·키워드·원문 티켓) + 상단에 중/소분류 chip 추가
- 트렌드 차트 포인트 클릭 → 해당 주 티켓만 필터
- 우측 💬 버튼 → AI 채팅 (BQ 조회 도구 포함, 답변 근거 CSV 다운로드 가능)

---

## 4. Slack 봇 로컬 실행

```bash
# 루트에서
uv sync --frozen
cp dot_env.example .env   # 토큰 채우기
just serve                # http://localhost:8080
```

주간 메시지를 채널로 강제 전송해보려면 README 히스토리의 스크립트 또는 `docs/SLACK_GUIDE.md` 참고.

---

## 5. 배포

### 웹 대시보드 → Backyard `proj-a2qqw2`

frontend 컴포넌트만 사용합니다 (backend 컴포넌트는 비활성화됨).

```bash
cd webapp
docker buildx build --platform=linux/arm64 --no-cache \
  -t lab.wntd.co/proj-a2qqw2/frontend:latest --push .
```

푸시 후 **Backyard에서 frontend 컴포넌트 restart** (Claude Code에서 Backyard MCP `restart_component` 또는 Backyard 콘솔). `:latest` 태그 webhook이 항상 재배포를 보장하지 않으므로 restart는 필수입니다.

체크리스트:
- [ ] `npm run typecheck` 통과
- [ ] `npm run build` 로컬 통과 (webpack 에러 조기 발견)
- [ ] push 후 restart → 새 이미지 sha 확인 (`list_images` / 콘솔)
- [ ] https://prj-frontend-a2qqw2.lab.wntd.co/product 접속 확인

주의: **arm64 필수**. amd64 이미지는 Backyard에서 `exec format error`로 즉사합니다.

### BigQuery view 수정

`bq_views/*.sql` 수정 후 직접 반영:

```bash
bq query --use_legacy_sql=false < bq_views/02_voc_surge_score.sql
```

view를 바꾸면 대시보드와 Slack 봇 양쪽에 영향이 가니, `05_voc_surge_score_at.sql`(TVF)과 정의를 항상 동기화하세요.

---

## 6. 자주 겪는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| 대시보드에 "데이터 조회 한도 초과" 안내 | BQ 일일 quota 소진 | KST 오후 4~5시(태평양 자정) 리셋 대기, 또는 관리자에게 상향 요청 |
| 배포했는데 예전 화면 | Backyard rolling update 중 stale pod | restart_component 한 번 더, 30초 대기 |
| 숫자가 화면마다 다름 | (해결됨) 과거 이슈 — 단일 스냅샷 파생 구조로 수정 완료 | 재발 시 `fetchAllSurges` 경로 확인 |
| Docker 빌드가 옛 코드 사용 | 빌드 캐시 | `--no-cache` 플래그 (배포 명령에 이미 포함) |
| 월요일 아침 급증 카테고리 0개 | 주말 저볼륨이 7일 창에 유입 (정상) | 기준일을 금요일로 바꿔 비교 |

## 7. 더 읽을 것

- [dashboards/product-insights.md](dashboards/product-insights.md) — 대시보드 PRD·설계 결정
- [docs/PLAN_PRODUCT_INSIGHTS.md](docs/PLAN_PRODUCT_INSIGHTS.md) — 기능 상세 계획
- [docs/MIGRATION.md](docs/MIGRATION.md) — Metabase → 커스텀 웹앱 전환 배경
- [docs/SLACK_GUIDE.md](docs/SLACK_GUIDE.md) — Slack 알림 포맷·실패 대응
- [docs/ROADMAP.md](docs/ROADMAP.md) — 로드맵

## 라이선스

MIT
