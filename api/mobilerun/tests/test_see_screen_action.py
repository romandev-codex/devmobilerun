import asyncio
import unittest
from types import SimpleNamespace

from llama_index.core.base.llms.types import ImageBlock, TextBlock

from mobilerun.agent.utils.actions import see_screen
from mobilerun.agent.utils.signatures import build_tool_registry
from mobilerun.config_manager.migrations import CURRENT_VERSION, migrate


class FakeDriver:
    def __init__(self, screenshot=b"png-bytes"):
        self._screenshot = screenshot
        self.calls = 0

    async def screenshot(self):
        self.calls += 1
        if isinstance(self._screenshot, Exception):
            raise self._screenshot
        return self._screenshot


class FakeVisionLLM:
    def __init__(self, answer="A login screen with Email and Password fields."):
        self.answer = answer
        self.messages = None

    async def achat(self, messages):
        self.messages = messages
        return SimpleNamespace(message=SimpleNamespace(content=self.answer))


def make_ctx(driver=None, vision_llm=None, state_provider=None):
    return SimpleNamespace(
        driver=driver if driver is not None else FakeDriver(),
        vision_llm=vision_llm,
        state_provider=state_provider if state_provider is not None else object(),
        streaming=False,
    )


class SeeScreenActionTest(unittest.TestCase):
    def test_sends_screenshot_and_default_question_to_vision_llm(self):
        llm = FakeVisionLLM()
        driver = FakeDriver()
        ctx = make_ctx(driver=driver, vision_llm=llm)

        result = asyncio.run(see_screen(ctx=ctx))

        self.assertTrue(result.success)
        self.assertIn("A login screen", result.summary)
        self.assertEqual(driver.calls, 1)

        blocks = llm.messages[0].blocks
        self.assertIsInstance(blocks[0], TextBlock)
        self.assertIn("Describe what is currently visible", blocks[0].text)
        self.assertIsInstance(blocks[1], ImageBlock)

    def test_takes_no_arguments(self):
        ctx = make_ctx(vision_llm=FakeVisionLLM())

        with self.assertRaises(TypeError):
            asyncio.run(see_screen("What is on screen?", ctx=ctx))

    def test_fails_clearly_without_a_vision_llm(self):
        result = asyncio.run(see_screen(ctx=make_ctx()))

        self.assertFalse(result.success)
        self.assertIn("vision", result.summary)

    def test_screenshot_failure_is_reported_not_raised(self):
        ctx = make_ctx(
            driver=FakeDriver(RuntimeError("device offline")),
            vision_llm=FakeVisionLLM(),
        )

        result = asyncio.run(see_screen(ctx=ctx))

        self.assertFalse(result.success)
        self.assertIn("device offline", result.summary)

    def test_empty_vision_answer_fails(self):
        ctx = make_ctx(vision_llm=FakeVisionLLM(answer="   "))

        result = asyncio.run(see_screen(ctx=ctx))

        self.assertFalse(result.success)
        self.assertIn("empty answer", result.summary)

    def test_tool_is_registered_only_when_a_vision_llm_exists(self):
        async def run():
            with_vision, standard = await build_tool_registry(vision_tool=True)
            without_vision, _ = await build_tool_registry()
            return with_vision, standard, without_vision

        with_vision, standard, without_vision = asyncio.run(run())

        self.assertIn("see_screen", with_vision.tools)
        self.assertIn("see_screen", standard)
        self.assertNotIn("see_screen", without_vision.tools)
        self.assertEqual(with_vision.tools["see_screen"].deps, {"screenshot"})
        self.assertEqual(with_vision.tools["see_screen"].params, {})


class VisionProfileMigrationTest(unittest.TestCase):
    def test_v8_clones_fast_agent_profile_into_vision(self):
        config = migrate(
            {
                "_version": 7,
                "llm_profiles": {
                    "fast_agent": {
                        "provider": "OpenRouter",
                        "model": "some/model",
                        "temperature": 0.2,
                        "kwargs": {"max_tokens": 8192},
                    }
                },
            }
        )

        self.assertEqual(config["_version"], CURRENT_VERSION)
        vision = config["llm_profiles"]["vision"]
        self.assertEqual(vision["provider"], "OpenRouter")
        self.assertEqual(vision["model"], "some/model")
        self.assertEqual(vision["temperature"], 0.0)
        # The clone must not share the source profile's kwargs dict.
        self.assertIsNot(vision["kwargs"], config["llm_profiles"]["fast_agent"]["kwargs"])

    def test_v8_keeps_an_existing_vision_profile(self):
        config = migrate(
            {
                "_version": 7,
                "llm_profiles": {
                    "fast_agent": {"provider": "OpenRouter", "model": "some/model"},
                    "vision": {"provider": "GoogleGenAI", "model": "gemini-3.7-flash"},
                },
            }
        )

        self.assertEqual(config["llm_profiles"]["vision"]["provider"], "GoogleGenAI")


if __name__ == "__main__":
    unittest.main()
