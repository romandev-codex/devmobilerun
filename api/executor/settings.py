from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """Runtime settings for the executor, read from the environment."""

    token: str
    host: str = "127.0.0.1"
    port: int = 8765

    @classmethod
    def from_env(cls) -> "Settings":
        token = os.environ.get("EXECUTOR_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "EXECUTOR_TOKEN is not set. The executor refuses to start without a shared token."
            )
        return cls(
            token=token,
            host=os.environ.get("EXECUTOR_HOST", "127.0.0.1"),
            port=int(os.environ.get("EXECUTOR_PORT", "8765")),
        )
