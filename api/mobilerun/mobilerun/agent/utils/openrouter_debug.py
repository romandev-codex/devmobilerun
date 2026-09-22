"""Console logging of raw OpenRouter HTTP calls for development.

Enabled when ``IS_DEVELOPMENT`` is truthy in the environment (the root ``.env``
is exported to the executor by the Makefile). Every request body sent to
OpenRouter and every non-streaming response body is printed through the
``mobilerun`` logger, which the CLI handler renders on the console.
Streaming responses only log their status: their tokens already stream to the
console as they arrive.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger("mobilerun")

_TRUTHY = {"1", "true", "yes", "on"}
_PREFIX = "[openrouter]"


def is_development() -> bool:
    """Return whether the ``IS_DEVELOPMENT`` env flag is set to a truthy value."""
    return os.environ.get("IS_DEVELOPMENT", "").strip().lower() in _TRUTHY


def _pretty(raw: bytes | str) -> str:
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    try:
        return json.dumps(json.loads(text), indent=2, ensure_ascii=False)
    except (ValueError, TypeError):
        return text


def _log(message: str, color: str) -> None:
    logger.info(message, extra={"color": color})


def _trim_messages(raw: bytes) -> str:
    """Pretty-print a request body, keeping only the last chat message."""
    try:
        body = json.loads(raw)
    except (ValueError, TypeError):
        return _pretty(raw)
    messages = body.get("messages") if isinstance(body, dict) else None
    if isinstance(messages, list) and len(messages) > 1:
        body = {**body, "messages": messages[-1:]}
        body["messages_omitted"] = len(messages) - 1
    return json.dumps(body, indent=2, ensure_ascii=False)


def _log_request(request: Any) -> None:
    body = _trim_messages(request.content) if request.content else "<no body>"
    _log(f"{_PREFIX} -> {request.method} {request.url}\n{body}", "cyan")


async def _alog_request(request: Any) -> None:
    # httpx.AsyncClient awaits every hook, so it needs a coroutine.
    _log_request(request)


def _is_stream(response: Any) -> bool:
    content_type = response.headers.get("content-type", "")
    return content_type.startswith("text/event-stream")


def _response_header(response: Any) -> str:
    elapsed = ""
    try:
        elapsed = f" ({response.elapsed.total_seconds():.2f}s)"
    except Exception:  # noqa: BLE001 - elapsed is only known after the read
        pass
    return f"{_PREFIX} <- {response.status_code} {response.request.url}{elapsed}"


def _log_response_sync(response: Any) -> None:
    if _is_stream(response):
        _log(f"{_response_header(response)} [stream]", "magenta")
        return
    response.read()
    _log(f"{_response_header(response)}\n{_pretty(response.content)}", "magenta")


async def _log_response_async(response: Any) -> None:
    if _is_stream(response):
        _log(f"{_response_header(response)} [stream]", "magenta")
        return
    await response.aread()
    _log(f"{_response_header(response)}\n{_pretty(response.content)}", "magenta")


def debug_http_clients() -> dict[str, Any]:
    """Build httpx clients that print each OpenRouter call to the console.

    Returns kwargs (``http_client`` / ``async_http_client``) accepted by the
    llama-index OpenAI-compatible LLM classes.
    """
    from openai import DefaultAsyncHttpxClient, DefaultHttpxClient

    return {
        "http_client": DefaultHttpxClient(
            event_hooks={"request": [_log_request], "response": [_log_response_sync]}
        ),
        "async_http_client": DefaultAsyncHttpxClient(
            event_hooks={"request": [_alog_request], "response": [_log_response_async]}
        ),
    }
