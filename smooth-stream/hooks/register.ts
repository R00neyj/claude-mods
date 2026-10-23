// smooth-stream: the model's text arrives in uneven chunks; this re-emits each large
// chunk as small pieces with short pauses between them, so a reply flows in steadily.
// A turn.step hook's own time (its sleeps included) is capped at 10 s per response,
// so the pauses stop at WAIT_CAP_MS and the rest of the reply passes through as it came.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Speed } from '../types'

const isOff = atom({ plugin: 'smooth-stream', key: 'isOff' } as const, false)
const speed = atom({ plugin: 'smooth-stream', key: 'speed' } as const, 'normal' as Speed)

// Characters per piece, milliseconds per character, most milliseconds one chunk may be spread over
const PACE: Record<Speed, { piece: number; perChar: number; perChunk: number }> = {
  slow: { piece: 2, perChar: 8, perChunk: 200 },
  normal: { piece: 3, perChar: 4, perChunk: 120 },
  fast: { piece: 4, perChar: 2, perChunk: 60 },
}
const MIN_CHUNK = 8
const WAIT_CAP_MS = 5000
const BUDGET_FLOOR_MS = 3000

// Pieces end on whole characters (surrogate pairs and combining marks kept together)
function pieces(text: string, size: number): string[] {
  const chars = text.match(/\P{M}\p{M}*/gu) ?? [text]
  const out: string[] = []
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''))
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'smooth-stream',
      description: 'Toggle smooth reply streaming; "slow|normal|fast" sets the pace',
      argumentHint: '[slow|normal|fast]',
    })
    return next(e)
  })

  on('command.run', { command: 'smooth-stream' }, async ($, e) => {
    const pace = e.args.trim().toLowerCase()
    if (pace === 'slow' || pace === 'normal' || pace === 'fast') {
      await update($, speed, () => pace)
      await update($, isOff, () => false)
      return { text: `smooth-stream 속도: ${pace}` }
    }
    const off = await update($, isOff, v => !v)
    return { text: off ? 'smooth-stream 꺼짐' : 'smooth-stream 켜짐' }
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    // Subagents' replies are not on screen; leave them alone
    if (e.agentId !== undefined || (await read($, isOff))) {
      return yield* stream
    }
    const pace = PACE[await read($, speed)]
    let waited = 0
    let isPacing = true

    // Read by hand rather than for-await, so the step's result is kept for the return
    for (let step = await stream.next(); ; step = await stream.next()) {
      if (step.done) return step.value
      const chunk = step.value
      if (!isPacing || chunk.kind !== 'text' || chunk.text.length < MIN_CHUNK) {
        yield chunk
        continue
      }
      const parts = pieces(chunk.text, pace.piece)
      const gap = Math.min(pace.perChunk, chunk.text.length * pace.perChar) / parts.length
      for (const [i, text] of parts.entries()) {
        // Pieces built afresh carry no engine handle and are taken at their word
        yield { kind: 'text', index: chunk.index, text }
        if (!isPacing || i === parts.length - 1) continue
        if (waited + gap > WAIT_CAP_MS || next.budget.remainingMs < BUDGET_FLOOR_MS) {
          isPacing = false
          continue
        }
        try {
          await $.clock.sleep(gap, { signal: next.signal })
          waited += gap
        } catch {
          // Interrupted: stop pausing, let the rest through
          isPacing = false
        }
      }
    }
  })
}
