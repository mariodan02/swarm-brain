"""Copy the Swarm Brain dashboard into another site as a static page (no backend).

Used to publish it on the wiki (wiki.daniellomario.com/lab/swarm-brain/):
    python3 tools/export_brain_page.py ~/dev/wiki/lab/swarm-brain https://swarm-api.daniellomario.com

With the second argument the copy runs real agents through the Cloudflare Worker in worker/
and falls back to the in-browser simulator when the Worker refuses (limits reached, check
failed). Without it the copy only uses the simulator. Its link to "Inside an LLM" points to
the sibling folder ../inside-an-llm/ (see export_llm_page.py).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
FILES = ["index.html", "style.css", "main.js", "brain.js", "hud.js", "localsim.js", "analogies.js", "turnstile.js", "i18n.js"]
REWRITES = [
    ('<html lang="it">', '<html lang="it" data-static>'),       # main.js: skip the backend
    ('href="llm/"', 'href="../inside-an-llm/"'),
]


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    dest = Path(sys.argv[1]).expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(FRONTEND / name, dest / name)
    html = (dest / "index.html").read_text(encoding="utf-8")
    rewrites = list(REWRITES)
    if len(sys.argv) == 3:
        api = sys.argv[2].rstrip("/")
        if not api.startswith(("https://", "http://")) or '"' in api:
            print("the API address must be an http(s) URL", file=sys.stderr)
            return 2
        rewrites[0] = ('<html lang="it">', f'<html lang="it" data-static data-api="{api}">')
    for old, new in rewrites:
        if html.count(old) != 1:
            print(f"index.html: expected exactly one {old!r}", file=sys.stderr)
            return 1
        html = html.replace(old, new)
    (dest / "index.html").write_text(html, encoding="utf-8")
    print(f"exported {len(FILES)} files to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
