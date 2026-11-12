import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type DirtyFormGuardProps = {
  /** When true, block SPA navigation and show the "Unsaved changes?" dialog. */
  when: boolean
  /** Custom description shown in the confirmation dialog. */
  message?: string
  /**
   * Optional pathname prefix that defines "still inside the form" — navigation
   * to a sibling pathname under this prefix is allowed without prompting. Used
   * for multi-step wizards (e.g. `scope="/arrivals"` lets Step 2 → Step 3
   * proceed without the discard dialog). Omit for single-page forms.
   */
  scope?: string
  /**
   * Called just before `blocker.proceed()` — use to reset any local state
   * (e.g. wizard context) so it doesn't linger after navigation.
   */
  onDiscard?: () => void
  children?: React.ReactNode
}

/**
 * DirtyFormGuard — warns before navigating away when `when` is true.
 *
 * Uses `useBlocker` (react-router-dom v6 data router) for in-app SPA
 * navigation (sidebar click, programmatic navigate) and `beforeunload` for
 * tab close / hard refresh (useBlocker does NOT cover those).
 *
 * Place once at the page/wizard root — not per-step.
 */
export function DirtyFormGuard({ when, message, scope, onDiscard, children }: DirtyFormGuardProps) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!when) return false
    if (currentLocation.pathname === nextLocation.pathname) return false
    // Don't prompt for moves that stay inside the scoped prefix (e.g. wizard
    // step transitions). The guard only fires when leaving the form entirely.
    if (scope && nextLocation.pathname.startsWith(scope)) return false
    return true
  })

  // Tab-close / hard refresh — useBlocker doesn't cover these.
  useEffect(() => {
    if (!when) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      // Modern browsers ignore the returnValue string but still show the prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [when])

  return (
    <>
      {children}
      <AlertDialog open={blocker.state === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {message ?? 'You have unsaved changes. Leave anyway?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDiscard?.()
                blocker.proceed?.()
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
