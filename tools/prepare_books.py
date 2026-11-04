#!/usr/bin/env python3
"""Turn Project Gutenberg plain-text downloads into the clean public-domain texts in books/.

Usage: python3 tools/prepare_books.py <dir with pgNNN.txt files>
Strips the Gutenberg header, footer and licence (and every reference to the trademark),
front matter and contents lists, illustration notes and _italic_ markers, then writes
books/<id>.txt and books/catalog.json.
"""
import json, pathlib, re, subprocess, sys

BOOKS = [  # id, gutenberg no., title, author, year, regex for the first line of the text
    ("call-of-the-wild", 215, "The Call of the Wild", "Jack London", 1903, r"^Chapter I\. Into the Primitive"),
    ("jekyll-and-hyde", 43, "Strange Case of Dr Jekyll and Mr Hyde", "Robert Louis Stevenson", 1886, r"^STORY OF THE DOOR$"),
    ("a-christmas-carol", 46, "A Christmas Carol", "Charles Dickens", 1843, r"^STAVE I:"),
    ("alice", 11, "Alice's Adventures in Wonderland", "Lewis Carroll", 1865, r"^CHAPTER I\.$"),
    ("the-time-machine", 35, "The Time Machine", "H. G. Wells", 1895, r"^ I\.$"),
    ("the-great-gatsby", 64317, "The Great Gatsby", "F. Scott Fitzgerald", 1925, r"^\s{20,}I$"),
    ("frankenstein", 84, "Frankenstein", "Mary Shelley", 1818, r"^Letter 1$"),
    ("dorian-gray", 174, "The Picture of Dorian Gray", "Oscar Wilde", 1890, r"^THE PREFACE$"),
    ("sherlock-holmes", 1661, "The Adventures of Sherlock Holmes", "Arthur Conan Doyle", 1892, r"^I\. A SCANDAL IN BOHEMIA$"),
    ("pride-and-prejudice", 1342, "Pride and Prejudice", "Jane Austen", 1813, r"^\[Illustration: ·PRIDE AND PREJUDICE·$"),
]

def clean(raw: str, start: str) -> str:
    t = raw.replace("\r\n", "\n").replace("﻿", "")
    t = t[re.search(r"^\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG.*$", t, re.M).end():]
    t = t[: re.search(r"^\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG", t, re.M).start()]
    m = re.search(start, t, re.M)
    assert m, start
    t = t[m.start():]
    # illustration notes; keep a chapter heading if one was printed inside the picture
    def ill(mo):
        h = re.search(r"chapter\s+([IVXLC]+)\b", mo.group(1), re.I)
        return f"\n\nCHAPTER {h.group(1).upper()}.\n\n" if h else "\n\n"
    t = re.sub(r"\[Illustration:?(.*?)\]", ill, t, flags=re.S)
    t = re.sub(r"^\s*\[[^\]\n]{0,200}\]\s*$", "", t, flags=re.M)          # [Sidenote], [Copyright ...]
    t = re.sub(r"_([^_]{1,300}?)_", r"\1", t, flags=re.S)                  # _italics_
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n[ \t]*\n+", t)]
    paras = [p for p in paras if re.search(r"\w", p)]
    assert not any("gutenberg" in p.lower() for p in paras)
    return "\n\n".join(paras) + "\n"

def main(src: pathlib.Path):
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / "books"; out.mkdir(exist_ok=True)
    catalog = []
    for bid, num, title, author, year, start in BOOKS:
        text = clean((src / f"pg{num}.txt").read_text(encoding="utf-8"), start)
        (out / f"{bid}.txt").write_text(text, encoding="utf-8")
        words = len(text.split())
        catalog.append({"id": bid, "title": title, "author": author, "year": year, "words": words, "file": f"{bid}.txt"})
        print(f"{bid:22} {words:7d} words  starts: {text[:60]!r}")
    catalog.sort(key=lambda b: b["words"])
    (out / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    # token and pause counts come from the reader's own tokenizer
    subprocess.run(["node", str(root / "tools" / "annotate_catalog.js")], check=True)

if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1]))
