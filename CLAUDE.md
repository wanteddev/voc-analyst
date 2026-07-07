# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Weekly VOC (Voice of Customer) analyst Slack bot on AWS Lambda. Pulls weekly VOC data from BigQuery, detects notable changes week-over-week, posts a summary to Slack, and for CRITICAL/MONITOR items posts LLM-generated follow-up analysis (via LaaS) in the thread.

## Architecture

Three Lambda functions share a single Docker image (Litestar + Lambda Web Adapter). Routing is controlled by `AWS_LWA_PASS_THROUGH_PATH`:

- **WebFunction** — Function URL, handles Slack webhooks at `/slack/events`. Acks within 3s, delegates long work to SlackBgFunction via async Lambda invoke.
- **JobFunction** — EventBridge Scheduler (Monday 9 AM KST) → `/events` → `run_weekly_voc_job`.
- **SlackBgFunction** — `/slack/background`, processes tasks dispatched from WebFunction (mention-triggered reports, DMs, slash commands).

Data flow for the weekly report:
1. BigQuery: aggregate weekly VOC counts + negative counts by category (table: `wanted-data.wanted_ml.zendesk_voc_classified`)
2. Compare last two weeks, assign severity (critical/monitor/improved/stable)
3. Post Slack summary with Block Kit formatting
4. For CRITICAL/MONITOR items: fetch sample VOCs, call LaaS for analysis, post in thread

### Change Detection Thresholds

- **CRITICAL**: (increase ≥30% or negative ratio +20%p) & either week VOC ≥20
- **MONITOR**: (increase ≥20% or negative ratio +10%p) & either week VOC ≥10
- **IMPROVED**: decrease ≥20% & either week VOC ≥10
- **STABLE**: everything else

### LaaS Integration

Follow-up analysis uses LaaS preset API (`/api/preset/v2/chat/completions`). The preset hash and API key are fetched from SSM Parameter Store. Output: summary, representative examples, causal hypotheses, recommended actions.

## Key Paths

- `src/voc_analyst/app.py` — Litestar app with route handlers
- `src/voc_analyst/slack/app.py` — Slack Bolt app (`process_before_response=True`)
- `src/voc_analyst/slack/handlers.py` — Slash commands + event handlers; `invoke_background()` dispatches to SlackBgFunction
- `src/voc_analyst/slack/background.py` — Background task router and handlers
- `src/voc_analyst/jobs/runner.py` — Scheduled job entry point
- `src/voc_analyst/jobs/voc_weekly.py` — Core logic: BigQuery queries, change detection, Slack blocks, LaaS integration
- `template.yaml` — CloudFormation stack (3 Lambdas + EventBridge Schedule)
- `justfile` — Build/deploy/dev commands
- `docs/VOC_ANALYST_ARCHITECTURE.md` — Detailed architecture reference

## Commands

```bash
uv sync --frozen            # Install dependencies
just serve                  # Run local dev server (port 8080)
just build                  # Build container image
just deploy                 # Push to ECR + deploy CloudFormation
just invoke-job             # Invoke job Lambda with sample payload
just sync-env               # Sync LAMBDA_* vars from .env to template.yaml
just url                    # Get deployed Function URL
just deployed-version       # Show deployed image/tag/commit info
just lock                   # Update lockfile (uv.lock + requirements.lock)
just create-roles           # Create IAM roles (run once before first deploy)
```

### Tests & Quality

```bash
uv run pytest                          # Run all tests
uv run pytest tests/test_app.py        # Run single test file
uv run pytest -k "test_name"           # Run single test by name
uv run ruff check .                    # Lint
uv run ruff format .                   # Format
uv run mypy src/                       # Type check
```

pytest is configured with `asyncio_mode = "auto"` — async test functions work without extra decorators. `tests/conftest.py` sets dummy env vars (`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, etc.) so tests run without real credentials.

## Coding Guidelines

- Route handlers are `async` by default.
- Sync I/O libraries (`boto3`, `slack_sdk`, `google-cloud-bigquery`) must be offloaded with `anyio.to_thread.run_sync`.
- Slack handlers must ack within 3 seconds. Long-running work goes through `invoke_background()` → SlackBgFunction.
- After background processing, respond via `response_url` (slash commands) or `slack_client.chat_postMessage` (events/DMs).
- Slack error handler returns HTTP 200 even on failure to prevent Slack retry storms (Slack retries on 3xx/4xx/5xx).
- Python 3.13, ruff target `py313`, line-length 100, ruff rules: E/F/I/UP. mypy strict mode.

## Environment Variables

Copy `dot_env.example` to `.env` and fill values. New Lambda env vars: add to `.env` with `LAMBDA_` prefix, then run `just sync-env` (auto-updates `template.yaml` and `deploy_stack.sh`). Use `AWS_PROFILE=profile_name` for non-default AWS profiles.
