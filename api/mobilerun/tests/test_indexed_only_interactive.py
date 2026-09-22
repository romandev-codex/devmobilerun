"""Only actionable nodes get an index; bare containers stay out of the list."""

from mobilerun.tools.formatters import IndexedFormatter


def raw(class_name, bounds=(0, 0, 1000, 400), children=(), **props):
    return {
        "className": class_name,
        "boundsInScreen": dict(
            zip(("left", "top", "right", "bottom"), bounds, strict=True)
        ),
        "windowId": 7,
        "drawingOrder": 1,
        "isVisibleToUser": True,
        "children": list(children),
        **props,
    }


def fmt(tree):
    text, _focused, elements, _state = IndexedFormatter().format(tree, {})
    return text, elements


def test_unlabeled_containers_get_no_index_and_numbering_stays_dense():
    tree = raw(
        "android.widget.FrameLayout",
        children=[
            raw("android.view.ViewGroup", children=[
                raw("android.widget.Button", text="Search", isClickable=True),
                raw("android.widget.ImageView", resourceId="app:id/image_button", isClickable=True),
                raw("android.view.ViewGroup", resourceId="app:id/container"),
                raw("android.widget.TextView", text="Caption"),
                raw("android.widget.ImageView", contentDescription="Like"),
            ]),
        ],
    )
    text, elements = fmt(tree)
    assert [e["index"] for e in elements] == [1, 2, 3, 4]
    assert [e["text"] for e in elements] == ["Search", "app:id/image_button", "Caption", "Like"]
    assert "ViewGroup" not in text
    assert "app:id/container" not in text
    assert '1. Button: "Search"' in text


def test_all_interactive_flags_count():
    flags = ["isClickable", "isLongClickable", "isCheckable", "isEditable", "isFocusable", "isScrollable"]
    tree = raw("android.widget.FrameLayout", children=[raw("android.view.View", **{f: True}) for f in flags])
    _text, elements = fmt(tree)
    assert len(elements) == len(flags)


def test_tree_without_any_flags_or_text_falls_back_to_indexing_everything():
    tree = raw("android.widget.FrameLayout", children=[raw("android.view.View"), raw("android.view.View")])
    _text, elements = fmt(tree)
    assert [e["index"] for e in elements] == [1, 2, 3]


def test_skipped_container_still_blocks_taps_on_a_sibling():
    # A later, clickable but unlabeled overlay must still be recorded as an
    # obstruction of the target it covers, even though it is itself indexed
    # (clickable) — and a plain container without flags is simply dropped.
    tree = raw(
        "android.widget.FrameLayout",
        children=[
            raw("android.widget.Button", text="target", isClickable=True),
            raw("android.widget.FrameLayout", (300, 0, 700, 400), drawingOrder=2, isClickable=True),
        ],
    )
    _text, elements = fmt(tree)
    target = next(e for e in elements if e["text"] == "target")
    assert target["tapBlockers"] == ["300,0,700,400"]
