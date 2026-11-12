import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  TableCard,
  FormSectionHeader,
  ErrorBanner,
} from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { useAdminBranchDetail, deriveReceiptMode } from './branchesApi'
import BranchReceiptConfigDialog from './components/BranchReceiptConfigDialog'

const SENSITIVE_KEYS = /api_key|secret|token|password|auth|credential/i

function maskSensitiveSettings(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '••••••••' : v]),
  )
}

export default function BranchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [receiptConfigOpen, setReceiptConfigOpen] = useState(false)

  const { data: branch, isLoading, isError } = useAdminBranchDetail(id ?? null)

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-6 space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    )
  }

  if (isError || !branch) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
          <PageHeader
            title="Branch not found"
            description="This branch does not exist or you don't have access."
            actions={
              <Button variant="outline" size="sm" onClick={() => navigate('/admin/branches')}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Back to Branches
              </Button>
            }
          />
        </div>
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-6">
          <ErrorBanner message="Failed to load branch details." />
        </div>
      </div>
    )
  }

  const maskedSettings =
    branch.settings && typeof branch.settings === 'object'
      ? maskSensitiveSettings(branch.settings as Record<string, unknown>)
      : null

  const receiptConfig = deriveReceiptMode(branch.settings)

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title={`${branch.code}: ${branch.name}`}
          description="Branch details · Full profile edit coming in a future release"
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/branches')}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Back to Branches
            </Button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Total staff" value={branch.staffCount} subtitle="assigned to branch" />
          <KpiCell
            label="Active staff"
            value={branch.activeStaffCount}
            subtitle={`of ${branch.staffCount} total`}
          />
          <KpiCell
            label="Status"
            value={branch.isActive ? 'Active' : 'Inactive'}
            subtitle={branch.isActive ? 'accepting patients' : 'disabled'}
          />
        </KpiStrip>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-6 space-y-6">
          {/* Identity */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <FormSectionHeader>Identity</FormSectionHeader>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Display ID</dt>
                  <dd className="font-mono mt-0.5">{branch.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Code</dt>
                  <dd className="font-mono mt-0.5">{branch.code}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Name</dt>
                  <dd className="mt-0.5">{branch.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Status</dt>
                  <dd className="mt-0.5">
                    {branch.isActive ? (
                      <Badge variant="default" className="text-xs">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Timezone</dt>
                  <dd className="font-mono mt-0.5">{branch.timezone ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Transaction counter</dt>
                  <dd className="text-sm mt-0.5 font-mono tabular-nums">
                    {branch.txnCounter.currentValue !== null ? (
                      branch.txnCounter.currentValue
                    ) : (
                      <span className="text-muted-foreground">No transactions yet</span>
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <FormSectionHeader>Contact</FormSectionHeader>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-muted-foreground text-xs">Address</dt>
                  <dd className="mt-0.5">{branch.address ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">City</dt>
                  <dd className="mt-0.5">{branch.city ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Province</dt>
                  <dd className="mt-0.5">{branch.province ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Phone</dt>
                  <dd className="mt-0.5">
                    {branch.contactNumber ? (
                      <a
                        href={`tel:${branch.contactNumber}`}
                        className="text-primary hover:underline font-mono text-xs"
                      >
                        {branch.contactNumber}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Email</dt>
                  <dd className="mt-0.5">
                    {branch.email ? (
                      <a
                        href={`mailto:${branch.email}`}
                        className="text-primary hover:underline text-xs"
                      >
                        {branch.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Receipt configuration */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <FormSectionHeader>Receipt configuration</FormSectionHeader>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReceiptConfigOpen(true)}
                  className="shrink-0"
                >
                  <Settings2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  Configure receipt
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Mode</dt>
                  <dd className="mt-0.5">
                    {receiptConfig.mode === 'bir_official' ? (
                      <Badge variant="default" className="text-xs">
                        BIR official
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Acknowledgement
                      </Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">TIN</dt>
                  <dd className="font-mono mt-0.5">{receiptConfig.bir?.tin ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Registered name</dt>
                  <dd className="mt-0.5">{receiptConfig.bir?.registeredName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Permit or ATP number</dt>
                  <dd className="font-mono mt-0.5">{receiptConfig.bir?.permitNo ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Accreditation number</dt>
                  <dd className="font-mono mt-0.5">{receiptConfig.bir?.accreditationNo ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">OR series</dt>
                  <dd className="font-mono mt-0.5">{receiptConfig.bir?.orSeries ?? '—'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Settings (JSONB) */}
          {maskedSettings && Object.keys(maskedSettings).length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-4">
                <FormSectionHeader>Settings</FormSectionHeader>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(maskedSettings, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Audit */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <FormSectionHeader>Audit</FormSectionHeader>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Created</dt>
                  <dd className="mt-0.5 font-mono text-xs">{formatDateTime(branch.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Last updated</dt>
                  <dd className="mt-0.5 font-mono text-xs">{formatDateTime(branch.updatedAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Staff roster */}
          <Card>
            <CardContent className="pt-4 space-y-4">
              <FormSectionHeader>
                Staff roster · {branch.staffCount} total, {branch.activeStaffCount} active
              </FormSectionHeader>

              {branch.staff.length === 0 ? (
                <ListEmpty icon={Building2} message="No staff assigned to this branch." />
              ) : (
                <TableCard>
                  <Table className="w-full text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-left px-4 font-medium">ID</TableHead>
                        <TableHead className="text-left px-4 font-medium">Name</TableHead>
                        <TableHead className="text-left px-4 font-medium">Email</TableHead>
                        <TableHead className="text-left px-4 font-medium">Role</TableHead>
                        <TableHead className="text-left px-4 font-medium">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {branch.staff.map((s) => (
                        <TableRow key={s.displayId} className="border-b border-border">
                          <TableCell className="px-4 font-mono text-xs">{s.displayId}</TableCell>
                          <TableCell className="px-4 font-medium">{s.name}</TableCell>
                          <TableCell className="px-4 text-muted-foreground text-xs">
                            {s.email}
                          </TableCell>
                          <TableCell className="px-4">
                            <Badge variant="outline" className="text-xs">
                              {s.role ?? '—'}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-4">
                            {s.isActive ? (
                              <Badge variant="default" className="text-xs">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Inactive
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableCard>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <BranchReceiptConfigDialog
        branch={branch}
        open={receiptConfigOpen}
        onOpenChange={setReceiptConfigOpen}
      />
    </div>
  )
}
