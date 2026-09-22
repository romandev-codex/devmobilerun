"""Action functions for device interaction.

Each function receives ``ctx: ActionContext`` as a keyword argument and
interacts with the device via ``ctx.driver``, resolves UI elements via
``ctx.ui``, and accesses shared state via ``ctx.shared_state``.
"""

import asyncio
import logging
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from mobilerun.agent.action_context import ActionContext

from llama_index.core.base.llms.types import ChatMessage, ImageBlock, TextBlock

from mobilerun.agent.action_result import ActionResult
from mobilerun.agent.oneflows.app_starter_workflow import AppStarter
from mobilerun.agent.utils.inference import acall_with_retries
from mobilerun.tools.ui.provider import (
    resize_model_screenshot_with_grid,
    should_resize_model_screenshot,
)

logger = logging.getLogger("mobilerun")

_MACRO_FOCUS_SETTLE_SECONDS = 0.5


# ---------------------------------------------------------------------------
# Core UI actions
# ---------------------------------------------------------------------------


def _uses_screenshot_only_coordinates(ctx: "ActionContext") -> bool:
    return bool(getattr(ctx.state_provider, "requires_coordinate_tools", False))


def _screenshot_only_coordinate_error(ctx: "ActionContext") -> str:
    width = getattr(ctx.ui, "screen_width", None)
    height = getattr(ctx.ui, "screen_height", None)
    if width and height:
        return (
            f"Coordinates must be inside the screenshot size {width}x{height} "
            "in screenshot-only mode. Observe the screenshot and retry with "
            "pixel coordinates inside the image."
        )
    return (
        "Coordinates must be inside the screenshot bounds in screenshot-only mode. "
        "Observe the screenshot and retry with pixel coordinates inside the image."
    )


def _validate_screenshot_only_point(
    x: int | float, y: int | float, *, ctx: "ActionContext"
) -> None:
    if not _uses_screenshot_only_coordinates(ctx):
        return
    try:
        width = float(ctx.ui.screen_width)
        height = float(ctx.ui.screen_height)
        px = float(x)
        py = float(y)
    except TypeError as exc:
        raise ValueError(_screenshot_only_coordinate_error(ctx)) from exc
    except ValueError as exc:
        raise ValueError(_screenshot_only_coordinate_error(ctx)) from exc

    out_of_range = (
        width <= 0 or height <= 0 or px < 0 or px >= width or py < 0 or py >= height
    )
    if out_of_range:
        raise ValueError(_screenshot_only_coordinate_error(ctx))


def _model_space_dimensions(ctx: "ActionContext") -> tuple[float, float] | None:
    """Return the (width, height) coordinate space the model was shown.

    Only applies when the provider declared a scaled coordinate contract
    (``resize_model_screenshot``) outside screenshot-only mode: the UIState
    keeps native screen dimensions while the model sees and answers in the
    ``native / coordinate_scale`` display space.
    """
    if _uses_screenshot_only_coordinates(ctx):
        return None
    # Read the contract state from the UIState snapshot the tap uses.
    if not getattr(ctx.ui, "coordinate_contract_active", False):
        return None
    if getattr(ctx.ui, "use_normalized", False):
        return None
    try:
        scale_x = float(ctx.ui.coordinate_scale_x)
        scale_y = float(ctx.ui.coordinate_scale_y)
        width = float(ctx.ui.screen_width) / scale_x
        height = float(ctx.ui.screen_height) / scale_y
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def _validate_model_space_point(
    x: int | float, y: int | float, *, ctx: "ActionContext"
) -> None:
    dims = _model_space_dimensions(ctx)
    if dims is None:
        return
    width, height = dims
    try:
        px = float(x)
        py = float(y)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Coordinates must be numbers inside the {round(width)}x{round(height)} "
            "coordinate space of the provided device state."
        ) from exc
    if px < 0 or px >= width or py < 0 or py >= height:
        raise ValueError(
            f"Coordinates ({x}, {y}) are outside the {round(width)}x{round(height)} "
            "coordinate space of the provided device state. Use the element "
            "bounds and screenshot shown to you and retry with coordinates "
            "inside that space."
        )


