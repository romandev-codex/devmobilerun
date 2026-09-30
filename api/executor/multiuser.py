"""Points the framework's per-user shell commands at the profile in the foreground.

Android keeps content providers and secure settings per user, and the
``content`` and ``settings`` shell commands address user 0 unless told
otherwise. The framework's Portal client never tells them otherwise, so on a
phone switched to another profile it would talk to the owner's Portal, whose
accessibility service is not running there: the Portal in the active profile
reports its socket server stopped and the run fails with "Portal is not
available". Wrapping ``AdbDevice.shell`` so those commands carry
``--user <foreground user>`` fixes every call site at once.
"""

from __future__ import annotations

import re
import time
from typing import Any

#: How long a foreground-user reading is trusted before ``am get-current-user`` is asked again.
CURRENT_USER_TTL_SECONDS = 5.0

_PATCHED = "_mobilerun_retargets_user"
#: Foreground user per serial, with the time the reading expires.
_current: dict[str, tuple[int, float]] = {}


def retarget(cmd: str | list | tuple, user_id: int) -> str | list:
    """Adds ``--user <id>`` to a ``content`` or ``settings`` command that lacks it.

    ``content`` takes the flag after its verb (``content query --user 10 --uri …``),
    ``settings`` before it (``settings --user 10 put secure …``). Other commands,
    commands that already name a user and user 0 (the default) are returned as is.
    """
    if user_id == 0:
        return cmd
    if isinstance(cmd, str):
        if "--user" in cmd:
            return cmd
        if re.match(r"\s*content\s+\w+", cmd):
            return re.sub(r"^(\s*content\s+\w+)", rf"\1 --user {user_id}", cmd, count=1)
        if re.match(r"\s*settings(\s|$)", cmd):
            return re.sub(r"^(\s*settings)", rf"\1 --user {user_id}", cmd, count=1)
        return cmd
    words = [str(w) for w in cmd]
    if not words or "--user" in words:
        return words
    if words[0] == "content" and len(words) > 1:
        return words[:2] + ["--user", str(user_id)] + words[2:]
    if words[0] == "settings":
        return words[:1] + ["--user", str(user_id)] + words[1:]
    return words


def _is_per_user(cmd: str | list | tuple) -> bool:
    first = cmd.split(None, 1)[0] if isinstance(cmd, str) and cmd.strip() else (cmd[0] if cmd else "")
    return first in ("content", "settings")


def note_current_user(serial: str, user_id: int) -> None:
    """Records which user is in the foreground; called after the executor switches users."""
    _current[serial] = (user_id, time.monotonic() + CURRENT_USER_TTL_SECONDS)


def forget(serial: str | None = None) -> None:
    """Drops the cached reading for one serial, or for all of them."""
    if serial is None:
        _current.clear()
    else:
        _current.pop(serial, None)


async def current_user(device: Any, shell: Any) -> int | None:
    """The foreground user of the device, read with ``am get-current-user`` and cached briefly."""
    serial = getattr(device, "serial", None) or ""
    cached = _current.get(serial)
    now = time.monotonic()
    if cached and cached[1] > now:
        return cached[0]
    raw = await shell(device, ["am", "get-current-user"])
    text = raw.strip() if isinstance(raw, str) else ""
    if not text.isdigit():
        return None
    user_id = int(text)
    _current[serial] = (user_id, now + CURRENT_USER_TTL_SECONDS)
    return user_id


def make_shell(original: Any) -> Any:
    """Wraps an ``AdbDevice.shell`` so per-user commands go to the foreground user."""

    async def shell(self: Any, cmdargs: str | list | tuple, *args: Any, **kwargs: Any) -> Any:
        if _is_per_user(cmdargs):
            user_id = await current_user(self, original)
            if user_id is not None:
                cmdargs = retarget(cmdargs, user_id)
        return await original(self, cmdargs, *args, **kwargs)

    setattr(shell, _PATCHED, True)
    shell.__wrapped__ = original
    return shell


def install() -> None:
    """Patches ``async_adbutils.AdbDevice.shell`` once for the whole process."""
    from async_adbutils import AdbDevice

    if getattr(AdbDevice.shell, _PATCHED, False):
        return
    AdbDevice.shell = make_shell(AdbDevice.shell)
