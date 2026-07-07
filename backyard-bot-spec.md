# Backyard 프로젝트 스펙 — voc-analyst-bot

Slack 봇 + 일간/주간 VOC 감지 스케줄러. Metabase와 별개 프로젝트로 배포.

## 프로젝트 파라미터

| 필드 | 값 |
|---|---|
| `displayName` | `voc-analyst-bot` |
| `description` | VOC 봇 — Slack #prj-voc-dashboard 일간(08:30)/주간(월 09:00) 알람. 데이터 소스: `wanted-data.wanted_ml_voc.*`. |
| `visibility` | `protected` |
| `privateDomain.prefix` | `voc-analyst-bot` |
| `backend.enabled` | `true` |
| `backend.image` | `lab.wntd.co/prj-<hash>/backend:latest` (Dockerfile.backyard 빌드 결과) |
| `database.enabled` | `false` (필요시 Week 2에 추가) |
| `autoDelete.duration` | `1month` |

## 환경변수 / 시크릿

Backyard secret으로 아래 값 세팅:

```
SLACK_BOT_TOKEN=xoxb-...             # Data Findings 봇 토큰 재사용
SLACK_SIGNING_SECRET=...             # slash command용 (Week 2+)
GOOGLE_APPLICATION_CREDENTIALS=/secrets/bq-sa.json
VOC_SLACK_CHANNEL_DAILY=#prj-voc-dashboard
VOC_SLACK_CHANNEL_WEEKLY=#prj-voc-dashboard
VOC_ENABLE_WEEKLY=true
LAAS_API_KEY=...                     # 기존 LaaS 후속 분석 유지
```

시크릿 파일 마운트:
- `/secrets/bq-sa.json` — Metabase와 동일한 SA 재사용 or 별도 SA

## 배포 순서

1. Backyard 프로젝트 생성 → project ID 획득
2. `docker buildx build --platform=linux/arm64 -f Dockerfile.backyard -t lab.wntd.co/proj-XXXXXX/backend:latest --push .`
3. Backyard secret 업로드 (위 목록)
4. Backyard `restart_component` (webhook non-idempotent 이슈 대응 — 메모리 `backyard_latest_webhook.md` 참고)
5. 헬스체크: `curl http://prj-backend-XXXXXX.lab.wntd.co/healthz`
6. dry-run: `curl http://prj-backend-XXXXXX.lab.wntd.co/trigger/daily?force=1`

## 로컬 검증

```bash
cd /Users/june/Downloads/agents/voc-monitoring
set -a; source .env; set +a
uv run python -c "
import asyncio
from voc_analyst.jobs.voc_daily import run_daily_voc_job
print(asyncio.run(run_daily_voc_job(force_run=True)))
"
```
