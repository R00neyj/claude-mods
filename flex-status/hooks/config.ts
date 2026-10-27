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

export function parseConfig(options: Readonly<Record<string, unknown>>): Config {
  return {
    left: parseGroups(str(options.left, DEFAULT_LEFT)),
    right: parseGroups(str(options.right, DEFAULT_RIGHT)),
    bar: options.bar !== false,
    sep: {
      inner: pad(str(options.sepInner, '·')),
      left: pad(str(options.sepLeft, '>')),
      right: pad(str(options.sepRight, '<')),
    },
    seg: parseSegments(str(options.segments, '{}')),
  }
}