def _require_active_coordinate_contract(ctx: "ActionContext") -> None:
    """Reject coordinate actions when the provider requires the vision
    coordinate contract but it is not active for the current state.

    Some providers (e.g. iOS) can only map model coordinates to the tap input
    space while the contract is active. Without it, refuse the action so the
    model retries or uses an element-index ``click`` instead of tapping the
    wrong location."""
    provider = ctx.state_provider
    if not getattr(provider, "requires_active_contract_for_coords", False):
        return
    # Read the contract state from the UIState snapshot the tap uses, not a
    # mutable provider flag.
    if getattr(ctx.ui, "coordinate_contract_active", False):
        return
    raise ValueError(
        "Coordinate actions are unavailable for this step — the screen state "
        "could not be captured fully. Use an element index with `click`, or "
        "retry to get a fresh screen state."
    )


def _convert_action_point(
    x: int | float, y: int | float, *, ctx: "ActionContext"
) -> tuple[int, int]:
    _validate_screenshot_only_point(x, y, ctx=ctx)
    _require_active_coordinate_contract(ctx)
    _validate_model_space_point(x, y, ctx=ctx)
    abs_x, abs_y = ctx.ui.convert_point(x, y)
    return int(round(abs_x)), int(round(abs_y))


def _macro_recorder(ctx: "ActionContext"):
    return getattr(ctx, "macro_recorder", None)


def _record_macro_action(
    ctx: "ActionContext",
    action: dict,
    *,
    pre_ui=None,
) -> None:
    recorder = _macro_recorder(ctx)
    if recorder is None:
        return
    recorder.record_action(
        action,
        pre_ui=pre_ui if pre_ui is not None else getattr(ctx, "ui", None),
    )


async def _macro_pre_ui(ctx: "ActionContext"):
    if _macro_recorder(ctx) is None:
        return getattr(ctx, "ui", None)
    state_provider = getattr(ctx, "state_provider", None)
    if state_provider is None or not hasattr(state_provider, "get_state"):
        return getattr(ctx, "ui", None)
    try:
        return await state_provider.get_state()
    except Exception as e:
        logger.debug(f"Failed to refresh macro pre-state: {e}")
        return getattr(ctx, "ui", None)


async def _macro_pre_ui_after_focus_tap(ctx: "ActionContext"):
    if _macro_recorder(ctx) is not None:
        await asyncio.sleep(_MACRO_FOCUS_SETTLE_SECONDS)
    return await _macro_pre_ui(ctx)


def _driver_log_length(ctx: "ActionContext") -> int | None:
    log = getattr(getattr(ctx, "driver", None), "log", None)
    if isinstance(log, list):
        return len(log)
    return None


def _record_driver_log_delta(
    ctx: "ActionContext", before: int | None, *, pre_ui=None
) -> None:
    if before is None:
        return
    log = getattr(getattr(ctx, "driver", None), "log", None)
    if not isinstance(log, list):
        return
    for raw_action in log[before:]:
        _record_macro_action(ctx, dict(raw_action), pre_ui=pre_ui)


def _describe_element(element: dict) -> str:
    text = element.get("text") or ""
    resource_id = element.get("resourceId") or ""
    cls = element.get("className") or "?"
    label = f"'{text}'" if text else "no text"
    if resource_id and resource_id != text:
        label += f", id '{resource_id}'"
    return f"{cls} ({label})"


