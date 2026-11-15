import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from export_from_anki import build_seed, html_to_text


def make_collection(path: Path) -> None:
    db = sqlite3.connect(path)
    db.executescript(
        """
        create table decks (id integer primary key, name text);
        create table notes (id integer primary key, mid integer, flds text);
        create table cards (id integer primary key, nid integer, did integer, ord integer);
        """
    )
    db.executemany("insert into decks values (?, ?)", [(1, "デフォルト"), (2, "English")])
    sep = "\x1f"
    db.executemany(
        "insert into notes values (?, ?, ?)",
        [(10, 1, f"tiredness{sep}疲労"), (11, 1, f"vomit{sep}<pre>吐瀉物</pre>"), (12, 1, f"a&amp;b<br>c{sep}x&nbsp;y")],
    )
    db.executemany("insert into cards values (?, ?, ?, ?)", [(100, 10, 2, 0), (101, 11, 2, 0), (102, 12, 1, 0)])
    db.commit()
    db.close()


class HtmlToTextTest(unittest.TestCase):
    def test_strips_tags_and_entities(self):
        self.assertEqual(html_to_text("<pre>吐瀉物</pre>"), "吐瀉物")
        self.assertEqual(html_to_text("a&amp;b<br>c"), "a&b\nc")
        self.assertEqual(html_to_text("x&nbsp;y"), "x y")
        self.assertEqual(html_to_text("<div>one</div><div>two</div>"), "one\ntwo")


class BuildSeedTest(unittest.TestCase):
    def test_exports_every_card_with_deck_name(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "collection.anki2"
            make_collection(path)
            seed = build_seed(path)
        self.assertEqual(seed["format"], "kitagawa-anki-seed")
        self.assertEqual(
            seed["cards"],
            [
                {"deck": "English", "front": "tiredness", "back": "疲労"},
                {"deck": "English", "front": "vomit", "back": "吐瀉物"},
                {"deck": "デフォルト", "front": "a&b\nc", "back": "x y"},
            ],
        )
        json.dumps(seed, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
