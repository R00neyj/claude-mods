# tern-panels

Claude Code에서 마크다운 뷰어·Mermaid·웹뷰 패널을 띄우는 로컬 MCP 서버. Tern pane 안이면 Tern 네이티브 패널, 밖(Windows Terminal 등)이면 기본 브라우저 미리보기로 열림.

## 구조

```
Claude Code ──stdio(JSON-RPC)──▶ tern-mcp (server.py)
   Tern pane 안 ($TERN_PANE)       ├─ tern split  ──▶ 새 pane: renderer.py (tern-sdk, TSP, sans 폰트)
                                   └─ tern browser ─▶ Tern 브라우저 블록 (웹뷰)
   Tern 밖                          ├─ 127.0.0.1 HTTP + SSE ─▶ 기본 브라우저 탭 (preview.html)
                                   └─ 웹뷰 URL ─▶ 기본 브라우저
```

- `tern-sdk`의 TSP는 데몬 소켓이 아니라 **pane tty 인밴드 이스케이프**로 통신함.
  MCP stdio 서버는 stdout이 JSON-RPC 파이프라 SDK로 직접 못 그림 → `tern split`으로 옆 pane을 만들고 거기서 `renderer.py`가 그림.
- 대상 pane은 `$TERN_PANE`(Claude Code가 돌고 있는 pane). `@focused` 아님.
- Tern 안에서 Mermaid는 TSP `md` 노드의 ```` ```mermaid ```` 펜스를 Tern 내장 merman 엔진이 직접 그림.
- Tern 밖에선 패널마다 localhost 페이지(`/p/markdown`, `/p/diagram`)를 열고 SSE로 갱신을 밀어줌. 탭이 연결돼 있으면 새 탭을 열지 않음.

## 렌더링

- Tern: surface를 `font="sans"`로 열어 omp처럼 UI 폰트로 그림. 헤딩 단위 섹션 노드로 나눠 바뀐 섹션만 diff 전송함.
- 브라우저: marked + DOMPurify + mermaid(CDN 고정 버전), 시스템 다크/라이트 테마, 그린 다이어그램은 캐시해 재사용.
- 공통: 파일 끝에 붙은 텍스트는 약 1.2초에 걸쳐 타이핑되듯 나타나고 스크롤은 끝을 따라감. 중간 수정·교체는 즉시 반영함.

## 도구

| 도구 | Tern pane 안 | Tern 밖 |
| --- | --- | --- |
| `render_markdown_panel(filepath?, content?, title?, split="right")` | 네이티브 마크다운 패널 | 브라우저 미리보기 |
| `render_mermaid_diagram(code, title?, split="right")` | Tern 내장 엔진, 별도 패널 | 브라우저 미리보기 (별도 탭) |
| `open_webview_panel(url, how="beside"\|"below"\|"pip")` | Tern 브라우저 블록 | 기본 브라우저 |
| `close_tern_panels()` | 연 패널 전부 닫기 | 미리보기 탭에 닫힘 표시 |

`filepath`는 파일 변경 시 자동 갱신하고, 열린 패널을 재사용함. Tern 패널은 `q` / `Esc` / 닫기 버튼으로 닫음.

## 설치

```
/plugin install tern-panels --marketplace R00neyj/claude-mods
```

[uv](https://docs.astral.sh/uv/) 필요함. 첫 실행 시 `uv run`이 플러그인 폴더에 venv를 만듦 (Python 3.11+).

## 제약

- 양방향 이벤트(패널 → 에이전트) 미지원. 단방향.
- Mermaid 문법 오류는 패널에만 표시되고 도구 결과로는 안 돌아옴.
- 브라우저 미리보기는 CDN(jsdelivr) 접근 필요. 미리보기 서버는 MCP 서버 수명과 같음 (세션 종료 시 탭 연결 끊김).
- `tern split`이 명령을 `pwsh -c` 한 줄로 합쳐 실행함 → 플러그인 설치 경로·상태 경로(`%LOCALAPPDATA%\tern-mcp`)에 공백 없어야 함.
- Windows에서 renderer가 콘솔 코드페이지를 UTF-8(65001)로 바꿈 (cp949면 TSP 한글이 깨짐).
