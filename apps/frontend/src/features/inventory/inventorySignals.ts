export type LotRestrictionSignal = 'Quarantined' | 'Active recall'

/** Quarantine and recall are independent of quantity and expiry. */
export function lotRestrictionSignals(lot: {
  isQuarantined: boolean
  isRecalled: boolean
}): LotRestrictionSignal[] {
  const signals: LotRestrictionSignal[] = []
  if (lot.isQuarantined) signals.push('Quarantined')
  if (lot.isRecalled) signals.push('Active recall')
  return signals
}
