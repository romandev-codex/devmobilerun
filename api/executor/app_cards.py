"""Materialises app cards sent with a run into the on-disk layout the framework reads."""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any


def write_app_cards_dir(cards: list[dict[str, Any]]) -> Path | None:
    """Writes ``app_cards.json`` plus one markdown file per card into a temp dir.

    Each card needs ``packageName`` and ``content``; ``name`` is optional and only
    used for the file name. Returns None when there is nothing to write.
    """
    valid = [c for c in cards if c.get("packageName") and c.get("content")]
    if not valid:
        return None
    directory = Path(tempfile.mkdtemp(prefix="mobilerun-app-cards-"))
    mapping: dict[str, str] = {}
    for index, card in enumerate(valid):
        package = str(card["packageName"]).strip()
        slug = re.sub(r"[^a-z0-9]+", "-", str(card.get("name") or package).lower()).strip("-")
        filename = f"{index:02d}-{slug or 'card'}.md"
        (directory / filename).write_text(str(card["content"]), encoding="utf-8")
        mapping[package] = filename
    (directory / "app_cards.json").write_text(json.dumps(mapping, indent=2), encoding="utf-8")
    return directory
