"""Download the trained inference weights from Hugging Face.

Cross-platform replacement for the `curl` lines in the README - works the
same on Windows, macOS and Linux with no extra dependencies.

    python scripts/fetch_weights.py                # -> weights/
    python scripts/fetch_weights.py --dest myrun   # -> myrun/

Skips files that already exist unless --force is given.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from pathlib import Path

HF_REPO = "Yytsi/floorplan-to-3d-walls"
FILES = ("best.safetensors", "config.yaml")
BASE_URL = f"https://huggingface.co/{HF_REPO}/resolve/main"


def _download(url: str, dest: Path) -> None:
    """Stream `url` to `dest`, printing a one-line progress meter."""
    is_tty = sys.stdout.isatty()
    # URL is a fixed https://huggingface.co path built from constants below.
    with urllib.request.urlopen(url) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        last_pct = -1
        chunk = 1 << 16
        tmp = dest.with_suffix(dest.suffix + ".part")
        with tmp.open("wb") as f:
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                f.write(buf)
                done += len(buf)
                # One line per whole percent (or per 5 MB when size is
                # unknown) so a redirected/CI log stays a few dozen lines,
                # not thousands.
                pct = int(done / total * 100) if total else -1
                if pct != last_pct or (not total and done // 5_000_000 != last_pct):
                    last_pct = pct if total else done // 5_000_000
                    bar = f"{pct:3d}%" if total else f"{done / 1e6:.0f} MB"
                    end = "\r" if is_tty else "\n"
                    print(f"  {dest.name}: {done / 1e6:6.1f} MB  {bar}", end=end, flush=True)
        tmp.replace(dest)
    if is_tty:
        print()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dest", type=Path, default=Path("weights"),
                   help="directory to write the weights into (default: weights/)")
    p.add_argument("--force", action="store_true", help="re-download even if the file exists")
    args = p.parse_args()

    args.dest.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        out = args.dest / name
        if out.exists() and not args.force:
            print(f"  {name}: already present ({out.stat().st_size / 1e6:.1f} MB) - skipping")
            continue
        url = f"{BASE_URL}/{name}"
        print(f"downloading {url}")
        try:
            _download(url, out)
        except Exception as e:
            print(f"\nfailed: {e}", file=sys.stderr)
            raise SystemExit(1) from e

    print(f"\nweights ready in {args.dest}/  - start the server with:  ./dev.ps1  (or ./dev.sh)")


if __name__ == "__main__":
    main()
