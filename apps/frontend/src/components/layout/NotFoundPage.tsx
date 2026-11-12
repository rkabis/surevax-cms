import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/**
 * 404 catch-all page — rendered by the `path="*"` route in App.tsx.
 * Replaces the previous silent redirect to /patients for unknown URLs.
 */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 h-full">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The URL you requested doesn&apos;t match any known route.
      </p>
      <Button asChild variant="outline">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  )
}
