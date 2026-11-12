import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { PageHeader, KpiStrip, KpiCell } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/context'
import OperatorShell from './OperatorShell'
import { listOperatorTenants } from './operatorApi'

export default function OperatorDashboardPage() {
  const { user } = useAuth()
  const { data: tenants = [] } = useQuery({
    queryKey: ['operator', 'tenants'],
    queryFn: listOperatorTenants,
  })

  const totalBranches = tenants.reduce((sum, t) => sum + t.branchCount, 0)

  // Show the MFA enrollment prompt when the platform admin hasn't set it up.
  // The login response now carries mfaEnabled; if it isn't on the cached user
  // object yet, treat absence as "unknown" and surface the link anyway so
  // operators can opt in.
  const mfaEnabled = (user as { mfaEnabled?: boolean } | null)?.mfaEnabled === true

  return (
    <OperatorShell>
      <div className="h-full flex flex-col">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
          <PageHeader
            title="Platform Dashboard"
            description="Cross-tenant system overview — SureVax Operator Console"
          />
        </div>
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
          <KpiStrip>
            <KpiCell label="Tenants" value={String(tenants.length)} />
            <KpiCell label="Active Branches" value={String(totalBranches)} />
          </KpiStrip>
        </div>

        {!mfaEnabled && (
          <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
            <div className="flex items-start gap-3 rounded-md border border-yellow-500/30 bg-yellow-500/8 px-4 py-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-yellow-600" aria-hidden />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Two-factor authentication not set up</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up MFA to protect platform-admin access. Required before production use.
                </p>
              </div>
              <Button asChild size="sm">
                <Link to="/operator/mfa/enroll">Set up MFA</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-8 text-muted-foreground text-sm">
          Select a section from the navigation above to manage tenants and platform settings.
        </div>
      </div>
    </OperatorShell>
  )
}
