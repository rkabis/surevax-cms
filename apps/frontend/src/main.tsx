import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { routes } from './App'
// Self-hosted variable fonts (no network fetch at runtime). Inter for UI
// text, JetBrains Mono for facts (IDs, money, doses, times) — see
// PATTERNS.md "Typography identity". Imported before index.css so the
// @font-face rules precede the body font-family declaration.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './index.css'

// Sentry error aggregation (M14). No-op when VITE_SENTRY_DSN isn't set so
// local dev works without a Sentry project. Init runs BEFORE createRoot so
// uncaught render errors are captured.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.0,
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
})

const router = createBrowserRouter(routes)

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
