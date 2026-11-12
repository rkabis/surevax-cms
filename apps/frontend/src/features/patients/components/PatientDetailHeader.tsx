import { PageHeader } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { usePatientStandingOrders, useStandingOrderProgress } from '../api'
import { PatientSwitcher } from './PatientSwitcher'
import { getStandingOrderBanner } from './standingOrderBanner'

type Props = {
  patientId: string
}

/**
 * Patient-record page head: persistent patient switcher and a truthful standing
 * order status. Editing and protocol initiation live once in PatientDetail's
 * patient-specific action row, rather than being duplicated in both headers.
 */
export function PatientDetailHeader({ patientId }: Props) {
  const { data, isLoading } = useStandingOrderProgress(patientId)
  const standingOrders = usePatientStandingOrders(patientId)
  const banner = getStandingOrderBanner(data, Date.now(), standingOrders.data?.data)
  const bannerLoading = isLoading || standingOrders.isLoading

  return (
    <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card space-y-3">
      <PageHeader
        title="Patient record"
        actions={
          <>
            <PatientSwitcher />
          </>
        }
      />
      {bannerLoading ? (
        <div
          className="h-6 w-56 animate-pulse rounded-full bg-muted"
          aria-label="Loading schedule"
        />
      ) : (
        <Badge
          variant={banner.variant}
          className="text-xs font-mono tabular-nums"
          aria-live="polite"
        >
          {banner.label}
        </Badge>
      )}
    </div>
  )
}

export default PatientDetailHeader
