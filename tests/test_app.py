from litestar.testing import TestClient
from slack_bolt import BoltResponse
from slack_bolt.request import BoltRequest

from voc_analyst.app import app


def test_health_endpoints() -> None:
    with TestClient(app=app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert resp.json() == {"ok": "web"}

        resp = client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "healthy"}


def test_slack_events_dispatch(monkeypatch) -> None:
    seen: dict[str, object | None] = {"request": None}

    def fake_dispatch(request: BoltRequest) -> BoltResponse:
        seen["request"] = request
        return BoltResponse(status=200, body="ok", headers={"Content-Type": ["text/plain"]})

    monkeypatch.setattr("voc_analyst.app.slack_app.dispatch", fake_dispatch)

    with TestClient(app=app) as client:
        resp = client.post(
            "/slack/events",
            content=b'{"event_id":"evt-1"}',
            headers={"Content-Type": "application/json"},
        )

    assert resp.status_code == 200
    assert resp.text == "ok"
    assert isinstance(seen["request"], BoltRequest)
    assert seen["request"].body == {"event_id": "evt-1"}
