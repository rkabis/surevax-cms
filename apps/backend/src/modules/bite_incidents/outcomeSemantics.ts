export type AnimalOutcome =
  | 'AliveHealthy'
  | 'AliveSick'
  | 'DiedNaturally'
  | 'DiedUnknownCause'
  | 'KilledForTesting'
  | 'LostToFollowup'

export type FatTestResult = 'Positive' | 'Negative' | 'Pending' | 'NotTested' | null | undefined

/** Only an observed healthy animal or a negative FAT after natural death stops Day-28 PEP. */
export function shouldCancelDay28ForAnimalOutcome(
  outcome: AnimalOutcome,
  fatTestResult: FatTestResult,
): boolean {
  return outcome === 'AliveHealthy' || (outcome === 'DiedNaturally' && fatTestResult === 'Negative')
}
