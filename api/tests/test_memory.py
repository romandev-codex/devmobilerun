from executor.framework import RunSpec, compose_goal
from executor.memory import MAX_ENTRIES, MemoryStore, memory_section, memory_tools


def test_set_and_delete_queue_events_in_order():
    store = MemoryStore({"cursor": "10"})
    assert store.set("cursor", "11") == "Saved memory 'cursor'"
    assert store.set(" note ", "  keep the tab open ") == "Saved memory 'note'"
    assert store.delete("cursor") == "Deleted memory 'cursor'"
    assert store.entries == {"note": "keep the tab open"}

    events = store.drain()
    assert [(e.type, e.payload) for e in events] == [
        ("memory", {"op": "set", "key": "cursor", "value": "11"}),
        ("memory", {"op": "set", "key": "note", "value": "keep the tab open"}),
        ("memory", {"op": "delete", "key": "cursor"}),
    ]
    assert store.drain() == []


def test_deleting_an_unknown_key_is_a_no_op():
    store = MemoryStore()
    assert store.delete("missing").startswith("Memory 'missing' does not exist")
    assert store.drain() == []


def test_tools_report_validation_failures_instead_of_raising():
    store = MemoryStore()
    tools = memory_tools(store)
    assert set(tools) == {"save_memory", "delete_memory"}
    for spec in tools.values():
        assert set(spec) == {"parameters", "description", "function"}
        assert all(p["required"] for p in spec["parameters"].values())

    save = tools["save_memory"]["function"]
    assert save("", "x", ctx=None).startswith("Failed to save memory")
    assert save("k", "v" * 5000, ctx=None).startswith("Failed to save memory")
    assert save("k", "v", ctx=None) == "Saved memory 'k'"
    assert tools["delete_memory"]["function"]("k", ctx=None) == "Deleted memory 'k'"
    assert store.entries == {}


def test_memory_is_capped():
    store = MemoryStore({f"k{i}": "v" for i in range(MAX_ENTRIES)})
    assert memory_tools(store)["save_memory"]["function"]("new", "v", ctx=None).startswith(
        "Failed to save memory: Memory is full"
    )
    # Overwriting an existing key is still allowed when full.
    assert store.set("k0", "changed") == "Saved memory 'k0'"


def test_memory_section_lists_entries():
    assert memory_section({}) == ""
    text = memory_section({"last_id": "42", "hint": "login is on tab 2"})
    assert text.startswith("Memory from previous runs")
    assert "- last_id: 42" in text and "- hint: login is on tab 2" in text


def test_goal_carries_memory_in_both_modes():
    memory = {"last_id": "42"}
    direct = compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it", memory=memory))
    assert direct.startswith("Do it\n\nMemory from previous runs")
    assert "- last_id: 42" in direct
    reasoning = compose_goal(
        RunSpec(run_id="r", device_serial="s", instruction="Do it", reasoning=True, memory=memory)
    )
    assert reasoning == direct

    cards = [{"packageName": "com.example", "content": "Tap login first"}]
    with_cards = compose_goal(
        RunSpec(run_id="r", device_serial="s", instruction="Do it", memory=memory, app_cards=cards)
    )
    assert with_cards.index("Memory from previous runs") < with_cards.index("App guidance:")
    assert compose_goal(RunSpec(run_id="r", device_serial="s", instruction="Do it")) == "Do it"
