# Slack 채널 세팅 및 첫 dry-run

## #prj-voc-dashboard 채널 준비

1. Slack 워크스페이스에서 `#prj-voc-dashboard` 채널 생성 (public 권장 — CS/PM/리더십 접근성)
2. Data Findings 봇 초대: 채널에서 `/invite @Data Findings`
3. 봇 권한 확인: `chat:write`, `channels:read` (권한 없으면 봇 앱 관리자에게 요청)

## 채널 라우팅 (선택)

wanted-insights-bot의 채널 구독 기능 재활용 가능:
- `/data-findings channel-subscribe voc surge daily` — 이 채널에도 관련 태그 인사이트 cross-post

## 첫 dry-run 시나리오

### Step 1: 로컬에서 voc_daily 강제 실행

```bash
cd /Users/june/Downloads/agents/voc-monitoring
set -a; source .env; set +a  # SLACK_BOT_TOKEN, GOOGLE_APPLICATION_CREDENTIALS 로드

uv run python - <<'PY'
import asyncio
from voc_analyst.jobs.voc_daily import run_daily_voc_job

result = asyncio.run(run_daily_voc_job(force_run=True))
print(result)
PY
```

**기대 결과**:
- `{"status": "ok", "surges": N, "posted": true}`
- #prj-voc-dashboard 채널에 요약 메시지
- 스레드에 top 5 카테고리별 대표 티켓 3개씩

### Step 2: Backyard에서 강제 실행

```bash
# 봇 배포 후
curl "http://prj-backend-XXXXXX.lab.wntd.co/trigger/daily?force=1"
```

Litestar 앱에 아래 endpoint 추가 필요 (Week 1 D5-6에서 app.py 수정 시 함께 반영):

```python
@get("/trigger/daily")
async def trigger_daily(force: bool = False) -> dict:
    from voc_analyst.jobs.voc_daily import run_daily_voc_job
    return await run_daily_voc_job(force_run=force)
```

### Step 3: 스케줄러 실행 확인

컨테이너 로그에서:
```
INFO:voc_analyst.jobs.scheduler:APScheduler started (daily 08:30, weekly Mon 09:00 KST)
```

다음 날 08:30 KST에 실제 알람이 오는지 관찰. 안 오면:
- Backyard `mcp__backyard__get_logs` 로그 확인
- SLACK_BOT_TOKEN 만료 여부
- BQ SA 권한

## 알람 예시 (기대 포맷)

```
[일일 VOC 급증 감지 리포트]

🚨 계정 / 광고 — 최근 7일 30건 (baseline 5.3/일, 2.86x)
⚠️ 마일리지 / 마일리지 — 최근 7일 4건 (baseline 0.5/일, 4.0x) (부정 25%)
⚠️ 피드백 / 건의사항 — 최근 7일 6건 (baseline 0.5/일, 6.0x)

📊 VOC Dashboard · 상세 티켓은 스레드 참조
```

스레드:
```
계정 / 광고 — 대표 티켓 3건
🔴 12345 Re: [하이퍼리즘] 광고 신청 문의
    └ 채용 광고 노출 및 상품 안내 문의
⚪ 12346 광고 문의합니다
    └ 광고 비용 문의
...
```
