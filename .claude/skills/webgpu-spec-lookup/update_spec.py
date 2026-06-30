#!/usr/bin/env python3
"""Cache + preprocess the W3C WebGPU spec for grep-based lookup.

Downloads https://www.w3.org/TR/webgpu/ once per day: if the cached copy's
mtime date differs from today's date, re-download and re-process; otherwise
reuse it. Preprocessing strips <script>/<style>/<head> and all tags, collapses
runs of whitespace, and prefixes each heading with its `[#anchor]` id so a grep
hit can be traced back to a spec section. Prints the cache file path on stdout.

stdlib only, no deps. Run: python3 update_spec.py   (then grep the printed path)
"""
import datetime
import pathlib
import re
import sys
import urllib.request
from html.parser import HTMLParser

URL = "https://www.w3.org/TR/webgpu/"
CACHE = pathlib.Path(__file__).parent / "webgpu-spec.txt"
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCK = HEADINGS | {"p", "li", "tr", "section", "dt", "dd", "pre", "table"}


def fresh(p: pathlib.Path) -> bool:
    """True if the cache exists and was last written today (local date)."""
    if not p.exists():
        return False
    mtime = datetime.date.fromtimestamp(p.stat().st_mtime)
    return mtime == datetime.date.today()


# All balanced (have explicit close tags). NOT "head": HTML5 omits </head>,
# so counting it leaves skip stuck >0 and drops the whole body.
class Strip(HTMLParser):
    SKIP = {"script", "style", "title"}

    def __init__(self):
        super().__init__()
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
            return
        if tag in HEADINGS:
            anchor = dict(attrs).get("id")
            self.out.append(f"\n[#{anchor}] " if anchor else "\n")
        elif tag in BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        # ponytail: flatten source-wrapped newlines to spaces so block breaks come
        # only from start tags (keeps phrases greppable). Loses <pre>/IDL line
        # layout — track a `pre` depth and skip the replace there if that matters.
        if not self.skip:
            self.out.append(data.replace("\n", " "))


def preprocess(html: str) -> str:
    p = Strip()
    p.feed(html)
    text = "".join(p.out)
    text = re.sub(r"[ \t]+", " ", text)      # collapse inline whitespace
    text = re.sub(r"\n[ \t]+", "\n", text)    # trim line starts
    text = re.sub(r"\n{3,}", "\n\n", text)    # cap blank runs
    return text.strip() + "\n"


def main():
    if not fresh(CACHE):
        html = urllib.request.urlopen(URL, timeout=60).read().decode("utf-8", "replace")
        CACHE.write_text(preprocess(html), encoding="utf-8")
    print(CACHE)


def _selftest():
    html = (
        "<head><title>x</title></head>"
        "<script>var a=1;</script>"
        "<h2 id='limits'>Limits</h2>"
        "<p>maxStorageBufferBindingSize    is\n\n  134217728.</p>"
        "<style>.a{}</style>"
    )
    out = preprocess(html)
    assert "var a=1" not in out, "script not stripped"
    assert ".a{}" not in out, "style not stripped"
    assert "[#limits] Limits" in out, "heading anchor missing"
    assert "maxStorageBufferBindingSize is 134217728." in out, "whitespace not collapsed"
    assert "\n\n\n" not in out, "blank runs not capped"
    # freshness: a file touched now reads as fresh; a 1970 mtime does not
    import tempfile, os
    f = pathlib.Path(tempfile.mktemp())
    f.write_text("x")
    assert fresh(f), "just-written file should be fresh"
    os.utime(f, (0, 0))
    assert not fresh(f), "epoch-0 file should be stale"
    f.unlink()
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        main()
