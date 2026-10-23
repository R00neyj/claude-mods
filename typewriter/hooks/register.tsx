// typewriter: the terminal draws a streamed reply in batches of whole lines, so text
// lands in blocks. This draws each new reply block a few words at a time instead:
// the AssistantMessage hook hands the engine a prefix of the block's text (the stored
// message is untouched) and a 50 ms ticker grows that prefix until the whole block shows.
// Blocks drawn outside a live turn (history, a resume, a scroll) show whole at once.

import { atom, memberOf, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

const isOff = atom({ plugin: 'typewriter', key: 'isOff' } as const, false)
// Per reply block: characters shown, -1 for the whole block
const revealed = atom({ plugin: 'typewriter', key: 'revealed' } as const, -1)

const TICK_MS = 50
// Small even steps: at least MIN_STEP characters a tick, more when behind so a backlog
// clears over about CATCHUP_TICKS ticks, never more than MAX_STEP at once
const MIN_STEP = 2
const MAX_STEP = 16
const CATCHUP_TICKS = 50
// A cut finishes the word it lands in only when the word ends this close
const WORD_REACH = 4
// The newest characters of the line being typed, oldest first: a terminal has no opacity,
// so a fade-in is drawn as grays stepping from near the text color toward the background
const FADE_STEPS = 12
const FADE_FROM = { dark: [0xd8, 0xd8, 0xd8], light: [0x30, 0x30, 0x30] }
const FADE_TO = { dark: [0x3a, 0x3a, 0x3a], light: [0xd0, 0xd0, 0xd0] }

function fadeRamp(isLight: boolean): string[] {
  const from = FADE_FROM[isLight ? 'light' : 'dark']
  const to = FADE_TO[isLight ? 'light' : 'dark']
  return Array.from({ length: FADE_STEPS }, (_, i) => {
    const t = (i + 1) / (FADE_STEPS + 1)
    const hex = from.map((c, k) => Math.round(c + ((to[k] ?? c) - c) * t).toString(16).padStart(2, '0'))
    return `#${hex.join('')}`
  })
}

// The API does not say which palette "auto" resolved to; a theme setting naming light is
// read as light, anything else as dark
let ramp = fadeRamp(false)
// Reply text sits two cells in, past the bullet column
const LINE_INDENT = 2
// A block that lands this long after its turn ended still types out
const AFTER_TURN_MS = 2000

type Api = Parameters<Hook<'turn.complete'>>[0]
type Block = { shown: number; total: number }

// Module variables start over on a reload: blocks typing then show whole on their next draw
let isLive = false
let liveUntil = 0
const typing = new Map<string, Block>()
const finished = new Set<string>()

// The prefix to draw: ends on a word where one is near, and closes a code fence left open
function prefix(text: string, n: number): string {
  let end = Math.min(text.length, n)
  const space = text.slice(end, end + WORD_REACH).search(/\s/)
  if (space >= 0) end += space
  let out = text.slice(0, end)
  const fences = out.match(/^\s*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) out += '\n```'
  return out
}

// The line being typed is plain text until it is whole, so the markers that would only
// show as stray symbols there (bold, inline code, a heading's hashes) are left out
function plainLine(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__|`/g, '')
}

async function tick($: Api) {
  for (const [id, b] of typing) {
    const backlog = b.total - b.shown
    if (backlog <= 0) {
      // Caught up; once the turn is over the block is done and draws whole from then on
      if (!isLive && (await $.clock.now()) > liveUntil) {
        typing.delete(id)
        finished.add(id)
        await update($, memberOf(revealed, { requestId: id }), () => -1)
      }
      continue
    }
    b.shown = Math.min(b.total, b.shown + Math.min(MAX_STEP, Math.max(MIN_STEP, Math.ceil(backlog / CATCHUP_TICKS))))
    await update($, memberOf(revealed, { requestId: id }), () => b.shown)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      ramp = fadeRamp(/light/i.test(String((await $.settings.read({ key: 'theme' })) ?? '')))
    } catch {}
    await $.command.register({
      name: 'typewriter',
      description: 'Toggle typing out new reply blocks a few words at a time',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))
    return next(e)
  })

  on('command.run', { command: 'typewriter' }, async $ => {
    const off = await update($, isOff, v => !v)
    return { text: off ? 'typewriter 꺼짐' : 'typewriter 켜짐' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) isLive = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isLive = false
      liveUntil = (await $.clock.now()) + AFTER_TURN_MS
    }
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || finished.has(e.requestId) || (await read($, isOff))) return next(e)

    const text = e.props.text
    let b = typing.get(e.requestId)
    if (!b) {
      // Only a block first drawn during a live turn types out
      if (!isLive && (await $.clock.now()) > liveUntil) {
        finished.add(e.requestId)
        return next(e)
      }
      b = { shown: Math.min(text.length, MIN_STEP), total: text.length }
      typing.set(e.requestId, b)
    }
    // The block grows as more lines stream in
    b.total = text.length

    // Reading the member subscribes this row, so the ticker's writes redraw it alone
    const n = await read($, memberOf(revealed, e))
    const shown = n < 0 ? b.shown : n
    if (shown >= text.length) return next(e)

    // The engine draws the finished lines; the line being typed is drawn here, its newest
    // characters fading in. Inside an open code fence, or on the block's first line (which
    // carries the reply's bullet), the engine draws the whole prefix as before.
    const cut = prefix(text, shown)
    const lineStart = cut.lastIndexOf('\n')
    const isInFence = (cut.match(/^\s*(```|~~~)/gm)?.length ?? 0) % 2 === 1
    if (lineStart < 0 || isInFence) return next({ ...e, props: { ...e.props, text: cut } })

    const settled = await next({ ...e, props: { ...e.props, text: cut.slice(0, lineStart) } })
    const typingLine = plainLine(cut.slice(lineStart + 1))
    const { Box, Text } = $.ui.resolve(e)
    const chars = Array.from(typingLine)
    const keep = Math.max(0, chars.length - ramp.length)
    const solid = chars.slice(0, keep).join('')
    const fading = chars.slice(keep)
    const shades = ramp.slice(ramp.length - fading.length)
    return (
      <Box flexDirection="column">
        {settled}
        {typingLine && (
          <Box paddingLeft={LINE_INDENT}>
            <Text>
              {solid}
              {fading.map((ch, i) => (
                <Text color={shades[i]}>{ch}</Text>
              ))}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
