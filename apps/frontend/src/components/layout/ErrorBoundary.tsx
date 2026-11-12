import { Component, type ReactNode } from 'react'
import { ErrorBanner } from './ErrorBanner'
import { Button } from '@/components/ui/button'

type Props = { children: ReactNode; fallbackMessage?: string }
type State = { error: Error | null }

/**
 * Page-level error boundary (PATTERNS.md Pattern 28).
 *
 * Wraps `<Outlet />` in AppShell so a single render-time React error
 * does not blank the entire application. Renders `<ErrorBanner>` with
 * a "Refresh page" button. Uses a class component because React still
 * requires it for `componentDidCatch` / `getDerivedStateFromError`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: unknown) {
    // Pino is server-side; browser render errors go to console.
    console.error('ErrorBoundary caught:', error, info)
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <ErrorBanner
            message={this.props.fallbackMessage ?? 'Something went wrong rendering this view.'}
          />
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Refresh page
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
