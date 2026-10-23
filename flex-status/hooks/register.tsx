// flex-status: the old statusline-command.js, redrawn as a band above the prompt.
// The band knows its width (bodyColumns), so a narrow terminal folds the line onto
// more rows instead of cutting it: 1 row → left·right + bar row → each group wrapped.

import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Git, Limit, Snap } from '../types'

const snap = atom({ plugin: 'flex-status', key: 'snap' } as const, null, { shape: 'snap-1' })

// xterm-256 codes of the old script as hex; the accent follows the theme
const ACCENT = 'claude' // the theme's Claude orange
const DIM = '#808080' // 244
const TEXT = '#a8a8a8' // 248
const BRANCH = '#d78700' // 172
const OK = '#00af00' // 34
const WARN = '#d75f00' // 166
const BAD = '#d70000' // 160
const TIER = ['#00af00', '#00afaf', '#d7af00', '#d75f00', '#d70000']
const tierColor = (pct: number) => TIER[Math.max(0, Math.min(4, Math.floor(pct / 20)))]

const MIN_BAR = 16

type Api = Parameters<Hook<'turn.complete'>>[0]

type Span = { t: string; c?: string }
type Chip = Span[]

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

// Terminal cells: emoji and CJK take two, variation selectors none
function width(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d) continue
    w +=
      cp >= 0x1f000 ||
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      cp === 0x231b ||
      cp === 0x23f1 ||
      cp === 0x23f3
        ? 2
        : 1
  }
  return w
}
const spansWidth = (spans: Span[]) => spans.reduce((n, s) => n + width(s.t), 0)

