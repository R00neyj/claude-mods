// How fast the pieces of a reply are let out
export type Speed = 'slow' | 'normal' | 'fast'

declare module 'claude-code' {
  interface PluginState {
    'smooth-stream': { isOff: boolean; speed: Speed }
  }
}
