"""Slack event and command handlers."""

import asyncio
import logging

from slack_bolt import Ack, BoltContext, Say

from voc_analyst.slack.app import slack_app
from voc_analyst.slack.background import process_background_task

logger = logging.getLogger(__name__)


class SlackBackgroundError(Exception):
    """Raised when background task fails."""

    pass


def invoke_background(task_type: str, payload: dict) -> None:
    """
    Dispatch a background Slack task to the in-process worker.

    Backyard 컨테이너 단일 프로세스로 이관됨. 기존 Lambda invoke 대체.
    현재 이벤트 루프에 fire-and-forget task로 스케줄.
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        # No running loop (rare, e.g. import time) — create task synchronously
        logger.warning("no event loop for invoke_background(%s)", task_type)
        return

    async def _run() -> None:
        try:
            await process_background_task({"task_type": task_type, "payload": payload})
        except Exception:
            logger.exception("background task %s failed", task_type)

    loop.create_task(_run())


# =============================================================================
# Slash Commands
# =============================================================================


@slack_app.command("/hello")
def handle_hello_command(ack: Ack, command: dict, say: Say) -> None:
    """
    Example slash command handler.

    For quick responses (< 3 seconds), respond directly.
    """
    ack()
    user_id = command["user_id"]
    say(f"Hello <@{user_id}>! :wave:")


@slack_app.command("/longtask")
def handle_long_task_command(ack: Ack, command: dict, say: Say, context: BoltContext) -> None:
    """
    Example slash command that triggers background processing.

    For long-running tasks, ack immediately and process in background Lambda.
    """
    # Immediately acknowledge to avoid 3-second timeout
    ack("Processing your request... :hourglass_flowing_sand:")

    try:
        # Invoke background Lambda for actual processing
        invoke_background(
            task_type="slash_command",
            payload={
                "command": "/longtask",
                "user_id": command["user_id"],
                "channel_id": command["channel_id"],
                "text": command.get("text", ""),
                "response_url": command["response_url"],
            },
        )
    except SlackBackgroundError as e:
        logger.error(f"Background task failed for /longtask: {e}")
        say(":x: Sorry, there was an error processing your request. Please try again later.")


# =============================================================================
# Event Handlers
# =============================================================================


@slack_app.event("app_mention")
def handle_app_mention(event: dict, say: Say, context: BoltContext) -> None:
    """
    Handle when the bot is mentioned in a channel.

    For quick responses, reply directly. For complex tasks, use background processing.
    """
    user_id = event["user"]
    channel_id = event.get("channel", "")
    thread_ts = event.get("ts", "")

    try:
        invoke_background(
            task_type="voc_weekly_report",
            payload={
                "user_id": user_id,
                "channel_id": channel_id,
                "thread_ts": thread_ts,
            },
        )
        say(":hourglass_flowing_sand: 주간 VOC 변화를 확인 중입니다.", thread_ts=thread_ts)
    except SlackBackgroundError as e:
        logger.error(f"Background task failed for mention from {user_id}: {e}")
        say(":x: 주간 VOC 리포트를 처리하지 못했습니다.", thread_ts=thread_ts)


@slack_app.event("message")
def handle_message(event: dict, context: BoltContext, say: Say) -> None:
    """
    Handle direct messages to the bot.

    Only processes DMs (im channel type). Ignores bot messages to prevent loops.
    """
    # Ignore bot messages and message subtypes (edits, deletes, etc.)
    if event.get("bot_id") or event.get("subtype"):
        return

    # Only respond to direct messages
    channel_type = event.get("channel_type", "")
    if channel_type != "im":
        return

    user_id = event["user"]
    text = event.get("text", "")

    try:
        # Example: Trigger background processing for DMs
        invoke_background(
            task_type="dm_message",
            payload={
                "user_id": user_id,
                "channel_id": event["channel"],
                "text": text,
                "ts": event["ts"],
            },
        )
        # Quick acknowledgment
        say("Got it! Processing your message... :robot_face:")

    except SlackBackgroundError as e:
        logger.error(f"Background task failed for DM from {user_id}: {e}")
        say(":x: Sorry, I couldn't process your message right now. Please try again later.")
