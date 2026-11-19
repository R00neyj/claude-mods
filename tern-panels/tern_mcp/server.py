"""Tern MCP bridge: exposes Tern native panels (markdown, mermaid, webview) as MCP tools."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

RENDERER = Path(__file__).with_name("renderer.py")
STATE_DIR = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "tern-mcp"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

mcp = MCPServer(
    "tern",
    instructions="Tern 터미널에 네이티브 패널(마크다운 뷰어·Mermaid 다이어그램·웹뷰)을 띄움. Tern pane 안에서 실행될 때만 동작함.",
)


class TernError(ToolError):
    """Surfaced to the model verbatim (plain exceptions are masked by mcp 2.x)."""


def _log(msg: str) -> None:
    print(f"[tern-mcp] {msg}", file=sys.stderr, flush=True)


def _pane() -> str:
    pane = os.environ.get("TERN_PANE")
    if not pane:
        raise TernError("TERN_PANE 없음: Tern 터미널 밖에서 실행 중임. Tern pane 안에서 Claude Code를 실행해야 함.")
    return pane


def _tern(*args: str, timeout: float = 20) -> str:
    exe = os.environ.get("TERN_EXE") or shutil.which("tern")
    if not exe:
        raise TernError("tern 실행 파일을 찾을 수 없음 (TERN_EXE / PATH).")
    r = subprocess.run(
        [exe, *args], capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout, creationflags=NO_WINDOW,
    )
    err = "\n".join(l for l in r.stderr.splitlines() if " WARN " not in l).strip()
    if r.returncode != 0:
        raise TernError(f"tern {args[0]} 실패: {err or r.stdout.strip()}")
    return r.stdout


def _browser(op: dict, timeout: float = 20) -> dict:
    out = json.loads(_tern("browser", json.dumps(op), "--timeout", str(int(timeout)), timeout=timeout + 5))
    if "error" in out:
        raise TernError(f"browser {op['op']} 실패: {out['error'].get('message')}")
    return out.get("ok") or {}


def _live_blocks() -> set[int]:
    found: set[int] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if "blocks" in node:
                found.update(b["id"] for b in node["blocks"] if b.get("live") and b.get("exited") is None)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(_tern("ls", "--json")))
    return found


def _browser_blocks() -> set[int]:
    return {b["block"] for b in _browser({"op": "blocks"}).get("blocks", [])}


PanelKind = Literal["markdown", "diagram"]
panels: dict[PanelKind, int] = {}
web_block: int | None = None


def _show_native(kind: PanelKind, payload: dict, split: str) -> str:
    """Writes the payload the renderer watches; reuses its pane when alive, else splits a new one."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / f"{kind}-{os.getpid()}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)

    block = panels.get(kind)
    if block is not None and block in _live_blocks():
        return f"기존 {kind} 패널(block {block}) 갱신함."
    out = _tern("split", "--json", _pane(), split, "--", sys.executable, str(RENDERER), str(path))
    panels[kind] = int(json.loads(out)["block"])
    return f"{kind} 패널 열림 (block {panels[kind]}). 패널에서 q/Esc로 닫음."


@mcp.tool()
def render_markdown_panel(
    filepath: str | None = None,
    content: str | None = None,
    title: str | None = None,
    split: Literal["right", "down"] = "right",
) -> str:
    """Show markdown in a native Tern panel (GUI sans font; mermaid fences render natively); `filepath` live-reloads with appended text typed out, or pass `content`."""
    if not filepath and content is None:
        raise TernError("filepath 또는 content 중 하나 필요함.")
    payload: dict = {"title": title}
    if filepath:
        src = Path(filepath).expanduser().resolve()
        if not src.is_file():
            raise TernError(f"파일 없음: {src}")
        payload["path"] = str(src)
    else:
        payload["text"] = content
    return _show_native("markdown", payload, split)


@mcp.tool()
def render_mermaid_diagram(code: str, title: str = "Diagram", split: Literal["right", "down"] = "right") -> str:
    """Render Mermaid code with Tern's built-in engine (vector, theme-aware) in its own native panel; reuses it."""
    body = f"```mermaid\n{code.strip()}\n```\n"
    return _show_native("diagram", {"title": title, "text": body}, split)


@mcp.tool()
def open_webview_panel(url: str, how: Literal["beside", "below", "pip"] = "beside") -> str:
    """Open a URL (e.g. local dev server http://localhost:3000) in a Tern browser panel; reuses it ("pip" = picture-in-picture)."""
    global web_block
    if not url.startswith(("http://", "https://")):
        raise TernError("http(s) URL만 지원함 (Tern browser 블록은 file:// 로드 안 됨).")
    if web_block is not None and web_block in _browser_blocks():
        _browser({"op": "goto", "block": web_block, "url": url})
    else:
        op = {"op": "open", "owner": int(_pane()), "url": url}
        if how != "pip":
            op["how"] = how
        web_block = int(_browser(op)["block"])
    return f"webview 패널 열림 (block {web_block}): {url}"


@mcp.tool()
def close_tern_panels() -> str:
    """Close every panel this server opened (markdown, diagram, webview)."""
    global web_block
    closed = []
    live = _live_blocks() if panels else set()
    for kind, block in panels.items():
        if block in live:
            _tern("close", str(block))
            closed.append(kind)
    if web_block is not None and web_block in _browser_blocks():
        _browser({"op": "close", "block": web_block})
        closed.append("webview")
    panels.clear()
    web_block = None
    return f"닫음: {', '.join(closed)}" if closed else "열린 패널 없음."


def main() -> None:
    _log(f"start pane={os.environ.get('TERN_PANE')} python={sys.executable}")
    mcp.run()


if __name__ == "__main__":
    main()
