"""EventBridge scheduled job runner."""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


async def run_scheduled_job(event: dict[str, Any]) -> dict[str, Any]:
    """
    Handle EventBridge scheduled events.

    This function is called when the job Lambda receives an event from
    EventBridge Scheduler. Implement your scheduled job logic here.

    Args:
        event: The EventBridge event payload

    Returns:
        A dict with the job result status
    """
    logger.info(json.dumps({"event": "job_started", "payload": event}))

    from voc_analyst.jobs.voc_weekly import run_weekly_voc_job

    result = await run_weekly_voc_job()
    logger.info(json.dumps({"event": "job_completed", "result": result}))
    return result
