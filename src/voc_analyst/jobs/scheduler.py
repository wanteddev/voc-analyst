"""APScheduler entry — Backyard 컨테이너 내에서 daily/weekly VOC job 실행.

기존 AWS EventBridge Scheduler를 대체.
컨테이너 부팅 시 1회 실행되어 APScheduler background thread를 띄우고
Litestar 앱과 동일 프로세스에서 동거.
"""

from __future__ import annotations

import asyncio
import logging
import os
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from voc_analyst.jobs.voc_daily import run_daily_voc_job
from voc_analyst.jobs.voc_weekly import build_weekly_voc_report  # 기존 재사용

logger = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")


def _weekly_job() -> None:
    """Monday 09:00 KST — 기존 voc_weekly 실행."""
    try:
        asyncio.get_event_loop().create_task(_run_weekly())
    except Exception:
        logger.exception("weekly_job dispatch failed")


async def _run_weekly() -> None:
    # NOTE: 기존 voc_weekly는 report만 만들고 Slack 전송은 별도 fn.
    # 여기서는 dry-run 호환을 위해 build만 호출. 실제 Slack 발송은 라이터 함수 필요.
    # Week 1은 daily job 우선, weekly는 기존 lambda-oriented 코드를 컨테이너로 옮길 때 별도 정리.
    try:
        report = await build_weekly_voc_report(force_run=False)
        logger.info("weekly_job done: changes=%s", report.get("changes"))
    except Exception:
        logger.exception("weekly_job failed")


def _daily_job() -> None:
    try:
        asyncio.get_event_loop().create_task(run_daily_voc_job())
    except Exception:
        logger.exception("daily_job dispatch failed")


def start_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone=KST)

    # 매일 08:30 KST — 일간 급증 감지
    scheduler.add_job(
        _daily_job,
        CronTrigger(hour=8, minute=30, timezone=KST),
        id="voc_daily",
        replace_existing=True,
    )

    # 월요일 09:00 KST — 주간 리포트 (기존 스케줄 유지)
    if os.environ.get("VOC_ENABLE_WEEKLY", "true").lower() == "true":
        scheduler.add_job(
            _weekly_job,
            CronTrigger(day_of_week="mon", hour=9, minute=0, timezone=KST),
            id="voc_weekly",
            replace_existing=True,
        )

    scheduler.start()
    logger.info("APScheduler started (daily 08:30, weekly Mon 09:00 KST)")
    return scheduler
