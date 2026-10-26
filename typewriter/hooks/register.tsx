// typewriter: the terminal draws a reply in batches of whole lines, so text lands in
// blocks. This types each new reply block out a few characters a frame instead: the
// AssistantMessage hook draws a Client in the block's place, and reveal.tsx types the
// text out on the terminal's frame clock (the stored message is untouched). A block
// often lands as its turn ends, so it still types out then; once it has caught up and
// the turn is over, the engine draws it again. Blocks drawn outside a live turn
// (history, a resume, a scroll) show whole at once.

import { read, update, atom } from 'claude-code'
import type { Register } from 'claude-code'

const isOff = atom({ plugin: 'typewriter', key: 'isOff' } as const, false)

// A block that lands this long after its turn ended still types out
const AFTER_TURN_MS = 2000

// Module variables start over on a reload: blocks typing then show whole on their next draw
let isLive = false
let liveUntil = 0
const typing = new Set<string>()
const finished = new Set<string>()
// Per block typing: the text length reveal.tsx last caught up to
const caughtUp = new Map<string, number>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'typewriter',
      description: 'Toggle typing out new reply blocks a few characters a frame',
    })
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
      // Blocks that caught up before the turn was over go back to the engine then
      $.clock.after(AFTER_TURN_MS + 100, () => $.ui.invalidate('ui.render'))
    }
    return next(e)
  })

  // reveal.tsx caught up; once the turn is over the redraw hands the block to the engine
  on('ui.message', async ($, e, next) => {
    const length = (e.data as { caughtUp?: unknown } | null)?.caughtUp
    if (typeof length === 'number' && typing.has(e.requestId)) {
      caughtUp.set(e.requestId, length)
      if (!isLive && (await $.clock.now()) > liveUntil) $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary block keeps the engine's drawing, which marks it as one
    if (e.surface !== 'terminal' || e.props.isSummary || finished.has(e.requestId) || (await read($, isOff))) {
      return next(e)
    }

    const isOver = async () => !isLive && (await $.clock.now()) > liveUntil
    if (!typing.has(e.requestId)) {
      // Only a block first drawn during a live turn, or just after it, types out
      if (await isOver()) {
        finished.add(e.requestId)
        return next(e)
      }
      typing.add(e.requestId)
    }
    if ((caughtUp.get(e.requestId) ?? -1) >= e.props.text.length && (await isOver())) {
      typing.delete(e.requestId)
      caughtUp.delete(e.requestId)
      finished.add(e.requestId)
      return next(e)
    }

    const { Client } = $.ui.resolve(e)
    return (
      <Client key="reveal" module="./reveal.tsx" props={{ text: e.props.text, bullet: e.props.isFirstOfReply }} />
    )
  })
}
