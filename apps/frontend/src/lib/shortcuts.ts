/**
 * Data-driven keyboard-shortcut registry. Future units can append entries
 * (e.g. when wiring up Cmd+K) without touching the help dialog markup —
 * the dialog renders this list directly.
 */
export interface Shortcut {
  /** Display key combo, e.g. `?`, `Cmd+K`, `Esc`. */
  keys: string[]
  /** Short description shown in the help dialog. */
  description: string
  /** Bucket the entry by feature — drives section headings. */
  group: 'Global' | 'Navigation' | 'Forms'
}

export const SHORTCUTS: Shortcut[] = [
  { keys: ['?'], description: 'Open this help dialog', group: 'Global' },
  { keys: ['Esc'], description: 'Close drawer or dialog', group: 'Global' },
  { keys: ['Cmd', 'K'], description: 'Command palette', group: 'Global' },
]
