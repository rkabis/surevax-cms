import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, LayoutDashboard, LogOut, Shield } from 'lucide-react'
import { useAuth } from '@/features/auth/context'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { href: '/operator', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/operator/tenants', label: 'Tenants', icon: Building2, exact: false },
]

interface OperatorShellProps {
  children: React.ReactNode
}

export default function OperatorShell({ children }: OperatorShellProps) {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  async function handleLogout() {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: STANDARD_API_HEADERS,
    })
    setUser(null)
    queryClient.clear()
    navigate('/operator/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav */}
      <header className="border-b border-border bg-card">
        <div className="max-w-screen-2xl 2xl:max-w-shell mx-auto px-4 sm:px-6 xl:px-8 2xl:px-10 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground">
              <Shield size={14} aria-hidden="true" />
            </div>
            <span className="font-semibold text-sm tracking-tight">SureVax Operator</span>
          </div>

          <nav className="flex items-center gap-1" aria-label="Operator navigation">
            {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? location.pathname === href : location.pathname.startsWith(href)
              return (
                <Link
                  key={href}
                  to={href}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </Link>
              )
            })}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="max-w-screen-2xl 2xl:max-w-shell mx-auto">{children}</div>
      </main>
    </div>
  )
}
