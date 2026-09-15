"""Tiny SSE parser for tests."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


@dataclass
class Sse:
    id: str | None
    event: str
    data: Any


def parse_sse(text: str) -> list[Sse]:
    events: list[Sse] = []
    for block in text.split("\n\n"):
        lines = [ln for ln in block.splitlines() if ln and not ln.startswith(":")]
        if not lines:
            continue
        fields: dict[str, str] = {}
        for ln in lines:
            key, _, value = ln.partition(":")
            fields[key] = value.lstrip()
        if "event" in fields:
            events.append(Sse(fields.get("id"), fields["event"], json.loads(fields.get("data", "null"))))
    return events
