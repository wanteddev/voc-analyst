# AWS Lambda → Backyard 이관 계획

기존 `voc-analyst` 리포는 AWS Lambda + CloudFormation 배포였음. Backyard 컨테이너로 완전 이관.
운영 중이 아니므로 이중 배포 없이 바로 대체.

## 파일별 처리

### 삭제 예정 (AWS 종속)

- `template.yaml` — CloudFormation 스택 정의
- `scripts/create_roles.sh` — IAM role 생성
- `scripts/deploy_stack.sh` — CFN 스택 배포
- `scripts/deployed_version.sh` — Lambda 배포 정보 조회
- `scripts/get_stack_output.sh` — CFN output 조회
- `scripts/invoke_job.sh` — Lambda invoke
- `scripts/sync_env.py` — LAMBDA_* → CFN 파라미터 sync
- `Dockerfile` (Lambda Web Adapter용) — `Dockerfile.backyard`로 대체

### 코드 수정 필요

- `src/voc_analyst/app.py` — Litestar app에 APScheduler `start_scheduler()` 부팅 훅 추가
- `src/voc_analyst/slack/handlers.py` — Lambda-specific `invoke_background()` 제거,
  단일 컨테이너 내에서 asyncio task로 처리하도록 변경
- `src/voc_analyst/slack/background.py` — 별도 함수 → 인프로세스 async worker로
- `src/voc_analyst/jobs/voc_weekly.py` — SSM Parameter Store 조회를 환경변수 조회로 대체
  (`_load_ssm_credentials`, `_load_laas_api_key` 함수 → env var lookup으로)
- `justfile` — `just deploy` → Backyard push+restart 스크립트로 재작성

### 신규 추가 (완료)

- `src/voc_analyst/jobs/voc_daily.py` — 일간 급증 감지
- `src/voc_analyst/jobs/scheduler.py` — APScheduler daily/weekly cron
- `Dockerfile.backyard` — arm64 컨테이너
- `bq_views/` — BQ 뷰 SQL 3개
- `metabase/` — Metabase 배포 스펙
- `dashboards/` — 3개 대시보드 위젯 정의
- `backyard-bot-spec.md` — 봇 Backyard 배포 스펙

### 의존성 추가 필요

`pyproject.toml`에 추가:
```toml
"apscheduler>=3.10.0",
"anthropic>=0.40.0",  # Week 2 분석 에이전트용
```

`boto3`는 SSM 조회 제거 후 필요없어지지만, 기존 코드가 있으니 Week 1에는 남겨두고 Week 2에 제거.

## 실행 순서 (사용자 승인 후)

1. `bq_views/apply.sh` 실행 → 데이터셋 + 뷰 3개 생성
2. BQ SA 생성 + 권한 부여 + JSON 키 발급
3. Backyard `prj-voc-dashboard` (Metabase용) 생성
4. Backyard `prj-voc-bot` (봇용) 생성
5. Metabase Dockerfile push, 봇 Dockerfile.backyard push
6. Backyard secret 업로드 (양쪽)
7. Slack `#prj-voc-dashboard` 채널 생성 확인, 봇 초대
8. voc_daily dry-run
9. AWS 파일 삭제 커밋 (git 히스토리에는 남음, 필요시 rollback 가능)

## Week 2+ 예정

- Next.js 대시보드 앱 (`frontend/`)
- Claude API 분석 에이전트 (`src/voc_analyst/agents/`)
- Jira LIVE 프로젝트 자동 이슈 생성 (`src/voc_analyst/integrations/jira_live.py`)
- `voc_actions` 테이블 (액션-성과 트래킹)
