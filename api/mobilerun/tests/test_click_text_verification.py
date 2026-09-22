"""``click``/``long_press`` refuse an index whose element is not the named one."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from mobilerun.agent.utils.actions import click, long_press
from mobilerun.tools.filters import ConciseFilter
from mobilerun.tools.formatters import IndexedFormatter
from mobilerun.tools.ui.provider import AndroidStateProvider


def node(class_name, bounds, **props):
    return {
        "className": class_name,
        "boundsInScreen": dict(
            zip(("left", "top", "right", "bottom"), bounds, strict=True)
        ),
        "windowId": 7,
        "drawingOrder": 1,
        "isVisibleToUser": True,
        "children": [],
        **props,
    }


def context():
    raw = {
        "a11y_tree": node(
            "android.widget.FrameLayout",
            (0, 0, 1000, 2000),
            children=[
                node("android.widget.Button", (0, 0, 800, 100), text="Search", isClickable=True),
                node("android.widget.ImageView", (0, 1500, 300, 1900),
                     resourceId="com.app:id/image_button", isClickable=True),
                node("android.widget.FrameLayout", (600, 1900, 800, 2000),
                     contentDescription="Search and explore", isClickable=True),
            ],
        ),
        "phone_state": {},
        "device_context": {"screen_bounds": {"width": 1000, "height": 2000}},
    }
    driver = SimpleNamespace(
        get_ui_tree=AsyncMock(return_value=raw),
        tap=AsyncMock(),
        swipe=AsyncMock(),
    )
    provider = AndroidStateProvider(driver, ConciseFilter(), IndexedFormatter())
    ui = asyncio.run(provider.get_state())
    return SimpleNamespace(ui=ui, driver=driver, state_provider=provider)


def index_of(ctx, label):
    return next(e["index"] for e in ctx.ui.elements if e["text"] == label)


def test_matching_text_taps():
    ctx = context()
    result = asyncio.run(click(index_of(ctx, "Search"), text="Search", ctx=ctx))
    assert result.success
    ctx.driver.tap.assert_awaited_once_with(400, 50)


def test_loose_match_in_either_direction():
    ctx = context()
    # "search" is contained in "search and explore"; "search bar" contains "search".
    assert asyncio.run(click(index_of(ctx, "Search and explore"), text="search", ctx=ctx)).success
    assert asyncio.run(click(index_of(ctx, "Search"), text="Search bar", ctx=ctx)).success


def test_off_by_one_is_refused_before_touching_the_device():
    ctx = context()
    wrong = index_of(ctx, "com.app:id/image_button")
    result = asyncio.run(click(wrong, text="Search", ctx=ctx))
    assert not result.success
    ctx.driver.tap.assert_not_awaited()
    assert f"index {wrong} is ImageView" in result.summary
    right = index_of(ctx, "Search")
    other = index_of(ctx, "Search and explore")
    assert f"{right} (Button ('Search'))" in result.summary
    assert f"{other} (FrameLayout ('Search and explore'))" in result.summary


def test_unknown_text_is_refused_with_a_hint():
    ctx = context()
    result = asyncio.run(click(index_of(ctx, "Search"), text="Profile", ctx=ctx))
    assert not result.success
    assert "No element in the current ui_state matches 'Profile'" in result.summary
    ctx.driver.tap.assert_not_awaited()


def test_missing_text_keeps_old_behaviour():
    ctx = context()
    assert asyncio.run(click(index_of(ctx, "com.app:id/image_button"), ctx=ctx)).success
    assert asyncio.run(click(index_of(ctx, "Search"), text="", ctx=ctx)).success
    assert ctx.driver.tap.await_count == 2


def test_missing_index_still_reports_the_usual_error():
    ctx = context()
    result = asyncio.run(click(99, text="Search", ctx=ctx))
    assert not result.success
    assert "No element found with index 99" in result.summary


@pytest.mark.parametrize("text,expected", [("Search", True), ("image_button", False)])
def test_long_press_is_verified_too(text, expected):
    ctx = context()
    result = asyncio.run(long_press(index_of(ctx, "Search"), text=text, ctx=ctx))
    assert result.success is expected
    assert ctx.driver.swipe.await_count == (1 if expected else 0)