def _verify_target(ctx: "ActionContext", index: int, text: Optional[str]) -> Optional[str]:
    """Refuses an index whose element does not carry the text the model named.

    The model reads a numbered list and often names the right element while
    sending a neighbouring number. With the label the tap is checked before
    the device is touched; a mismatch returns the reason and the indices that
    do match, so the next call lands right. Returns None when the tap may go
    ahead: no text given, the state cannot verify, or the label matches.
    """
    if text is None or not str(text).strip():
        return None
    ui = getattr(ctx, "ui", None)
    if ui is None or not hasattr(ui, "label_matches"):
        return None
    matched = ui.label_matches(index, str(text))
    if matched is None or matched:
        return None  # a missing index fails later with the usual message
    element = ui.get_element(index) or {}
    candidates = ui.find_by_label(str(text))
    if candidates:
        listing = ", ".join(
            f"{c.get('index')} ({_describe_element(c)})" for c in candidates[:5]
        )
        hint = f"Elements matching '{text}': {listing}."
    else:
        hint = f"No element in the current ui_state matches '{text}'."
    return (
        f"Refused: index {index} is {_describe_element(element)}, "
        f"not '{text}'. {hint} Re-read the ui_state and call again with the "
        "index whose line carries that text."
    )


async def click(
    index: int, text: Optional[str] = None, *, ctx: "ActionContext"
) -> ActionResult:
    """Click the element with the given index.

    ``text`` is the label of the intended element as it appears in the
    ui_state; when given, the tap is refused if the index does not carry it.
    """
    try:
        refusal = _verify_target(ctx, index, text)
        if refusal:
            return ActionResult(success=False, summary=refusal)
        pre_ui = await _macro_pre_ui(ctx)
        x, y = ctx.ui.get_element_coords(index)
        await ctx.driver.tap(x, y)
        _record_macro_action(
            ctx,
            {"action_type": "tap", "x": x, "y": y},
            pre_ui=pre_ui,
        )

        info = ctx.ui.get_element_info(index)
        detail_parts = [
            f"Text: '{info.get('text', 'No text')}'",
            f"Class: {info.get('className', 'Unknown class')}",
            f"Type: {info.get('type', 'unknown')}",
        ]
        if info.get("child_texts"):
            detail_parts.append(f"Contains text: {' | '.join(info['child_texts'])}")
        detail_parts.append(f"Coordinates: ({x}, {y})")

        return ActionResult(
            success=True, summary=f"Clicked on {' | '.join(detail_parts)}"
        )
    except ValueError as e:
        return ActionResult(
            success=False, summary=f"Failed to click element at index {index}: {e}"
        )


async def long_press(
    index: int, text: Optional[str] = None, *, ctx: "ActionContext"
) -> ActionResult:
    """Long press the element with the given index (``text`` as in ``click``)."""
    try:
        refusal = _verify_target(ctx, index, text)
        if refusal:
            return ActionResult(success=False, summary=refusal)
        pre_ui = await _macro_pre_ui(ctx)
        x, y = ctx.ui.get_element_coords(index)
        await ctx.driver.swipe(x, y, x, y, 1000)
        _record_macro_action(
            ctx,
            {
                "action_type": "swipe",
                "start_x": x,
                "start_y": y,
                "end_x": x,
                "end_y": y,
                "duration_ms": 1000,
            },
            pre_ui=pre_ui,
        )
        return ActionResult(
            success=True, summary=f"Long pressed element at index {index} at ({x}, {y})"
        )
    except ValueError as e:
        return ActionResult(
            success=False, summary=f"Failed to long press element at index {index}: {e}"
        )


async def long_press_at(x: int, y: int, *, ctx: "ActionContext") -> ActionResult:
    """Long press at screen coordinates."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        abs_x, abs_y = _convert_action_point(x, y, ctx=ctx)
        await ctx.driver.swipe(abs_x, abs_y, abs_x, abs_y, 1000)
        _record_macro_action(
            ctx,
            {
                "action_type": "swipe",
                "start_x": abs_x,
                "start_y": abs_y,
                "end_x": abs_x,
                "end_y": abs_y,
                "duration_ms": 1000,
            },
            pre_ui=pre_ui,
        )
        return ActionResult(success=True, summary=f"Long pressed at ({abs_x}, {abs_y})")
    except Exception as e:
        return ActionResult(
            success=False, summary=f"Failed to long press at ({x}, {y}): {e}"
        )


async def click_at(x: int, y: int, *, ctx: "ActionContext") -> ActionResult:
    """Click at screen coordinates."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        abs_x, abs_y = _convert_action_point(x, y, ctx=ctx)
        await ctx.driver.tap(abs_x, abs_y)
        _record_macro_action(
            ctx,
            {"action_type": "tap", "x": abs_x, "y": abs_y},
            pre_ui=pre_ui,
        )
        return ActionResult(success=True, summary=f"Tapped at ({abs_x}, {abs_y})")
    except Exception as e:
        return ActionResult(success=False, summary=f"Failed to tap at ({x}, {y}): {e}")


