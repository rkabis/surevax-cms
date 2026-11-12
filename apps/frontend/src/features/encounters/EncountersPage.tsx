import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import EncounterList from './components/EncounterList'
import EncounterDetail from './components/EncounterDetail'

export default function EncountersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // URL-as-state (Pattern 34): consume ?selected= one-shot (Today cockpit
  // deep-links here), then strip it.
  useEffect(() => {
    const sel = searchParams.get('selected')
    if (sel && sel !== selectedId) {
      setSelectedId(sel)
      setSheetOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('selected')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, selectedId, setSearchParams])

  function handleSelect(id: string) {
    setSelectedId(id)
    setSheetOpen(true)
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open)
    if (!open) setSelectedId(null)
  }

  return (
    <div className="h-full flex flex-col">
      <EncounterList selectedId={selectedId} onSelect={handleSelect} />

      <EncounterDetail
        encounterId={selectedId}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
      />
    </div>
  )
}
