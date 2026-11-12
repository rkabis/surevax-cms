import { useState, useRef, useEffect } from 'react'
import { FileText, Plus, ChevronsUpDown, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { claimStatusVariant, humanizeStatus } from '@/lib/status'
import { Button } from '@/components/ui/button'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
} from '@/components/layout'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatMoney } from '@/lib/format'
import { useClaims, useCreateClaim, type ClaimStatus, type ClaimsFilters } from './claimsApi'
import { usePayerProfiles } from './payerProfilesApi'
import ClaimDetail from './components/ClaimDetail'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useTransactions } from '@/features/transactions/api'

function claimSeverity(status: ClaimStatus): 'overdue' | 'due' | 'ok' | 'info' {
  switch (status) {
    case 'Denied':
    case 'Appealed':
      return 'overdue'
    case 'Draft':
    case 'Submitted':
    case 'Acknowledged':
    case 'InReview':
      return 'due'
    case 'Approved':
    case 'PartiallyApproved':
      return 'info'
    case 'Paid':
      return 'ok'
    default:
      return 'info'
  }
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

type StatusGroup = 'All' | 'Pending' | 'Approved' | 'Closed'

const STATUS_GROUPS: StatusGroup[] = ['All', 'Pending', 'Approved', 'Closed']

const GROUP_TO_STATUSES: Record<StatusGroup, ClaimStatus[]> = {
  All: [],
  Pending: ['Draft', 'Submitted', 'Acknowledged', 'InReview', 'Appealed'],
  Approved: ['Approved', 'PartiallyApproved', 'Paid'],
  Closed: ['Denied'],
}

// ── Payer Combobox ────────────────────────────────────────────────────────────

function PayerCombobox({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data: profilesResp, isLoading } = usePayerProfiles()
  const profiles = profilesResp?.data ?? []
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = profiles.find((p) => p.id === value)

  const filtered = search
    ? profiles.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.id.toLowerCase().includes(search.toLowerCase()),
      )
    : profiles

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between font-normal"
        onClick={() => setOpen(!open)}
        disabled={isLoading}
      >
        {selected ? (
          <span className="flex items-center gap-2">
            <span>{selected.name}</span>
            <span className="text-xs text-muted-foreground font-mono">{selected.id}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {isLoading ? 'Loading payers…' : 'Select payer…'}
          </span>
        )}
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
      </Button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border border-border bg-popover shadow-md">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search payers…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>No payer found.</CommandEmpty>
              <CommandGroup>
                {filtered.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    onSelect={() => {
                      onChange(p.id === value ? '' : p.id)
                      setOpen(false)
                      setSearch('')
                    }}
                  >
                    <Check
                      className={`mr-2 h-4 w-4 ${p.id === value ? 'opacity-100' : 'opacity-0'}`}
                    />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{p.id}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClaimsPage() {
  const [group, setGroup] = useState<StatusGroup>('All')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const filters: ClaimsFilters = group === 'All' ? {} : { status: GROUP_TO_STATUSES[group][0] }

  const { data, isLoading, isError } = useClaims(filters)
  const createClaim = useCreateClaim()

  const allRows = data ?? []

  const rows = search
    ? allRows.filter(
        (c) =>
          c.externalClaimNumber?.toLowerCase().includes(search.toLowerCase()) ||
          c.id.toLowerCase().includes(search.toLowerCase()),
      )
    : allRows

  const filteredRows =
    group !== 'All' ? rows.filter((c) => GROUP_TO_STATUSES[group].includes(c.status)) : rows

  const submittedCount = allRows.filter(
    (c) => c.status === 'Submitted' || c.status === 'Acknowledged' || c.status === 'InReview',
  ).length
  const approvedCount = allRows.filter(
    (c) => c.status === 'Approved' || c.status === 'PartiallyApproved' || c.status === 'Paid',
  ).length
  const pendingCount = allRows.filter((c) => c.status === 'Draft' || c.status === 'Appealed').length
  const deniedCount = allRows.filter((c) => c.status === 'Denied').length

  // Create form state
  const [payerId, setPayerId] = useState('')
  const [patientId, setPatientId] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [totalBilled, setTotalBilled] = useState('')
  const [externalClaimNumber, setExternalClaimNumber] = useState('')
  const [creating, setCreating] = useState(false)

  // Fetch patient's transactions when patientId is set (debounced via enabled flag)
  const { data: txnResp } = useTransactions({
    patient: patientId.trim() || undefined,
    enabled: patientId.trim().length > 0,
  })
  const patientTransactions = txnResp?.data ?? []

  function resetCreateForm() {
    setPayerId('')
    setPatientId('')
    setTransactionId('')
    setTotalBilled('')
    setExternalClaimNumber('')
  }

  function handleCreate() {
    if (!payerId) return
    setCreating(true)
    createClaim.mutate(
      {
        payerId,
        patientId: patientId || undefined,
        transactionId: transactionId || undefined,
        totalBilled: totalBilled || undefined,
        externalClaimNumber: externalClaimNumber || undefined,
      },
      {
        onSuccess: () => {
          setCreateOpen(false)
          resetCreateForm()
          setCreating(false)
        },
        onError: (err) => {
          setCreating(false)
          toast.error('Failed to create claim', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Claims"
          description={
            isLoading ? 'Loading…' : `${allRows.length} claim${allRows.length !== 1 ? 's' : ''}`
          }
          actions={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              New Claim
            </Button>
          }
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Submitted"
            value={isLoading ? '—' : submittedCount}
            subtitle="in review"
          />
          <KpiCell
            label="Approved"
            value={isLoading ? '—' : approvedCount}
            subtitle="approved / paid"
          />
          <KpiCell
            label="Pending"
            value={isLoading ? '—' : pendingCount}
            subtitle="draft · appeal"
          />
          <KpiCell
            label="Denied"
            value={isLoading ? '—' : deniedCount}
            subtitle="closed / rejected"
          />
        </KpiStrip>
      </div>

      {/* Filter tabs + search */}
      <PageToolbar>
        <Tabs value={group} onValueChange={(v) => setGroup(v as StatusGroup)}>
          <TabsList className="h-8">
            {STATUS_GROUPS.map((g) => (
              <TabsTrigger key={g} value={g} className="text-xs px-3 h-7">
                {g}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Search by claim ID or external claim #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm max-w-sm xl:max-w-md ml-auto"
        />
      </PageToolbar>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">Failed to load claims.</p>
            </div>
          )}

          {!isLoading && !isError && filteredRows.length === 0 && (
            <ListEmpty icon={FileText} message="No claims found." />
          )}

          {!isLoading && !isError && filteredRows.length > 0 && (
            <TableCard>
              <Table className="w-full text-sm">
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-left px-6 font-medium">Claim ID</TableHead>
                    <TableHead className="text-left px-4 font-medium">Patient ID</TableHead>
                    <TableHead className="text-left px-4 font-medium">Payer</TableHead>
                    <TableHead className="text-left px-4 font-medium">Status</TableHead>
                    <TableHead className="text-right px-4 font-medium">Total Billed</TableHead>
                    <TableHead className="text-left px-4 font-medium">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((c) => (
                    <TableRow
                      interactive
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      data-severity={claimSeverity(c.status)}
                      className="stripe border-b border-border hover:bg-accent/50 transition-colors cursor-pointer"
                    >
                      <TableCell className="px-6">
                        <div>
                          <p className="font-mono tabular-nums text-xs">{c.id}</p>
                          {c.externalClaimNumber && (
                            <p className="text-xs text-muted-foreground font-mono tabular-nums">
                              {c.externalClaimNumber}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 font-mono tabular-nums text-xs text-muted-foreground">
                        {c.patientId ?? '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground">
                        {c.payer?.name ?? c.payerId}
                      </TableCell>
                      <TableCell className="px-4">
                        <Badge variant={claimStatusVariant(c.status)} className="text-xs">
                          {humanizeStatus(c.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 text-right font-mono tabular-nums">
                        {c.totalBilled ? formatMoney(c.totalBilled) : '—'}
                      </TableCell>
                      <TableCell className="px-4 text-muted-foreground text-xs font-mono tabular-nums">
                        {formatDateTime(c.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-6 py-2 xl:px-8 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {filteredRows.length} claim{filteredRows.length !== 1 ? 's' : ''}
          {group !== 'All' ? ` · ${group}` : ''}
        </p>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet>
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Claim Detail</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            {selectedId && <ClaimDetail id={selectedId} />}
          </div>
        </DetailSheet>
      </Sheet>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent className="sm:max-w-lg xl:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Payer <span className="text-destructive">*</span>
              </Label>
              <PayerCombobox value={payerId} onChange={setPayerId} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="patient-id">Patient ID (optional)</Label>
              <Input
                id="patient-id"
                placeholder="PAT_…"
                value={patientId}
                onChange={(e) => {
                  setPatientId(e.target.value)
                  setTransactionId('')
                }}
              />
            </div>
            {patientId.trim().length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="linked-transaction">Linked Transaction (optional)</Label>
                <Select
                  value={transactionId}
                  onValueChange={(v) => {
                    setTransactionId(v)
                    const txn = patientTransactions.find((t) => t.id === v)
                    if (txn) setTotalBilled(txn.netAmount)
                  }}
                  disabled={patientTransactions.length === 0}
                >
                  <SelectTrigger id="linked-transaction">
                    <SelectValue
                      placeholder={
                        patientTransactions.length === 0
                          ? 'No transactions found'
                          : 'Select transaction…'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {patientTransactions.map((txn) => (
                      <SelectItem key={txn.id} value={txn.id}>
                        <span className="font-mono tabular-nums text-xs">{txn.id}</span>
                        {' · '}
                        {humanizeStatus(txn.status)}
                        {' · '}
                        {formatMoney(txn.netAmount)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="total-billed">Total Billed (optional)</Label>
              <Input
                id="total-billed"
                placeholder="0.00"
                value={totalBilled}
                onChange={(e) => setTotalBilled(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="external-claim-number">External Claim # (optional)</Label>
              <Input
                id="external-claim-number"
                placeholder="HMO-…"
                value={externalClaimNumber}
                onChange={(e) => setExternalClaimNumber(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false)
                resetCreateForm()
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!payerId || creating}>
              {creating ? 'Creating…' : 'Create Claim'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
