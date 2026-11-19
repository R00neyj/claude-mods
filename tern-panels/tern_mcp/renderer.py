"""Tern pane renderer: native markdown (sans font) that diffs per section and types appended text out smoothly."""

import json
import re
import sys
import time
from pathlib import Path

import tern_sdk
from tern_sdk import ui

FRAME_SEC = 1 / 60
IDLE_SEC = 0.1
REVEAL_SEC = 1.2
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
HEADING = re.compile(r"^#{1,6}\s")


def _utf8_console() -> None:
    if sys.platform == "win32":
        import ctypes

        # ConPTY가 cp949로 UTF-8 TSP 바이트를 깨뜨리는 것 방지
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)


def sections(text: str) -> list[str]:
    """Splits at headings outside code fences, so an edit re-renders only its own section."""
    out: list[str] = []
    cur: list[str] = []
    fence: str | None = None
    for line in text.splitlines(keepends=True):
        m = FENCE.match(line)
        if m:
            mark = m.group(1)[0]
            fence = None if fence == mark else (fence or mark)
        elif fence is None and HEADING.match(line) and cur:
            out.append("".join(cur))
            cur = []
        cur.append(line)
    if cur:
        out.append("".join(cur))
    return out


class Doc:
    """Target text plus the revealed prefix; appends type out over REVEAL_SEC, other edits land at once."""

    def __init__(self) -> None:
        self.target = ""
        self.shown = 0
        self.step = 1
        self.follow = False

    def set(self, text: str) -> None:
        if text == self.target:
            return
        if self.target and len(text) > self.shown and text.startswith(self.target[: self.shown]):
            self.follow = True
        else:
            self.shown = len(text)
        self.target = text
        self.step = max(1, round((len(text) - self.shown) * FRAME_SEC / REVEAL_SEC))

    @property
    def typing(self) -> bool:
        return self.shown < len(self.target)

    def tick(self) -> None:
        self.shown = min(len(self.target), self.shown + self.step)

    @property
    def visible(self) -> str:
        return self.target[: self.shown]


def _load(payload_path: Path) -> tuple[dict, Path | None]:
    data = json.loads(payload_path.read_text(encoding="utf-8"))
    return data, (Path(data["path"]) if data.get("path") else None)


def _read(data: dict, src: Path | None) -> tuple[str, str | None]:
    if src is None:
        return data.get("text", ""), None
    try:
        return src.read_text(encoding="utf-8"), None
    except OSError as e:
        return "", str(e)


def _view(title: str, meta: str | None, doc: Doc, error: str | None, stop) -> dict:
    head = ui.row(
        ui.text([ui.span(title, "title")], grow=1),
        ui.text([ui.span(meta, "muted")], truncate="start") if meta else None,
        ui.button("", icon="x", keys=["q"], variant="quiet", size="sm", title="닫기 (q / Esc)", key="close", on_click=stop),
        gap="sm",
        align="center",
        key="head",
    )
    if error:
        body = ui.card(ui.md(f"파일을 읽을 수 없음: `{error}`"), tone="error", key="err")
    elif not doc.target.strip():
        body = ui.empty(title="내용 없음", icon="doc", key="empty")
    else:
        parts = sections(doc.visible)
        nodes = [
            ui.md(p, stream=(doc.typing and i == len(parts) - 1) or None, key=f"s{i}")
            for i, p in enumerate(parts)
        ]
        body = ui.scroll(
            ui.col(*nodes, gap="md", max={"w": "96ch"}, key="doc"),
            stick="end" if doc.follow else None,
            key="body",
        )
    return {"main": ui.col(head, body, gap="sm", key="page")}


def _stamp(p: Path | None) -> int:
    try:
        return p.stat().st_mtime_ns if p else 0
    except OSError:
        return -1


def main() -> int:
    payload_path = Path(sys.argv[1])
    _utf8_console()
    session = tern_sdk.connect(app="tern-mcp")
    if session is None:
        print("TSP 미지원 환경. Tern pane 안에서 실행해야 함.")
        input()
        return 1

    running = True

    def stop(_ev=None) -> None:
        nonlocal running
        running = False

    doc = Doc()
    data: dict = {}
    src: Path | None = None
    seen: tuple[int, int] | None = None
    error: str | None = None
    with session, session.open(mode="screen", font="sans", closable=True) as surface:
        while running:
            dirty = False
            if (_stamp(payload_path), _stamp(src)) != seen:
                try:
                    data, src = _load(payload_path)
                    seen = (_stamp(payload_path), _stamp(src))
                    text, error = _read(data, src)
                    doc.set(text)
                    dirty = True
                except (OSError, ValueError):
                    pass
            if doc.typing:
                doc.tick()
                dirty = True
            if dirty:
                title = data.get("title") or (src.name if src else "Markdown")
                surface.render(**_view(title, str(src) if src else None, doc, error, stop))
            t0 = time.monotonic()
            item = session.poll(FRAME_SEC if doc.typing else IDLE_SEC)
            if isinstance(item, tern_sdk.Key) and (item.name in ("q", "escape") or (item.ctrl and item.name == "c")):
                break
            if item is not None and doc.typing:
                time.sleep(max(0.0, FRAME_SEC - (time.monotonic() - t0)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
