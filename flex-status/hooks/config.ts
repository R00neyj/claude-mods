// flex-status options → Config: which segments sit where, and each segment's own knobs.

export type SegId =
  | 'model'
  | 'effort'
  | 'account'
  | 'folder'
  | 'git'
  | 'ttl'
  | '5h'
  | '7d'
  | 'cache'
  | 'session'
  | 'clock'

export const SEG_IDS: readonly SegId[] = ['model', 'effort', 'account', 'folder', 'git', 'ttl', '5h', '7d', 'cache', 'session', 'clock']

// Every knob is optional; a segment reads the ones that apply to it
export type SegConf = {
  icon?: string
  color?: string
  depth?: number
  counts?: boolean
  reset?: boolean
  decimals?: number
  hour12?: boolean
  seconds?: boolean
}

export type Config = {
  left: SegId[][]
  right: SegId[][]
  bar: boolean
  sep: { inner: string; left: string; right: string }
  seg: Partial<Record<SegId, SegConf>>
  compact: { on: boolean; leadMs: number; minTokens: number }
}

export const DEFAULT_LEFT = 'model,effort,account | folder | git'
export const DEFAULT_RIGHT = 'ttl,5h,7d | cache | session | clock'

const isSegId = (s: string): s is SegId => (SEG_IDS as readonly string[]).includes(s)

// "a,b | c" → [[a,b],[c]]; unknown ids and empty groups drop out
export function parseGroups(text: string): SegId[][] {
  return text
    .split('|')
    .map(g => g.split(',').map(s => s.trim().toLowerCase()).filter(isSegId))
    .filter(g => g.length > 0)
}

function parseSegments(text: string): Config['seg'] {
  try {
    const raw: unknown = JSON.parse(text)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Config['seg'] = {}
    for (const [id, conf] of Object.entries(raw)) {
      if (isSegId(id) && conf && typeof conf === 'object' && !Array.isArray(conf)) out[id] = conf as SegConf
    }
    return out
  } catch {
    return {}
  }
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const pad = (sym: string) => (sym.trim() ? ` ${sym.trim()} ` : ' ')

// Separator presets: inside a group, between left groups, between right groups
const SEPARATORS: Record<string, [string, string, string]> = {
  classic: ['·', '>', '<'],
  bar: ['|', '|', '|'],
  slash: ['/', '/', '/'],
  space: ['', '', ''],
}

// Option key of each segment's on/off toggle
const showKey = (id: SegId) => `show${id.charAt(0).toUpperCase()}${id.slice(1)}`

// Picker values are defaults; a segment's own entry in the JSON wins
function pickerKnobs(o: Readonly<Record<string, unknown>>): Config['seg'] {
  const depth = Number(str(o.folderDepth, '1'))
  const decimals = Number(str(o.cacheDecimals, '2'))
  const reset = o.limitReset !== false
  return {
    folder: { depth },
    git: { counts: o.gitCounts !== false },
    '5h': { reset },
    '7d': { reset },
    cache: { decimals },
    clock: { hour12: o.clockFormat === '12h', seconds: o.clockSeconds === true },
  }
}

export function parseConfig(options: Readonly<Record<string, unknown>>): Config {
  const hidden = (id: SegId) => options[showKey(id)] === false
  const shown = (groups: SegId[][]) => groups.map(g => g.filter(id => !hidden(id))).filter(g => g.length > 0)
  const [inner, left, right] = SEPARATORS[str(options.separator, 'classic')] ?? SEPARATORS.classic!
  const knobs = pickerKnobs(options)
  const own = parseSegments(str(options.segments, '{}'))
  const seg: Config['seg'] = {}
  for (const id of SEG_IDS) {
    if (knobs[id] || own[id]) seg[id] = { ...knobs[id], ...own[id] }
  }
  return {
    left: shown(parseGroups(str(options.left, DEFAULT_LEFT))),
    right: shown(parseGroups(str(options.right, DEFAULT_RIGHT))),
    bar: options.bar !== false,
    sep: { inner: pad(inner), left: pad(left), right: pad(right) },
    seg,
    compact: {
      on: options.autoCompact !== false,
      leadMs: Math.max(5, Number(str(options.compactLead, '60')) || 60) * 1000,
      minTokens: Math.max(0, Number(str(options.compactMinTokens, '50000')) || 0),
    },
  }
}
