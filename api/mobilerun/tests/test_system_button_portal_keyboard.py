import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from mobilerun.agent.utils import actions


class _Response:
    def __init__(self, status_code):
        self.status_code = status_code


def _make_ctx(driver):
    return SimpleNamespace(driver=driver, shared_state=None, ui=None)


def _make_android_driver(tcp_status=200, tcp_available=True):
    portal = SimpleNamespace(
        tcp_available=tcp_available,
        tcp_base_url="http://localhost:1234",
        _tcp_request=AsyncMock(return_value=_Response(tcp_status)),
    )
    return SimpleNamespace(
        portal=portal,
        _portal_keyboard_available=True,
        device=SimpleNamespace(shell=AsyncMock(return_value="")),
        press_button=AsyncMock(),
    )


class _Wrapper:
    def __init__(self, inner):
        self.inner = inner

    def __getattr__(self, name):
        return getattr(self.inner, name)


def _run(button, driver):
    with patch.object(actions, "_macro_pre_ui", AsyncMock(return_value=None)), patch.object(
        actions, "_record_macro_action", MagicMock()
    ):
        return asyncio.run(actions.system_button(button, ctx=_make_ctx(driver)))


class SystemButtonPortalKeyboardTest(unittest.TestCase):
    def test_enter_uses_portal_keyboard_tcp(self):
        driver = _make_android_driver()
        result = _run("enter", _Wrapper(driver))

        self.assertTrue(result.success)
        driver.portal._tcp_request.assert_awaited_once()
        self.assertTrue(driver.portal._tcp_request.await_args.args[2].endswith("/keyboard/key"))
        self.assertEqual(driver.portal._tcp_request.await_args.kwargs["json"], {"key_code": 66})
        driver.press_button.assert_not_awaited()

    def test_enter_falls_back_to_content_provider(self):
        driver = _make_android_driver(tcp_available=False)
        result = _run("enter", driver)

        self.assertTrue(result.success)
        cmd = driver.device.shell.await_args.args[0]
        self.assertIn("keyboard/key", cmd)
        self.assertIn("key_code:i:66", cmd)
        driver.press_button.assert_not_awaited()

    def test_enter_falls_back_to_adb_without_portal_keyboard(self):
        driver = _make_android_driver()
        driver._portal_keyboard_available = False
        result = _run("enter", driver)

        self.assertTrue(result.success)
        driver.press_button.assert_awaited_once_with("enter")

    def test_back_still_uses_press_button(self):
        driver = _make_android_driver()
        result = _run("back", driver)

        self.assertTrue(result.success)
        driver.press_button.assert_awaited_once_with("back")
        driver.portal._tcp_request.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
