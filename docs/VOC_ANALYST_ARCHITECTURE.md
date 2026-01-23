# VOC Analyst Architecture

## Overview
Weekly VOC analyst bot running on AWS Lambda via Litestar + Lambda Web Adapter.
It pulls weekly VOC data from BigQuery, detects notable changes, posts a summary
to Slack, and (for CRITICAL/MONITOR items) posts follow-up analysis in the thread
using LaaS preset prompts.

## Data Flow
1) EventBridge Scheduler -> Job Lambda (`/events`) -> `run_weekly_voc_job`
2) BigQuery query aggregates weekly counts and negative counts by category
3) Compare last week vs previous week, assign severities
4) Post Slack summary to configured channel
5) For CRITICAL/MONITOR items, fetch samples for both weeks and call LaaS preset
6) Post LaaS follow-up messages to the same thread

## Modules
- `src/voc_analyst/jobs/runner.py`
  - Entry point for scheduled job
- `src/voc_analyst/jobs/voc_weekly.py`
  - BigQuery IO, change detection, Slack formatting, LaaS follow-ups
- `src/voc_analyst/slack/background.py`
  - Mention-triggered reports and follow-up posting

## BigQuery
### Weekly aggregation
Table: `wanted-data.wanted_ml.zendesk_voc_classified`

Fields used:
- `event_create_time` (TIMESTAMP)
- `category1`, `category2`, `category3`
- `overall_emotion`

Aggregation logic:
- week_start: Monday-based week
- week_end: week_start + 6 days
- total_count: COUNT(*)
- negative_count: COUNTIF(overall_emotion = '부정')

### Sample extraction
For each CRITICAL/MONITOR item, fetch up to 20 rows per week (prev and last),
then pass the first 10 per week to LaaS prompt.

## Change Detection
### Severity labels
- `critical`
  - (increase >= 30% OR negative ratio +20%p) AND prev week VOC >= 20
- `monitor`
  - (increase >= 30% OR negative ratio +10%p) AND prev week VOC >= 10
- `improved`
  - decrease >= 30% AND prev week VOC >= 10
- `stable`
  - everything else

### Filters
Only CRITICAL/MONITOR/IMPROVED are filtered by:
- `VOC_MIN_ABS_CHANGE` (default 5)
- `VOC_MIN_PCT_CHANGE` (default 20)
- `VOC_MIN_COUNT` (default 5)

STABLE is always included in counts but not shown in the message body.

## Slack Summary Message
Blocks:
1) Header + date range
2) Summary counts: CRITICAL / MONITOR / IMPROVED / STABLE
3) Sections for CRITICAL/MONITOR/IMPROVED (2-column fields)
4) Criteria summary (footer)
5) Looker Studio button (footer)

STABLE items are excluded from the detailed section.

## Follow-up Messages (Thread)
For each CRITICAL/MONITOR item:
1) Fetch samples for prev week and last week
2) Build LaaS prompt with both sample sets
3) Call LaaS preset endpoint
4) Post response in the same thread

## LaaS Integration
Endpoint:
- `POST /api/preset/v2/chat/completions`

Headers:
- `apiKey: <LaaS API key>`
- `project: WANTED_DATA`
- `Content-Type: application/json; charset=utf-8`
- `Authorization: Bearer <LaaS API key>`

Payload:
- `hash: <preset hash>`
- `messages: [{role: "user", content: "<prompt>"}]`

## Configuration (Env)
### Slack
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `VOC_SLACK_CHANNEL` (or `LAMBDA_VOC_SLACK_CHANNEL`)

### BigQuery
- `VOC_BIGQUERY_PROJECT` (default: wanted-data)
- `VOC_BIGQUERY_TABLE` (default: wanted-data.wanted_ml.zendesk_voc_classified)
- `VOC_BIGQUERY_LOCATION` (default: asia-northeast3)
- `VOC_BIGQUERY_START_DATE` (default: 2025-01-01)
- `VOC_GOOGLE_CREDENTIALS_SSM_KEY` (default: /DATA/WWW/GOOGLE/SERVICE_CREDENTIALS)

### LaaS
- `LAMBDA_LAAS_PRESET_HASH` (default: 90571f07e6b60e047620162ecc29b423dba8280aba60dba503aac082082ad0c4)
- `LAMBDA_LAAS_API_KEY_SSM_KEY` (default: /DATA/PIPELINE/API_KEY/OPENAI)
- `LAMBDA_LAAS_BASE_URL` (default: https://api-laas.wanted.co.kr)

### Thresholds
- `VOC_MIN_ABS_CHANGE` (default: 5)
- `VOC_MIN_PCT_CHANGE` (default: 20)
- `VOC_MIN_COUNT` (default: 5)
- `VOC_FORCE_RUN` (true/false) for local runs

## Scheduling
EventBridge Scheduler triggers the Job Lambda on Mondays.
Local runs can bypass weekday check using `VOC_FORCE_RUN=true`.

## Known Operational Notes
- Slack bot must be invited to target channel.
- LaaS API key is loaded from SSM; ensure SSO is logged in locally.
- SSM lookup failures will surface as LaaS errors in thread messages.
