"""Migration v8: add the ``vision`` LLM profile.

The ``see_screen`` tool lets a text-only agent ask a vision model to look at
the current screen. It is registered only when a ``vision`` profile resolves to
an LLM, so existing configs need one. Clone the profile the action agent
already uses (fast_agent, then executor, then manager) so the provider and
credentials stay the ones the user already set up, at temperature 0.0 for a
deterministic description. Users whose action model has no vision support can
then point this one profile at a vision-capable model.
"""

from typing import Any, Dict

VERSION = 8

_SOURCE_PROFILE_PRIORITY = ("fast_agent", "executor", "manager")


def migrate(config: Dict[str, Any]) -> Dict[str, Any]:
    profiles = config.get("llm_profiles")
    if not isinstance(profiles, dict) or "vision" in profiles:
        return config

    source = None
    for name in _SOURCE_PROFILE_PRIORITY:
        candidate = profiles.get(name)
        if isinstance(candidate, dict):
            source = candidate
            break
    if source is None:
        return config

    vision = dict(source)
    vision["temperature"] = 0.0
    kwargs = vision.get("kwargs")
    vision["kwargs"] = dict(kwargs) if isinstance(kwargs, dict) else {}
    profiles["vision"] = vision

    return config