async def click_area(
    x1: int, y1: int, x2: int, y2: int, *, ctx: "ActionContext"
) -> ActionResult:
    """Click center of area."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        _validate_screenshot_only_point(x1, y1, ctx=ctx)
        _validate_screenshot_only_point(x2, y2, ctx=ctx)
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        abs_x, abs_y = _convert_action_point(cx, cy, ctx=ctx)
        await ctx.driver.tap(abs_x, abs_y)
        _record_macro_action(
            ctx,
            {"action_type": "tap", "x": abs_x, "y": abs_y},
            pre_ui=pre_ui,
        )
        return ActionResult(
            success=True, summary=f"Tapped center of area at ({abs_x}, {abs_y})"
        )
    except Exception as e:
        return ActionResult(success=False, summary=f"Failed to tap area center: {e}")


async def type_text(
    text: str, index: int | None = None, clear: bool = False, *, ctx: "ActionContext"
) -> ActionResult:
    """Type text into an indexed element or the currently focused input."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        if index is not None and index != -1:
            x, y = ctx.ui.get_element_coords(index)
            await ctx.driver.tap(x, y)
            _record_macro_action(
                ctx,
                {"action_type": "tap", "x": x, "y": y},
                pre_ui=pre_ui,
            )
            pre_ui = await _macro_pre_ui_after_focus_tap(ctx)

        success = await ctx.driver.input_text(text, clear)
        if success:
            _record_macro_action(
                ctx,
                {"action_type": "input_text", "text": text, "clear": clear},
                pre_ui=pre_ui,
            )
            return ActionResult(
                success=True, summary=f"Text typed successfully (clear={clear})"
            )
        else:
            return ActionResult(
                success=False, summary="Failed to type text: input failed"
            )
    except Exception as e:
        return ActionResult(success=False, summary=f"Failed to type text: {e}")


