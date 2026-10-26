// typewriter's surface module: types a reply block out on the terminal's own frame
// clock, with no trip through the hooks module per frame. Each frame draws the prefix
// typed so far as markdown, as oh-my-pi's streaming reveal does; once it has caught up
// it tells the hooks module, which hands the block back to the engine.

import type { ClientModule } from 'claude-code'

// text: the block's text so far; bullet: the block opens the reply
type Props = { text: string; bullet: boolean }
// shown: graphemes typed; step: graphemes a frame, set when the text last grew (at
// total graphemes); posted: the text length last told caught up; latest holds the props
// the frame clock reads, since its callback outlives the call that set it
type State = { shown: number; step: number; total: number; posted: number; latest: { props: Props } }

// An even pace, as a typewriter keeps: when the text grows, the step is set so the
// backlog types out over about TARGET_FRAMES frames, at least MIN_STEP a frame, and held
// until the text grows again. oh-my-pi shrinks the backlog by an eighth each frame
// instead, which suits text that streams in a little at a time; a block here lands
// whole, and shrinking it that way shows most of it at once and types only the tail.
const FRAME_MS = 1000 / 60
const MIN_STEP = 1
const TARGET_FRAMES = 90
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
  const state = surface.state ?? { shown: 0, step: MIN_STEP, total: 0, posted: -1, latest: { props } }
  state.latest.props = props

  if (surface.state === undefined) {
    surface.setState(state)
    surface.every(FRAME_MS, () => {
      const s = surface.state
      if (!s) return
      const { text } = s.latest.props
      const total = graphemes(text).length
      const backlog = total - s.shown
      if (backlog <= 0) {
        // Caught up: told once per length, in UTF-16 units as the hooks module counts
        if (s.posted !== text.length) {
          surface.setState({ ...s, posted: text.length })
          surface.post({ caughtUp: text.length })
        }
        return
      }
      const step = total === s.total ? s.step : Math.max(MIN_STEP, Math.ceil(backlog / TARGET_FRAMES))
      surface.setState({ ...s, step, total, shown: Math.min(total, s.shown + step) })
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
