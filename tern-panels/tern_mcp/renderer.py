"""Tern pane renderer: draws a markdown payload natively (sans font) and live-reloads it."""

import json
import sys
from pathlib import Path

import tern_sdk
from tern_sdk import ui

POLL_SEC = 0.3


def _mtime(p: Path | None) -> float:
    try:
        return p.stat().st_mtime if p else 0.0
    except OSError:
        return -1.0


def _load(payload_path: Path) -> tuple[dict, Path | None]:
    data = json.loads(payload_path.read_text(encoding="utf-8"))
    src = Path(data["path"]) if data.get("path") else None
    return data, src


def _view(data: dict, src: Path | None, stop) -> object:
    close = ui.button("닫기", icon="x", keys=["q"], variant="quiet", key="close", on_click=stop)
    title = data.get("title") or (src.name if src else "Markdown")
    try:
        text = src.read_text(encoding="utf-8") if src else data.get("text", "")
    except OSError as e:
        return ui.card(ui.md(f"파일을 읽을 수 없음: `{e}`"), head=title, icon="file", tone="error", end=close, key="c")
    if not text.strip():
        return ui.empty(title=title, text="내용 없음", icon="doc", key="c")
    return ui.card(
        ui.scroll(ui.md(text), key="body"),
        head=title,
        icon="doc",
        meta=str(src) if src else None,
        end=close,
        key="c",
    )


def _utf8_console() -> None:
    if sys.platform == "win32":
        import ctypes

        # ConPTY가 cp949로 UTF-8 TSP 바이트를 깨뜨리는 것 방지
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)


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

    with session, session.open(mode="screen", font="sans", closable=True) as surface:
        data, src = _load(payload_path)
        seen = (_mtime(payload_path), _mtime(src))
        surface.render(_view(data, src, stop))
        while running:
            item = session.poll(POLL_SEC)
            if isinstance(item, tern_sdk.Key) and (item.name in ("q", "escape") or (item.ctrl and item.name == "c")):
                break
            now = (_mtime(payload_path), _mtime(src))
            if now != seen:
                try:
                    data, src = _load(payload_path)
                except (OSError, ValueError):
                    continue
                seen = (_mtime(payload_path), _mtime(src))
                surface.render(_view(data, src, stop))
    return 0


if __name__ == "__main__":
    sys.exit(main())
