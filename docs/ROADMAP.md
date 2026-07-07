# VOC Dashboard 로드맵

Week 1은 데이터·모니터링 인프라. Week 2~4는 웹앱 + 분석 에이전트 + 액션 트래킹.

## Week 1 (완료 시 목표 상태)

- [x] BQ views (`wanted_ml_voc.voc_daily`, `voc_surge_score`, `voc_keyword_trend`)
- [x] Backyard `prj-voc-dashboard` 프로젝트 (Metabase) 배포
- [x] Backyard `prj-voc-bot` 프로젝트 (Slack 봇) 배포
- [x] Metabase 3개 대시보드 (CS Live / Product Insights / Executive)
- [x] 일간 급증 감지 → #prj-voc-dashboard 알람 (08:30 KST)
- [x] 주간 리포트 (월 09:00 KST, 기존 로직 유지)

## Week 2: 웹앱 스켈레톤 + 분석 에이전트 v0

**목표**: 대시보드 위젯을 커스텀 웹으로 만들 필요는 아직 없음. 그대신 **자연어 Q&A 에이전트**를 우선 붙임 — Metabase가 못하는 "왜?"를 채움.

- [ ] `frontend/` Next.js 14 App Router 스켈레톤 (Tailwind + shadcn/ui)
- [ ] `/api/chat` 엔드포인트 — Claude API (`anthropic` SDK) + tool use
  - Tool: `run_bigquery(sql: str)` — 화이트리스트된 view만 쿼리
  - Tool: `get_domain_knowledge(kind: str)` — prj-backend-huxv9z 조회
  - Tool: `get_ticket_detail(id: str)` — 원천 티켓 상세
- [ ] 시스템 프롬프트: "너는 VOC 분석가. 데이터에서 확인한 팩트만 답한다."
- [ ] frontend에 Metabase 대시보드 iframe embed + 사이드바 채팅 UI
- [ ] 배포: `prj-voc-dashboard` 프로젝트에 Next.js 컨테이너 추가 or 별도 프로젝트

## Week 3: Jira LIVE 자동 이슈 생성

- [ ] `src/voc_analyst/integrations/jira_live.py` — LIVE 프로젝트 클라이언트
- [ ] Slack 알람 메시지에 `[Jira 이슈 생성]` 버튼 (interactive action)
  - 클릭 → 카테고리 + 대표 티켓 3개를 description에 담아 LIVE 이슈 생성
  - 라벨: `voc-source:<ticket_id_list>`, `voc-category:<category3>`
- [ ] 웹앱 채팅에서도 "이거 Jira 만들어줘" → 에이전트가 tool call로 이슈 생성

## Week 4: 액션 → 성과 트래킹

- [ ] BQ 테이블 신설: `wanted_ml_voc.voc_actions`
  ```
  action_id STRING (Jira key),
  category3 STRING,
  jira_key STRING,
  created_at TIMESTAMP,
  resolved_at TIMESTAMP,   -- Jira Done 전환 시점
  baseline_ticket_rate FLOAT64,  -- 이슈 생성 시점 recent_7d/7
  post_resolution_ticket_rate FLOAT64,  -- 해결 4주 후 recent_7d/7
  effect_pct FLOAT64
  ```
- [ ] `scripts/backfill_action_effects.py` — Jira 상태 폴링, 해결 4주 후 자동 계산
- [ ] Executive 대시보드에 위젯 5 활성화

## Week 5+ (선택 확장)

- 반복 이슈 자동 클러스터링 (embeddings + HDBSCAN) — "동일 이슈 여러 번 접수" 자동 그루핑
- 부정 감정 티켓 자동 우선순위 매기기 (LLM classifier + 감정 점수)
- Confluence 자동 리포트 (기존 wanted-insights-bot 패턴 재사용)
- 이메일 다이제스트 (임원용 주간 요약)

## 참고

- Metabase 대시보드는 **탐색·모니터링 도구**로만 유지. 액션 트리거·에이전트 대화는 웹앱에서.
- Frontend 커스텀은 Metabase로 커버 안 되는 것부터 (자연어 Q&A, 액션 등록, 성과 추적).
- 개별 뷰가 자주 열리는지 metabase-analytics로 관찰 → 안 열리면 정리, 자주 열리면 웹앱으로 이관.
