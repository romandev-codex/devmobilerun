"""Detects the agent re-issuing the same tool call on the same screen.

A call is identified by tool name, arguments and a fingerprint of the screen it
was issued on, so legitimate repeats (scrolling, tapping "Follow" on different
profiles) never match: the screen differs each time.
"""

import hashlib
import json
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, Optional, Tuple

# Same call on the same screen this many times within the window -> warn.
REPEAT_WARN_AT = 3
# Look-back window, in tool calls.
REPEAT_WINDOW = 20
# The same call failing this many times in a row -> stop the run.
CONSECUTIVE_FAILURE_LIMIT = 6


@dataclass(frozen=True)
class RepeatVerdict:
    note: Optional[str] = None
    stop_reason: Optional[str] = None


def screen_fingerprint(formatted_state: Optional[str]) -> Optional[str]:
    """None when there is no UI text (screenshot-only mode): screens can't be told apart."""
    if not formatted_state:
        return None
    return hashlib.sha1(formatted_state.encode("utf-8")).hexdigest()


def _call_key(
    name: str, params: Dict[str, Any], screen: Optional[str]
) -> Tuple[str, str, Optional[str]]:
    try:
        args = json.dumps(params, sort_keys=True, default=str)
    except (TypeError, ValueError):
        args = repr(sorted(params.items()))
    return name, args, screen


class RepeatGuard:
    def __init__(self) -> None:
        self._recent: Deque[Tuple[str, str, Optional[str]]] = deque(
            maxlen=REPEAT_WINDOW
        )
        self._last_failed: Optional[Tuple[str, str]] = None
        self._consecutive_failures = 0

    def reset(self) -> None:
        self._recent.clear()
        self._last_failed = None
        self._consecutive_failures = 0

    def record(
        self, name: str, params: Dict[str, Any], screen: Optional[str], success: bool
    ) -> RepeatVerdict:
        key = _call_key(name, params, screen)
        self._recent.append(key)

        call = key[:2]
        if success:
            self._last_failed = None
            self._consecutive_failures = 0
        elif call == self._last_failed:
            self._consecutive_failures += 1
        else:
            self._last_failed = call
            self._consecutive_failures = 1

        if self._consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
            return RepeatVerdict(
                stop_reason=(
                    f"`{name}` failed {self._consecutive_failures} times in a row with "
                    "the same arguments; stopped to prevent a retry loop."
                )
            )

        if not success and self._consecutive_failures >= 2:
            return RepeatVerdict(
                note=(
                    f"This exact `{name}` call has now failed {self._consecutive_failures} "
                    "times in a row with the same arguments. Repeating it will fail again: "
                    "read the error, fix the arguments or use a different action. The run "
                    f"stops after {CONSECUTIVE_FAILURE_LIMIT} identical failures."
                )
            )

        if screen is None:
            return RepeatVerdict()
        repeats = sum(1 for k in self._recent if k == key)
        if repeats >= REPEAT_WARN_AT:
            return RepeatVerdict(
                note=(
                    f"You have made this exact `{name}` call on this exact screen "
                    f"{repeats} times recently and ended up back here each time. It is "
                    "not making progress: check what the target element really is in the "
                    "ui_state and choose a different element or approach."
                )
            )
        return RepeatVerdict()