async def type_text_direct(
    text: str, clear: bool = False, *, ctx: "ActionContext"
) -> ActionResult:
    """Type text into the currently focused input."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        success = await ctx.driver.input_text(text, clear)
        if success:
            _record_macro_action(
                ctx,
                {"action_type": "input_text", "text": text, "clear": clear},
                pre_ui=pre_ui,
            )
            return ActionResult(
                success=True, summary=f"Text typed successfully (clear={clear})"
            )
        return ActionResult(success=False, summary="Failed to type text: input failed")
    except Exception as e:
        return ActionResult(success=False, summary=f"Failed to type text: {e}")


_ENTER_KEY_CODE = 66


def _unwrap_driver(driver):
    """Follow wrapper drivers (Recording, Stealth) down to the concrete driver."""
    seen = set()
    while id(driver) not in seen and "inner" in getattr(driver, "__dict__", {}):
        seen.add(id(driver))
        driver = driver.__dict__["inner"]
    return driver


async def _press_key_via_portal_keyboard(driver, key_code: int) -> bool:
    """Send a key through the Mobilerun (Portal) keyboard instead of ADB keyevent.

    Tries the Portal HTTP endpoint first, then the content provider.
    Returns False when the Portal keyboard is not usable so callers can fall back.
    """
    base = _unwrap_driver(driver)
    portal = getattr(base, "portal", None)
    if portal is None or not getattr(base, "_portal_keyboard_available", False):
        return False

    if getattr(portal, "tcp_available", False) and portal.tcp_base_url:
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await portal._tcp_request(
                    client,
                    "POST",
                    f"{portal.tcp_base_url}/keyboard/key",
                    extra_headers={"Content-Type": "application/json"},
                    json={"key_code": int(key_code)},
                    timeout=10,
                )
            if response.status_code == 200:
                return True
            logger.debug(f"Portal TCP keyboard/key failed ({response.status_code})")
        except Exception as e:
            logger.debug(f"Portal TCP keyboard/key error: {e}")

    try:
        from mobilerun_core_local.driver.android.portal import (
            PORTAL_PACKAGE_NAME,
            portal_content_uri,
        )

        output = await base.device.shell(
            f'content insert --uri "{portal_content_uri(PORTAL_PACKAGE_NAME, "keyboard/key")}" '
            f"--bind key_code:i:{int(key_code)}"
        )
        if "Error" in str(output) or "Exception" in str(output):
            logger.debug(f"Portal content provider keyboard/key failed: {output}")
            return False
        return True
    except Exception as e:
        logger.debug(f"Portal content provider keyboard/key error: {e}")
        return False


async def system_button(button: str, *, ctx: "ActionContext") -> ActionResult:
    """Press a system button (back, home, or enter)."""
    try:
        pre_ui = await _macro_pre_ui(ctx)
        if button.lower() == "enter" and await _press_key_via_portal_keyboard(
            ctx.driver, _ENTER_KEY_CODE
        ):
            pass
        else:
            await ctx.driver.press_button(button)
        _record_macro_action(
            ctx,
            {"action_type": "button_press", "button": button},
            pre_ui=pre_ui,
        )
        return ActionResult(success=True, summary=f"Pressed {button.upper()} button")
    except ValueError as e:
        return ActionResult(success=False, summary=str(e))
    except Exception as e:
        return ActionResult(
            success=False,
            summary=f"Failed to press {button} button: {e.__class__.__name__}: {e}",
        )


async def swipe(
    coordinate: List[int],
    coordinate2: List[int],
    duration: float = 1.0,
    *,
    ctx: "ActionContext",
) -> ActionResult:
    """Swipe from one coordinate to another."""
    if not isinstance(coordinate, list) or len(coordinate) != 2:
        return ActionResult(
            success=False,
            summary=f"Failed: coordinate must be a list of 2 integers, got: {coordinate}",
        )
    if not isinstance(coordinate2, list) or len(coordinate2) != 2:
        return ActionResult(
            success=False,
            summary=f"Failed: coordinate2 must be a list of 2 integers, got: {coordinate2}",
        )

    try:
        pre_ui = await _macro_pre_ui(ctx)
        start_x, start_y = _convert_action_point(*coordinate, ctx=ctx)
        end_x, end_y = _convert_action_point(*coordinate2, ctx=ctx)
        duration_ms = int(duration * 1000)
        await ctx.driver.swipe(start_x, start_y, end_x, end_y, duration_ms=duration_ms)
        _record_macro_action(
            ctx,
            {
                "action_type": "swipe",
                "start_x": start_x,
                "start_y": start_y,
                "end_x": end_x,
                "end_y": end_y,
                "duration_ms": duration_ms,
            },
            pre_ui=pre_ui,
        )
        return ActionResult(
            success=True,
            summary=f"Swiped from ({start_x}, {start_y}) to ({end_x}, {end_y})",
        )
    except Exception as e:
        return ActionResult(success=False, summary=f"Failed to swipe: {e}")


async def open_app(text: str, *, ctx: "ActionContext") -> ActionResult:
    """Open an app by its name."""
    if ctx.app_opener_llm is None:
        return ActionResult(
            success=False,
            summary="Failed: app_opener_llm not configured.",
        )

    workflow = AppStarter(
        driver=ctx.driver,
        llm=ctx.app_opener_llm,
        timeout=60,
        stream=ctx.streaming,
        verbose=False,
    )

    pre_ui = await _macro_pre_ui(ctx)
    driver_log_before = _driver_log_length(ctx)
    result = await workflow.run(app_description=text)
    await asyncio.sleep(1)

    if isinstance(result, str) and "could not open app" in result.lower():
        return ActionResult(success=False, summary=result)
    _record_driver_log_delta(ctx, driver_log_before, pre_ui=pre_ui)
    return ActionResult(success=True, summary=str(result))


async def open_bundle_id(
    bundle_id: str | None = None,
    app_id: str | None = None,
    *,
    ctx: "ActionContext",
) -> ActionResult:
    """Open an app by exact package name, app id, or iOS bundle identifier."""
    identifier = app_id or bundle_id
    if not identifier:
        return ActionResult(
            success=False,
            summary="Failed to open app: exact app identifier is required.",
        )

    hint = (
        "Maybe you got the wrong app identifier. You could try using swipes and "
        "search to find the app."
    )
    try:
        pre_ui = await _macro_pre_ui(ctx)
        result = await ctx.driver.start_app(identifier)
        await asyncio.sleep(1)
        if isinstance(result, str) and result.lower().startswith("failed"):
            return ActionResult(
                success=False,
                summary=f"Failed to open app '{identifier}': {result}\n{hint}",
            )
        _record_macro_action(
            ctx,
            {"action_type": "start_app", "package": identifier, "activity": None},
            pre_ui=pre_ui,
        )
        return ActionResult(success=True, summary=str(result))
    except Exception as e:
        return ActionResult(
            success=False,
            summary=f"Failed to open app '{identifier}': {e.__class__.__name__}: {e}\n{hint}",
        )


MAX_WAIT_SECONDS = 30.0


async def wait(duration: float = 1.0, *, ctx: "ActionContext") -> ActionResult:
    """Wait for a specified duration in seconds (at most ``MAX_WAIT_SECONDS``)."""
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        duration = 1.0
    duration = min(max(duration, 0.0), MAX_WAIT_SECONDS)
    pre_ui = await _macro_pre_ui(ctx)
    await asyncio.sleep(duration)
    recorder = _macro_recorder(ctx)
    if recorder is not None:
        recorder.record_wait(duration, pre_ui=pre_ui)
    return ActionResult(success=True, summary=f"Waited for {duration} seconds")


# ---------------------------------------------------------------------------
# State / memory actions
# ---------------------------------------------------------------------------


async def complete(
    success: bool, reason: str = "", message: str = "", *, ctx: "ActionContext"
) -> ActionResult:
    """Mark the task as complete.

    Accepts both ``reason`` and ``message`` — FastAgent XML prompt uses
    ``message``, action signature uses ``reason``.
    """
    await ctx.shared_state.complete(success, reason=reason, message=message)
    return ActionResult(success=True, summary=ctx.shared_state.answer)


async def type_secret(
    secret_id: str, index: int, *, ctx: "ActionContext"
) -> ActionResult:
    """Type a secret credential into an input field without exposing the value."""
    if ctx.credential_manager is None:
        return ActionResult(
            success=False,
            summary="Failed to type secret: Credential manager not initialized. Enable credentials in config.yaml",
        )

    try:
        secret_value = await ctx.credential_manager.resolve_key(secret_id)
        pre_ui = await _macro_pre_ui(ctx)

        # Tap the element first if a specific index is given
        if index != -1:
            x, y = ctx.ui.get_element_coords(index)
            await ctx.driver.tap(x, y)
            _record_macro_action(
                ctx,
                {"action_type": "tap", "x": x, "y": y},
                pre_ui=pre_ui,
            )
            pre_ui = await _macro_pre_ui_after_focus_tap(ctx)

        ok = await ctx.driver.input_text(secret_value)
        if ok:
            _record_macro_action(
                ctx,
                {
                    "action_type": "type_secret",
                    "secret_id": secret_id,
                    "clear": False,
                },
                pre_ui=pre_ui,
            )
            return ActionResult(
                success=True,
                summary=f"Successfully typed secret '{secret_id}' into element {index}",
            )
        else:
            return ActionResult(
                success=False,
                summary=f"Failed to type secret '{secret_id}': input failed",
            )
    except Exception as e:
        logger.error(f"Failed to type secret '{secret_id}': {e}")
        available = (
            await ctx.credential_manager.get_keys() if ctx.credential_manager else []
        )
        return ActionResult(
            success=False,
            summary=f"Failed to type secret '{secret_id}': not found. Available: {available}",
        )


# ---------------------------------------------------------------------------
# Vision actions
# ---------------------------------------------------------------------------


_SEE_SCREEN_INSTRUCTIONS = (
    "You are the eyes of a mobile automation agent that cannot see the screen "
    "itself. Look at the attached screenshot of the device and answer the "
    "agent's question about it.\n"
    "Rules:\n"
    "- Report only what is actually visible. Never guess or invent labels, "
    "values, or state.\n"
    "- Be concrete: quote visible text verbatim and name the controls you see.\n"
    "- Always mention dialogs, popups, permission prompts, loading spinners, "
    "error messages, and whether the keyboard is open, when present.\n"
    "- If the question cannot be answered from the screenshot, say so plainly "
    "and describe what is visible instead.\n"
    "- Answer in plain text without markdown, in at most 200 words."
)

_SEE_SCREEN_DEFAULT_QUESTION = "Describe what is currently visible on the screen."

# Output budget for the vision model. Providers such as OpenRouter default to
# 256 tokens, which a thinking model spends entirely on reasoning, finishing
# with reason "length" and an empty answer.
_SEE_SCREEN_MIN_MAX_TOKENS = 4096


def _with_min_output_budget(llm):
    """Return *llm*, or a copy whose ``max_tokens`` is raised to the minimum."""
    max_tokens = getattr(llm, "max_tokens", None)
    if (
        isinstance(max_tokens, bool)
        or not isinstance(max_tokens, int)
        or max_tokens >= _SEE_SCREEN_MIN_MAX_TOKENS
    ):
        return llm
    try:
        return llm.model_copy(update={"max_tokens": _SEE_SCREEN_MIN_MAX_TOKENS})
    except Exception as e:
        logger.debug(f"see_screen: could not raise vision max_tokens: {e}")
        return llm


async def see_screen(*, ctx: "ActionContext") -> ActionResult:
    """Look at the current screen with a vision LLM and describe what is visible."""
    if ctx.vision_llm is None:
        return ActionResult(
            success=False,
            summary=(
                "Failed: vision_llm not configured. Add a 'vision' profile to "
                "llm_profiles in your config to enable see_screen."
            ),
        )

    try:
        screenshot = await ctx.driver.screenshot()
    except Exception as e:
        return ActionResult(
            success=False,
            summary=f"Failed to look at the screen: screenshot failed: {e}",
        )

    if not screenshot:
        return ActionResult(
            success=False,
            summary="Failed to look at the screen: device returned an empty screenshot.",
        )

    # Match the coordinate contract the action agents see, so any coordinates
    # the vision model reports are usable by the coordinate tools.
    if should_resize_model_screenshot(ctx.state_provider):
        try:
            screenshot = resize_model_screenshot_with_grid(
                ctx.state_provider, screenshot
            )
        except Exception as e:
            logger.debug(f"see_screen: keeping native screenshot, resize failed: {e}")

    messages = [
        ChatMessage(
            role="user",
            blocks=[
                TextBlock(
                    text=f"{_SEE_SCREEN_INSTRUCTIONS}\n\n"
                    f"Question: {_SEE_SCREEN_DEFAULT_QUESTION}"
                ),
                ImageBlock(image=screenshot),
            ],
        )
    ]

    try:
        response = await acall_with_retries(
            _with_min_output_budget(ctx.vision_llm), messages, stream=ctx.streaming
        )
    except Exception as e:
        return ActionResult(
            success=False,
            summary=f"Failed to look at the screen: {e.__class__.__name__}: {e}",
        )

    answer = (getattr(getattr(response, "message", None), "content", None) or "").strip()
    if not answer:
        return ActionResult(
            success=False,
            summary="Failed to look at the screen: vision model returned an empty answer.",
        )

    return ActionResult(success=True, summary=f"Screen: {answer}")
