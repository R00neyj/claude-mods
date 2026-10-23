import { expect, test } from 'claude-code/testing'

const SNAP = {
  model: 'Opus 5.5',
  effort: 'med',
  account: 'demo-user',
  folder: 'my-project',
  git: { branch: 'master', untracked: 3, changed: 12 },
  ctxTokens: 120000,
  ctxWindow: 1000000,
  compactAt: 300000,
  limits: [
    { label: '5h', pct: 42, resetsAt: '2026-10-24T15:00:00', withDate: false },
    { label: '7d', pct: 18, resetsAt: '2026-10-30T09:00:00', withDate: true },
  ],
  cacheExpiresAt: Date.parse('2026-10-24T13:41:30'),
  cacheHit: 0.9731,
  startedAt: Date.parse('2026-10-24T12:00:00'),
  now: Date.parse('2026-10-24T13:00:00'),
}

const band = (bodyColumns: number) =>
  ({
    plugin: 'flex-status',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  }) as const

function textOf(node: any): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const kids = node.children ?? node.props?.children ?? []
  return (Array.isArray(kids) ? kids : [kids]).map(textOf).join('')
}

for (const cols of [220, 150, 100, 60, 40]) {
  test(`every chip shows at ${cols} columns`, async ($, on) => {
    on('state.get', () => ({ value: { value: { shape: 'snap-1', value: SNAP }, version: 1 } }))
    const ui = await $.ui.mount(band(cols))
    const tree: any = await ui.drawn()
    const rows: string[] = (tree.children ?? tree.props?.children ?? []).map(textOf)
    console.log(`\n── ${cols} cols (${rows.length} rows)\n` + rows.map(r => '|' + r + '|').join('\n'))
    const all = rows.join(' ')
    for (const want of ['Opus 5.5', 'med', 'demo-user', 'my-project', 'master', '5h 42%', '7d 18%', '97.31%', '13:00', '⟳300K']) {
      expect(all.includes(want)).toBe(true)
    }
    await ui.unmount()
  })
}
