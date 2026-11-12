import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type SortOrder = 'asc' | 'desc'
export type SortState = { col: string; order: SortOrder } | null

type Opts = {
  /** Default column key when no `?sort` in URL. */
  defaultCol?: string
  /** Default order when only `?sort=col` is set (no `?order=`). Default 'asc'. */
  defaultOrder?: SortOrder
}

export function useTableSort(opts: Opts = {}) {
  const [params, setParams] = useSearchParams()
  const col = params.get('sort') ?? opts.defaultCol ?? null
  const orderParam = params.get('order')
  const order: SortOrder = orderParam === 'desc' ? 'desc' : 'asc'
  const sort: SortState = col ? { col, order } : null

  const toggleSort = useCallback(
    (newCol: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const currentCol = next.get('sort')
          const currentOrder = next.get('order') === 'desc' ? 'desc' : 'asc'
          if (currentCol === newCol) {
            // Tri-state cycle: asc → desc → cleared
            if (currentOrder === 'asc') {
              next.set('order', 'desc')
            } else {
              next.delete('sort')
              next.delete('order')
            }
          } else {
            next.set('sort', newCol)
            next.delete('order') // defaults to asc
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return { sort, toggleSort }
}
