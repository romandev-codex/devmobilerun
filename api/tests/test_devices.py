import pytest

from executor.framework import DeviceUser

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


async def test_thermal_reports_battery_temperature(client, framework):
    res = await client.get("/devices/emulator-5554/thermal")
    assert res.status_code == 200
    assert res.json() == {"temperatureC": 31.2}

    framework.temperatures["emulator-5554"] = None
    res = await client.get("/devices/emulator-5554/thermal")
    assert res.status_code == 200
    assert res.json() == {"temperatureC": None}


async def test_thermal_404s_for_unknown_or_unauthorized_device(client):
    res = await client.get("/devices/nope/thermal")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "device_not_found"
    assert (await client.get("/devices/ZY22ABCD/thermal")).status_code == 404


def test_parse_battery_temperature_reads_tenths_of_a_degree():
    from executor.framework import parse_battery_temperature

    dump = """Current Battery Service state:
  AC powered: false
  USB powered: true
  level: 87
  scale: 100
  voltage: 4123
  temperature: 312
  technology: Li-ion
"""
    assert parse_battery_temperature(dump) == 31.2
    assert parse_battery_temperature(dump.replace("temperature: 312", "temperature: 0")) is None
    assert parse_battery_temperature("level: 87\n") is None


async def test_users_lists_android_users_with_the_current_one_marked(client):
    res = await client.get("/devices/emulator-5554/users")
    assert res.status_code == 200
    assert res.json() == [
        {"id": 0, "name": "Owner", "running": True, "current": True},
        {"id": 10, "name": "Work", "running": False, "current": False},
    ]


async def test_users_404s_for_unknown_or_unauthorized_device(client):
    res = await client.get("/devices/nope/users")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "device_not_found"
    assert (await client.get("/devices/ZY22ABCD/users")).status_code == 404


async def test_create_user_adds_a_profile_and_returns_the_list(client, framework):
    res = await client.post("/devices/emulator-5554/users", json={"name": " Tester "})
    assert res.status_code == 201
    assert res.json()[-1] == {"id": 11, "name": "Tester", "running": False, "current": False}
    assert framework.created_users == [("emulator-5554", "Tester")]

    assert (await client.post("/devices/emulator-5554/users", json={"name": ""})).status_code == 422
    assert (await client.post("/devices/nope/users", json={"name": "x"})).status_code == 404

    framework.user_error = "Error: couldn't create User."
    res = await client.post("/devices/emulator-5554/users", json={"name": "Another"})
    assert res.status_code == 400
    assert res.json()["error"] == {"code": "device_user_error", "message": "Error: couldn't create User."}


async def test_activate_user_switches_and_returns_the_list(client, framework):
    res = await client.post("/devices/emulator-5554/users/10/activate")
    assert res.status_code == 200
    assert [u["current"] for u in res.json()] == [False, True]
    assert framework.switched_users == [("emulator-5554", 10)]

    # Activating the current user is a no-op rather than a second switch.
    res = await client.post("/devices/emulator-5554/users/10/activate")
    assert res.status_code == 200
    assert framework.switched_users == [("emulator-5554", 10)]

    res = await client.post("/devices/emulator-5554/users/99/activate")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "user_not_found"
    assert (await client.post("/devices/nope/users/0/activate")).status_code == 404

    framework.user_error = "Error: switch failed"
    res = await client.post("/devices/emulator-5554/users/0/activate")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "device_user_error"


def test_parse_user_list_reads_pm_output():
    from executor.framework import DeviceUser, parse_user_list

    output = """Users:
\tUserInfo{0:Owner:c13} running
\tUserInfo{10:Work profile:1030}
\tUserInfo{11:Tester:c10} running
"""
    assert parse_user_list(output, 11) == [
        DeviceUser(id=0, name="Owner", running=True, current=False),
        DeviceUser(id=10, name="Work profile", running=False, current=False),
        DeviceUser(id=11, name="Tester", running=True, current=True),
    ]
    assert parse_user_list("Users:\n", None) == []


def test_parse_created_user_id_reads_the_new_id_or_raises():
    import pytest

    from executor.framework import DeviceUserError, parse_created_user_id

    assert parse_created_user_id("Success: created user id 12\n") == 12
    with pytest.raises(DeviceUserError, match="couldn't create"):
        parse_created_user_id("Error: couldn't create User.\n")


async def test_create_user_falls_back_to_a_guest_user_when_refused():
    from executor.framework import DeviceUser, DeviceUserError, MobilerunFramework

    calls: list[list[str]] = []
    replies = iter(["Error: couldn't create User.", "Success: created user id 12"])

    async def fake_shell(serial: str, args: list[str]) -> str:
        calls.append(args)
        return next(replies)

    framework = MobilerunFramework()
    framework._shell = fake_shell  # type: ignore[method-assign]
    user = await framework.create_user("emulator-5554", "Tester")
    assert user == DeviceUser(id=12, name="Tester", running=False, current=False)
    assert calls == [
        ["pm", "create-user", "Tester"],
        ["pm", "create-user", "--guest", "Tester"],
    ]

    replies = iter(["Error: couldn't create User.", "Error: guest refused too"])
    calls.clear()
    with pytest.raises(DeviceUserError, match="couldn't create User.; as guest: Error: guest refused too"):
        await framework.create_user("emulator-5554", "Tester")
    assert len(calls) == 2


