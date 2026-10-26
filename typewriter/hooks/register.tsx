// typewriter: the terminal draws a streamed reply in batches of whole lines, so text
// lands in blocks. This types each new reply block out a few characters a frame
// instead: the AssistantMessage hook draws a Client in the block's place, and
// reveal.tsx types the text out on the terminal's frame clock (the stored message is
// untouched). As oh-my-pi does, a tool call or the end of the turn shows what is still
// typing whole at once: the engine draws those blocks again from then on. Blocks drawn
// outside a live turn (history, a resume, a scroll) show whole at once.

import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

const isOff = atom({ plugin: 'typewriter', key: 'isOff' } as const, false)

type Api = Parameters<Hook<'turn.complete'>>[0]

// Module variables start over on a reload: blocks typing then show whole on their next draw
let isLive = false
const typing = new Set<string>()
const finished = new Set<string>()

// Every block still typing shows whole: the redraw hands each back to the engine
function showWhole($: Api) {
  if (typing.size === 0) return
  for (const id of typing) finished.add(id)
  typing.clear()
  $.ui.invalidate('ui.render')
}

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
      showWhole($)
    }
    return next(e)
  })

  // The text before a tool call shows whole the moment the call comes; the call itself
  // goes on whatever happens here
  on('tool.call', async ($, e, next) => {
    try {
      if (e.agentId === undefined) showWhole($)
    } catch {}
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // A summary block keeps the engine's drawing, which marks it as one
    if (e.surface !== 'terminal' || e.props.isSummary || finished.has(e.requestId) || (await read($, isOff))) {
      return next(e)
    }
    if (!typing.has(e.requestId)) {
      // Only a block first drawn during a live turn types out
      if (!isLive) {
        finished.add(e.requestId)
        return next(e)
      }
      typing.add(e.requestId)
    }

    const { Client } = $.ui.resolve(e)
    return (
      <Client key="reveal" module="./reveal.tsx" props={{ text: e.props.text, bullet: e.props.isFirstOfReply }} />
    )
  })
}
