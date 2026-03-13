"""Weekly VOC change detection using BigQuery and Slack notification."""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import anyio
import boto3
import httpx
from google.cloud import bigquery  # type: ignore
from google.oauth2 import service_account
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

DEFAULT_TIMEZONE = "Asia/Seoul"
DEFAULT_SSM_CREDENTIALS_KEY = "/DATA/WWW/GOOGLE/SERVICE_CREDENTIALS"
DEFAULT_LAAS_PRESET_HASH = "90571f07e6b60e047620162ecc29b423dba8280aba60dba503aac082082ad0c4"
DEFAULT_LAAS_API_KEY_SSM_KEY = "/DATA/PIPELINE/API_KEY/OPENAI"
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")


@dataclass(frozen=True)
class WeeklyVOC:
    week_start: date
    week_end: date | None
    counts: dict[str, VOCCounts]


@dataclass(frozen=True)
class VOCCounts:
    total: int
    negative: int


@dataclass(frozen=True)
class VOCChange:
    label: str
    prev_count: int
    last_count: int
    delta: int
    pct_change: float | None
    prev_negative_ratio: float | None
    last_negative_ratio: float | None
    severity: str


def _coerce_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _build_bq_label(category1: Any, category2: Any, category3: Any) -> str:
    parts = [str(x).strip() for x in (category1, category2, category3) if x]
    return " / ".join(parts) if parts else "Uncategorized"


def _parse_label(label: str) -> tuple[str | None, str | None, str | None]:
    parts = [part.strip() for part in label.split(" / ")]
    while len(parts) < 3:
        parts.append(None)
    return parts[0] or None, parts[1] or None, parts[2] or None



def _resolve_timezone() -> ZoneInfo:
    return ZoneInfo(os.environ.get("VOC_TIMEZONE", DEFAULT_TIMEZONE))


def _is_monday_in_tz(now: datetime) -> bool:
    return now.weekday() == 0


def _force_run() -> bool:
    return os.environ.get("VOC_FORCE_RUN", "").strip().lower() in {"1", "true", "yes"}


def _fetch_ssm_parameter(name: str) -> str:
    ssm = boto3.client("ssm")
    resp = ssm.get_parameter(Name=name, WithDecryption=True)
    return resp["Parameter"]["Value"]


def _load_laas_api_key() -> str | None:
    api_key = os.environ.get("LAMBDA_LAAS_API_KEY") or os.environ.get("LAAS_API_KEY")
    if api_key:
        return api_key
    ssm_key = os.environ.get("LAMBDA_LAAS_API_KEY_SSM_KEY") or os.environ.get(
        "LAAS_API_KEY_SSM_KEY", DEFAULT_LAAS_API_KEY_SSM_KEY
    )
    try:
        return _fetch_ssm_parameter(ssm_key)
    except Exception as exc:  # pragma: no cover (defensive)
        logger.error("Failed to load LaaS API key from SSM", extra={"error": str(exc)})
        return None


def _load_google_credentials() -> dict[str, Any]:
    raw_json = os.environ.get("VOC_BIGQUERY_CREDENTIALS_JSON")
    if not raw_json:
        ssm_key = os.environ.get("VOC_GOOGLE_CREDENTIALS_SSM_KEY", DEFAULT_SSM_CREDENTIALS_KEY)
        raw_json = _fetch_ssm_parameter(ssm_key)
    return json.loads(raw_json)


def _build_bq_client() -> bigquery.Client:
    project = os.environ.get("VOC_BIGQUERY_PROJECT", "wanted-data")
    location = os.environ.get("VOC_BIGQUERY_LOCATION", "asia-northeast3")
    credentials_info = _load_google_credentials()
    credentials = service_account.Credentials.from_service_account_info(credentials_info)
    return bigquery.Client(project=project, credentials=credentials, location=location)


