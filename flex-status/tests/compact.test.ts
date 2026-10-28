import { expect, mock, test } from 'claude-code/testing'

const T0 = 1_000_000
const TTL = 5 * 60_000

// Boots the plugin on a mocked clock, then answers one main-loop step so the cache window starts at T0
async function boot($: any, on: any, compact: () => unknown, tokens = 100_000) {
  const clock = mock.clock(on, { now: T0 })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: T0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('session.compact', () => {
    compact()
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, model: 'm' } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const step = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  for await (const _ of step) {
  }
  await clock.settle()
  return clock
}

test('compacts once, inside the lead window before the cache lapses', async ($, on) => {
  let calls = 0
  const clock = await boot($, on, () => calls++)

  await clock.advance(TTL - 90_000)
  expect(calls).toBe(0)

  await clock.advance(40_000)
  expect(calls).toBe(1)

  await clock.advance(TTL)
  expect(calls).toBe(1)
})

test('a small context is left alone', async ($, on) => {
  let calls = 0
  const clock = await boot($, on, () => calls++, 10_000)

  await clock.advance(TTL - 30_000)
  expect(calls).toBe(0)
})

test('autoCompact off never compacts', { options: { autoCompact: false } }, async ($, on) => {
  let calls = 0
  const clock = await boot($, on, () => calls++)

  await clock.advance(TTL - 30_000)
  expect(calls).toBe(0)
})
