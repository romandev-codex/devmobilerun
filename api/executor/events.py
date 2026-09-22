from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

TERMINAL_TYPES = frozenset({"result", "error", "cancelled"})


@dataclass(frozen=True)
class RunEvent:
    """A framework-agnostic event emitted while a run executes.

    Types: started, screenshot, thought, action, plan, log, memory, result, error, cancelled.
    """

    type: str
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def terminal(self) -> bool:
        return self.type in TERMINAL_TYPES
