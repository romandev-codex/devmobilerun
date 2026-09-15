import json

from executor.app_cards import write_app_cards_dir


def test_writes_mapping_and_markdown_files():
    d = write_app_cards_dir(
        [
            {"packageName": "com.google.android.gm", "name": "Gmail", "content": "# Gmail\nUse search."},
            {"packageName": "com.android.chrome", "content": "Chrome tips"},
            {"packageName": "", "content": "ignored"},
        ]
    )
    assert d is not None
    mapping = json.loads((d / "app_cards.json").read_text())
    assert set(mapping) == {"com.google.android.gm", "com.android.chrome"}
    assert (d / mapping["com.google.android.gm"]).read_text() == "# Gmail\nUse search."
    assert mapping["com.google.android.gm"].endswith("gmail.md")


def test_returns_none_when_there_is_nothing_to_write():
    assert write_app_cards_dir([]) is None
    assert write_app_cards_dir([{"packageName": "x", "content": ""}]) is None


def test_cards_are_folded_into_the_goal_only_in_direct_mode():
    from executor.framework import RunSpec, compose_goal

    cards = [{"packageName": "com.example", "name": "Example", "content": "Tap login first"}]
    direct = compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it", app_cards=cards))
    assert direct.startswith("Do it")
    assert "### Example (com.example)" in direct and "Tap login first" in direct
    reasoning = compose_goal(
        RunSpec(run_id="r", device_serial="s", instruction="Do it", reasoning=True, app_cards=cards)
    )
    assert reasoning == "Do it"
    assert compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it")) == "Do it"
