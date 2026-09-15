import pytest

pytestmark = pytest.mark.anyio


async def test_health_reports_service_and_framework_versions(client):
    res = await client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert body["mobilerunVersion"] == "9.9.9-fake"


async def test_requests_without_token_are_rejected(anon_client):
    res = await anon_client.get("/health")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthorized"


async def test_requests_with_wrong_token_are_rejected(anon_client):
    res = await anon_client.get("/health", headers={"X-Mobilerun-Token": "nope"})
    assert res.status_code == 401
