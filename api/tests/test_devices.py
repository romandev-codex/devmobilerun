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


async def test_screenshot_returns_png_bytes_for_a_connected_device(client):
    from tests.conftest import PNG_BYTES

    res = await client.get("/devices/emulator-5554/screenshot")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content == PNG_BYTES


async def test_screenshot_404s_for_unknown_or_unauthorized_device(client):
    res = await client.get("/devices/nope/screenshot")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "device_not_found"
    res = await client.get("/devices/ZY22ABCD/screenshot")
    assert res.status_code == 404
