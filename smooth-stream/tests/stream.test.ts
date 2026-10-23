import { expect, test } from 'claude-code/testing'

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }
const TEXT = '안녕하세요. This is a long chunk of streamed text 🙂 that should be split.'
const RESULT = { turnId: 't1', index: 0, answer: 'Hi ' + TEXT, toolUses: [], stopReason: 'end_turn', usage: null }

// Stands for the model: two text chunks, then the step's result
function model(on: any) {
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'Hi ' }
    yield { kind: 'text', index: 0, text: TEXT }
    return RESULT
  })
}

async function read($: any, input: object) {
  const s = $.turn.step({ ...STEP, ...input })
  const got: string[] = []
  let r = await s.next()
  for (; !r.done; r = await s.next()) if (r.value.kind === 'text') got.push(r.value.text)
  return { got, result: r.value }
}

test('a large chunk arrives as small pieces, the text and result unchanged', async ($, on) => {
  model(on)
  const { got, result } = await read($, {})
  expect(got.join('')).toBe('Hi ' + TEXT)
  expect(got[0]).toBe('Hi ')
  expect(got.length > 10).toBe(true)
  expect(result?.answer).toBe('Hi ' + TEXT)
})

test('a subagent step passes through as it came', async ($, on) => {
  model(on)
  const { got, result } = await read($, { agentId: 'a1' })
  expect(got).toEqual(['Hi ', TEXT])
  expect(result?.answer).toBe('Hi ' + TEXT)
})
