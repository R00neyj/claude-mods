# tern-panels

Claude Code 등 타사 CLI 에이전트에서 Tern 네이티브 패널(마크다운 뷰어·웹뷰·Mermaid)을 띄우는 로컬 MCP 서버.

## 구조

```
Claude Code ──stdio(JSON-RPC)──▶ tern-mcp (server.py)
                                   ├─ tern split  ──▶ 새 pane: renderer.py (tern-sdk, TSP, sans 폰트)
                                   └─ tern browser ─▶ Tern 브라우저 블록 (웹뷰 / Mermaid)
```

- 가이드 문서와 다른 점: `tern-sdk`의 TSP는 데몬 소켓이 아니라 **pane tty 인밴드 이스케이프**로 통신함.
  MCP stdio 서버는 stdout이 JSON-RPC 파이프라 SDK로 직접 못 그림 → `tern split`으로 옆 pane을 만들고 거기서 `renderer.py`가 그림.
- 대상 pane은 `$TERN_PANE`(Claude Code가 돌고 있는 pane). `@focused` 아님.
- Mermaid 페이지는 서버 내부 `127.0.0.1` HTTP로 서빙함 (Tern 브라우저 블록은 `file://` 로드 안 됨).

## 도구

| 도구 | 동작 |
| --- | --- |
| `render_markdown_panel(filepath? , content?, title?, split="right")` | 네이티브 마크다운 패널 (GUI sans 폰트). `filepath`는 파일 변경 시 자동 갱신. 열린 패널 재사용 |
| `open_webview_panel(url, how="beside"\|"below"\|"pip")` | http(s) URL을 브라우저 블록으로 열기. 재사용 |
| `render_mermaid_diagram(code, title?, how?)` | Mermaid 렌더링(mermaid@11.4.1 CDN). 문법 오류는 도구 결과로 반환 |
| `close_tern_panels()` | 이 서버가 연 패널 전부 닫기 |

마크다운 패널은 `q` / `Esc` / 닫기 버튼으로 닫음.

## 설치

```
/plugin install tern-panels --marketplace R00neyj/claude-mods
```

[uv](https://docs.astral.sh/uv/) 필요함. 첫 실행 시 `uv run`이 플러그인 폴더에 venv를 만듦 (Python 3.11+).

## 제약

- 반드시 Tern pane 안에서 Claude Code 실행 (`TERN_PANE` 없으면 도구가 오류 반환).
- 양방향 이벤트(패널 → 에이전트) 미지원. 단방향.
- `tern split`이 명령을 `pwsh -c` 한 줄로 합쳐 실행함 → 플러그인 설치 경로·상태 경로(`%LOCALAPPDATA%\tern-mcp`)에 공백 없어야 함.
- Mermaid는 CDN 접근 필요.
