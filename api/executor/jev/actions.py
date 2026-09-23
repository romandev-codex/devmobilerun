"""The operations code offers Jev on a screen, and how each reads to a person."""

from __future__ import annotations

import json
from typing import Any

from .state import find_element


def _area(bounds: dict[str, Any]) -> float:
    return (bounds["right"] - bounds["left"]) * (bounds["bottom"] - bounds["top"])


def candidates_for(observation: dict[str, Any], texts: list[str] | None = None) -> dict[str, dict[str, Any]]:
    """Every action that can be executed from this observation, keyed by a stable id."""
    texts = texts or []
    actions: dict[str, dict[str, Any]] = {}
    elements = observation["elements"]
    for node in elements:
        if node["enabled"] and (node["clickable"] or node["editable"]):
            actions[f"tap_{node['id']}"] = {"type": "tap-element", "elementId": node["id"]}
    actions["back"] = {"type": "global", "name": "back"}
    actions["home"] = {"type": "global", "name": "home"}
    # Derive gestures from each scrollable region instead of assuming a full-screen list.
    scroll_bounds: set[str] = set()
    scrollable = [e for e in elements if e["enabled"] and e["scrollable"]]
    for node in scrollable:
        # Android often exposes a container and its nested list as separate scroll targets.
        # Prefer the list when it occupies most of the container, retaining small nested panes.
        if any(
            child["id"].startswith(node["id"] + ".") and _area(child["bounds"]) >= _area(node["bounds"]) * 0.7
            for child in scrollable
        ):
            continue
        key = json.dumps(node["bounds"], sort_keys=True)
        if key in scroll_bounds:
            continue
        scroll_bounds.add(key)
        b = node["bounds"]
        left, top, right, bottom = b["left"], b["top"], b["right"], b["bottom"]
        x, y = int((left + right) // 2), int((top + bottom) // 2)
        x1, x2 = int(left + (right - left) * 0.2), int(left + (right - left) * 0.8)
        y1, y2 = int(top + (bottom - top) * 0.2), int(top + (bottom - top) * 0.8)
        for name, (sx, sy, ex, ey) in {
            "down": (x, y2, x, y1),
            "up": (x, y1, x, y2),
            "right": (x2, y, x1, y),
            "left": (x1, y, x2, y),
        }.items():
            actions[f"scroll_{name}_{node['id']}"] = {
                "type": "swipe",
                "startX": sx,
                "startY": sy,
                "endX": ex,
                "endY": ey,
                "duration": 300,
                "regionId": node["id"],
            }
    phone = observation["phone"]
    if phone["isEditable"]:
        actions["enter"] = {"type": "key", "key": "enter"}
        focused_password = any(
            e["password"] and (e["focused"] or e["id"] == phone.get("inputElementId")) for e in elements
        )
        if not focused_password:
            for index, text in enumerate(texts):
                actions[f"text_{index}"] = {"type": "type", "text": text, "clear": True}
    return actions


def describe_action(action: dict[str, Any], observation: dict[str, Any]) -> str:
    kind = action.get("type")
    if kind == "open-app":
        return f"Open {action.get('appLabel') or action['packageName']}"
    if kind == "tap-element":
        element_id = action["elementId"]
        target = find_element(observation, element_id)
        if target and target["editable"]:
            name = target["hint"] or target["label"] or target["text"] or "empty input field"
            return f"Focus text input: {name}."
        labels: list[str] = []
        for e in observation["elements"]:
            if e["id"] == element_id or e["id"].startswith(element_id + "."):
                for value in (e["text"], e["label"]):
                    if value and value not in labels:
                        labels.append(value)
        return f"Tap {' / '.join(labels) or element_id}."
    if kind == "swipe":
        if action["startY"] > action["endY"]:
            direction = "down"
        elif action["startY"] < action["endY"]:
            direction = "up"
        elif action["startX"] > action["endX"]:
            direction = "right"
        else:
            direction = "left"
        return (
            f"Scroll {direction} to reveal content further {direction} in this scrollable region. "
            f"Gesture: {json.dumps(action, separators=(',', ':'))}"
        )
    if kind == "type":
        return f"Type \"{action['text']}\""
    if kind == "key":
        return f"Press {action['key']}"
    if kind == "global":
        return {"back": "Navigate back", "home": "Go to the home screen"}.get(action["name"], action["name"])
    return json.dumps(action, separators=(",", ":"))
