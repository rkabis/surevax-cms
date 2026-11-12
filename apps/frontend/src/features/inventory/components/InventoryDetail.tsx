import { useInventoryLot } from '../api'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/layout'
import { UserLabel } from '@/components/UserLabel'

type Props = {
  lotId: string
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value)
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{display}</p>
    </div>
  )
}

function FieldNode({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm break-words">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </section>
  )
}

export default function InventoryDetail({ lotId }: Props) {
  const { data: lot, isLoading, isError } = useInventoryLot(lotId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !lot) {
    return <ErrorBanner message="Failed to load inventory lot." className="p-6" />
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold">{lot.service.name}</h2>
          <p className="text-sm text-muted-foreground font-mono mt-1">{lot.batchNumber}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {lot.service.serviceType}
            </Badge>
            {lot.isQuarantined && (
              <Badge variant="overdue" className="text-xs">
                Quarantined
              </Badge>
            )}
          </div>
        </div>

        <Separator />

        {/* Lot */}
        <Section title="Lot">
          <Field label="Batch number" value={lot.batchNumber} />
          <Field label="Expiry date" value={formatDate(lot.expiryDate)} />
          <Field label="Received at" value={formatDate(lot.receivedAt)} />
          <Field label="Supplier" value={lot.supplierName} />
        </Section>

        <Separator />

        {/* Stock */}
        <Section title="Stock">
          <Field
            label="Quantity on hand"
            value={
              lot.quantityOnHand != null
                ? Number.isInteger(parseFloat(String(lot.quantityOnHand)))
                  ? String(parseInt(String(lot.quantityOnHand)))
                  : parseFloat(String(lot.quantityOnHand)).toFixed(2)
                : undefined
            }
          />
          <Field
            label="Quantity received"
            value={
              lot.quantityReceived != null
                ? Number.isInteger(parseFloat(String(lot.quantityReceived)))
                  ? String(parseInt(String(lot.quantityReceived)))
                  : parseFloat(String(lot.quantityReceived)).toFixed(2)
                : undefined
            }
          />
          <Field label="Quarantined" value={lot.isQuarantined ? 'Yes' : 'No'} />
          <Field label="Quarantine reason" value={lot.quarantineReason} />
        </Section>

        <Separator />

        {/* Service */}
        <Section title="Service">
          <Field label="Name" value={lot.service.name} />
          <Field label="Code" value={lot.service.code} />
          <Field label="Type" value={lot.service.serviceType} />
          <Field label="Category" value={lot.service.category} />
          <Field label="Base price" value={formatMoney(lot.service.basePrice)} />
        </Section>

        <Separator />

        {/* Audit */}
        <Section title="Audit">
          <Field label="Created at" value={formatDateTime(lot.createdAt)} />
          <Field label="Updated at" value={formatDateTime(lot.updatedAt)} />
          <FieldNode label="Created by">
            <UserLabel user={lot.createdBy} />
          </FieldNode>
          <Field label="Lot ID" value={lot.id} />
        </Section>
      </div>
    </ScrollArea>
  )
}
