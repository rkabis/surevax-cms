import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Global loss-of-connectivity warning. Clinical mutations deliberately remain
 * server-authoritative; the banner tells staff not to repeat an ambiguous act
 * while the terminal cannot confirm whether the first request committed.
 */
export function ConnectivityBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online) return null

  return (
    <div className="border-b border-destructive/30 bg-card px-4 py-2 sm:px-6 xl:px-8 2xl:px-10">
      <Alert variant="destructive" className="py-2" role="status" aria-live="assertive">
        <WifiOff className="h-4 w-4" aria-hidden />
        <AlertTitle>Clinic terminal is offline</AlertTitle>
        <AlertDescription>
          Lists may be out of date. Do not repeat a dose, payment, or stock action until the
          connection returns and the record can be checked.
        </AlertDescription>
      </Alert>
    </div>
  )
}
