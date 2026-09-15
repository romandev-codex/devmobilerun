import pytest

pytestmark = pytest.mark.anyio


async def test_config_lists_llm_profiles_per_role(client):
    res = await client.get("/config")
    assert res.status_code == 200
    body = res.json()
    assert body["configPath"] == "/fake/config.yaml"
    assert body["profiles"] == [
        {"role": "fast_agent", "provider": "OpenAI", "model": "gpt-test"},
        {"role": "manager", "provider": "Anthropic", "model": "claude-test"},
    ]


async def test_config_requires_token(anon_client):
    res = await anon_client.get("/config")
    assert res.status_code == 401
