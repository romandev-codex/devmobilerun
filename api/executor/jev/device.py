"""Executes Jev's decisions on a local phone through adb and Portal.

Stands in for mobile-jev's Mobilerun cloud device: Portal provides the same UI
state, installed-app list and keyboard. Every action is checked against a fresh
observation first, so a decision made on a screen that has since changed is
rejected before any input reaches the phone.
"""

from __future__ import annotations

from typing import Any, Protocol

from .state import assert_fresh, find_element, prepare_input_verification, summarize_state

KEYS = {"back": 4, "tab": 61, "enter": 66, "delete": 67, "forward_delete": 112}
GLOBAL_BUTTONS = {"back", "home"}


class Driver(Protocol):
    """The subset of the framework's ``AndroidDriver`` the Jev device uses."""

    async def connect(self) -> None: ...

    async def get_ui_tree(self) -> dict[str, Any]: ...

    async def get_apps(self, include_system: bool = True) -> list[dict[str, str]]: ...

    async def screenshot(self, hide_overlay: bool = True) -> bytes: ...

    async def tap(self, x: int, y: int) -> None: ...

    async def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: float = 1000) -> None: ...

    async def input_text(self, text: str, clear: bool = False) -> bool: ...

    async def press_button(self, button: str) -> None: ...

    async def press_key_code(self, key_code: int) -> None: ...

    async def start_app(self, package: str, activity: str | None = None) -> str: ...

    async def stop_app(self, package: str) -> str: ...


def android_driver(serial: str) -> Driver:
    """The framework's adb driver with Portal required: Jev needs its full UI tree."""
    from mobilerun_core_local.driver.android import AndroidDriver

    return AndroidDriver(serial=serial, portal_mode="required")


class JevDevice:
    def __init__(self, driver: Driver, serial: str) -> None:
        self.driver = driver
        self.serial = serial
        self.installed_apps: list[dict[str, str]] = []

    async def connect(self) -> None:
        await self.driver.connect()

    async def list_apps(self) -> list[dict[str, str]]:
        apps = await self.driver.get_apps(include_system=True)
        self.installed_apps = [
            {"packageName": a["package"], "label": a["label"]}
            for a in apps
            if isinstance(a.get("package"), str) and a["package"] and isinstance(a.get("label"), str)
        ]
        return self.installed_apps

    async def observe(self) -> dict[str, Any]:
        return summarize_state(await self.driver.get_ui_tree(), self.serial)

    async def screenshot(self) -> bytes:
        return await self.driver.screenshot(hide_overlay=True)

    async def wake(self) -> None:
        """Presses HOME: turns a sleeping screen on and starts the task from the home screen."""
        await self.driver.press_button("home")

    async def close_app(self, package: str) -> None:
        """Force-stops an installed app, then shows the home screen."""
        if not any(a["packageName"] == package for a in self.installed_apps):
            raise ValueError("The app was not observed in the installed-app list.")
        await self.driver.stop_app(package)
        await self.driver.press_button("home")

    async def act(
        self, action: dict[str, Any], *, expected: dict[str, Any] | None = None, max_age_ms: float = 30_000
    ) -> dict[str, Any] | None:
        """Executes one action; returns an input verification for replacing text input."""
        kind = action.get("type")
        if kind == "open-app":
            package = action.get("packageName")
            if not any(a["packageName"] == package for a in self.installed_apps):
                raise ValueError("The app was not observed in the installed-app list.")
            if expected and expected["deviceId"] != self.serial:
                raise ValueError("Observation belongs to a different device.")
            await self.driver.start_app(package)
            return None

        current = await self.observe()
        if expected:
            assert_fresh(current, expected, action, max_age_ms)
        width, height = current["screen"]["width"], current["screen"]["height"]

        def point(x: Any, y: Any) -> None:
            for value, name in ((x, "x"), (y, "y")):
                if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                    raise ValueError(f"{name} must be an integer >= 0.")
            if x >= width or y >= height:
                raise ValueError("Coordinates are outside the screen.")

        if kind == "tap-element":
            if not expected:
                raise ValueError("Element taps require their original observation.")
            node = find_element(current, action["elementId"])
            if not node or not node["enabled"] or not (node["clickable"] or node["editable"]):
                raise ValueError("Element is not actionable.")
            b = node["bounds"]
            await self.driver.tap(int((b["left"] + b["right"]) // 2), int((b["top"] + b["bottom"]) // 2))
            return None
        if kind == "swipe":
            coords = [action["startX"], action["startY"], action["endX"], action["endY"]]
            duration = action.get("duration", 300)
            if action.get("regionId") and expected:
                before = find_element(expected, action["regionId"])
                after = find_element(current, action["regionId"])
                if not before or not after:
                    raise ValueError("Swipe region is gone.")
                bb, ab = before["bounds"], after["bounds"]

                # Resolve the same relative gesture in current geometry (e.g. a collapsing toolbar).
                def project(value: float, old_start: float, old_end: float, new_start: float, new_end: float) -> int:
                    span = old_end - old_start
                    fraction = (value - old_start) / span if span else -1
                    if not 0 <= fraction < 1:
                        raise ValueError("Swipe leaves its observed region.")
                    return int(new_start + fraction * (new_end - new_start))

                coords = [
                    project(coords[0], bb["left"], bb["right"], ab["left"], ab["right"]),
                    project(coords[1], bb["top"], bb["bottom"], ab["top"], ab["bottom"]),
                    project(coords[2], bb["left"], bb["right"], ab["left"], ab["right"]),
                    project(coords[3], bb["top"], bb["bottom"], ab["top"], ab["bottom"]),
                ]
            point(coords[0], coords[1])
            point(coords[2], coords[3])
            await self.driver.swipe(*coords, duration_ms=duration)
            return None
        if kind == "type":
            if not current["phone"]["isEditable"]:
                raise ValueError("Focus an editable field before typing.")
            if not isinstance(action.get("text"), str):
                raise ValueError("Text must be a string.")
            clear = action.get("clear", False) is True
            verification = prepare_input_verification(current, action)
            if not await self.driver.input_text(action["text"], clear=clear):
                raise RuntimeError("The phone did not accept the text input.")
            return {"inputVerification": verification} if verification else None
        if kind == "key":
            if action.get("key") not in KEYS:
                raise ValueError("Unsupported keyboard key.")
            await self.driver.press_key_code(KEYS[action["key"]])
            return None
        if kind == "global":
            if action.get("name") not in GLOBAL_BUTTONS:
                raise ValueError("Unsupported global action.")
            await self.driver.press_button(action["name"])
            return None
        raise ValueError("Unsupported action type.")
