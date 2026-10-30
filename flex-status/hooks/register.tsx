// flex-status: the old statusline-command.js, redrawn as a band above the prompt.
// The band knows its width (bodyColumns), so a narrow terminal folds the line onto
// more rows instead of cutting it: 1 row → left·right + bar row → each group wrapped.

import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Git, Limit, Snap } from '../types'
import { parseConfig } from './config'
import type { Config, SegConf, SegId } from './config'

const snap = atom({ plugin: 'flex-status', key: 'snap' } as const, null, { shape: 'snap-2' })

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

// ── segments ─────────────────────────────────────────────────────────────

type Seg = (s: Snap, c: SegConf) => Chip | null

const label = (c: SegConf, icon: string, text: string) => {
  const i = c.icon ?? icon
  return i ? `${i} ${text}` : text
}
// A configured color replaces the head span's own
const tint = (chip: Chip, c: SegConf): Chip => (c.color ? chip.map((sp, i) => (i === 0 ? { ...sp, c: c.color } : sp)) : chip)

// The branch is green on a clean working tree, orange once anything is changed or untracked
function gitChip(g: Git, c: SegConf): Chip {
  const chip: Chip = [{ t: label(c, '⑂', g.branch), c: g.untracked || g.changed ? BRANCH : OK }]
  if (c.counts === false) return chip
  if (g.untracked) chip.push({ t: ` ?${g.untracked}`, c: DIM })
  if (g.changed) chip.push({ t: ` !${g.changed}`, c: WARN })
  return chip
}

function limitChip(l: Limit, c: SegConf): Chip {
  const chip: Chip = [{ t: label(c, '', `${l.label} ${Math.round(l.pct)}%`), c: tierColor(l.pct) }]
  if (l.resetsAt && c.reset !== false) {
    const d = new Date(l.resetsAt)
    if (!Number.isNaN(d.getTime())) {
      chip.push({ t: ` (${l.withDate ? `${d.getMonth() + 1}/${d.getDate()} ` : ''}${hhmm(d)})`, c: DIM })
    }
  }
  return chip
}

const limitSeg = (id: '5h' | '7d'): Seg => (s, c) => {
  const l = s.limits.find(x => x.label === id)
  return l ? tint(limitChip(l, c), c) : null
}

function clockText(d: Date, c: SegConf): string {
  const h = c.hour12 ? d.getHours() % 12 || 12 : d.getHours()
  const hh = c.hour12 ? String(h) : pad2(h)
  const mm = `${hh}:${pad2(d.getMinutes())}${c.seconds ? `:${pad2(d.getSeconds())}` : ''}`
  return c.hour12 ? `${mm} ${d.getHours() < 12 ? 'AM' : 'PM'}` : mm
}

const SEGMENTS: Record<SegId, Seg> = {
  model: (s, c) => tint(s.advisor ? [{ t: label(c, '⬢', s.model), c: ACCENT }, { t: ' 👁 ' }] : [{ t: label(c, '⬢', s.model), c: ACCENT }], c),
  effort: (s, c) => (s.effort ? tint([{ t: label(c, '◑', s.effort), c: ACCENT }], c) : null),
  account: (s, c) => (s.account ? tint([{ t: label(c, '', s.account), c: DIM }], c) : null),
  folder: (s, c) => {
    const tail = s.cwd.split(/[\\/]+/).filter(Boolean).slice(-Math.max(1, c.depth ?? 1)).join('/')
    return tint([{ t: label(c, '📁', `.../${tail || s.folder}`), c: TEXT }], c)
  },
  git: (s, c) => (s.git ? tint(gitChip(s.git, c), c) : null),
  ttl: (s, c) => {
    if (!s.cacheExpiresAt) return null
    const left = Math.floor((s.cacheExpiresAt - s.now) / 1000)
    return tint(
      left <= 0
        ? [{ t: label(c, '⏳', '만료'), c: BAD }]
        : [{ t: label(c, '⏳', `${pad2(Math.floor(left / 60))}:${pad2(left % 60)}`), c: left < 60 ? WARN : ACCENT }],
      c,
    )
  },
  '5h': limitSeg('5h'),
  '7d': limitSeg('7d'),
  cache: (s, c) => {
    if (s.cacheHit === undefined) return null
    const pct = s.cacheHit * 100
    return tint([{ t: label(c, '💾', `${pct.toFixed(c.decimals ?? 2)}%`), c: pct >= 80 ? OK : pct >= 50 ? '#d7af00' : BAD }], c)
  },
  session: (s, c) => {
    const sec = Math.max(0, Math.floor((s.now - s.startedAt) / 1000))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return tint([{ t: label(c, '⏱', h ? `${h}h${pad2(m)}m` : `${m}m${pad2(sec % 60)}s`), c: TEXT }], c)
  },
  clock: (s, c) => tint([{ t: label(c, '🕐', clockText(new Date(s.now), c)), c: TEXT }], c),
}

