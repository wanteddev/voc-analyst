import asyncio
from unittest.mock import Mock

import pytest

from voc_analyst.slack import background


@pytest.mark.asyncio
async def test_handle_dm_message_bg(monkeypatch) -> None:
    async def fast_sleep(*_args, **_kwargs):
        return None

    monkeypatch.setattr(asyncio, "sleep", fast_sleep)

    mock_chat = Mock(return_value={"ok": True})
    monkeypatch.setattr(background.slack_client, "chat_postMessage", mock_chat)

    payload = {"user_id": "U1", "channel_id": "C1", "text": "hi", "ts": "123"}
    result = await background._handle_dm_message_bg(payload)

    assert result["status"] == "ok"
    assert mock_chat.call_count == 1
    mock_chat.assert_called_once_with(
        channel="C1",
        text="I processed your message: 'hi'",
        thread_ts="123",
    )


@pytest.mark.asyncio
async def test_process_background_task_unknown_type() -> None:
    result = await background.process_background_task(
        {"task_type": "nonexistent", "payload": {}}
    )
    assert result["status"] == "error"
    assert "Unknown task type" in result["message"]
