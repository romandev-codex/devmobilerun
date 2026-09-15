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


class Framework(Protocol):
    def version(self) -> str: ...

    def describe_config(self) -> ConfigSummary: ...


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
