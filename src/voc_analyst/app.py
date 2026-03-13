"""Litestar application entrypoint."""

import logging
from typing import Any

from litestar import Litestar, Request, Response, get, post
from slack_bolt.request import BoltRequest

from voc_analyst.slack.app import slack_app

logger = logging.getLogger(__name__)


@get("/")
async def health() -> dict[str, str]:
    """Basic health check endpoint."""
    return {"ok": "web"}


@get("/healthz")
async def healthz() -> dict[str, str]:
    """Lightweight health endpoint for load balancers."""
    return {"status": "healthy"}



@post("/events")
async def handle_event(data: dict[str, Any]) -> dict[str, Any]:
    """
    Handle EventBridge Scheduler payloads.

    This endpoint receives scheduled events from EventBridge and forwards them
    to the job runner. The Lambda Web Adapter routes requests to this endpoint
    when AWS_LWA_PASS_THROUGH_PATH is set to "/events".
    """
    from voc_analyst.jobs.runner import run_scheduled_job

    try:
        return await run_scheduled_job(data)
    except Exception as exc:
        logger.exception(f"Critical error in scheduled job handler: {exc}")
        raise



@post("/slack/events")
async def handle_slack_events(request: Request) -> Response:
    """
    Handle Slack events (slash commands, events API, interactions).

    This endpoint receives all Slack webhook requests and routes them
    to the appropriate handlers via slack_bolt.
    """


    try:
        body = await request.body()
        headers = {k: v for k, v in request.headers.items()}

        bolt_request = BoltRequest(body=body.decode(), headers=headers)
        bolt_response = slack_app.dispatch(bolt_request)

        # Convert bolt headers to simple dict (bolt uses dict[str, list[str]])
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
        logger.exception(f"Critical error in Slack events handler: {e}")
        # Return 200 to prevent Slack from retrying
        # Slack will retry 3xx/4xx/5xx responses, causing duplicate processing
        return Response(
            content="Internal error occurred",
            status_code=200,
            headers={"Content-Type": "text/plain"},
        )


@post("/slack/background")
async def handle_slack_background(data: dict[str, Any]) -> dict[str, Any]:
    """
    Handle background task processing for Slack.

    This endpoint is invoked asynchronously by the main handler
    for long-running tasks that exceed Slack's 3-second timeout.
    """
    from voc_analyst.slack.background import process_background_task

    return await process_background_task(data)


app = Litestar(
    route_handlers=[
        health,
        healthz,

        handle_event,

        handle_slack_events,
        handle_slack_background,
    ],
    debug=False,
)
