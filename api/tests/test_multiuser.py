"""The per-user retargeting of ``content`` and ``settings`` shell commands."""

from __future__ import annotations

import pytest

from executor import multiuser
from executor.multiuser import make_shell, retarget

pytestmark = pytest.mark.anyio


def test_retarget_adds_the_user_where_each_command_expects_it():
    assert retarget("content query --uri content://x/state", 10) == (
        "content query --user 10 --uri content://x/state"
    )
    assert retarget(
        'content insert --uri "content://x/keyboard/input" --bind text:s:hi', 10
    ) == 'content insert --user 10 --uri "content://x/keyboard/input" --bind text:s:hi'
    assert retarget("settings put secure accessibility_enabled 1", 10) == (
        "settings --user 10 put secure accessibility_enabled 1"
    )
    assert retarget(["content", "query", "--uri", "content://x"], 11) == [
        "content", "query", "--user", "11", "--uri", "content://x",
    ]
    assert retarget(["settings", "get", "secure", "k"], 11) == [
        "settings", "--user", "11", "get", "secure", "k",
    ]


def test_retarget_leaves_other_commands_the_owner_and_explicit_users_alone():
    assert retarget("am start -a android.intent.action.VIEW", 10) == "am start -a android.intent.action.VIEW"
    assert retarget(["pm", "list", "packages"], 10) == ["pm", "list", "packages"]
    assert retarget("content query --uri content://x", 0) == "content query --uri content://x"
    assert retarget("settings --user 10 get secure k", 11) == "settings --user 10 get secure k"
    assert retarget(["content", "query", "--user", "3", "--uri", "u"], 11) == [
        "content", "query", "--user", "3", "--uri", "u",
    ]
    assert retarget("contents_of_something", 10) == "contents_of_something"


class FakeDevice:
    serial = "emulator-5554"


@pytest.fixture(autouse=True)
def clear_cache():
    multiuser.forget()
    yield
    multiuser.forget()


async def test_shell_wrapper_asks_the_foreground_user_once_and_retargets():
    calls: list[str | list] = []

    async def original(self, cmdargs, *args, **kwargs):
        calls.append(cmdargs)
        return "10\n" if cmdargs == ["am", "get-current-user"] else "ok"

    shell = make_shell(original)
    device = FakeDevice()
    assert await shell(device, "content query --uri content://x/state") == "ok"
    assert await shell(device, ["settings", "get", "secure", "k"], timeout=3) == "ok"
    assert await shell(device, "input keyevent 3") == "ok"
    assert calls == [
        ["am", "get-current-user"],
        "content query --user 10 --uri content://x/state",
        ["settings", "--user", "10", "get", "secure", "k"],
        "input keyevent 3",
    ]


async def test_shell_wrapper_trusts_a_noted_switch_and_skips_an_unreadable_user():
    calls: list[str | list] = []

    async def original(self, cmdargs, *args, **kwargs):
        calls.append(cmdargs)
        return "" if cmdargs == ["am", "get-current-user"] else "ok"

    shell = make_shell(original)
    device = FakeDevice()
    multiuser.note_current_user(device.serial, 12)
    await shell(device, "content query --uri content://x/state")
    assert calls == ["content query --user 12 --uri content://x/state"]

    multiuser.forget(device.serial)
    calls.clear()
    await shell(device, "content query --uri content://x/state")
    assert calls == [["am", "get-current-user"], "content query --uri content://x/state"]
