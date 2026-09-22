"""Task memory: facts a run stores for the next runs of the same task.

The app owns the persistent copy and sends it with each run. During a run the
agent edits a working copy through the ``save_memory`` / ``delete_memory``
tools; every edit is queued as a ``memory`` run event so the app can persist it
as soon as it happens, not only when the run finishes.
"""

from __future__ import annotations

from typing import Any

from .events import RunEvent

MAX_KEY_LENGTH = 100
MAX_VALUE_LENGTH = 4000
MAX_ENTRIES = 200


class MemoryStore:
    """Working copy of a task's memory plus the queue of edits not yet streamed."""

    def __init__(self, entries: dict[str, str] | None = None) -> None:
        self.entries: dict[str, str] = dict(entries or {})
        self._pending: list[RunEvent] = []

    def set(self, key: str, value: str) -> str:
        key = _clean_key(key)
        value = str(value if value is not None else "").strip()
        if len(value) > MAX_VALUE_LENGTH:
            raise ValueError(f"Value is too long (max {MAX_VALUE_LENGTH} characters)")
        if key not in self.entries and len(self.entries) >= MAX_ENTRIES:
            raise ValueError(f"Memory is full ({MAX_ENTRIES} entries); delete something first")
        self.entries[key] = value
        self._pending.append(RunEvent("memory", {"op": "set", "key": key, "value": value}))
        return f"Saved memory '{key}'"

    def delete(self, key: str) -> str:
        key = _clean_key(key)
        if key not in self.entries:
            return f"Memory '{key}' does not exist; nothing deleted"
        del self.entries[key]
        self._pending.append(RunEvent("memory", {"op": "delete", "key": key}))
        return f"Deleted memory '{key}'"

    def drain(self) -> list[RunEvent]:
        """Returns the edits made since the last drain, oldest first."""
        events, self._pending = self._pending, []
        return events


def _clean_key(key: Any) -> str:
    key = str(key if key is not None else "").strip()
    if not key:
        raise ValueError("Memory key cannot be empty")
    if len(key) > MAX_KEY_LENGTH:
        raise ValueError(f"Memory key is too long (max {MAX_KEY_LENGTH} characters)")
    return key


def memory_tools(store: MemoryStore) -> dict[str, dict[str, Any]]:
    """Custom tools in the framework's ``{name: {parameters, description, function}}`` format."""

    def save_memory(key: str, value: str, **kwargs: Any) -> str:
        try:
            return store.set(key, value)
        except ValueError as exc:
            return f"Failed to save memory: {exc}"

    def delete_memory(key: str, **kwargs: Any) -> str:
        try:
            return store.delete(key)
        except ValueError as exc:
            return f"Failed to delete memory: {exc}"

    return {
        "save_memory": {
            "parameters": {
                "key": {
                    "type": "string",
                    "required": True,
                    "description": "Short identifier for the fact, e.g. last_processed_order_id",
                },
                "value": {
                    "type": "string",
                    "required": True,
                    "description": "The fact to keep. Overwrites any previous value for the key.",
                },
            },
            "description": (
                "Store a fact in the task's memory so future runs of this task can use it "
                "(it is shown to them under 'Memory from previous runs'). Use it for anything the "
                "next run needs: last processed item, ids, counters, discovered UI quirks, "
                "decisions the user should not be asked twice about."
            ),
            "function": save_memory,
        },
        "delete_memory": {
            "parameters": {
                "key": {
                    "type": "string",
                    "required": True,
                    "description": "Key of the memory entry to remove",
                },
            },
            "description": "Remove an entry from the task's memory when it is outdated or wrong.",
            "function": delete_memory,
        },
    }


def memory_section(entries: dict[str, str]) -> str:
    """The prompt block describing stored memory, or an empty string when there is none."""
    if not entries:
        return ""
    lines = [f"- {key}: {value}" for key, value in entries.items()]
    return (
        "Memory from previous runs of this task (update it with save_memory / delete_memory "
        "when you learn something the next run should know):\n" + "\n".join(lines)
    )