async def _read_bigquery_weekly() -> list[WeeklyVOC]:
    table = os.environ.get(
        "VOC_BIGQUERY_TABLE", "wanted-data.wanted_ml.zendesk_voc_classified"
    )
    start_date = os.environ.get("VOC_BIGQUERY_START_DATE", "2025-01-01")
    client = await anyio.to_thread.run_sync(_build_bq_client)

    sql = f"""
SELECT
  DATE(TIMESTAMP_TRUNC(event_create_time, WEEK(MONDAY))) AS week_start,
  DATE_ADD(DATE(TIMESTAMP_TRUNC(event_create_time, WEEK(MONDAY))), INTERVAL 6 DAY) AS week_end,
  category1,
  category2,
  category3,
  COUNT(*) AS total_count,
  COUNTIF(overall_emotion = '부정') AS negative_count
FROM `{table}`
WHERE event_create_time >= TIMESTAMP(@start_date)
GROUP BY 1, 2, 3, 4, 5
ORDER BY 1, 2, 3, 4, 5
"""

    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("start_date", "DATE", start_date),
        ]
    )

    def _fetch_rows() -> list[bigquery.table.Row]:
        query_job = client.query(sql, job_config=job_config)
        return list(query_job.result())

    rows = await anyio.to_thread.run_sync(_fetch_rows)

    weekly: dict[date, WeeklyVOC] = {}
    for row in rows:
        week_start = row["week_start"]
        week_end = row["week_end"]
        label = _build_bq_label(row["category1"], row["category2"], row["category3"])
        count = _coerce_int(row["total_count"])
        negative_count = _coerce_int(row["negative_count"])
        if week_start not in weekly:
            weekly[week_start] = WeeklyVOC(
                week_start=week_start, week_end=week_end, counts={}
            )
        weekly[week_start].counts[label] = VOCCounts(total=count, negative=negative_count)

    return list(weekly.values())


async def _read_bigquery_samples(
    *,
    week_start: date,
    week_end: date | None,
    label: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    table = os.environ.get(
        "VOC_BIGQUERY_TABLE", "wanted-data.wanted_ml.zendesk_voc_classified"
    )
    client = await anyio.to_thread.run_sync(_build_bq_client)

    category1, category2, category3 = _parse_label(label)
    sql = f"""
SELECT
  event_create_time,
  title,
  detail,
  overall_emotion,
  category1,
  category2,
  category3
FROM `{table}`
WHERE event_create_time >= TIMESTAMP(@week_start)
  AND event_create_time < TIMESTAMP(@week_end)
  AND (@category1 IS NULL OR category1 = @category1)
  AND (@category2 IS NULL OR category2 = @category2)
  AND (@category3 IS NULL OR category3 = @category3)
ORDER BY event_create_time DESC
LIMIT {limit}
"""
    if week_end is not None:
        week_end_value = week_end + timedelta(days=1)
    else:
        week_end_value = week_start + timedelta(days=7)
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("week_start", "DATE", str(week_start)),
            bigquery.ScalarQueryParameter("week_end", "DATE", str(week_end_value)),
            bigquery.ScalarQueryParameter("category1", "STRING", category1),
            bigquery.ScalarQueryParameter("category2", "STRING", category2),
            bigquery.ScalarQueryParameter("category3", "STRING", category3),
        ]
    )

    def _fetch_rows() -> list[bigquery.table.Row]:
        query_job = client.query(sql, job_config=job_config)
        return list(query_job.result())

    rows = await anyio.to_thread.run_sync(_fetch_rows)
    return [dict(row) for row in rows]


def select_latest_two(items: list[WeeklyVOC]) -> tuple[WeeklyVOC, WeeklyVOC] | None:
    if len(items) < 2:
        return None
    items_sorted = sorted(items, key=lambda item: item.week_start)
    return items_sorted[-2], items_sorted[-1]


def _negative_ratio(counts: VOCCounts) -> float | None:
    if counts.total <= 0:
        return None
    return counts.negative / counts.total


def _severity_for_change(
    *,
    prev: VOCCounts,
    last: VOCCounts,
    ratio_delta: float | None,
) -> str:
    if prev.total <= 0 and last.total <= 0:
        return "stable"
    baseline_total = max(prev.total, last.total)
    increased_30 = last.total >= prev.total * 1.3
    increased_20 = last.total >= prev.total * 1.2
    decreased_20 = last.total <= prev.total * 0.8
    ratio_increase_20 = ratio_delta is not None and ratio_delta >= 0.20
    ratio_increase_10 = ratio_delta is not None and ratio_delta >= 0.10
    if baseline_total >= 20 and (increased_30 or ratio_increase_20):
        return "critical"
    if baseline_total >= 10 and (increased_20 or ratio_increase_10):
        return "monitor"
    if baseline_total >= 10 and decreased_20:
        return "improved"
    return "stable"


