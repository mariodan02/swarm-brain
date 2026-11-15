"""Copy the "Inside an LLM" page into another site as a self-contained static folder.

Used to publish it on the wiki (wiki.daniellomario.com/lab/inside-an-llm/):
    python3 tools/export_llm_page.py ~/dev/wiki/lab/inside-an-llm

The folder gets the page files, a copy of frontend/style.css (the page loads it from ../ inside
Swarm Brain) and a links.js whose "back" link leads to the wiki instead of Swarm Brain.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "frontend" / "llm"
FILES = ["index.html", "llm.css", "main.js", "gpt.js", "scene.js", "tour.js", "i18n.js", "model.json"]

WIKI_LINKS = """// Written by tools/export_llm_page.py for the wiki copy of the page.
export const LINKS = {
  back: {
    it: { href: '/it/llm-inference', text: '← wiki' },
    en: { href: '/llm-inference', text: '← wiki' },
  },
  wiki: {
    it: '/it/llm-inference',
    en: '/llm-inference',
  },
};
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    dest = Path(sys.argv[1]).expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(PAGE / name, dest / name)
    shutil.copyfile(ROOT / "frontend" / "style.css", dest / "style.css")
    html = (dest / "index.html").read_text(encoding="utf-8")
    if 'href="../style.css"' not in html:
        print("index.html: link to ../style.css not found", file=sys.stderr)
        return 1
    (dest / "index.html").write_text(html.replace('href="../style.css"', 'href="style.css"'), encoding="utf-8")
    (dest / "links.js").write_text(WIKI_LINKS, encoding="utf-8")
    print(f"exported {len(FILES) + 2} files to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
