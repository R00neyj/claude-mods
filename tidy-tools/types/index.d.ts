// Wall-clock milliseconds per tool_use_id, for the card footers
export type Durations = Record<string, number>

// Card background: follow the theme setting, force one palette, or none
export type BgMode = 'auto' | 'dark' | 'light' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'tidy-tools': { isOff: boolean; durations: Durations; bgMode: BgMode; isOpen: StateFamily<boolean> }
  }
}