def detect_changes(
    prev: WeeklyVOC,
    last: WeeklyVOC,
) -> list[VOCChange]:
    labels = set(prev.counts.keys()) | set(last.counts.keys())
    changes: list[VOCChange] = []
    for label in sorted(labels):
        prev_counts = prev.counts.get(label, VOCCounts(total=0, negative=0))
        last_counts = last.counts.get(label, VOCCounts(total=0, negative=0))
        prev_count = prev_counts.total
        last_count = last_counts.total
        delta = last_count - prev_count
        pct_change: float | None
        if prev_count == 0:
            pct_change = None
        else:
            pct_change = (delta / prev_count) * 100
        prev_ratio = _negative_ratio(prev_counts)
        last_ratio = _negative_ratio(last_counts)
        ratio_delta = None
        if prev_ratio is not None and last_ratio is not None:
            ratio_delta = last_ratio - prev_ratio
        severity = _severity_for_change(prev=prev_counts, last=last_counts, ratio_delta=ratio_delta)
        if severity == "stable":
            continue
        changes.append(
            VOCChange(
                label=label,
                prev_count=prev_count,
                last_count=last_count,
                delta=delta,
                pct_change=pct_change,
                prev_negative_ratio=prev_ratio,
                last_negative_ratio=last_ratio,
                severity=severity,
            )
        )
    return changes


def _format_change(change: VOCChange) -> str:
    direction = "↑" if change.delta > 0 else "↓"
    trend_emoji = "📈" if change.delta > 0 else "📉" if change.delta < 0 else "📊"
    if change.pct_change is None:
        pct_text = "new"
    else:
        pct_text = f"{change.pct_change:+.1f}%"
    ratio_emoji = "🙂"
    if change.prev_negative_ratio is not None and change.last_negative_ratio is not None:
        delta = (change.last_negative_ratio - change.prev_negative_ratio) * 100
        delta_text = "-" if round(delta, 1) == 0.0 else f"{delta:+.1f}p"
        if round(delta, 1) > 0:
            ratio_emoji = "😈"
        elif round(delta, 1) < 0:
            ratio_emoji = "😇"
        ratio_text = (
            f"{change.prev_negative_ratio*100:.1f}%→{change.last_negative_ratio*100:.1f}%"
            f" ({delta_text})"
        )
    else:
        ratio_text = "n/a"

    return (
        f"*{change.label}*\n"
        f"{trend_emoji} VOC 수: {change.prev_count} → {change.last_count} ({direction}{abs(change.delta)}) / {pct_text}\n"
        f"{ratio_emoji} 부정비율: {ratio_text}"
    )


def _format_week_range(week: WeeklyVOC) -> str:
    if week.week_end:
        return f"{week.week_start} ~ {week.week_end}"
    return f"{week.week_start}"


def build_slack_blocks(
    prev: WeeklyVOC,
    last: WeeklyVOC,
    changes: list[VOCChange],
) -> list[dict[str, Any]]:
    prev_range = _format_week_range(prev)
    last_range = _format_week_range(last)
    summary = {
        "CRITICAL": sum(1 for c in changes if c.severity == "critical"),
        "MONITOR": sum(1 for c in changes if c.severity == "monitor"),
        "IMPROVED": sum(1 for c in changes if c.severity == "improved"),
        "STABLE": sum(1 for c in changes if c.severity == "stable"),
    }
    severity_order = [
        ("critical", "🚨 CRITICAL"),
        ("monitor", "👀 MONITOR"),
        ("improved", "✅ IMPROVED"),
        ("stable", "ℹ️ STABLE"),
    ]
    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "Weekly VOC 변화"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"기간: 기준주 ({prev_range}) vs. 비교주 ({last_range})",
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": (
                        f"*CRITICAL* {summary['CRITICAL']}건  ·  "
                        f"*MONITOR* {summary['MONITOR']}건  ·  "
                        f"*IMPROVED* {summary['IMPROVED']}건  ·  "
                        f"STABLE {summary['STABLE']}건"
                    ),
                }
            ],
        },
    ]

    for severity_key, title in severity_order:
        if severity_key == "stable":
            continue
        group = [c for c in changes if c.severity == severity_key]
        if not group:
            continue
        blocks.append({"type": "divider"})
        blocks.append(
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*{title}*"},
            }
        )
        fields = [{"type": "mrkdwn", "text": _format_change(change)} for change in group]
        for i in range(0, len(fields), 2):
            blocks.append({"type": "section", "fields": fields[i : i + 2]})

    blocks.append({"type": "divider"})
    blocks.append(
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": (
                        "_라벨 판단 기준_\n"
                        "*CRITICAL* (증가≥30% 또는 부정비율+20%p) & 비교주 또는 기준주 VOC≥20\n"
                        "*MONITOR* (증가≥20% 또는 부정비율+10%p) & 비교주 또는 기준주 VOC≥10\n"
                        "*IMPROVED* 감소≥20% & 비교주 또는 기준주 VOC≥10"
                    ),
                }
            ],
        }
    )
    blocks.append({"type": "divider"})
    blocks.append(
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "루커 대시보드 보기"},
                    "url": "https://lookerstudio.google.com/reporting/b3e44002-ebca-4a6c-b127-3218219dff54",
                }
            ],
        }
    )

    return blocks


