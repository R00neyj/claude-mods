"""Browser fallback outside a Tern pane: a localhost preview page per panel, live-updated over SSE."""

import json
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

POLL_SEC = 0.3
REOPEN_GRACE_SEC = 5.0
PAGE = Path(__file__).with_name("preview.html")


class _Panel:
    def __init__(self) -> None:
        self.title = ""
        self.path: Path | None = None
        self.text = ""
        self.version = 0
        self.closed = False
        self.mtime = 0
        self.clients = 0
        self.opened_at = 0.0

    def state(self) -> dict:
        return {
            "title": self.title,
            "path": str(self.path) if self.path else None,
            "text": self.text,
            "version": self.version,
            "closed": self.closed,
        }


class Preview:
    def __init__(self) -> None:
        self._panels: dict[str, _Panel] = {}
        self._cond = threading.Condition()
        self._server: ThreadingHTTPServer | None = None

    def show(self, kind: str, title: str, path: Path | None = None, text: str = "") -> str:
        """Updates the panel and opens a browser tab unless one is already connected."""
        self._ensure_started()
        with self._cond:
            p = self._panels.setdefault(kind, _Panel())
            p.title, p.path, p.closed = title, path, False
            p.text = _read(path) if path else text
            p.mtime = _mtime(path)
            p.version += 1
            self._cond.notify_all()
            need_open = p.clients == 0 and time.monotonic() - p.opened_at > REOPEN_GRACE_SEC
            if need_open:
                p.opened_at = time.monotonic()
        url = self.url(kind)
        if need_open:
            webbrowser.open(url)
            return f"{kind} 미리보기를 브라우저로 엶: {url}"
        return f"열린 브라우저 {kind} 미리보기 갱신함: {url}"

    def close_all(self) -> list[str]:
        with self._cond:
            closed = [k for k, p in self._panels.items() if not p.closed]
            for p in self._panels.values():
                p.closed = True
                p.version += 1
            self._cond.notify_all()
        return closed

    def url(self, kind: str) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/p/{kind}"

    def _ensure_started(self) -> None:
        if self._server is not None:
            return
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self._server.daemon_threads = True
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        threading.Thread(target=self._watch, daemon=True).start()
        print(f"[tern-mcp] browser preview on {self._server.server_address}", file=sys.stderr, flush=True)

    def _watch(self) -> None:
        while True:
            time.sleep(POLL_SEC)
            with self._cond:
                for p in self._panels.values():
                    if p.path and not p.closed and _mtime(p.path) != p.mtime:
                        p.mtime = _mtime(p.path)
                        p.text = _read(p.path)
                        p.version += 1
                        self._cond.notify_all()

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        preview = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                parts = self.path.split("?")[0].strip("/").split("/")
                if len(parts) == 2 and parts[0] == "p":
                    self._send(200, "text/html; charset=utf-8", PAGE.read_bytes())
                elif len(parts) == 2 and parts[0] == "events":
                    self._events(parts[1])
                else:
                    self._send(404, "text/plain; charset=utf-8", b"not found")

            def _send(self, code: int, ctype: str, body: bytes) -> None:
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _events(self, kind: str) -> None:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                cond = preview._cond
                with cond:
                    panel = preview._panels.setdefault(kind, _Panel())
                    panel.clients += 1
                sent = -1
                try:
                    while True:
                        with cond:
                            cond.wait_for(lambda: panel.version != sent, timeout=15)
                            changed = panel.version != sent
                            data = json.dumps(panel.state(), ensure_ascii=False) if changed else None
                            sent = panel.version
                        msg = f"data: {data}\n\n" if data else ": keepalive\n\n"
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                except (ConnectionError, OSError):
                    pass
                finally:
                    with cond:
                        panel.clients -= 1

            def log_message(self, *_a) -> None:
                pass

        return Handler


def _mtime(p: Path | None) -> int:
    try:
        return p.stat().st_mtime_ns if p else 0
    except OSError:
        return -1


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except OSError as e:
        return f"> 파일을 읽을 수 없음: `{e}`"
