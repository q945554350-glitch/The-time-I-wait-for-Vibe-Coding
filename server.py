#!/usr/bin/env python3
"""Serve the game and expose local task-completion events to the browser."""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
CODEX_SESSIONS = Path.home() / ".codex" / "sessions"


class TaskEvents:
    def __init__(self) -> None:
        self._events: deque[dict[str, object]] = deque(maxlen=50)
        self._seen_turns: set[str] = set()
        self._next_id = 1
        self._lock = threading.Lock()

    def publish(self, source: str, summary: str = "", turn_id: str = "") -> None:
        with self._lock:
            if turn_id and turn_id in self._seen_turns:
                return
            if turn_id:
                self._seen_turns.add(turn_id)
            self._events.append({
                "id": self._next_id,
                "source": source[:40] or "Code",
                "summary": summary[:160],
                "completedAt": int(time.time() * 1000),
            })
            self._next_id += 1

    def after(self, event_id: int) -> tuple[list[dict[str, object]], int]:
        with self._lock:
            events = [event for event in self._events if int(event["id"]) > event_id]
            return events, self._next_id - 1


class CodexMonitor(threading.Thread):
    """Watch Codex JSONL session tails without reading task contents."""

    def __init__(self, events: TaskEvents) -> None:
        super().__init__(name="codex-task-monitor", daemon=True)
        self.events = events
        self.offsets: dict[Path, int] = {}
        self.buffers: dict[Path, str] = {}

    def _session_files(self) -> list[Path]:
        if not CODEX_SESSIONS.exists():
            return []
        return list(CODEX_SESSIONS.glob("**/*.jsonl"))

    def _set_initial_offsets(self) -> None:
        for path in self._session_files():
            try:
                self.offsets[path] = path.stat().st_size
            except OSError:
                continue

    def _read_updates(self, path: Path) -> None:
        try:
            size = path.stat().st_size
            offset = self.offsets.get(path, 0)
            if size < offset:
                offset = 0
                self.buffers[path] = ""
            if size == offset:
                return
            with path.open("rb") as handle:
                handle.seek(offset)
                chunk = handle.read()
            self.offsets[path] = offset + len(chunk)
        except OSError:
            return

        text = self.buffers.get(path, "") + chunk.decode("utf-8", errors="replace")
        lines = text.split("\n")
        self.buffers[path] = lines.pop()
        for line in lines:
            if '"type":"task_complete"' not in line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = record.get("payload", {})
            if not isinstance(payload, dict) or payload.get("type") != "task_complete":
                continue
            turn_id = str(payload.get("turn_id", ""))
            self.events.publish("Codex", turn_id=turn_id)

    def run(self) -> None:
        self._set_initial_offsets()
        while True:
            for path in self._session_files():
                self._read_updates(path)
            time.sleep(1)


class GameHandler(SimpleHTTPRequestHandler):
    events: TaskEvents

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/task-events":
            try:
                after = max(0, int(parse_qs(parsed.query).get("after", ["0"])[0]))
            except ValueError:
                after = 0
            events, latest = self.events.after(after)
            self._send_json({"connected": True, "events": events, "latest": latest})
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True, "codexMonitor": CODEX_SESSIONS.exists()})
            return
        super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/task-complete":
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16384)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json({"error": "Invalid JSON"}, HTTPStatus.BAD_REQUEST)
            return
        if not isinstance(payload, dict):
            self._send_json({"error": "Invalid payload"}, HTTPStatus.BAD_REQUEST)
            return
        self.events.publish(str(payload.get("source", "Code")), str(payload.get("summary", "")))
        self._send_json({"ok": True}, HTTPStatus.CREATED)

    def log_message(self, format_string: str, *args: object) -> None:
        if self.path.startswith("/api/task-events"):
            return
        super().log_message(format_string, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Vibe Coding wait game with task monitoring.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    args = parser.parse_args()

    events = TaskEvents()
    GameHandler.events = events
    CodexMonitor(events).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), GameHandler)
    print(f"游戏已启动：http://127.0.0.1:{args.port}/")
    print("Codex 任务完成监听已开启。按 Control+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