def build_no_change_blocks(prev: WeeklyVOC, last: WeeklyVOC) -> list[dict[str, Any]]:
    prev_range = _format_week_range(prev)
    last_range = _format_week_range(last)
    return [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "Weekly VOC 변화"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"기간: 기준주 ({prev_range}) vs. 비교주 ({last_range})",
            },
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "✅ 눈에 띄는 변화가 없습니다.",
            },
        },
    ]


async def send_slack_notification(
    channel: str, blocks: list[dict[str, Any]]
) -> str | None:
    slack_client = WebClient(token=os.environ.get("SLACK_BOT_TOKEN"))
    try:
        resp = slack_client.chat_postMessage(
            channel=channel,
            text="Weekly VOC 변화",
            blocks=blocks,
        )
        return resp.get("ts")
    except SlackApiError as exc:
        error_code = exc.response.get("error", "unknown")
        raise RuntimeError(f"Slack API error: {error_code}") from exc


def _build_laas_prompt(
    *,
    label: str,
    prev: WeeklyVOC,
    last: WeeklyVOC,
    change: VOCChange,
    prev_samples: list[dict[str, Any]],
    last_samples: list[dict[str, Any]],
) -> str:
    def _format_samples(samples: list[dict[str, Any]]) -> str:
        lines = []
        for sample in samples[:10]:
            title = _sanitize_text(sample.get("title") or "")
            detail = _sanitize_text(sample.get("detail") or "")
            emotion = sample.get("overall_emotion") or "unknown"
            if detail:
                lines.append(f"- ({emotion}) {title} | {detail[:200]}")
            else:
                lines.append(f"- ({emotion}) {title}")
        return "\n".join(lines) if lines else "- (샘플 없음)"

    prev_lines = _format_samples(prev_samples)
    last_lines = _format_samples(last_samples)

    prompt = f"""
너는 VOC 분석가다. 아래 변화 요약과 대표 VOC 샘플을 읽고, **실행 가능한 후속조치 중심**으로 한국어 요약을 작성하라.
다음 규칙을 반드시 지켜라:
- 개인정보(이메일, 전화번호, 실명 등)는 마스킹/제거한다.
- 샘플 원문은 요약/재작성하고, 그대로 길게 붙여넣지 않는다.
- 내용은 간결하고 구체적으로 쓴다. (모호한 “공유” 금지)
- 출력 형식은 아래 마크다운 섹션을 정확히 사용한다.
- 응답 첫 줄에 카테고리를 반드시 표기한다. (예: `카테고리: {label}`)

카테고리: {label}
*요약*
- 2~4줄

*대표 VOC 예시(요약)* 2~3개
- (감정) 요약 문장

*가능한 원인 가설* 1~3개
- 짧게

*후속 조치* 3~5개
- [우선순위][담당팀] 실행 항목 (기한/검증방법 포함)

[변화 요약]
카테고리: {label}
비교 기간: {prev.week_start}~{prev.week_end} → {last.week_start}~{last.week_end}
증감: {change.prev_count} → {change.last_count} ({change.delta:+d})
증감률: {change.pct_change if change.pct_change is not None else 'new'}
부정비율: {change.prev_negative_ratio} → {change.last_negative_ratio}
심각도: {change.severity}

[대표 VOC 샘플 - 비교 주]
{prev_lines}

[대표 VOC 샘플 - 기준 주]
{last_lines}
""".strip()
    return prompt


