from llama_index.core.base.llms.types import ChatMessage

from mobilerun.agent.fast_agent.history import window_history


def _step(index: int, external: str | None = None) -> list[ChatMessage]:
    assistant = ChatMessage(
        role="assistant",
        content=(
            f"Step {index} thought.\n<add_memory>fact {index}</add_memory>\n"
            "<function_calls>\n"
            '<invoke name="click">\n'
            f'<parameter name="index">{index}</parameter>\n'
            "</invoke>\n"
            "</function_calls>"
        ),
    )
    result = (
        "<function_results>\n<result>\n<name>click</name>\n"
        f"<output>clicked {index}</output>\n</result>\n</function_results>"
    )
    if external:
        result += f"\n<external_user_message>\n{external}\n</external_user_message>"
    return [assistant, ChatMessage(role="user", content=result)]


def _history(steps: int, external_at: int | None = None) -> list[ChatMessage]:
    messages = [ChatMessage(role="user", content="Goal: do things")]
    for i in range(1, steps + 1):
        messages += _step(i, "only swipe up" if i == external_at else None)
    return messages


def test_short_history_is_returned_unchanged():
    messages = _history(3)
    assert window_history(messages, keep_steps=5) is messages


def test_zero_disables_windowing():
    messages = _history(30)
    assert window_history(messages, keep_steps=0) is messages


def test_keeps_goal_and_last_steps_starting_with_assistant():
    messages = _history(10)
    result = window_history(messages, keep_steps=3, summarize=False)

    assert len(result) == 1 + 3 * 2
    assert result[0] is messages[0]
    assert result[1].role == "assistant"
    assert "Step 8 thought." in result[1].content


def test_recap_summarizes_dropped_steps_without_mutating_input():
    messages = _history(10, external_at=2)
    result = window_history(messages, keep_steps=3)

    recap = result[0].content
    assert recap.startswith("Goal: do things")
    assert "<earlier_steps_summary>" in recap
    assert "1. Step 1 thought. → click(index=1)" in recap
    assert "click: ok — clicked 7" in recap
    assert "Step 8 thought" not in recap
    assert "USER MESSAGE: only swipe up" in recap
    assert "add_memory" not in recap
    assert messages[0].content == "Goal: do things"


def test_error_results_are_marked():
    messages = _history(3)
    messages[2] = ChatMessage(
        role="user",
        content="<function_results>\n<result>\n<name>click</name>\n"
        "<error>index out of range</error>\n</result>\n</function_results>",
    )
    recap = window_history(messages, keep_steps=1)[0].content
    assert "click: error — index out of range" in recap
