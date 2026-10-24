// tidy-tools: tool rows drawn as omp-style cards (oh-my-pi, packages/tui/src/tools):
// a rounded frame with the title in its top border and facts in its bottom one,
// only what changed inside, code and diffs through the engine's highlighter.
// Diffs keep the engine's green / red line backgrounds. /tidy-tools toggles it.

import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BgMode, Durations } from '../types'

const isOff = atom({ plugin: 'tidy-tools', key: 'isOff' } as const, false)
const durations = atom({ plugin: 'tidy-tools', key: 'durations' } as const, {} as Durations)
const bgMode = atom({ plugin: 'tidy-tools', key: 'bgMode' } as const, 'auto' as BgMode)
// Per card (keyed by tool_use_id): whether its expand button lifts the line limits
const isOpen = atom({ plugin: 'tidy-tools', key: 'isOpen' } as const, false)

// omp's card backgrounds (theme/dark.json, theme/light.json): pending, success, error
const BG = {
  dark: { pending: '#1d2129', ok: '#161a1f', error: '#291d1d' },
  light: { pending: '#e8e8f0', ok: '#e8f0e8', error: '#f0e8e8' },
}

// The API does not say which palette "auto" resolved to; a theme setting naming
// light is read as light, anything else as dark
let isLightTheme = false

const TOOLS = ['Edit', 'Write', 'Bash', 'PowerShell', 'Read', 'Grep', 'Glob']

// omp's collapsed limits (render-utils.ts, write.ts)
const DIFF_LINES = 40
const DIFF_HUNKS = 8
const WRITE_LINES = 6
const READ_LINES = 12
const OUTPUT_LINES = 10
const GREP_LINES = 6
const GLOB_ITEMS = 8

// omp's unicode glyphs (theme/symbols.ts)
const G = { ok: '✔', err: '✘', running: '…', aborted: '⏹ 중단', edit: '✎', create: '＋', shell: '$', read: '→', search: '⌕' }

// Theme keys, so the cards follow the person's light or dark theme
const ACCENT = 'claude'
const MUTED = 'subtle'
const BORDER = 'inactive'

type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
type State = 'running' | 'ok' | 'error' | 'aborted'

// Text refuses control characters: drop ANSI escapes and everything but tab and newline
function clean(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function relPath(p: string, cwd: string): string {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = norm(p)
  const root = norm(cwd)
  return root && file.toLowerCase().startsWith(root.toLowerCase() + '/') ? file.slice(root.length + 1) : file
}

function stateOf(p: { isRunning: boolean; isErrored: boolean; isInterrupted: boolean }): State {
  if (p.isInterrupted) return 'aborted'
  if (p.isErrored) return 'error'
  if (p.isRunning) return 'running'
  return 'ok'
}

const borderColor = (s: State) => (s === 'error' || s === 'aborted' ? 'error' : s === 'running' ? ACCENT : BORDER)

function counts(hunks: Hunk[]) {
  let add = 0
  let del = 0
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) add += 1
      else if (l.startsWith('-')) del += 1
    }
  }
  return { add, del }
}

// Whole hunks up to the budget for the engine's diff (green / red line backgrounds);
// a hunk cut short gets its header recounted so it still parses
function diffSource(hunks: Hunk[], lineBudget: number, hunkBudget: number) {
  const out: string[] = []
  let used = 0
  let hiddenLines = 0
  let hiddenHunks = 0
  hunks.forEach((h, i) => {
    const room = lineBudget - used
    if (room <= 0 || i >= hunkBudget) {
      hiddenLines += h.lines.length
      hiddenHunks += 1
      return
    }
    const kept = h.lines.slice(0, room).map(clean)
    hiddenLines += h.lines.length - kept.length
    const oldN = kept.filter(l => !l.startsWith('+')).length
    const newN = kept.filter(l => !l.startsWith('-')).length
    out.push(`@@ -${h.oldStart},${oldN} +${h.newStart},${newN} @@`, ...kept)
    used += kept.length
  })
  return { source: out.join('\n'), hiddenLines, hiddenHunks }
}

function lines(text: string): string[] {
  const all = clean(text).replace(/\s+$/, '').split('\n')
  return all.length === 1 && all[0] === '' ? [] : all
}