async def _call_laas(prompt: str) -> str:
    api_key = _load_laas_api_key()
    base_url = os.environ.get("LAMBDA_LAAS_BASE_URL") or os.environ.get(
        "LAAS_BASE_URL", "https://api-laas.wanted.co.kr"
    )
    preset_hash = os.environ.get("LAMBDA_LAAS_PRESET_HASH") or os.environ.get(
        "LAAS_PRESET_HASH", DEFAULT_LAAS_PRESET_HASH
    )
    if not api_key:
        raise RuntimeError("LaaS API key is missing (LAAS_API_KEY)")
    if not preset_hash:
        raise RuntimeError("LaaS preset hash is missing (LAAS_PRESET_HASH)")
    url = f"{base_url.rstrip('/')}/api/preset/v2/chat/completions"
    payload = {
        "hash": preset_hash,
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {
        "apiKey": api_key,
        "project": "WANTED_DATA",
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {api_key}",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError("LaaS response missing content")
        return content


def _sanitize_text(text: str) -> str:
    value = text.strip()
    if not value:
        return ""
    value = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[EMAIL]", value)
    value = re.sub(r"(\+?\d[\d\- ]{7,}\d)", "[PHONE]", value)
    value = re.sub(r"!\*\*\*.*?\*\*\*!", "", value)
    value = value.replace("-" * 30, "").replace("-" * 20, "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


async def _post_followups(
    *,
    channel: str,
    thread_ts: str,
    prev: WeeklyVOC,
    last: WeeklyVOC,
    changes: list[VOCChange],
) -> None:
    slack_client = WebClient(token=os.environ.get("SLACK_BOT_TOKEN"))
    followup_changes = [c for c in changes if c.severity in {"critical", "monitor"}]
    for change in followup_changes:
        prev_samples = await _read_bigquery_samples(
            week_start=prev.week_start,
            week_end=prev.week_end,
            label=change.label,
        )
        last_samples = await _read_bigquery_samples(
            week_start=last.week_start,
            week_end=last.week_end,
            label=change.label,
        )
        prompt = _build_laas_prompt(
            label=change.label,
            prev=prev,
            last=last,
            change=change,
            prev_samples=prev_samples,
            last_samples=last_samples,
        )
        try:
            llm_text = await _call_laas(prompt)
            slack_client.chat_postMessage(
                channel=channel,
                text=llm_text[:2900],
                thread_ts=thread_ts,
            )
        except Exception as exc:
            slack_client.chat_postMessage(
                channel=channel,
                text=f":x: LaaS follow-up failed: {exc}",
                thread_ts=thread_ts,
            )


async def build_weekly_voc_report(*, force_run: bool) -> dict[str, Any]:
    tz = _resolve_timezone()
    now = datetime.now(tz=tz)
    if not force_run and not _is_monday_in_tz(now):
        return {"status": "skipped", "reason": "not_monday"}

    weekly_items = await _read_bigquery_weekly()
    latest = select_latest_two(weekly_items)
    if latest is None:
        return {"status": "skipped", "reason": "insufficient_data"}

    prev, last = latest
    total_labels = len(set(prev.counts.keys()) | set(last.counts.keys()))
    changes = detect_changes(prev, last)
    logger.info(
        "weekly_voc.change_summary week_prev=%s week_last=%s total_labels=%s change_count=%s",
        prev.week_start,
        last.week_start,
        total_labels,
        len(changes),
    )
    if not changes:
        return {
            "status": "ok",
            "changes": 0,
            "blocks": build_no_change_blocks(prev, last),
            "prev": prev,
            "last": last,
            "changes_list": [],
        }

    blocks = build_slack_blocks(prev, last, changes)
    return {
        "status": "ok",
        "changes": len(changes),
        "blocks": blocks,
        "prev": prev,
        "last": last,
        "changes_list": changes,
    }


async def run_weekly_voc_job() -> dict[str, Any]:
    channel = os.environ.get("VOC_SLACK_CHANNEL") or os.environ.get(
        "LAMBDA_VOC_SLACK_CHANNEL", ""
    )
    if not channel:
        raise ValueError("VOC_SLACK_CHANNEL is required")

    report = await build_weekly_voc_report(force_run=_force_run())
    if report.get("status") != "ok":
        return report
    if report.get("changes", 0) == 0:
        return {"status": "ok", "changes": 0}

    blocks = report.get("blocks", [])
    thread_ts = await send_slack_notification(channel, blocks)
    if thread_ts:
        await _post_followups(
            channel=channel,
            thread_ts=thread_ts,
            prev=report["prev"],
            last=report["last"],
            changes=report["changes_list"],
        )
    return {"status": "ok", "changes": report.get("changes", 0)}
