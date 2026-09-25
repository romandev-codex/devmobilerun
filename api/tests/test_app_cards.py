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
    direct = compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it in Example", app_cards=cards))
    assert direct.startswith("Do it in Example")
    assert "### Example (com.example)" in direct and "Tap login first" in direct
    reasoning = compose_goal(
        RunSpec(run_id="r", device_serial="s", instruction="Do it", reasoning=True, app_cards=cards)
    )
    assert reasoning == "Do it"
    assert compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it")) == "Do it"


def test_direct_mode_only_folds_in_cards_for_apps_the_task_names():
    from executor.framework import RunSpec, compose_goal, relevant_app_cards

    cards = [
        {"packageName": "com.instagram.android", "name": "", "content": "IG tips"},
        {"packageName": "com.google.android.gm", "name": "Gmail", "content": "Gmail tips"},
        {"packageName": "com.android.chrome", "name": "", "content": "Chrome tips"},
        {"packageName": "org.example.notes", "name": "", "content": "Notes tips"},
    ]

    def relevant(**fields):
        spec = RunSpec(run_id="r", device_serial="s", app_cards=cards, **fields)
        return [c["packageName"] for c in relevant_app_cards(spec)]

    # A distinctive package part, the card name, or the package itself.
    assert relevant(instruction="Like the latest Instagram post") == ["com.instagram.android"]
    assert relevant(instruction="Check gmail for the code") == ["com.google.android.gm"]
    assert relevant(instruction="Launch org.example.notes") == ["org.example.notes"]
    # The start URL and the end step count too.
    assert relevant(instruction="Read it", start_url="https://www.instagram.com/p/1") == ["com.instagram.android"]
    assert relevant(instruction="Read it", end_instruction="Close Chrome") == ["com.android.chrome"]
    # Whole words only, and generic parts ("android", "google") never match.
    assert relevant(instruction="Open the android settings and google it") == []
    assert relevant(instruction="Read the chromebook review") == []

    goal = compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Post on instagram", app_cards=cards))
    assert "IG tips" in goal and "Gmail tips" not in goal
    assert compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it", app_cards=cards)) == "Do it"
