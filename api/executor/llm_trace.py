"""Records every outbound LLM HTTP call a run makes, for the run's export.

The mobilerun agent (llama-index / openai clients) and Jev (its own httpx
client) both reach OpenRouter through httpx, so the tracer wraps httpx's two
network transports once per process. A call is recorded only while a run has
set a sink with :func:`recording`; the sink sees one dict per call with the
request, the full response (a streamed one is teed as it is read and also
assembled into its final message) and the timing.

Image bytes are replaced by a size note: screenshots are stored separately and
would otherwise make every step's record megabytes long.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import json
import logging
import re
import threading
import time
import zlib
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)

Sink = Callable[[dict[str, Any]], None]

#: Longest request or response body kept per call; Mongo caps a document at 16 MB.
MAX_BODY_CHARS = 2_000_000
#: Strings at least this long that are pure base64 are image or binary payloads.
MIN_BASE64_CHARS = 2_000

_LOOPBACK = {"localhost", "127.0.0.1", "::1"}
_SECRET_HEADERS = {
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "cookie",
    "set-cookie",
}
_DATA_URL = re.compile(r"^(data:[\w/+.-]+;base64,)(.*)$", re.DOTALL)
_BASE64 = re.compile(r"^[A-Za-z0-9+/=\s]+$")

_sink: contextvars.ContextVar[Sink | None] = contextvars.ContextVar("llm_trace_sink", default=None)
_installed = False


@contextlib.contextmanager
def recording(sink: Sink) -> Iterator[None]:
    """Sends every call made in this context (and tasks/threads it spawns) to ``sink``.

    Calls may finish on a worker thread; ``sink`` is always invoked on the loop
    that entered the context.
    """
    install()
    loop = asyncio.get_running_loop()
    loop_thread = threading.get_ident()

    def deliver(record: dict[str, Any]) -> None:
        if threading.get_ident() == loop_thread:
            sink(record)
        else:
            loop.call_soon_threadsafe(sink, record)

    token = _sink.set(deliver)
    try:
        yield
    finally:
        _sink.reset(token)


def install() -> None:
    """Wraps httpx's network transports; idempotent."""
    global _installed
    if _installed:
        return
    _installed = True
    sync_send = httpx.HTTPTransport.handle_request
    async_send = httpx.AsyncHTTPTransport.handle_async_request

    def handle_request(self: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
        sink = _sink.get()
        if sink is None or not _traced(request):
            return sync_send(self, request)
        call = _Call(request, sink)
        try:
            response = sync_send(self, request)
        except Exception as exc:
            call.fail(exc)
            raise
        call.respond(response)
        response.stream = _SyncTee(response.stream, call)
        return response

    async def handle_async_request(
        self: httpx.AsyncHTTPTransport, request: httpx.Request
    ) -> httpx.Response:
        sink = _sink.get()
        if sink is None or not _traced(request):
            return await async_send(self, request)
        call = _Call(request, sink)
        try:
            response = await async_send(self, request)
        except BaseException as exc:
            call.fail(exc)
            raise
        call.respond(response)
        response.stream = _AsyncTee(response.stream, call)
        return response

    httpx.HTTPTransport.handle_request = handle_request  # type: ignore[method-assign]
    httpx.AsyncHTTPTransport.handle_async_request = handle_async_request  # type: ignore[method-assign]


def _traced(request: httpx.Request) -> bool:
    return request.url.host not in _LOOPBACK


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _headers(headers: httpx.Headers) -> dict[str, str]:
    return {k: ("<redacted>" if k.lower() in _SECRET_HEADERS else v) for k, v in headers.items()}


class _Call:
    """One request/response pair; emitted once, when the body is done or the call failed."""

    def __init__(self, request: httpx.Request, sink: Sink) -> None:
        self._sink = sink
        self._t0 = time.monotonic()
        self._done = False
        self._response: httpx.Response | None = None
        self._chunks: list[bytes] = []
        self.record: dict[str, Any] = {
            "startedAt": _now(),
            "method": request.method,
            "url": str(request.url),
            "requestHeaders": _headers(request.headers),
            "request": _request_body(request),
        }

    def respond(self, response: httpx.Response) -> None:
        self._response = response
        self.record["status"] = response.status_code
        self.record["responseHeaders"] = _headers(response.headers)
        self.record["firstByteMs"] = round((time.monotonic() - self._t0) * 1000)

    def chunk(self, data: bytes) -> None:
        self._chunks.append(data)

    def fail(self, exc: BaseException) -> None:
        self.record["error"] = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        self.finish()

    def finish(self) -> None:
        if self._done:
            return
        self._done = True
        self.record["durationMs"] = round((time.monotonic() - self._t0) * 1000)
        if self._response is not None:
            text = _decode(
                b"".join(self._chunks), self._response.headers.get("content-encoding", "")
            )
            content_type = self._response.headers.get("content-type", "")
            if content_type.startswith("text/event-stream"):
                self.record["stream"] = True
                assembled = _assemble_stream(text)
                if assembled:
                    self.record["assembled"] = _clip(
                        json.dumps(assembled, indent=2, ensure_ascii=False)
                    )
            self.record["response"] = _clip(_pretty(text))
        try:
            self._sink(self.record)
        except Exception:  # tracing must never break the agent's call
            logger.warning("could not record LLM call to %s", self.record["url"], exc_info=True)


class _AsyncTee(httpx.AsyncByteStream):
    def __init__(self, inner: Any, call: _Call) -> None:
        self._inner = inner
        self._call = call

    async def __aiter__(self):  # type: ignore[override]
        try:
            async for data in self._inner:
                self._call.chunk(data)
                yield data
        except GeneratorExit:  # the reader stopped early; close() still finishes the call
            raise
        except BaseException as exc:
            self._call.fail(exc)
            raise
        self._call.finish()

    async def aclose(self) -> None:
        try:
            await self._inner.aclose()
        finally:
            self._call.finish()


class _SyncTee(httpx.SyncByteStream):
    def __init__(self, inner: Any, call: _Call) -> None:
        self._inner = inner
        self._call = call

    def __iter__(self):  # type: ignore[override]
        try:
            for data in self._inner:
                self._call.chunk(data)
                yield data
        except GeneratorExit:  # the reader stopped early; close() still finishes the call
            raise
        except BaseException as exc:
            self._call.fail(exc)
            raise
        self._call.finish()

    def close(self) -> None:
        try:
            self._inner.close()
        finally:
            self._call.finish()


def _request_body(request: httpx.Request) -> str:
    try:
        raw = request.content
    except httpx.RequestNotRead:
        return "<streamed body not captured>"
    if not raw:
        return ""
    return _clip(_pretty(raw.decode("utf-8", errors="replace")))


def _decode(raw: bytes, encoding: str) -> str:
    encoding = encoding.strip().lower()
    try:
        if encoding == "gzip":
            raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
        elif encoding == "deflate":
            raw = zlib.decompress(raw)
        elif encoding == "br":
            import brotli  # type: ignore[import-not-found]

            raw = brotli.decompress(raw)
    except Exception as exc:  # noqa: BLE001 - keep what we have and say why
        return f"<{encoding} body could not be decoded: {exc}>"
    return raw.decode("utf-8", errors="replace")


def _pretty(text: str) -> str:
    """Indented JSON with image payloads elided; other text unchanged."""
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return text
    return json.dumps(_strip_binary(value), indent=2, ensure_ascii=False)


def _strip_binary(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_binary(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_binary(v) for v in value]
    if isinstance(value, str) and len(value) >= MIN_BASE64_CHARS:
        match = _DATA_URL.match(value)
        if match:
            return f"{match.group(1)}<{len(match.group(2))} base64 chars omitted>"
        if _BASE64.match(value):
            return f"<{len(value)} base64 chars omitted>"
    return value


def _clip(text: str) -> str:
    if len(text) <= MAX_BODY_CHARS:
        return text
    return text[:MAX_BODY_CHARS] + f"\n<truncated: {len(text) - MAX_BODY_CHARS} more chars>"


def _assemble_stream(text: str) -> dict[str, Any] | None:
    """Folds an OpenAI-style chat completion stream into the message it produced."""
    content: list[str] = []
    reasoning: list[str] = []
    tool_calls: dict[int, dict[str, Any]] = {}
    out: dict[str, Any] = {}
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            chunk = json.loads(data)
        except ValueError:
            continue
        if not isinstance(chunk, dict):
            continue
        for key in ("id", "model", "provider"):
            if chunk.get(key):
                out[key] = chunk[key]
        if chunk.get("usage"):
            out["usage"] = chunk["usage"]
        if chunk.get("error"):
            out["error"] = chunk["error"]
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            if delta.get("content"):
                content.append(str(delta["content"]))
            for key in ("reasoning", "reasoning_content"):
                if delta.get(key):
                    reasoning.append(str(delta[key]))
            for call in delta.get("tool_calls") or []:
                slot = tool_calls.setdefault(
                    call.get("index", 0), {"id": None, "name": "", "arguments": ""}
                )
                slot["id"] = call.get("id") or slot["id"]
                fn = call.get("function") or {}
                slot["name"] += fn.get("name") or ""
                slot["arguments"] += fn.get("arguments") or ""
            if choice.get("finish_reason"):
                out["finish_reason"] = choice["finish_reason"]
    if not (content or reasoning or tool_calls or out):
        return None
    if reasoning:
        out["reasoning"] = "".join(reasoning)
    out["content"] = "".join(content)
    if tool_calls:
        out["tool_calls"] = [tool_calls[i] for i in sorted(tool_calls)]
    return out
