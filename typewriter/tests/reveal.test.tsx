import { expect, test } from 'claude-code/testing'

const TEXT = 'Here is a fairly long reply block that should be revealed a few words at a time on screen.'

const block = (requestId: string) =>
  ({
    plugin: 'typewriter',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId,
    props: { text: TEXT, isFirstOfReply: true },
  }) as const

// Stands for the engine's drawing: echoes the text it was handed
function engine(on: any) {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, e.props.text)
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
}

async function drawn($: any, id: string) {
  const ui = await $.ui.mount(block(id))
  const text = (await ui.find({ type: 'Text' }))?.text
  await ui.unmount()
  return text
}

test('a block outside a live turn shows whole', async ($, on) => {
  engine(on)
  expect(await drawn($, 'm1')).toBe(TEXT)
})

test('a block first drawn during a turn starts as a short prefix', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  const first = await drawn($, 'm2')
  expect(first.length < TEXT.length).toBe(true)
  expect(TEXT.startsWith(first)).toBe(true)
})

test('the line being typed fades in under the finished lines', async ($, on) => {
  engine(on)
  // 30 characters shown: the first line and part of the second
  on('state.get', { key: 'revealed' }, () => ({ value: { value: 30, version: 1 } }))
  await $.turn.start({ text: 'hi', turnId: 't2' })
  const LONG = 'First paragraph is done.\nSecond line keeps typing out here'
  const ui = await $.ui.mount({ ...block('m3'), props: { text: LONG, isFirstOfReply: true } })
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  console.log(JSON.stringify(texts))
  expect(texts).toContain('First paragraph is done.')
  expect(texts.some((t: string) => t.startsWith('Second'))).toBe(true)
  await ui.unmount()
})
