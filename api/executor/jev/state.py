"""Screen observations: summarizing Portal state, freshness and input checks.

An observation is a plain dict: ``deviceId``, ``phone``, ``screen``, a flat
``elements`` list whose ids are tree paths (``ui.0.3``), a ``fingerprint`` of
that content and ``observedAt`` (epoch milliseconds).
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from typing import Any

EDITABLE_CLASSES = frozenset(
    {
        "android.widget.EditText",
        "android.widget.AutoCompleteTextView",
        "android.widget.MultiAutoCompleteTextView",
    }
)


class StaleObservationError(Exception):
    """The screen changed between the decision and the action; nothing was sent."""

    def __init__(self, message: str = "Screen changed or observation expired; observe and decide again.") -> None:
        super().__init__(message)


def now_ms() -> float:
    return time.time() * 1000


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def summarize_state(raw: Any, device_id: str) -> dict[str, Any]:
    """Flattens Portal's raw state into the observation Jev decides on.

    Noninteractive text is kept: it is evidence for goal completion and gives
    controls their labels.
    """
    screen = raw.get("device_context", {}).get("screen_bounds") if isinstance(raw, dict) else None
    if (
        not isinstance(screen, dict)
        or not _is_int(screen.get("width"))
        or not _is_int(screen.get("height"))
        or screen["width"] < 1
        or screen["height"] < 1
        or not raw.get("phone_state")
        or not raw.get("a11y_tree")
    ):
        raise ValueError("UI state is missing its tree, phone state, or valid screen bounds.")
    width, height = screen["width"], screen["height"]
    elements: list[dict[str, Any]] = []

    def visit(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            return
        b = node.get("boundsInScreen")
        bounds = None
        if isinstance(b, dict) and all(_is_number(b.get(k)) for k in ("left", "top", "right", "bottom")):
            bounds = {
                "left": max(0, b["left"]),
                "top": max(0, b["top"]),
                "right": min(width, b["right"]),
                "bottom": min(height, b["bottom"]),
            }
        if (
            node.get("isVisibleToUser") is not False
            and bounds
            and bounds["right"] > bounds["left"]
            and bounds["bottom"] > bounds["top"]
        ):
            password = node.get("isPassword") is True
            text = "[password]" if password else (node.get("text") or "")
            label = "" if password else (node.get("contentDescription") or "")
            editable = node.get("isEditable") is True or node.get("className") in EDITABLE_CLASSES
            if text or label or node.get("isClickable") or editable or node.get("isScrollable"):
                elements.append(
                    {
                        "id": path,
                        "text": text,
                        "label": label,
                        "resourceId": node.get("resourceId") or "",
                        "hint": node.get("hint") or "",
                        "bounds": bounds,
                        "clickable": node.get("isClickable") is True,
                        "editable": editable,
                        "scrollable": node.get("isScrollable") is True,
                        "enabled": node.get("isEnabled") is not False,
                        "focused": node.get("isFocused") is True,
                        "password": password,
                        "checkable": node.get("isCheckable") is True,
                        "checked": node.get("isChecked") is True,
                        "selected": node.get("isSelected") is True,
                    }
                )
        children = node.get("children")
        if isinstance(children, list):
            for i, child in enumerate(children):
                visit(child, f"{path}.{i}")

    tree = raw["a11y_tree"]
    visit({"children": tree} if isinstance(tree, list) else tree, "ui")

    phone_state = raw["phone_state"]
    inputs = [e for e in elements if e["editable"] and e["enabled"]]
    focused_inputs = [e for e in inputs if e["focused"]]
    if len(focused_inputs) == 1:
        focused_input = focused_inputs[0]
    elif phone_state.get("keyboardVisible") and len(inputs) == 1:
        focused_input = inputs[0]
    else:
        focused_input = None
    focused_element = phone_state.get("focusedElement") or {}
    if phone_state.get("isEditable"):
        focus_evidence = "reported"
    elif focused_input and focused_input["focused"]:
        focus_evidence = "focused-node"
    elif focused_input:
        focus_evidence = "single-input-with-keyboard"
    else:
        focus_evidence = "none"
    phone: dict[str, Any] = {
        "packageName": phone_state.get("packageName") or "",
        "currentApp": phone_state.get("currentApp") or "",
        "isEditable": phone_state.get("isEditable") is True or focused_input is not None,
        "focusEvidence": focus_evidence,
        "keyboardVisible": phone_state.get("keyboardVisible") is True,
        "focusedElement": {
            "resourceId": (focused_element.get("resourceId") if isinstance(focused_element, dict) else "") or "",
            "className": (focused_element.get("className") if isinstance(focused_element, dict) else "") or "",
        },
    }
    if focused_input:
        phone["inputElementId"] = focused_input["id"]
    content = {"deviceId": device_id, "phone": phone, "screen": screen, "elements": elements}
    return {
        **content,
        "fingerprint": hashlib.sha256(_dumps(content).encode()).hexdigest(),
        "observedAt": now_ms(),
    }


def find_element(observation: dict[str, Any], element_id: str | None) -> dict[str, Any] | None:
    if element_id is None:
        return None
    return next((e for e in observation["elements"] if e["id"] == element_id), None)


def _target_meaning(observation: dict[str, Any], element_id: str) -> str | None:
    """What an element means, independent of where it is drawn."""
    target = find_element(observation, element_id)
    if target is None:
        return None
    meaning = {k: v for k, v in target.items() if k != "bounds"}
    prefix = element_id + "."
    meaning["content"] = [
        {k: e[k] for k in ("id", "text", "label", "resourceId", "editable", "enabled", "checked", "selected")}
        for e in observation["elements"]
        if e["id"].startswith(prefix)
    ]
    return _dumps(meaning)


def assert_fresh(
    current: dict[str, Any], expected: dict[str, Any] | None, action: dict[str, Any], max_age_ms: float = 30_000
) -> None:
    """Raises ``StaleObservationError`` when the action's target no longer means what Jev saw."""
    now = now_ms()
    if (
        not expected
        or current["deviceId"] != expected.get("deviceId")
        or not _is_number(expected.get("observedAt"))
        or now - expected["observedAt"] > max_age_ms
        or expected["observedAt"] > now
        or current["phone"]["packageName"] != expected.get("phone", {}).get("packageName")
        or _dumps(current["screen"]) != _dumps(expected.get("screen"))
    ):
        raise StaleObservationError()
    kind = action.get("type")
    input_id = expected["phone"].get("inputElementId")
    if kind == "tap-element":
        before = _target_meaning(expected, action["elementId"])
        fresh = before is not None and _target_meaning(current, action["elementId"]) == before
    elif kind in ("type", "clear", "key") and input_id:
        fresh = (
            current["phone"]["isEditable"]
            and current["phone"].get("inputElementId") == input_id
            and _target_meaning(current, input_id) == _target_meaning(expected, input_id)
        )
    elif kind == "global" and action.get("name") == "home":
        fresh = True  # HOME is independent of in-app content such as clocks and animations.
    elif kind == "global":

        def navigation_meaning(state: dict[str, Any]) -> str:
            return _dumps(
                {
                    "phone": state["phone"],
                    "controls": [
                        _target_meaning(state, e["id"])
                        for e in state["elements"]
                        if e["clickable"] or e["editable"]
                    ],
                    "headings": [
                        [e["id"], e["text"], e["label"]]
                        for e in state["elements"]
                        if e["resourceId"].endswith(":id/title") or e["label"]
                    ],
                }
            )

        fresh = navigation_meaning(current) == navigation_meaning(expected)
    elif kind == "swipe" and action.get("regionId"):
        before = find_element(expected, action["regionId"])
        after = find_element(current, action["regionId"])
        fresh = bool(
            before
            and after
            and after["enabled"]
            and after["scrollable"]
            and before["resourceId"] == after["resourceId"]
        )
    else:
        fresh = current["fingerprint"] == expected["fingerprint"]
    if not fresh:
        raise StaleObservationError()


