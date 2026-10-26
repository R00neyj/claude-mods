import { expect, test } from 'claude-code/testing'

const TEXT = 'First paragraph is **done**.\n\nSecond line keeps typing out here'

const block = (requestId: string) =>
  ({
    plugin: 'typewriter',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId,
    props: { text: TEXT, isFirstOfReply: true },
  }) as const

// Stands for the engine: echoes the text it was handed, and answers the turn and tools
function engine(on: any) {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, e.props.text)
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { text: 'ok' } }))
}

const typed = async (ui: any) => (await ui.find({ type: 'Markdown', in: 'reveal' }))?.text
const engineText = async (ui: any) => (await ui.find({ type: 'Text' }))?.text

test('a block outside a live turn shows whole', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount(block('m1'))
  expect(await engineText(ui)).toBe(TEXT)
  await ui.unmount()
})

test('a block drawn during a turn types out on the frame clock', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const ui = await $.ui.mount(block('m2'))
  expect(await engineText(ui)).toBeUndefined()
  expect(await typed(ui)).toBe('')
  // One frame: a backlog of 61 types ceil(61 / 8) = 8
  await ui.advance(34)
  expect(await typed(ui)).toBe('First pa')
  // Long enough to catch up: the whole text, markdown and all
  await ui.advance(2000)
  expect(await typed(ui)).toBe(TEXT)
  await ui.unmount()
})

test('the end of the turn shows a typing block whole', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't3' })
  const ui = await $.ui.mount(block('m3'))
  await $.turn.complete({ turnId: 't3', reason: 'answer' } as any)
  expect(await engineText(ui)).toBe(TEXT)
  await ui.unmount()
})

test('a tool call shows the text before it whole', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't4' })
  const ui = await $.ui.mount(block('m4'))
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  expect(await engineText(ui)).toBe(TEXT)
  await ui.unmount()
})