// "claude-opus-5-5[1m]" → "Opus 5.5"; a display name passes with its "(…)" dropped
function prettyModel(id: string): string {
  const bare = id.replace(/\[.*\]$/, '').replace(/\s*\([^()]*\)\s*$/, '')
  const m = bare.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (!m) return bare
  const [, family = '', major = '', minor] = m
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

const tokens = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`)

// ── chips ────────────────────────────────────────────────────────────────

function leftGroups(s: Snap): Chip[][] {
  const id: Chip[] = [[{ t: `⬢ ${s.model}`, c: ACCENT }]]
  if (s.effort) id.push([{ t: `◑ ${s.effort}`, c: ACCENT }])
  if (s.account) id.push([{ t: s.account, c: DIM }])
  const groups: Chip[][] = [id, [[{ t: `📁 .../${s.folder}`, c: TEXT }]]]
  if (s.git) groups.push([gitChip(s.git)])
  return groups
}

function gitChip(g: Git): Chip {
  const chip: Chip = [{ t: `⑂ ${g.branch}`, c: BRANCH }]
  if (g.untracked) chip.push({ t: ` ?${g.untracked}`, c: DIM })
  if (g.changed) chip.push({ t: ` !${g.changed}`, c: WARN })
  return chip
}

function limitChip(l: Limit): Chip {
  const chip: Chip = [{ t: `${l.label} ${Math.round(l.pct)}%`, c: tierColor(l.pct) }]
  if (l.resetsAt) {
    const d = new Date(l.resetsAt)
    if (!Number.isNaN(d.getTime())) {
      chip.push({ t: ` (${l.withDate ? `${d.getMonth() + 1}/${d.getDate()} ` : ''}${hhmm(d)})`, c: DIM })
    }
  }
  return chip
}

function rightGroups(s: Snap): Chip[][] {
  const limits: Chip[] = []
  if (s.cacheExpiresAt) {
    const left = Math.floor((s.cacheExpiresAt - s.now) / 1000)
    limits.push(
      left <= 0
        ? [{ t: '⏳ 만료', c: BAD }]
        : [{ t: `⏳ ${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`, c: left < 60 ? WARN : ACCENT }],
    )
  }
  for (const l of s.limits) limits.push(limitChip(l))

  const groups: Chip[][] = []
  if (limits.length) groups.push(limits)
  if (s.cacheHit !== undefined) {
    const pct = s.cacheHit * 100
    groups.push([[{ t: `💾 ${pct.toFixed(2)}%`, c: pct >= 80 ? OK : pct >= 50 ? '#d7af00' : BAD }]])
  }
  const sec = Math.max(0, Math.floor((s.now - s.startedAt) / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  groups.push([[{ t: `⏱ ${h ? `${h}h${pad2(m)}m` : `${m}m${pad2(sec % 60)}s`}`, c: TEXT }]])
  groups.push([[{ t: `🕐 ${hhmm(new Date(s.now))}`, c: TEXT }]])
  return groups
}

// Bar runs 0 → auto-compact point (falls back to the full window), so 100% = compaction fires
function bar(s: Snap, cells: number): Span[] {
  if (s.ctxTokens === undefined || !s.ctxWindow) return []
  const base = s.compactAt && s.compactAt > 0 ? s.compactAt : s.ctxWindow
  const pct = Math.min(100, (s.ctxTokens / base) * 100)
  const label = `${Math.round(pct)}%`
  const end = s.compactAt ? `⟳${tokens(base)}` : tokens(base)
  const n = Math.max(4, cells - label.length - width(end))
  const used = Math.min(n, Math.round((n * pct) / 100))
  return [
    { t: label, c: tierColor(pct) },
    { t: '━'.repeat(used), c: tierColor(pct) },
    { t: '─'.repeat(n - used), c: DIM },
    { t: end, c: DIM },
  ]
}

// ── layout ───────────────────────────────────────────────────────────────

// A flat run of chips with the separator owed before each one
type Item = { sep: string; chip: Chip }

function flatten(groups: Chip[][], inner: string, outer: string): Item[] {
  const items: Item[] = []
  groups.forEach((group, gi) =>
    group.forEach((chip, ci) => items.push({ sep: ci > 0 ? inner : gi > 0 ? outer : '', chip })),
  )
  return items
}

function toSpans(items: Item[]): Span[] {
  return items.flatMap((it, i) => (i > 0 && it.sep ? [{ t: it.sep, c: DIM }, ...it.chip] : it.chip))
}

// Greedy wrap: a chip never splits; the separator is dropped at a row's start
function pack(items: Item[], cols: number): Span[][] {
  const rows: Item[][] = []
  let row: Item[] = []
  let used = 0
  for (const it of items) {
    const w = spansWidth(it.chip)
    const sepW = row.length ? width(it.sep) : 0
    if (row.length && used + sepW + w > cols) {
      rows.push(row)
      row = []
      used = 0
    }
    used += (row.length ? width(it.sep) : 0) + w
    row.push(it)
  }
  if (row.length) rows.push(row)
  return rows.map(toSpans)
}

export function layout(s: Snap, cols: number): Span[][] {
  const left = flatten(leftGroups(s), ' · ', ' > ')
  const right = flatten(rightGroups(s), ' · ', ' < ')
  const L = toSpans(left)
  const R = toSpans(right)
  const lw = spansWidth(L)
  const rw = spansWidth(R)
  const hasBar = s.ctxTokens !== undefined

  // 1 row: left ─bar─ right
  if (!hasBar && lw + 1 + rw <= cols) return [[...L, { t: ' '.repeat(cols - lw - rw) }, ...R]]
  if (hasBar && lw + rw + 2 + MIN_BAR <= cols) {
    return [[...L, { t: ' ' }, ...bar(s, cols - lw - rw - 2), { t: ' ' }, ...R]]
  }
  // 2 rows: left … right, then the bar across
  const barRow = hasBar ? [bar(s, cols)] : []
  if (lw + 2 + rw <= cols) return [[...L, { t: ' '.repeat(cols - lw - rw) }, ...R], ...barRow]
  // Narrower: each side wraps on rows of its own, the bar between them
  return [...pack(left, cols), ...barRow, ...pack(right, cols)]
}

// ── data ─────────────────────────────────────────────────────────────────

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

// Module variables start over on a reload; the 1 s timer refills them
let account = ''
let effort = ''
let modelId = ''
let git: Git | null = null
let compactAt: number | undefined
let cacheExpiresAt: number | undefined
let ttlMs = 5 * 60_000
let cacheRead = 0
let cacheAll = 0
let tick = 0

async function readAccount($: Api) {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
  for (const f of [dir && `${dir}/.claude.json`, `${home}/.claude.json`]) {
    if (!f) continue
    try {
      const cj = JSON.parse(await $.fs.read(f)) as { oauthAccount?: { emailAddress?: string } }
      const addr = cj.oauthAccount?.emailAddress
      if (addr) return addr.split('@')[0] ?? ''
    } catch {}
  }
  return dir ? basename(dir).replace(/^.claude-?/, '') : ''
}

async function readGit($: Api): Promise<Git | null> {
  const opts = { timeoutMs: 3000 }
  try {
    const inside = await $.process.run(['git', '--no-optional-locks', 'rev-parse', '--is-inside-work-tree'], opts)
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return null
    const br = await $.process.run(['git', '--no-optional-locks', 'branch', '--show-current'], opts)
    const st = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain'], opts)
    const lines = st.stdout.split('\n').filter(Boolean)
    const untracked = lines.filter((l) => l.startsWith('??')).length
    return { branch: br.stdout.trim() || 'HEAD', untracked, changed: lines.length - untracked }
  } catch {
    return null
  }
}

async function effortFallback($: Api, id: string): Promise<string> {
  try {
    const s = (await $.settings.read()) as Record<string, any>
    const key = id.replace(/\[.*\]$/, '')
    return String(s.modelSettings?.[key]?.effortLevel ?? s.effortLevel ?? '')
  } catch {
    return ''
  }
}

async function refreshCompact($: Api) {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    compactAt = u.context.breakdown?.autoCompactThreshold
  } catch {}
}

async function refresh($: Api) {
  tick += 1
  if (tick % 5 === 1) git = await readGit($)
  const [usage, model, now] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
  const id = modelId || model
  if (!effort) effort = await effortFallback($, id)
  // Subscription sessions get the 1h prompt-cache TTL, API-key sessions 5m (assumption, no API field says)
  ttlMs = usage.rateLimits.length ? 60 * 60_000 : 5 * 60_000

  const limits: Limit[] = usage.rateLimits
    .filter((r) => r.kind === 'five_hour' || r.kind === 'seven_day')
    .map((r) => ({
      label: r.kind === 'five_hour' ? '5h' : '7d',
      pct: r.percentUsed,
      resetsAt: r.resetsAt,
      withDate: r.kind === 'seven_day',
    }))

  const next: Snap = {
    model: prettyModel(id),
    effort: String(effort).replace('medium', 'med'),
    account,
    folder: basename(await $.session.cwd()),
    git,
    ctxTokens: usage.context.tokens,
    ctxWindow: usage.context.window,
    compactAt,
    limits,
    cacheExpiresAt,
    cacheHit: cacheAll ? cacheRead / cacheAll : undefined,
    startedAt: usage.startedAt,
    // Whole seconds, so an unchanged second does not redraw
    now: Math.floor(now / 1000) * 1000,
  }
  await update($, snap, prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    account = await readAccount($)
    await refreshCompact($)
    await refresh($)
    $.clock.every(1000, () => void refresh($).catch(() => {}))
    return started
  })

  // Main-loop requests carry the effort and the cache figures the band shows
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined) {
      try {
        modelId = e.model
        if (e.effort !== undefined) effort = String(e.effort)
        const u = result.usage
        if (u) {
          cacheRead += u.cache_read_input_tokens
          cacheAll += u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
          cacheExpiresAt = (await $.clock.now()) + ttlMs
        }
      } catch {}
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      git = await readGit($)
      await refreshCompact($)
      await refresh($).catch(() => {})
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.surface !== 'terminal' || e.props.hasSurvey || !s) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // One spare cell: emoji widths differ a little between terminals
    const rows = layout(s, Math.max(20, e.props.bodyColumns - 1))

    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text wrap="truncate-end">
            {row.map(span => (span.c ? <Text color={span.c}>{span.t}</Text> : span.t))}
          </Text>
        ))}
      </Box>
    )
  })
}
