import { useSyncExternalStore } from 'react'

/**
 * Reactive CSS media-query hook. SSR-safe (returns false on the server).
 *
 * ```ts
 * const is2xl = useMediaQuery('(min-width: 1536px)')
 * ```
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Tailwind `2xl` breakpoint — the 27" front-desk display qualifies. */
export function useIs2xl(): boolean {
  return useMediaQuery('(min-width: 1536px)')
}
