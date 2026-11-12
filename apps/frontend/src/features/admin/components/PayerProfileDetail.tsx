import { useState } from 'react'
import { Pencil, Plus, FileText, X } from 'lucide-react'
import { formatDateTime, formatLongDate } from '@/lib/format'
import {
  usePayerProfile,
  usePayerPriceExclusions,
  useAddPayerPriceExclusion,
  useRemovePayerPriceExclusion,
} from '../payerProfilesApi'
import { usePayerContracts } from '../payerContractsApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner, ListEmpty, TableCard } from '@/components/layout'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { UserLabel } from '@/components/UserLabel'
import ServicePicker from '@/components/forms/ServicePicker'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import PayerProfileEditSheet from './PayerProfileEditSheet'
import PayerContractCreateDialog from './PayerContractCreateDialog'

type Props = {
  payerProfileId: string
}

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.75rem_1fr] gap-3 py-2 border-b border-border/50 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground pt-0.5">{label}</dt>
      <dd className="text-sm break-words">{children ?? '—'}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {title}
      </h3>
      <dl>{children}</dl>
    </section>
  )
}

export default function PayerProfileDetail({ payerProfileId }: Props) {
  const { data: profile, isLoading, isError } = usePayerProfile(payerProfileId)
  const [editOpen, setEditOpen] = useState(false)
  const [createContractOpen, setCreateContractOpen] = useState(false)
  const { data: contractsResp, isLoading: contractsLoading } = usePayerContracts(payerProfileId)
  const contracts = contractsResp?.data ?? []

  const hasAdjustment = !!profile && profile.priceAdjustmentPercent != null
  const { data: exclusionsResp, isLoading: exclusionsLoading } = usePayerPriceExclusions(
    hasAdjustment ? payerProfileId : null,
  )
  const exclusions = exclusionsResp?.data ?? []
  const [addingExclusion, setAddingExclusion] = useState(false)
  const [pickerValue, setPickerValue] = useState<string | null>(null)
  const addExclusion = useAddPayerPriceExclusion(payerProfileId)
  const removeExclusion = useRemovePayerPriceExclusion(payerProfileId)

  async function handleAddExclusion() {
    if (!pickerValue) return
    try {
      await addExclusion.mutateAsync(pickerValue)
      setPickerValue(null)
      setAddingExclusion(false)
    } catch (err) {
      toast.error('Failed to add exclusion', { description: apiErrorMessage(err) })
    }
  }

  async function handleRemoveExclusion(serviceId: string) {
    try {
      await removeExclusion.mutateAsync(serviceId)
    } catch (err) {
      toast.error('Failed to remove exclusion', { description: apiErrorMessage(err) })
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !profile) {
    return <ErrorBanner message="Failed to load payer profile." className="p-6" />
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="px-6 py-6 space-y-6">
          {/* Name + badges + edit button */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold break-words">{profile.name}</h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {profile.payerType}
                </Badge>
                {profile.isActive ? (
                  <Badge variant="default" className="text-xs">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Inactive
                  </Badge>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Edit
            </Button>
          </div>

          <Section title="Identity">
            <KvRow label="Name">{profile.name}</KvRow>
            <KvRow label="Payer type">
              <Badge variant="outline" className="text-xs">
                {profile.payerType}
              </Badge>
            </KvRow>
            <KvRow label="Status">{profile.isActive ? 'Active' : 'Inactive'}</KvRow>
            <KvRow label="ID">
              <span className="font-mono tabular-nums text-xs">{profile.id}</span>
            </KvRow>
          </Section>

          <Section title="Contact">
            <KvRow label="Contact name">{profile.contactName}</KvRow>
            <KvRow label="Phone">
              {profile.contactNumber ? (
                <span className="font-mono tabular-nums">{profile.contactNumber}</span>
              ) : null}
            </KvRow>
            <KvRow label="Email">
              {profile.email ? (
                <span className="font-mono tabular-nums text-xs">{profile.email}</span>
              ) : null}
            </KvRow>
            <KvRow label="Address">{profile.address}</KvRow>
          </Section>

          <Section title="Terms">
            <KvRow label="Payment terms">
              {profile.paymentTermsDays != null ? (
                <span className="font-mono tabular-nums">{profile.paymentTermsDays} days</span>
              ) : null}
            </KvRow>
            <KvRow label="Price adjustment">
              {profile.priceAdjustmentPercent != null ? (
                <span className="font-mono tabular-nums">
                  {Number(profile.priceAdjustmentPercent) > 0 ? '+' : ''}
                  {Number(profile.priceAdjustmentPercent)}%
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </KvRow>
            <KvRow label="Notes">{profile.notes}</KvRow>
          </Section>

          {hasAdjustment && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Price adjustment exclusions ({exclusions.length})
                </h3>
                <Button size="sm" variant="outline" onClick={() => setAddingExclusion(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  Exclude a service
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Services listed here stay at their normal price for this payer despite the
                adjustment above.
              </p>

              {addingExclusion && (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <ServicePicker
                      value={pickerValue}
                      onChange={setPickerValue}
                      placeholder="Search for a service to exclude…"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleAddExclusion}
                    disabled={!pickerValue || addExclusion.isPending}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAddingExclusion(false)
                      setPickerValue(null)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {exclusionsLoading ? (
                <Skeleton className="h-16" />
              ) : exclusions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No exclusions — the adjustment applies to every service.
                </p>
              ) : (
                <ul className="space-y-1">
                  {exclusions.map((ex) => (
                    <li
                      key={ex.serviceId}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-border text-sm"
                    >
                      <span className="truncate">{ex.serviceName}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {ex.serviceId}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemoveExclusion(ex.serviceId)}
                          disabled={removeExclusion.isPending}
                          aria-label={`Remove exclusion for ${ex.serviceName}`}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contracts ({contracts.length})
              </h3>
              <Button size="sm" variant="outline" onClick={() => setCreateContractOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                New contract
              </Button>
            </div>

            {contractsLoading ? (
              <Skeleton className="h-24" />
            ) : contracts.length === 0 ? (
              <ListEmpty icon={FileText} message="No contracts for this payer." />
            ) : (
              <TableCard>
                <Table className="w-full text-sm">
                  <TableHeader className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <TableRow>
                      <TableHead className="text-left px-3 font-medium">Contract #</TableHead>
                      <TableHead className="text-left px-3 font-medium">Effective</TableHead>
                      <TableHead className="text-left px-3 font-medium">Terms</TableHead>
                      <TableHead className="text-left px-3 font-medium">Prior auth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.map((c) => (
                      <TableRow key={c.id} className="border-t border-border">
                        <TableCell className="px-3">
                          <div>
                            <p>{c.contractNumber}</p>
                            <p className="font-mono tabular-nums text-xs text-muted-foreground">
                              {c.id}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="px-3 text-xs">
                          {formatLongDate(c.effectiveFrom)}
                          {' to '}
                          {c.effectiveTo ? formatLongDate(c.effectiveTo) : 'ongoing'}
                        </TableCell>
                        <TableCell className="px-3 text-xs">
                          {c.paymentTermsDays != null ? `${c.paymentTermsDays} days` : '—'}
                        </TableCell>
                        <TableCell className="px-3">
                          {c.requiresPriorAuth ? (
                            <Badge variant="outline" className="text-xs">
                              Required
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not required</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            )}
          </section>

          <Section title="Audit">
            <KvRow label="Created at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(profile.createdAt)}
              </span>
            </KvRow>
            <KvRow label="Updated at">
              <span className="font-mono tabular-nums text-xs">
                {formatDateTime(profile.updatedAt)}
              </span>
            </KvRow>
            <KvRow label="Created by">
              <UserLabel user={profile.createdBy} />
            </KvRow>
          </Section>
        </div>
      </ScrollArea>

      <PayerProfileEditSheet open={editOpen} onOpenChange={setEditOpen} profile={profile} />
      <PayerContractCreateDialog
        payerId={payerProfileId}
        open={createContractOpen}
        onOpenChange={setCreateContractOpen}
      />
    </>
  )
}
