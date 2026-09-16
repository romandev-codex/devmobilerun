"""History windowing for FastAgent.

Keeps the goal message plus the last N steps verbatim. Older steps are either
dropped or folded into a compact recap appended to the goal message, built
deterministically from the stored tool calls and results (no extra LLM call).
"""

import re

from llama_index.core.base.llms.types import ChatMessage, TextBlock

from mobilerun.agent.fast_agent.xml_parser import parse_tool_calls

_RESULT_RE = re.compile(
    r"<result>\s*<name>(.*?)</name>\s*<(output|error)>(.*?)</\2>\s*</result>",
    re.DOTALL,
)
_EXTERNAL_MSG_RE = re.compile(
    r"<external_user_message>\s*(.*?)\s*</external_user_message>", re.DOTALL
)

_THOUGHT_CHARS = 160
_VALUE_CHARS = 60
_OUTPUT_CHARS = 120


def _shorten(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _format_value(value) -> str:
    text = _shorten(value, _VALUE_CHARS)
    return f'"{text}"' if re.search(r"[\s,]", text) else text


def _format_call(name: str, parameters: dict) -> str:
    args = ", ".join(f"{key}={_format_value(v)}" for key, v in parameters.items())
    return f"{name}({args})"


def _summarize_step(
    step_number: int, assistant: ChatMessage, followups: list[ChatMessage]
) -> list[str]:
    thought, calls = parse_tool_calls(assistant.content or "")
    thought = re.sub(r"<add_memory.*?</add_memory>", "", thought, flags=re.DOTALL)
    line = f"{step_number}."
    if thought.strip():
        line += f" {_shorten(thought, _THOUGHT_CHARS)}"
    if calls:
        line += " → " + "; ".join(_format_call(c.name, c.parameters) for c in calls)

    lines = [line]
    for message in followups:
        content = message.content or ""
        for name, kind, output in _RESULT_RE.findall(content):
            status = "error" if kind == "error" else "ok"
            lines.append(f"   {name}: {status} — {_shorten(output, _OUTPUT_CHARS)}")
        # User corrections sent mid-run must survive trimming verbatim.
        for external in _EXTERNAL_MSG_RE.findall(content):
            lines.append(f"   USER MESSAGE: {external.strip()}")
    return lines


def _build_recap(dropped: list[ChatMessage]) -> str:
    lines: list[str] = []
    step_number = 0
    i = 0
    while i < len(dropped):
        message = dropped[i]
        i += 1
        if message.role != "assistant":
            continue
        followups = []
        while i < len(dropped) and dropped[i].role != "assistant":
            followups.append(dropped[i])
            i += 1
        step_number += 1
        lines.extend(_summarize_step(step_number, message, followups))

    return (
        "\n<earlier_steps_summary>\n"
        "Condensed log of your earlier steps (full details trimmed):\n"
        + "\n".join(lines)
        + "\n</earlier_steps_summary>\n"
    )


def window_history(
    messages: list[ChatMessage], keep_steps: int, summarize: bool = True
) -> list[ChatMessage]:
    """Return goal message + last ``keep_steps`` steps, optionally recapping the rest.

    A step starts at an assistant message and includes the user messages that
    follow it. ``keep_steps <= 0`` disables windowing. The input list is never
    mutated; when a recap is added the first message is replaced by a copy.
    """
    if keep_steps <= 0 or not messages:
        return messages

    assistant_indices = [i for i, m in enumerate(messages) if m.role == "assistant"]
    if len(assistant_indices) <= keep_steps:
        return messages

    # Tail starts at an assistant message so roles keep alternating after the goal.
    start = assistant_indices[-keep_steps]
    first, dropped, tail = messages[0], messages[1:start], messages[start:]

    if summarize and dropped:
        first = first.model_copy(deep=True)
        first.blocks.append(TextBlock(text=_build_recap(dropped)))

    return [first] + tail
