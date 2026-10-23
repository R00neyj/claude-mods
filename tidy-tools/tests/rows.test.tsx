import { expect, test } from 'claude-code/testing'

const row = (tool: string, input: unknown, output: unknown, extra: object = {}) =>
  ({
    plugin: 'tidy-tools',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool, input, output, isRunning: false, isErrored: false, isInterrupted: false, isExpanded: true, ...extra },
  }) as const

function textOf(node: any): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  if (node.props?.source) return '[code:' + (node.props.format ?? 'src') + ']\n' + node.props.source + '\n'
  const kids = node.children ?? node.props?.children ?? []
  return (Array.isArray(kids) ? kids : [kids]).map(textOf).join('')
}

async function show($: any, target: any) {
  const ui = await $.ui.mount(target)
  const t = textOf(await ui.drawn())
  console.log(`\n── ${target.props.tool}\n${t}`)
  await ui.unmount()
  return t
}

const CWD = '/work/proj'

test('Edit draws path, counts and a diff', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  const t = await show(
    $,
    row(
      'Edit',
      { file_path: '/work/proj/src/app.ts', old_string: 'a', new_string: 'b' },
      { structuredPatch: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 4, lines: [' keep', '-const a = 1', '+const a = 2', '+const b = 3', '+log(a, b)'] }] },
    ),
  )
  expect(t.includes('src/app.ts')).toBe(true)
  expect(t.includes('+3')).toBe(true)
  expect(t.includes('−1')).toBe(true)
  expect(t.includes('Edit src/app.ts')).toBe(true)
  expect(t.includes('@@ -3,2 +3,4 @@')).toBe(true)
  expect(t.includes('+const a = 2')).toBe(true)
})

test('Bash shows the command and the last lines', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  const t = await show($, row('Bash', { command: 'npm test', description: 'Run tests' }, { stdout: 'a\nb\n\x1b[32m5 pass\x1b[0m\n0 fail\nRan 5 tests\n', stderr: '', interrupted: false }))
  expect(t.includes('npm test')).toBe(true)
  expect(t.includes('5 pass')).toBe(true)
  expect(t.includes('\x1b')).toBe(false)
  expect(t.includes('Output')).toBe(true)
})

test('Write of a new file, Read, Grep, error', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  const w = await show($, row('Write', { file_path: '/work/proj/x.py', content: 'def f(x):\n    return x * 2\n' }, { type: 'create' }))
  expect(w.includes('@@ -0,0 +1,2 @@')).toBe(true)
  const r = await show($, row('Read', { file_path: 'C:\\other\\a.md' }, { type: 'text', file: { filePath: 'a', content: '', numLines: 50, startLine: 1, totalLines: 120 } }))
  expect(r.includes('Read C:/other/a.md:1-50')).toBe(true)
  expect(r.includes('C:/other/a.md')).toBe(true)
  await show($, row('Grep', { pattern: 'foo', path: '/work/proj/src' }, { mode: 'files_with_matches', numFiles: 4, filenames: [] }))
  const err = await show($, row('Bash', { command: 'git push' }, 'Exit code 1\nrejected: non-fast-forward', { isErrored: true }))
  expect(err.includes('non-fast-forward')).toBe(true)
})

test('other tools and the off switch go to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(row('WebFetch', { url: 'x' }, {}))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