async def test_remove_user_deletes_an_additional_profile_but_never_the_owner(client, framework):
    res = await client.delete("/devices/emulator-5554/users/10")
    assert res.status_code == 200
    assert res.json() == [{"id": 0, "name": "Owner", "running": True, "current": True}]
    assert framework.removed_users == [("emulator-5554", 10)]

    res = await client.delete("/devices/emulator-5554/users/0")
    assert res.status_code == 400
    assert res.json()["error"]["message"] == "The owner profile cannot be removed"
    assert framework.removed_users == [("emulator-5554", 10)]

    res = await client.delete("/devices/emulator-5554/users/99")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "user_not_found"
    assert (await client.delete("/devices/nope/users/10")).status_code == 404

    framework.users["emulator-5554"].append(DeviceUser(id=11, name="Tester", running=False, current=False))
    framework.user_error = "Error: couldn't remove user"
    res = await client.delete("/devices/emulator-5554/users/11")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "device_user_error"


async def test_remove_user_runs_pm_remove_user_with_force():
    from executor.framework import DeviceUserError, MobilerunFramework

    calls: list[list[str]] = []
    replies = iter(["Success: removed user", "Error: couldn't remove user"])

    async def fake_shell(serial: str, args: list[str]) -> str:
        calls.append(args)
        return next(replies)

    framework = MobilerunFramework()
    framework._shell = fake_shell  # type: ignore[method-assign]
    await framework.remove_user("emulator-5554", 12)
    assert calls == [["pm", "remove-user", "-f", "12"]]
    with pytest.raises(DeviceUserError, match="couldn't remove"):
        await framework.remove_user("emulator-5554", 12)


class ScriptedShell:
    """Answers adb shell commands from a script keyed by the command's first words."""

    def __init__(self, answers: dict[str, list[str]]):
        self.answers = {k: list(v) for k, v in answers.items()}
        self.calls: list[list[str]] = []

    async def __call__(self, serial: str, args: list[str]) -> str:
        self.calls.append(args)
        key = " ".join(args[:2])
        queue = self.answers[key]
        return queue.pop(0) if len(queue) > 1 else queue[0]


@pytest.fixture
def fast_switch(monkeypatch):
    from executor import framework

    monkeypatch.setattr(framework, "SWITCH_USER_POLL_SECONDS", 0.0)
    monkeypatch.setattr(framework, "SWITCH_USER_SETTLE_SECONDS", 0.0)
    monkeypatch.setattr(framework, "SWITCH_USER_TIMEOUT_SECONDS", 0.2)


async def test_switch_user_waits_until_the_user_is_current_and_unlocked(fast_switch):
    from executor.framework import MobilerunFramework

    shell = ScriptedShell(
        {
            "am switch-user": [""],
            "am get-current-user": ["0", "10"],
            "am get-started-user-state": ["RUNNING_LOCKED", "RUNNING_UNLOCKED"],
        }
    )
    framework = MobilerunFramework()
    framework._shell = shell  # type: ignore[method-assign]
    await framework.switch_user("emulator-5554", 10)
    assert shell.calls[0] == ["am", "switch-user", "-w", "10"]
    # Polled until both the foreground and the unlocked state agreed.
    states = [c for c in shell.calls if c[:2] == ["am", "get-started-user-state"]]
    assert len(states) == 2
    assert shell.calls[-1] == ["am", "get-started-user-state", "10"]


async def test_switch_user_falls_back_without_the_wait_flag_and_to_pm_running(fast_switch):
    from executor.framework import MobilerunFramework

    shell = ScriptedShell(
        {
            "am switch-user": ["Error: Unknown option: -w", ""],
            "am get-current-user": ["10"],
            "am get-started-user-state": ["Error: unknown command 'get-started-user-state'"],
            "pm list": ["Users:\n\tUserInfo{0:Owner:c13} running\n\tUserInfo{10:Work:c10}\n",
                        "Users:\n\tUserInfo{0:Owner:c13} running\n\tUserInfo{10:Work:c10} running\n"],
        }
    )
    framework = MobilerunFramework()
    framework._shell = shell  # type: ignore[method-assign]
    await framework.switch_user("emulator-5554", 10)
    assert shell.calls[:2] == [["am", "switch-user", "-w", "10"], ["am", "switch-user", "10"]]
    assert ["pm", "list", "users"] in shell.calls


async def test_switch_user_times_out_when_the_user_never_unlocks(fast_switch):
    from executor.framework import DeviceUserError, MobilerunFramework

    shell = ScriptedShell(
        {
            "am switch-user": [""],
            "am get-current-user": ["10"],
            "am get-started-user-state": ["RUNNING_LOCKED"],
        }
    )
    framework = MobilerunFramework()
    framework._shell = shell  # type: ignore[method-assign]
    with pytest.raises(DeviceUserError, match="did not finish switching to user 10"):
        await framework.switch_user("emulator-5554", 10)


async def test_switch_user_reports_a_refused_switch(fast_switch):
    from executor.framework import DeviceUserError, MobilerunFramework

    shell = ScriptedShell({"am switch-user": ["Error: user 99 does not exist"]})
    framework = MobilerunFramework()
    framework._shell = shell  # type: ignore[method-assign]
    with pytest.raises(DeviceUserError, match="does not exist"):
        await framework.switch_user("emulator-5554", 99)