# ── text input verification ──────────────────────────────────────────────


def prepare_input_verification(observation: dict[str, Any], action: dict[str, Any]) -> dict[str, Any] | None:
    """The exact value a replacing text input should leave in the focused field.

    Appends may insert at an unknown cursor position and password fields cannot
    be read back, so those are not verified.
    """
    if action.get("type") != "type" or action.get("clear") is not True:
        return None
    target = find_element(observation, observation["phone"].get("inputElementId"))
    if not target or not target["editable"] or not target["enabled"] or target["password"]:
        return None
    return {
        "deviceId": observation["deviceId"],
        "packageName": observation["phone"]["packageName"],
        "target": {
            "id": target["id"],
            "resourceId": target["resourceId"],
            "hint": target["hint"],
            "bounds": target["bounds"],
        },
        "text": action["text"],
    }


def input_matches(observation: dict[str, Any], verification: dict[str, Any]) -> bool:
    if (
        observation["deviceId"] != verification["deviceId"]
        or observation["phone"]["packageName"] != verification["packageName"]
    ):
        return False
    inputs = [e for e in observation["elements"] if e["editable"] and e["enabled"] and not e["password"]]
    target = verification["target"]
    if target["resourceId"]:
        candidates = [e for e in inputs if e["resourceId"] == target["resourceId"]]
        if len(candidates) > 1:
            candidates = [e for e in candidates if e["id"] == target["id"]]
    else:
        # No stable resource id: require the original tree position, hint and bounds.
        candidates = [
            e
            for e in inputs
            if e["id"] == target["id"] and e["hint"] == target["hint"] and e["bounds"] == target["bounds"]
        ]
    return len(candidates) == 1 and candidates[0]["text"] == verification["text"]
