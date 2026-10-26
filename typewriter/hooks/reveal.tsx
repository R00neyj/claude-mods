// typewriter's surface module: types a reply block out on the terminal's own frame
// clock, with no trip through the hooks module per frame. Each frame draws the prefix
// typed so far as markdown, as oh-my-pi's streaming reveal does.

import type { ClientModule } from 'claude-code'

// text: the block's text so far; bullet: the block opens the reply
type Props = { text: string; bullet: boolean }
// shown: graphemes typed; latest holds the props the frame clock reads, since its
// callback outlives the call that set it
type State = { shown: number; latest: { props: Props } }

// oh-my-pi's numbers: 30 frames a second, at least MIN_STEP graphemes a frame, and a
// backlog shrinks by a CATCHUP_FRAMES-th each frame, so it clears in about a quarter second
const FRAME_MS = 1000 / 30
const MIN_STEP = 3
const CATCHUP_FRAMES = 8
// Reply text sits two cells in, past the bullet column, on every block of a reply
const BULLET = '● '
const GUTTER = '  '

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : undefined

// The last text split, so a frame whose text has not grown does not split it again
let split = { text: '', units: [] as string[] }

// The block's graphemes, so an emoji or a combined character never splits
function graphemes(text: string): string[] {
  if (split.text !== text) {
    split = { text, units: segmenter ? Array.from(segmenter.segment(text), s => s.segment) : Array.from(text) }
  }
  return split.units
}

// What the cut leaves open is closed, as oh-my-pi does while streaming: a code fence, so
// the lines typed so far draw as code, and a link cut inside its address, so it draws as
// a link rather than as brackets that turn into one a frame later
function closeOpen(text: string): string {
  const fences = text.match(/^\s*(```|~~~)/gm)?.length ?? 0
  if (fences % 2 === 1) return `${text}\n\`\`\``
  return /\[[^\]\n]*\]\([^)\s]*$/.test(text) ? `${text})` : text
}

const Reveal: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Markdown } = surface.elements
  const state = surface.state ?? { shown: 0, latest: { props } }
  state.latest.props = props

  if (surface.state === undefined) {
    surface.setState(state)
    surface.every(FRAME_MS, () => {
      const s = surface.state
      if (!s) return
      const total = graphemes(s.latest.props.text).length
      const backlog = total - s.shown
      if (backlog <= 0) return
      surface.setState({ ...s, shown: Math.min(total, s.shown + Math.max(MIN_STEP, Math.ceil(backlog / CATCHUP_FRAMES))) })
    })
  }

  const typed = graphemes(props.text).slice(0, state.shown).join('')
  return (
    <Box flexDirection="row">
      <Text>{props.bullet ? BULLET : GUTTER}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown text={closeOpen(typed)} />
      </Box>
    </Box>
  )
}

export default Reveal
