import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DetailSheet } from '@/components/layout'
import { UserLabel } from '@/components/UserLabel'
import { usePartnerLab } from '../partnerLabsApi'
import { maskSensitive } from '@/lib/sensitive'
import { formatDateTime } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  id: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

export default function PartnerLabDetail({ id, open, onOpenChange }: Props) {
  const { data: lab, isLoading, error } = usePartnerLab(id)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <DetailSheet>
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>{lab?.name ?? 'Partner Laboratory'}</SheetTitle>
          <SheetDescription>
            {lab ? (
              <Badge variant={lab.isActive ? 'default' : 'outline'} className="text-xs">
                {lab.isActive ? 'Active' : 'Inactive'}
              </Badge>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {isLoading && (
            <div className="px-6 py-4 space-y-2" role="status" aria-label="Loading partner lab">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          )}
          {error && (
            <div className="px-6 py-10 text-center text-sm text-destructive">
              Failed to load partner laboratory.
            </div>
          )}
          {lab && (
            <div className="px-6 py-6 space-y-6">
              <Section title="Identity">
                <KvRow label="Name">{lab.name}</KvRow>
                <KvRow label="Status">
                  <Badge variant={lab.isActive ? 'default' : 'outline'} className="text-xs">
                    {lab.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </KvRow>
                <KvRow label="ID">
                  <span className="font-mono tabular-nums text-xs">{lab.id}</span>
                </KvRow>
              </Section>

              <Section title="Contact">
                <KvRow label="Contact name">{lab.contactName}</KvRow>
                <KvRow label="Phone">
                  {lab.contactNumber ? (
                    <span className="font-mono tabular-nums">{lab.contactNumber}</span>
                  ) : null}
                </KvRow>
                <KvRow label="Email">
                  {lab.email ? (
                    <span className="font-mono tabular-nums text-xs">{lab.email}</span>
                  ) : null}
                </KvRow>
                <KvRow label="Address">{lab.address}</KvRow>
              </Section>

              <Section title="Integration">
                <KvRow label="API config">
                  {lab.apiConfig ? (
                    <pre className="bg-muted/50 rounded p-2 text-xs font-mono overflow-x-auto">
                      {JSON.stringify(maskSensitive(lab.apiConfig), null, 2)}
                    </pre>
                  ) : null}
                </KvRow>
              </Section>

              <Section title="Audit">
                <KvRow label="Created">
                  <span className="font-mono tabular-nums text-xs">
                    {formatDateTime(lab.createdAt)}
                  </span>
                </KvRow>
                <KvRow label="Updated">
                  <span className="font-mono tabular-nums text-xs">
                    {formatDateTime(lab.updatedAt)}
                  </span>
                </KvRow>
                <KvRow label="Created by">
                  <UserLabel user={lab.createdBy} />
                </KvRow>
              </Section>
            </div>
          )}
        </ScrollArea>
      </DetailSheet>
    </Sheet>
  )
}
