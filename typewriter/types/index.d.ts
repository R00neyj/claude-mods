// Whether /typewriter has turned the typing off
export type IsOff = boolean

declare module 'claude-code' {
  interface PluginState {
    typewriter: { isOff: IsOff }
  }
}
