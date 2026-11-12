import { formatDate } from '@/lib/format'
import type { StandingOrderProgress } from '../api'
import type { ScheduledOrder } from '@/features/scheduled-orders/api'

export type StandingOrderBanner = {
  variant: 'overdue' | 'due' | 'ok' | 'secondary'
  label: string
}

/**
 * Keep the compact chart banner clinically honest: it must never turn an
 * incomplete course into a reassuring but ambiguous "due —" message.
 */
export function getStandingOrderBanner(
  data: StandingOrderProgress | undefined,
  now = Date.now(),
  scheduledOrders: ScheduledOrder[] = [],
): StandingOrderBanner {
  // The historical PEP progress projection classifies older rows with a null
  // indication as `not-started`, even when their scheduled orders are live.
  // Prefer the independently correct patient-scoped worklist rows whenever an
  // actionable dose exists, matching the Standing Order tab's fallback.
  const actionableOrder = [...scheduledOrders]
    .filter((order) => order.status !== 'Completed' && order.status !== 'Cancelled')
    .sort((a, b) => {
      if (!a.scheduledDate) return 1
      if (!b.scheduledDate) return -1
      return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    })[0]

  if (actionableOrder) {
    const label = actionableOrder.indication ?? actionableOrder.service
    if (!label || !actionableOrder.scheduledDate) {
      const missing = [!label && 'indication', !actionableOrder.scheduledDate && 'due date']
        .filter(Boolean)
        .join(' and ')
      return {
        variant: 'overdue',
        label: `Schedule details incomplete (${missing}) — review before administering`,
      }
    }

    const due = new Date(actionableOrder.scheduledDate)
    const today = new Date(now)
    due.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    const overdue = actionableOrder.status === 'Missed' || due.getTime() < today.getTime()

    return {
      variant: overdue ? 'overdue' : 'due',
      label: `${actionableOrder.status === 'Missed' ? 'Missed dose' : 'Next dose'}: ${label} — due ${formatDate(actionableOrder.scheduledDate)}`,
    }
  }

  if (!data || data.status === 'not-started') {
    return { variant: 'secondary', label: 'No active standing order' }
  }

  const nextDose = data.doses?.find((dose) => dose.status === 'pending')
  if (!nextDose) {
    return {
      variant: data.status === 'completed' ? 'ok' : 'secondary',
      label:
        data.status === 'completed'
          ? 'Standing order complete'
          : 'No pending dose in active schedule',
    }
  }

  if (!data.indication || !nextDose.scheduledDate) {
    const missing = [!data.indication && 'indication', !nextDose.scheduledDate && 'due date']
      .filter(Boolean)
      .join(' and ')
    return {
      variant: 'overdue',
      label: `Schedule details incomplete (${missing}) — review before administering`,
    }
  }

  const due = new Date(nextDose.scheduledDate)
  const today = new Date(now)
  due.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  const overdue = due.getTime() < today.getTime()
  return {
    variant: overdue ? 'overdue' : 'due',
    label: `Next dose: ${data.indication} — due ${formatDate(nextDose.scheduledDate)}`,
  }
}
