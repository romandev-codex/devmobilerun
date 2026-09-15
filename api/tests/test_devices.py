import pytest

pytestmark = pytest.mark.anyio


async def test_devices_lists_adb_devices_with_model_and_state(client):
    res = await client.get("/devices")
    assert res.status_code == 200
    assert res.json() == [
        {"serial": "emulator-5554", "state": "device", "model": "sdk_gphone64"},
        {"serial": "ZY22ABCD", "state": "unauthorized", "model": None},
    ]


async def test_devices_is_empty_when_nothing_is_connected(client, framework):
    framework.devices = []
    res = await client.get("/devices")
    assert res.status_code == 200
    assert res.json() == []


async def test_devices_requires_token(anon_client):
    assert (await anon_client.get("/devices")).status_code == 401
