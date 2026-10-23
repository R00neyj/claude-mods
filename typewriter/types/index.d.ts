// Characters of a reply block shown so far; -1 shows the whole block
export type Revealed = number

declare module 'claude-code' {
  interface PluginState {
    typewriter: { isOff: boolean; revealed: StateFamily<Revealed> }
  }
}
