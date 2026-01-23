"""Background task processor for Slack bot."""

import logging
import os
import traceback
from typing import Any

import httpx
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

logger = logging.getLogger(__name__)

slack_client = WebClient(token=os.environ.get("SLACK_BOT_TOKEN"))


async def send_error_response(
    response_url: str | None, channel_id: str | None, error_message: str
) -> None:
    """
    Send error message to user via response_url or Slack API.

    Args:
        response_url: Slack response URL (for slash commands)
        channel_id: Channel ID to send message to (fallback)
        error_message: User-friendly error message
    """
    try:
        if response_url:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    response_url,
                    json={
                        "response_type": "ephemeral",
                        "text": f":x: {error_message}",
                    },
                )
        elif channel_id:
            slack_client.chat_postMessage(
                channel=channel_id,
                text=f":x: {error_message}",
            )
    except Exception as e:
        logger.error(f"Failed to send error response: {e}")


async def process_background_task(event: dict[str, Any]) -> dict[str, Any]:
    """
    Process background tasks invoked from the main Slack handler.

    This function runs in a separate Lambda with longer timeout,
    allowing for complex processing without hitting Slack's 3-second limit.

    Args:
        event: Contains 'task_type' and 'payload' from the invoking Lambda

    Returns:
        Result of the background processing
    """
    task_type = event.get("task_type", "unknown")
    payload = event.get("payload", {})

    logger.info(f"Processing background task: {task_type}")

    handlers = {
        "slash_command": _handle_slash_command_bg,
        "dm_message": _handle_dm_message_bg,
        "voc_weekly_report": _handle_voc_weekly_report_bg,
    }

    handler = handlers.get(task_type)
    if not handler:
        logger.warning(f"Unknown task type: {task_type}")
        return {"status": "error", "message": f"Unknown task type: {task_type}"}

    try:
        return await handler(payload)
    except SlackApiError as e:
        error_msg = f"Slack API error: {e.response.get('error', 'unknown')}"
        logger.error(f"Background task {task_type} failed: {error_msg}")

        # Notify user of error
        await send_error_response(
            response_url=payload.get("response_url"),
            channel_id=payload.get("channel_id"),
            error_message="There was an error communicating with Slack. Please try again.",
        )
        return {"status": "error", "message": error_msg}

    except httpx.HTTPError as e:
        error_msg = f"HTTP error: {str(e)}"
        logger.error(f"Background task {task_type} failed: {error_msg}")

        await send_error_response(
            response_url=None,  # Can't use response_url if HTTP failed
            channel_id=payload.get("channel_id"),
            error_message="There was a network error. Please try again.",
        )
        return {"status": "error", "message": error_msg}

    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        logger.error(f"Background task {task_type} failed: {error_msg}\n{traceback.format_exc()}")

        await send_error_response(
            response_url=payload.get("response_url"),
            channel_id=payload.get("channel_id"),
            error_message="An unexpected error occurred. Please try again later.",
        )
        return {"status": "error", "message": error_msg}


async def _handle_slash_command_bg(payload: dict) -> dict[str, Any]:
    """
    Background handler for slash commands.

    Use response_url to send delayed responses to Slack.
    """
    command = payload.get("command", "")
    user_id = payload.get("user_id", "")
    text = payload.get("text", "")
    response_url = payload.get("response_url", "")

    logger.info(f"Background processing {command} from user {user_id}")

    # ==========================================================================
    # YOUR LONG-RUNNING LOGIC HERE
    # Example: API calls, database queries, ML inference, etc.
    # ==========================================================================
    import asyncio

    await asyncio.sleep(2)  # Simulate long processing
    result = f"Processed '{text}' successfully!"

    # Send response via response_url (works for up to 30 minutes after command)
    if response_url:
        async with httpx.AsyncClient() as client:
            await client.post(
                response_url,
                json={
                    "response_type": "in_channel",  # or "ephemeral" for private
                    "text": f":white_check_mark: {result}",
                },
            )

    return {"status": "ok", "result": result}


async def _handle_dm_message_bg(payload: dict) -> dict[str, Any]:
    """
    Background handler for direct messages.

    Use Slack Web API to send responses.
    """
    user_id = payload.get("user_id", "")
    channel_id = payload.get("channel_id", "")
    text = payload.get("text", "")
    thread_ts = payload.get("ts", "")

    logger.info(f"Background processing DM from user {user_id}: {text}")

    # ==========================================================================
    # YOUR LONG-RUNNING LOGIC HERE
    # ==========================================================================
    import asyncio

    await asyncio.sleep(2)  # Simulate long processing
    result = f"I processed your message: '{text}'"

    # Send response via Slack Web API
    try:
        slack_client.chat_postMessage(
            channel=channel_id,
            text=result,
            thread_ts=thread_ts,  # Reply in thread
        )
    except SlackApiError as e:
        logger.error(f"Failed to send Slack message: {e}")
        return {"status": "error", "message": str(e)}

    return {"status": "ok", "result": result}


async def _handle_voc_weekly_report_bg(payload: dict) -> dict[str, Any]:
    """
    Background handler for weekly VOC report triggered by mentions.
    """
    channel_id = payload.get("channel_id", "")
    thread_ts = payload.get("thread_ts", "")
    user_id = payload.get("user_id", "")

    logger.info(f"Background processing weekly VOC report for user {user_id}")

    from voc_analyst.jobs.voc_weekly import build_weekly_voc_report, _post_followups

    report = await build_weekly_voc_report(force_run=True)
    if report.get("status") != "ok":
        slack_client.chat_postMessage(
            channel=channel_id,
            text=":x: 주간 VOC 리포트를 생성하지 못했습니다.",
            thread_ts=thread_ts,
        )
        return report

    blocks = report.get("blocks", [])
    slack_client.chat_postMessage(
        channel=channel_id,
        text="Weekly VOC 변화",
        blocks=blocks if blocks else None,
        thread_ts=thread_ts,
    )
    await _post_followups(
        channel=channel_id,
        thread_ts=thread_ts,
        prev=report["prev"],
        last=report["last"],
        changes=report["changes_list"],
    )
    return {"status": "ok", "changes": report.get("changes", 0)}
