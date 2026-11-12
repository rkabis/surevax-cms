import { useQuery } from '@tanstack/react-query'
import { PageHeader, TableCard, ListEmpty } from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import OperatorShell from './OperatorShell'
import { listOperatorTenants } from './operatorApi'
import { Skeleton } from '@/components/ui/skeleton'

export default function OperatorTenantsPage() {
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['operator', 'tenants'],
    queryFn: listOperatorTenants,
  })

  return (
    <OperatorShell>
      <div className="h-full flex flex-col">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
          <PageHeader title="Tenants" description="All registered tenants across the platform" />
        </div>
        <ScrollArea className="flex-1">
          <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
            <TableCard>
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Slug / ID</TableHead>
                    <TableHead className="text-right">Active Branches</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-3">
                        <div className="space-y-2" role="status" aria-label="Loading tenants">
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-9 w-full" />
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : tenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <ListEmpty message="No tenants found" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    tenants.map((tenant) => (
                      <TableRow key={tenant.id}>
                        <TableCell className="font-medium">{tenant.name}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {tenant.slug}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tenant.branchCount}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(tenant.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableCard>
          </div>
        </ScrollArea>
      </div>
    </OperatorShell>
  )
}