function groupsOf(ids: SegId[][], s: Snap, cfg: Config): Chip[][] {
  return ids
    .map(group => group.map(id => SEGMENTS[id](s, cfg.seg[id] ?? {})).filter((chip): chip is Chip => chip !== null))
    .filter(group => group.length > 0)
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

// The band gets only the rows the tasks list leaves: drop the bar, then squeeze all onto one row
export function layout(s: Snap, cols: number, cfg: Config, maxRows = Infinity): Span[][] {
  const rows = layoutRows(s, cols, cfg)
  if (rows.length <= maxRows) return rows
  const noBar = layoutRows(s, cols, { ...cfg, bar: false })
  if (noBar.length <= maxRows) return noBar
  if (maxRows > 1) return noBar.slice(0, maxRows)
  return [noBar.flatMap((row, i) => (i ? [{ t: ' ' }, ...row] : row))]
}

function layoutRows(s: Snap, cols: number, cfg: Config): Span[][] {
  const left = flatten(groupsOf(cfg.left, s, cfg), cfg.sep.inner, cfg.sep.left)
  const right = flatten(groupsOf(cfg.right, s, cfg), cfg.sep.inner, cfg.sep.right)
  const L = toSpans(left)
  const R = toSpans(right)
  const lw = spansWidth(L)
  const rw = spansWidth(R)
  const hasBar = cfg.bar && s.ctxTokens !== undefined

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
let liveModel = ''
let git: Git | null = null
let advisor = false
let settingsFile = ''
let compactAt: number | undefined
let cacheExpiresAt: number | undefined
let ttlMs = 5 * 60_000
let cacheRead = 0
let cacheAll = 0
let tick = 0
let compactedFor: number | undefined
let compacting = false

// Compacts once per cache window, just before it lapses; a running turn makes compact reject and the next tick retries
async function maybeCompact($: Api, cfg: Config, ctxTokens: number | undefined, now: number) {
  if (!cfg.compact.on || compacting || cacheExpiresAt === undefined || compactedFor === cacheExpiresAt) return
  if (now < cacheExpiresAt - cfg.compact.leadMs || now >= cacheExpiresAt) return
  if ((ctxTokens ?? 0) < cfg.compact.minTokens) return
  compacting = true
  try {
    const { skip } = await $.session.compact()
    compactedFor = cacheExpiresAt
    if (!skip) {
      cacheExpiresAt = undefined
      $.ui.toast('캐시 만료 전 자동 compact 완료')
    }
  } catch {
  } finally {
    compacting = false
  }
}

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

// The engine's merged settings lag a turn behind /advisor, so the user file is read directly
async function findSettingsFile($: Api) {
  const dir = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
  settingsFile = dir ? `${dir}/settings.json` : home ? `${home}/.claude/settings.json` : ''
}

async function readAdvisor($: Api) {
  if (!settingsFile) return
  try {
    const s = JSON.parse(await $.fs.read(settingsFile)) as { advisorModel?: unknown }
    advisor = Boolean(s.advisorModel)
  } catch {}
}

async function refreshCompact($: Api) {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    compactAt = u.context.breakdown?.autoCompactThreshold
  } catch {}
}

async function refresh($: Api, cfg: Config) {
  tick += 1
  if (tick % 5 === 1) git = await readGit($)
  await readAdvisor($)
  const [usage, model, now] = await Promise.all([$.session.usage(), $.session.model(), $.clock.now()])
  const id = model || modelId
  // A switch makes the last request's effort stale; the saved per-model level applies until the next request
  if (model && model !== liveModel) {
    liveModel = model
    effort = ''
  }
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

  void maybeCompact($, cfg, usage.context.tokens, now)

  const cwd = await $.session.cwd()
  const next: Snap = {
    model: prettyModel(id),
    effort: String(effort).replace('medium', 'med'),
    advisor,
    account,
    folder: basename(cwd),
    cwd,
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

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    account = await readAccount($)
    await findSettingsFile($)
    await refreshCompact($)
    await refresh($, cfg)
    $.clock.every(1000, () => void refresh($, cfg).catch(() => {}))
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
      await refresh($, cfg).catch(() => {})
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.surface !== 'terminal' || e.props.hasSurvey || !s) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // One spare cell: emoji widths differ a little between terminals
    const rows = layout(s, Math.max(20, e.props.bodyColumns - 1), cfg, Math.max(1, e.props.maxRows))
    if (!rows.length) return next(e)

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
