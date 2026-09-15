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
