export type Git = { branch: string; untracked: number; changed: number }
export type Limit = { label: string; pct: number; resetsAt?: string; withDate: boolean }

// Everything the band draws, refreshed by one timer
export type Snap = {
  model: string
  effort: string
  account: string
  folder: string
  git: Git | null
  ctxTokens?: number
  ctxWindow: number
  compactAt?: number
  limits: Limit[]
  cacheExpiresAt?: number
  cacheHit?: number
  startedAt: number
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'flex-status': { snap: Shaped<Snap | null> }
  }
}
