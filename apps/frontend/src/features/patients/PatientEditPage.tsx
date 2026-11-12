import { useParams } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/layout'
import { usePatient } from './api'
import { PatientFormPage } from './components/PatientForm'

export default function PatientEditPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, isError, refetch } = usePatient(id ?? null)

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-6 space-y-3">
        <ErrorBanner message="Failed to load patient." />
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>
    )
  }

  return <PatientFormPage mode="edit" patient={data} />
}
