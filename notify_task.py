#!/usr/bin/env python3
"""Tell a running game server that an external code task has completed."""

from __future__ import annotations

import argparse
import json
from urllib.error import URLError
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a task-complete event to the wait game.")
    parser.add_argument("source", nargs="?", default="Code", help="Name shown in the game popup")
    parser.add_argument("--summary", default="", help="Optional short completion note")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    body = json.dumps({"source": args.source, "summary": args.summary}).encode("utf-8")
    request = Request(
        f"http://127.0.0.1:{args.port}/api/task-complete",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=2) as response:
            if response.status != 201:
                raise SystemExit(f"通知失败：HTTP {response.status}")
    except URLError as error:
        raise SystemExit("通知失败：请先运行 python3 server.py") from error


if __name__ == "__main__":
    main()
