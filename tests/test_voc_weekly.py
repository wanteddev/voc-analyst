from datetime import date

from voc_analyst.jobs.voc_weekly import (
    VOCCounts,
    WeeklyVOC,
    _sanitize_text,
    build_no_change_blocks,
    build_slack_blocks,
    detect_changes,
    select_latest_two,
)

# --- select_latest_two ---


def test_select_latest_two_returns_none_if_less_than_two() -> None:
    single = WeeklyVOC(week_start=date(2025, 1, 6), week_end=date(2025, 1, 12), counts={})
    assert select_latest_two([single]) is None
    assert select_latest_two([]) is None


def test_select_latest_two_returns_last_two_sorted() -> None:
    w1 = WeeklyVOC(week_start=date(2025, 1, 6), week_end=date(2025, 1, 12), counts={})
    w2 = WeeklyVOC(week_start=date(2025, 1, 13), week_end=date(2025, 1, 19), counts={})
    w3 = WeeklyVOC(week_start=date(2025, 1, 20), week_end=date(2025, 1, 26), counts={})
    # Order shouldn't matter
    result = select_latest_two([w3, w1, w2])
    assert result is not None
    prev, last = result
    assert prev.week_start == date(2025, 1, 13)
    assert last.week_start == date(2025, 1, 20)


# --- detect_changes ---


def _make_weekly(start: date, counts: dict[str, tuple[int, int]]) -> WeeklyVOC:
    return WeeklyVOC(
        week_start=start,
        week_end=None,
        counts={k: VOCCounts(total=t, negative=n) for k, (t, n) in counts.items()},
    )


def test_detect_changes_critical_on_large_increase() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"Bug": (20, 5)})
    last = _make_weekly(date(2025, 1, 13), {"Bug": (30, 8)})  # +50%
    changes = detect_changes(prev, last)
    assert len(changes) == 1
    assert changes[0].severity == "critical"
    assert changes[0].delta == 10


def test_detect_changes_monitor_on_moderate_increase() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"UI": (10, 2)})
    last = _make_weekly(date(2025, 1, 13), {"UI": (13, 3)})  # +30%
    changes = detect_changes(prev, last)
    assert len(changes) == 1
    assert changes[0].severity in ("critical", "monitor")


def test_detect_changes_improved_on_decrease() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"Login": (20, 5)})
    last = _make_weekly(date(2025, 1, 13), {"Login": (10, 2)})  # -50%
    changes = detect_changes(prev, last)
    assert len(changes) == 1
    assert changes[0].severity == "improved"


def test_detect_changes_stable_excluded() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"Stable": (10, 2)})
    last = _make_weekly(date(2025, 1, 13), {"Stable": (10, 2)})  # no change
    changes = detect_changes(prev, last)
    assert len(changes) == 0


def test_detect_changes_new_label_small_count_stable() -> None:
    prev = _make_weekly(date(2025, 1, 6), {})
    last = _make_weekly(date(2025, 1, 13), {"NewCat": (3, 1)})
    changes = detect_changes(prev, last)
    # Small count should be stable
    assert len(changes) == 0


def test_detect_changes_negative_ratio_spike() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"Support": (25, 2)})   # 8% negative
    last = _make_weekly(date(2025, 1, 13), {"Support": (25, 10)})  # 40% negative, +32%p
    changes = detect_changes(prev, last)
    assert len(changes) == 1
    assert changes[0].severity == "critical"


# --- _sanitize_text ---


def test_sanitize_text_masks_email() -> None:
    assert "[EMAIL]" in _sanitize_text("contact user@example.com for help")


def test_sanitize_text_masks_phone() -> None:
    assert "[PHONE]" in _sanitize_text("call 010-1234-5678 now")


def test_sanitize_text_empty() -> None:
    assert _sanitize_text("") == ""
    assert _sanitize_text("   ") == ""


# --- build_slack_blocks ---


def test_build_slack_blocks_has_header_and_criteria() -> None:
    prev = _make_weekly(date(2025, 1, 6), {"Bug": (20, 5)})
    last = _make_weekly(date(2025, 1, 13), {"Bug": (30, 8)})
    changes = detect_changes(prev, last)
    blocks = build_slack_blocks(prev, last, changes)
    block_types = [b["type"] for b in blocks]
    assert "header" in block_types
    assert "actions" in block_types


def test_build_no_change_blocks() -> None:
    prev = _make_weekly(date(2025, 1, 6), {})
    last = _make_weekly(date(2025, 1, 13), {})
    blocks = build_no_change_blocks(prev, last)
    texts = " ".join(
        b.get("text", {}).get("text", "") for b in blocks if "text" in b
    )
    assert "변화가 없습니다" in texts
