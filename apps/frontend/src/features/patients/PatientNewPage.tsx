import { useSearchParams } from 'react-router-dom'
import { PatientFormPage } from './components/PatientForm'

export default function PatientNewPage() {
  const [sp] = useSearchParams()
  const returnTo = sp.get('returnTo') ?? undefined
  return <PatientFormPage mode="create" returnTo={returnTo} />
}
