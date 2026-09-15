"""Adapter boundary between the executor and the mobilerun framework.

Everything the executor needs from the framework goes through the ``Framework``
protocol so tests can substitute a scripted fake at the HTTP seam.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LlmProfile:
    role: str
    provider: str
    model: str


@dataclass(frozen=True)
class ConfigSummary:
    profiles: list[LlmProfile]
    config_path: str | None


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    state: str  # raw adb state: device | offline | unauthorized | ...
    model: str | None = None


class DeviceNotFound(Exception):
    """Raised when a serial is not in the adb device list."""


class Framework(Protocol):
    def version(self) -> str: ...

    def describe_config(self) -> ConfigSummary: ...

    async def list_devices(self) -> list[DeviceInfo]: ...

    async def screenshot(self, serial: str) -> bytes: ...


class MobilerunFramework:
    """Real adapter. Imports the framework lazily so importing the executor stays cheap."""

    def version(self) -> str:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("mobilerun")
        except PackageNotFoundError:
            return "unknown"

    def describe_config(self) -> ConfigSummary:
        import os

        from mobilerun.config_manager import ConfigLoader

        config = ConfigLoader.load()
        profiles = [
            LlmProfile(role=role, provider=profile.provider, model=profile.model)
            for role, profile in sorted(config.llm_profiles.items())
        ]
        env_path = os.environ.get("MOBILERUN_CONFIG")
        config_path = env_path if env_path else str(ConfigLoader.get_user_config_path())
        return ConfigSummary(profiles=profiles, config_path=config_path)

    async def list_devices(self) -> list[DeviceInfo]:
        from async_adbutils import adb

        infos = await adb.list()
        devices: list[DeviceInfo] = []
        for info in infos:
            model: str | None = None
            if info.state == "device":
                try:
                    device = await adb.device(serial=info.serial)
                    model = (await device.getprop("ro.product.model")).strip() or None
                except Exception:  # noqa: BLE001 - a flaky device must not break the listing
                    model = None
            devices.append(DeviceInfo(serial=info.serial, state=info.state, model=model))
        return devices

    async def screenshot(self, serial: str) -> bytes:
        from async_adbutils import adb

        infos = await adb.list()
        if not any(i.serial == serial and i.state == "device" for i in infos):
            raise DeviceNotFound(serial)
        device = await adb.device(serial=serial)
        return await device.screenshot_bytes()
