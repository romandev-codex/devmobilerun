"""TypeSafe's Jev as an alternative agent engine.

A Python port of droidrun/mobile-jev's agent: code discovers the candidate
operations on the current screen, Jev (one TypeSafe System One request per step)
selects the operation and its target, and code validates and executes it on the
local phone through adb and Portal. Portal returns the same UI state the
Mobilerun cloud ``ui-state`` endpoint does, so the observation logic is shared.
"""

from .run import JevAgentRun, jev_config

__all__ = ["JevAgentRun", "jev_config"]
