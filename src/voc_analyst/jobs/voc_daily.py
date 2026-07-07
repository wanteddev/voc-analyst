"""Daily VOC surge detection using wanted_ml_voc.voc_surge_score view.

Design:
- 매일 오전 KST 8:30 스케줄로 실행 (weekly job보다 이른 시각).
- voc_surge_score view에서 SURGE/WATCH 레벨 카테고리 pull.
- Slack #prj-voc-dashboard로 요약 알람.
- 스레드에 카테고리별 대표 티켓 3개씩 첨부.
- Week 2+에서 Claude API 분석 에이전트 스레드 답변 추가 예정.

Env vars:
- VOC_SLACK_CHANNEL_DAILY (default: #prj-voc-dashboard)
- SLACK_BOT_TOKEN
- GOOGLE_APPLICATION_CREDENTIALS (BQ SA JSON path)
- VOC_DAILY_MIN_LEVEL (default: WATCH — SURGE, WATCH 둘 다 포함)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import anyio
from google.cloud import bigquery
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL = "#prj-voc-dashboard"
SURGE_QUERY = """
SELECT
  surge_level,
  category1, category2, category3,
  recent_7d, baseline_daily_avg, ratio, z_score,
  recent_negative_ratio
FROM `wanted-data.wanted_ml_voc.voc_surge_score`
WHERE surge_level IN UNNEST(@levels)
ORDER BY
  CASE surge_level WHEN 'SURGE' THEN 0 WHEN 'WATCH' THEN 1 ELSE 2 END,
  ratio DESC
LIMIT 15
"""

SAMPLE_TICKETS_QUERY = """
SELECT id, title, main_topic, overall_emotion
FROM `wanted-data.wanted_ml.zendesk_voc_classified`
WHERE DATE(event_create_time, 'Asia/Seoul')
      >= DATE_SUB(CURRENT_DATE('Asia/Seoul'), INTERVAL 7 DAY)
  AND category3 = @category3
ORDER BY
  CASE WHEN overall_emotion = '부정' THEN 0 ELSE 1 END,
  event_create_time DESC