function wall(ms: number | undefined): string {
  if (ms === undefined) return ''
  return ms < 60_000 ? `Wall: ${(ms / 1000).toFixed(2)}s` : `Wall: ${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      isLightTheme = /light/i.test(String((await $.settings.read({ key: 'theme' })) ?? ''))
    } catch {}
    await $.command.register({
      name: 'tidy-tools',
      description: 'Toggle omp-style tool cards; "bg auto|dark|light|off" sets the card background',
      argumentHint: '[bg auto|dark|light|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'tidy-tools' }, async ($, e) => {
    const bg = e.args.trim().match(/^bg\s+(auto|dark|light|off)$/i)?.[1]?.toLowerCase() as BgMode | undefined
    if (bg) {
      await update($, bgMode, () => bg)
      return { text: `tidy-tools 카드 배경: ${bg}` }
    }
    const now = await update($, isOff, v => !v)
    return { text: now ? 'tidy-tools 꺼짐: 기본 도구 표시로 돌아감' : 'tidy-tools 켜짐: omp 스타일 카드' }
  })

  // Times each call for the "Wall:" fact; the call itself passes through untouched
  on('tool.call', async ($, e, next) => {
    if (!TOOLS.includes(e.tool)) return next(e)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    try {
      const ms = (await $.clock.now()) - startedAt
      await update($, durations, d => {
        const keys = Object.keys(d)
        const kept = keys.length > 300 ? Object.fromEntries(keys.slice(-200).map(k => [k, d[k] ?? 0])) : d
        return { ...kept, [e.tool_use_id]: ms }
      })
    } catch {}
    return ran
  })

  // The card draws the output itself, so the result block under it goes empty
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !TOOLS.includes(e.props.tool) || (await read($, isOff))) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !TOOLS.includes(e.props.tool) || (await read($, isOff))) return next(e)

    const { Box, Text, Code, Button } = $.ui.resolve(e)
    const p = e.props
    const input = (p.input ?? {}) as Record<string, unknown>
    const out = p.output as any
    const state = stateOf(p)
    const cwd = await $.session.cwd()
    const ms = (await read($, durations))[p.tool_use_id]
    const mode = await read($, bgMode)
    const palette = mode === 'off' ? null : BG[mode === 'light' || (mode === 'auto' && isLightTheme) ? 'light' : 'dark']
    const bg = palette && (state === 'ok' ? palette.ok : state === 'running' ? palette.pending : palette.error)
    const errLines = state === 'error' && typeof out === 'string' ? lines(out) : []
    // The card's own expand state; the engine's isExpanded is true for every row under verbose
    const open = memberOf(isOpen, e)
    const isOpened = await read($, open)
    const lim = (n: number) => (isOpened ? Infinity : n)
    // Transcript rows sit indented; leave room for it
    const width = Math.max(30, (e.viewport?.columns ?? 100) - 4)

    // ╭─── title ───╮ … ╰─── facts ───╯: the title and facts are painted over the border rows
    const frame = (title: any, facts: string[], body: any, color = borderColor(state)) => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={width} backgroundColor={bg ?? undefined}>
        {title && (
          <Box position="absolute" top={-1} left={3}>
            <Text wrap="truncate-end">
              {' '}
              {title}{' '}
            </Text>
          </Box>
        )}
        {facts.length > 0 && (
          <Box position="absolute" bottom={-1} left={3}>
            <Text color={MUTED}> {facts.join(' · ')} </Text>
          </Box>
        )}
        {body}
      </Box>
    )
    const section = (label: string) => (
      <Text color={BORDER} wrap="truncate-end">
        {'─── '}
        <Text color="text">{label}</Text> {'─'.repeat(Math.max(0, width - 10 - label.length))}
      </Text>
    )
    const muted = (t: string) => (
      <Text color={MUTED} wrap="truncate-end">
        {t}
      </Text>
    )
    // Title in the first version's look: orange glyph, bold tool name, target, status mark at the end
    const status =
      state === 'running' ? (
        <Text color={MUTED}> {G.running}</Text>
      ) : state === 'error' ? (
        <Text color="error"> {G.err}</Text>
      ) : state === 'aborted' ? (
        <Text color="warning"> {G.aborted}</Text>
      ) : (
        <Text color="success"> {G.ok}</Text>
      )
    const heading = (glyph: string, name: string, target: string, extra?: any) => (
      <Text>
        <Text color={ACCENT}>{glyph} </Text>
        <Text weight="bold">{name}</Text>
        {target && <Text> {target}</Text>}
        {extra}
        {status}
      </Text>
    )
    // Shown when the card hides something, or is open; a press flips this card alone
    const toggle = (hasMore: boolean) =>
      (hasMore || isOpened) && (
        <Box justifyContent="flex-end">
          <Button key="expand" plain dimColor label={isOpened ? '▾ 접기' : '▸ 펼치기'} onPress={() => update($, open, v => !v)} />
        </Box>
      )
    const errorBody = errLines.slice(-lim(OUTPUT_LINES)).map(l => (
      <Text color="error" wrap="truncate-end">
        {l}
      </Text>
    ))

    switch (p.tool) {
      case 'Edit':
      case 'Write': {
        const file = str(input.file_path)
        const rel = relPath(file, cwd)
        const isNew = p.tool === 'Write' && out?.type === 'create'
        // A new file is one all-added hunk, so it gets the same green rows as an edit
        const content = isNew ? lines(str(input.content)) : []
        const hunks: Hunk[] = isNew
          ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: content.length, lines: content.map(l => '+' + l) }]
          : Array.isArray(out?.structuredPatch)
            ? out.structuredPatch
            : []
        const { add, del } = counts(hunks)
        const diff = isNew ? diffSource(hunks, lim(WRITE_LINES), 1) : diffSource(hunks, lim(DIFF_LINES), lim(DIFF_HUNKS))
        const stat = hunks.length ? (
          <Text>
            {'  '}
            <Text color="diffAdded">+{add}</Text>
            {isNew ? <Text color={MUTED}> (새 파일)</Text> : <Text color="diffRemoved"> −{del}</Text>}
          </Text>
        ) : undefined
        const more =
          (diff.hiddenHunks > 0 || diff.hiddenLines > 0) &&
          `… (${[diff.hiddenHunks && plural(diff.hiddenHunks, 'more hunk'), diff.hiddenLines && plural(diff.hiddenLines, 'more line')]
            .filter(Boolean)
            .join(', ')})`
        return frame(
          heading(isNew ? G.create : G.edit, p.tool, rel, stat),
          state === 'ok' ? [wall(ms)].filter(Boolean) : [],
          <Box flexDirection="column">
            {diff.source && <Code source={diff.source} format="diff" path={file} wrap="truncate-end" />}
            {more && muted(more)}
            {errorBody}
            {!diff.source && !errorBody.length && muted(state === 'running' ? '…' : '(변경 없음)')}
            {toggle(Boolean(more) || errLines.length > OUTPUT_LINES)}
          </Box>,
        )
      }

      case 'Bash':
      case 'PowerShell': {
        const cmd = lines(str(input.command))
        const shown = cmd.slice(-lim(OUTPUT_LINES))
        const text = out && typeof out === 'object' ? [str(out.stdout), str(out.stderr)].filter(Boolean).join('\n') : ''
        const outLines = state === 'error' ? errLines : lines(text)
        const tail = outLines.slice(-lim(OUTPUT_LINES))
        const exit = state === 'error' ? (errLines[0]?.match(/^Exit code (\d+)/)?.[1] ?? '') : ''
        const facts = [wall(ms), exit && `Exit: ${exit}`].filter(Boolean) as string[]
        const desc = str(input.description)
        return frame(
          heading(G.shell, p.tool, '', desc ? <Text color={MUTED}> {clean(desc)}</Text> : undefined),
          facts,
          <Box flexDirection="column">
            {cmd.length > shown.length && muted(`… ${plural(cmd.length - shown.length, 'earlier line')}`)}
            <Code source={shown.join('\n')} language={p.tool === 'Bash' ? 'bash' : 'powershell'} wrap="truncate-end" />
            {tail.length > 0 && section('Output')}
            {outLines.length > tail.length &&
              muted(`… (${plural(outLines.length - tail.length, 'earlier line')}, showing ${tail.length} of ${outLines.length})`)}
            {tail.map(l => (
              <Text color={state === 'error' ? 'error' : undefined} wrap="truncate-end">
                {l}
              </Text>
            ))}
            {toggle(cmd.length > shown.length || outLines.length > tail.length)}
          </Box>,
        )
      }

      case 'Read': {
        const file = str(input.file_path)
        const rel = relPath(file, cwd)
        const f = out?.file
        const isText = out?.type === 'text' && f
        const range = isText && f.numLines < f.totalLines ? `:${f.startLine}-${f.startLine + f.numLines - 1}` : ''
        if (state === 'running') return heading(G.read, 'Read', rel)
        const code = isText ? lines(str(f.content)) : []
        const shown = code.slice(0, lim(READ_LINES))
        const kind = out?.type && out.type !== 'text' ? ` (${out.type})` : ''
        return frame(
          heading(G.read, 'Read', rel + range, kind ? <Text color={MUTED}>{kind}</Text> : undefined),
          [],
          <Box flexDirection="column">
            {shown.length > 0 && <Code source={shown.join('\n')} path={file} startLine={isText ? f.startLine : 1} wrap="truncate-end" />}
            {code.length > shown.length && muted(`   … ${plural(code.length - shown.length, 'more line')}`)}
            {errorBody}
            {!shown.length && !errorBody.length && muted(isText ? '(빈 파일)' : '(텍스트 아님)')}
            {toggle(code.length > shown.length)}
          </Box>,
        )
      }

      default: {
        // Grep, Glob: unframed, a tree under one header line (omp grep.ts / glob.ts)
        const isGrep = p.tool === 'Grep'
        const where = str(input.path) ? `in ${relPath(str(input.path), cwd)}` : ''
        const done = out && typeof out === 'object'
        let items: string[] = []
        let meta: string[] = []
        let unit = 'files'
        if (done && isGrep && out.mode === 'content') {
          items = lines(str(out.content)).map(l => relPath(l, cwd))
          meta = [plural(out.numLines ?? items.length, 'match')]
          unit = 'matches'
        } else if (done && isGrep && out.mode === 'count') {
          items = lines(str(out.content)).map(l => relPath(l, cwd))
          meta = [plural(out.numMatches ?? 0, 'match'), plural(out.numFiles ?? 0, 'file')]
        } else if (done) {
          items = (Array.isArray(out.filenames) ? out.filenames : []).map((f: string) => relPath(f, cwd))
          meta = [plural(out.numFiles ?? items.length, 'file')]
        }
        if (where) meta.push(where)
        const isEmpty = done && items.length === 0 && !(out.numFiles > 0) && !(out.numLines > 0)
        const limit = lim(isGrep ? GREP_LINES : GLOB_ITEMS)
        const shown = items.slice(0, limit)
        const hidden = items.length - shown.length
        const extra = (
          <Text color={MUTED}>
            {str(input.glob) && ` [${clean(str(input.glob))}]`}
            {meta.length > 0 && ` ${meta.join(' · ')}`}
          </Text>
        )
        return (
          <Box flexDirection="column">
            <Text wrap="truncate-end">{heading(G.search, p.tool, `"${clean(str(input.pattern))}"`, extra)}</Text>
            {isEmpty && muted('   No matches found')}
            {shown.map((item, i) => (
              <Text wrap="truncate-end">
                <Text color={MUTED}>{i === shown.length - 1 && hidden === 0 ? '└─ ' : '├─ '}</Text>
                <Text color={isGrep && out?.mode === 'content' ? MUTED : ACCENT}>{item}</Text>
              </Text>
            ))}
            {hidden > 0 && (
              <Text wrap="truncate-end">
                <Text color={MUTED}>└─ </Text>
                <Text color={MUTED}>… {hidden} more {unit}</Text>
              </Text>
            )}
            {errLines.slice(-3).map(l => (
              <Text color="error" wrap="truncate-end">
                {'   '}
                {l}
              </Text>
            ))}
            {toggle(hidden > 0)}
          </Box>
        )
      }
    }
  })
}
