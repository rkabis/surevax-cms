import { useEffect } from 'react'

/**
 * Cmd+Enter (macOS) / Ctrl+Enter (everywhere else) → advance.
 * Caller decides what "advance" means for the current step.
 *
 * Triggers in inputs/textareas too — that's the desired UX for a wizard
 * (filling a field then hitting Cmd+Enter to submit).
 */
export function useAdvanceShortcut(advance: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        advance()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [advance])
}
