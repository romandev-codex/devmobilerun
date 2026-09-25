import json

import httpx
import pytest

from executor import llm_trace

pytestmark = pytest.mark.anyio

IMAGE = "data:image/png;base64," + "A" * 5000


class Body(httpx.AsyncByteStream):
    """An unread body, as the network hands it over."""

    def __init__(self, data: bytes) -> None:
        self.data = data

    async def __aiter__(self):
        yield self.data


def reply(data, headers=None) -> httpx.Response:
    raw = data if isinstance(data, bytes) else json.dumps(data).encode()
    return httpx.Response(
        200, stream=Body(raw), headers={"content-type": "application/json", **(headers or {})}
    )


@pytest.fixture
def fake_network(monkeypatch):
    """Stands in for the network under a freshly installed tracer."""
    replies: list[httpx.Response] = []

    async def handle_async_request(self, request):
        return replies.pop(0)

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", handle_async_request)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", httpx.HTTPTransport.handle_request)
    monkeypatch.setattr(llm_trace, "_installed", False)
    return replies


async def test_records_request_and_response(fake_network):
    fake_network.append(reply({"choices": [{"message": {"content": "tap 3"}}]}, {"x-id": "gen-1"}))
    calls = []
    body = {
        "model": "m",
        "messages": [
            {"role": "user", "content": [{"type": "image_url", "image_url": {"url": IMAGE}}]}
        ],
    }
    with llm_trace.recording(calls.append):
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                json=body,
                headers={"Authorization": "Bearer sk-1"},
            )
    assert res.json()["choices"][0]["message"]["content"] == "tap 3"
    [call] = calls
    assert call["status"] == 200
    assert call["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert call["requestHeaders"]["authorization"] == "<redacted>"
    assert call["responseHeaders"]["x-id"] == "gen-1"
    assert "5000 base64 chars omitted" in call["request"]
    assert "AAAA" not in call["request"]
    assert json.loads(call["response"])["choices"][0]["message"]["content"] == "tap 3"


async def test_assembles_a_streamed_completion(fake_network):
    chunks = [
        {"id": "g", "model": "m", "choices": [{"delta": {"content": "Hel"}}]},
        {
            "choices": [{"delta": {"content": "lo"}, "finish_reason": "stop"}],
            "usage": {"total_tokens": 9},
        },
    ]
    sse = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    fake_network.append(reply(sse.encode(), {"content-type": "text/event-stream"}))
    calls = []
    with llm_trace.recording(calls.append):
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST", "https://openrouter.ai/api/v1/chat/completions", json={}
            ) as res:
                async for _ in res.aiter_lines():
                    pass
    [call] = calls
    assert call["stream"] is True
    assembled = json.loads(call["assembled"])
    assert assembled["content"] == "Hello"
    assert assembled["usage"] == {"total_tokens": 9}
    assert assembled["finish_reason"] == "stop"
    assert "[DONE]" in call["response"]


async def test_nothing_is_recorded_outside_a_run(fake_network):
    fake_network.append(reply({}))
    calls = []
    with llm_trace.recording(calls.append):
        pass
    async with httpx.AsyncClient() as client:
        await client.get("https://openrouter.ai/api/v1/models")
    assert calls == []
