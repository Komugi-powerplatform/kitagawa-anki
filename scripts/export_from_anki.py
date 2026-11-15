"""Mac の Anki のカードを、KitagawaAnki に取り込める JSON に書き出す。

使い方:
  python3 scripts/export_from_anki.py [出力先.json] [collection.anki2 のパス]

元のデータベースは書き換えない（一時フォルダにコピーしてから読む）。
「基本」型のノートを想定し、1番目の項目を表、2番目を裏にする。
"""
import html
import json
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

DEFAULT_COLLECTION = Path.home() / "Library/Application Support/Anki2/ユーザー 1/collection.anki2"
FIELD_SEP = "\x1f"


def html_to_text(s: str) -> str:
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(div|p|li)>\s*", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    return "\n".join(line.strip() for line in s.strip().splitlines())


def build_seed(collection: Path) -> dict:
    with tempfile.TemporaryDirectory() as d:
        copy = Path(d) / "collection.anki2"
        shutil.copy2(collection, copy)
        wal = collection.with_name(collection.name + "-wal")
        if wal.exists():
            shutil.copy2(wal, Path(d) / wal.name)
        db = sqlite3.connect(copy)
        # Anki の decks.name は独自の照合順序 unicase を使うため、読むために同名のものを登録する
        db.create_collation("unicase", lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()))
        rows = db.execute(
            """
            select d.name, n.flds
            from cards c join notes n on n.id = c.nid join decks d on d.id = c.did
            where c.ord = 0
            order by c.id
            """
        ).fetchall()
        db.close()
    cards = []
    for deck, flds in rows:
        parts = flds.split(FIELD_SEP)
        front = html_to_text(parts[0])
        back = html_to_text(parts[1]) if len(parts) > 1 else ""
        if front:
            cards.append({"deck": deck.split("\x1f")[-1], "front": front, "back": back})
    return {"format": "kitagawa-anki-seed", "cards": cards}


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("anki.import.json")
    collection = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_COLLECTION
    seed = build_seed(collection)
    out.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(seed['cards'])}枚を書き出しました: {out}")


if __name__ == "__main__":
    main()
