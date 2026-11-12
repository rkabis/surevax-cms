import React, { createContext, useContext, useState } from 'react'
import { useActiveShift } from './api'
import { useAuth } from '@/features/auth/context'
import type { StaffTimeLog } from '@surevax/shared'

// Shift tracking only applies to clinical/operational roles
const STAFF_ROLES = new Set(['Nurse', 'Cashier', 'Physician'])

type ShiftContextValue = {
  activeShift: StaffTimeLog | null
  isLoading: boolean
  isStaff: boolean
  modalDismissed: boolean
  setModalDismissed: (v: boolean) => void
}

const ShiftContext = createContext<ShiftContextValue | null>(null)

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const isStaff = user ? STAFF_ROLES.has(user.role) : false
  const { data, isLoading } = useActiveShift({ enabled: isStaff })
  const [modalDismissed, setModalDismissed] = useState(false)

  return (
    <ShiftContext.Provider
      value={{
        activeShift: data?.data ?? null,
        isLoading,
        isStaff,
        modalDismissed,
        setModalDismissed,
      }}
    >
      {children}
    </ShiftContext.Provider>
  )
}

export function useShift() {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useShift must be used inside ShiftProvider')
  return ctx
}
