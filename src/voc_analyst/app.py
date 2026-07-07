"""Litestar application entrypoint — Backyard 컨테이너용.

기존 AWS Lambda 대응 코드를 컨테이너 단일 프로세스로 통합.
- APScheduler background thread로 daily/weekly cron 실행
- Slack webhook은 동일 프로세스에서 처리 (Lambda 별도 함수 없음)
- /trigger/* 로 수동 실행 (dry-run/디버그)
"""

from __future__ import annotations

import logging
import os
from typing import Any

from litestar import Litestar, Request, Response, get, post
from slack_bolt.request import BoltRequest

from voc_analyst.slack.app import slack_app

logger = logging.getLogger(__name__)


@get("/")
async def health() -> dict[str, str]:
    return {"ok": "web"}


@get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "healthy"}


@get("/trigger/daily")
async def trigger_daily(force: bool = False) -> dict[str, Any]:
    """일간 VOC 급증 감지 수동 실행. force=1이면 급증 없어도 리포트 전송."""
    from voc_analyst.jobs.voc_daily import run_daily_voc_job

    return await run_daily_voc_job(force_run=force)


@get("/trigger/weekly")
async def trigger_weekly(force: bool = False) -> dict[str, Any]:
    """주간 VOC 리포트 수동 실행."""
    from voc_analyst.jobs.voc_weekly import build_weekly_voc_report

    report = await build_weekly_voc_report(force_run=force)
    return {"status": report.get("status"), "changes": report.get("changes", 0)}


@post("/slack/events")
async def handle_slack_events(request: Request) -> Response:
    """Slack webhooks (slash commands, events, interactions) — 인프로세스 처리."""
    try:
        body = await request.body()
        headers = {k: v for k, v in request.headers.items()}
        bolt_request = BoltRequest(body=body.decode(), headers=headers)
        bolt_response = slack_app.dispatch(bolt_request)

        response_headers: dict[str, str] = {}
        if bolt_response.headers:
            for key, values in bolt_response.headers.items():
                if isinstance(values, list):
                    response_headers[key] = values[0] if values else ""
                else:
                    response_headers[key] = str(values)

        return Response(
            content=bolt_response.body or "",
            status_code=bolt_response.status,
            headers=response_headers,
        )
    except Exception as e:
        logger.exception(f"Slack events handler error: {e}")
        # 200 반환으로 Slack 재시도 방지
        return Response(
            content="Internal error occurred",
            status_code=200,
            headers={"Content-Type": "text/plain"},
        )


def _write_gcp_key_from_env() -> None:
    """GCP_SA_KEY(JSON string) 시크릿을 /tmp/sa.json에 쓰고 GOOGLE_APPLICATION_CREDENTIALS 설정.

    wanted-insights-bot의 entrypoint.sh 패턴을 인프로세스로 이관.
    """
    sa_json = os.environ.get("GCP_SA_KEY")
    if not sa_json:
        logger.warning("GCP_SA_KEY not set — BQ client will fail")
        return
    key_path = "/tmp/voc-sa.json"
    with open(key_path, "w") as f:
        f.write(sa_json)
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
    logger.info("Wrote GCP SA key to %s", key_path)


async def _on_startup(app: Litestar) -> None:
    _write_gcp_key_from_env()
    from voc_analyst.jobs.scheduler import start_scheduler

    app.state.scheduler = start_scheduler()


async def _on_shutdown(app: Litestar) -> None:
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler is not None:
        scheduler.shutdown(wait=False)


app = Litestar(
    route_handlers=[
        health,
        healthz,
        trigger_daily,
        trigger_weekly,
        handle_slack_events,
    ],
    on_startup=[_on_startup],
    on_shutdown=[_on_shutdown],
    debug=False,
)
