import json
import logging

import httpx
import pytest

from mobilerun.agent.utils import openrouter_debug
from mobilerun.agent.utils.llm_picker import load_llm


@pytest.fixture
def mobilerun_log(caplog, monkeypatch):
    # The "mobilerun" logger does not propagate to the root logger caplog listens on.
    monkeypatch.setattr(logging.getLogger("mobilerun"), "propagate", True)
    with caplog.at_level(logging.INFO, logger="mobilerun"):
        yield caplog


@pytest.mark.parametrize(
    "value,expected", [("true", True), ("1", True), ("false", False), ("", False)]
)
def test_is_development_reads_env(monkeypatch, value, expected):
    monkeypatch.setenv("IS_DEVELOPMENT", value)
    assert openrouter_debug.is_development() is expected


def test_openrouter_llm_gets_debug_clients_only_in_development(monkeypatch):
    monkeypatch.setenv("IS_DEVELOPMENT", "true")
    llm = load_llm("OpenRouter", model="some/model", api_key="x")
    assert isinstance(llm._http_client, httpx.Client)
    assert isinstance(llm._async_http_client, httpx.AsyncClient)

    monkeypatch.setenv("IS_DEVELOPMENT", "false")
    llm = load_llm("OpenRouter", model="some/model", api_key="x")
    assert llm._http_client is None
    assert llm._async_http_client is None


def test_hooks_log_request_and_json_response(mobilerun_log):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]})

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        event_hooks={
            "request": [openrouter_debug._log_request],
            "response": [openrouter_debug._log_response_sync],
        },
    )
    client.post(
        "https://openrouter.ai/api/v1/chat/completions",
        json={
            "model": "m",
            "messages": [
                {"role": "system", "content": "SYSTEM_PROMPT"},
                {"role": "user", "content": "LAST_MESSAGE"},
            ],
        },
    )

    messages = [r.getMessage() for r in mobilerun_log.records]
    assert any("-> POST https://openrouter.ai/api/v1/chat/completions" in m for m in messages)
    assert any('"model": "m"' in m for m in messages)
    assert any('"content": "LAST_MESSAGE"' in m for m in messages)
    assert any('"messages_omitted": 1' in m for m in messages)
    assert not any("SYSTEM_PROMPT" in m for m in messages)
    assert any("<- 200" in m and '"content": "hi"' in m for m in messages)


def test_stream_response_body_is_not_consumed(mobilerun_log):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=b"data: " + json.dumps({"x": 1}).encode() + b"\n\n",
        )

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        event_hooks={"response": [openrouter_debug._log_response_sync]},
    )
    with client.stream("POST", "https://openrouter.ai/api/v1/chat/completions") as resp:
        assert resp.read().startswith(b"data: ")

    messages = [r.getMessage() for r in mobilerun_log.records]
    assert any("[stream]" in m for m in messages)
    assert not any('"x": 1' in m for m in messages)


def test_async_hooks_are_awaitable(mobilerun_log):
    import asyncio

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    async def run() -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            event_hooks={
                "request": [openrouter_debug._alog_request],
                "response": [openrouter_debug._log_response_async],
            },
        )
        async with client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions", json={"model": "m"}
            )
            assert resp.status_code == 200

    asyncio.run(run())

    messages = [r.getMessage() for r in mobilerun_log.records]
    assert any("-> POST" in m for m in messages)
    assert any("<- 200" in m for m in messages)