LIMIT 3
"""


@dataclass(frozen=True)
class SurgeItem:
    level: str
    category1: str
    category2: str
    category3: str
    recent_7d: int
    baseline_daily_avg: float
    ratio: float
    z_score: float | None
    negative_ratio: float | None


def _bq_client() -> bigquery.Client:
    return bigquery.Client(project="wanted-data", location="asia-northeast3")


def fetch_surges(min_level: str = "WATCH") -> list[SurgeItem]:
    """Fetch SURGE (+ WATCH if min_level=WATCH) items from voc_surge_score view."""
    levels = ["SURGE", "WATCH"] if min_level == "WATCH" else ["SURGE"]
    client = _bq_client()
    job = client.query(
        SURGE_QUERY,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ArrayQueryParameter("levels", "STRING", levels)],
            maximum_bytes_billed=10 * 1024**3,
        ),
    )
    return [
        SurgeItem(
            level=row["surge_level"],
            category1=row["category1"],
            category2=row["category2"],
            category3=row["category3"],
            recent_7d=int(row["recent_7d"] or 0),
            baseline_daily_avg=float(row["baseline_daily_avg"] or 0),
            ratio=float(row["ratio"] or 0),
            z_score=float(row["z_score"]) if row["z_score"] is not None else None,
            negative_ratio=(
                float(row["recent_negative_ratio"])
                if row["recent_negative_ratio"] is not None
                else None
            ),
        )
        for row in job.result()
    ]


def fetch_sample_tickets(category3: str, limit: int = 3) -> list[dict[str, Any]]:
    client = _bq_client()
    job = client.query(
        SAMPLE_TICKETS_QUERY,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("category3", "STRING", category3)],
            maximum_bytes_billed=5 * 1024**3,
        ),
    )
    return [dict(row) for row in list(job.result())[:limit]]


def _emoji(level: str) -> str:
    return {"SURGE": ":rotating_light:", "WATCH": ":warning:"}.get(level, ":small_blue_diamond:")


def build_summary_blocks(surges: list[SurgeItem]) -> list[dict[str, Any]]:
    if not surges:
        return [
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": ":white_check_mark: 오늘 급증 카테고리 없음."},
            }
        ]

    header = {
        "type": "header",
        "text": {"type": "plain_text", "text": "일일 VOC 급증 감지 리포트"},
    }
    lines = []
    for s in surges:
        neg = f" (부정 {s.negative_ratio:.0%})" if s.negative_ratio and s.negative_ratio > 0 else ""
        lines.append(
            f"{_emoji(s.level)} *{s.category2} / {s.category3}* — "
            f"최근 7일 {s.recent_7d}건 (baseline {s.baseline_daily_avg:.1f}/일, "
            f"{s.ratio}x){neg}"
        )
    return [
        header,
        {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}},
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": (
                        ":bar_chart: <https://prj-frontend-<hash>.lab.wntd.co|"
                        "VOC Dashboard> · 상세 티켓은 스레드 참조"
                    ),
                }
            ],
        },
    ]


def build_thread_message(item: SurgeItem, tickets: list[dict[str, Any]]) -> str:
    lines = [f"*{item.category2} / {item.category3}* — 대표 티켓 {len(tickets)}건"]
    for t in tickets:
        emotion_mark = ":red_circle:" if t.get("overall_emotion") == "부정" else ":white_circle:"
        title = (t.get("title") or "(제목 없음)")[:80]
        topic = (t.get("main_topic") or "")[:80]
        lines.append(f"{emotion_mark} `{t['id']}` {title}")
        if topic:
            lines.append(f"    └ _{topic}_")
    return "\n".join(lines)


async def send_slack_summary(
    channel: str, blocks: list[dict[str, Any]]
) -> str | None:
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN not set")
    client = WebClient(token=token)
    try:
        resp = await anyio.to_thread.run_sync(
            lambda: client.chat_postMessage(channel=channel, blocks=blocks, text="일일 VOC 리포트")
        )
        return resp["ts"]
    except SlackApiError as e:
        logger.exception("Slack summary post failed: %s", e.response.get("error"))
        return None


async def post_thread_details(
    channel: str, thread_ts: str, surges: list[SurgeItem]
) -> None:
    token = os.environ.get("SLACK_BOT_TOKEN")
    if not token:
        return
    client = WebClient(token=token)
    for item in surges:
        try:
            tickets = await anyio.to_thread.run_sync(fetch_sample_tickets, item.category3)
        except Exception as e:
            logger.exception("Failed to fetch sample tickets for %s: %s", item.category3, e)
            continue
        if not tickets:
            continue
        text = build_thread_message(item, tickets)
        try:
            await anyio.to_thread.run_sync(
                lambda: client.chat_postMessage(channel=channel, thread_ts=thread_ts, text=text)
            )
        except SlackApiError as e:
            logger.exception("Slack thread post failed: %s", e.response.get("error"))


async def run_daily_voc_job(force_run: bool = False) -> dict[str, Any]:
    """Entry point for scheduled daily job."""
    channel = os.environ.get("VOC_SLACK_CHANNEL_DAILY", DEFAULT_CHANNEL)
    min_level = os.environ.get("VOC_DAILY_MIN_LEVEL", "WATCH")
    logger.info("run_daily_voc_job start, channel=%s, min_level=%s", channel, min_level)

    surges = await anyio.to_thread.run_sync(fetch_surges, min_level)
    if not surges and not force_run:
        logger.info("No surges detected; skipping Slack post")
        return {"status": "ok", "surges": 0, "posted": False}

    blocks = build_summary_blocks(surges)
    thread_ts = await send_slack_summary(channel, blocks)
    if thread_ts:
        await post_thread_details(channel, thread_ts, surges[:5])  # top 5 상세만
    return {"status": "ok", "surges": len(surges), "posted": bool(thread_ts)}
