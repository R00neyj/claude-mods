"""Tern MCP bridge: exposes Tern native panels (markdown, webview, mermaid) as MCP tools."""

import html
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"
RENDERER = Path(__file__).with_name("renderer.py")
STATE_DIR = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "tern-mcp"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

mcp = MCPServer(
    "tern",
    instructions="Tern 터미널에 네이티브 패널(마크다운 뷰어·웹뷰·Mermaid 다이어그램)을 띄움. Tern pane 안에서 실행될 때만 동작함.",
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


class _Pages:
    """In-process localhost server for generated HTML (file:// does not load in Tern browser blocks)."""

    def __init__(self) -> None:
        self._pages: dict[str, bytes] = {}
        self._server: ThreadingHTTPServer | None = None

    def put(self, body: str) -> str:
        if self._server is None:
            self._start()
        pid = uuid.uuid4().hex[:12]
        self._pages[pid] = body.encode("utf-8")
        return f"http://127.0.0.1:{self._server.server_address[1]}/p/{pid}"

    def _start(self) -> None:
        pages = self._pages

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                body = pages.get(self.path.rsplit("/", 1)[-1])
                self.send_response(200 if body else 404)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body or b"not found")

            def log_message(self, *_a) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()
        _log(f"page server on {self._server.server_address}")


class _State:
    md_block: int | None = None
    web_block: int | None = None
    diagram_block: int | None = None


pages = _Pages()
state = _State()


def _mermaid_html(code: str, title: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{{--bg:#ffffff;--fg:#1f2328;--err:#cf222e}}
@media (prefers-color-scheme: dark){{:root{{--bg:#1e1e1e;--fg:#e6e6e6;--err:#ff7b72}}}}
body{{margin:0;padding:24px;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}}
h1{{font-size:14px;font-weight:600;margin:0 0 16px;opacity:.7}}
.mermaid{{display:flex;justify-content:center}} #err{{color:var(--err);white-space:pre-wrap;font-family:monospace}}
</style></head><body><h1>{html.escape(title)}</h1>
<pre class="mermaid">{html.escape(code)}</pre><div id="err"></div>
<script src="{MERMAID_CDN}"></script>
<script>
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
mermaid.initialize({{startOnLoad:false, theme: dark ? 'dark' : 'default', securityLevel:'strict'}});
mermaid.run().catch(e => {{ document.getElementById('err').textContent = String(e.message || e); }});
</script></body></html>"""


def _show_in_browser(url: str, attr: Literal["web_block", "diagram_block"], how: str) -> int:
    """Navigates the panel this server already owns, else opens one ("pip" = picture-in-picture over this pane)."""
    block = getattr(state, attr)
    if block is not None and block in _browser_blocks():
        _browser({"op": "goto", "block": block, "url": url})
        return block
    op = {"op": "open", "owner": int(_pane()), "url": url}
    if how != "pip":
        op["how"] = how
    block = int(_browser(op)["block"])
    setattr(state, attr, block)
    return block


def _write_payload(payload: dict) -> Path:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / f"md-{os.getpid()}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return path


@mcp.tool()
def render_markdown_panel(
    filepath: str | None = None,
    content: str | None = None,
    title: str | None = None,
    split: Literal["right", "down"] = "right",
) -> str:
    """Show markdown in a native Tern panel (GUI sans font) beside this pane; `filepath` live-reloads, or pass `content`."""
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
    payload_path = _write_payload(payload)

    if state.md_block is not None and state.md_block in _live_blocks():
        return f"기존 markdown 패널(block {state.md_block}) 갱신함."
    out = _tern("split", "--json", _pane(), split, "--", sys.executable, str(RENDERER), str(payload_path))
    state.md_block = int(json.loads(out)["block"])
    return f"markdown 패널 열림 (block {state.md_block}). 패널에서 q/Esc로 닫음."


@mcp.tool()
def open_webview_panel(url: str, how: Literal["beside", "below", "pip"] = "beside") -> str:
    """Open a URL (e.g. local dev server http://localhost:3000) in a Tern browser panel. Reuses the open panel."""
    if not url.startswith(("http://", "https://")):
        raise TernError("http(s) URL만 지원함 (Tern browser 블록은 file:// 로드 안 됨).")
    block = _show_in_browser(url, "web_block", how)
    return f"webview 패널 열림 (block {block}): {url}"


@mcp.tool()
def render_mermaid_diagram(code: str, title: str = "Diagram", how: Literal["beside", "below"] = "beside") -> str:
    """Render Mermaid diagram code in a Tern browser panel. Syntax errors are shown in the panel."""
    url = pages.put(_mermaid_html(code, title))
    block = _show_in_browser(url, "diagram_block", how)
    try:
        res = _browser({"op": "eval", "block": block, "function": _MERMAID_CHECK}, timeout=10)
        if isinstance(res.get("value"), str) and res["value"].startswith("ERR:"):
            return f"diagram 패널(block {block}) 열렸으나 Mermaid 오류: {res['value'][4:]}"
    except (TernError, ValueError, subprocess.TimeoutExpired) as e:
        _log(f"mermaid check skipped: {e}")
    return f"diagram 패널 열림 (block {block})."


_MERMAID_CHECK = """async () => {
  for (let i = 0; i < 40; i++) {
    const err = document.getElementById('err');
    if (err && err.textContent) return 'ERR:' + err.textContent;
    if (document.querySelector('.mermaid svg')) return 'OK';
    await new Promise(r => setTimeout(r, 150));
  }
  return 'PENDING';
}"""


@mcp.tool()
def close_tern_panels() -> str:
    """Close every panel this server opened (markdown, webview, diagram)."""
    closed = []
    if state.md_block is not None and state.md_block in _live_blocks():
        _tern("close", str(state.md_block))
        closed.append("markdown")
    browsers = _browser_blocks() if (state.web_block or state.diagram_block) else set()
    for name, attr in (("webview", "web_block"), ("diagram", "diagram_block")):
        block = getattr(state, attr)
        if block is not None and block in browsers:
            _browser({"op": "close", "block": block})
            closed.append(name)
    state.md_block = state.web_block = state.diagram_block = None
    return f"닫음: {', '.join(closed)}" if closed else "열린 패널 없음."


def main() -> None:
    _log(f"start pane={os.environ.get('TERN_PANE')} python={sys.executable}")
    mcp.run()


if __name__ == "__main__":
    main()
